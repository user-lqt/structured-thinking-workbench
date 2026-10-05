/* OOXML 生成器：零依赖手写 ZIP（STORE 存储法）+ WordprocessingML / SpreadsheetML。
 * 产出的是真正的 .docx / .xlsx，Word、WPS、Excel、Numbers 都能直接打开。
 * 不引入任何压缩库：ZIP 条目用 method=0（仅存储），文件体积略大但合法且完全离线。
 */
window.WB = window.WB || {};

(function () {
  const encoder = new TextEncoder();
  const encode = (value) => encoder.encode(String(value));

  /* ── CRC32 ─────────────────────────────── */
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Int32Array(256);
      for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
        crcTable[i] = value;
      }
    }
    let crc = -1;
    for (let i = 0; i < bytes.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }

  function dosStamp(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time: time & 0xFFFF, date: day & 0xFFFF };
  }

  /* ── 极简 ZIP（条目按传入顺序存储，不压缩） ── */
  /* 条目可以是 { name, data }（现编码，一律不压缩），
     也可以是 { name, raw, method, size, crc }（照搬参考件里的压缩字节，crc/size 是原始内容的） */
  function zip(files, when) {
    const stamp = dosStamp(when instanceof Date ? when : new Date());
    const entries = files.map((file) => {
      const nameBytes = encode(file.name);
      if (file.raw) {
        return {
          nameBytes,
          data: file.raw,
          crc: (file.crc || 0) >>> 0,
          size: file.size == null ? file.raw.length : file.size,
          method: file.method === 8 ? 8 : 0,
          offset: 0
        };
      }
      const data = file.data instanceof Uint8Array ? file.data : encode(file.data);
      return { nameBytes, data, crc: crc32(data), size: data.length, method: 0, offset: 0 };
    });
    let total = 22;
    for (const entry of entries) total += 30 + entry.nameBytes.length + entry.data.length + 46 + entry.nameBytes.length;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    let pos = 0;
    for (const entry of entries) {
      entry.offset = pos;
      view.setUint32(pos, 0x04034B50, true); pos += 4;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 0x0800, true); pos += 2;
      view.setUint16(pos, entry.method, true); pos += 2;
      view.setUint16(pos, stamp.time, true); pos += 2;
      view.setUint16(pos, stamp.date, true); pos += 2;
      view.setUint32(pos, entry.crc, true); pos += 4;
      view.setUint32(pos, entry.data.length, true); pos += 4;
      view.setUint32(pos, entry.size, true); pos += 4;
      view.setUint16(pos, entry.nameBytes.length, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      out.set(entry.nameBytes, pos); pos += entry.nameBytes.length;
      out.set(entry.data, pos); pos += entry.data.length;
    }
    const centralStart = pos;
    for (const entry of entries) {
      view.setUint32(pos, 0x02014B50, true); pos += 4;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 0x0800, true); pos += 2;
      view.setUint16(pos, entry.method, true); pos += 2;
      view.setUint16(pos, stamp.time, true); pos += 2;
      view.setUint16(pos, stamp.date, true); pos += 2;
      view.setUint32(pos, entry.crc, true); pos += 4;
      view.setUint32(pos, entry.data.length, true); pos += 4;
      view.setUint32(pos, entry.size, true); pos += 4;
      view.setUint16(pos, entry.nameBytes.length, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint32(pos, 0, true); pos += 4;
      view.setUint32(pos, entry.offset, true); pos += 4;
      out.set(entry.nameBytes, pos); pos += entry.nameBytes.length;
    }
    const centralSize = pos - centralStart;
    view.setUint32(pos, 0x06054B50, true); pos += 4;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, entries.length, true); pos += 2;
    view.setUint16(pos, entries.length, true); pos += 2;
    view.setUint32(pos, centralSize, true); pos += 4;
    view.setUint32(pos, centralStart, true); pos += 4;
    view.setUint16(pos, 0, true); pos += 2;
    return out;
  }

  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const escXml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    /* 去掉 XML 1.0 不接受的制表控制字符，避免 Word 报「文件已损坏」 */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  /* ── Word ─────────────────────────────── */
  function wRun(text, opts = {}) {
    const props = `${opts.bold ? '<w:b/>' : ''}${opts.italic ? '<w:i/>' : ''}`
      + `${opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : ''}`;
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
  }

  function wParagraph(text, opts = {}) {
    const props = [];
    if (opts.style) props.push(`<w:pStyle w:val="${opts.style}"/>`);
    props.push('<w:spacing w:after="120" w:line="300" w:lineRule="auto"/>');
    if (opts.indent) props.push(`<w:ind w:left="${opts.indent}"/>`);
    if (opts.align) props.push(`<w:jc w:val="${opts.align}"/>`);
    return `<w:p><w:pPr>${props.join('')}</w:pPr>${wRun(text, opts)}</w:p>`;
  }

  function wTable(header, rows) {
    const borders = '<w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((side) => `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="A6B1C2"/>`).join('')
      + '</w:tblBorders>';
    /* 列数取表头与数据行里最宽的一行：模型偶尔会写出表头比数据短的表，按表头裁会整列丢掉 */
    const columns = Math.max(header.length, ...rows.map((row) => row.length), 1);
    const cell = (text, bold) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:vAlign w:val="center"/></w:tcPr>`
      + wParagraph(text, { bold }) + '</w:tc>';
    const row = (cells, bold) => `<w:tr>${Array.from({ length: columns }, (_, position) => cell(cells[position] ?? '', bold)).join('')}</w:tr>`;
    /* 整行表头是空的（模型漏写表头）时不要画那一行，否则成品顶上会多一排空格子 */
    const head = header.some((cell) => String(cell ?? '').trim()) ? row(header, true) : '';
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}<w:tblLayout w:type="autofit"/></w:tblPr>`
      + `<w:tblGrid>${Array.from({ length: columns }, () => '<w:gridCol w:w="2000"/>').join('')}</w:tblGrid>`
      + head
      + rows.map((cells) => row(cells, false)).join('')
      + '</w:tbl><w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>';
  }

  function blocksToWord(blocks, kit) {
    const para = (text, opts) => (kit ? kitParagraph(kit, text, opts || {}) : wParagraph(text, opts || {}));
    const table = (header, rows) => (kit ? kitTable(kit, header, rows) : wTable(header, rows));
    return blocks.map((block) => {
      switch (block.type) {
        case 'heading': return para(block.text, kit ? { level: Math.min(block.level, 4) } : { style: `Heading${Math.min(block.level, 4)}` });
        case 'table': return table(block.header, block.rows);
        case 'list': return block.items.map((item) => para(`${block.ordered ? '·' : '•'} ${item}`, { indent: 360 })).join('');
        case 'quote': return para(block.text, { italic: true, indent: 360 });
        case 'hr': return para('──────────', { align: 'center' });
        default: return (block.lines || []).map((line) => para(line)).join('');
      }
    }).join('');
  }

  function docxStyles() {
    const heading = (id, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${id.slice(-1)}"/>`
      + `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/>`
      + `<w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr>`
      + `<w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    return `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="等线" w:cs="Calibri"/>'
      + '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>'
      + '<w:pPr><w:spacing w:before="240" w:after="240"/><w:jc w:val="center"/></w:pPr>'
      + '<w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>'
      + heading('Heading1', 32, 320) + heading('Heading2', 28, 240)
      + heading('Heading3', 24, 200) + heading('Heading4', 22, 160)
      + '</w:styles>';
  }

  /* ── 参考版式：按上传参考的样式表 / 页面设置 / 页眉页脚排版 ──
     参考件（core/docx.js 的 styleKit）把「样子」取出来，这里照着它写正文：
     段落样式、表格线、纸张与页边距、页眉页脚都跟原表一致，内容换成我们生成的。 */

  const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEADER_RID_BASE = 100;
  const HEADING_SIZE = [0, 32, 28, 24, 22];
  const HEADING_BEFORE = [0, 320, 240, 200, 160];
  const KIT_EXTRA_PARTS = ['word/numbering.xml', 'word/settings.xml', 'word/webSettings.xml', 'word/fontTable.xml', 'word/theme/theme1.xml'];
  const PART_TYPES = {
    'word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
    'word/numbering.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
    'word/settings.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    'word/webSettings.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml',
    'word/fontTable.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
    'word/theme/theme1.xml': 'application/vnd.openxmlformats-officedocument.theme+xml'
  };
  const PART_RELS = {
    'word/styles.xml': 'styles',
    'word/numbering.xml': 'numbering',
    'word/settings.xml': 'settings',
    'word/webSettings.xml': 'webSettings',
    'word/fontTable.xml': 'fontTable',
    'word/theme/theme1.xml': 'theme'
  };

  const base64ToBytes = (text) => {
    const binary = atob(String(text || ''));
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
  };

  const parentOf = (partPath) => partPath.slice(0, partPath.lastIndexOf('/'));
  const relsPathOf = (partPath) => `${parentOf(partPath)}/_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`;

  /* OOXML 的关系 Target 用相对路径，这里把包内绝对路径换算回去 */
  function relTarget(fromPath, toPath) {
    const from = parentOf(fromPath).split('/').filter(Boolean);
    const to = String(toPath).split('/').filter(Boolean);
    while (from.length && to.length > 1 && from[0] === to[0]) { from.shift(); to.shift(); }
    return [...from.map(() => '..'), ...to].join('/');
  }

  const patchProps = (pPr, tag, pattern) => (pattern.test(pPr) ? pPr.replace(pattern, tag) : pPr.replace(/<\/w:pPr>/, `${tag}</w:pPr>`));
  const withIndent = (pPr, indent) => (indent ? patchProps(pPr, `<w:ind w:left="${indent}"/>`, /<w:ind\b[^>]*\/>/) : pPr);
  const withAlign = (pPr, align) => (align ? patchProps(pPr, `<w:jc w:val="${align}"/>`, /<w:jc\b[^>]*\/>/) : pPr);

  /* 段落：优先用参考里同款段落的 pPr（字体字号、行距、缩进、编号都在里面），
     参考没给这种段落时退回内置字号，字体仍继承参考的 docDefaults */
  function kitParagraph(kit, text, opts = {}) {
    const level = Math.min(Math.max(opts.level || 0, 0), 4);
    const sample = level ? (kit.pPr?.[`heading${level}`] || kit.pPr?.heading1 || '') : (kit.pPr?.body || '');
    const styleId = level ? (kit.headingIds?.[level] || kit.headingIds?.[1] || '') : '';
    const plain = level > 0 && !sample && !styleId;
    const fallback = level
      ? (styleId ? `<w:pStyle w:val="${styleId}"/>` : `<w:spacing w:before="${HEADING_BEFORE[level]}" w:after="120"/>`)
      : '<w:spacing w:after="120"/>';
    const pPr = withAlign(withIndent(sample || `<w:pPr>${fallback}</w:pPr>`, opts.indent), opts.align);
    return `<w:p>${pPr}${wRun(text, {
      bold: Boolean(opts.bold) || plain,
      italic: opts.italic,
      size: opts.size || (plain ? HEADING_SIZE[level] : 0)
    })}</w:p>`;
  }

  /* 列宽：我们这张表的列数与参考表格一致时照抄参考的列宽（形状一样，最贴原表）；
     不一致时按参考表格的总宽均分——参考那张表往往是「序号列 + 若干窄列」的表单，
     硬套前几列会把生成的表挤成一条。 */
  function kitGrid(kit, columns) {
    const widths = [...String(kit.tblGrid || '').matchAll(/<w:gridCol[^>]*w:w="(\d+)"/g)].map((match) => Number(match[1]));
    if (widths.length === columns) return widths;
    const total = widths.reduce((sum, width) => sum + width, 0) || 9360;
    const each = Math.max(600, Math.round(total / columns));
    return Array.from({ length: columns }, () => each);
  }

  /* 表格：照抄参考第一张多行表的 tblPr / tblGrid（边框、底纹、对齐），列宽见 kitGrid */
  function kitTable(kit, header, rows) {
    const columns = Math.max(header.length, ...rows.map((row) => row.length), 1);
    const widths = kitGrid(kit, columns);
    const widthOf = (index) => widths[Math.min(index, widths.length - 1)];
    const tblPr = String(kit.tblPr || '').replace(/<w:tblStyle\b[^>]*\/>/, '')
      || '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/></w:tblPr>';
    const cell = (text, bold, column) => '<w:tc><w:tcPr>'
      + `<w:tcW w:w="${widthOf(column)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>`
      + kitParagraph(kit, text, { bold }) + '</w:tc>';
    const row = (cells, bold) => `<w:tr>${Array.from({ length: columns }, (_, column) => cell(cells[column] ?? '', bold, column)).join('')}</w:tr>`;
    const head = header.some((cell) => String(cell ?? '').trim()) ? row(header, true) : '';
    return `<w:tbl>${tblPr}<w:tblGrid>${Array.from({ length: columns }, (_, column) => `<w:gridCol w:w="${widthOf(column)}"/>`).join('')}</w:tblGrid>`
      + head + rows.map((cells) => row(cells, false)).join('')
      + '</w:tbl><w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>';
  }

  /* 页眉页脚引用必须排在 sectPr 的最前面，rId 用我们自己的编号 */
  function kitSectPr(kit) {
    const refs = (kit.refs || []).map((ref, index) =>
      `<w:${ref.kind}Reference w:type="${ref.type || 'default'}" r:id="rId${HEADER_RID_BASE + index}"/>`).join('');
    const raw = String(kit.sectPr || '');
    if (!raw) return `<w:sectPr>${refs}<w:pgSz w:w="11906" w:h="16838"/>`
      + '<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>';
    if (/^<w:sectPr\b[^>]*\/>$/.test(raw)) return raw.replace(/\/>$/, `>${refs}</w:sectPr>`);
    return refs ? raw.replace(/(<w:sectPr\b[^>]*>)/, `$1${refs}`) : raw;
  }

  /* 正文根节点沿用参考的命名空间声明（sectPr 里可能有 w14 之类的属性） */
  function documentAttrs(kit) {
    let attrs = String(kit.docAttrs || '').trim();
    if (!/xmlns:w=/.test(attrs)) attrs = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ${attrs}`.trim();
    if (!/xmlns:r=/.test(attrs)) attrs += ` xmlns:r="${REL_BASE}"`;
    return attrs.trim();
  }

  function kitContentTypes(parts, refs, media) {
    const defaults = new Set(['rels', 'xml']);
    for (const file of media) defaults.add(String(file.ext || file.path.split('.').pop() || 'png').toLowerCase());
    return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + [...defaults].map((ext) => `<Default Extension="${ext}" ContentType="${ext === 'rels'
        ? 'application/vnd.openxmlformats-package.relationships+xml' : ext === 'xml' ? 'application/xml' : `image/${ext}`}"/>`).join('')
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + KIT_EXTRA_PARTS.filter((path) => parts[path])
        .map((path) => `<Override PartName="/${path}" ContentType="${PART_TYPES[path]}"/>`).join('')
      + refs.map((ref) => `<Override PartName="/${ref.path}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${ref.kind}+xml"/>`).join('')
      + '</Types>';
  }

  function kitDocumentRels(parts, refs) {
    const own = ['word/styles.xml', ...KIT_EXTRA_PARTS].filter((path) => path === 'word/styles.xml' || parts[path]);
    return `${XML}<Relationships xmlns="${RELS_NS}">`
      + own.map((path, index) => `<Relationship Id="rId${index + 1}" Type="${REL_BASE}/${PART_RELS[path]}" Target="${relTarget('word/document.xml', path)}"/>`).join('')
      + refs.map((ref, index) => `<Relationship Id="rId${HEADER_RID_BASE + index}" Type="${REL_BASE}/${ref.kind}" Target="${relTarget('word/document.xml', ref.path)}"/>`).join('')
      + '</Relationships>';
  }

  function kitHeaderRels(ref) {
    return `${XML}<Relationships xmlns="${RELS_NS}">`
      + (ref.media || []).map((file) => `<Relationship Id="${file.rid}" Type="${REL_BASE}/image" Target="${relTarget(ref.path, file.path)}"/>`).join('')
      + '</Relationships>';
  }

  /* 有版式套件就走这条：样式表 / 页眉页脚 / 页面设置都来自参考，正文用生成的 */
  function docxWithKit(spec, kit) {
    const blocks = spec.blocks || [];
    /* styles.xml 决定 pStyle 与段落样本能不能用；没有它就只能借参考的页面设置与页眉页脚 */
    const styled = kit.parts?.['word/styles.xml'] ? kit : null;
    const title = spec.title
      ? (styled && styled.pPr?.title ? `<w:p>${styled.pPr.title}${wRun(spec.title)}</w:p>`
        : styled ? kitParagraph(styled, spec.title, { align: 'center', size: 36, bold: true })
          : wParagraph(spec.title, { align: 'center' }))
      : '';
    const subtitle = spec.subtitle && (styled ? kitParagraph(styled, spec.subtitle, { align: 'center' }) : wParagraph(spec.subtitle, { align: 'center' }));
    const body = title + subtitle + blocksToWord(blocks, styled);
    const document = `${XML}<w:document ${documentAttrs(kit)}>`
      + `<w:body>${body}${kitSectPr(kit)}</w:body></w:document>`;
    const parts = kit.parts || {};
    const refs = kit.refs || [];
    const media = kit.media || [];
    const files = [
      { name: '[Content_Types].xml', data: kitContentTypes(parts, refs, media) },
      { name: '_rels/.rels', data: `${XML}<Relationships xmlns="${RELS_NS}">`
        + `<Relationship Id="rId1" Type="${REL_BASE}/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: 'word/document.xml', data: document },
      { name: 'word/_rels/document.xml.rels', data: kitDocumentRels(parts, refs) },
      { name: 'word/styles.xml', data: parts['word/styles.xml'] || docxStyles() }
    ];
    for (const path of KIT_EXTRA_PARTS) if (parts[path]) files.push({ name: path, data: parts[path] });
    for (const ref of refs) {
      files.push({ name: ref.path, data: ref.xml });
      if ((ref.media || []).length) files.push({ name: relsPathOf(ref.path), data: kitHeaderRels(ref) });
    }
    for (const file of media) files.push({ name: file.path, data: base64ToBytes(file.b64) });
    return zip(files, spec.when);
  }

  function docx(spec) {
    const kit = spec.style && (spec.style.parts || spec.style.sectPr) ? spec.style : null;
    if (!kit) return docxStandard(spec);
    return docxWithKit(spec, kit);
  }

  function docxStandard(spec) {
    const blocks = spec.blocks || [];
    const body = (spec.title ? wParagraph(spec.title, { style: 'Title' }) : '')
      + (spec.subtitle ? wParagraph(spec.subtitle, { align: 'center' }) : '')
      + blocksToWord(blocks);
    const document = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>`
      + '<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="851" w:footer="992" w:gutter="0"/>'
      + '</w:sectPr></w:body></w:document>';
    const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '</Types>';
    const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>';
    const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>';
    return zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: docxStyles() },
      { name: 'word/_rels/document.xml.rels', data: docRels }
    ], spec.when);
  }

  /* ── Excel ────────────────────────────── */
  const columnName = (index) => {
    let value = index + 1;
    let name = '';
    while (value > 0) { const rest = (value - 1) % 26; name = String.fromCharCode(65 + rest) + name; value = Math.floor((value - 1) / 26); }
    return name;
  };

  const sheetName = (raw, fallback) => {
    const cleaned = String(raw ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/^\s*[一二三四五六七八九十\d]+[、.．]\s*/, '').trim();
    return (cleaned || fallback).slice(0, 31);
  };

  function xlsxStyles() {
    return `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + '<fonts count="3"><font><sz val="11"/><name val="等线"/></font>'
      + '<font><b/><sz val="11"/><name val="等线"/></font>'
      + '<font><b/><sz val="14"/><name val="等线"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
      + '<border><left style="thin"><color rgb="FFA6B1C2"/></left><right style="thin"><color rgb="FFA6B1C2"/></right>'
      + '<top style="thin"><color rgb="FFA6B1C2"/></top><bottom style="thin"><color rgb="FFA6B1C2"/></bottom><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="4">'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'
      + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '</cellXfs></styleSheet>';
  }

  function xlsxSheet(sheet) {
    const rows = sheet.rows || [];
    const width = sheet.widths || [];
    const cols = width.length
      ? `<cols>${width.map((value, index) => `<col min="${index + 1}" max="${index + 1}" width="${value}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const xmlRows = rows.map((cells, rowIndex) => {
      const number = rowIndex + 1;
      const style = rowIndex === 0 ? 1 : 2;
      const body = (cells || []).map((value, columnIndex) => {
        const text = String(value ?? '');
        if (!text) return '';
        return `<c r="${columnName(columnIndex)}${number}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`;
      }).join('');
      return `<row r="${number}">${body}</row>`;
    }).join('');
    return `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      + '<sheetFormatPr defaultRowHeight="18"/>'
      + `${cols || '<cols><col min="1" max="8" width="16" customWidth="1"/></cols>'}<sheetData>${xmlRows}</sheetData>`
      + '</worksheet>';
  }

  function xlsx(spec) {
    const sheets = (spec.sheets || []).filter((sheet) => sheet.rows && sheet.rows.length);
    if (!sheets.length) sheets.push({ name: spec.title || '工作表', rows: [[spec.title || '（空）']] });
    const used = new Map();
    const named = sheets.map((sheet, index) => {
      let name = sheetName(sheet.name, `工作表${index + 1}`);
      const seen = used.get(name) || 0;
      used.set(name, seen + 1);
      if (seen) name = `${name.slice(0, 28)}(${seen + 1})`;
      return { name, xml: xlsxSheet(sheet) };
    });
    const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + named.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>';
    const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>';
    const workbook = `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + named.map((sheet, index) => `<sheet name="${escXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
      + '</sheets></workbook>';
    const workbookRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + named.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>';
    return zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml', data: xlsxStyles() },
      ...named.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.xml }))
    ], spec.when);
  }

  /* 反向读取：把 ZIP 解回 [{ name, method, size, data }]，供自测核对产物内容。
     本模块自己写的条目都是 STORE（method 0），直接按偏移切片就是原文；
     照搬参考件压缩字节的条目（method 8）data 是压缩态，要先用 WB.docx 的
     entryBytes + DecompressionStream 解开再读。 */
  function readEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder('utf-8');
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) return [];
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      const nameLength = view.getUint16(pos + 28, true);
      const extraLength = view.getUint16(pos + 30, true);
      const commentLength = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      const method = view.getUint16(pos + 10, true);
      const compressed = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      entries.push({ name, method, size, data: bytes.subarray(start, start + (method === 0 ? size : compressed)) });
      pos += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  window.WB.ooxml = { zip, crc32, docx, xlsx, readEntries, columnName, sheetName, escXml };
})();