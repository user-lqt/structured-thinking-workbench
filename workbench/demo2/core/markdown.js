/* 轻量 Markdown 解析：把材料正文（含 GFM 管道表格）转成 HTML 预览或结构块。
 * 零依赖、离线可用；只覆盖材料正文实际会用到的语法：标题 / 段落 / 列表 / 引用 / 分隔线 / 表格 / 行内强调。
 */
window.WB = window.WB || {};

(function () {
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* 行内语法：先转义再套标签，避免正文里的 HTML 被当成标签执行 */
  function inline(raw) {
    let out = esc(raw);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return out;
  }

  const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
  /* 分隔行形如 | --- | :--: |，至少含一个短横、只由 | - : 空格组成 */
  const isDelimiterRow = (line) => /^[\s|:-]+$/.test(line) && line.includes('-');

  function splitRow(line) {
    let body = line.trim();
    if (body.startsWith('|')) body = body.slice(1);
    if (body.endsWith('|')) body = body.slice(0, -1);
    const cells = [];
    let buffer = '';
    for (let i = 0; i < body.length; i += 1) {
      if (body[i] === '\\' && body[i + 1] === '|') { buffer += '|'; i += 1; continue; }
      if (body[i] === '|') { cells.push(buffer.trim()); buffer = ''; continue; }
      buffer += body[i];
    }
    cells.push(buffer.trim());
    return cells;
  }

  /* 表格分隔行的对齐方式：:--- 左、:---: 中、---: 右 */
  const alignOf = (cell) => {
    const value = String(cell).trim();
    const left = value.startsWith(':');
    const right = value.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  };
  const delimiterOf = (align) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---');

  /* 表格容错：表头比数据行短，预览与导出就会按表头列数把后面的格子裁掉（数据直接没了）。
     这里只把列数对齐到最宽的一行，一行内容都不动；整行表头是空的（含完全没写表头）就当无表头处理，
     渲染时那一行不画出来，数据仍是数据。 */
  function normaliseTable(block) {
    const rows = (block.rows || []).map((row) => (Array.isArray(row) ? row.slice() : [String(row ?? '')]));
    const header = (block.header || []).slice();
    const width = Math.max(1, header.length, ...rows.map((row) => row.length));
    const cell = (value) => String(value ?? '').trim();
    const pad = (row) => Array.from({ length: width }, (_, index) => cell(row[index]));
    const aligns = Array.from({ length: width }, (_, index) => (block.aligns || [])[index] || '');
    return { ...block, header: pad(header), rows: rows.map(pad), aligns };
  }

  /* 把 Markdown 拆成结构块，供 HTML 预览与 Word / Excel 生成共用。
     每个块带上 start / end 行号，这样「只改这一块」时能原样保留其余正文。 */
  function parseBlocks(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let list = null;
    let paragraph = null;
    let index = 0;

    const flushList = (end) => { if (list) { list.end = end; blocks.push(list); list = null; } };
    const flushParagraph = (end) => { if (paragraph) { paragraph.end = end; blocks.push(paragraph); paragraph = null; } };
    const flushAll = (end) => { flushList(end); flushParagraph(end); };

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { flushAll(index); index += 1; continue; }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (heading) {
        flushAll(index);
        blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim(), start: index, end: index + 1 });
        index += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        flushAll(index);
        blocks.push({ type: 'hr', start: index, end: index + 1 });
        index += 1;
        continue;
      }

      if (isTableLine(line) && index + 1 < lines.length && isTableLine(lines[index + 1]) && isDelimiterRow(lines[index + 1].trim())) {
        flushAll(index);
        const start = index;
        const header = splitRow(line);
        const aligns = splitRow(lines[index + 1]).map(alignOf);
        index += 2;
        const rows = [];
        while (index < lines.length && isTableLine(lines[index])) { rows.push(splitRow(lines[index])); index += 1; }
        blocks.push(normaliseTable({ type: 'table', header, aligns, rows, start, end: index }));
        continue;
      }

      /* 无表头的表：分隔行写在最前、紧跟着就是数据行（模型偶尔会这么写）。
         不认的话整张表会退化成一堆 `| --- |` 竖线文本，预览与导出都没法看。 */
      if (isTableLine(line) && isDelimiterRow(line.trim()) && index + 1 < lines.length
        && isTableLine(lines[index + 1]) && !isDelimiterRow(lines[index + 1].trim())) {
        flushAll(index);
        const start = index;
        const aligns = splitRow(line).map(alignOf);
        index += 1;
        const rows = [];
        while (index < lines.length && isTableLine(lines[index])) { rows.push(splitRow(lines[index])); index += 1; }
        blocks.push(normaliseTable({ type: 'table', header: [], aligns, rows, start, end: index }));
        continue;
      }

      const bullet = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
      if (bullet) {
        flushParagraph(index);
        const ordered = /\d/.test(bullet[1]);
        if (!list || list.ordered !== ordered) { flushList(index); list = { type: 'list', ordered, items: [], start: index }; }
        list.items.push(bullet[2].trim());
        index += 1;
        continue;
      }

      const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
      if (quote) {
        flushAll(index);
        blocks.push({ type: 'quote', text: quote[1].trim(), start: index, end: index + 1 });
        index += 1;
        continue;
      }

      flushList(index);
      if (paragraph) paragraph.lines.push(line.trim());
      else paragraph = { type: 'paragraph', lines: [line.trim()], start: index };
      index += 1;
    }
    flushAll(lines.length);
    return blocks;
  }

  const cellText = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

  function tableToMarkdown(header, rows, aligns) {
    const head = (header || []).map(cellText);
    const width = head.length;
    const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cellText(cells ? cells[i] : '')).join(' | ')} |`;
    const rule = Array.from({ length: width }, (_, i) => delimiterOf((aligns || [])[i]));
    return [line(head), `| ${rule.join(' | ')} |`, ...(rows || []).map(line)].join('\n');
  }

  /* 结构块 → Markdown：预览里改完一个块后，用它写回正文 */
  function blockToMarkdown(block) {
    switch (block && block.type) {
      case 'heading': return `${'#'.repeat(Math.min(Math.max(block.level || 1, 1), 6))} ${block.text || ''}`.trimEnd();
      case 'hr': return '---';
      case 'quote': return `> ${block.text || ''}`.trimEnd();
      case 'list': return (block.items || []).map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${item}`).join('\n');
      case 'table': return tableToMarkdown(block.header, block.rows, block.aligns);
      default: return (block && block.lines ? block.lines : []).join('\n');
    }
  }

  /* 只替换目标块占用的那几行，其余正文（包括空行）原样保留 */
  function spliceBlock(markdown, block, replacement) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const start = Math.max(0, Math.min(block && block.start != null ? block.start : 0, lines.length));
    const end = Math.max(start, Math.min(block && block.end != null ? block.end : start, lines.length));
    return [...lines.slice(0, start), ...String(replacement).split('\n'), ...lines.slice(end)].join('\n');
  }

  /* 把 contenteditable 里的 HTML 还原成行内 Markdown（不依赖 DOM，浏览器与自测同一套逻辑） */
  function htmlToInline(html) {
    return String(html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
      .replace(/<(p|div|li|h[1-6]|tr|section)[^>]*>/gi, '')
      .replace(/<(strong|b)\s*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)\s*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<code\s*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<del\s*>([\s\S]*?)<\/del>/gi, '~~$1~~')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function toHtml(markdown) {
    const blocks = parseBlocks(markdown);
    if (!blocks.length) return '';
    return blocks.map((block) => {
      switch (block.type) {
        case 'heading': {
          const level = Math.min(Math.max(block.level + 2, 3), 6);
          return `<h${level}>${inline(block.text)}</h${level}>`;
        }
        case 'hr': return '<hr />';
        case 'quote': return `<blockquote>${inline(block.text)}</blockquote>`;
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          return `<${tag}>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`;
        }
        case 'table': {
          /* 整行表头是空的（模型漏写表头）时只出数据行，免得顶上挂一排空格子 */
          const hasHead = block.header.some((cell) => String(cell ?? '').trim());
          const head = hasHead ? `<thead><tr>${block.header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>` : '';
          const body = block.rows.map((cells) => `<tr>${Array.from({ length: block.header.length }, (_, position) => `<td>${inline(cells[position] ?? '')}</td>`).join('')}</tr>`).join('');
          return `<div class="md-table-wrap"><table class="md-table">${head}<tbody>${body}</tbody></table></div>`;
        }
        default:
          return `<p>${block.lines.map((line) => inline(line)).join('<br />')}</p>`;
      }
    }).join('\n');
  }

  /* 纯文本化：给 Excel 的「正文」工作表用，去掉行内标记 */
  const toPlainLines = (markdown) => String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\*\*|`|~~/g, '').trim())
    .filter((line) => line && !/^[\s|:-]+$/.test(line) && !isTableLine(line));

  window.WB.markdown = { parseBlocks, toHtml, inline, toPlainLines, isTableLine, esc, blockToMarkdown, tableToMarkdown, spliceBlock, htmlToInline };
})();