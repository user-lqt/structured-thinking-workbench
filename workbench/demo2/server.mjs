import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { sharedProjects } from './server/shared.mjs';

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
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8'
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

/* 默认只听回环：只有本机能访问，别的设备连不上。
   要手机扫码填写时，用 DEMO2_HOST=0.0.0.0 启动——这时「非本机」的请求
   只能读下面这三个文件（填写页与它加载的两个脚本），共享项目与 AI 接口按邀请凭据校验；手机报名和考勤落盘到服务端，
   无网络时保留本机回执。 */
const host = String(process.env.DEMO2_HOST || '127.0.0.1').trim() || '127.0.0.1';
/* 非本机（局域网 / cloudflared 隧道 / 反向代理）能碰到的路径，只有填写页这一小块：
   读：填写页 + 它加载的两个脚本 + 按短码取表单；写：提交一条回执码。
   工作台页面、/api/structure（AI Key 在这里）、/api/image、/generated/ 都不在名单里。 */
const REMOTE_GET = new Set(['/signup.html', '/core/qr.js', '/core/signup.js', '/api/signup/form', '/api/signup/status']);
const REMOTE_POST = new Set(['/api/signup/submit']);

/* 手机直传的落盘位置：generated/join/（运行期生成，不进仓库、不进打包产物） */
const runtimeDir = process.env.DEMO2_DATA_DIR || path.join(here, 'generated');
const JOIN_DIR = path.join(runtimeDir, 'join');
const shared = sharedProjects(path.join(runtimeDir, 'shared'));
const signupContext = { window: {}, TextEncoder, TextDecoder };
vm.runInNewContext(readFileSync(path.join(here, 'core/signup.js'), 'utf8'), signupContext);
const Signup = signupContext.window.WB.signup;
const JOIN_INDEX = path.join(JOIN_DIR, 'projects.json');
const JOIN_BODY_LIMIT = 8_192;
const JOIN_RECEIPT_LIMIT = 1_500;
const JOIN_SCHEMA_LIMIT = 3_000;
const JOIN_MAX_RECORDS = 20_000;
const JOIN_MAX_PER_MINUTE = 40;

const isLoopback = (address) => {
  const value = String(address || '');
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
};

/* 列出局域网地址时带上网卡名：虚拟网卡（VMware / Hyper-V / VirtualBox）也在里面，
   手机连不到它们，得让使用者自己认准 Wi-Fi 或以太网那张。 */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push({ name, address: item.address });
    }
  }
  return out;
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  // Buffer / 字符串按原样输出；只有普通对象才序列化为 JSON。
  // 否则 .json 静态文件（读出来是 Buffer）会被 JSON.stringify 成 {"type":"Buffer",...}。
  if (Buffer.isBuffer(data) || typeof data === 'string') return res.end(data);
  return res.end(JSON.stringify(data));
}

async function readJson(req, limit = 400_000) {
  const body = (await readBuffer(req, limit)).toString('utf8');
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('请求格式无效'), { status: 400 }); }
}

async function readBuffer(req, limit = 12_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error(`请求体过大（上限 ${Math.round(limit / 1024)} KB）`), { status: 413 });
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
  /* 自定义技能（工作台里导入、存在浏览器本地的技能包）不在 registry 里：由调用方把技能包
     正文放在 rules 带过来，只用于这一次调用，不写盘、不进 registry、用完即弃。 */
  const inline = skill.entry ? '' : String(body.rules || '').slice(0, 8_000).trim();
  if (!skill.entry && !inline) return send(res, 400, { error: `未注册的 skill：${skillId}（自定义技能需要在 rules 里带上技能包正文）` });
  if (skill.entry && !skill.ready) return send(res, 501, { error: `skill「${skill.entry.title}」尚未接入，请先在 skills/${skillId}/SKILL.md 中定义。` });
  if (!process.env.DEEPSEEK_API_KEY) return send(res, 503, { error: '尚未配置 DeepSeek API Key，请在仓库根目录 .env 中配置。' });

  const contract = String(body.contract || '').slice(0, 6000);
  const input = JSON.stringify(body.input ?? {}, null, 2).slice(0, 40_000);

  const system = [
    '你是校园活动的结构化策划助手，负责把零散输入整理成规范的结构化数据。',
    skill.entry ? skill.rules : inline,
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

/* ── 手机直传的存取（课堂演示够用的最小实现） ──
   projects.json 记「4 位短码 → 项目号 + 表单定义」；队列按项目一个 .jsonl，
   每行一条回执码——和工作台里粘贴回执码走同一套解析，所以天然幂等。 */
function joinIndex() {
  try { return JSON.parse(readFileSync(JOIN_INDEX, 'utf8')) || {}; } catch { return {}; }
}

function joinSaveIndex(table) {
  mkdirSync(JOIN_DIR, { recursive: true });
  writeFileSync(JOIN_INDEX, JSON.stringify(table));
}

function joinKey(projectId) {
  return String(projectId || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || 'default';
}

function joinQueueFile(projectId) {
  return path.join(JOIN_DIR, `${joinKey(projectId)}.jsonl`);
}

function joinEntries(projectId) {
  try {
    return readFileSync(joinQueueFile(projectId), 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      if (line.startsWith('{')) { try { return JSON.parse(line); } catch { return { receipt: '' }; } }
      return { receipt: line };
    });
  } catch { return []; }
}
function joinLines(projectId) { return joinEntries(projectId).map((entry) => entry.receipt); }
function joinEvents(projectId) { return joinEntries(projectId).map((entry) => entry.by ? { ...Signup.parseReceipt(entry.receipt), by: entry.by } : entry.receipt); }

/* 短码 → 项目号；没登记过的按项目号本身处理（工作台直接提交时用得上） */
function joinResolve(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 64 || !/^[A-Za-z0-9._-]+$/.test(key)) return null;
  const table = joinIndex();
  const row = Object.hasOwn(table, key) ? table[key] : null;
  return row ? { projectId: String(row.projectId || key), code: key } : { projectId: key, code: '' };
}

function joinMintCode(table) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const code = Math.random().toString(36).slice(2, 6);
    if (/^[a-z0-9]{4}$/.test(code) && !table[code]) return code;
  }
  return `s${Date.now().toString(36).slice(-4)}`;
}

/* 限流：同一来源一分钟内最多提交 JOIN_MAX_PER_MINUTE 条（内存里数着就够） */
const submitLog = new Map();
function submitAllowed(ip) {
  const now = Date.now();
  const list = (submitLog.get(ip) || []).filter((at) => now - at < 60_000);
  if (list.length >= JOIN_MAX_PER_MINUTE) { submitLog.set(ip, list); return false; }
  list.push(now);
  submitLog.set(ip, list);
  if (submitLog.size > 400) submitLog.clear();
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    /* 隧道（cloudflared）与反向代理会补上这几个头：请求虽然是 127.0.0.1 发来的，
       真正的访客却在公网——必须当成「非本机」处理，否则工作台页面和 AI 接口
       （里面是你的 API Key）会被隧道一起暴露出去。 */
    const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
    const remote = Boolean(forwarded) || !isLoopback(req.socket?.remoteAddress);
    const clientIp = forwarded || String(req.socket?.remoteAddress || '');
    const sharedId = String(url.pathname.match(/^\/api\/shared\/([A-Za-z0-9_-]+)$/)?.[1] || req.headers['x-project-id'] || '');
    const session = sharedId ? shared.auth(req, sharedId) : null;
    if (session?.role === 'viewer' && ['POST', 'PUT', 'DELETE'].includes(req.method) && !REMOTE_POST.has(url.pathname)) return send(res, 403, { error: '只读邀请不能执行写入操作。' });
    const appAsset = url.pathname === '/' || /^\/(?:index\.html|styles\.css|app\.js|schemas\.js|materials\.js)$/.test(url.pathname)
      || /^\/(?:core|views)\/[a-z][a-z0-9-]*\.js$/.test(url.pathname)
      || /^\/samples\/[^/]+\.(?:json|docx)$/.test(url.pathname);
    if (remote) {
      const allowed = req.method === 'GET' || req.method === 'HEAD'
        ? REMOTE_GET.has(url.pathname)
        : REMOTE_POST.has(url.pathname);
      const sharedApi = /^\/api\/shared\/[A-Za-z0-9_-]+$/.test(url.pathname);
      const memberApi = session && (req.method === 'GET' && ['/api/health', '/api/skills', '/api/signup/queue'].includes(url.pathname)
        || session.role !== 'viewer' && ['/api/structure', '/api/material', '/api/template', '/api/image', '/api/signup/link'].includes(url.pathname));
      if (!allowed && !(appAsset && ['GET', 'HEAD'].includes(req.method)) && !sharedApi && !memberApi && !(session && session.role !== 'viewer' && url.pathname === '/api/signup/manage' && req.method === 'POST')) {
        return send(res, 403, { error: '当前操作需要有效的项目邀请权限；报名填写请使用参与者或工作人员专用入口。' });
      }
    }

    if (url.pathname === '/api/shared') {
      if (remote || req.method !== 'POST') return send(res, 403, { error: '请在组织者本机开启项目共享。' });
      const body = await readJson(req, 20_000_000);
      if (!body.doc?.project || !Array.isArray(body.doc.wbs)) return send(res, 400, { error: '项目数据不完整。' });
      const result = shared.create(body.doc, body.projectId);
      return send(res, result.status || 201, result);
    }
    if (/^\/api\/shared\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      if (!session) return send(res, 403, { error: '共享邀请无效或已失效，请联系组织者。' });
      if (req.method === 'GET') return send(res, 200, shared.get(session));
      if (req.method === 'POST') {
        const result = shared.rotate(session);
        return send(res, result.status || 200, result);
      }
      if (req.method !== 'PUT') return send(res, 405, { error: '仅支持 GET / PUT / POST。' });
      const body = await readJson(req, 20_000_000);
      if (!body.doc?.project || !Array.isArray(body.doc.wbs)) return send(res, 400, { error: '项目数据不完整。' });
      const result = shared.update(session, body.revision, body.doc);
      return send(res, result.status || 200, result);
    }

    /* ── 参与者直传 ①：登记短码（只允许本机）──────
       短码只有 4 位，二维码里只带短码；表单定义存在这里，手机按码来取。 */
    if (url.pathname === '/api/signup/link') {
      if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST 请求' });
      const body = await readJson(req);
      const projectId = String(body.projectId || '');
      if (remote && projectId !== session?.row.id) return send(res, 403, { error: '不能修改其它项目的表单。' });
      const schema = String(body.schema || '');
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(projectId)) return send(res, 400, { error: '项目号不合法。' });
      if (!schema || schema.length > JOIN_SCHEMA_LIMIT || !Signup.unpackSchema(schema)) return send(res, 400, { error: '表单定义缺失或过长。' });
      const table = joinIndex();
      const role = body.role === 'staff' ? 'staff' : 'participant';
      const code = Object.keys(table).find((key) => table[key].projectId === projectId && (table[key].role || 'participant') === role);
      if (!code) {
        const fresh = joinMintCode(table);
        table[fresh] = { projectId, schema, role, enabled: body.enabled !== false, at: Date.now() };
        joinSaveIndex(table);
        return send(res, 200, { ok: true, code: fresh, projectId, bytes: schema.length });
      }
      if (table[code].schema !== schema || table[code].enabled !== (body.enabled !== false)) {
        table[code] = { ...table[code], schema, role, enabled: body.enabled !== false, at: Date.now() };
        joinSaveIndex(table);
        return send(res, 200, { ok: true, code, projectId, updated: true, bytes: schema.length });
      }
      return send(res, 200, { ok: true, code, projectId, reused: true, bytes: schema.length });
    }

    /* ② 手机按短码取表单定义（公网可访问） */
    if (url.pathname === '/api/signup/form') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '仅支持 GET 请求' });
      const code = String(url.searchParams.get('p') || '').trim();
      const table = joinIndex();
      const row = Object.hasOwn(table, code) ? table[code] : null;
      if (!row) return send(res, 404, { error: '这个短码没有登记：请联系组织者确认访问的是原服务与项目，并重新获取二维码。' });
      if (row.enabled === false) return send(res, 410, { error: '组织者已关闭信息收集。' });
      return send(res, 200, { ok: true, code, projectId: row.projectId, d: row.schema, role: row.role || 'participant' });
    }

    /* ③ 手机提交：一条回执码进来就落盘（公网可访问，带限流与总量上限） */
    if (url.pathname === '/api/signup/status') {
      if (req.method !== 'GET') return send(res, 405, { error: '仅支持 GET。' });
      const entry = joinResolve(url.searchParams.get('p')), id = String(url.searchParams.get('record') || '');
      if (!entry?.code || !/^[A-Za-z0-9._-]{1,100}$/.test(id)) return send(res, 404, { error: '未找到自己的回执。' });
      const definition = Signup.unpackSchema(joinIndex()[entry.code]?.schema), folded = Signup.fresh({ fields: definition?.fields });
      Signup.mergeEvents(folded, joinEvents(entry.projectId));
      const record = folded.records.find((item) => item.id === id);
      if (!record) return send(res, 404, { error: '这条记录尚未送达。' });
      return send(res, 200, { ok: true, attendance: record.attendance, checkinAt: record.checkinAt, checkoutAt: record.checkoutAt, role: record.role });
    }
    if (url.pathname === '/api/signup/manage') {
      if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST。' });
      const body = await readJson(req), projectId = String(body.projectId || '');
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(projectId) || remote && projectId !== session?.row.id) return send(res, 403, { error: '项目权限不足。' });
      const form = Object.values(joinIndex()).find((row) => row.projectId === projectId);
      if (!form) return send(res, 409, { error: '请先开启报名收集并登记表单。' });
      const definition = Signup.unpackSchema(body.schema || form.schema), record = body.record;
      if (!definition || !record || !/^[A-Za-z0-9._-]{1,100}$/.test(record.id) || !['checkin', 'checkout'].includes(body.kind) || !Array.isArray(body.values)) return send(res, 400, { error: '考勤数据不完整。' });
      const values = body.values.map(String), h = Signup.fingerprint(definition), role = record.role === 'staff' ? 'staff' : 'participant';
      const folded = Signup.fresh({ fields: definition.fields });
      Signup.mergeEvents(folded, joinEvents(projectId));
      const events = [];
      if (!folded.records.some((item) => item.id === record.id)) {
        events.push({ kind: 'submit', id: record.id, at: record.at || Date.now(), h, values, role });
        Signup.mergeEvents(folded, events);
      }
      const at = Date.now(), by = String(body.by || '管理者').slice(0, 60);
      if (!Signup.attend(folded, record.id, body.kind, at, by)) return send(res, 409, { error: '考勤状态已改变，请先同步最新记录。' });
      events.push({ kind: body.kind, id: record.id, at, h, role, by });
      mkdirSync(JOIN_DIR, { recursive: true });
      appendFileSync(joinQueueFile(projectId), events.map((event) => JSON.stringify({ receipt: Signup.packReceipt(event), by: event.by || by })).join('\n') + '\n');
      return send(res, 200, { ok: true, record: folded.records.find((item) => item.id === record.id) });
    }
    if (url.pathname === '/api/signup/submit') {
      if (req.method !== 'POST') return send(res, 405, { error: '仅支持 POST 请求' });
      const buffer = await readBuffer(req, JOIN_BODY_LIMIT);
      let body = null;
      try { body = JSON.parse(buffer.toString('utf8') || '{}'); }
      catch { return send(res, 400, { error: '提交内容不是 JSON。' }); }
      let receipt = String(body?.receipt || '').trim();
      if (!receipt.startsWith('R1|') || receipt.length > JOIN_RECEIPT_LIMIT) return send(res, 400, { error: '回执码格式不对。' });
      const entry = joinResolve(body?.p);
      if (!entry) return send(res, 400, { error: '短码无效：请重新扫码。' });
      /* 页面不知道自己是哪个项目时（老式链接 / 过期短码）会发 default：直接拒绝，
         免得记录落进工作台永远拉不到的桶里——让填写页退回回执码更靠谱 */
      if (entry.projectId === 'default') {
        console.log('⚠ 收到一条没有项目号的提交，已拒绝（让填写页改用回执码，或重新生成二维码）');
        return send(res, 400, { error: '这条提交没带项目号：请让组织者重新生成二维码，或把回执码发给他。' });
      }
      const form = entry.code ? joinIndex()[entry.code] : Object.values(joinIndex()).find((row) => row.projectId === entry.projectId && row.role !== 'staff');
      if (!form || (remote && !entry.code)) return send(res, 404, { error: '表单未登记，请重新扫码。' });
      if (form.enabled === false) return send(res, 410, { error: '组织者已关闭收集。' });
      const event = Signup.parseReceipt(receipt);
      if (!event || !/^[A-Za-z0-9._-]{1,100}$/.test(event.id) || event.kind === 'reset') return send(res, 400, { error: '回执内容不合法。' });
      if (!submitAllowed(`${clientIp}:${event.id}`)) return send(res, 429, { error: '这条记录提交太频繁，请过一分钟再试。' });
      const definition = Signup.unpackSchema(form.schema);
      if (event.h !== Signup.fingerprint(definition)) return send(res, 409, { error: '表单已经更新，请刷新页面后重新填写。' });
      const lines = joinLines(entry.projectId);
      const acknowledged = joinEntries(entry.projectId).find((entry) => entry.request === receipt);
      if (acknowledged) return send(res, 200, { ok: true, duplicate: true, total: lines.length, receipt: acknowledged.receipt });
      const requestReceipt = receipt;
      const prior = lines.map((line) => Signup.parseReceipt(line)).filter(Boolean);
      const existing = prior.find((item) => item.id === event.id && item.kind === 'submit');
      const role = form.role === 'staff' ? 'staff' : 'participant';
      if (existing && existing.role !== role) return send(res, 403, { error: '请使用对应身份的考勤入口。' });
      if (event.kind === 'submit') {
        if (event.values.length !== definition.fields.length) return send(res, 400, { error: '字段数量与表单不符。' });
        for (let i = 0; i < definition.fields.length; i++) {
          const field = definition.fields[i], value = String(event.values[i] || '').trim();
          if (field.required && !value || value && (field.type === 'phone' && !/^1\d{10}$/.test(value.replace(/[\s-]/g, '')) || field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || field.type === 'select' && !field.options.includes(value) || field.type === 'number' && !Number.isFinite(Number(value)))) return send(res, 422, { error: `请检查「${field.label}」。` });
        }
      } else if (!existing) return send(res, 409, { error: '请先完成报名提交，再签到或签退。' });
      const knownEvent = prior.find((item) => item.id === event.id && item.kind === event.kind && item.h === event.h && item.at === event.at && JSON.stringify(item.values) === JSON.stringify(event.values));
      if (knownEvent) return send(res, 200, { ok: true, duplicate: true, total: lines.length, receipt: Signup.packReceipt(knownEvent) });
      if (lines.length >= JOIN_MAX_RECORDS) return send(res, 429, { error: '该项目考勤流水已达上限，请联系组织者归档。' });
      if (event.kind !== 'submit') {
        const folded = Signup.fresh({ fields: definition.fields });
        Signup.mergeEvents(folded, joinEvents(entry.projectId));
        const record = folded.records.find((item) => item.id === event.id);
        const present = record && Signup.attendanceOf(record).present;
        if (event.kind === 'checkout' && !present) return send(res, 409, { error: '尚未签到或已经签退。' });
        if (event.kind === 'checkin' && present) return send(res, 200, { ok: true, duplicate: true, total: lines.length, receipt });
      }
      event.role = role;
      event.at = Date.now();
      receipt = Signup.packReceipt(event);
      const known = lines.includes(receipt);
      if (!known) {
        mkdirSync(JOIN_DIR, { recursive: true });
        appendFileSync(joinQueueFile(entry.projectId), `${JSON.stringify({ receipt, request: requestReceipt, by: '本人扫码' })}\n`);
      }
      return send(res, 200, { ok: true, project: entry.projectId, total: lines.length + (known ? 0 : 1), duplicate: known, receipt });
    }

    /* ④ 工作台拉增量（只允许本机） */
    if (url.pathname === '/api/signup/queue') {
      if (req.method !== 'GET') return send(res, 405, { error: '仅支持 GET 请求' });
      const projectId = String(url.searchParams.get('project') || '');
      if (remote && projectId !== session?.row.id) return send(res, 403, { error: '不能读取其它项目的报名数据。' });
      const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
      const entries = joinEntries(projectId);
      const lines = entries.map((entry) => entry.by ? { ...Signup.parseReceipt(entry.receipt), by: entry.by } : entry.receipt);
      const start = Math.min(Math.floor(since), lines.length);
      const records = lines.slice(start, start + 200);
      return send(res, 200, { ok: true, project: joinKey(projectId), total: lines.length, since: start, next: start + records.length, records });
    }
    /* ⑤ 服务自己的网络姿态（只允许本机）：工作台据此判断「这个二维码手机能不能扫」。
       带上网卡名，界面才能挑出 WLAN / 以太网那条，而不是把 VMware 的地址当成答案。 */
    if (url.pathname === '/api/net') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: '仅支持 GET 请求' });
      return send(res, 200, {
        ok: true,
        bind: host,
        port,
        lanOpen: !isLoopback(host),
        lan: lanAddresses().map((item) => ({ name: item.name, url: `http://${item.address}:${port}` }))
      });
    }
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

server.listen(port, host, () => {
  console.log(`Demo2 listening at http://127.0.0.1:${port}/`);
  const lan = lanAddresses().map((item) => `http://${item.address}:${port}/signup.html  (${item.name})`);
  if (isLoopback(host)) {
    console.log('模式：仅本机（默认，别的设备连不上）。');
    console.log('手机扫码填写 · 公网（推荐 cloudflared 隧道，另开一个窗口跑）：');
    console.log(`  cloudflared tunnel --url http://127.0.0.1:${port}`);
    console.log('  把打印出来的 https://xxx.trycloudflare.com 填进「参与者 → 访问地址」，再点「重新生成二维码」。');
    console.log('  匿名可填写报名；共享项目与管理接口需有效邀请。演示结束可 Ctrl+C 停止服务。');
    console.log('手机扫码填写 · 局域网：用 DEMO2_HOST=0.0.0.0 重启（做法见 README「扫码填写怎么开」），例如：');
    console.log("  PowerShell:  $env:DEMO2_HOST='0.0.0.0'; node workbench/demo2/server.mjs");
    if (lan.length) for (const line of lan) console.log(`  届时填写页地址：${line}`);
    else console.log('  未检测到局域网地址：请先连上 Wi-Fi / 手机热点。');
    return;
  }
  console.log(`⚠ 已对局域网开放（${host}）：匿名可填写报名；共享项目与管理接口按邀请权限开放。`);
  if (lan.length) for (const line of lan) console.log(`手机扫码填写页：${line}`);
  else console.log('未检测到局域网地址：请先连上 Wi-Fi / 热点。');
  console.log('用完请 Ctrl+C 停掉，并删除防火墙放行规则（README「扫码填写怎么开」里有命令）。');
});
