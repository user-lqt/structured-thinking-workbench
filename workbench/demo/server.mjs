import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

if (existsSync(path.join(projectRoot, '.env'))) {
  const lines = (await readFile(path.join(projectRoot, '.env'), 'utf8')).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const port = Number(process.env.PORT || 4174);

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('请求格式无效'), { status: 400 }); }
}

function imageDimensions(buffer) {
  if (buffer.toString('ascii', 1, 4) === 'PNG' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1]; const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST 请求' });
  const body = await readJson(req);
  if (pathname === '/api/text') {
    if (!process.env.DEEPSEEK_API_KEY) return send(res, 503, { error: '尚未配置 DeepSeek API Key，请在仓库根目录 .env 中配置。' });
    const content = String(body.content || '').slice(0, 50_000);
    if (!content) return send(res, 400, { error: '材料内容不能为空。' });
    const instruction = String(body.instruction || '整理结构并提升表达清晰度，保留全部待补充标记。').slice(0, 2000);
    const upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0.3, stream: false, messages: [
        { role: 'system', content: '你是活动项目材料编辑助手。只能使用用户提供的事实；没有提供的数据、案例、姓名、时间、地址、单位、联系方式和依据都必须保留为“待补充”，不得推测或编造。按要求改善结构和表达，输出可直接编辑的 Markdown，不要解释过程。' },
        { role: 'user', content: `材料标题：${String(body.title || '').slice(0, 200)}\n修改要求：${instruction}\n\n现有材料：\n${content}` }
      ] })
    });
    if (!upstream.ok) return send(res, 502, { error: `DeepSeek 请求失败（HTTP ${upstream.status}）。` });
    const result = await upstream.json(); const text = result.choices?.[0]?.message?.content;
    if (!text) return send(res, 502, { error: 'DeepSeek 未返回可用文案。' });
    return send(res, 200, { text, model: result.model || 'deepseek-chat' });
  }
  if (pathname === '/api/image') {
    if (!process.env.YOSHUB_API_KEY) return send(res, 503, { error: '尚未配置 YosHub API Key，请在仓库根目录 .env 中配置。' });
    const prompt = String(body.prompt || '').trim().slice(0, 4000);
    if (!prompt) return send(res, 400, { error: '画面描述不能为空。' });
    const model = process.env.YOSHUB_IMAGE_MODEL || 'gpt-image-2';
    const upstream = await fetch(`${process.env.YOSHUB_API_BASE || 'https://api.yoshub.com'}/v1/images/generations`, {
      method: 'POST', signal: AbortSignal.timeout(180_000),
      headers: { Authorization: `Bearer ${process.env.YOSHUB_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', n: 1 })
    });
    if (!upstream.ok) return send(res, 502, { error: `YosHub 请求失败（HTTP ${upstream.status}）。` });
    const result = await upstream.json(); const item = result.data?.[0];
    let bytes; let extension = 'png';
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
    else if (item?.url) {
      const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
      if (!imageResponse.ok) return send(res, 502, { error: `下载 YosHub 图片失败（HTTP ${imageResponse.status}）。` });
      bytes = Buffer.from(await imageResponse.arrayBuffer());
      const type = imageResponse.headers.get('content-type') || '';
      extension = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
    } else return send(res, 502, { error: 'YosHub 返回结果中没有图片数据。' });
    const detected = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes.toString('ascii', 1, 4) === 'PNG' ? 'png' : extension;
    extension = detected;
    const filename = `${randomUUID()}.${extension}`;
    const outputDir = path.join(here, 'generated');
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, filename), bytes);
    return send(res, 200, { url: `/generated/${filename}`, model: result.data?.[0]?.model || model, ...imageDimensions(bytes) });
  }
  return send(res, 404, { error: 'API 路径不存在。' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, providers: { deepseek: Boolean(process.env.DEEPSEEK_API_KEY), yoshub: Boolean(process.env.YOSHUB_API_KEY) } });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    const requested = url.pathname.startsWith('/generated/') ? url.pathname.slice(1) : decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const root = url.pathname.startsWith('/generated/') ? path.join(here, 'generated') : here;
    const file = path.resolve(root, requested.replace(/^generated\//, ''));
    if (!file.startsWith(`${root}${path.sep}`) && file !== root) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    const content = await readFile(file);
    return send(res, 200, content, mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (error) {
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : '本地服务处理失败。' });
    else res.destroy();
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Demo listening at http://127.0.0.1:${port}/`));
