import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const skillsDir = path.join(here, 'skills');
const registryFile = path.join(skillsDir, 'registry.json');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const envFile = path.join(projectRoot, '.env');
if (existsSync(envFile)) {
  const lines = (await readFile(envFile, 'utf8')).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const port = Number(process.env.DEMO2_PORT || 4175);

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  // Buffer / 字符串按原样输出；只有普通对象才序列化为 JSON。
  // 否则 .json 静态文件（读出来是 Buffer）会被 JSON.stringify 成 {"type":"Buffer",...}。
  if (Buffer.isBuffer(data) || typeof data === 'string') return res.end(data);
  return res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 400_000) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('请求格式无效'), { status: 400 }); }
}

async function readBuffer(req, limit = 12_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('文件过大，上限 12 MB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/* ── 模板解析 ───────────────────────────────── */

function readZipEntry(buffer, target) {
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/');
    if (name === target) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      return null;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

function paragraphText(xml) {
  let out = '';
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
    if (match[1] != null) out += decodeXml(match[1]);
    else if (match[0].startsWith('<w:tab')) out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function styleLevel(style) {
  if (!style) return 0;
  const value = style.toLowerCase().replace(/\s+/g, '');
  const named = value.match(/^(?:heading|标题|h)(\d)$/);
  if (named) return Number(named[1]);
  const numeric = value.match(/^(\d)$/);
  return numeric ? Number(numeric[1]) : 0;
}

const HEADING_RULES = [
  { re: /^第[一二三四五六七八九十]+[章部分节][\s、.]?/, level: 1 },
  { re: /^[一二三四五六七八九十]+[、.．]\s*/, level: 1 },
  { re: /^（[一二三四五六七八九十]+）\s*/, level: 2 },
  { re: /^\([一二三四五六七八九十]+\)\s*/, level: 2 },
  { re: /^\d+[、.]\s*\S/, level: 1 },
  { re: /^\d+\.\d+(?!\d)\s*\S/, level: 2 }
];

function textLevel(text) {
  for (const rule of HEADING_RULES) {
    if (rule.re.test(text)) return rule.level;
  }
  return 0;
}

function looksLikeHeading(text) {
  return text.length > 0 && text.length <= 40 && textLevel(text) > 0;
}

function docxParagraphs(xml) {
  const items = [];
  for (const chunk of xml.split(/<w:p(?:\s[^>]*)?>/).slice(1)) {
    const body = chunk.split(/<\/w:p>/)[0];
    const style = (body.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
    const text = paragraphText(body);
    if (text) items.push({ text, level: styleLevel(style) });
  }
  return items;
}

function docxTables(xml) {
  const tables = [];
  for (const chunk of xml.split(/<w:tbl>/).slice(1)) {
    const body = chunk.split(/<\/w:tbl>/)[0];
    const firstRow = body.split(/<w:tr(?:\s[^>]*)?>/)[1];
    if (!firstRow) continue;
    const row = firstRow.split(/<\/w:tr>/)[0];
    const headers = [...row.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((cell) => paragraphText(cell[1])).filter(Boolean);
    if (headers.length) tables.push({ headers: headers.slice(0, 8) });
  }
  return tables;
}

function outlineFromParagraphs(paragraphs) {
  const styled = paragraphs.filter((item) => item.level > 0 && item.level <= 4)
    .map((item) => ({ level: item.level, heading: item.text }));
  if (styled.length >= 3) return styled;
  const heuristic = paragraphs.filter((item) => looksLikeHeading(item.text))
    .map((item) => ({ level: textLevel(item.text), heading: item.text }));
  if (heuristic.length >= 2) return heuristic;
  return styled;
}

function parseTemplate(name, buffer) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.docx')) {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const xml = readZipEntry(buffer, 'word/document.xml');
      if (!xml) throw Object.assign(new Error('无法读取 Word 文档内容，请确认文件未加密。'), { status: 422 });
      const text = xml.toString('utf8');
      return { kind: 'docx', sections: outlineFromParagraphs(docxParagraphs(text)), tables: docxTables(text) };
    }
    if (buffer[0] === 0xd0 && buffer[1] === 0xcf) {
      throw Object.assign(new Error('这是旧版 .doc 格式，请在 Word 中另存为 .docx 后重新上传。'), { status: 422 });
    }
    throw Object.assign(new Error('文件不是有效的 .docx。'), { status: 422 });
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    const lines = buffer.toString('utf8').split(/\r?\n/);
    const sections = [];
    for (const line of lines) {
      const match = line.match(/^(#{1,4})\s+(.+?)\s*$/);
      if (match) { sections.push({ level: match[1].length, heading: match[2] }); continue; }
      const plain = line.replace(/^[-*]\s+/, '').trim();
      if (looksLikeHeading(plain)) sections.push({ level: textLevel(plain), heading: plain });
    }
    return { kind: 'markdown', sections, tables: [] };
  }
  if (lower.endsWith('.txt')) {
    const paragraphs = buffer.toString('utf8').split(/\r?\n/).map((line) => ({ text: line.trim() })).filter((item) => item.text);
    return { kind: 'text', sections: outlineFromParagraphs(paragraphs), tables: [] };
  }
  throw Object.assign(new Error('暂只支持 .docx / .md / .txt 模板。'), { status: 415 });
}

function parseModelJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

function parseFrontMatter(text) {
  const match = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: String(text) };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (item) meta[item[1]] = item[2].trim();
  }
  return { meta, body: String(text).slice(match[0].length) };
}

async function readRegistry() {
  return JSON.parse(await readFile(registryFile, 'utf8'));
}

async function loadSkill(id) {
  const registry = await readRegistry();
  const entry = registry.skills.find((skill) => skill.id === id);
  if (!entry) return { entry: null, ready: false };
  const file = path.join(skillsDir, entry.id, 'SKILL.md');
  if (!existsSync(file)) return { entry, ready: false };
  const { meta, body } = parseFrontMatter(await readFile(file, 'utf8'));
  return { entry: { ...entry, meta }, rules: body.trim(), ready: true };
}

async function handleSkills(req, res) {
  const registry = await readRegistry();
  const skills = registry.skills.map((entry) => ({
    ...entry,
    ready: existsSync(path.join(skillsDir, entry.id, 'SKILL.md'))
  }));
  return send(res, 200, { layout: registry.layout, kinds: registry.kinds, deliverables: registry.deliverables, skills });
}

async function handleStructure(req, res) {
  const body = await readJson(req);
  const skillId = String(body.skill || '');
  const skill = await loadSkill(skillId);
  if (!skill.entry) return send(res, 400, { error: `未注册的 skill：${skillId}` });
  if (!skill.ready) return send(res, 501, { error: `skill「${skill.entry.title}」尚未接入，请先在 skills/${skillId}/SKILL.md 中定义。` });
  if (!process.env.DEEPSEEK_API_KEY) return send(res, 503, { error: '尚未配置 DeepSeek API Key，请在仓库根目录 .env 中配置。' });

  const contract = String(body.contract || '').slice(0, 6000);
  const input = JSON.stringify(body.input ?? {}, null, 2).slice(0, 40_000);

  const system = [
    '你是校园活动的结构化策划助手，负责把零散输入整理成规范的结构化数据。',
    skill.rules,
    `## 本次输出契约（必须严格遵守）\n${contract}`,
    '再次强调：只输出一个 JSON 对象。不要 Markdown、不要代码围栏、不要任何解释文字。'
  ].join('\n\n');

  const upstream = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.3,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `以下是输入数据：\n${input}` }
      ]
    })
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return send(res, 502, { error: `DeepSeek 请求失败（HTTP ${upstream.status}）。${detail.slice(0, 200)}` });
  }

  const result = await upstream.json();
  const text = result.choices?.[0]?.message?.content;
  if (!text) return send(res, 502, { error: 'DeepSeek 未返回内容。' });

  try {
    return send(res, 200, { data: parseModelJson(text), model: result.model || 'deepseek-chat' });
  } catch {
    return send(res, 502, { error: 'AI 返回的内容不是合法 JSON，请重试。' });
  }
}

/* ── 生图（YosHub）：生成结果落盘到 demo2/generated/，前端只用本地 URL ── */

/* base 既可能是域名，也可能已经带了 /v1 或结尾斜杠，这里统一拼成 /v1/images/generations */
function imagesEndpoint() {
  const base = String(process.env.YOSHUB_API_BASE || 'https://api.yoshub.com').trim().replace(/\/+$/, '');
  return /\/v\d+$/.test(base) ? `${base}/images/generations` : `${base}/v1/images/generations`;
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

async function handleImage(req, res) {
  if (!process.env.YOSHUB_API_KEY) {
    return send(res, 503, { error: '尚未配置 YOSHUB_API_KEY，请在仓库根目录 .env 中配置后再使用生图。' });
  }
  const body = await readJson(req);
  const prompt = String(body.prompt || '').trim().slice(0, 4000);
  if (!prompt) return send(res, 400, { error: '画面描述不能为空。' });
  const size = /^\d{3,4}x\d{3,4}$/.test(String(body.size || '')) ? String(body.size) : '1024x1024';
  const model = process.env.YOSHUB_IMAGE_MODEL || 'gpt-image-2';

  const upstream = await fetch(imagesEndpoint(), {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${process.env.YOSHUB_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size, n: 1 })
  });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return send(res, 502, { error: `YosHub 请求失败（HTTP ${upstream.status}）。${detail.slice(0, 200)}` });
  }

  const result = await upstream.json();
  const item = result.data?.[0];
  let bytes;
  let extension = 'png';
  if (item?.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64');
  } else if (item?.url) {
    const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (!imageResponse.ok) return send(res, 502, { error: `下载 YosHub 图片失败（HTTP ${imageResponse.status}）。` });
    bytes = Buffer.from(await imageResponse.arrayBuffer());
    const type = imageResponse.headers.get('content-type') || '';
    extension = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
  } else {
    return send(res, 502, { error: 'YosHub 返回结果中没有图片数据。' });
  }

  /* 以文件头为准判断真实格式，避免扩展名与实际内容不一致 */
  if (bytes[0] === 0xff && bytes[1] === 0xd8) extension = 'jpg';
  else if (bytes.toString('ascii', 1, 4) === 'PNG') extension = 'png';

  const filename = `${randomUUID()}.${extension}`;
  const outputDir = path.join(here, 'generated');
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, filename), bytes);
  return send(res, 200, { url: `/generated/${filename}`, model: item.model || model, ...imageDimensions(bytes) });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        providers: { deepseek: Boolean(process.env.DEEPSEEK_API_KEY), yoshub: Boolean(process.env.YOSHUB_API_KEY) }
      });
    }
    if (url.pathname === '/api/skills') {
      return await handleSkills(req, res);
    }
    if (url.pathname === '/api/template') {
      if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST 请求' });
      const buffer = await readBuffer(req);
      const name = url.searchParams.get('name') || 'template.docx';
      return send(res, 200, { name, ...parseTemplate(name, buffer) });
    }
    if (url.pathname === '/api/structure' || url.pathname === '/api/material') {
      if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST 请求' });
      return await handleStructure(req, res);
    }
    if (url.pathname === '/api/image') {
      if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST 请求' });
      return await handleImage(req, res);
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'API 路径不存在。' });

    const requested = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    const file = path.resolve(here, requested);
    if (!file.startsWith(`${here}${path.sep}`)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    const content = await readFile(file);
    return send(res, 200, content, mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const status = error.code === 'ENOENT' ? 404 : error.status || 500;
    send(res, status, { error: error.status ? error.message : '本地服务处理失败。' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Demo2 listening at http://127.0.0.1:${port}/`));
