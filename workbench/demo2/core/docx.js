/* 参考件解析：把 Word（.docx）/ Markdown / 纯文本读成「栏目 + 字段 + 原文」。
 *
 * 用途：过程材料卡片的「上传参考」——用户上传往届申报表或学校样表后，
 *   1) 生成时把参考的栏目结构与字段清单一并喂给 AI，要求结构与口径逐条对齐；
 *   2) 生成后拿参考的栏目 / 字段与产出做覆盖核对，缺哪项看得见。
 *
 * 纯前端：ZIP 中央目录自己解，deflate 条目用浏览器自带的
 * DecompressionStream('deflate-raw') 解压，因此不需要新增服务端接口，
 * 也不依赖 API Key，离线场景同样可用。
 */
window.WB = window.WB || {};

(function () {
  /* 参考件只保留前 10000 字：本地存档与提示词都吃得下，且足够覆盖表单结构 */
  const MAX_CHARS = 10000;
  const decoder = new TextDecoder('utf-8');

  /* ── Word 文本还原 ─────────────────────── */

  function decodeXml(text) {
    return String(text)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&amp;/g, '&');
  }

  /* 取一个段落里的可见文字；制表符与软换行统一成空格，保证表格单元格不换行 */
  function paragraphText(xml) {
    let out = '';
    for (const match of String(xml).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
      if (match[1] != null) out += decodeXml(match[1]);
      else out += ' ';
    }
    return out.replace(/[ \t\u3000]+/g, ' ').trim();
  }

  /* 一个单元格常有多段，按段落拼成一行 */
  const cellText = (xml) => String(xml).split(/<\/w:p>/)
    .map(paragraphText).filter(Boolean).join(' ');

  function styleLevel(style) {
    if (!style) return 0;
    const value = String(style).toLowerCase().replace(/\s+/g, '');
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
    for (const rule of HEADING_RULES) if (rule.re.test(text)) return rule.level;
    return 0;
  }

  const cjkCount = (value) => (String(value).match(/[\u4e00-\u9fff]/g) || []).length;

  /* 无标题样式时的兜底判断。表单里混着大量「0.748元/张」「44.88」这类数值行，
     以及「1.负责人须…。」这类说明句，都按标题过滤掉，只留真正的栏目标题。 */
  function looksLikeHeading(text) {
    const value = String(text || '');
    if (!value || value.length > 24) return false;
    if (/[：:]/.test(value) || /。$/.test(value)) return false;
    const level = textLevel(value);
    if (level === 0) return false;
    /* 「1.1 小节」要有空格隔开才算标题，否则是 0.748 这种小数 */
    if (/^\d+\.\d/.test(value) && !/^\d+\.\d+\s+\S/.test(value)) return false;
    return cjkCount(value.replace(/^[第（(]?[一二三四五六七八九十百\d）).．、\s]+/, '')) >= 3;
  }

  /* ── 文档对象 → 块序列（段落与表格保持原顺序） ── */

  function docxBlocks(xml) {
    const blocks = [];
    const pattern = /<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)|<w:tbl>[\s\S]*?<\/w:tbl>/g;
    for (const match of String(xml).matchAll(pattern)) {
      const chunk = match[0];
      if (chunk.startsWith('<w:tbl')) {
        const rows = tableRows(chunk);
        if (rows.length) blocks.push({ type: 'table', rows });
        continue;
      }
      const style = (chunk.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
      const text = paragraphText(chunk);
      if (text) blocks.push({ type: 'paragraph', text, level: styleLevel(style) });
    }
    return blocks;
  }

  function tableRows(chunk) {
    const rows = [];
    for (const rowChunk of String(chunk).split(/<w:tr(?:\s[^>]*)?>/).slice(1)) {
      const body = rowChunk.split(/<\/w:tr>/)[0];
      const cells = [...body.matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)].map((cell) => cellText(cell[1]));
      if (cells.some(Boolean)) rows.push(cells);
    }
    return rows;
  }

  /* ── Markdown / 纯文本 → 块序列 ─────────── */

  const rowCells = (line) => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const isDivider = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));

  function textBlocks(source) {
    const blocks = [];
    let table = null;
    const flush = () => { if (table && table.rows.length) blocks.push({ type: 'table', rows: table.rows }); table = null; };
    for (const raw of String(source).split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (/^\s*\|/.test(line)) {
        const cells = rowCells(line);
        if (isDivider(cells)) continue;
        if (!table) table = { rows: [] };
        table.rows.push(cells);
        continue;
      }
      flush();
      const text = line.trim();
      if (!text) continue;
      const hashed = text.match(/^(#{1,6})\s+(.+)$/);
      if (hashed) { blocks.push({ type: 'paragraph', text: hashed[2].trim(), level: hashed[1].length }); continue; }
      const bullet = text.replace(/^[-*]\s+/, '');
      blocks.push({ type: 'paragraph', text: bullet, level: looksLikeHeading(bullet) ? textLevel(bullet) : 0 });
    }
    flush();
    return blocks;
  }

  /* ── 栏目 / 字段 / 原文 ─────────────────── */

  /* 1) 段落标题：带标题样式的优先，不足时按编号兜底 */
  function paragraphOutline(blocks) {
    const paragraphs = blocks.filter((block) => block.type === 'paragraph');
    const styled = paragraphs.filter((block) => block.level > 0 && block.level <= 4)
      .map((block) => ({ level: block.level, heading: block.text }));
    if (styled.length >= 3) return styled;
    const heuristic = paragraphs.filter((block) => looksLikeHeading(block.text))
      .map((block) => ({ level: textLevel(block.text), heading: block.text }));
    if (heuristic.length >= 2) return heuristic;
    return styled.length ? styled : heuristic;
  }

  const strip = (value) => String(value || '').replace(/[\s\u3000]+/g, '');

  /* 2) 表格里的栏目行：「一、活动基本信息」这种整行小标题 */
  function isColumnLabel(cell) {
    const value = strip(cell);
    if (value.length < 2 || value.length > 24) return false;
    if (/[：:]/.test(value) || /。$/.test(value)) return false;
    return looksLikeHeading(value);
  }

  /* 表单每行第一个像标签的格子：先跳过序号列，再看第 3、4 列（「… | 联系方式 | 电话」） */
  function labelCells(row) {
    const first = row.findIndex((cell) => cjkCount(cell) >= 2);
    const picks = [];
    for (const index of [first, 2, 3]) {
      if (index >= 0 && index < row.length && !picks.includes(index)) picks.push(index);
    }
    return picks.map((index) => row[index]);
  }

  /* 参考的栏目表：段落标题与表格栏目行合并，按在文档里出现的先后排序 */
  function referenceOutline(blocks) {
    const paragraph = paragraphOutline(blocks);
    const levelOf = new Map(paragraph.map((item) => [norm(item.heading), item.level]));
    const seen = new Set();
    const out = [];
    const push = (label, level) => {
      const text = strip(label);
      const key = norm(text);
      if (key.length < 2 || seen.has(key)) return;
      seen.add(key);
      out.push({ level: Math.min(Math.max(level || 1, 1), 4), heading: text });
    };
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        const level = levelOf.get(norm(block.text));
        if (level) push(block.text, level);
        continue;
      }
      for (const row of block.rows) {
        for (const cell of labelCells(row)) if (isColumnLabel(cell)) push(cell, 1);
      }
    }
    return out;
  }

  /* 3) 字段名：靠常见词尾识别（「活动时间」「负责人姓名」「联系方式」…），
        避免把「投壶竞技」这类环节名当成必填项 */
  const FIELD_SUFFIX = /(名称|类别|类型|时间|地点|对象|人数|单位|数量|金额|预算|费用|经费|来源|方式|形式|内容|目的|要求|说明|备注|负责人|联系人|联系方式|电话|姓名|职务|岗位|分工|职责|范围|期限|频次|口径|标准|规则|清单|编号|文号)$/;

  function fieldLabels(blocks, sections) {
    const taken = new Set(sections.map((item) => norm(item.heading)));
    const seen = new Set();
    const out = [];
    for (const block of blocks) {
      if (block.type !== 'table') continue;
      for (const row of block.rows) {
        for (const cell of labelCells(row)) {
          const value = strip(cell);
          if (value.length < 2 || value.length > 14) continue;
          if (!cjkCount(value) || /[：:]/.test(value) || /。$/.test(value)) continue;
          if (!FIELD_SUFFIX.test(value)) continue;
          const key = norm(value);
          if (key.length < 2 || seen.has(key) || taken.has(key)) continue;
          seen.add(key);
          out.push(value);
        }
      }
    }
    return out;
  }

  function renderText(blocks) {
    const lines = [];
    for (const block of blocks) {
      if (block.type === 'table') {
        const [header, ...rows] = block.rows;
        const width = Math.max(...block.rows.map((row) => row.length));
        const pad = (row) => Array.from({ length: width }, (_, index) => row[index] ?? '');
        lines.push(`| ${pad(header).join(' | ')} |`);
        lines.push(`| ${pad(header).map(() => '---').join(' | ')} |`);
        for (const row of rows) lines.push(`| ${pad(row).join(' | ')} |`);
        lines.push('');
        continue;
      }
      const level = block.level > 0 && block.level <= 6 ? block.level
        : (looksLikeHeading(block.text) ? Math.min(textLevel(block.text), 6) : 0);
      lines.push(level ? `${'#'.repeat(level)} ${block.text}` : block.text);
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function summarise(blocks) {
    const sections = referenceOutline(blocks);
    const fields = fieldLabels(blocks, sections);
    const tables = blocks.filter((block) => block.type === 'table' && block.rows.length)
      .map((block) => ({ headers: block.rows[0].slice(0, 12).filter((cell) => cell !== '') }));
    const full = renderText(blocks);
    const truncated = full.length > MAX_CHARS;
    return { sections, fields, tables, chars: full.length, truncated, text: truncated ? full.slice(0, MAX_CHARS) : full };
  }

  const parseDocumentXml = (xml) => summarise(docxBlocks(String(xml)));
  const parseText = (source) => summarise(textBlocks(String(source)));

  /* ── ZIP：只取需要的那个条目 ────────────── */

  function findEntry(bytes, target) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 66_000);
    for (let i = bytes.length - 22; i >= floor; i -= 1) {
      if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i += 1) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014B50) return null;
      const method = view.getUint16(pos + 10, true);
      const compressedSize = view.getUint32(pos + 20, true);
      const nameLength = view.getUint16(pos + 28, true);
      const extraLength = view.getUint16(pos + 30, true);
      const commentLength = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)).replace(/\\/g, '/');
      if (name === target) {
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        return { method, data: bytes.subarray(start, start + compressedSize) };
      }
      pos += 46 + nameLength + extraLength + commentLength;
    }
    return null;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持解压 .docx，请改用 .md / .txt 参考件。');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function inflateEntry(bytes, target) {
    const entry = findEntry(bytes, target);
    if (!entry) return null;
    if (entry.method === 0) return entry.data;
    if (entry.method === 8) return inflateRaw(entry.data);
    throw new Error('这个 Word 文件用了不支持的压缩方式，请另存为 .docx 再传。');
  }

  /* ── 原表填充：把参考件当成一份要填的表，只替换值，不动结构 ──
     导出结果就是参考文件本体——表格怎么画、栏目叫什么、分几个部分、条目数量、缩进、
     页眉页脚、图片全部原样，只有被识别成「值」的那段文字被换成本项目的内容。
     做法：整包读进来（丢掉几百 KB 的嵌入字体），只重写 word/document.xml 里相关
     <w:t> 的文本，其余部件按原始压缩字节照搬，method / crc / size 都沿用。 */

  const PACKAGE_BUDGET = 900 * 1024;
  const PACKAGE_ENTRY_MAX = 8 * 1024 * 1024;
  const FILL_MAX_SLOTS = 240;
  const FIELD_LEN_MAX = 20;
  const TEXT_LEN_MAX = 60;
  const FONT_PART = /^word\/fonts\//i;

  const base64ToBytes = (text) => {
    const binary = atob(String(text || ''));
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
  };

  const escapeXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    /* 去掉 XML 1.0 不接受的制表控制字符，避免 Word 报「文件已损坏」 */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const clip = (value, max) => (value.length > max ? value.slice(0, max - 1) + '…' : value);
  const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* 中央目录 → 全部条目（压缩方式 / CRC / 压缩后大小 / 本地头偏移），供整包读取与重打包 */
  function listEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 66_000);
    for (let i = bytes.length - 22; i >= floor; i -= 1) {
      if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) return [];
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014B50) break;
      const nameLength = view.getUint16(pos + 28, true);
      const extraLength = view.getUint16(pos + 30, true);
      const commentLength = view.getUint16(pos + 32, true);
      out.push({
        name: decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)).replace(/\\/g, '/'),
        method: view.getUint16(pos + 10, true),
        crc: view.getUint32(pos + 16, true),
        compressed: view.getUint32(pos + 20, true),
        size: view.getUint32(pos + 24, true),
        offset: view.getUint32(pos + 42, true)
      });
      pos += 46 + nameLength + extraLength + commentLength;
    }
    return out;
  }

  /* 某个条目的原始（压缩态）字节：本地头的名称与扩展字段长度只有本地头里才有 */
  function entryBytes(bytes, item) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (item.offset + 30 > bytes.length) return null;
    const nameLength = view.getUint16(item.offset + 26, true);
    const extraLength = view.getUint16(item.offset + 28, true);
    const start = item.offset + 30 + nameLength + extraLength;
    if (start + item.compressed > bytes.length) return null;
    return bytes.subarray(start, start + item.compressed);
  }

  /* 整包读进来：每个部件只留「原始压缩字节 + base64 + CRC + 大小」，不再解压。
     嵌入字体（word/fonts/*.odttf，动辄几百 KB）直接丢掉——Word 会用系统里的同名字体；
     超预算的部件也丢掉，并记进 dropped，重打包时把悬空的关系与 Content Types 清掉。 */
  async function readPackage(bytes, { budget = PACKAGE_BUDGET } = {}) {
    const entries = [];
    const dropped = [];
    let used = 0;
    for (const item of listEntries(bytes)) {
      if (FONT_PART.test(item.name)) { dropped.push({ name: item.name, reason: '嵌入字体' }); continue; }
      const raw = entryBytes(bytes, item);
      if (!raw) { dropped.push({ name: item.name, reason: '读不到部件' }); continue; }
      const b64 = bytesToBase64(raw);
      if (used + b64.length > budget) { dropped.push({ name: item.name, reason: '超出本地存档预算' }); continue; }
      used += b64.length;
      entries.push({ name: item.name, method: item.method, crc: item.crc, size: item.size, b64 });
    }
    if (!entries.some((entry) => entry.name === 'word/document.xml')) return null;
    return { entries, dropped, bytes: used };
  }

  /* 从存档包里取出参考的正文 XML：导出时就是在这上面改值 */
  async function documentXmlOf(pkg) {
    const entry = (pkg?.entries || []).find((item) => item.name === 'word/document.xml');
    if (!entry) return '';
    const raw = base64ToBytes(entry.b64);
    return decoder.decode(entry.method === 0 ? raw : await inflateRaw(raw));
  }

  /* ── 结构扫描：把正文拆成「块 / 行 / 格」，这些是照抄的部分 ── */

  const T_RUN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const T_ANY = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;

  /* 深度感知的标签扫描：只返回最外层的 <w:tag>…</w:tag>（含自闭合）。
     参考件常把整张表放进一格，嵌套表格用非贪心正则会被内层 </w:tbl> 截断，所以自己数层次 */
  function outerRanges(xml, tag) {
    const re = new RegExp('<(\\/?)w:' + tag + '\\b[^>]*?(\\/?)>', 'g');
    const out = [];
    let depth = 0;
    let start = -1;
    let match;
    while ((match = re.exec(xml))) {
      const closing = match[1] === '/';
      const selfClosed = match[2] === '/';
      if (selfClosed) {
        if (!closing && !depth) out.push({ start: match.index, end: match.index + match[0].length });
        continue;
      }
      if (!closing) {
        if (!depth) start = match.index;
        depth += 1;
        continue;
      }
      depth -= 1;
      if (depth <= 0) {
        if (start >= 0) out.push({ start, end: match.index + match[0].length });
        start = -1;
        depth = 0;
      }
    }
    return out;
  }

  /* 顶层块：段落与表格按文档顺序，表格内部的段落归它所属的表格 */
  function blockRanges(xml) {
    const re = /<(\/?)w:(p|tbl)\b[^>]*?(\/?)>/g;
    const out = [];
    const stack = [];
    let match;
    while ((match = re.exec(xml))) {
      const closing = match[1] === '/';
      const tag = match[2];
      const selfClosed = match[3] === '/';
      if (selfClosed && !closing) {
        if (!stack.length) out.push({ tag, start: match.index, end: match.index + match[0].length });
        continue;
      }
      if (!closing) {
        if (!stack.length) out.push({ tag, start: match.index, end: -1 });
        stack.push(tag);
        continue;
      }
      const open = stack.lastIndexOf(tag);
      if (open < 0) continue;
      stack.length = open;
      if (!stack.length) {
        const range = out[out.length - 1];
        if (range && range.end < 0) range.end = match.index + match[0].length;
      }
    }
    return out.filter((range) => range.end > range.start);
  }

  /* 一个块里所有 <w:t> 的内文区间；填值时写第一个、清掉其余 */
  function textRanges(chunk, base) {
    const ranges = [];
    for (const match of String(chunk).matchAll(T_RUN)) {
      const open = match[0].indexOf('>') + 1;
      const start = base + match.index + open;
      ranges.push({ start, end: start + match[1].length });
    }
    return ranges;
  }

  /* 从第 prefix 个字符往后算的区间：段首「活动名称：」这类前缀留在原处，只换后半截。
     limit 是「到此为止」的绝对偏移：格子里嵌了子表时，值只算到子表之前，免得把子表结构清掉 */
  function tailRanges(chunk, base, prefix, limit) {
    const all = textRanges(chunk, base);
    const out = [];
    let at = 0;
    for (const range of all) {
      const length = range.end - range.start;
      if (at + length <= prefix) { at += length; continue; }
      out.push({ start: range.start + Math.max(0, prefix - at), end: range.end });
      at += length;
    }
    if (limit == null) return out;
    return out.filter((range) => range.start < limit)
      .map((range) => (range.end > limit ? { start: range.start, end: limit } : range));
  }

  /* 格子里第一张子表的位置（没有就返回 null）：值的范围到此为止 */
  function nestedLimit(chunk, base) {
    const match = /<w:tbl[ >]/.exec(String(chunk));
    return match ? base + match.index : null;
  }

  /* 格子的可见文字：有子表就把子表排除在外（子表是结构，不是值） */
  function cellRawText(chunk, base, limit) {
    return blockText(limit == null ? chunk : chunk.slice(0, limit - base), true);
  }

  /* 段末插入点：往最后一个段落收尾前塞一个 run；只有空段落时就地展开（保留 pPr 等属性） */
  function tailAnchor(chunk, base) {
    const close = chunk.lastIndexOf('</w:p>');
    if (close >= 0) return { at: base + close };
    const empty = [...String(chunk).matchAll(/<w:p(?:\s[^>]*)?\/>/g)].pop();
    if (empty) {
      const start = base + empty.index;
      return { replace: { start, end: start + empty[0].length, text: empty[0].replace(/\/>$/, '>') } };
    }
    return null;
  }

  /* 块里的可见文字。返回两套：raw 用于把前缀长度换算成 <w:t> 偏移，flat 用于匹配与展示 */
  function blockText(chunk, raw = false) {
    let out = '';
    for (const match of String(chunk).matchAll(T_ANY)) {
      if (match[1] != null) out += raw ? decodeXml(match[1]) : match[1];
      else out += ' ';
    }
    return raw ? out : decodeXml(out).replace(/[ \t\u3000]+/g, ' ').trim();
  }

  /* 格内按段落切开：首段是「（一）活动背景」这类小标题时，值从第二段起。
     prefix 是「首段文字」在整格 <w:t> 串里的字符数，用来把结构留在原处、只换后面的值 */
  function cellLead(chunk) {
    const paragraphs = outerRanges(chunk, 'p').map((range) => {
      const part = chunk.slice(range.start, range.end);
      return { text: paragraphText(part), chars: blockText(part, true).length };
    }).filter((item) => item.text);
    if (paragraphs.length < 2) return null;
    const head = paragraphs[0];
    if (head.text.length > 24 || !looksLikeHeading(head.text)) return null;
    return { label: strip(head.text), prefix: head.chars };
  }

  /* ── 空位（slot）：哪些文字算「值」要换掉，哪些算结构照抄 ── */

  /* 字段名判定：短、带中文、不以句号结尾，且词尾落在常见字段上（与参考件解析同一套口径） */
  function isFieldLabel(value) {
    const text = strip(value);
    if (text.length < 2 || text.length > 14) return false;
    if (/[。；;]/.test(text)) return false;
    if (!cjkCount(text)) return false;
    return FIELD_SUFFIX.test(text) || /[：:]$/.test(text);
  }

  /* 填表说明里的「2.字体要求：」「（1）表格中填写部分：」不是字段，排掉 */
  const NOTE_LABEL = /(说明|要求|提示|须知|事宜|事项|部分|内容|如下|以下)$/;

  /* 段首「活动名称：xxx」：冒号前是字段名（去掉「1.」「（2）」这类序号）才算 */
  function labelSplit(text) {
    const value = String(text || '');
    const colon = value.match(/^([^：:。，,；;]{2,16})[：:]\s*/);
    if (!colon) return null;
    const label = colon[1].replace(/^[（(]?\d{1,2}[)）.、．]/, '').trim();
    const short = cjkCount(label) >= 2 && label.length <= 8 && !NOTE_LABEL.test(label);
    if (!isFieldLabel(label) && !short) return null;
    return { label, prefix: colon[0].length };
  }

  /* 把参考正文拆成「结构 + 空位」，三种空位：
       field = 表格式的字段值（含「活动名称：xxx」这种段首字段）
       text  = 带小标题的正文段（（一）活动背景 + 正文）
       cell  = 表格数据行里的普通格子（按表头列名标注） */
  function fillSlots(documentXml) {
    const xml = String(documentXml || '');
    const slots = [];
    const headings = [];
    const stack = [];
    const where = () => stack[stack.length - 1] || '';
    let index = 0;

    const pushHeading = (text, level) => {
      const value = strip(text);
      if (!value) return;
      const at = Math.min(Math.max(level || 1, 1), 4);
      stack.length = Math.min(stack.length, at - 1);
      stack[at - 1] = value;
      headings.push(value);
    };

    const addSlot = (kind, label, ref, ranges, anchor) => {
      if (slots.length >= FILL_MAX_SLOTS) return;
      const text = squash(ref);
      if (kind !== 'field' && !text) return;
      index += 1;
      slots.push({
        id: (kind === 'field' ? 'f' : kind === 'cell' ? 'c' : 't') + index,
        kind,
        where: where(),
        label: squash(label),
        now: clip(text, 60),
        max: kind === 'cell' ? TEXT_LEN_MAX : kind === 'field' ? FIELD_LEN_MAX : TEXT_LEN_MAX * 2,
        ranges,
        anchor: anchor || null
      });
    };

    /* 一格/一段的内容：先看是不是「字段：值」，再看是不是「小标题 + 正文」 */
    const addContent = (fallbackKind, fallbackLabel, text, chunk, base, head, limit) => {
      if (head) {
        const ranges = tailRanges(chunk, base, head.prefix, limit);
        addSlot('text', head.label, text.slice(head.prefix), ranges, ranges.length ? null : tailAnchor(chunk, base));
        return;
      }
      const split = labelSplit(text);
      if (split) {
        const ranges = tailRanges(chunk, base, split.prefix, limit);
        addSlot('field', split.label, text.slice(split.prefix), ranges, ranges.length ? null : tailAnchor(chunk, base));
        return;
      }
      addSlot(fallbackKind, fallbackLabel, text, tailRanges(chunk, base, 0, limit), null);
    };

    for (const block of blockRanges(xml)) {
      const chunk = xml.slice(block.start, block.end);
      const base = block.start;

      if (block.tag !== 'tbl') {
        const text = blockText(chunk);
        const style = (chunk.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
        const level = styleLevel(style) || (looksLikeHeading(text) ? textLevel(text) : 0);
        if (level) { pushHeading(text, level); continue; }
        if (!text) continue;
        addContent('text', where(), blockText(chunk, true), chunk, base, null);
        continue;
      }

      /* 表格：逐行逐格。整行都是字段词 = 表头行，随后的数据行按列名标注 */
      let headers = [];
      for (const row of outerRanges(chunk, 'tr')) {
        const rowChunk = chunk.slice(row.start, row.end);
        const rowBase = base + row.start;
        const cells = outerRanges(rowChunk, 'tc').map((cell) => ({
          text: cellText(rowChunk.slice(cell.start, cell.end)),
          chunk: rowChunk.slice(cell.start, cell.end),
          base: rowBase + cell.start
        }));
        if (!cells.length || !cells.some((cell) => cell.text)) continue;

        if (cells.length === 1) {
          const cell = cells[0];
          /* 「（一）活动背景 + 正文」这种整格内容优先按内容处理，别被短标题规则吞成栏目 */
          const head = cellLead(cell.chunk);
          if (!head && isColumnLabel(cell.text)) { pushHeading(cell.text, 1); headers = []; continue; }
          const limit = nestedLimit(cell.chunk, cell.base);
          addContent('text', where(), cellRawText(cell.chunk, cell.base, limit), cell.chunk, cell.base, head, limit);
          continue;
        }

        /* 表头行：三格以上、没有数字、每格都是字段名或很短（「序号 / 物品名称 / 规格 / 数量 / 单价 / 总价（元）」）。
           两格的表格行一律按「标签 + 值」处理，否则「活动地点 | 旧地点」会被误判成表头 */
        const headerRow = cells.length >= 3 && cells.every((cell) => {
          const text = strip(cell.text);
          if (!text) return true;
          if (/^\d/.test(text)) return false;
          return isFieldLabel(cell.text) || strip(cell.text.replace(/[（(][^）)]*[）)]/g, '')).length <= 6;
        });
        if (headerRow) {
          headers = cells.map((cell) => squash(cell.text));
          continue;
        }

        for (let i = 0; i < cells.length; i += 1) {
          const cell = cells[i];
          const next = cells[i + 1];
          /* 标签格 + 值格：值可以是空的（插入），也可以是行末那个「像标签的值」 */
          if (isFieldLabel(cell.text) && next && (!isFieldLabel(next.text) || i + 2 >= cells.length)) {
            const ranges = tailRanges(next.chunk, next.base, 0);
            addSlot('field', cell.text.replace(/[：:]\s*$/, ''), next.text, ranges,
              ranges.length ? null : tailAnchor(next.chunk, next.base));
            i += 1;
            continue;
          }
          if (!cell.text || isFieldLabel(cell.text)) continue;
          const column = headers[i] || '';
          if (/^\d+$/.test(cell.text) && (!column || /序号|编号/.test(column))) continue;
          const limit = nestedLimit(cell.chunk, cell.base);
          addContent('cell', column, cellRawText(cell.chunk, cell.base, limit), cell.chunk, cell.base, cellLead(cell.chunk), limit);
        }
      }
    }
    return { slots, headings };
  }

  /* 只改值：第一个 <w:t> 写新值，同一个空里的其余 <w:t> 清空；没有 <w:t> 就插一个 run。
     传空串表示「这一格输出为空」，没传的 id 原样保留参考里的文字。 */
  function applyFill(documentXml, model, values) {
    const xml = String(documentXml || '');
    const lookup = values instanceof Map ? values : new Map(Object.entries(values || {}));
    const edits = [];
    for (const slot of model.slots) {
      if (!lookup.has(slot.id)) continue;
      const text = squash(lookup.get(slot.id));
      if (slot.ranges.length) {
        edits.push({ start: slot.ranges[0].start, end: slot.ranges[0].end, text: escapeXml(text) });
        for (const range of slot.ranges.slice(1)) edits.push({ start: range.start, end: range.end, text: '' });
        continue;
      }
      if (!slot.anchor) continue;
      const run = '<w:r><w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r>';
      if (slot.anchor.at != null) edits.push({ start: slot.anchor.at, end: slot.anchor.at, text: run });
      else edits.push({ start: slot.anchor.replace.start, end: slot.anchor.replace.end, text: slot.anchor.replace.text + run + '</w:p>' });
    }
    edits.sort((a, b) => b.start - a.start);
    let out = xml;
    for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    return out;
  }

  /* 丢掉部件后要把指向它的关系与内容类型声明一并清掉，否则 Word 会提示「内容有问题」 */
  async function cleanPackage(entries, dropped) {
    const gone = (dropped || []).map((item) => item.name);
    if (!gone.length) return entries;
    const aliveExt = new Set(entries.map((entry) => (entry.name.match(/\.([A-Za-z0-9]+)$/) || [])[1]).filter(Boolean).map((ext) => ext.toLowerCase()));
    const goneExt = new Set(gone.map((name) => (name.match(/\.([A-Za-z0-9]+)$/) || [])[1]).filter(Boolean).map((ext) => ext.toLowerCase()));
    const out = [];
    for (const entry of entries) {
      const touch = /\[Content_Types\]\.xml$/i.test(entry.name) || /\.rels$/i.test(entry.name)
        || /fontTable\.xml$/i.test(entry.name) || /settings\.xml$/i.test(entry.name);
      if (!touch) { out.push(entry); continue; }
      let text;
      try {
        const data = entry.method === 0 ? base64ToBytes(entry.b64) : await inflateRaw(base64ToBytes(entry.b64));
        text = decoder.decode(data);
      } catch {
        out.push(entry);
        continue;
      }
      const before = text;
      if (/\[Content_Types\]\.xml$/i.test(entry.name)) {
        for (const ext of goneExt) {
          if (!aliveExt.has(ext)) text = text.replace(new RegExp('<Default Extension="' + ext + '"[^>]*/>', 'g'), '');
        }
        for (const name of gone) text = text.replace(new RegExp('<Override PartName="/' + escapeRe(name) + '"[^>]*/>', 'g'), '');
      } else if (/\.rels$/i.test(entry.name)) {
        const dir = entry.name.replace(/\/_rels\/[^/]+$/, '');
        for (const name of gone) {
          const tail = name.split('/').pop();
          if (!name.startsWith(dir + '/')) continue;
          text = text.replace(new RegExp('<Relationship\\b[^>]*Target="(?:[^"]*/)?' + escapeRe(tail) + '"[^>]*/>', 'g'), '');
        }
      } else if (/fontTable\.xml$/i.test(entry.name)) {
        text = text.replace(/<w:embed[A-Za-z]*\b[^>]*\/>/g, '');
      } else {
        /* 字体部件已经丢掉，settings 里的「嵌入字体」开关也一并关掉，免得 Word 找不齐字体提示修复 */
        text = text.replace(/<w:embed(?:TrueTypeFonts|SystemFonts)\b[^>]*\/>/g, '');
      }
      out.push(text === before ? entry : { ...entry, text });
    }
    return out;
  }

  /* 没有 CompressionStream 就退化成「不压缩存储」——ZIP 允许，体积大一点但 Word 照开 */
  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  /* 重打包：document.xml 换成填好的，其余部件（含图片、页眉页脚、样式）逐字节照搬 */
  async function fillPackage(pkg, documentXml) {
    const entries = await cleanPackage(pkg.entries, pkg.dropped);
    const files = [];
    for (const entry of entries) {
      if (entry.name === 'word/document.xml') {
        const plain = new TextEncoder().encode(documentXml);
        const packed = await deflateRaw(plain);
        files.push(packed
          ? { name: entry.name, raw: packed, method: 8, size: plain.length, crc: window.WB.ooxml.crc32(plain) }
          : { name: entry.name, data: plain });
        continue;
      }
      if (entry.text != null) { files.push({ name: entry.name, data: new TextEncoder().encode(entry.text) }); continue; }
      files.push({ name: entry.name, raw: base64ToBytes(entry.b64), method: entry.method, size: entry.size, crc: entry.crc });
    }
    return window.WB.ooxml.zip(files);
  }

  /* ── 起草值：项目信息表 → 参考表里的字段（按标签精确匹配，够不着的留给 AI 或手填） ── */

  const DRAFT_ALIASES = [
    { key: 'name', labels: ['活动名称', '活动主题', '项目名称', '活动全称'] },
    { key: 'date', labels: ['活动时间', '活动日期', '举办时间', '活动期限'] },
    { key: 'start', labels: ['开始时间'] },
    { key: 'end', labels: ['结束时间'] },
    { key: 'venue', labels: ['活动地点', '活动场地', '举办地点'] },
    { key: 'venueBackup', labels: ['备用地点', '备选地点', '备选场地'] },
    { key: 'guests', labels: ['预计人数', '参加人数', '参与人数', '活动人数', '活动规模'] },
    { key: 'budget', labels: ['预算上限', '活动预算', '经费预算', '总预算', '预算金额'] },
    { key: 'organizer', labels: ['主办单位', '主办方', '主办机构'] },
    { key: 'coOrganizer', labels: ['承办单位', '承办方', '协办单位', '协办方', '社团名称', '申报单位', '申报社团'] },
    { key: 'approval', labels: ['审批要求', '审批单位'] },
    { key: 'audience', labels: ['活动对象', '参与对象', '目标受众', '受众'] },
    { key: 'goal', labels: ['核心目标', '活动目的', '活动目标'] },
    { key: 'content', labels: ['活动内容与形式', '活动内容', '内容与形式', '活动形式'] },
    { key: 'constraint', labels: ['已知约束', '约束条件'] }
  ];
  const DRAFT_TODAY = ['填报时间', '填表时间', '申报时间', '填报日期'];

  /* 标签归一：去空格、去「（元）」这类括注、去冒号，方便「活 动 名 称」也能命中 */
  const labelKey = (value) => strip(String(value || '').replace(/[（(][^）)]*[）)]/g, '')).replace(/[：:]/g, '');

  const dateText = (iso) => {
    const value = String(iso || '').trim();
    if (!value) return '';
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;
    return match[1] + '年' + Number(match[2]) + '月' + Number(match[3]) + '日';
  };

  function fillDraft(model, basic = {}) {
    const source = basic || {};
    const byLabel = new Map();
    for (const item of DRAFT_ALIASES) {
      const raw = source[item.key];
      if (raw == null || raw === '') continue;
      let text = squash(raw);
      if (item.key === 'date') {
        text = dateText(raw);
        const span = [squash(source.start), squash(source.end)].filter(Boolean).join('—');
        if (span) text += ' ' + span;
      }
      if (!text) continue;
      for (const label of item.labels) if (!byLabel.has(label)) byLabel.set(label, text);
    }
    const now = new Date();
    const today = now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日';
    for (const label of DRAFT_TODAY) byLabel.set(label, today);

    const values = {};
    let matched = 0;
    for (const slot of model.slots || []) {
      const key = labelKey(slot.label);
      if (!key || !byLabel.has(key)) continue;
      values[slot.id] = byLabel.get(key);
      matched += 1;
    }
    return { values, matched };
  }
  /* ── 版式套件（style kit）：把参考 Word 的「样子」也留下来 ──
     上传参考时顺手取出样式表、编号定义、页眉页脚与页面设置，导出 .docx 时照它排版：
     字体字号、页边距、页眉页脚、表格线都跟原表一致，只有正文换成生成的内容。
     全部以文本形式存进参考件（图片转 base64，沿用素材库那条 400 KB 规则），不需要服务端配合。 */

  const MAX_PART = 400 * 1024;
  const MAX_MEDIA = 400 * 1024;
  const KIT_BUDGET = 700 * 1024;
  const HEADER_CAP = 120 * 1024;
  const RELS_CAP = 200 * 1024;
  const KIT_PARTS = ['word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'word/fontTable.xml', 'word/webSettings.xml', 'word/theme/theme1.xml'];
  /* 超预算时的丢弃顺序：先丢最不影响的，styles.xml 永远保留 */
  const KIT_DROP_ORDER = ['word/theme/theme1.xml', 'word/webSettings.xml', 'word/fontTable.xml', 'word/settings.xml', 'word/numbering.xml'];
  const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf)$/i;
  const MIME_OF = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf'
  };

  const bytesToBase64 = (data) => {
    let text = '';
    for (let index = 0; index < data.length; index += 0x8000) {
      text += String.fromCharCode.apply(null, data.subarray(index, index + 0x8000));
    }
    return btoa(text);
  };

  async function safeInflate(bytes, target, cap = MAX_PART) {
    try {
      const entry = findEntry(bytes, target);
      if (!entry) return null;
      if (entry.data.length > cap * 4) return null;
      const data = entry.method === 0 ? entry.data : entry.method === 8 ? await inflateRaw(entry.data) : null;
      return data && data.length <= cap ? data : null;
    } catch {
      return null;
    }
  }

  /* OOXML 的 Target 相对「引用它的部件」所在目录；这里统一归一化成包内绝对路径 */
  function resolvePart(partPath, target) {
    const raw = String(target || '').replace(/\\/g, '/');
    if (!raw) return '';
    if (raw.startsWith('/')) return raw.replace(/^\/+/, '');
    const base = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/')) : '';
    const stack = base ? base.split('/') : [];
    for (const piece of raw.split('/')) {
      if (!piece || piece === '.') continue;
      if (piece === '..') stack.pop();
      else stack.push(piece);
    }
    return stack.join('/');
  }

  function parseRels(xml) {
    const map = new Map();
    for (const match of String(xml || '').matchAll(/<Relationship\b[^>]*?\/?>/g)) {
      const tag = match[0];
      const id = (tag.match(/\bId="([^"]*)"/) || [])[1];
      const target = (tag.match(/\bTarget="([^"]*)"/) || [])[1];
      if (!id || !target) continue;
      map.set(id, {
        id,
        target,
        type: (tag.match(/\bType="([^"]*)"/) || [])[1] || '',
        external: /TargetMode="External"/.test(tag)
      });
    }
    return map;
  }

  const paragraphsOf = (xml) => [...String(xml || '').matchAll(/<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g)].map((match) => match[0]);
  const pPrOf = (xml) => (String(xml || '').match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [])[0] || '';

  /* 采样式段落属性：去掉自动编号（正文标题里已经写了「一、」，再套编号会重复）与修订标记 */
  const cleanPPr = (pPr) => String(pPr || '')
    .replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '')
    .replace(/\s+w:rsid[A-Za-z]*="[^"]*"/g, '')
    .replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '');

  /* styles.xml → 每个 styleId 对应几级标题 */
  function styleIndex(stylesXml) {
    const names = new Map();
    const levels = new Map();
    for (const match of String(stylesXml || '').matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
      const chunk = match[0];
      const id = (chunk.match(/w:styleId="([^"]*)"/) || [])[1];
      if (!id) continue;
      const name = (chunk.match(/<w:name w:val="([^"]*)"/) || [])[1] || '';
      names.set(id, name);
      const outline = (chunk.match(/<w:outlineLvl w:val="(\d+)"/) || [])[1];
      const level = styleLevel(name) || (outline != null && Number(outline) <= 5 ? Number(outline) + 1 : 0);
      if (level >= 1 && level <= 4) levels.set(id, level);
    }
    return { names, levels };
  }

  /* 从参考正文里采一份样：标题各级、正文最常见的那种、标题页/表格 */
  function samplesOf(documentXml, index) {
    const pPr = { title: '', heading1: '', heading2: '', heading3: '', heading4: '', body: '' };
    const bodyCounts = new Map();
    for (const chunk of paragraphsOf(documentXml)) {
      const clean = cleanPPr(pPrOf(chunk));
      if (!clean) continue;
      const styleId = (clean.match(/<w:pStyle w:val="([^"]*)"/) || [])[1];
      if (!styleId) {
        bodyCounts.set(clean, (bodyCounts.get(clean) || 0) + 1);
        continue;
      }
      const name = String(index.names.get(styleId) || '');
      if (!pPr.title && /^(title|标题|文档标题|题目)$/i.test(name.trim())) { pPr.title = clean; continue; }
      const level = index.levels.get(styleId);
      if (level && level <= 4 && !pPr[`heading${level}`]) pPr[`heading${level}`] = clean;
    }
    let best = '';
    let bestCount = 0;
    for (const [key, count] of bodyCounts) if (count > bestCount) { best = key; bestCount = count; }
    pPr.body = best;
    return pPr;
  }

  const sectPrOf = (documentXml) => {
    const all = [...String(documentXml || '').matchAll(/<w:sectPr(?:\s[^>]*)?\/>|<w:sectPr(?:\s[^>]*)?>[\s\S]*?<\/w:sectPr>/g)].map((match) => match[0]);
    return all.length ? all[all.length - 1] : '';
  };

  /* 表格样式样本：优先取有表头那种多行表 */
  function tableSampleOf(documentXml) {
    for (const table of String(documentXml || '').matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
      const chunk = table[0];
      if ((chunk.match(/<w:tr(?:\s[^>]*)?>/g) || []).length < 2) continue;
      const tblPr = (chunk.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/) || [])[0] || '';
      const tblGrid = (chunk.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/) || [])[0] || '';
      if (tblPr || tblGrid) return { tblPr, tblGrid };
    }
    return { tblPr: '', tblGrid: '' };
  }

  const docAttrsOf = (documentXml) => {
    const match = String(documentXml || '').match(/<w:document\b([^>]*)>/);
    const attrs = (match ? match[1] : '').trim();
    return attrs && /xmlns:w=/.test(attrs) ? attrs : '';
  };

  const kitSize = (kit) => JSON.stringify(kit).length;

  /* 主入口：读出一个参考 .docx 的版式套件；任何一步读不到都只是少一部分，不影响文本解析 */
  async function styleKit(bytes, name = '') {
    const documentXmlBytes = await safeInflate(bytes, 'word/document.xml', 4 * 1024 * 1024);
    if (!documentXmlBytes) return null;
    const documentXml = decoder.decode(documentXmlBytes);
    const notes = [];
    const parts = {};
    for (const path of KIT_PARTS) {
      const data = await safeInflate(bytes, path);
      if (data) parts[path] = decoder.decode(data);
    }
    if (!parts['word/styles.xml']) notes.push('参考里没有可用的样式表，导出改用默认版式');

    const index = styleIndex(parts['word/styles.xml']);
    const pPr = samplesOf(documentXml, index);
    const headingIds = { 1: '', 2: '', 3: '', 4: '' };
    for (const [id, level] of index.levels) if (!headingIds[level]) headingIds[level] = id;
    const { tblPr, tblGrid } = tableSampleOf(documentXml);
    const fontSet = new Set();
    for (const match of String(parts['word/styles.xml'] || '').matchAll(/w:eastAsia="([^"]+)"/g)) fontSet.add(match[1]);

    /* 页眉页脚：sectPr 里引了哪几个部件，就连同它们的图片一起搬走 */
    const headerRels = parseRels(decoder.decode(await safeInflate(bytes, 'word/_rels/document.xml.rels', RELS_CAP) || new Uint8Array()));
    let sectPr = sectPrOf(documentXml);
    const refs = [];
    const media = [];
    let mediaBytes = 0;
    for (const match of sectPr.matchAll(/<w:(header|footer)Reference\b[^>]*\/>/g)) {
      const tag = match[0];
      const kind = match[1];
      const rid = (tag.match(/r:id="([^"]*)"/) || [])[1];
      const rel = rid ? headerRels.get(rid) : null;
      if (!rel || rel.external) continue;
      const type = (tag.match(/w:type="([^"]*)"/) || [])[1] || 'default';
      const path = resolvePart('word/document.xml', rel.target);
      const xmlBytes = await safeInflate(bytes, path, HEADER_CAP);
      if (!xmlBytes) { notes.push(`参考的${kind === 'header' ? '页眉' : '页脚'}（${path}）超出了保存上限，导出时不带它`); continue; }
      const xml = decoder.decode(xmlBytes);
      const partRels = parseRels(decoder.decode(await safeInflate(bytes, resolvePart(path, '_rels/' + path.split('/').pop() + '.rels'), RELS_CAP) || new Uint8Array()));
      const attached = [];
      let fits = true;
      for (const [mediaRid, mediaRel] of partRels) {
        if (mediaRel.external || !IMAGE_EXT.test(mediaRel.target)) continue;
        const mediaPath = resolvePart(path, mediaRel.target);
        const data = await safeInflate(bytes, mediaPath, MAX_MEDIA);
        if (!data || mediaBytes + data.length > MAX_MEDIA) { fits = false; break; }
        mediaBytes += data.length;
        attached.push({ rid: mediaRid, path: mediaPath, ext: (mediaPath.match(IMAGE_EXT) || [])[0].slice(1).toLowerCase(), b64: bytesToBase64(data) });
      }
      if (!fits) { notes.push(`参考的${kind === 'header' ? '页眉' : '页脚'}图片超出 400 KB 预算，导出时不带它`); continue; }
      refs.push({ kind, type, path, xml, media: attached });
    }
    if (refs.length) {
      const kept = new Set(refs.map((ref) => ref.path));
      sectPr = sectPr.replace(/<w:(header|footer)Reference\b[^>]*\/>/g, (tag) => {
        const rid = (tag.match(/r:id="([^"]*)"/) || [])[1];
        const rel = rid ? headerRels.get(rid) : null;
        return rel && kept.has(resolvePart('word/document.xml', rel.target)) ? '' : tag;
      });
    }
    for (const ref of refs) {
      for (const file of ref.media) if (!media.some((item) => item.path === file.path)) media.push(file);
    }

    const kit = {
      name: String(name || '参考件'),
      parts,
      refs,
      media,
      sectPr,
      docAttrs: docAttrsOf(documentXml),
      pPr,
      headingIds,
      tblPr,
      tblGrid,
      fonts: [...fontSet].slice(0, 8),
      bytes: 0,
      dropped: [],
      notes
    };

    /* 体积兜底：先丢图片，再按 KIT_DROP_ORDER 丢可选部件，styles.xml 不动 */
    if (kitSize(kit) > KIT_BUDGET && media.length) {
      kit.media = [];
      kit.refs = refs.filter((ref) => !ref.media.length);
      kit.notes.push('参考里的页眉页脚图片超出本地存档预算，导出时不带图片');
    }
    for (const path of KIT_DROP_ORDER) {
      if (kitSize(kit) <= KIT_BUDGET) break;
      if (!kit.parts[path]) continue;
      delete kit.parts[path];
      kit.dropped.push(path);
    }
    if (kitSize(kit) > KIT_BUDGET && kit.parts['word/styles.xml']) {
      delete kit.parts['word/styles.xml'];
      kit.dropped.push('word/styles.xml');
      kit.notes.push('参考的样式表太大，超出本地存档预算，导出改用默认版式');
    }
    if (!kit.parts['word/styles.xml'] && !kit.sectPr) return null;
    kit.bytes = kitSize(kit);
    return kit;
  }
  /* ── 对外：读文件 ───────────────────────── */

  async function readFile(file) {
    const name = String(file?.name || '参考件');
    const lower = name.toLowerCase();
    if (lower.endsWith('.docx')) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('这是旧版 .doc 格式，请先在 Word 里另存为 .docx 再上传。');
        throw new Error('这个文件不是有效的 .docx，请确认后重传。');
      }
      const xml = await inflateEntry(bytes, 'word/document.xml');
      if (!xml) throw new Error('读不到 Word 正文，文件可能已加密或损坏。');
      /* 顺手把版式套件与整包都取出来：前者用于「按参考排版」，后者用于「参考表填值」 */
      let kit = null;
      try {
        kit = await styleKit(bytes, name);
      } catch {
        kit = null;
      }
      let pack = null;
      try {
        pack = await readPackage(bytes);
      } catch {
        pack = null;
      }
      return { name, kind: 'docx', ...parseDocumentXml(decoder.decode(xml)), kit, package: pack };
    }
    if (lower.endsWith('.doc')) throw new Error('旧版 .doc 暂不支持，请先在 Word 里另存为 .docx。');
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return { name, kind: 'markdown', ...parseText(await file.text()) };
    if (lower.endsWith('.txt')) return { name, kind: 'text', ...parseText(await file.text()) };
    throw new Error('参考件支持 .docx / .md / .txt 三种格式。');
  }

  /* ── 一致性核对：参考的栏目与字段在产出里覆盖了多少 ── */

  const NUM_PREFIX = /^(?:第[一二三四五六七八九十百]+[章节部分条]|[（(]?[一二三四五六七八九十]{1,3}[)）、.．]|[（(]?\d{1,3}[)）、.．]|\d+\.\d+)\s*/;
  const PUNCT = /[\s\u3000：:、，,。.；;·\-—_/\\|（）()\[\]【】「」『』《》〈〉"'?!？～~]/g;

  function norm(value) {
    return String(value || '').replace(/^#+\s*/, '').replace(NUM_PREFIX, '').replace(PUNCT, '').toLowerCase();
  }

  /* 只要一方包含另一方就算命中：表头写法常比正文里的说法更短或更长 */
  function covers(needle, haystack) {
    for (const item of haystack) {
      if (!item) continue;
      if (item === needle || (needle.length >= 2 && item.includes(needle)) || (item.length >= 2 && needle.includes(item))) return true;
    }
    return false;
  }

  /* 产出这一侧的检索面：章节标题 + 所有表格单元格 + 正文整段 */
  function docTerms(doc) {
    const headings = [];
    const terms = [];
    const body = [];
    for (const section of doc?.sections || []) {
      headings.push(norm(section.heading));
      const text = String(section.body || '');
      body.push(text);
      for (const line of text.split(/\r?\n/)) {
        if (!/^\s*\|/.test(line)) continue;
        const cells = rowCells(line);
        if (isDivider(cells)) continue;
        for (const cell of cells) terms.push(norm(cell));
      }
    }
    terms.push(norm(body.join('\n')));
    return { headings: headings.filter(Boolean), terms: terms.filter(Boolean) };
  }

  function matchReport(reference, doc) {
    if (!reference || !doc) return null;
    const { headings, terms } = docTerms(doc);
    const take = (list) => {
      const seen = new Set();
      const items = [];
      for (const source of list) {
        const label = String(source || '');
        const key = norm(label);
        if (key.length < 2 || seen.has(key)) continue;
        seen.add(key);
        items.push({ key, label });
      }
      return items;
    };
    const refColumns = take((reference.sections || []).map((section) => section.heading));
    const refFields = take(reference.fields || []);
    const pick = (items, haystack) => {
      const missing = items.filter((item) => !covers(item.key, haystack));
      return { total: items.length, covered: items.length - missing.length, missing: missing.map((item) => item.label) };
    };
    return { columns: pick(refColumns, headings), fields: pick(refFields, terms) };
  }

  function summaryOf(reference) {
    if (!reference) return '';
    const kind = { docx: 'Word', markdown: 'Markdown', text: '文本' }[reference.kind] || '参考件';
    const chars = reference.chars > 1000 ? `${(reference.chars / 1000).toFixed(1)}k 字` : `${reference.chars} 字`;
    return `${kind} · ${reference.sections?.length || 0} 栏目 · ${reference.fields?.length || 0} 字段 · ${chars}${reference.truncated ? '（已截断）' : ''}`;
  }

  window.WB.docx = {
    MAX_CHARS, decodeXml, paragraphText, styleLevel, textLevel, looksLikeHeading,
    docxBlocks, textBlocks, paragraphOutline, outlineOf: paragraphOutline, referenceOutline,
    fieldLabels, renderText, parseDocumentXml, parseText,
    findEntry, inflateEntry, readFile, matchReport, summaryOf, norm,
    styleKit, parseRels, resolvePart, bytesToBase64, MAX_MEDIA,
    listEntries, entryBytes, readPackage, documentXmlOf, fillSlots, applyFill, fillPackage, fillDraft, isFieldLabel,
    outerRanges, blockRanges, tailRanges, nestedLimit, PACKAGE_BUDGET, FILL_MAX_SLOTS
  };
}());