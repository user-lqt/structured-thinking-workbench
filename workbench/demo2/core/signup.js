/* 参与者信息收集（可选能力）：字段自定义、填写页链接与二维码、现场提交的合并与导出。
   和 core/qr.js 一样是纯函数模块：不碰 DOM，也不依赖 window.WB.util ——
   因为独立填写页 signup.html 只加载本文件 + core/qr.js，手机上要尽量轻。
   数据流向：
     工作台（字段定义）→ 打包成「表单码」→ 写进填写页链接/二维码
     填写页（现场提交）→ 追加到 append-only 队列 → 工作台折叠进 records（同源实时同步）
     跨设备（手机浏览器没有本机存储）→ 参与者把「回执码」发回给组织者 → 工作台粘贴导入
   队列与回执码用同一套字符串格式（R1|…），所以「导入回执码」和「同步队列」是同一条解析路径。 */
window.WB = window.WB || {};

(function () {
  const SCHEMA_VERSION = 'S1';
  const RECEIPT_VERSION = 'R1';
  const FORM_PREFIX = 'demo2-signup-form-';
  const QUEUE_PREFIX = 'demo2-signup-queue-';
  const MINE_PREFIX = 'demo2-signup-mine-';
  const MAX_FIELDS = 12;
  const MAX_OPTIONS = 8;

  const TYPE_LABEL = {
    text: '单行文本', number: '数字', phone: '手机号', email: '邮箱',
    select: '单选', date: '日期', textarea: '多行文本', checkbox: '勾选确认'
  };
  const TYPE_CODE = { text: 't', number: 'n', phone: 'p', email: 'e', select: 's', date: 'd', textarea: 'm', checkbox: 'c' };
  const CODE_TYPE = { t: 'text', n: 'number', p: 'phone', e: 'email', s: 'select', d: 'date', m: 'textarea', c: 'checkbox' };

  /* 现场小活动常用的四套字段，管理者点一下就能换 */
  const PRESETS = [
    {
      id: 'minimal', label: '最小信息', hint: '姓名 + 学号 + 班级 + 手机，问得少、填得快，二维码也装得下',
      key: '学号',
      fields: [
        { label: '姓名', type: 'text', required: true },
        { label: '学号', type: 'text', required: true },
        { label: '班级', type: 'text' },
        { label: '手机', type: 'phone', required: true },
        { label: '备注', type: 'textarea' }
      ]
    },
    {
      id: 'signup', label: '报名信息', hint: '在最小信息上加邮箱与报名项目，适合需要分组或分赛道的活动',
      key: '学号',
      fields: [
        { label: '姓名', type: 'text', required: true },
        { label: '学号', type: 'text', required: true },
        { label: '班级', type: 'text' },
        { label: '手机', type: 'phone', required: true },
        { label: '邮箱', type: 'email' },
        { label: '报名项目', type: 'select', options: ['主舞台', '互动展位', '志愿服务', '观众'] },
        { label: '备注', type: 'textarea' }
      ]
    },
    {
      id: 'checkin', label: '现场签到', hint: '姓名 + 学号 + 手机，现场扫码登记，管理者可一键代签',
      key: '学号',
      fields: [
        { label: '姓名', type: 'text', required: true },
        { label: '学号', type: 'text', required: true },
        { label: '手机', type: 'phone' },
        { label: '到场方式', type: 'select', options: ['自行到场', '随班集队', '工作人员'] }
      ]
    },
    {
      id: 'feedback', label: '活动反馈', hint: '活动进行中或结束后收集参与感受，字段少、多为选项',
      key: '姓名',
      fields: [
        { label: '姓名', type: 'text' },
        { label: '参与环节', type: 'select', options: ['主舞台', '互动展位', '志愿服务', '观众'] },
        { label: '满意度', type: 'select', required: true, options: ['很满意', '满意', '一般', '不满意'] },
        { label: '建议', type: 'textarea' }
      ]
    }
  ];

  /* ── 本地小工具（刻意不依赖 window.WB.util） ── */
  const text = (value) => String(value == null ? '' : value).trim();
  let seq = 0;
  const uid = (prefix) => {
    seq += 1;
    return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  };
  const base36 = (value) => Math.max(0, Math.floor(value || 0)).toString(36);
  const fromBase36 = (value, fallback = 0) => {
    const num = parseInt(text(value), 36);
    return Number.isFinite(num) ? num : fallback;
  };
  /* 打包用的分隔符必须避开：字段名、选项里一律换成顿号 */
  const cleanSeg = (value, max = 40) => text(value).replace(/[|;~]/g, '、').slice(0, max);
  const cleanUnit = (value, max = 40) => text(value).replace(/[|;~/]/g, '、').slice(0, max);
  const cleanLine = (value, max = 60) => text(value).replace(/[|]/g, '、').slice(0, max);
  const bytes = (value) => (window.WB.qr ? window.WB.qr.byteLength(value) : text(value).length * 2);

  const storageOf = (storage) => {
    if (storage) return storage;
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
  };
  const readJson = (storage, key, fallback) => {
    const store = storageOf(storage);
    if (!store) return fallback;
    try {
      const parsed = JSON.parse(store.getItem(key) || 'null');
      return parsed == null ? fallback : parsed;
    } catch { return fallback; }
  };
  const writeJson = (storage, key, value) => {
    const store = storageOf(storage);
    if (!store) return false;
    try { store.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };

  /* ── 字段 ─────────────────────────────── */

  function freshField(source = {}, index = 0) {
    const type = TYPE_LABEL[source.type] ? source.type : 'text';
    return {
      id: text(source.id) || `cf${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
      label: text(source.label) || `字段 ${index + 1}`,
      type,
      required: Boolean(source.required),
      options: (Array.isArray(source.options) ? source.options : []).map((item) => cleanUnit(item)).filter(Boolean).slice(0, MAX_OPTIONS)
    };
  }

  function fresh(options = {}) {
    const preset = PRESETS.find((item) => item.id === options.preset) || PRESETS[0];
    const fields = (options.fields || preset.fields).map(freshField);
    return {
      enabled: options.enabled === undefined ? false : Boolean(options.enabled),
      title: text(options.title),
      note: text(options.note),
      preset: preset.id,
      fields,
      keyField: keyIdOf(fields, options.keyField || preset.key),
      base: text(options.base),
      records: [],
      applied: 0,
      updatedAt: ''
    };
  }

  function keyIdOf(fields, wanted) {
    const target = text(wanted);
    if (!target) return '';
    const hit = fields.find((field) => field.id === target || field.label === target);
    return hit ? hit.id : '';
  }

  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return fresh();
    const fields = (Array.isArray(raw.fields) && raw.fields.length ? raw.fields : PRESETS[0].fields)
      .slice(0, MAX_FIELDS).map(freshField);
    const known = new Set(fields.map((field) => field.id));
    const records = (Array.isArray(raw.records) ? raw.records : []).map((record) => ({
      id: text(record.id) || uid('rec'),
      at: Number(record.at) || Date.now(),
      source: ['scan', 'import', 'manual', 'link'].includes(record.source) ? record.source : 'manual',
      values: Object.fromEntries(Object.entries(record.values || {})
        .filter(([key]) => known.has(key) || key.startsWith('x'))
        .map(([key, value]) => [key, text(value)])),
      checkinAt: Number(record.checkinAt) || 0,
      ua: text(record.ua),
      note: text(record.note),
      schemaChanged: Boolean(record.schemaChanged)
    }));
    return {
      enabled: Boolean(raw.enabled),
      title: text(raw.title).slice(0, 40),
      note: text(raw.note).slice(0, 300),
      preset: PRESETS.some((item) => item.id === raw.preset) ? raw.preset : 'custom',
      fields,
      keyField: known.has(text(raw.keyField)) ? text(raw.keyField) : '',
      base: text(raw.base),
      records,
      applied: Number.isFinite(Number(raw.applied)) ? Math.max(0, Number(raw.applied)) : 0,
      updatedAt: text(raw.updatedAt)
    };
  }

  function applyPreset(signup, presetId) {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return signup;
    signup.preset = preset.id;
    signup.fields = preset.fields.map(freshField);
    signup.keyField = keyIdOf(signup.fields, preset.key);
    return signup;
  }

  function addField(signup, source = {}) {
    if (signup.fields.length >= MAX_FIELDS) return null;
    const field = freshField({ ...source, id: '' }, signup.fields.length);
    signup.fields.push(field);
    signup.preset = 'custom';
    return field;
  }

  function moveField(signup, index, delta) {
    const to = index + delta;
    if (index < 0 || index >= signup.fields.length || to < 0 || to >= signup.fields.length) return false;
    const [field] = signup.fields.splice(index, 1);
    signup.fields.splice(to, 0, field);
    signup.preset = 'custom';
    return true;
  }

  function removeField(signup, index) {
    if (index < 0 || index >= signup.fields.length) return false;
    const [field] = signup.fields.splice(index, 1);
    if (signup.keyField === field.id) signup.keyField = '';
    return true;
  }

  function fieldByLabel(signup, label) {
    const target = text(label);
    return signup.fields.find((field) => field.label === target) || null;
  }

  /* ── 表单码（字段定义随链接/二维码走） ─────── */

  function encodeBase64Url(input) {
    const raw = String(input == null ? '' : input);
    if (typeof TextEncoder === 'function' && typeof btoa === 'function') {
      const list = Array.from(new TextEncoder().encode(raw));
      let binary = '';
      for (const byte of list) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    /* 无 btoa 的环境（自测 / 老浏览器）走手写 base64 */
    const list = window.WB.qr ? window.WB.qr.utf8(raw) : Array.from(unescape(encodeURIComponent(raw)), (c) => c.charCodeAt(0));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let out = '';
    for (let i = 0; i < list.length; i += 3) {
      const chunk = (list[i] << 16) | ((list[i + 1] || 0) << 8) | (list[i + 2] || 0);
      const remain = list.length - i;
      out += alphabet[(chunk >> 18) & 63] + alphabet[(chunk >> 12) & 63];
      if (remain > 1) out += alphabet[(chunk >> 6) & 63];
      if (remain > 2) out += alphabet[chunk & 63];
    }
    return out;
  }

  function decodeBase64Url(code) {
    const source = text(code).replace(/-/g, '+').replace(/_/g, '/');
    if (typeof atob === 'function') {
      const binary = atob(source + '='.repeat((4 - (source.length % 4)) % 4));
      const list = Array.from(binary, (char) => char.charCodeAt(0));
      return typeof TextDecoder === 'function' ? new TextDecoder().decode(Uint8Array.from(list)) : binary;
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const cleaned = source.replace(/[^A-Za-z0-9\-_]/g, '');
    const out = [];
    for (let i = 0; i < cleaned.length; i += 4) {
      const chunk = [0, 1, 2, 3].map((offset) => (i + offset < cleaned.length ? alphabet.indexOf(cleaned[i + offset]) : -1));
      const packed = (Math.max(0, chunk[0]) << 18) | (Math.max(0, chunk[1]) << 12) | (Math.max(0, chunk[2]) << 6) | Math.max(0, chunk[3]);
      out.push((packed >> 16) & 255);
      if (chunk[2] >= 0) out.push((packed >> 8) & 255);
      if (chunk[3] >= 0) out.push(packed & 255);
    }
    return decodeUtf8(out);
  }

  function decodeUtf8(list) {
    let out = '';
    for (let i = 0; i < list.length;) {
      const byte = list[i];
      if (byte < 0x80) { out += String.fromCharCode(byte); i += 1; continue; }
      if (byte < 0xe0) { out += String.fromCharCode(((byte & 0x1f) << 6) | (list[i + 1] & 0x3f)); i += 2; continue; }
      if (byte < 0xf0) { out += String.fromCharCode(((byte & 0x0f) << 12) | ((list[i + 1] & 0x3f) << 6) | (list[i + 2] & 0x3f)); i += 3; continue; }
      const point = ((byte & 0x07) << 18) | ((list[i + 1] & 0x3f) << 12) | ((list[i + 2] & 0x3f) << 6) | (list[i + 3] & 0x3f);
      out += String.fromCodePoint(point);
      i += 4;
    }
    return out;
  }

  /* level: 'full' 带标题与须知 / 'plain' 只带字段定义 */
  function packSchema(signup, level = 'full') {
    const parts = [];
    if (level === 'full') {
      if (text(signup.title)) parts.push(`t${cleanLine(signup.title, 40)}`);
      if (text(signup.note)) parts.push(`n${cleanLine(signup.note, 120)}`);
    }
    /* 去重字段用标签尾部的 * 标记，比单独写一个 k<索引> 段省 3 字节 —— 二维码容量很紧张 */
    parts.push(signup.fields.map((field) => {
      const starred = field.id === signup.keyField;
      const segs = [cleanSeg(field.label, 12) + (starred ? '*' : '')];
      const code = TYPE_CODE[field.type];
      if (code && code !== 't') segs.push(code);
      if (field.required) segs.push('1');
      if (field.type === 'select' && field.options.length) segs.push(field.options.map((option) => cleanUnit(option, 8)).join('/'));
      return segs.join(',');
    }).join(';'));
    return `${SCHEMA_VERSION}|${parts.join('|')}`;
  }

  /* 表单码有两种来路：链接/二维码里是 base64url（ASCII 安全），手工粘贴的是明文，都要认 */
  function unpackSchema(code) {
    let raw = text(code);
    if (!raw) return null;
    try { raw = decodeURIComponent(raw); } catch { /* 原样 */ }
    if (!raw.includes('|') && /^[A-Za-z0-9_-]+$/.test(raw)) {
      try {
        const decoded = decodeBase64Url(raw);
        if (decoded && decoded.includes('|')) raw = decoded;
      } catch { /* 不是 base64url 就当明文处理 */ }
    }
    /* 必须带版本前缀：这样「粘了一堆无关文字」会被判为无效码，而不是被当成只有一个乱名字段 */
    if (!raw.startsWith(`${SCHEMA_VERSION}|`)) return null;
    raw = raw.slice(SCHEMA_VERSION.length + 1);
    const parts = raw.split('|').filter((part) => part !== '');
    if (!parts.length) return null;
    const fieldPart = parts[parts.length - 1];
    const heads = parts.slice(0, -1);
    const fields = fieldPart.split(';').filter(Boolean).slice(0, MAX_FIELDS).map((chunk, index) => {
      const segs = chunk.split(',');
      const rawLabel = text(segs.shift());
      const starred = rawLabel.endsWith('*');
      const label = (starred ? rawLabel.slice(0, -1) : rawLabel) || `字段 ${index + 1}`;
      let type = 'text';
      let required = false;
      let options = [];
      for (const seg of segs) {
        if (seg === '1') { required = true; continue; }
        if (CODE_TYPE[seg]) { type = CODE_TYPE[seg]; continue; }
        options = seg.split('/').map((item) => text(item)).filter(Boolean).slice(0, MAX_OPTIONS);
      }
      if (type === 'select' && !options.length) options = ['是', '否'];
      return { id: `f${index + 1}`, label, type, required, options, starred };
    });
    if (!fields.length) return null;
    let title = '';
    let note = '';
    for (const head of heads) {
      if (head.startsWith('t')) title = head.slice(1);
      else if (head.startsWith('n')) note = head.slice(1);
    }
    const keyField = (fields.find((field) => field.starred) || {}).id || '';
    return {
      title,
      note,
      keyField,
      fields: fields.map(({ starred, ...field }) => field)
    };
  }

  /* 表单指纹：字段结构一变就变，用来提醒「这份回执是按旧表单填的」 */
  function fingerprint(signup) {
    const source = packSchema({ ...signup, title: '', note: '' }, 'plain');
    let hash = 5381;
    const list = window.WB.qr ? window.WB.qr.utf8(source) : Array.from(source, (c) => c.charCodeAt(0));
    for (const byte of list) hash = ((hash * 33) ^ byte) >>> 0;
    return hash.toString(36).slice(-4).padStart(4, '0');
  }

  /* ── 链接与二维码 ─────────────────────── */

  /* 填写页地址：base 留空就用「当前网址所在目录」，所以静态托管 / 换端口都不用改；
     也容忍三种写法：站点根（http://host:4175）、目录（https://host/demo2/）、整页地址（…/signup.html），
     避免粘成 signup.html/signup.html。 */
  function pageUrl(base) {
    const fallback = typeof location === 'undefined' ? '' : `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
    const clean = (text(base) || fallback).replace(/\/+$/, '');
    if (/\.html?$/i.test(clean)) return clean;
    return clean ? `${clean}/signup.html` : 'signup.html';
  }

  /* 二维码装不下时逐级降级：带标题须知 → 不带须知 → 只带字段定义 → 去掉项目号 → 只剩短链。
     先试「信息最全」的组合，装不下再退回；返回的 code 始终是最全的那份，供「表单码」面板粘贴。
     options.short：短码模式——链接里只放 p=，表单定义由本机服务按短码提供（工作台连着
     server.mjs / 隧道时用）。这样再长的域名也塞得下，标题与须知也不会被降级丢掉。 */
  function linkFor(signup, projectId, base, options = {}) {
    const url = pageUrl(base);
    const limit = window.WB.qr ? window.WB.qr.MAX_BYTES : 122;
    const code = packSchema(signup, 'full');
    const id = text(projectId);
    const ladder = options.short
      ? [{ level: 'short', withId: true, schema: '' }]
      : [
        { level: 'full', withId: true, schema: code },
        { level: 'full', withId: false, schema: code },
        { level: 'plain', withId: true, schema: packSchema(signup, 'plain') },
        { level: 'plain', withId: false, schema: packSchema(signup, 'plain') }
      ];
    for (const candidate of ladder) {
      const params = [];
      if (candidate.withId && id) params.push(`p=${encodeURIComponent(id)}`);
      if (candidate.schema) params.push(`d=${encodeBase64Url(candidate.schema)}`);
      const link = `${url}#${params.join('&')}`;
      if (window.WB.qr ? window.WB.qr.fits(link) : bytes(link) <= limit) {
        return { url: link, code, bytes: bytes(link), limit, fits: true, level: candidate.level, withId: candidate.withId };
      }
    }
    const shortUrl = id ? `${url}#p=${encodeURIComponent(id)}` : url;
    return { url: shortUrl, code, bytes: bytes(shortUrl), limit, fits: false, level: 'none', withId: Boolean(id) };
  }

  function qrSvg(url, options = {}) {
    if (!window.WB.qr) return null;
    return window.WB.qr.svg(url, { scale: options.scale || 5, margin: options.margin == null ? 3 : options.margin, label: options.label || '扫码填写' });
  }

  function storeForm(signup, projectId, storage) {
    const key = `${FORM_PREFIX}${text(projectId) || 'default'}`;
    const payload = { at: Date.now(), code: packSchema(signup, 'full'), ...unpackSchemaSafe(packSchema(signup, 'full')) };
    return writeJson(storage, key, payload);
  }

  function unpackSchemaSafe(code) {
    const parsed = unpackSchema(code);
    return parsed || { title: '', note: '', fields: [] };
  }

  function readStoredForm(projectId, storage) {
    const stored = readJson(storage, `${FORM_PREFIX}${text(projectId) || 'default'}`, null);
    if (!stored) return null;
    const parsed = unpackSchema(stored.code) || { title: '', note: '', fields: stored.fields || [] };
    if (!parsed.fields.length) return null;
    return parsed;
  }

  /* 链接里没带项目号时（表单太长、二维码放不下 p=）的兜底：
     本机如果只存过一份表单，就说明这台机器属于那个项目——同源打开
     「内置预览 / 另一个标签页」时，提交才能实时回到工作台。
     存过多份（多项目）或存在私隐限制时不猜，返回空串。 */
  function soleStoredProjectId(storage) {
    const store = storageOf(storage);
    if (!store) return '';
    const ids = [];
    try {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (typeof key === 'string' && key.startsWith(FORM_PREFIX)) ids.push(key.slice(FORM_PREFIX.length));
      }
    } catch { return ''; }
    return ids.length === 1 ? ids[0] : '';
  }

  /* ── 回执码 / 队列 ────────────────────── */

  const escapeValue = (value) => text(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const unescapeValue = (value) => text(value).replace(/\\\|/g, '|').replace(/\\\\/g, '\\');

  function packReceipt(event) {
    /* 时间戳按秒存（base36），比毫秒省 2 个字符，也够精确到「同一秒内先后」 */
    const parts = [
      RECEIPT_VERSION,
      event.kind === 'checkin' ? 'c' : 's',
      text(event.id) || uid('rec'),
      base36(Math.floor((event.at || Date.now()) / 1000)),
      text(event.h || '')
    ];
    if (event.kind !== 'checkin') parts.push(...(event.values || []).map(escapeValue));
    return parts.join('|');
  }

  function parseReceipt(raw) {
    const line = text(raw).replace(/\s+$/, '');
    if (!line) return null;
    const parts = splitEscaped(line);
    if (!parts.length) return null;
    const version = parts[0];
    if (version !== RECEIPT_VERSION) return null;
    const kind = parts[1] === 'c' ? 'checkin' : 'submit';
    const id = text(parts[2]);
    if (!id) return null;
    const at = fromBase36(parts[3]) * 1000 || Date.now();
    const h = text(parts[4]);
    const values = kind === 'submit' ? parts.slice(5).map(unescapeValue) : [];
    return { kind, id, at, h, values, source: 'scan' };
  }

  /* 按 \| 拆开，但保留被转义的竖线 */
  function splitEscaped(line) {
    const out = [];
    let current = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '\\' && line[i + 1] === '|') { current += '\\|'; i += 1; continue; }
      if (char === '|') { out.push(current); current = ''; continue; }
      current += char;
    }
    out.push(current);
    return out;
  }

  function queueKey(projectId) { return `${QUEUE_PREFIX}${text(projectId) || 'default'}`; }
  function formKey(projectId) { return `${FORM_PREFIX}${text(projectId) || 'default'}`; }
  function mineKey(projectId) { return `${MINE_PREFIX}${text(projectId) || 'default'}`; }

  function readQueue(projectId, storage) {
    const list = readJson(storage, queueKey(projectId), []);
    return Array.isArray(list) ? list : [];
  }

  /* 追加是「读-改-写」，同一浏览器里的并发提交很少，够用；折叠按记录 id 去重，重复也安全 */
  function appendToQueue(projectId, code, storage) {
    const list = readQueue(projectId, storage);
    list.push(text(code));
    return writeJson(storage, queueKey(projectId), list) ? list.length : 0;
  }

  function clearQueue(projectId, storage) {
    const store = storageOf(storage);
    if (!store) return false;
    try { store.removeItem(queueKey(projectId)); return true; } catch { return false; }
  }

  function valuesToFields(signup, values) {
    const out = {};
    (values || []).forEach((value, index) => {
      const field = signup.fields[index];
      if (!field) { out[`x${index + 1}`] = text(value); return; }
      out[field.id] = text(value);
    });
    return out;
  }

  function fieldsToValues(signup, record) {
    return signup.fields.map((field) => text(record.values[field.id]));
  }

  /* 把一批事件（回执码字符串或事件对象）折进 records；按 id 幂等，重复导入不会翻倍 */
  function mergeEvents(signup, events, options = {}) {
    const result = { added: 0, updated: 0, checkin: 0, ignored: 0, stale: 0 };
    const mine = fingerprint(signup);
    const byId = new Map(signup.records.map((record) => [record.id, record]));
    for (const raw of events || []) {
      const event = typeof raw === 'string' ? parseReceipt(raw) : (raw && typeof raw === 'object' ? normaliseEvent(raw) : null);
      if (!event) { result.ignored += 1; continue; }
      if (event.kind === 'checkin') {
        const record = byId.get(event.id);
        if (!record) { result.ignored += 1; continue; }
        if (!record.checkinAt || event.at < record.checkinAt) { record.checkinAt = event.at; result.checkin += 1; }
        continue;
      }
      const values = valuesToFields(signup, event.values);
      const existing = byId.get(event.id);
      const stale = Boolean(event.h) && event.h !== mine;
      if (existing) {
        existing.values = { ...existing.values, ...values };
        existing.at = event.at;
        existing.schemaChanged = stale;
        result.updated += 1;
        if (stale) result.stale += 1;
        continue;
      }
      const record = {
        id: event.id,
        at: event.at,
        source: options.source || event.source || 'scan',
        values,
        checkinAt: 0,
        ua: text(event.ua),
        note: '',
        schemaChanged: stale
      };
      signup.records.push(record);
      byId.set(record.id, record);
      result.added += 1;
      if (stale) result.stale += 1;
    }
    signup.records.sort((a, b) => a.at - b.at);
    signup.updatedAt = new Date().toISOString();
    return result;
  }

  function normaliseEvent(raw) {
    if (raw.kind === 'checkin') {
      return { kind: 'checkin', id: text(raw.id), at: Number(raw.at) || Date.now(), h: text(raw.h) };
    }
    return {
      kind: 'submit',
      id: text(raw.id) || uid('rec'),
      at: Number(raw.at) || Date.now(),
      h: text(raw.h),
      values: Array.isArray(raw.values) ? raw.values.map((value) => text(value)) : [],
      ua: text(raw.ua),
      source: text(raw.source)
    };
  }

  /* 同源实时同步：把队列里还没折过的部分折进 records */
  function syncFromQueue(signup, projectId, storage) {
    const queue = readQueue(projectId, storage);
    const applied = Math.min(signup.applied || 0, queue.length);
    const pending = queue.slice(applied);
    if (!pending.length) return { added: 0, updated: 0, checkin: 0, ignored: 0, stale: 0, pending: 0 };
    const result = mergeEvents(signup, pending);
    signup.applied = queue.length;
    return { ...result, pending: pending.length };
  }

  /* 手工代填 / 从文件导入：直接落库 */
  function addRecord(signup, values, source = 'manual') {
    const record = {
      id: uid('rec'),
      at: Date.now(),
      source,
      values: valuesToFields(signup, values),
      checkinAt: 0,
      ua: '',
      note: '',
      schemaChanged: false
    };
    signup.records.push(record);
    signup.records.sort((a, b) => a.at - b.at);
    signup.updatedAt = new Date().toISOString();
    return record;
  }

  function removeRecord(signup, id) {
    const at = signup.records.findIndex((record) => record.id === id);
    if (at < 0) return false;
    signup.records.splice(at, 1);
    return true;
  }

  function toggleCheckin(signup, id, at = Date.now()) {
    const record = signup.records.find((item) => item.id === id);
    if (!record) return false;
    record.checkinAt = record.checkinAt ? 0 : at;
    return true;
  }

  /* ── 统计与导出 ───────────────────────── */

  function stats(signup) {
    const records = signup.records || [];
    const key = signup.fields.find((field) => field.id === signup.keyField);
    const seen = new Map();
    if (key) {
      for (const record of records) {
        const value = text(record.values[key.id]);
        if (!value) continue;
        seen.set(value, (seen.get(value) || 0) + 1);
      }
    }
    const dupes = [...seen.values()].filter((count) => count > 1);
    const required = signup.fields.filter((field) => field.required);
    const wanted = required.length * records.length;
    let filled = 0;
    for (const record of records) {
      for (const field of required) if (text(record.values[field.id]) !== '') filled += 1;
    }
    return {
      total: records.length,
      checkins: records.filter((record) => record.checkinAt).length,
      dupeValues: dupes.length,
      dupeRecords: dupes.reduce((sum, count) => sum + count, 0),
      keyLabel: key ? key.label : '',
      complete: wanted ? Math.round((filled / wanted) * 100) : 100,
      manual: records.filter((record) => record.source === 'manual').length,
      scanned: records.filter((record) => record.source !== 'manual').length,
      lastAt: records.length ? records[records.length - 1].at : 0
    };
  }

  function dupeValues(signup) {
    const key = signup.fields.find((field) => field.id === signup.keyField);
    if (!key) return new Set();
    const seen = new Map();
    for (const record of signup.records) {
      const value = text(record.values[key.id]);
      if (!value) continue;
      seen.set(value, (seen.get(value) || 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value));
  }

  const SOURCE_LABEL = { scan: '扫码填写', import: '回执导入', manual: '现场补登', link: '填写页' };

  function rowsOf(signup) {
    const header = ['序号', '提交时间', '来源', ...signup.fields.map((field) => field.label), '签到时间', '备注'];
    const rows = signup.records.map((record, index) => [
      String(index + 1),
      new Date(record.at).toLocaleString('zh-CN', { hour12: false }),
      SOURCE_LABEL[record.source] || record.source,
      ...signup.fields.map((field) => text(record.values[field.id])),
      record.checkinAt ? new Date(record.checkinAt).toLocaleString('zh-CN', { hour12: false }) : '',
      record.schemaChanged ? '表单结构已变，请核对' : text(record.note)
    ]);
    return { header, rows };
  }

  const csvCell = (value) => {
    const str = String(value == null ? '' : value);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  function toCsv(signup) {
    const { header, rows } = rowsOf(signup);
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function toMarkdown(signup) {
    const { header, rows } = rowsOf(signup);
    const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
    for (const row of rows) lines.push(`| ${row.map((cell) => String(cell == null ? '' : cell).replace(/\|/g, '／').replace(/\n/g, ' ')).join(' | ')} |`);
    return lines.join('\n');
  }

  /* 交给 AI 的上下文：报名表 / 签到表生成时用来写统计口径与汇总 */
  function contextFor(signup, limit = 30) {
    if (!signup || !signup.enabled) return '未启用';
    const tally = stats(signup);
    return {
      收集方式: '工作台生成的填写页 / 二维码，参与者现场自己填；管理者也可代填或导入回执码',
      字段定义: signup.fields.map((field) => `${field.label}（${TYPE_LABEL[field.type] || field.type}${field.required ? '，必填' : ''}${field.options.length ? `，选项：${field.options.join('/')}` : ''}）`),
      已收到份数: tally.total,
      已签到人数: tally.checkins,
      去重字段: tally.keyLabel || '未设置',
      重复人数: tally.dupeRecords,
      必填完整率: `${tally.complete}%`,
      记录样例: signup.records.slice(-limit).map((record) => Object.fromEntries(
        signup.fields.map((field) => [field.label, text(record.values[field.id])]).filter(([, value]) => value !== '')
      ))
    };
  }

  /* 从粘贴的多行文本里取出回执码：每行一条，忽略空行与说明文字 */
  function parseLines(text) {
    return String(text == null ? '' : text)
      .split(/[\r\n;]+/)
      .map((line) => text(line))
      .filter(Boolean);
  }

  /* CSV 导入（手机带回的文件，或从表格软件导出的名单） */
  function parseCsv(signup, source) {
    const rows = parseCsvRows(source);
    if (!rows.length) return { added: 0, rows: 0 };
    const header = rows[0].map((cell) => text(cell));
    const labels = signup.fields.map((field) => field.label);
    const mapping = labels.map((label) => {
      const exact = header.findIndex((cell) => cell === label);
      if (exact >= 0) return exact;
      return header.findIndex((cell) => cell && (cell.includes(label) || label.includes(cell)));
    });
    const hasHeader = mapping.some((index) => index >= 0) || header.some((cell) => labels.includes(cell));
    const body = hasHeader ? rows.slice(1) : rows;
    let added = 0;
    for (const row of body) {
      if (!row.some((cell) => text(cell) !== '')) continue;
      const values = labels.map((label, index) => {
        const at = hasHeader ? mapping[index] : index;
        return at >= 0 ? text(row[at]) : '';
      });
      if (!values.some(Boolean)) continue;
      addRecord(signup, values, 'import');
      added += 1;
    }
    return { added, rows: body.length };
  }

  function parseCsvRows(source) {
    const out = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const input = String(source == null ? '' : source).replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === '"') {
          if (input[i + 1] === '"') { cell += '"'; i += 1; }
          else quoted = false;
          continue;
        }
        cell += char;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === ',') { row.push(cell); cell = ''; continue; }
      if (char === '\n' || char === '\r') {
        if (char === '\r' && input[i + 1] === '\n') i += 1;
        row.push(cell);
        out.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += char;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out.filter((item) => item.some((cellText) => text(cellText) !== ''));
  }

  window.WB.signup = {
    SCHEMA_VERSION,
    RECEIPT_VERSION,
    FORM_PREFIX,
    QUEUE_PREFIX,
    MINE_PREFIX,
    MAX_FIELDS,
    MAX_OPTIONS,
    TYPE_LABEL,
    TYPE_CODE,
    SOURCE_LABEL,
    PRESETS,
    fresh,
    normalise,
    freshField,
    applyPreset,
    addField,
    moveField,
    removeField,
    keyIdOf,
    fieldByLabel,
    packSchema,
    unpackSchema,
    encodeBase64Url,
    decodeBase64Url,
    fingerprint,
    linkFor,
    pageUrl,
    qrSvg,
    storeForm,
    readStoredForm,
    soleStoredProjectId,
    formKey,
    queueKey,
    mineKey,
    packReceipt,
    parseReceipt,
    readQueue,
    appendToQueue,
    clearQueue,
    mergeEvents,
    syncFromQueue,
    addRecord,
    removeRecord,
    toggleCheckin,
    valuesToFields,
    fieldsToValues,
    stats,
    dupeValues,
    rowsOf,
    toCsv,
    toMarkdown,
    contextFor,
    parseLines,
    parseCsv,
    parseCsvRows
  };
}());