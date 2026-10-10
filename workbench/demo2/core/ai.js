/* AI 层：技能包探测、契约拼装、DeepSeek 调用与「不覆盖用户手改」的合并规则。 */
window.WB = window.WB || {};

(function () {
  const { BASIC_FIELDS, OUTPUT_ITEMS, RISK, PHASE_LABEL, text, clamp } = window.WB.util;

  /* ready = DeepSeek 可用；imageReady = YosHub 生图可用；两者独立计费与降级 */
  const ai = { ready: false, imageReady: false, busy: false };
  let skillIndex = {};
  let healthPromise = Promise.resolve();

  const setStatus = (kind, label) => window.WB.onAiStatus?.(kind, label);

  async function check() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      ai.ready = Boolean(data.providers?.deepseek);
      ai.imageReady = Boolean(data.providers?.yoshub);
      setStatus(ai.ready ? 'ready' : 'off', ai.ready ? 'AI 已就绪' : '未配置 AI Key');
    } catch {
      ai.ready = false;
      ai.imageReady = false;
      setStatus('off', '离线模式');
    }
    window.WB.updateAiButtons?.();
    return ai.ready;
  }

  async function loadSkills() {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      skillIndex = Object.fromEntries((data.skills || []).map((skill) => [skill.id, skill]));
    } catch {
      skillIndex = {};
    }
    return skillIndex;
  }

  const skills = () => skillIndex;
  /* 内置技能看服务端 registry 是否就绪；自定义技能包自带规则，导入即可用 */
  const isReady = (id) => Boolean(skillIndex[id]?.ready) || Boolean(window.WB.catalog?.isCustom(id));

  async function request(skill, contract, input, endpoint = '/api/structure') {
    /* 自定义技能不在服务端 registry 里：把技能包正文一起带上，服务端据此组装 system prompt */
    const rules = window.WB.catalog?.rulesFor(skill) || '';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules ? { skill, contract, input, rules } : { skill, contract, input })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `请求失败（HTTP ${res.status}）`);
    return payload.data;
  }

  /* 统一的调用入口：离线直接返回 null，并保证按钮忙碌态被复位 */
  async function run(skill, input, contract, endpoint = '/api/structure') {
    if (!ai.ready) await healthPromise;
    if (!ai.ready) { window.WB.toast?.('未连接 AI，当前为离线模式，可手动填写'); return null; }
    ai.busy = true;
    setStatus('busy', 'AI 生成中…');
    window.WB.updateAiButtons?.();
    try {
      const data = await request(skill, contract, input, endpoint);
      setStatus('ready', 'AI 已就绪');
      return data;
    } catch (error) {
      setStatus('off', 'AI 调用失败');
      window.WB.toast?.(error.message);
      return null;
    } finally {
      ai.busy = false;
      window.WB.updateAiButtons?.();
    }
  }

  /* ── 契约 ─────────────────────────────── */

  function manifestContract() {
    /* 活动日期是用户自己排的（可能多天），不交给 AI 填，契约里也不出现 */
    const fields = BASIC_FIELDS.filter((field) => field.type !== 'days').map((field) => {
      const kind = field.type === 'number' ? '数字' : field.type === 'enum' ? `枚举 ${field.options.join('/')}` : '文本';
      return `    "${field.key}": ""  // ${field.label}（${kind}）`;
    }).join(',\n');
    const outputs = OUTPUT_ITEMS.map((item) => `"${item.key}": true`).join(', ');
    return `{\n  "basic": {\n${fields}\n  },\n  "outputs": { ${outputs} },\n  "notes": ["补充说明，最多 3 条"]\n}`;
  }

  const wbsContract = () => `{\n  "rows": [\n    { "phase": "plan|prepare|execute|close", "task": "", "owner": "", "due": "D-7", "duration": 2, "output": "", "depends": "", "milestone": false }\n  ]\n}`;

  function riskContract() {
    const categories = RISK.categories.map((item) => item.value).join('|');
    return `{\n  "risks": [\n    {\n      "name": "风险名称，12 字以内",\n      "category": "${categories}",\n      "phase": "plan|prepare|execute|close",\n      "task": "任务分解表中的任务名称",\n      "probability": 1,\n      "impact": 1,\n      "trigger": "",\n      "prevention": "",\n      "response": "",\n      "escalation": "",\n      "owner": ""\n    }\n  ],\n  "compliance": ["合规提示，最多 3 条"]\n}`;
  }

  const riskCalibrateContract = () => `{\n  "scores": [\n    { "index": 1, "probability": 1, "impact": 1 }\n  ]\n}`;

  const decisionContract = () => `{\n  "options": [{ "name": "方案名称", "summary": "一句话说明" }],\n  "criteria": [{ "label": "评价维度", "weight": 3, "hint": "该维度看什么" }],\n  "scores": [{ "option": "方案名称", "criterion": "评价维度", "score": 3, "reason": "打分理由" }]\n}`;

  /* 每章的「形式」由 materials.js 的 materialForms 指定：列出来的写表格，其余写正文段落。
     不明说的话，模型会把每一章都铺成表格——须知 / 流程 / 口径 / 说明挤进表格非常难读。 */
  const FORM_HINT = {
    table: 'Markdown 管道表格（表头行 + | --- | 分隔行 + 数据行），一张表只表达一件事，单元格内不要换行',
    prose: '正文段落（可用 - 列表与 ** 强调），本章不要用表格'
  };

  function documentContract(sections, forms = {}) {
    const rows = sections.map((heading) => {
      const hint = FORM_HINT[forms[heading]] || '正文段落；本章本身是清单或明细时才用一张表格';
      return `    { "heading": ${JSON.stringify(heading)}, "body": "这一章写成：${hint}；不要重复写 heading" }`;
    }).join(',\n');
    return `{\n  "title": "活动名称｜文档名称",\n  "sections": [\n${rows}\n  ]\n}`;
  }

  /* 「按参考重排」：把现有正文改写成与参考样表形式一致的成稿。
     与 documentContract 的区别是：栏目不是我方内置章节，而是参考解析出来的栏目；
     表格列名与字段清单照抄参考，值只能取自现有正文与项目数据，取不到写「待确认」。 */
  const reframeContract = (headings, reference) => {
    const columns = (reference?.sections || []).map((section) => section.heading);
    const fields = reference?.fields || [];
    const tables = (reference?.tables || []).map((table) => (table.headers || []).filter(Boolean).join(' / ')).filter(Boolean);
    return [
      '这一轮不是重新创作，而是「按参考样表重排」：把「现有正文」改写成一份形式与参考件一致的成稿，内容仍属于本项目。',
      columns.length
        ? `参考件的栏目（顺序与名称照抄，不得增删或改名）：\n${columns.map((name, index) => `  ${index + 1}. ${name}`).join('\n')}`
        : '参考件没有解析出栏目，沿用现有正文的章节。',
      fields.length ? `参考件的字段清单（每一条都要在正文里出现）：\n  ${fields.join('、')}` : '',
      tables.length ? `参考件里的表格（列名与列顺序照抄，行按本项目事实填）：\n${tables.map((row) => `  ${row}`).join('\n')}` : '',
      '取值顺序：① 现有正文里已经写到的 → 照搬；② 项目信息表 / 任务分解 / 风险台账 / 素材库里有 → 取过来；③ 都没有 → 写「待确认」。不要编造事实。',
      '参考原文里属于别的事实的值（时间、地点、人名、金额、单位、主办方）一律不要照抄到本项目。',
      '只做重排、对齐与补全：不得新增参考与现有正文都没有的事实，也不要把已经写好的内容删成空壳。',
      '形式：一级栏目用 #，二级标题用 ##，表格用 Markdown 管道表，条目用 - ；不要写代码块、不要写解释。',
      `返回 JSON：\n{\n  "title": "活动名称｜文档名称",\n  "sections": [\n${headings.map((heading) => `    { "heading": ${JSON.stringify(heading)}, "body": "Markdown 正文，不要重复写 heading" }`).join(',\n')}\n  ]\n}`
    ].filter(Boolean).join('\n\n');
  };
  /* 「参考表填值」：只回值，不改结构。清单在 input 里，契约只描述返回形状。
     要求「每个 id 都要回一行」是为了把「模型没看到」和「模型真没依据」区分开：
     没依据的显式回空串，前端就能统计出到底跳过了多少。 */
  const fillContract = () => `{
  "values": [
    { "id": "空位 id，照抄输入的 id", "value": "要填进这一格的文字；没有依据就留空字符串", "basis": "依据：项目信息表 / 任务分解 / 风险台账 / 资源台账 / 已有材料 / 参考写法 / 无" }
  ]
}`;

  function resourceContract() {
    const kinds = window.WB.util.RESOURCE_KINDS.map((kind) => kind.value).join('|');
    return `{\n  "resources": [\n    { "name": "资源名称", "kind": "${kinds}", "phase": "plan|prepare|execute|close", "unit": "人|处|台|件|元|辆", "available": 1, "assigned": 0, "owner": "责任人角色", "note": "用途" }\n  ]\n}`;
  }

  const drillContract = () => `{\n  "steps": [{ "text": "责任角色 + 在多少分钟内 + 做什么" }],\n  "decisions": "关键决策与取舍依据，2 句以内",\n  "rollback": "恢复常态流程的量化条件与确认人",\n  "followUp": ["演练后要补进预案的改进项，最多 3 条"],\n  "risk": { "name": "", "trigger": "", "prevention": "", "response": "", "escalation": "", "owner": "" }\n}`;

  /* 访谈式补全（skill: intake）：
     ask     → 追加更贴合本项目的追问，字段必须在白名单内；
     draft   → 就某一题给 2–3 个可直接采用的版本；
     compose → 把访谈回答整理成通顺成稿，只作用于目标 / 内容 / 约束三个文本区。
     追问口径来自课程手册 4.4：每条追问都要「指认一个具体缺口 + 施加一条硬约束」，
     句式从「依据 / 前提 / 反例 / 边界 / 替代 / 自评」里挑，优先边界与替代。 */
  function intakeAskContract() {
    const keys = window.WB.interview?.AI_KEYS || ['goal', 'content', 'constraint', 'audience', 'venueBackup', 'coOrganizer', 'approval', 'budget', 'guests'];
    const styles = (window.WB.interview?.ASK_STYLES || ['依据', '前提', '反例', '边界', '替代', '自评']).join('|');
    return `{\n  "questions": [\n    { "key": "${keys.join('|')}", "style": "${styles}", "ask": "追问，一句话，24 字以内", "why": "补的是哪个缺口：这一项不填会导致什么，20 字以内", "hint": "一条硬约束，或一个具体例子" }\n  ]\n}`;
  }

  const intakeDraftContract = () => `{\n  "options": [\n    "可直接采用的版本，40 字以内",\n    "第二版，风格或规模不同"\n  ]\n}`;

  const intakeComposeContract = () => `{\n  "basic": {\n    "goal": "核心目标：目标 + 衡量指标，60 字以内",\n    "content": "活动内容与形式：核心环节 + 亮点 + 参与方式",\n    "constraint": "已知约束：场地 / 经费 / 时间的硬性限制，没有就留空"\n  },\n  "notes": ["最多 3 条补充说明"]\n}`;

  /* ── 合并：AI 只补空白与「待确认」 ─────── */

  function normaliseValue(field, raw) {
    if (raw == null) return '';
    /* 活动日期是用户自己排的，AI 一律不写，避免把多天排期拍扁成一天 */
    if (field.type === 'days') return '';
    if (field.type === 'number') {
      /* 数字字段收到「待确认」这类占位词时不能当成 0：洗掉非数字字符后 Number('') 正好是 0，
         会把「不知道」写成一个看起来像事实的数字。洗不出数字就返回空，交给下游当未填处理。 */
      const cleaned = text(raw).replace(/[^\d.-]/g, '');
      if (cleaned === '') return '';
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : text(raw);
    }
    const value = Array.isArray(raw) ? raw.join('；') : text(raw);
    if (field.type === 'enum' && field.options && value && !field.options.includes(value)) return '待确认';
    return value;
  }

  function mergeBasic(project, incoming) {
    let filled = 0;
    for (const field of BASIC_FIELDS) {
      if (!(field.key in (incoming || {}))) continue;
      if (project.meta.basic[field.key] === 'user') continue;
      const value = normaliseValue(field, incoming[field.key]);
      if (value === '' || value == null) continue;
      project.basic[field.key] = value;
      project.meta.basic[field.key] = value === '待确认' ? 'pending' : 'ai';
      filled += 1;
    }
    return filled;
  }

  function mergeOutputs(project, incoming) {
    let added = 0;
    for (const item of OUTPUT_ITEMS) {
      if (incoming?.[item.key] !== true) continue;
      if (project.meta.outputs[item.key] === 'user') continue;
      if (project.outputs[item.key]) continue;
      project.outputs[item.key] = true;
      project.meta.outputs[item.key] = 'ai';
      added += 1;
    }
    return added;
  }

  /* 资源台账合并：同名资源视为同一条，避免 AI 反复追加出重复行 */
  function mergeResources(current, incoming) {
    if (!Array.isArray(incoming)) return 0;
    const seen = new Set(current.resources.map((item) => text(item.name)));
    let added = 0;
    for (const raw of incoming.slice(0, 40)) {
      const name = text(raw?.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      current.resources.push(window.WB.store.normaliseResource({ ...raw, name, source: 'ai' }));
      added += 1;
    }
    return added;
  }

  /* ── 生图（YosHub）：与文本模型分开，未配 Key 时单独降级 ── */
  async function generateImage(prompt, size = '1024x1024') {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `生图失败（HTTP ${res.status}）`);
    return payload;
  }

  window.WB.ai = {
    get ready() { return ai.ready; },
    get busy() { return ai.busy; },
    set healthPromise(value) { healthPromise = value; },
    get healthPromise() { return healthPromise; },
    check,
    loadSkills,
    skills,
    isReady,
    request,
    run,
    manifestContract,
    wbsContract,
    riskContract,
    riskCalibrateContract,
    decisionContract,
    documentContract,
    reframeContract,
    fillContract,
    resourceContract,
    drillContract,
    intakeAskContract,
    intakeDraftContract,
    intakeComposeContract,
    normaliseValue,
    mergeBasic,
    mergeOutputs,
    mergeResources,
    generateImage
  };
}());
