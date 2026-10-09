/* 技能目录（模块装配层）：把「产出配置」从写死的清单，变成
 * 「内置技能包（固定） + 自定义技能包（可自由组装）」两层的装配结果。
 *
 * 内置技能（BUILTIN）：与 skills/registry.json 一一对应。带专属视图的（如方案比选
 *   决策矩阵）或与工作台状态耦合的，固定写死，不参与自定义增删。
 * 自定义技能：用与 skills/<id>/SKILL.md 同一套 frontmatter 约定书写，用户在工作台里
 *   粘贴导入，存在浏览器本地（localStorage）。导入后立刻出现在「产出配置」里，
 *   并自动带上默认章节，可被「过程材料」正常生成与导出。
 *
 * 注入方式：原地改写 util.OUTPUT_ITEMS（始终是同一个数组对象），
 * 这样所有在加载期做过 `const { OUTPUT_ITEMS } = U` 的视图都能自动看到新产出。
 */
window.WB = window.WB || {};

(function () {
  const U = window.WB.util;
  const CUSTOM_KEY = 'demo2-custom-skills-v1';
  const MAX_SKILLS = 24;
  const MAX_RULES = 8000;
  const MAX_SECTIONS = 20;
  const MAX_TITLE = 40;
  const MAX_SECTION = 60;

  /* 内置产出清单快照：模块加载时先留一份，之后 OUTPUT_ITEMS 会被原地改写 */
  const BUILTIN = U.OUTPUT_ITEMS.slice();
  const BUILTIN_KEYS = new Set(BUILTIN.map((item) => item.key));
  const REGISTRY_SKILLS = new Set(Object.keys(window.SKILLS.materials || {}));

  const PHASES = ['plan', 'prepare', 'execute', 'close'];
  const KIND_LABEL = { document: '文档', table: '表格', graphic: '图形' };
  const DELIVERABLE_OF_KIND = { document: 'word', table: 'excel', graphic: 'svg' };
  const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{1,40}$/;
  const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

  let custom = [];
  const injected = new Set();

  /* ── 解析：约定的技能包格式（与 SKILL.md 同源的轻量 frontmatter）── */

  const clean = (value) => String(value == null ? '' : value).replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  /* 行内注释：`kind: document   # 文档 / 表格 / 图形` 里的 `#` 之后都丢掉（前面要有空白） */
  const stripComment = (value) => String(value == null ? '' : value).replace(/(^|\s)#.*$/s, '').trim();

  function splitSource(source) {
    const raw = String(source == null ? '' : source).replace(/\r\n/g, '\n').trim();
    if (!raw) return { block: '', body: '' };
    const match = raw.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    if (match) return { block: match[1], body: raw.slice(match[0].length) };
    return { block: raw, body: '' };
  }

  /* 一行一条的列表（`- 一、xxx`），也接受 `|` 分隔或 `[a, b]` 流式写法 */
  function splitInlineList(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return [];
    if (text.startsWith('[') && text.endsWith(']')) {
      return text.slice(1, -1).split(',').map((item) => clean(stripComment(item))).filter(Boolean);
    }
    return text.split(/[|;；]/).map((item) => clean(stripComment(item))).filter(Boolean);
  }

  function parseFields(block) {
    const data = {};
    let listKey = '';
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const listed = trimmed.match(/^[-*]\s+(.*)$/);
      if (listed && listKey) { data[listKey].push(clean(stripComment(listed[1]))); continue; }
      const pair = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (!pair) { listKey = ''; continue; }
      const key = pair[1].toLowerCase();
      const value = stripComment(pair[2]);
      if (value === '') { data[key] = []; listKey = key; continue; }
      listKey = '';
      data[key] = key === 'sections' ? splitInlineList(value) : clean(value);
    }
    return data;
  }

  /* 正文留空时给一段兜底规则，保证自定义产出也能直接交给模型 */
  function defaultRules(title, sections) {
    return [
      `你负责产出《${title}》，按下面的章节顺序逐节写，章节标题逐字照抄：`,
      sections.map((heading) => `- ${heading}`).join('\n'),
      '',
      '只使用输入里给出的事实；缺失的人名、单位、电话、金额、人数、依据一律写「待确认」，不得编造。',
      '正文用规范 Markdown：标题、空行分段、- 列表、管道表格；不要写 HTML、不要合并单元格。'
    ].join('\n');
  }

  function parseInto(source, library) {
    const errors = [];
    const { block, body } = splitSource(source);
    if (!block) return { ok: false, errors: ['技能包内容是空的。'], skill: null };
    const data = parseFields(block);

    const id = clean(data.name);
    const title = clean(data.title);
    const kind = clean(data.kind).toLowerCase();
    const phase = clean(data.phase).toLowerCase() || 'plan';
    const deliverable = clean(data.deliverable).toLowerCase();
    const key = clean(data.output || data.key) || id;
    const description = clean(data.description);
    const sections = (Array.isArray(data.sections) ? data.sections : []).map(clean).filter(Boolean);

    if (!ID_RE.test(id)) errors.push('name（技能 id）要字母开头，只含字母、数字、- _，2–41 位。');
    else if (REGISTRY_SKILLS.has(id)) errors.push(`技能 id「${id}」与内置技能重名，请换一个。`);

    if (!title) errors.push('title（产出名称）不能为空。');
    else if (title.length > MAX_TITLE) errors.push(`title 太长：最多 ${MAX_TITLE} 字。`);

    if (!['document', 'table', 'graphic'].includes(kind)) {
      errors.push(kind === 'structure'
        ? 'kind: structure（结构化数据表）需要工作台里配套的专属视图，暂不支持自定义；请改用 document / table / graphic。'
        : 'kind 要填 document / table / graphic 之一。');
    }
    if (!PHASES.includes(phase)) errors.push('phase 要填 plan / prepare / execute / close 之一。');
    const wantDeliverable = DELIVERABLE_OF_KIND[kind];
    if (wantDeliverable && deliverable && deliverable !== wantDeliverable) {
      errors.push(`deliverable 与 kind 不自洽：kind: ${kind} 的主交付格式是 ${wantDeliverable}。`);
    }

    if (!KEY_RE.test(key)) errors.push('产出 key（output）不合法：字母开头，只含字母数字与 - _。');
    else if (BUILTIN_KEYS.has(key)) errors.push(`产出 key「${key}」与内置产出重名，请用一行 output: 指定别的 key。`);
    else if (library.some((item) => item.key === key && item.id !== id)) {
      errors.push(`产出 key「${key}」已被自定义技能「${library.find((item) => item.key === key).title}」占用。`);
    }

    const minSections = kind === 'graphic' ? 1 : 2;
    if (sections.length < minSections) errors.push(`sections 至少 ${minSections} 条，一行一条，写成「- 一、章节名」。`);
    else if (sections.length > MAX_SECTIONS) errors.push(`sections 最多 ${MAX_SECTIONS} 条。`);
    else if (sections.some((heading) => heading.length > MAX_SECTION)) errors.push(`章节名最多 ${MAX_SECTION} 字。`);

    if (!errors.length && library.length >= MAX_SKILLS && !library.some((item) => item.id === id)) {
      errors.push(`本地最多放 ${MAX_SKILLS} 个自定义技能，请先删掉不用的。`);
    }

    if (errors.length) return { ok: false, errors, skill: null };
    const rules = U.text(body).slice(0, MAX_RULES) || defaultRules(title, sections);
    return {
      ok: true,
      errors: [],
      skill: {
        id, title, kind, phase, deliverable: wantDeliverable,
        key, description, sections, rules, custom: true,
        item: { key, label: title, phase, skill: id, kind, custom: true }
      }
    };
  }

  const parse = (source) => parseInto(source, custom);

  /* ── 装配：把内置与自定义拼成 OUTPUT_ITEMS，并把章节注入 materials ── */

  function syncMaterials() {
    const materials = window.SKILLS.materials || (window.SKILLS.materials = {});
    for (const skill of custom) {
      materials[skill.id] = { title: skill.title, kind: skill.kind, sections: skill.sections.slice() };
      injected.add(skill.id);
    }
    for (const id of [...injected]) {
      if (custom.some((skill) => skill.id === id) || REGISTRY_SKILLS.has(id)) continue;
      delete materials[id];
      injected.delete(id);
    }
  }

  function sync() {
    U.OUTPUT_ITEMS.splice(0, U.OUTPUT_ITEMS.length, ...BUILTIN, ...custom.map((skill) => skill.item));
    syncMaterials();
  }

  /* ── 本地技能库 ─────────────────────────── */

  function persist() {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify({ version: 1, sources: custom.map((skill) => skill.source) })); }
    catch { /* 本地存储写入失败（隐私模式 / 容量满）时只在本次会话里生效，不影响使用 */ }
  }

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null'); } catch { raw = null; }
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.sources) ? raw.sources : []);
    const accepted = [];
    for (const source of list.slice(0, MAX_SKILLS)) {
      const parsed = parseInto(source, accepted);
      if (parsed.ok) accepted.push({ ...parsed.skill, source: String(source).replace(/\r\n/g, '\n').trim() });
    }
    custom = accepted;
    sync();
    return custom;
  }

  function add(source) {
    const parsed = parse(source);
    if (!parsed.ok) return parsed;
    const skill = { ...parsed.skill, source: String(source == null ? '' : source).replace(/\r\n/g, '\n').trim() };
    const index = custom.findIndex((item) => item.id === skill.id);
    if (index >= 0) custom[index] = skill; else custom.push(skill);
    sync();
    persist();
    return { ok: true, errors: [], skill, updated: index >= 0 };
  }

  function remove(id) {
    const before = custom.length;
    custom = custom.filter((item) => item.id !== id);
    if (custom.length === before) return false;
    sync();
    persist();
    return true;
  }

  /* 项目里勾了、但本机技能库里没有的产出（换了电脑 / 删过技能时会遇到） */
  const orphanOutputs = (outputs) => Object.keys(outputs || {})
    .filter((key) => outputs[key] && !U.OUTPUT_ITEMS.some((item) => item.key === key));

  const find = (id) => custom.find((skill) => skill.id === id) || null;

  const TEMPLATE = [
    '---',
    'name: safety-brief          # 技能 id：字母开头，只含字母数字与 - _',
    'title: 参与者安全须知        # 产出名称，会显示在「产出配置」里',
    'kind: document             # document 文档 / table 表格 / graphic 图形',
    'phase: prepare             # plan 前期策划 / prepare 活动筹备 / execute 现场执行 / close 活动收尾',
    'output: safetyBrief        # 选填：产出的 key，不写就取 name',
    'description: 面向参与者的安全须知与注意事项',
    'sections:                  # 章节，一行一条（至少 2 条）',
    '  - 一、活动风险提示',
    '  - 二、着装与物品要求',
    '  - 三、紧急联络与处置流程',
    '---',
    '',
    '（可选）这里写给 AI 的写作要求：语气、篇幅、必须写到的要点、事实边界。',
    '留空也可以——工作台会按上面的章节给出通用口径。'
  ].join('\n');

  window.WB.catalog = {
    KEY: CUSTOM_KEY,
    MAX_SKILLS,
    KINDS: Object.keys(KIND_LABEL),
    KIND_LABEL,
    DELIVERABLE_OF_KIND,
    PHASES,
    template: () => TEMPLATE,
    load,
    sync,
    parse,
    add,
    remove,
    list: () => custom.slice(),
    count: () => custom.length,
    builtinCount: () => BUILTIN.length,
    isCustom: (id) => Boolean(find(id)),
    rulesFor: (id) => find(id)?.rules || '',
    find,
    orphanOutputs,
    exportText: () => custom.map((skill) => skill.source).join('\n\n')
  };
}());