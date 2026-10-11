/* 卡片工作流（agent 编排）：把工作台从「固定流水线」扩成「可自由组装的 agent 集合」。
 * 一张卡片 = 一个 agent：一个技能包（内置 / 自定义 / 自由写作）+ 勾选的引用资料
 *   （项目信息表 / 活动安排 / 任务分解 / 风险台账 / 资源台账 / 素材库 / 方案比选 / 参与者信息 /
 *     过程材料，以及上游卡片的输出）+ 你自己写的再要求 → 跑出一段可直接使用的 Markdown 文本。
 * 卡片可以拖拽排序、复制、删除、单独运行或一次全跑；输出能就地编辑并单独导出。
 * 数据存在 state.workflow = { cards: [] }，随项目存档与项目包往返（老项目没有该字段也能打开）。
 * 纯前端：只调用既有的 /api/material（与 /api/structure 是同一个处理器），不新增服务端契约、不加依赖。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  /* 可引用的资料源：与工作台里已有的结构化数据一一对应（勾上就把那份数据交给这张卡片） */
  const SOURCES = [
    { key: 'project', label: '项目信息表' },
    { key: 'agenda', label: '活动安排' },
    { key: 'wbs', label: '任务分解' },
    { key: 'risks', label: '风险台账' },
    { key: 'resources', label: '资源台账' },
    { key: 'assets', label: '素材库' },
    { key: 'knowledge', label: '知识库' },
    { key: 'decision', label: '方案比选' },
    { key: 'signup', label: '参与者信息' },
    { key: 'materials', label: '过程材料' }
  ];
  const SOURCE_KEYS = new Set(SOURCES.map((item) => item.key));
  /* 卡片状态：draft 草稿 / done 已完成 / error 失败；「运行中」只在内存里，不落盘 */
  const STATUS = { draft: '草稿', done: '已完成', error: '失败' };
  const NOW = '运行中';

  /* 自由写作（不套技能包）时的系统提示：事实边界与其它技能包保持一致 */
  const FREESTYLE_RULES = [
    '你负责根据给定的引用资料与用户再要求，撰写一段可直接使用的校园活动文本（说明 / 通知 / 方案片段 / 清单等）。',
    '只使用引用资料里给出的事实；资料里没有的一律写「待确认」，不要编造时间、地点、人名、金额或单位。',
    '按「本次输出契约」输出 JSON：text 是 Markdown 正文，正文段落为主，只有清单 / 明细 / 登记表才用管道表格。'
  ].join('\n');

  const running = new Set();      /* 正在运行的卡片 id（内存态，刷新即清） */
  const previewMode = new Map();  /* 每张卡片的正文显示：preview 排版 / text 可改 */
  let dragId = null;              /* 正在拖拽的卡片 id */

  const nowIso = () => new Date().toISOString();
  const clip = (value, max) => {
    const str = String(value == null ? '' : value);
    return str.length > max ? `${str.slice(0, max)}…（已截断）` : str;
  };

  /* ── 数据 ─────────────────────────────── */

  function freshCard(extra = {}) {
    return {
      id: U.uid('card'), title: '', skill: '', refs: [], from: [], instruction: '',
      status: 'draft', output: null, error: '', updatedAt: nowIso(), ...extra
    };
  }

  /* 老项目 / 旧项目包里没有 workflow 字段：读的时候补一个空壳，不塞任何卡片。
     卡片本身的形状由 store.normaliseWorkflow 在载入 / 导入时洗好（老存档也能读），
     这里只兜「数组还在不在」，免得界面直接上手就炸。 */
  function workflow() {
    const current = state();
    if (!current.workflow || typeof current.workflow !== 'object') current.workflow = { cards: [] };
    if (!Array.isArray(current.workflow.cards)) current.workflow.cards = [];
    return current.workflow;
  }
  /* 卡片列表：顺手保证 refs / from 是数组，界面直接 includes 也不会炸 */
  function cards() {
    const list = workflow().cards;
    for (const card of list) {
      if (!Array.isArray(card.refs)) card.refs = [];
      if (!Array.isArray(card.from)) card.from = [];
    }
    return list;
  }
  const find = (id) => cards().find((card) => card.id === id) || null;
  const orderOf = (id) => cards().findIndex((card) => card.id === id);

  /* ── 技能与资料的名字 ─────────────────── */

  function skillLabel(id) {
    if (!id) return '自由写作';
    const item = U.OUTPUT_ITEMS.find((entry) => entry.skill === id);
    if (item) return item.label;
    const entry = (window.WB.ai?.skills?.() || {})[id];
    if (entry) return entry.title || id;
    const custom = window.WB.catalog?.find?.(id);
    return custom?.title || id;
  }

  /* 技能下拉：产出技能（21 项内置 + 自定义技能包）+ 结构技能（任务分解 / 风险台账等） */
  function skillList() {
    const map = new Map();
    const add = (id, label, group) => { if (id && !map.has(id)) map.set(id, { id, label: label || id, group }); };
    for (const item of U.OUTPUT_ITEMS) add(item.skill, item.label, window.WB.catalog?.isCustom?.(item.skill) ? '自定义技能' : '产出技能');
    for (const entry of Object.values(window.WB.ai?.skills?.() || {})) add(entry.id, entry.title, entry.kind === 'structure' ? '结构技能' : '产出技能');
    for (const skill of window.WB.catalog?.list?.() || []) add(skill.id, skill.title, '自定义技能');
    return [...map.values()];
  }

  /* 每个资料源里现在有多少条：0 条的源仍然可以勾，但界面上顺手提示一下 */
  function sourceCount(key) {
    const current = state();
    switch (key) {
      case 'project': return Object.keys(current.project?.basic || {}).filter((k) => current.project.basic[k]).length;
      case 'agenda': return U.agendaOf(current.project?.basic).length;
      case 'wbs': return current.wbs.length;
      case 'risks': return current.risks.length;
      case 'resources': return (current.resources || []).length;
      case 'assets': return window.WB.library.list(current.assets, 'assets').filter(window.WB.library.included).length;
      case 'knowledge': return window.WB.library.list(current.assets, 'knowledge').filter(window.WB.library.included).length;
      case 'decision': return current.options?.decision ? 1 : 0;
      case 'signup': return current.signup?.records?.length || 0;
      case 'materials': return Object.keys(current.materials || {}).length;
      default: return 0;
    }
  }

  /* ── 引用资料 → 模型输入 ───────────────── */

  const PHASE = (value) => U.PHASE_LABEL[value] || value;

  function materialDigest() {
    const current = state();
    return Object.entries(current.materials || {}).map(([key, doc]) => ({
      材料: skillLabel(U.OUTPUT_ITEMS.find((item) => item.key === key)?.skill) || key,
      正文: clip((doc.sections || []).map((section) => `## ${section.heading}\n${section.body}`).join('\n\n'), 4000)
    })).filter((item) => item.正文);
  }

  function refPayload(card) {
    const current = state();
    const basic = current.project?.basic || {};
    const out = {};
    for (const key of card.refs) {
      if (key === 'project') out['项目信息表'] = basic;
      else if (key === 'agenda') out['活动安排'] = { 活动日期: U.daysOf(basic), 时间段: U.agendaOf(basic), 摘要: U.agendaSummary(basic) || '未排时间段' };
      else if (key === 'wbs') out['任务分解'] = current.wbs.map((row) => ({
        阶段: PHASE(row.phase), 任务: row.task, 负责角色: row.owner, 时间: row.due, 产出物: row.output, 状态: U.STATUS_LABEL[row.status] || row.status
      }));
      else if (key === 'risks') out['风险台账'] = current.risks.map((risk) => ({
        风险: risk.name, 等级: U.LEVEL_LABEL[window.WB.risk.levelOfRisk(risk)], 分值: window.WB.risk.scoreOf(risk),
        挂靠任务: risk.task, 预防措施: risk.prevention, 现场响应: risk.response, 升级路径: risk.escalation, 责任人: risk.owner
      }));
      else if (key === 'resources') out['资源台账'] = (current.resources || []).map((item) => ({
        资源: item.name, 类型: item.kind, 单位: item.unit, 库存可用: item.available, 计划需求: item.assigned, 已借出: item.loaned || 0, 单价: item.unitCost || 0, 存放地点: item.location, 采购来源: item.supplier, 状态: item.condition, 责任人: item.owner, 说明: item.note
      }));
      else if (key === 'assets') out['素材库'] = window.WB.library.context(current.assets, 'assets');
      else if (key === 'knowledge') out['知识库'] = window.WB.library.context(current.assets, 'knowledge');
      else if (key === 'decision') out['方案比选结论'] = current.options?.decision || '未进行比选';
      else if (key === 'signup') out['参与者信息'] = window.WB.signup ? window.WB.signup.contextFor(current.signup) : '未启用';
      else if (key === 'materials') out['过程材料'] = materialDigest();
    }
    out['资料引用规则'] = window.WB.library.rule;
    const upstream = card.from.map((id) => find(id)).filter(Boolean).map((item) => ({
      卡片: item.title, 使用技能: skillLabel(item.skill), 正文: clip(item.output?.text || '（这张卡片还没运行，没有正文）', 4000)
    }));
    if (upstream.length) out['上游卡片输出'] = upstream;
    return out;
  }

  /* 输出契约：卡片要的是「一段能直接用的正文」，所以固定成 title + text，不套章节形状。
     技能包里的章节口径仍然生效（它在 system 里），这里只定返回的 JSON 长什么样。 */
  const cardContract = () => [
    '{',
    '  "title": "这份产出的一句话标题（12 字以内）",',
    '  "text": "Markdown 正文：正文段落为主，小节用「## 」；只有清单 / 明细 / 登记表才用管道表格"',
    '}'
  ].join('\n');

  function buildInput(card) {
    return {
      任务: card.title || '（未命名卡片）',
      使用技能: card.skill ? skillLabel(card.skill) : '自由写作（不套技能包）',
      引用资料: refPayload(card),
      再要求: card.instruction.trim() || '（没有额外要求，按技能包默认口径写）',
      输出要求: '按「本次输出契约」输出一个 JSON 对象：title 是一句话标题，text 是可直接使用的 Markdown 正文。只使用引用资料里的事实；资料里没有的一律写「待确认」，不要编造。'
    };
  }

  /* 模型偶尔不按契约走（改回 sections 形状）：这里兜一层，别把正文丢了 */
  function textOf(data) {
    if (!data || typeof data !== 'object') return '';
    const direct = U.text(data.text);
    if (direct) return direct;
    if (Array.isArray(data.sections)) {
      return data.sections.map((section) => `## ${U.text(section.heading) || '未命名章节'}\n${U.text(section.body)}`).join('\n\n');
    }
    return '';
  }

  /* ── 运行一张卡片 ─────────────────────── */

  async function runCard(id, { silent = false } = {}) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能运行卡片'); return false; }
    const card = find(id);
    if (!card) return false;
    if (running.has(id)) return false;
    if (card.from.some((up) => !find(up)?.output?.text || find(up)?.status === 'error')) { window.WB.toast('先运行并确认上游卡片，再运行这张卡片'); return false; }
    const projectId = state().activeId;
    remember('运行卡片');
    if (!window.WB.ai.ready) { if (!silent) window.WB.toast('未连接 AI，离线模式不能运行卡片'); return false; }
    running.add(id);
    window.WB.onAiStatus?.('busy', '卡片运行中…');
    render();
    try {
      const custom = card.skill ? (window.WB.catalog?.rulesFor?.(card.skill) || '') : '';
      const body = { skill: card.skill || 'freestyle-card', contract: cardContract(), input: buildInput(card) };
      /* 自定义技能包与自由写作不在服务端 registry 里：把规则正文一起带上，服务端据此组装 system */
      if (!card.skill || custom) body.rules = custom || FREESTYLE_RULES;
      const res = await fetch('/api/material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await res.json().catch(() => ({}));
      if (projectId !== state().activeId || find(id) !== card) return false;
      if (!res.ok) throw new Error(payload.error || `请求失败（HTTP ${res.status}）`);
      const text = textOf(payload.data);
      if (!text) throw new Error('AI 没有返回正文，请重试');
      card.output = { title: U.text(payload.data?.title) || card.title, text, at: nowIso(), model: U.text(payload.model) };
      card.status = 'done';
      card.error = '';
      card.updatedAt = nowIso();
      store().log('workflow', `运行卡片《${card.title}》`);
      store().save();
      window.WB.onAiStatus?.('ready', 'AI 已就绪');
      if (!silent) window.WB.toast(`《${card.title}》已生成 ${text.length} 字`);
      return true;
    } catch (error) {
      if (projectId !== state().activeId || find(id) !== card) return false;
      card.status = 'error';
      card.error = error.message || '运行失败';
      store().save();
      window.WB.onAiStatus?.('off', 'AI 调用失败');
      window.WB.toast(card.error);
      return false;
    } finally {
      running.delete(id);
      render();
    }
  }

  async function runAll() {
    if (!U.canOperate()) { window.WB.toast('只读访客不能运行卡片'); return; }
    if (!window.WB.ai.ready) { window.WB.toast('未连接 AI，离线模式不能运行卡片'); return; }
    if (running.size || batchRunning) { window.WB.toast('工作流正在运行，请等待完成'); return; }
    let list;
    try { list = executionOrder(); } catch (error) { window.WB.toast(error.message); return; }
    if (!list.length) { window.WB.toast('还没有卡片'); return; }
    const projectId = state().activeId;
    batchRunning = true;
    let done = 0;
    const failed = new Set();
    try {
      for (const card of list) {
        if (projectId !== state().activeId) break;
        if (card.from.some((id) => failed.has(id))) { failed.add(card.id); continue; }
        if (await runCard(card.id, { silent: true })) done++; else failed.add(card.id);
      }
    } finally { batchRunning = false; render(); }
    window.WB.toast(`工作流完成：成功 ${done} 张，失败或因上游失败跳过 ${failed.size} 张`);
  }

  let batchRunning = false;
  function executionOrder() {
    const ordered = [], visiting = new Set(), visited = new Set();
    function visit(card) {
      if (visiting.has(card.id)) throw new Error('卡片引用形成循环，请先断开循环连线');
      if (visited.has(card.id)) return;
      visiting.add(card.id);
      for (const id of card.from) { const upstream = find(id); if (!upstream) throw new Error('卡片引用不存在，请移除失效引用'); visit(upstream); }
      visiting.delete(card.id); visited.add(card.id); ordered.push(card);
    }
    cards().forEach(visit); return ordered;
  }

  function addStarter() {
    if (!U.canOperate()) return;
    const brief = addCard({ title: '活动执行口径', refs: ['project', 'agenda', 'wbs', 'risks'], instruction: '整理活动目标、受众、安排和待确认事项，作为下游通知与现场执行的统一依据。' });
    if (!brief) return;
    addCard({ title: '参与者通知', skill: 'promo-copy', refs: ['project', 'agenda'], from: [brief.id], instruction: '面向参与者写清时间地点、报名与到场方式、注意事项。' });
    addCard({ title: '现场岗位简报', skill: 'training-brief', refs: ['resources', 'risks', 'agenda'], from: [brief.id], instruction: '面向工作人员列出岗位、到岗时间、签到签退要求、应急联系人。' });
    autoLayout();
  }

  function writeMaterial(id) {
    if (!U.canOperate()) return false;
    const card = find(id), item = U.OUTPUT_ITEMS.find((item) => item.skill === card?.skill);
    if (!card?.output?.text || !item) { window.WB.toast('请选择对应产出技能并填写正文后再写入材料'); return false; }
    if (item.key === 'materialList') { window.WB.toast('物料清单统一在人员与资源管理，卡片正文保留供参考，不替换资源台账。'); return false; }
    if (state().materials[item.key] && !confirm('该材料已有正文，确定用卡片结果替换？原正文将保留在工作流材料备份中。')) return false;
    state().workflow.materialBackups ||= {};
    if (state().materials[item.key]) state().workflow.materialBackups[item.key] = JSON.parse(JSON.stringify(state().materials[item.key]));
    const sections = [];
    let heading = card.output.title || card.title, lines = [];
    for (const line of card.output.text.split('\n')) {
      const match = line.match(/^#{1,2}\s+(.+)$/);
      if (match) { if (lines.length) sections.push({ heading, body: lines.join('\n').trim() }); heading = match[1]; lines = []; }
      else lines.push(line);
    }
    if (lines.length || !sections.length) sections.push({ heading, body: lines.join('\n').trim() });
    state().materials[item.key] = { materialId: state().materials[item.key]?.materialId || `MAT-${item.key}`, deliveries: state().materials[item.key]?.deliveries || [], aiDraft: Boolean(card.output.model && card.output.model !== '手工') || state().materials[item.key]?.aiDraft || false, title: card.output.title || card.title, sections, generatedAt: nowIso(), source: card.output.model && card.output.model !== '手工' ? 'ai-workflow' : 'user', templateName: '卡片工作流', workflowCardId: id };
    state().project.outputs[item.key] = true;
    store().log('workflow', `卡片《${card.title}》写入过程材料`); store().save();
    window.WB.renderPanelsMeta?.(); render(); window.WB.toast('已写入过程材料，可继续编辑与导出'); return true;
  }

  /* ── 卡片增删改与排序 ─────────────────── */

  function addCard(extra = {}) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能添加卡片'); return null; }
    remember('新建卡片');
    const card = freshCard({ title: `新卡片 ${cards().length + 1}`, refs: ['project'], ...extra });
    cards().push(card);
    store().log('workflow', `新增工作流卡片《${card.title}》`);
    store().save();
    render();
    const input = document.querySelector(`[data-flow-title="${card.id}"]`);
    input?.focus?.();
    input?.select?.();
    return card;
  }

  /* 把「产出配置」里已勾选的产出一键变成卡片：技能包已经选好，资料先按全套挂上 */
  function addFromOutputs() {
    if (!U.canOperate()) { window.WB.toast('只读访客不能添加卡片'); return; }
    const current = state();
    const selected = U.OUTPUT_ITEMS.filter((item) => current.project?.outputs?.[item.key]);
    if (!selected.length) { window.WB.toast('先在「项目信息表 → 产出配置」里勾选产出'); return; }
    const used = new Set(cards().map((card) => card.skill));
    let added = 0;
    for (const item of selected) {
      if (used.has(item.skill)) continue;
      used.add(item.skill);
      if (!added) remember('按产出配置生成卡片');
      cards().push(freshCard({ title: item.label, skill: item.skill, refs: ['project', 'agenda', 'wbs', 'risks', 'resources'] }));
      added += 1;
    }
    if (!added) { window.WB.toast('已勾选的产出都已有对应卡片'); return; }
    store().log('workflow', `按产出配置新增 ${added} 张卡片`);
    store().save();
    render();
    window.WB.toast(`已按产出配置新增 ${added} 张卡片`);
  }

  function deleteCard(id) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能删除卡片'); return; }
    const at = orderOf(id);
    if (at < 0) return;
    remember('删除卡片');
    const [card] = cards().splice(at, 1);
    /* 别的卡片把它当上游：一起摘掉，免得留下指向空气的引用 */
    for (const item of cards()) item.from = item.from.filter((up) => up !== id);
    store().log('workflow', `删除工作流卡片《${card.title}》`);
    store().save();
    render();
    window.WB.toast(`已删除《${card.title}》`);
  }

  function duplicateCard(id) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能复制卡片'); return; }
    const at = orderOf(id);
    if (at < 0) return;
    remember('复制卡片');
    const source = cards()[at];
    const copy = { ...JSON.parse(JSON.stringify(source)), id: U.uid('card'), output: null, status: 'draft', error: '', updatedAt: nowIso() };
    copy.title = `${source.title}（副本）`;
    /* 画布上别和原件正好叠在一起：往右下错开一点 */
    if (hasPos(source)) { copy.x = source.x + 32; copy.y = source.y + 32; }
    cards().splice(at + 1, 0, copy);
    store().log('workflow', `复制工作流卡片《${copy.title}》`);
    store().save();
    render();
  }

  /* 拖拽落地：把 from 插到 to 的前面或后面 */
  function moveCard(fromId, toId, position) {
    if (fromId === toId) return;
    const from = orderOf(fromId);
    if (from < 0) return;
    const [card] = cards().splice(from, 1);
    const to = orderOf(toId);
    if (to < 0) { cards().push(card); return; }
    cards().splice(position === 'after' ? to + 1 : to, 0, card);
    store().log('workflow', '调整卡片顺序');
    store().save();
  }

  /* ── 渲染 ─────────────────────────────── */

  function statusOf(card) { return running.has(card.id) ? 'running' : (card.status || 'draft'); }

  function statusChip(card) {
    const status = statusOf(card);
    const label = status === 'running' ? NOW : (STATUS[status] || STATUS.draft);
    return `<span class="flow-stage is-${status}">${escapeHtml(label)}</span>`;
  }

  function skillSelect(card, canWrite) {
    const list = skillList();
    const options = [`<option value="" ${card.skill ? '' : 'selected'}>自由写作（不套技能包）</option>`];
    if (card.skill && !list.some((item) => item.id === card.skill)) {
      options.push(`<option value="${escapeHtml(card.skill)}" selected>${escapeHtml(card.skill)}（未找到技能包）</option>`);
    }
    for (const group of ['产出技能', '结构技能', '自定义技能']) {
      const items = list.filter((item) => item.group === group);
      if (!items.length) continue;
      options.push(`<optgroup label="${escapeHtml(group)}">${items.map((item) => `<option value="${escapeHtml(item.id)}" ${card.skill === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</optgroup>`);
    }
    return `<select class="flow-skill" data-flow-skill="${card.id}" data-write aria-label="选择技能包" ${canWrite ? '' : 'disabled'}>${options.join('')}</select>`;
  }

  function refChips(card, canWrite) {
    return `<div class="flow-chips">${SOURCES.map((source) => {
      const on = card.refs.includes(source.key);
      const count = sourceCount(source.key);
      return `<button type="button" class="flow-chip${on ? ' is-on' : ''}" data-flow-ref="${card.id}" data-flow-source="${source.key}" data-write title="引用「${escapeHtml(source.label)}」${count ? `（现有 ${count} 条）` : '（现在是空的）'}" ${canWrite ? '' : 'disabled'}>${on ? '✓' : '＋'} ${escapeHtml(source.label)}${count ? ` <small>${count}</small>` : ''}</button>`;
    }).join('')}</div>`;
  }

  function fromChips(card, canWrite) {
    const others = cards().filter((item) => item.id !== card.id);
    if (!others.length) return '<p class="flow-hint">还没有别的卡片能引用。再建一张卡片，就能把它的输出当资料喂给这张。</p>';
    return `<div class="flow-chips">${others.map((item) => {
      const on = card.from.includes(item.id);
      const note = item.output ? '有正文' : '未运行';
      return `<button type="button" class="flow-chip${on ? ' is-on' : ''}" data-flow-from="${card.id}" data-flow-up="${item.id}" data-write title="引用这张卡片的输出" ${canWrite ? '' : 'disabled'}>${on ? '✓' : '＋'} ${escapeHtml(item.title || '未命名卡片')} <small>${note}</small></button>`;
    }).join('')}</div>`;
  }

  function outputBlock(card, canWrite) {
    /* 重跑时保留上一次的正文，只在没有旧正文时才占位提示 */
    if (running.has(card.id) && !card.output) return '<div class="flow-empty">正在生成…</div>';
    if (card.status === 'error' && !card.output) return `<div class="flow-error">运行失败：${escapeHtml(card.error || '未知错误')}（改一下再要求或引用资料，重试即可）</div>`;
    if (!card.output) {
      const off = window.WB.ai.ready ? '' : '（当前未连接 AI，离线时只能手动写：先在别的材料里生成，或点「改正文」自己写）';
      return `<div class="flow-empty">还没运行。点右上角「▶ 运行」，AI 会按引用资料与再要求写出正文。${off}${canWrite ? `<button class="button button-ghost" data-flow-manual="${card.id}" data-write>手动撰写正文</button>` : ''}</div>`;
    }
    const editing = previewMode.get(card.id) === 'text';
    const rendered = window.WB.markdown?.toHtml?.(card.output.text) || '';
    return `<div class="flow-output">
      <div class="flow-output-head">
        <b>${escapeHtml(card.output.title || card.title)}</b>
        <small>${escapeHtml(card.output.at ? U.fmtDateTime(card.output.at) : '')}${card.output.model ? ` · ${escapeHtml(card.output.model)}` : ''}</small>
        ${card.status === 'error' ? `<small class="flow-warn">上次重跑失败：${escapeHtml(card.error)}</small>` : ''}
        <div class="flow-output-actions">
          <button type="button" class="button button-ghost small" data-flow-edit="${card.id}">${editing ? '看排版' : '改正文'}</button>
          <button type="button" class="button button-ghost small" data-flow-copy="${card.id}">复制文本</button>
          <button type="button" class="button button-ghost small" data-flow-card-export="${card.id}">导出 .md</button>
          ${U.OUTPUT_ITEMS.some((item) => item.skill === card.skill) ? `<button type="button" class="button button-ghost small" data-flow-material="${card.id}" data-write>写入过程材料</button>` : ''}
        </div>
      </div>
      ${editing
        ? `<textarea class="flow-text" data-flow-text="${card.id}" rows="12" data-write ${canWrite ? '' : 'disabled'}>${escapeHtml(card.output.text)}</textarea>`
        : `<div class="md-body flow-md">${rendered || '<p class="md-empty">正文为空。</p>'}</div>`}
    </div>`;
  }

  function cardHtml(card, canWrite) {
    const refsOn = card.refs.map((key) => SOURCES.find((source) => source.key === key)?.label).filter(Boolean);
    return `<article class="flow-card is-${statusOf(card)}" data-flow-card="${card.id}">
      <div class="flow-card-head">
        <button type="button" class="flow-handle" data-flow-handle="${card.id}" draggable="true" title="按住拖动调整顺序" aria-label="拖动排序" ${canWrite ? '' : 'disabled'}>⠿</button>
        <input class="flow-title" data-flow-title="${card.id}" data-write value="${escapeHtml(card.title)}" maxlength="40" placeholder="卡片名（也是这次生成的任务）" ${canWrite ? '' : 'disabled'} />
        ${statusChip(card)}
        <div class="flow-card-actions">
          <button type="button" class="button button-primary small" data-flow-run="${card.id}" data-write ${canWrite ? '' : 'disabled'}>▶ 运行</button>
          <button type="button" class="button button-ghost small" data-flow-dup="${card.id}" data-write ${canWrite ? '' : 'disabled'}>复制</button>
          <button type="button" class="button button-ghost small danger" data-flow-del="${card.id}" data-write ${canWrite ? '' : 'disabled'}>删除</button>
        </div>
      </div>
      <div class="flow-card-body">
        <div class="flow-row">
          <label class="flow-field"><span>技能包</span>${skillSelect(card, canWrite)}</label>
        </div>
        <div class="flow-field"><span>引用资料<small class="flow-hint">${refsOn.length ? `已引用 ${refsOn.length} 项` : '一项都没选：AI 只会按再要求写'}</small></span>${refChips(card, canWrite)}</div>
        <div class="flow-field"><span>引用卡片<small class="flow-hint">上游 agent 的输出会一起交给这张卡片</small></span>${fromChips(card, canWrite)}</div>
        <label class="flow-field"><span>再要求<small class="flow-hint">语气、篇幅、必须写到的点、事实边界</small></span>
          <textarea class="flow-instruction" data-flow-instruction="${card.id}" data-write rows="2" placeholder="选填：例如「写给大一新生看的，语气轻松，300 字以内」" ${canWrite ? '' : 'disabled'}>${escapeHtml(card.instruction)}</textarea>
        </label>
        ${outputBlock(card, canWrite)}
      </div>
    </article>`;
  }

  function render() {
    const panel = $('#workflowPanel');
    if (!panel) return;
    syncHistoryToProject();
    const list = cards();
    if (mode === 'canvas') {
      seedLayout();
      if (focusId && !find(focusId)) focusId = null;
    }
    const canWrite = U.canOperate();
    const current = state();
    const done = list.filter((card) => card.output).length;
    const ready = window.WB.ai.ready;
    const summary = current.project
      ? `共 ${list.length} 张卡片，已出稿 ${done} 张${ready ? '' : '；当前未连接 AI，只能手写或离线查看'}`
      : '还没有项目：先建立项目信息表，卡片才有资料可引用。';
    const modeHint = mode === 'canvas'
      ? '二维画布：卡片位置可自由拖动；从卡片右侧 ◦ 拖到另一张卡片就建立引用；点卡片弹出配置窗写要求、看正文、导 Word。'
      : '列表模式：卡片按顺序排成一列，适合逐张改要求与正文。切回「画布」看引用拓扑。';
    panel.innerHTML = `
      <div class="panel-head">
        <div>
          <h2>卡片工作流</h2>
          <p>用于「一份活动口径，派生多份材料」：输入项目事实 → 整理执行口径 → 引用它生成通知、岗位简报等。连线表示下游使用上游正文；修改上游后，重跑下游才能更新。</p>
          <p>标准材料可在「过程材料」直接编辑；需要复用同一份口径时用卡片串联。卡片出稿后点「写入过程材料」，即可进入主线材料与阶段检查。</p>
          <p>${modeHint}</p>
          <p id="flowSummary" class="skill-summary">${escapeHtml(summary)}</p>
        </div>
        <div class="panel-actions">
          <div class="seg-switch flow-mode" role="group" aria-label="编排视图">
            <button type="button" data-flow-view="canvas" class="${mode === 'canvas' ? 'is-active' : ''}">画布</button>
            <button type="button" data-flow-view="list" class="${mode === 'list' ? 'is-active' : ''}">列表</button>
          </div>
          <button type="button" class="button button-ghost" data-flow-from-outputs data-write>＋ 按产出配置生成卡片</button>
          <button type="button" class="button button-ghost" data-flow-starter data-write>＋ 示例：口径 → 通知 / 岗位简报</button>
          <button type="button" class="button button-ghost" data-flow-add data-write>＋ 新建卡片</button>
          <button type="button" class="button button-primary" data-flow-run-all data-write>▶ 运行全部</button>
          <button type="button" class="button button-ghost" data-flow-export="word">导出 Word</button>
          <button type="button" class="button button-ghost" data-flow-export="md">导出工作流（Markdown）</button>
          <button type="button" class="button button-ghost" data-flow-export="json">导出工作流（JSON）</button>
        </div>
      </div>
      ${mode === 'canvas'
        ? canvasHtml(canWrite)
        : `<div class="flow-board" id="flowBoard">${list.length ? list.map((card) => cardHtml(card, canWrite)).join('') : emptyHtml()}</div>`}`;
    /* 放大画布的状态挂在面板上而不是 body：切到别的视图时 CSS 的 :has 选择器自动失效 */
    panel.classList.toggle('is-immersive', immersiveOn() && mode === 'canvas');
    window.WB.gateWrites?.();
    /* 弹窗是独立的一棵 DOM（挂在 body 上），所以单独刷新它 */
    const host = modalHost();
    if (host) host.innerHTML = modalHtml(canWrite) + paletteHtml();
    queueRelayout();
  }

  function emptyHtml() {
    return `<div class="card flow-empty-card">
      <div class="empty"><strong>还没有卡片</strong>
        点上面「＋ 新建卡片」从零起步，或点「＋ 按产出配置生成卡片」把已勾选的产出一次变成为卡片（技能包已经选好）。<br />
        典型用法：第一张卡片放「项目信息表 + 活动安排」，让它写出整体思路；第二张卡片引用第一张的输出，再写成通知稿。</div>
    </div>`;
  }

  /* ── 导出与复制 ───────────────────────── */

  function cardMarkdown(card) {
    const lines = [`## ${card.title || '未命名卡片'}`, ''];
    lines.push(`- 技能包：${skillLabel(card.skill)}`);
    const refs = card.refs.map((key) => SOURCES.find((source) => source.key === key)?.label).filter(Boolean);
    lines.push(`- 引用资料：${refs.length ? refs.join('、') : '无'}`);
    const from = card.from.map((id) => find(id)?.title).filter(Boolean);
    if (from.length) lines.push(`- 引用卡片：${from.join('、')}`);
    if (card.instruction.trim()) lines.push(`- 再要求：${card.instruction.trim()}`);
    lines.push('', card.output?.text || '（还没运行）', '');
    return lines.join('\n');
  }

  function exportMarkdown() {
    const list = cards();
    if (!list.length) { window.WB.toast('还没有卡片'); return; }
    const lines = [`# ${store().projectName()}｜卡片工作流`, '', `共 ${list.length} 张卡片，已出稿 ${list.filter((card) => card.output).length} 张。`, ''];
    for (const card of list) lines.push(cardMarkdown(card));
    U.downloadText(`${U.safeFileName(store().projectName())}-卡片工作流.md`, lines.join('\n'));
  }

  function exportJson() {
    if (!cards().length) { window.WB.toast('还没有卡片'); return; }
    U.downloadText(`${U.safeFileName(store().projectName())}-卡片工作流.json`, JSON.stringify(workflow(), null, 2), 'application/json;charset=utf-8');
  }

  function copyText(id) {
    const text = find(id)?.output?.text;
    if (!text) { window.WB.toast('这张卡片还没有正文'); return; }
    const done = () => window.WB.toast('已复制正文');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    } catch { window.WB.toast('复制失败，可点「改正文」手动全选'); }
  }

  /* ── 交互 ─────────────────────────────── */

  function toggleRef(id, key) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改引用资料'); return; }
    const card = find(id);
    if (!card || !SOURCE_KEYS.has(key)) return;
    remember('改引用资料');
    card.refs = card.refs.includes(key) ? card.refs.filter((item) => item !== key) : [...card.refs, key];
    store().save();
    render();
  }

  function toggleFrom(id, upId) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改引用卡片'); return; }
    const card = find(id);
    if (!card || !find(upId)) return;
    remember('改引用卡片');
    card.from = card.from.includes(upId) ? card.from.filter((item) => item !== upId) : [...card.from, upId];
    store().save();
    render();
  }

  function clearDrop() {
    for (const node of document.querySelectorAll?.('.flow-card') || []) node.classList.remove('is-over', 'is-over-before', 'is-over-after');
  }

  function markDrop(over, event) {
    const rect = over.getBoundingClientRect?.();
    const after = rect && rect.height ? event.clientY > rect.top + rect.height / 2 : false;
    over.classList.toggle('is-over-before', !after);
    over.classList.toggle('is-over-after', Boolean(after));
  }

  /* 连着打字算一步：每个输入框只在「第一次敲」时留一份快照 */
  function markEdit(el, label) {
    if (!el?.dataset || el.dataset.flowDirty === '1') return false;
    el.dataset.flowDirty = '1';
    return remember(label);
  }

  function bindPanel(panel) {
    panel.addEventListener('click', (event) => {
      const hit = (attr) => event.target.closest(`[${attr}]`);
      const run = hit('data-flow-run');
      if (run) { runCard(run.dataset.flowRun); return; }
      if (event.target.closest('[data-flow-run-all]')) { runAll(); return; }
      if (event.target.closest('[data-flow-add]')) { addCard(); return; }
      if (event.target.closest('[data-flow-from-outputs]')) { addFromOutputs(); return; }
      if (event.target.closest('[data-flow-starter]')) { addStarter(); return; }
      const material = hit('data-flow-material');
      if (material) { writeMaterial(material.dataset.flowMaterial); return; }
      const manual = hit('data-flow-manual');
      if (manual) { if (!U.canOperate()) return; const card = find(manual.dataset.flowManual); if (!card) return; card.output = { title: card.title, text: '', at: nowIso(), model: '手工' }; previewMode.set(card.id, 'text'); store().save(); render(); return; }
      const del = hit('data-flow-del');
      if (del) {
        const card = find(del.dataset.flowDel);
        if (card && confirm(`删除卡片《${card.title || '未命名卡片'}》？其余卡片对它的引用会一并摘掉。`)) deleteCard(del.dataset.flowDel);
        return;
      }
      const dup = hit('data-flow-dup');
      if (dup) { duplicateCard(dup.dataset.flowDup); return; }
      const ref = hit('data-flow-ref');
      if (ref) { toggleRef(ref.dataset.flowRef, ref.dataset.flowSource); return; }
      const up = hit('data-flow-from');
      if (up) { toggleFrom(up.dataset.flowFrom, up.dataset.flowUp); return; }
      const edit = hit('data-flow-edit');
      if (edit) {
        const id = edit.dataset.flowEdit;
        previewMode.set(id, previewMode.get(id) === 'text' ? 'preview' : 'text');
        render();
        return;
      }
      const copy = hit('data-flow-copy');
      if (copy) { copyText(copy.dataset.flowCopy); return; }
      const one = hit('data-flow-card-export');
      if (one) {
        const card = find(one.dataset.flowCardExport);
        if (card) U.downloadText(`${U.safeFileName(store().projectName())}-${U.safeFileName(card.title || '卡片')}.md`, cardMarkdown(card));
        return;
      }
      const all = hit('data-flow-export');
      if (all) {
        if (all.hasAttribute('data-flow-card-word')) return;
        const kind = all.dataset.flowExport;
        if (kind === 'json') exportJson();
        else if (kind === 'word') exportWord();
        else exportMarkdown();
      }
    });

    /* 打字只改内存，落盘交给 focusout；不重绘，免得打断输入 */
    panel.addEventListener('input', (event) => {
      if (!U.canOperate()) return;
      const title = event.target.closest('[data-flow-title]');
      if (title) { const card = find(title.dataset.flowTitle); if (card) { markEdit(title, '改卡片名'); card.title = title.value; } return; }
      const ins = event.target.closest('[data-flow-instruction]');
      if (ins) { const card = find(ins.dataset.flowInstruction); if (card) { markEdit(ins, '改再要求'); card.instruction = ins.value; } return; }
      const text = event.target.closest('[data-flow-text]');
      if (text) { const card = find(text.dataset.flowText); if (card?.output) { markEdit(text, '改正文'); card.output.text = text.value; card.output.at = nowIso(); card.status = U.text(text.value) ? 'done' : 'draft'; } return; }
      /* 搜索框：只重画搜索面板本身，整页重绘会把输入焦点丢掉 */
      const search = event.target.closest('[data-flow-palette-input]');
      if (search && palette) { palette.query = search.value; palette.index = 0; paintPalette(); }
    });

    panel.addEventListener('change', (event) => {
      const skill = event.target.closest('[data-flow-skill]');
      if (!skill) return;
      if (!U.canOperate()) { window.WB.toast('只读访客不能改技能包'); render(); return; }
      const card = find(skill.dataset.flowSkill);
      if (!card) return;
      card.skill = skill.value;
      store().save();
      render();
    });

    panel.addEventListener('focusout', (event) => {
      if (!U.canOperate()) return;
      if (event.target.closest('[data-flow-text]') || event.target.closest('[data-flow-instruction]')) { store().save(); return; }
      const title = event.target.closest('[data-flow-title]');
      if (title) { const card = find(title.dataset.flowTitle); if (card) card.title = U.text(title.value) || '未命名卡片'; store().save(); }
    });

    /* 只有左边的 ⠿ 是可拖的：卡片里有输入框，整卡可拖会抢走选字 */
    panel.addEventListener('dragstart', (event) => {
      const handle = event.target.closest('[data-flow-handle]');
      if (!handle || !U.canOperate()) { event.preventDefault(); return; }
      dragId = handle.dataset.flowHandle;
      handle.closest('.flow-card')?.classList.add('is-dragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragId); }
    });

    panel.addEventListener('dragover', (event) => {
      if (!dragId) return;
      const over = event.target.closest('[data-flow-card]');
      if (!over || over.dataset.flowCard === dragId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      markDrop(over, event);
    });

    panel.addEventListener('dragleave', (event) => {
      const over = event.target.closest('[data-flow-card]');
      if (over) over.classList.remove('is-over-before', 'is-over-after');
    });

    panel.addEventListener('drop', (event) => {
      const over = event.target.closest('[data-flow-card]');
      if (!dragId || !over) return;
      event.preventDefault();
      const rect = over.getBoundingClientRect?.();
      const after = rect && rect.height ? event.clientY > rect.top + rect.height / 2 : false;
      moveCard(dragId, over.dataset.flowCard, after ? 'after' : 'before');
      clearDrop();
      dragId = null;
      render();
    });

    panel.addEventListener('dragend', () => { dragId = null; clearDrop(); });
  }

  function mount() {
    const panel = $('#workflowPanel');
    if (!panel || panel.dataset.flowMounted) return;
    panel.dataset.flowMounted = '1';
    bindKeys();
    bindPanel(panel);
    bindCanvas(panel);
    /* 弹窗宿主：复用同一套 bindPanel + 画布点击分支，事件口径与面板完全一致 */
    const host = modalHost();
    if (host && !host.dataset.flowModalBound) {
      host.dataset.flowModalBound = '1';
      bindPanel(host);
      host.addEventListener('click', onCanvasClick);
    }
  }

  /* ══ 二维画布（工作空间）══════════════════════════════════════════════
     把一维卡片列表升级成二维可拖拽画布：卡片自由定位、拖动、连线、点开配置。
     - 坐标 x / y 存在 state.workflow.cards 里，随存档与项目包往返；
       老存档没有坐标时按依赖层级自动排布（投影，不改数据结构）。
     - 连线是「引用关系」的投影：卡片→卡片 = from，资料源→卡片 = refs。
       不另存一份边表，避免出现两份真相。
     - 纯前端 + 原生能力：pointer 事件拖动 / 连线，transform 做平移缩放。 */

  const NODE_W = 268;              /* 卡片节点宽（画布坐标，与 CSS 里 .flow-node 的宽度一致） */
  const NODE_H = 148;              /* 量不到真实高度时的估高，只影响连线端点与自动间距 */
  const COL_GAP = 104;             /* 依赖层级之间的水平间距 */
  const ROW_GAP = 40;              /* 同层卡片之间的垂直间距 */
  const PILL_W = 176;              /* 资料源药丸尺寸 */
  const PILL_H = 40;
  const PILL_GAP = 12;
  const PILL_X = -320;             /* 资料源固定在第一列（画布坐标为负，往左拖才看得到） */
  const SOURCE_INDEX = new Map(SOURCES.map((source, index) => [source.key, index]));
  const paletteY = (index) => index * (PILL_H + PILL_GAP);
  const MAP_W = 172;               /* 缩略图尺寸（与 CSS 里 .flow-map-body 的宽高一致） */
  const MAP_H = 108;

  let mode = 'canvas';             /* canvas 二维画布 / list 一维列表（列表模式保留原有的逐项编辑） */
  let focusId = null;              /* 弹窗里正在配置的卡片 */
  let viewportFitted = false;      /* 首次进入自动「适配视图」，之后不再抢用户的视角 */
  let suppressClick = 0;           /* 刚拖完卡片的这一次点击不当作「打开卡片」 */
  let drag = null;                 /* { id, dx, dy, moved } 正在拖卡片 */
  let pan = null;                  /* { cx, cy, x, y } 正在平移画布 */
  let linking = null;              /* { id, key } 正在拉一条连线 */
  let mapDrag = null;              /* 正在拖缩略图：只影响视角，不写数据 */
  let pendingCapture = null;       /* { panel, pointerId, x, y }：还没真正开始拖，先不捕获指针 */
  let edgesHidden = false;         /* 「隐藏连线」：只想看卡片时把引用线收起来 */
  /* 「放大画布」的状态存在本机存档里（state.ui.flowImmersive，与 taskView / 各种筛选同一层）：
     它是个人习惯、不是项目内容——切项目不变、刷新还在。读写一律走 immersiveOn() / setImmersive()。 */
  const immersiveOn = () => Boolean(state()?.ui?.flowImmersive);
  let panToggle = false;           /* 工具坞切到「拖动模式」；按住 Space 同样算拖动模式 */
  let spaceHeld = false;
  let palette = null;              /* 「搜索画布」打开时才有值：{ query, index } */
  const history = { past: [], future: [] };  /* 撤销 / 重做：整份卡片数据的快照 */
  const HISTORY_MAX = 40;
  const viewport = { x: 56, y: 20, k: 1 };
  const nodeHeights = new Map();   /* 渲染后量到的真实高度，让连线端点贴着卡片上下缘的中点 */

  const hasPos = (card) => Number.isFinite(card?.x) && Number.isFinite(card?.y);
  const canvasNode = () => document.getElementById?.('flowCanvas') || null;
  const raf = (fn) => (typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(fn) : fn());

  /* ── 自动排布：列 = 依赖层级，行 = 同层顺序 ──────────────
     深度按「引用上游」递归算：没引用任何卡片的在第 0 列，引用了第 0 列的在第 1 列……
     遇到环按 0 处理，不让它无限递归（环本身由 addFrom 拦住，这里只是兜底）。 */
  function depthOfCards() {
    const list = cards();
    const byId = new Map(list.map((card) => [card.id, card]));
    const memo = new Map();
    const walk = (id, seen) => {
      if (memo.has(id)) return memo.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      const ups = (byId.get(id)?.from || []).filter((up) => byId.has(up));
      const depth = ups.length ? Math.max(...ups.map((up) => walk(up, seen) + 1)) : 0;
      seen.delete(id);
      memo.set(id, depth);
      return depth;
    };
    return new Map(list.map((card) => [card.id, walk(card.id, new Set())]));
  }

  /* 一层最多先竖着排 BAND_ROWS 张，再往右接一列：20 多张互相独立的卡片
     不会变成一根三千多像素的长条。左→右仍然是上游→下游，只是同一层可以占几列。 */
  const BAND_ROWS = 5;

  function autoPositions() {
    const depths = depthOfCards();
    const counts = new Map();
    for (const depth of depths.values()) counts.set(depth, (counts.get(depth) || 0) + 1);
    const bandX = new Map();
    let cursor = 0;
    for (const depth of [...counts.keys()].sort((a, b) => a - b)) {
      bandX.set(depth, cursor);
      cursor += Math.max(1, Math.ceil(counts.get(depth) / BAND_ROWS)) * (NODE_W + COL_GAP);
    }
    const placed = new Map();
    const out = new Map();
    for (const card of cards()) {
      const depth = depths.get(card.id) || 0;
      const index = placed.get(depth) || 0;
      placed.set(depth, index + 1);
      const column = Math.floor(index / BAND_ROWS);
      const row = index % BAND_ROWS;
      out.set(card.id, {
        x: (bandX.get(depth) || 0) + column * (NODE_W + COL_GAP),
        y: row * (NODE_H + ROW_GAP)
      });
    }
    return out;
  }

  /* 老存档 / 旧项目包里的卡片没有坐标：第一次进画布时补上并落盘，之后位置就归用户了 */
  function seedLayout() {
    const list = cards();
    if (!list.length) return false;
    const missing = list.filter((card) => !hasPos(card));
    if (!missing.length) return false;
    const plan = autoPositions();
    for (const card of missing) {
      const point = plan.get(card.id);
      const x = point.x;
      let y = point.y;
      /* 已经在画布上的卡片一律不动：新卡片往下找第一个不撞的位置 */
      const collides = () => list.some((other) => other.id !== card.id && hasPos(other)
        && other.x < x + NODE_W + 16 && other.x + NODE_W + 16 > x
        && other.y < y + NODE_H + ROW_GAP && other.y + NODE_H + ROW_GAP > y);
      let guard = 0;
      while (collides() && guard < 200) { y += NODE_H + ROW_GAP; guard += 1; }
      card.x = x;
      card.y = y;
    }
    store().save();
    return true;
  }

  function autoLayout() {
    if (!U.canOperate()) { window.WB.toast('只读访客不能调整画布'); return; }
    if (!cards().length) { window.WB.toast('还没有卡片'); return; }
    remember('自动排布');
    const plan = autoPositions();
    for (const card of cards()) {
      const point = plan.get(card.id);
      card.x = point.x;
      card.y = point.y;
    }
    store().log('workflow', '画布按依赖层级重排');
    store().save();
    render();
    window.WB.toast('已按引用层级重排（左→右 = 上游→下游）');
  }

  /* ── 视图平移与缩放 ─────────────────────────────────── */

  function paintViewport() {
    const inner = document.getElementById?.('flowCanvasInner');
    if (inner?.style) inner.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`;
    const label = document.getElementById?.('flowZoom');
    if (label) label.textContent = `${Math.round(viewport.k * 100)}%`;
    paintMinimap();
  }

  function canvasRect() {
    const rect = canvasNode()?.getBoundingClientRect?.();
    return rect && rect.width ? rect : null;
  }

  /* 屏幕坐标 → 画布坐标（把平移与缩放反算回去） */
  function canvasPoint(event) {
    const rect = canvasRect();
    const k = viewport.k || 1;
    return {
      x: (event.clientX - (rect?.left || 0) - viewport.x) / k,
      y: (event.clientY - (rect?.top || 0) - viewport.y) / k
    };
  }

  function nodeBox() {
    let minX = PILL_X, maxX = PILL_X + PILL_W, minY = 0, maxY = PILL_H;
    for (const card of cards()) {
      if (!hasPos(card)) continue;
      const h = nodeHeights.get(card.id) || NODE_H;
      minX = Math.min(minX, card.x);
      maxX = Math.max(maxX, card.x + NODE_W);
      minY = Math.min(minY, card.y);
      maxY = Math.max(maxY, card.y + h);
    }
    return { minX, maxX, minY, maxY };
  }

  /* ── 撤销 / 重做：整份卡片数据的快照 ───────────────────────────────
     画布上的手工活儿（摆位、连线、删卡片）最怕手滑，而画布又没有浏览器的
     原生撤销。快照只存 state.workflow.cards，几 KB 量级，留最近 40 步。 ── */

  const snapshotCards = () => JSON.stringify(cards());

  /* 历史是「这个项目」的历史：切项目（含导入项目包）就把栈清空，
     否则一步撤销会把别的项目的数据搬进当前项目。 */
  let historyProjectId;
  function syncHistoryToProject() {
    const id = store().state?.activeId ?? null;
    if (historyProjectId === undefined) { historyProjectId = id; return; }
    if (historyProjectId !== id) { historyProjectId = id; history.past.length = 0; history.future.length = 0; }
  }

  /* data 是「改动之前」的整份数据：所以要在改之前调用 */
  function pushHistory(label, data) {
    if (!U.canOperate()) return false;
    const before = data ?? snapshotCards();
    const last = history.past[history.past.length - 1];
    if (last && last.data === before) return false;
    history.past.push({ label, data: before });
    if (history.past.length > HISTORY_MAX) history.past.shift();
    history.future.length = 0;
    paintHistory();
    return true;
  }
  const remember = (label) => pushHistory(label, snapshotCards());

  function applySnapshot(data) {
    const next = JSON.parse(data);
    const live = cards();
    live.splice(0, live.length, ...next);
    store().save();
  }

  function undo() {
    if (!U.canOperate()) { window.WB.toast('只读访客不能撤销'); return false; }
    if (!history.past.length) return false;
    const entry = history.past.pop();
    history.future.push({ label: entry.label, data: snapshotCards() });
    applySnapshot(entry.data);
    render();
    window.WB.toast(`已撤销：${entry.label}`);
    return true;
  }

  function redo() {
    if (!U.canOperate()) { window.WB.toast('只读访客不能重做'); return false; }
    if (!history.future.length) return false;
    const entry = history.future.pop();
    history.past.push({ label: entry.label, data: snapshotCards() });
    applySnapshot(entry.data);
    render();
    window.WB.toast(`已重做：${entry.label}`);
    return true;
  }

  /* 工具坞上的撤销 / 重做按钮要跟着历史深度亮灭 */
  function paintHistory() {
    const undoBtn = document.querySelector?.('[data-flow-undo]');
    const redoBtn = document.querySelector?.('[data-flow-redo]');
    const can = U.canOperate();
    if (undoBtn) undoBtn.disabled = !can || !history.past.length;
    if (redoBtn) redoBtn.disabled = !can || !history.future.length;
  }

  /* ── 隐藏连线 / 收起卡片 ── */
  function toggleEdges() {
    edgesHidden = !edgesHidden;
    render();
    window.WB.toast(edgesHidden ? '已隐藏引用连线（只看卡片）' : '已显示引用连线');
    return edgesHidden;
  }

  function toggleCollapse(id) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能收起卡片'); return false; }
    const card = find(id);
    if (!card) return false;
    remember(card.collapsed ? '展开卡片' : '收起卡片正文');
    card.collapsed = !card.collapsed;
    store().save();
    render();
    return true;
  }

  /* ── 指针模式：选中 / 拖动（参照画布工具的通行做法，Space 是临时抓手）── */
  const panMode = () => panToggle || spaceHeld;
  const typingIn = (target) => Boolean(target?.closest?.('input, textarea, select, button, [contenteditable="true"]'));

  function setPanMode(next) {
    panToggle = Boolean(next);
    paintPointerMode();
  }

  function paintPointerMode() {
    const on = panMode();
    const canvas = canvasNode();
    canvas?.classList?.toggle?.('is-hand', on);
    for (const tab of document.querySelectorAll?.('[data-flow-pan-mode]') || []) {
      tab.classList?.toggle?.('is-active', (tab.dataset?.flowPanMode === 'pan') === on);
    }
  }

  /* ── 搜索画布（⌘K / Ctrl+K）：卡片一多，靠眼睛找不如搜 ── */
  function paletteResults() {
    const q = (palette?.query || '').trim().toLowerCase();
    const list = cards();
    if (!q) return list;
    return list.filter((card) => [card.title, skillLabel(card.skill), card.instruction, card.output?.text || '']
      .join(' ').toLowerCase().includes(q));
  }

  function paletteHtml() {
    if (!palette) return '';
    const all = cards();
    const results = paletteResults();
    const index = Math.min(Math.max(palette.index, 0), Math.max(0, results.length - 1));
    const items = results.map((card, i) => `<li><button type="button" class="flow-palette-item${i === index ? ' is-active' : ''}" data-flow-palette-open="${card.id}">
        <b>${escapeHtml(card.title || '未命名卡片')}</b>
        <small>${escapeHtml(skillLabel(card.skill))} · 资料 ${card.refs.length}${card.from.length ? ` · 上游 ${card.from.length}` : ''}${card.output ? ' · 已出稿' : ''}</small>
      </button></li>`).join('');
    return `<div class="flow-palette" data-flow-palette>
      <div class="flow-modal-mask" data-flow-palette-close></div>
      <div class="flow-palette-box" role="dialog" aria-modal="true" aria-label="搜索画布">
        <input id="flowPaletteInput" class="flow-palette-input" data-flow-palette-input value="${escapeHtml(palette.query)}"
          placeholder="搜索画布：卡片名 / 技能包 / 再要求 / 正文（↑↓ 选择，Enter 跳过去，Esc 关闭）" />
        <ul class="flow-palette-list">${items || '<li class="flow-palette-empty">没有匹配的卡片</li>'}</ul>
        <p class="flow-palette-foot">共 ${all.length} 张卡片 · 回车跳到选中那张并把视野挪过去</p>
      </div>
    </div>`;
  }

  function openPalette() {
    if (!cards().length) { window.WB.toast('画布上还没有卡片，先建一张再搜'); return false; }
    palette = { query: '', index: 0 };
    render();
    document.querySelector?.('#flowPaletteInput')?.focus?.();
    return true;
  }

  function closePalette() {
    if (!palette) return false;
    palette = null;
    render();
    return true;
  }

  function movePalette(step) {
    if (!palette) return false;
    const total = paletteResults().length;
    if (!total) return false;
    palette.index = (palette.index + step + total) % total;
    paintPalette();
    return true;
  }

  /* 只重画搜索面板本身：整页重绘会把输入焦点丢掉 */
  function paintPalette() {
    const box = document.querySelector?.('.flow-palette');
    if (!box || typeof box.outerHTML !== 'string') return;
    box.outerHTML = paletteHtml();
    const input = document.querySelector?.('#flowPaletteInput');
    if (input?.focus) { input.focus(); try { input.setSelectionRange?.(input.value.length, input.value.length); } catch { /* 老浏览器没有 setSelectionRange */ } }
  }

  /* 把某张卡片挪到视野正中，并闪一下，让人知道「就是这张」 */
  function centerOn(card) {
    const rect = canvasRect();
    if (!rect || !card || !hasPos(card)) return false;
    if (viewport.k < 0.8) viewport.k = 0.9;
    const height = nodeHeights.get(card.id) || NODE_H;
    viewport.x = Math.round(rect.width / 2 - (card.x + NODE_W / 2) * viewport.k);
    viewport.y = Math.round(rect.height / 2 - (card.y + height / 2) * viewport.k);
    paintViewport();
    return true;
  }

  function paletteJump(id) {
    const card = find(id);
    palette = null;
    render();
    if (!card) return false;
    viewportFitted = true;
    centerOn(card);
    const node = nodeElement(id);
    node?.classList?.add('is-flash');
    if (typeof setTimeout === 'function') setTimeout(() => node?.classList?.remove('is-flash'), 1400);
    return true;
  }

  /* 100%：回到 1:1 并把内容摆到正中 */
  function resetZoom() {
    viewportFitted = true;
    const rect = canvasRect();
    const box = nodeBox();
    viewport.k = 1;
    if (rect) {
      viewport.x = Math.round(rect.width / 2 - ((box.minX + box.maxX) / 2));
      viewport.y = Math.round(rect.height / 2 - ((box.minY + box.maxY) / 2));
    }
    paintViewport();
    return viewport.k;
  }

  /* ── 键盘：Space 抓手 / ⌘K 搜索 / ⌘Z 撤销 / ⌘Y 重做 ── */
  let keysBound = false;
  function bindKeys() {
    if (keysBound || typeof document?.addEventListener !== 'function') return;
    keysBound = true;
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === 'k' || event.key === 'K')) { event.preventDefault?.(); openPalette(); return; }
      if (mode !== 'canvas' || !canvasNode()) return;
      if (mod && (event.key === 'y' || event.key === 'Y')) { event.preventDefault?.(); redo(); return; }
      if (mod && (event.key === 'z' || event.key === 'Z')) { event.preventDefault?.(); if (event.shiftKey) redo(); else undo(); return; }
      if (palette) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault?.(); movePalette(event.key === 'ArrowDown' ? 1 : -1); return; }
        if (event.key === 'Enter') { const pick = paletteResults()[palette.index]; if (pick) { event.preventDefault?.(); paletteJump(pick.id); } return; }
        if (event.key === 'Escape') { event.preventDefault?.(); closePalette(); return; }
      }
      if (event.key === ' ' && !typingIn(target)) {
        event.preventDefault?.();
        if (!spaceHeld) { spaceHeld = true; paintPointerMode(); }
      }
    });
    document.addEventListener('keyup', (event) => {
      if (event.key !== ' ') return;
      if (spaceHeld) { spaceHeld = false; paintPointerMode(); }
    });
    /* 切走窗口时 Space 的 keyup 会丢：别让画布卡在抓手状态 */
    window.addEventListener?.('blur', () => { if (spaceHeld) { spaceHeld = false; paintPointerMode(); } });
  }

  /* 适配视图：min 是缩放下限。「第一次进来」给 0.8（卡片上的字要能读），
     手动点「适配」时放到 0.2（先看全，看不清再自己放大）。 */
  function fitView(min = 0.2) {
    const rect = canvasRect();
    if (!rect) return;
    const box = nodeBox();
    const spanX = Math.max(1, box.maxX - box.minX);
    const spanY = Math.max(1, box.maxY - box.minY);
    const k = Math.min(1, Math.max(min, Math.min((rect.width - 72) / spanX, (rect.height - 72) / spanY)));
    viewport.k = Number(k.toFixed(3));
    viewport.x = Math.round((rect.width - spanX * viewport.k) / 2 - box.minX * viewport.k);
    viewport.y = Math.round((rect.height - spanY * viewport.k) / 2 - box.minY * viewport.k);
    /* 已经缩到下限（首次进入是 0.8）还是装不下：别再居中——居中被切掉的是首尾两行，
       看上去像坏了。改成把内容左上角对齐到画布左上角，剩下的往右下拖就是。 */
    if (spanX * viewport.k > rect.width - 72) viewport.x = Math.round(36 - box.minX * viewport.k);
    if (spanY * viewport.k > rect.height - 72) viewport.y = Math.round(36 - box.minY * viewport.k);
    paintViewport();
  }

  function zoomAt(factor, event) {
    const before = viewport.k;
    const next = Math.min(2, Math.max(0.25, before * factor));
    if (next === before) return;
    const rect = canvasRect();
    const k = next / before;
    if (rect && event) {
      /* 让光标底下的那个点不动：先算它在画布坐标里的位置，缩放后把它顶回原处 */
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      viewport.x = px - (px - viewport.x) * k;
      viewport.y = py - (py - viewport.y) * k;
    }
    viewport.k = Number(next.toFixed(3));
    paintViewport();
  }
  /* ── 连线的几何：一条边 = 一个引用关系 ─────────────── */

  function edgePath(x1, y1, x2, y2) {
    const bend = Math.max(48, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  }

  function edgesOf() {
    const list = cards();
    const byId = new Map(list.map((card) => [card.id, card]));
    const edges = [];
    for (const card of list) {
      if (!hasPos(card)) continue;
      const targetY = card.y + (nodeHeights.get(card.id) || NODE_H) / 2;
      for (const upId of card.from) {
        const up = byId.get(upId);
        if (!up || !hasPos(up)) continue;
        const sourceY = up.y + (nodeHeights.get(up.id) || NODE_H) / 2;
        const x1 = up.x + NODE_W, x2 = card.x;
        edges.push({ kind: 'from', card: card.id, ref: up.id, x1, y1: sourceY, x2, y2: targetY, d: edgePath(x1, sourceY, x2, targetY) });
      }
      for (const key of card.refs) {
        const index = SOURCE_INDEX.get(key);
        if (index === undefined) continue;
        const sourceY = paletteY(index) + PILL_H / 2;
        const x1 = PILL_X + PILL_W, x2 = card.x;
        edges.push({ kind: 'ref', card: card.id, ref: key, x1, y1: sourceY, x2, y2: targetY, d: edgePath(x1, sourceY, x2, targetY) });
      }
    }
    return edges;
  }

  function edgesSvg(temp = null) {
    const edges = edgesHidden ? [] : edgesOf();
    if (!edges.length && !temp) return '<svg class="flow-edges" data-flow-edges width="0" height="0"></svg>';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const edge of edges) {
      minX = Math.min(minX, edge.x1, edge.x2);
      maxX = Math.max(maxX, edge.x1, edge.x2);
      minY = Math.min(minY, edge.y1, edge.y2);
      maxY = Math.max(maxY, edge.y1, edge.y2);
    }
    if (temp) {
      minX = Math.min(minX, temp.x1, temp.x2);
      maxX = Math.max(maxX, temp.x1, temp.x2);
      minY = Math.min(minY, temp.y1, temp.y2);
      maxY = Math.max(maxY, temp.y1, temp.y2);
    }
    if (!Number.isFinite(minX)) { minX = temp.x1; maxX = temp.x1; minY = temp.y1; maxY = temp.y1; }
    const pad = 64;
    const originX = Math.floor(minX - pad);
    const originY = Math.floor(minY - pad);
    const width = Math.ceil(maxX + pad - originX);
    const height = Math.ceil(maxY + pad - originY);
    return `<svg class="flow-edges" data-flow-edges width="${width}" height="${height}" style="left:${originX}px;top:${originY}px;width:${width}px;height:${height}px">
      <defs><marker id="flowArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
      <g transform="translate(${-originX}, ${-originY})">
        /* 命中层与可见线成对渲染：CSS 的「悬停变粗」靠 hit 与线相邻这条关系，
           两个 map 分开写就只有最后一条命中层配得上第一条线（悬停会加粗错的那条）。 */
        ${edges.map((edge) => `<path class="flow-edge-hit" d="${edge.d}" data-flow-edge="${edge.kind}:${edge.card}:${edge.ref}"></path><path class="flow-edge is-${edge.kind}" d="${edge.d}" marker-end="url(#flowArrow)"></path>`).join('')}
        ${temp ? `<path class="flow-edge is-temp" d="${edgePath(temp.x1, temp.y1, temp.x2, temp.y2)}"></path>` : ''}
      </g>
    </svg>`;
  }

  function measureNodes() {
    nodeHeights.clear();
    for (const node of document.querySelectorAll?.('.flow-node') || []) {
      const id = node?.dataset?.flowCard;
      const rect = node.getBoundingClientRect?.();
      if (id && rect?.height) nodeHeights.set(id, Math.round(rect.height));
    }
  }

  function paintEdges(temp = null) {
    const svg = document.querySelector?.('[data-flow-edges]');
    if (svg) svg.outerHTML = edgesSvg(temp);
  }

  /* 渲染后重新量高、重画边、必要时适配视图（首次进画布才动用户的视角） */
  function relayout() {
    if (mode !== 'canvas') return;
    measureNodes();
    paintEdges();
    paintMinimap(true);
    /* 面板还藏在幕后时量不到画布尺寸：这一帧不算「已适配」，等它露脸再适配一次 */
    if (!viewportFitted && cards().length) {
      if (canvasRect()) { viewportFitted = true; fitView(0.8); }
      return;
    }
    paintViewport();
  }
  const queueRelayout = () => raf(() => relayout());

  /* ── 连线：卡片 → 卡片（引用上游）／资料源 → 卡片（引用资料）── */

  /* 顺着 from 往上走，能不能走到 target：能，说明加这条边会绕成环 */
  function reaches(startId, targetId) {
    const byId = new Map(cards().map((card) => [card.id, card]));
    const stack = [startId];
    const seen = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const up of byId.get(id)?.from || []) stack.push(up);
    }
    return false;
  }

  function addFrom(cardId, upId) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能连线'); return false; }
    const card = find(cardId);
    const up = find(upId);
    if (!card || !up || card.id === up.id) return false;
    if (card.from.includes(up.id)) { window.WB.toast('这两张卡片已经连着了'); return false; }
    if (reaches(up.id, card.id)) { window.WB.toast('这样会绕成一个环：上游不能再依赖它的下游'); return false; }
    remember('连线');
    card.from = [...card.from, up.id];
    store().log('workflow', `连线《${up.title}》→《${card.title}》`);
    store().save();
    render();
    window.WB.toast(`已连线：《${up.title}》→《${card.title}》`);
    return true;
  }

  function removeFrom(cardId, upId) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能断线'); return; }
    const card = find(cardId);
    if (!card || !card.from.includes(upId)) return;
    remember('断开连线');
    card.from = card.from.filter((id) => id !== upId);
    store().save();
    render();
  }

  function setRef(cardId, key, on) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改引用资料'); return; }
    const card = find(cardId);
    if (!card || !SOURCE_KEYS.has(key)) return;
    const has = card.refs.includes(key);
    if (on === has) return;
    remember('改引用资料');
    card.refs = has ? card.refs.filter((item) => item !== key) : [...card.refs, key];
    store().log('workflow', `卡片《${card.title}》${has ? '取消引用' : '引用'}了${SOURCES.find((s) => s.key === key)?.label || key}`);
    store().save();
    render();
  }

  /* ── 画布上的卡片节点 ─────────────────────────────── */

  function excerptOf(card) {
    const raw = U.text(card.output?.text) || '';
    const flat = raw.replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*·]\s*/gm, '· ').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) return '';
    return flat.length > 92 ? `${flat.slice(0, 92)}…` : flat;
  }

  function nodeHtml(card, canWrite) {
    const refs = card.refs.length;
    const ups = card.from.filter((id) => find(id)).length;
    const text = excerptOf(card);
    const collapsed = Boolean(card.collapsed);
    const materialKey = materialKeyOf(card.skill);
    const body = text
      ? `<p class="flow-node-text">${escapeHtml(text)}</p>`
      : (running.has(card.id)
        ? '<p class="flow-node-text is-muted">正在生成…</p>'
        : `<p class="flow-node-text is-muted">${card.status === 'error' ? `运行失败：${escapeHtml(card.error || '未知错误')}` : '还没运行：打开卡片写要求，或直接点 ▶ 运行'}</p>`);
    return `<article class="flow-node is-${statusOf(card)}${collapsed ? ' is-collapsed' : ''}" data-flow-card="${card.id}" data-flow-open="${card.id}" style="left:${Math.round(card.x)}px;top:${Math.round(card.y)}px;width:${NODE_W}px">
      <span class="flow-node-port is-in${ups ? ' is-live' : ''}" aria-hidden="true" title="${ups ? `有 ${ups} 张上游卡片喂给它` : '还没有上游卡片'}"></span>
      <header class="flow-node-head" data-flow-drag="${card.id}" title="${canWrite ? '按住拖动这张卡片' : '只读身份：不能拖动卡片'}">
        <span class="flow-node-grip" aria-hidden="true">⠿</span>
        <b class="flow-node-title">${escapeHtml(card.title || '未命名卡片')}</b>
        ${statusChip(card)}
        <button type="button" class="flow-node-fold" data-flow-collapse="${card.id}" data-write title="${collapsed ? '展开正文' : '收起正文（只留标题与按钮，卡片多的时候用）'}" ${canWrite ? '' : 'disabled'}>${collapsed ? '▾' : '▴'}</button>
      </header>
      <div class="flow-node-meta">
        <span class="flow-node-skill">${escapeHtml(skillLabel(card.skill))}</span>
        <span class="flow-node-count">资料 ${refs}${ups ? ` · 上游 ${ups}` : ''}</span>
      </div>
      ${collapsed ? '' : body}
      <footer class="flow-node-foot">
        <button type="button" class="button button-primary small" data-flow-run="${card.id}" data-write ${canWrite ? '' : 'disabled'}>▶ 运行</button>
        <button type="button" class="button button-ghost small" data-flow-open="${card.id}">打开</button>
        ${materialKey ? `<button type="button" class="button button-ghost small" data-goto-view="material" data-goto-open="${materialKey}" title="深度编辑（表格合计 / 发票 / 海报 / 逐格填空）在「过程材料」页">看材料</button>` : ''}
        <button type="button" class="button button-ghost small danger" data-flow-del="${card.id}" data-write ${canWrite ? '' : 'disabled'}>删除</button>
      </footer>
      <button type="button" class="flow-node-link" data-flow-link="${card.id}" data-write title="从这里拖到另一张卡片上：让那张卡片引用这张的输出" ${canWrite ? '' : 'disabled'}>◦</button>
    </article>`;
  }

  /* 左边那一列资料源药丸（可拖到卡片上建立引用） */
  function sourcePillsHtml(canWrite) {
    return SOURCES.map((source, index) => {
      const used = cards().filter((card) => card.refs.includes(source.key)).length;
      return `<button type="button" class="flow-pill${used ? ' is-used' : ''}" data-flow-pill="${source.key}" data-write
        style="left:${PILL_X}px;top:${paletteY(index)}px;width:${PILL_W}px"
        title="${canWrite ? `拖到卡片上：那张卡片就引用「${source.label}」` : '只读身份：不能连线'}" ${canWrite ? '' : 'disabled'}>
        <b>${escapeHtml(source.label)}</b><small>${used ? `${used} 张在用` : `${sourceCount(source.key)} 条`}</small></button>`;
    }).join('');
  }

  /* ── 缩略图：画布比一屏大时，用来看「我在哪、还剩多少」，点/拖 = 跳过去 ── */

  function mapGeometry() {
    const box = nodeBox();
    const spanX = Math.max(1, box.maxX - box.minX);
    const spanY = Math.max(1, box.maxY - box.minY);
    return { box, spanX, spanY, ms: Math.min(MAP_W / spanX, MAP_H / spanY) };
  }

  function mapBodyHtml() {
    const { box, ms } = mapGeometry();
    const nodes = cards().filter(hasPos).map((card) => {
      const h = nodeHeights.get(card.id) || NODE_H;
      const kind = card.status === 'done' || card.status === 'error' ? card.status : 'draft';
      const style = `left:${Math.round((card.x - box.minX) * ms)}px;top:${Math.round((card.y - box.minY) * ms)}px;`
        + `width:${Math.max(2, Math.round(NODE_W * ms))}px;height:${Math.max(2, Math.round(h * ms))}px`;
      return `<i class="flow-map-node is-${kind}" style="${style}"></i>`;
    }).join('');
    return `${nodes}<i class="flow-map-view" id="flowMapView"></i>`;
  }

  function minimapHtml() {
    if (cards().filter(hasPos).length < 2) return '';
    return `<div class="flow-map" data-flow-map title="画布缩略图：点一下或按住拖动，视野就跳到那一块">
      <div class="flow-map-body" id="flowMapBody">${mapBodyHtml()}</div>
      <span class="flow-map-label">缩略图 · 可拖动</span>
    </div>`;
  }

  /* rebuild=true 时连卡片小块一起重画（拖完卡片/重新量高之后要调） */
  function paintMinimap(rebuild = false) {
    const body = document.getElementById?.('flowMapBody');
    if (!body) return;
    if (rebuild) body.innerHTML = mapBodyHtml();
    const view = document.getElementById?.('flowMapView');
    const rect = canvasRect();
    if (!view?.style || !rect) return;
    const { box, ms, spanX, spanY } = mapGeometry();
    const k = viewport.k || 1;
    /* 一屏就装得下的时候不占地方（Figma 的缩略图也是缩下去才出现） */
    const box0 = document.querySelector?.('.flow-map');
    if (box0?.classList?.toggle) box0.classList.toggle('is-off', spanX * k <= rect.width - 8 && spanY * k <= rect.height - 8);
    view.style.left = `${Math.round((-viewport.x / k - box.minX) * ms)}px`;
    view.style.top = `${Math.round((-viewport.y / k - box.minY) * ms)}px`;
    view.style.width = `${Math.max(6, Math.round((rect.width / k) * ms))}px`;
    view.style.height = `${Math.max(6, Math.round((rect.height / k) * ms))}px`;
  }

  /* 把缩略图上点到的那个点，搬到画布正中央 */
  function mapJump(event, map) {
    const body = map?.querySelector?.('.flow-map-body') || document.getElementById?.('flowMapBody');
    const rect = body?.getBoundingClientRect?.();
    const frame = canvasRect();
    if (!rect?.width || !frame) return;
    const { box, ms } = mapGeometry();
    const k = viewport.k || 1;
    viewport.x = Math.round(frame.width / 2 - (box.minX + (event.clientX - rect.left) / ms) * k);
    viewport.y = Math.round(frame.height / 2 - (box.minY + (event.clientY - rect.top) / ms) * k);
    paintViewport();
  }

  function canvasHtml(canWrite) {
    const list = cards();
    return `<div class="flow-canvas" id="flowCanvas">
      <p class="flow-canvas-hint">拖空白处平移 · 滚轮缩放 · 按住卡片顶部拖动位置 · 从卡片右侧 <b>◦</b> 拖到另一张卡片 = 建立引用 · 拖左边资料源到卡片 = 引用资料 · 右下角缩略图可直接跳过去</p>
      <div class="flow-canvas-inner" id="flowCanvasInner" style="transform: translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})">
        ${edgesSvg()}
        ${sourcePillsHtml(canWrite)}
        ${list.map((card) => nodeHtml(card, canWrite)).join('')}
      </div>
      <div class="flow-dock" role="toolbar" aria-label="画布工具">
        <div class="flow-dock-tabs" role="group" aria-label="指针模式">
          <button type="button" class="flow-dock-tab${panMode() ? '' : ' is-active'}" data-flow-pan-mode="select" aria-pressed="${panMode() ? 'false' : 'true'}" title="选中模式：拖卡片、拉连线（按住 Space 临时切抓手）">选中</button>
          <button type="button" class="flow-dock-tab${panMode() ? ' is-active' : ''}" data-flow-pan-mode="pan" aria-pressed="${panMode() ? 'true' : 'false'}" title="拖动模式：在画布上按住即平移（Space）">拖动</button>
        </div>
        <span class="flow-dock-sep" aria-hidden="true"></span>
        <button type="button" class="flow-dock-btn" data-flow-view-zoom="out" title="缩小">－</button>
        <button type="button" class="flow-dock-btn flow-zoom" id="flowZoom" data-flow-zoom-reset title="点击回到 100%">${Math.round(viewport.k * 100)}%</button>
        <button type="button" class="flow-dock-btn" data-flow-view-zoom="in" title="放大">＋</button>
        <button type="button" class="flow-dock-btn" data-flow-view-fit title="适应屏幕：把全部卡片收进视野">适应屏幕</button>
        <span class="flow-dock-sep" aria-hidden="true"></span>
        <button type="button" class="flow-dock-btn${edgesHidden ? ' is-off' : ''}" data-flow-edges-toggle aria-pressed="${edgesHidden ? 'false' : 'true'}" title="隐藏 / 显示引用连线">${edgesHidden ? '显示连线' : '隐藏连线'}</button>
        <button type="button" class="flow-dock-btn" data-flow-layout data-write title="按引用层级重排：上游在左、下游在右">自动排布</button>
        <span class="flow-dock-sep" aria-hidden="true"></span>
        <button type="button" class="flow-dock-btn" data-flow-undo data-write title="撤销（Ctrl / ⌘ + Z）" ${canWrite && history.past.length ? '' : 'disabled'}>撤销</button>
        <button type="button" class="flow-dock-btn" data-flow-redo data-write title="重做（Ctrl / ⌘ + Y）" ${canWrite && history.future.length ? '' : 'disabled'}>重做</button>
        <span class="flow-dock-sep" aria-hidden="true"></span>
        <button type="button" class="flow-dock-btn" data-flow-search title="搜索画布（Ctrl / ⌘ + K）：按名字找到卡片并跳过去">搜索 ⌘K</button>
        <span class="flow-dock-sep" aria-hidden="true"></span>
        <button type="button" class="flow-dock-btn${immersiveOn() ? ' is-off' : ''}" data-flow-immersive aria-pressed="${immersiveOn() ? 'true' : 'false'}" title="${immersiveOn() ? '退出放大：把页面顶部的导航与说明还回来（Esc）' : '放大画布：收起页面顶部的导航与说明，画布铺满窗口（Esc 退出）'}">${immersiveOn() ? '退出放大' : '放大画布'}</button>
      </div>
      ${minimapHtml()}
      ${list.length ? '' : `<div class="flow-canvas-empty">${emptyHtml()}</div>`}
    </div>`;
  }

  function modalHtml(canWrite) {
    const card = focusId ? find(focusId) : null;
    if (!card) return '';
    const materialKey = materialKeyOf(card.skill);
    const skills = skillList();
    const custom = card.skill && !skills.some((item) => item.id === card.skill);
    return `<div class="flow-modal" data-flow-modal>
      <div class="flow-modal-mask" data-flow-close></div>
      <div class="flow-modal-box" role="dialog" aria-modal="true" aria-label="卡片配置">
        <div class="flow-modal-head">
          <span class="flow-node-grip" aria-hidden="true">⠿</span>
          <input class="flow-title" data-flow-title="${card.id}" data-write value="${escapeHtml(card.title)}" maxlength="40" placeholder="卡片名（也是这次生成的任务）" ${canWrite ? '' : 'disabled'} />
          ${statusChip(card)}
          <button type="button" class="button button-ghost small" data-flow-close title="关闭（Esc）">✕</button>
        </div>
        <div class="flow-modal-body">
          <label class="flow-field"><span>技能包</span>${skillSelect(card, canWrite)}</label>
          <div class="flow-field"><span>引用资料<small class="flow-hint">${card.refs.length ? `已引用 ${card.refs.length} 项` : '一项都没选：AI 只会按再要求写'}（也可以把左边的资料拖到卡片上）</small></span>${refChips(card, canWrite)}</div>
          <div class="flow-field"><span>引用卡片<small class="flow-hint">上游 agent 的输出会一起交给这张卡片；画布上可以直接连线</small></span>${fromChips(card, canWrite)}</div>
          <label class="flow-field"><span>再要求<small class="flow-hint">语气、篇幅、必须写到的点、事实边界</small></span>
            <textarea class="flow-instruction" data-flow-instruction="${card.id}" data-write rows="3" placeholder="选填：例如「写给大一新生看的，语气轻松，300 字以内」" ${canWrite ? '' : 'disabled'}>${escapeHtml(card.instruction)}</textarea>
          </label>
          ${custom ? `<p class="flow-hint">技能包「${escapeHtml(card.skill)}」不在当前注册表里，运行时会退化成自由写作。</p>` : ''}
          ${outputBlock(card, canWrite)}
        </div>
        <div class="flow-modal-foot">
          <button type="button" class="button button-primary" data-flow-run="${card.id}" data-write ${canWrite ? '' : 'disabled'}>▶ 运行这张卡片</button>
          <button type="button" class="button button-ghost" data-flow-card-word="${card.id}" data-flow-export="word" ${card.output ? '' : 'disabled'} title="${card.output ? '导出这张卡片的正文（真 .docx）' : '先运行出正文再导出'}">导出 Word</button>
          <button type="button" class="button button-ghost" data-flow-dup="${card.id}" data-write ${canWrite ? '' : 'disabled'}>复制</button>
          ${materialKey ? `<button type="button" class="button button-ghost" data-goto-view="material" data-goto-open="${materialKey}">打开该材料（深度编辑）</button>` : ''}
          <button type="button" class="button button-ghost danger" data-flow-del="${card.id}" data-write ${canWrite ? '' : 'disabled'}>删除</button>
        </div>
      </div>
    </div>`;
  }
  /* ── 导出 Word：复用 core/ooxml.js（与「过程材料」页同一条 docx 链路）── */

  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* 卡片正文 → Word 结构块；没有正文时写明「还没运行」，不假装有成稿 */
  function cardDocxBytes(card) {
    const text = U.text(card?.output?.text) || '';
    return window.WB.ooxml.docx({
      title: card?.output?.title || card?.title || '未命名卡片',
      blocks: text ? window.WB.markdown.parseBlocks(text) : [{ type: 'paragraph', lines: ['（还没运行）'] }]
    });
  }

  /* 整条工作流按「引用层级」排序（上游在前，同层按画布上下）导出，读起来就是一条推进线 */
  function orderedCards() {
    const depths = depthOfCards();
    return cards().slice().sort((a, b) => {
      const da = depths.get(a.id) || 0;
      const db = depths.get(b.id) || 0;
      if (da !== db) return da - db;
      return (a.y || 0) - (b.y || 0);
    });
  }

  function workflowDocxBytes() {
    const blocks = [];
    orderedCards().forEach((card, index) => {
      if (index) blocks.push({ type: 'hr' });
      blocks.push({ type: 'heading', level: 1, text: card.title || '未命名卡片' });
      const text = U.text(card.output?.text) || '';
      if (text) blocks.push(...window.WB.markdown.parseBlocks(text));
      else blocks.push({ type: 'paragraph', lines: ['（还没运行）'] });
    });
    return window.WB.ooxml.docx({ title: `${store().projectName()}｜卡片工作流`, blocks });
  }

  function exportCardWord(id) {
    const card = find(id);
    if (!card?.output?.text) { window.WB.toast('这张卡片还没有正文'); return; }
    const name = `${U.safeFileName(store().projectName())}-${U.safeFileName(card.title || '卡片')}`;
    U.downloadBytes(`${name}.docx`, cardDocxBytes(card), DOCX_MIME);
  }

  function exportWord() {
    if (!cards().length) { window.WB.toast('还没有卡片'); return; }
    U.downloadBytes(`${U.safeFileName(store().projectName())}-卡片工作流.docx`, workflowDocxBytes(), DOCX_MIME);
    window.WB.toast('已导出 Word：上游在前、下游在后');
  }

  /* 技能包 → 过程材料页里的那一份（用于「打开该材料」分层衔接）；没有对应材料就不给按钮 */
  function materialKeyOf(skill) {
    if (!skill) return '';
    const key = U.OUTPUT_ITEMS.find((item) => item.skill === skill)?.key;
    return key && state().materials?.[key] ? key : '';
  }

  /* ── 模式与弹窗 ───────────────────────────────────── */

  /* 配置弹窗挂到 body 上，不放面板里：面板带 transform（入场动画残留），
     会成为 position:fixed 的包含块 —— 遮罩盖不住顶栏、居中也会偏。 */
  const MODAL_HOST_ID = 'flowModalHost';
  function modalHost() {
    let host = document.getElementById?.(MODAL_HOST_ID) || null;
    if (!host && document.body?.appendChild) {
      host = document.createElement('div');
      host.id = MODAL_HOST_ID;
      document.body.appendChild(host);
    }
    return host;
  }

  function setMode(next) {
    if (next !== 'canvas' && next !== 'list') return;
    if (next === 'list' && immersiveOn()) setImmersive(false, true);   /* 「放大画布」是画布模式的玩法：切到列表就把开关也关掉，别把页面导航一直藏着 */
    if (mode === next) return;
    mode = next;
    if (mode === 'canvas') viewportFitted = false;
    render();
  }

  /* 放大画布的写口：改本机存档 + 重画。quiet = 只记账不重画（切模式时用，那次重画交给 setMode） */
  function setImmersive(on, quiet = false) {
    const want = Boolean(on);
    const current = state();
    if (current) {
      current.ui = { ...(current.ui || {}), flowImmersive: want };
      store().save();
    }
    if (quiet) return want;
    render();
    /* 换了个「窗口」，顺手把内容重新框进视野，免得卡片留在旧视野外 */
    viewportFitted = true;
    fitView();
    return want;
  }

  function toggleImmersive() { return setImmersive(!immersiveOn()); }

  function openCard(id) {
    focusId = find(id) ? id : null;
    render();
  }

  function closeCard() {
    if (!focusId) return;
    focusId = null;
    render();
  }

  /* 程序化摆放一张卡片（画布坐标）：拖拽与自测走同一条写入路径 */
  function placeCard(id, x, y) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改卡片坐标'); return false; }
    const card = find(id);
    if (!card || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return false;
    card.x = Number(x);
    card.y = Number(y);
    store().save();
    return true;
  }

  /* ── 拖动 / 平移 / 连线（pointer 事件，一条通道管三种手势）── */

  const nodeElement = (id) => document.querySelector?.(`[data-flow-card="${id}"]`) || null;

  function moveNode(card) {
    const el = nodeElement(card.id);
    if (!el?.style) return;
    el.style.left = `${Math.round(card.x)}px`;
    el.style.top = `${Math.round(card.y)}px`;
  }

  function startDrag(event, id) {
    const card = find(id);
    if (!card) return;
    if (!hasPos(card)) seedLayout();
    const point = canvasPoint(event);
    drag = { id, dx: point.x - card.x, dy: point.y - card.y, moved: false, before: snapshotCards() };
    nodeElement(id)?.classList?.add('is-dragging');
    event.preventDefault?.();
  }

  function startPan(event) {
    pan = { cx: event.clientX, cy: event.clientY, x: viewport.x, y: viewport.y };
    canvasNode()?.classList?.add('is-panning');
    /* 这里**不能** preventDefault：画布内的按钮（运行 / 打开 / 删除 / 连线）都要靠 click 触发。
       禁选由 .flow-canvas 的 user-select: none + 手势期间的 body.is-gesturing 负责。 */
  }

  function startLink(event, id, key) {
    linking = { id, key: key || '' };
    nodeElement(id)?.classList?.add('is-linking');
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  function linkAnchor() {
    if (!linking) return null;
    if (linking.key) {
      const index = SOURCE_INDEX.get(linking.key);
      if (index === undefined) return null;
      return { x: PILL_X + PILL_W, y: paletteY(index) + PILL_H / 2 };
    }
    const card = find(linking.id);
    if (!card || !hasPos(card)) return null;
    return { x: card.x + NODE_W, y: card.y + (nodeHeights.get(card.id) || NODE_H) / 2 };
  }

  function paintLink(event) {
    const anchor = linkAnchor();
    if (!anchor) return;
    const point = canvasPoint(event);
    paintEdges({ x1: anchor.x, y1: anchor.y, x2: point.x, y2: point.y });
  }

  /* 指针捕获之后 event.target 是捕获元素，拿不到「松手落在哪张卡片上」，
     所以要按坐标重新问一次命中元素 */
  function dropCardId(event) {
    const el = document.elementFromPoint?.(event.clientX, event.clientY);
    return el?.closest?.('[data-flow-card]')?.dataset?.flowCard || '';
  }

  function endLink(event) {
    const { id, key } = linking;
    linking = null;
    nodeElement(id)?.classList?.remove('is-linking');
    const target = dropCardId(event);
    paintEdges();
    if (!target || target === id) return;
    if (key) setRef(target, key, true);
    else addFrom(target, id);
  }

  function onCanvasDown(event) {
    const target = event.target;
    const panel = event.currentTarget;
    /* 只在真的开始一个手势时才捕获指针：随手点一下不该把事件从输入框手里抢走 */
    const grab = () => { beginGesture(); armCapture(panel, event); };
    /* 工具坞里的按钮走 click：指针捕获会把 click 从按钮手里抢走 */
    if (target?.closest?.('.flow-dock')) return;
    /* 缩略图只改视角，不动数据：只读身份也能用 */
    const map = target?.closest?.('[data-flow-map]');
    if (map) { grab(); mapDrag = map; mapJump(event, map); return; }
    /* 卡片头上的小按钮（收起 / 展开）不参与拖拽 */
    if (target?.closest?.('[data-flow-collapse]')) return;
    /* 拖动模式（工具坞切的，或按住 Space）：整块画布都是抓手 */
    if (panMode()) { if (target?.closest?.('.flow-canvas')) { grab(); startPan(event); } return; }
    const link = target?.closest?.('[data-flow-link]');
    if (link && U.canOperate()) { grab(); startLink(event, link.dataset.flowLink, ''); return; }
    const pill = target?.closest?.('[data-flow-pill]');
    if (pill && U.canOperate()) { grab(); startLink(event, '', pill.dataset.flowPill); return; }
    const handle = target?.closest?.('[data-flow-drag]');
    if (handle && U.canOperate()) { grab(); startDrag(event, handle.dataset.flowDrag); return; }
    /* 按钮与连线命中层：只当点击，不当平移的起点（否则按住按钮拖一下会顺手把画布挪走） */
    if (target?.closest?.('button, a, input, textarea, select, [data-flow-edge]')) return;
    if (target?.closest?.('.flow-canvas')) { grab(); startPan(event); }
  }

  function onCanvasMove(event) {
    takeCapture(event);
    if (mapDrag) { mapJump(event, mapDrag); return; }
    if (drag) {
      const card = find(drag.id);
      if (!card) { drag = null; return; }
      const point = canvasPoint(event);
      /* 对齐到 8px：卡片更容易对齐，也让坐标数字好看一点 */
      const nextX = Math.round((point.x - drag.dx) / 8) * 8;
      const nextY = Math.round((point.y - drag.dy) / 8) * 8;
      if (Math.abs(nextX - card.x) >= 4 || Math.abs(nextY - card.y) >= 4) drag.moved = true;
      card.x = nextX;
      card.y = nextY;
      moveNode(card);
      paintEdges();
      paintMinimap(true);
      return;
    }
    if (pan) {
      viewport.x = pan.x + (event.clientX - pan.cx);
      viewport.y = pan.y + (event.clientY - pan.cy);
      paintViewport();
      return;
    }
    if (linking) paintLink(event);
  }

  function onCanvasUp(event) {
    pendingCapture = null;
    if (mapDrag) { mapDrag = null; return; }
    if (drag) {
      const { moved, before } = drag;
      drag = null;
      for (const node of document.querySelectorAll?.('.flow-node') || []) {
        if (node.classList?.contains('is-dragging')) node.classList.remove('is-dragging');
      }
      if (moved) {
        pushHistory('移动卡片', before);
        store().log('workflow', '在画布上调整了卡片位置');
        store().save();
        suppressClick = Date.now() + 300;
      }
      paintEdges();
      return;
    }
    if (pan) {
      pan = null;
      canvasNode()?.classList?.remove('is-panning');
      return;
    }
    if (linking) endLink(event);
  }

  /* ── 画布相关的点击（与列表模式的点击分支互不重叠）── */

  function onCanvasClick(event) {
    const hit = (attr) => event.target?.closest?.(`[${attr}]`);
    if (hit('data-flow-map')) return;   /* 缩略图上只跳视图，不当成「点空白关弹窗」 */
    const pick = hit('data-flow-palette-open');
    if (pick) { paletteJump(pick.dataset.flowPaletteOpen); return; }
    if (hit('data-flow-palette-close')) { closePalette(); return; }
    const pointer = hit('data-flow-pan-mode');
    if (pointer) { setPanMode(pointer.dataset.flowPanMode === 'pan'); return; }
    const fold = hit('data-flow-collapse');
    if (fold) { toggleCollapse(fold.dataset.flowCollapse); return; }
    if (hit('data-flow-zoom-reset')) { resetZoom(); return; }
    if (hit('data-flow-edges-toggle')) { toggleEdges(); return; }
    if (hit('data-flow-undo')) { undo(); return; }
    if (hit('data-flow-redo')) { redo(); return; }
    if (hit('data-flow-search')) { openPalette(); return; }
    if (hit('data-flow-immersive')) { toggleImmersive(); return; }
    const open = hit('data-flow-open');
    if (open) {
      /* 卡片上的按钮各管各的（运行 / 删除 / 看材料），点其余位置才弹配置窗；
         但「打开」这个按钮自己就带 data-flow-open，它就是要开配置窗的 */
      const control = event.target?.closest?.('button, input, textarea, select');
      if (control && control !== open && !control.dataset?.flowOpen) return;
      if (Date.now() > suppressClick) openCard(open.dataset.flowOpen);
      return;
    }
    const close = hit('data-flow-close');
    if (close) { closeCard(); return; }
    const view = hit('data-flow-view');
    if (view) { setMode(view.dataset.flowView); return; }
    const zoom = hit('data-flow-view-zoom');
    if (zoom) { zoomAt(zoom.dataset.flowViewZoom === 'out' ? 1 / 1.15 : 1.15, null); return; }
    if (hit('data-flow-view-fit')) { viewportFitted = true; fitView(); return; }
    if (hit('data-flow-layout')) { autoLayout(); return; }
    const word = hit('data-flow-card-word');
    if (word) { exportCardWord(word.dataset.flowCardWord); return; }
    const edge = hit('data-flow-edge');
    if (edge) {
      const [kind, cardId, ref] = String(edge.dataset.flowEdge || '').split(':');
      if (!cardId || !ref) return;
      if (kind === 'from') {
        const up = find(ref);
        if (U.canOperate() && confirm(`断开《${up?.title || '卡片'}》→《${find(cardId)?.title || '卡片'}》这条引用？`)) removeFrom(cardId, ref);
        return;
      }
      setRef(cardId, ref, false);
      return;
    }
    if (event.target?.closest?.('.flow-canvas') && focusId) closeCard();
  }
  /* 手势期间给 body 挂一个标记：整页禁选，指针拖到画布外面也不会拉出一片蓝色选区。
     结束的路径有三条（pointerup / pointercancel / 窗口失焦），任何一条都能摘掉标记。 */
  /* ── 指针捕获要「推迟到真的开始拖」才做 ───────────────────────────────
     setPointerCapture 会把随后的 mouse 事件（含 click）一起重定向到捕获元素，
     于是卡片上的按钮、卡片正文、连线命中层都收不到 click —— 表现就是「按了没反应」。
     所以按下时只记一笔，等指针移动超过 4px 再捕获：点一下 = 正常 click，拖起来 = 照常捕获。 */
  function armCapture(panel, event) {
    pendingCapture = { panel, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function takeCapture(event) {
    if (!pendingCapture) return;
    const { panel, pointerId, x, y } = pendingCapture;
    if (!event || Math.abs(event.clientX - x) + Math.abs(event.clientY - y) < 4) return;
    pendingCapture = null;
    try { panel?.setPointerCapture?.(pointerId); } catch { /* 没有指针捕获也能用，只是手指移出画布会断 */ }
  }

  const markGesturing = (on) => document.body?.classList?.[on ? 'add' : 'remove']?.('is-gesturing');
  const beginGesture = () => markGesturing(true);
  /* 只摘标记：手势状态的收尾必须留给 onCanvasUp / onCanvasMove，
     否则读不到 drag / pan / linking，拖动就落不了盘、连线也接不上。 */
  const endGestureMark = () => markGesturing(false);
  function resetGestureState() {
    pendingCapture = null;
    drag = null;
    pan = null;
    linking = null;
    mapDrag = null;
    canvasNode()?.classList?.remove?.('is-panning');
  }

  /* ── 画布事件绑定 ─────────────────────────────────── */

  function bindCanvas(panel) {
    panel.addEventListener('click', onCanvasClick);
    panel.addEventListener('pointerdown', onCanvasDown);
    panel.addEventListener('pointermove', onCanvasMove);
    panel.addEventListener('pointerup', onCanvasUp);
    panel.addEventListener('pointercancel', () => { resetGestureState(); endGestureMark(); });
    /* 指针捕获失效（拖到窗口外再松手）时兜底摘掉禁选标记；手势状态交给 onCanvasUp */
    document.addEventListener('pointerup', endGestureMark, true);
    window.addEventListener?.('blur', () => { resetGestureState(); endGestureMark(); });
    /* 滚轮缩放：只在画布上生效，别把整页的滚动抢掉 */
    panel.addEventListener('wheel', (event) => {
      if (mode !== 'canvas' || !event.target?.closest?.('.flow-canvas')) return;
      event.preventDefault?.();
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event);
    }, { passive: false });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (palette) { closePalette(); return; }
      if (focusId) { closeCard(); return; }
      if (immersiveOn() && !panel.classList.contains('hidden')) toggleImmersive();
    });
  }

  window.WB.views.workflow = {
    id: 'workflow',
    label: '卡片工作流',
    render,
    mount,
    runCard,
    runAll,
    get busy() { return running.size > 0 || batchRunning; },
    executionOrder,
    addStarter,
    writeMaterial,
    addCard,
    addFromOutputs,
    deleteCard,
    duplicateCard,
    moveCard,
    toggleRef,
    toggleFrom,
    cardMarkdown,
    exportMarkdown,
    exportJson,
    skillLabel,
    skillList,
    /* ── 二维画布 ── */
    setMode,
    modeOf: () => mode,
    openCard,
    closeCard,
    focusedId: () => focusId,
    viewportOf: () => ({ ...viewport }),
    linkingOf: () => (linking ? { ...linking } : null),
    draggingOf: () => (drag ? { ...drag } : null),
    placeCard,
    autoLayout,
    autoPositions,
    depthOfCards,
    seedLayout,
    addFrom,
    removeFrom,
    setRef,
    reaches,
    edgesOf,
    edgesSvg,
    canvasHtml,
    minimapHtml,
    mapBodyHtml,
    mapGeometry,
    paintMinimap,
    nodeHtml,
    modalHtml,
    fitView,
    zoomAt,
    resetZoom,
    /* ── 工具坞 / 撤销重做 / 搜索画布 / 收起 ── */
    undo,
    redo,
    historyOf: () => ({ past: history.past.length, future: history.future.length, next: history.past[history.past.length - 1]?.label || '' }),
    toggleEdges,
    edgesHidden: () => edgesHidden,
    toggleCollapse,
    setPanMode,
    panModeOf: () => panMode(),
    toggleImmersive,
    setImmersive,
    immersiveOf: immersiveOn,
    centerOn,
    openPalette,
    closePalette,
    paletteHtml,
    paletteResults,
    paletteOf: () => (palette ? { ...palette } : null),
    paletteQuery: (q) => { if (!palette) return -1; palette.query = String(q ?? ''); palette.index = 0; return paletteResults().length; },
    paletteJump,
    movePalette,
    cardHtml,
    outputBlock,
    materialKeyOf,
    orderedCards,
    cardDocxBytes,
    workflowDocxBytes,
    exportCardWord,
    exportWord
  };
}());
