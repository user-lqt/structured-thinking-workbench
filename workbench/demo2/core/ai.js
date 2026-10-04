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
  const isReady = (id) => Boolean(skillIndex[id]?.ready);

  async function request(skill, contract, input, endpoint = '/api/structure') {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill, contract, input })
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
    const fields = BASIC_FIELDS.map((field) => {
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

  const documentContract = (sections) => `{\n  "title": "活动名称｜文档名称",\n  "sections": [\n${sections.map((heading) => `    { "heading": ${JSON.stringify(heading)}, "body": "Markdown 正文，不要重复写 heading" }`).join(',\n')}\n  ]\n}`;

  function resourceContract() {
    const kinds = window.WB.util.RESOURCE_KINDS.map((kind) => kind.value).join('|');
    return `{\n  "resources": [\n    { "name": "资源名称", "kind": "${kinds}", "phase": "plan|prepare|execute|close", "unit": "人|处|台|件|元|辆", "available": 1, "assigned": 0, "owner": "责任人角色", "note": "用途" }\n  ]\n}`;
  }

  const drillContract = () => `{\n  "steps": [{ "text": "责任角色 + 在多少分钟内 + 做什么" }],\n  "decisions": "关键决策与取舍依据，2 句以内",\n  "rollback": "恢复常态流程的量化条件与确认人",\n  "followUp": ["演练后要补进预案的改进项，最多 3 条"],\n  "risk": { "name": "", "trigger": "", "prevention": "", "response": "", "escalation": "", "owner": "" }\n}`;

  /* ── 合并：AI 只补空白与「待确认」 ─────── */

  function normaliseValue(field, raw) {
    if (raw == null) return '';
    if (field.type === 'number') {
      const num = Number(String(raw).replace(/[^\d.-]/g, ''));
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
    resourceContract,
    drillContract,
    normaliseValue,
    mergeBasic,
    mergeOutputs,
    mergeResources,
    generateImage
  };
}());
