#!/usr/bin/env node
/* 静态托管打包：把「发布要用的文件」挑出来拷进 dist/，顺手挡住不该出门的东西。
 * 用法：
 *   node tools/pack-static.mjs                 生成 dist/（默认）
 *   node tools/pack-static.mjs --out 目录      换个输出目录
 *   node tools/pack-static.mjs --with-skills   连 skills/ 一起带上（可选，静态托管下界面用不到）
 *   node tools/pack-static.mjs --dry-run       只看清单，不写任何文件
 *   node tools/pack-static.mjs --help          看这段话
 * 特点：只用 Node 内置模块，不联网、不装依赖；产物不含 .env / server.mjs / tools / docs；
 *       拷完会回头核对 index.html、signup.html 与脚本里的相对引用是不是一个都不少，并要求产物与清单完全一致（多一个旧文件都算失败）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/* 发布清单：逐个写出来，不用通配符扫目录——宁可多写几行，也不要误把别的东西带出去。 */
const CORE = ['util', 'deliveries', 'task-lifecycle', 'library', 'personnel', 'inventory', 'qr', 'signup', 'store', 'sync', 'skills', 'risk', 'wbs', 'guide', 'drills', 'ai', 'interview', 'markdown', 'ooxml', 'docx', 'export'];
const VIEWS = ['projects', 'overview', 'manifest', 'agenda', 'tasks', 'decision', 'risk', 'resources', 'drills', 'material', 'workflow', 'assets', 'signup', 'help'];
const PAGES = [
  'index.html', 'signup.html', 'staff.html', 'styles.css', 'app.js', 'schemas.js', 'materials.js',
  ...CORE.map((name) => `core/${name}.js`),
  ...VIEWS.map((name) => `views/${name}.js`),
  'samples/示例项目-校园科技文化节.json',
  'samples/示例-学院活动策划书模板.docx',
  'samples/知识与素材示例.json',
  'samples/library/活动宣传示例.svg',
  'samples/library/场地分区示例.svg'
];

/* 这些一律不许出现在产物里（.env 在仓库根，不属于 demo2，这里仍然拦一道）。 */
const FORBIDDEN = ['.env', 'server.mjs', 'tools/', 'docs/', 'generated/', 'package', 'node_modules', '.git'];
/* 输出目录落在这些子目录里等于覆盖源码，直接拒绝。 */
const SOURCE_DIRS = ['core', 'views', 'samples', 'skills', 'tools', 'docs', 'server'];

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name) || (name === '--help' && argv.includes('-h'));
const valueOf = (name) => {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) die(`${name} 后面要跟一个目录，例如 --out dist`);
  return value;
};

if (has('--help')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, '').trim());
  process.exit(0);
}

function filesUnder(absDir, base = root) {
  const out = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

/* 清空旧产物：文件 unlink、子目录递归后 rmdir。
   这里刻意不用带 recursive 的整项删除 —— 个别受限环境会静默删不掉甚至直接终止进程，
   删完还有一道「产物必须与清单完全一致」的复查兜底。 */
function clearDir(dir, depth = 0) {
  if (depth > 16) die(`输出目录嵌套太深，先手动清空再试：${dir}`);
  for (const entry of fs.readdirSync(dir)) {
    const target = path.resolve(dir, entry);
    if (!target.startsWith(dir + path.sep)) die(`拒绝删除输出目录之外的东西：${target}`);
    if (fs.lstatSync(target).isDirectory()) {
      clearDir(target, depth + 1);
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
  }
}

function bannedWord(rel) {
  const lower = rel.toLowerCase();
  return FORBIDDEN.find((word) => lower.includes(word.toLowerCase())) || null;
}

/* ── 1. 定清单 ─────────────────────────────── */
const manifest = [...PAGES];
if (has('--with-skills')) manifest.push(...filesUnder(path.join(root, 'skills')));
const unique = [...new Set(manifest)];
if (unique.length !== manifest.length) die('发布清单里有重复项，请检查 PAGES 与 --with-skills');

const banned = manifest.filter((rel) => bannedWord(rel));
if (banned.length) die(`清单里有不该发布的文件：${banned.join('、')}`);
const missing = manifest.filter((rel) => !fs.existsSync(path.join(root, rel)));
if (missing.length) die(`清单里的文件不存在（是不是改名或挪走了？）：${missing.join('、')}`);

/* ── 2. 定输出目录（只允许删自己产物，不许碰源码）── */
const outDir = path.resolve(root, valueOf('--out') || 'dist');
const inside = path.relative(root, outDir);
const isOutside = inside.startsWith('..') || path.isAbsolute(inside);
if (inside === '') die('输出目录不能就是 demo2 本身，那样会把源码覆盖掉');
if (isOutside && root.startsWith(outDir + path.sep)) die(`输出目录不能是 demo2 的上级目录：${outDir}`);
if (!isOutside && SOURCE_DIRS.includes(inside.split(path.sep)[0])) {
  die(`输出目录不要放在 ${inside.split(path.sep)[0]}/ 里，换一个名字（比如 dist）`);
}

const readme = [
  `发布清单：${manifest.length} 个文件`,
  ...manifest.map((rel) => `  ${rel}`),
  `输出目录：${outDir}`
].join('\n');

/* ── 3. 干跑模式：只说不动 ─────────────────── */
if (has('--dry-run')) {
  console.log(readme);
  console.log('（--dry-run：没有写入任何文件）');
  process.exit(0);
}

/* ── 4. 清空旧产物再拷 ─────────────────────── */
try {
  fs.mkdirSync(outDir, { recursive: true });
  clearDir(outDir);
} catch (error) {
  die(`清空输出目录失败：${error.message}（先手动清空 ${outDir} 再试）`);
}

let bytes = 0;
try {
  for (const rel of manifest) {
    const to = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, rel), to);
    bytes += fs.statSync(to).size;
  }
} catch (error) {
  die(`写产物失败：${error.message}`);
}

/* ── 5. 复查：引用一个都不能少 ──────────────── */
const refsIn = (relFile, pattern) => [...fs.readFileSync(path.join(outDir, relFile), 'utf8').matchAll(pattern)].map((match) => match[1]);
const htmlRefs = [
  ...refsIn('index.html', /(?:src|href)="\.\/([^"]+)"/g),
  ...refsIn('signup.html', /(?:src|href)="\.\/([^"]+)"/g)
];
const jsRefs = manifest
  .filter((rel) => rel.endsWith('.js'))
  .flatMap((rel) => refsIn(rel, /fetch\(\s*[`'"](\.\/[^`'"]+)/g));
const refs = [...new Set([...htmlRefs, ...jsRefs])];
const brokenRefs = refs.filter((ref) => !fs.existsSync(path.join(outDir, ref)));

const inOut = filesUnder(outDir, outDir);
const leaked = inOut.filter((rel) => bannedWord(rel));
const extras = inOut.filter((rel) => !manifest.includes(rel));
const totalKb = (bytes / 1024).toFixed(1);

console.log(readme);
console.log('');
console.log(`✓ 共 ${manifest.length} 个文件 / ${totalKb} KB`);
console.log(brokenRefs.length === 0
  ? `✓ index.html、signup.html 与脚本里的 ${refs.length} 个相对引用，产物里都在`
  : `✗ 这些引用在产物里找不到：${brokenRefs.join('、')}`);
console.log(leaked.length === 0 ? '✓ 不含 .env、server.mjs、tools/、docs/' : `✗ 产物里混进了禁品：${leaked.join('、')}`);
console.log(extras.length === 0
  ? `✓ 产物里 ${inOut.length} 个文件与清单完全一致，没有多余文件`
  : `✗ 产物里混进了清单之外的文件（旧产物没清干净？）：${extras.join('、')}`);
console.log('');
console.log(`dist 已就绪：${outDir}`);
console.log('把上面这个文件夹里的内容整个上传到静态托管（Cloudflare Pages / GitHub Pages）即可；');
console.log('改了源码就再跑一次本命令，重新上传一次。');
if (brokenRefs.length || leaked.length || extras.length) process.exit(1);
