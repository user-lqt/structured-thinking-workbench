#!/usr/bin/env node
/* 离线自测：不依赖浏览器、不依赖 API Key，校验数据契约、派生计算、导出产物与项目包往返。
 * 用法：node workbench/demo2/tools/selftest.mjs
 * 退出码 0 = 全部通过，1 = 存在失败项。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/* ── 最小浏览器环境（视图模块只在函数内部用 DOM，加载期只读取 window.WB.util） ── */
const noop = () => {};
const stubElement = () => ({
  style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  children: [], innerHTML: '', textContent: '', value: '', disabled: false,
  addEventListener: noop, appendChild: noop, removeChild: noop, setAttribute: noop, remove: noop,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null, click: noop, focus: noop
});
const stored = new Map();
globalThis.window = globalThis;
/* 比 stubElement 更完整的假节点：render() 会给元素赋 innerHTML / classList，
   这里让每个 id 都有稳定的元素对象，从而能真正跑一遍所有视图的 render。 */
function makeElement(id = '') {
  const classes = new Set();
  const events = {};
  return {
    id, innerHTML: '', textContent: '', value: '', checked: false, disabled: false, title: '',
    dataset: {}, style: {}, isConnected: true,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    },
    addEventListener: (type, fn) => { (events[type] = events[type] || []).push(fn); },
    emit: (type, event) => { for (const fn of events[type] || []) fn(event); },
    removeEventListener: noop, appendChild: noop, removeChild: noop,
    setAttribute: noop, removeAttribute: noop, getAttribute: () => null, getAttributeNames: () => [],
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    click: noop, focus: noop, remove: noop, scrollIntoView: noop, replaceChildren: noop,
    insertAdjacentHTML: noop, cloneNode: () => makeElement(id), contains: () => false
  };
}

const elementById = new Map();
const elementFor = (id) => {
  if (!elementById.has(id)) elementById.set(id, makeElement(id));
  return elementById.get(id);
};

globalThis.document = {
  querySelector: (selector) => (typeof selector === 'string' && selector.startsWith('#') ? elementFor(selector.slice(1)) : null),
  querySelectorAll: () => [],
  getElementById: (id) => elementFor(id),
  createElement: () => makeElement(),
  createTextNode: () => makeElement(),
  addEventListener: noop,
  head: makeElement('head'), body: makeElement('body'), documentElement: makeElement('html')
};
globalThis.localStorage = {
  getItem: (key) => (stored.has(key) ? stored.get(key) : null),
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key)
};
globalThis.confirm = () => true;
globalThis.prompt = () => '';

const MODULES = [
  'schemas.js', 'materials.js',
  'core/util.js', 'core/store.js', 'core/risk.js', 'core/wbs.js', 'core/drills.js', 'core/ai.js', 'core/export.js',
  'views/projects.js', 'views/overview.js', 'views/manifest.js', 'views/tasks.js', 'views/decision.js',
  'views/risk.js', 'views/resources.js', 'views/drills.js', 'views/material.js', 'views/assets.js', 'views/help.js',
  'app.js'
];

const failures = [];
let checks = 0;
function check(label, condition, detail = '') {
  checks += 1;
  if (condition) return true;
  failures.push(`${label}${detail ? ` → ${detail}` : ''}`);
  return false;
}

/* ── 1. 模块加载 ────────────────────────── */
for (const file of MODULES) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  try {
    new Function(source)();
  } catch (error) {
    check(`加载 ${file}`, false, String(error && error.message));
  }
}
check('window.WB 已建立', typeof window.WB === 'object');
check('window.SKILLS 已建立', typeof window.SKILLS === 'object');

const U = window.WB.util;
const store = window.WB.store;

/* ── 2. 结构契约 ────────────────────────── */
const MANIFEST = window.SKILLS.manifest;
const WBS = window.SKILLS.wbs;
const RISK = window.SKILLS.risk;
const GATES = window.SKILLS.gates;
const DECISION = window.SKILLS.decision;

check('项目信息表-基本信息字段数 = 16', U.BASIC_FIELDS.length === 16, `实际 ${U.BASIC_FIELDS.length}`);
check('项目信息表-必填字段存在', U.BASIC_FIELDS.filter((f) => f.required).length >= 3);
check('产出清单项数 = 21', U.OUTPUT_ITEMS.length === 21, `实际 ${U.OUTPUT_ITEMS.length}`);
check('任务分解列数 = 11', WBS.columns.length === 11, `实际 ${WBS.columns.length}`);
check('阶段数为 4', WBS.phases.length === 4);
check('任务状态覆盖 todo/doing/blocked/done',
  ['todo', 'doing', 'blocked', 'done'].every((s) => WBS.statuses.some((item) => item.value === s)));
check('四个阶段都有门禁检查点',
  WBS.phases.every((phase) => (GATES[phase.value] || []).length >= 5));
check('方案比选量表为 1–5', DECISION.scale.map((s) => s.value).join(',') === '1,2,3,4,5');
check('方案比选预设维度 = 6', DECISION.presetCriteria.length === 6);
check('风险类别 ≥ 8', RISK.categories.length >= 8, `实际 ${RISK.categories.length}`);
check('风险等级为高中低三档', RISK.levels.length === 3);
check('风险分级阈值 15–25 高', RISK.levels.find((l) => l.value === 'high')?.min === 15);

/* ── 3. 技能包与产出的对应关系 ─────────────── */
const registry = JSON.parse(fs.readFileSync(path.join(root, 'skills/registry.json'), 'utf8'));
const registryIds = new Set(registry.skills.map((skill) => skill.id));
const missingSkillFiles = registry.skills.filter((skill) => !fs.existsSync(path.join(root, 'skills', skill.id, 'SKILL.md')));
check('registry 中每个技能都有 SKILL.md', missingSkillFiles.length === 0, missingSkillFiles.map((s) => s.id).join(', '));

const materials = window.SKILLS.materials;
const outputsWithoutSkill = U.OUTPUT_ITEMS.filter((item) => !registryIds.has(item.skill));
check('每个产出都注册了技能包', outputsWithoutSkill.length === 0, outputsWithoutSkill.map((i) => `${i.key}:${i.skill}`).join(', '));
const outputsWithoutSections = U.OUTPUT_ITEMS
  .filter((item) => item.kind !== 'structure')
  .filter((item) => !(materials[item.skill]?.sections || []).length);
check('每种文档/表格/图形产出都有默认章节定义', outputsWithoutSections.length === 0, outputsWithoutSections.map((i) => i.skill).join(', '));
const structItems = U.OUTPUT_ITEMS.filter((item) => item.kind === 'structure');
check('structure 类产出有对应视图承接', structItems.every((item) => item.skill === 'decision-matrix'));
const outputsWithoutPhase = U.OUTPUT_ITEMS.filter((item) => !U.PHASE_ORDER[item.phase] && U.PHASE_ORDER[item.phase] !== 0);
check('每个产出都归属到一个阶段', outputsWithoutPhase.length === 0, outputsWithoutPhase.map((i) => i.key).join(', '));

/* ── 3b. 身份、资源台账与演练场景库 ─────────── */
check('角色为组织者/成员/访客三档',
  U.ROLES.map((role) => role.value).join(',') === 'organizer,member,viewer');
check('每个角色都有中文标签', U.ROLES.every((role) => U.ROLE_LABEL[role.value]));
check('资源类型 = 6', U.RESOURCE_KINDS.length === 6, `实际 ${U.RESOURCE_KINDS.length}`);
check('每种资源都有中文名与默认单位',
  U.RESOURCE_KINDS.every((kind) => U.RESOURCE_KIND[kind.value] && U.RESOURCE_UNIT[kind.value]));
check('资源台账技能包已注册', registryIds.has('resource-plan'));
check('变更演练技能包已注册', registryIds.has('change-drill'));

const SCENARIOS = window.WB.drills.SCENARIOS;
const drillCoverage = window.WB.drills.coverage();
check('演练场景库 ≥ 10 个', SCENARIOS.length >= 10, `实际 ${SCENARIOS.length}`);
check('每个风险类别都有演练场景', drillCoverage.ok, `缺少 ${drillCoverage.missing.join(', ')}`);
check('每个场景都有触发信号、影响、≥4 步处置、回退条件与升级路径',
  SCENARIOS.every((s) => s.trigger && s.impact && s.steps.length >= 4 && s.rollback && s.escalateTo.length));
check('场景的类别与阶段取值合法',
  SCENARIOS.every((s) => RISK.categories.some((c) => c.value === s.category) && U.PHASE_ORDER[s.phase] != null));
check('场景 id 唯一且可反查',
  new Set(SCENARIOS.map((s) => s.id)).size === SCENARIOS.length
  && SCENARIOS.every((s) => window.WB.drills.byId(s.id)?.id === s.id));

const res = store.normaliseResource({ name: '  志愿者 ', kind: '不存在的类型', available: -3, assigned: '2', unit: '' });
check('资源归一化：非法类型回落到人员', res.kind === 'staff', res.kind);
check('资源归一化：负数可用量归零', res.available === 0, String(res.available));
check('资源归一化：名称去空格且给出默认单位', res.name === '志愿者' && res.unit === '个', `${res.name}/${res.unit}`);
const RCheck = window.WB.views.resources.check;
check('资源检查：已安排超出可用 → 缺口', RCheck({ available: 0, assigned: 2, unit: '台' }).level === 'over');
check('资源检查：恰好排满 → 提醒', RCheck({ available: 2, assigned: 2, unit: '台' }).level === 'full');
check('资源检查：仍有余量 → 正常', RCheck({ available: 3, assigned: 1, unit: '台' }).level === 'ok');

const drill = store.normaliseDrill({ id: 'd1', title: 'T', steps: [{ text: '第一步' }], rollback: '条件', followUp: ['改进项'], status: 'done' });
check('演练归一化保留步骤文本与 id', drill.steps[0]?.text === '第一步' && Boolean(drill.steps[0]?.id), JSON.stringify(drill.steps));
check('演练归一化保留回退条件与改进项', drill.rollback === '条件' && drill.followUp.length === 1);

/* ── 4. 示例项目迁移 ────────────────────── */
const samplePath = path.join(root, 'samples/示例项目-校园科技文化节.json');
const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
store.importBundle(sample);
const state = store.state;

check('示例项目已建立', Boolean(state.project));
check('示例项目任务 ≥ 20 项', state.wbs.length >= 20, `实际 ${state.wbs.length}`);
check('示例项目覆盖四个阶段',
  WBS.phases.every((phase) => state.wbs.some((row) => row.phase === phase.value)));
check('示例项目风险 ≥ 15 项', state.risks.length >= 15, `实际 ${state.risks.length}`);
check('示例项目比选方案 = 3', state.options.selected.length === 3);
check('示例项目素材已载入', state.assets.length >= 3, `实际 ${state.assets.length}`);
check('示例项目资源台账已载入', state.resources.length >= 8, `实际 ${state.resources.length}`);
check('示例项目演练记录已载入', state.drills.length >= 2, `实际 ${state.drills.length}`);
check('示例项目自带占用冲突用于演示',
  state.resources.some((item) => Number(item.assigned) > Number(item.available)));
check('示例演练记录保留处置步骤',
  state.drills.every((item) => item.steps.length >= 4 && item.steps.every((step) => step.text)));
check('海报配置已随项目还原', Boolean(state.poster && state.poster.title), JSON.stringify(state.poster));
check('每条风险都有四要素（触发/预防/响应/升级）',
  state.risks.every((risk) => risk.trigger && risk.prevention && risk.response && risk.escalation));

/* ── 5. 派生计算 ────────────────────────── */
const overall = window.WB.wbs.overall(state.wbs);
check('任务完成度在 0–100 之间', overall.percent >= 0 && overall.percent <= 100, `实际 ${overall.percent}`);
const gateStats = window.WB.wbs.gateStats(state.gates);
check('门禁统计覆盖四个阶段', Object.keys(gateStats).length === 4);
const layout = window.WB.wbs.gantt(state.wbs, state.project.basic.date);
check('甘特图可绘制', layout.bars.length > 0 && layout.days > 1, `bars=${layout.bars.length} days=${layout.days}`);
check('甘特图包含活动日基准线', new Date(`${state.project.basic.date}T00:00:00`) >= layout.start);

const coverage = window.WB.risk.coverage(state.risks, state.wbs);
check('示例项目风险覆盖度自检通过', coverage.ok, JSON.stringify(coverage.issues || []));
check('风险分值落在高/中/低三档',
  state.risks.every((risk) => ['high', 'medium', 'low'].includes(window.WB.risk.levelOfRisk(risk))));

/* ── 6. 导出产物 ────────────────────────── */
const X = window.WB.exporters;
const cases = [
  ['项目信息表 Markdown', X.manifestToMarkdown(), ['#', '产出']],
  ['任务分解 Markdown', X.wbsToMarkdown(), ['前期策划', '活动收尾']],
  ['任务分解 CSV', X.wbsToCsv(), ['阶段', '完成度']],
  ['阶段检查点 Markdown', X.gatesToMarkdown(), ['检查点', '前期策划']],
  ['方案比选 Markdown', X.decisionToMarkdown(), ['候选方案', '加权得分', '决策结论']],
  ['风险预案 Markdown', X.riskPlanToMarkdown(), ['高风险', '分级应急预案']],
  ['素材清单 Markdown', X.assetsToMarkdown(), ['素材']],
  ['材料包 Markdown', X.materialsPack(), ['活动策划书']],
  ['全量档案 Markdown', X.fullArchive(), ['项目信息表', '风险', '任务']],
  ['关键节点记录', X.logToMarkdown(), ['#']]
];
for (const [label, text, needles] of cases) {
  const ok = typeof text === 'string' && text.length > 80 && needles.every((needle) => text.includes(needle));
  check(`导出「${label}」内容完整`, ok, `长度 ${String(text).length}`);
}
const csvLines = X.wbsToCsv().trim().split('\n').length;
check('CSV 行数 = 任务数 + 1', csvLines === state.wbs.length + 1, `csv=${csvLines} wbs=${state.wbs.length}`);

/* ── 7. 项目包往返 ──────────────────────── */
const bundle = store.exportBundle();
check('项目包包含海报配置', Boolean(bundle.poster && bundle.poster.title));
check('项目包包含界面偏好', Boolean(bundle.ui && bundle.ui.taskView));
check('项目包包含资源与演练字段', Array.isArray(bundle.resources) && Array.isArray(bundle.drills));
/* reset/import 都作用在同一个 state 对象上，所以先固化快照再比对 */
const snapshot = JSON.parse(JSON.stringify({
  name: state.project.basic.name,
  wbs: state.wbs.length,
  risks: state.risks.length,
  options: state.options.selected.map((o) => o.name).join('|'),
  slogan: state.poster.slogan
}));
const projectsBefore = store.state.projects.length;
store.reset();
check('重置后回到空状态', store.state.project === null && store.state.wbs.length === 0);
check('重置保留项目槽位', store.state.projects.length === projectsBefore);
store.importBundle(JSON.parse(JSON.stringify(bundle)));
const round = store.state;
check('导入默认新建一份项目', round.projects.length === projectsBefore + 1, `${round.projects.length} vs ${projectsBefore + 1}`);
check('往返后项目信息一致', round.project?.basic?.name === snapshot.name);
check('往返后任务数一致', round.wbs.length === snapshot.wbs, `${round.wbs.length} vs ${snapshot.wbs}`);
check('往返后风险数一致', round.risks.length === snapshot.risks);
check('往返后比选推荐不变', round.options.selected.map((o) => o.name).join('|') === snapshot.options);
check('往返后海报配置一致', round.poster?.slogan === snapshot.slogan);
check('导入动作写入变更记录', round.log.some((entry) => entry.kind === 'import'));

/* ── 7b. 多项目：新建 / 切换 / 重命名 / 复制 / 归档 / 删除 ── */
const firstId = store.state.activeId;
const secondId = store.createProject({ name: '第二个项目', type: '运动会' });
check('新建项目后成为当前项目', store.state.activeId === secondId && store.projectName() === '第二个项目');
check('项目库新增一个条目', store.state.projects.length === projectsBefore + 2, `${store.state.projects.length}`);
store.renameProject(secondId, '第二个项目（改名）');
check('重命名同步到项目信息', store.state.project.basic.name === '第二个项目（改名）');
check('可以切回上一个项目', store.switchProject(firstId) && store.state.activeId === firstId);
check('切换后载入的是该项目内容', store.state.project.basic.name === snapshot.name, store.state.project?.basic?.name);
const dupId = store.duplicateProject(secondId);
check('复制项目生成新条目', Boolean(dupId) && dupId !== secondId && store.state.projects.length === projectsBefore + 3);
check('副本沿用原项目内容并标注（副本）',
  store.state.project?.basic?.name === '第二个项目（改名）（副本）', store.state.project?.basic?.name);
check('副本内容与源项目一致（任务数）', store.state.wbs.length === 0);
store.archiveProject(secondId, true);
check('归档标记已写入', store.state.projects.find((p) => p.id === secondId)?.archived === true);
store.deleteProject(secondId);
check('删除后项目库不再包含该条目', !store.state.projects.some((p) => p.id === secondId));

/* ── 7c. 本地身份与角色 ─────────────────── */
store.setUser({ name: '测试同学', role: 'viewer' });
check('身份写入后为只读访客', store.state.user?.role === 'viewer' && U.canOperate() === false);
check('只读访客不具备管理权限', U.canManage() === false);
store.setUser({ name: '测试同学', role: 'organizer' });
check('组织者具备管理与编辑权限', U.canManage() === true && U.canOperate() === true);
check('角色标签可读', U.roleLabel() === '活动组织者', U.roleLabel());
store.signOut();
check('退出登录后回到最低权限', store.state.user === null && U.canOperate() === false);

/* ── 7d. 角色门禁：静态控件要能双向切换 ─── */
const gate = window.WB.gateWrites;
check('编排层已导出角色门禁函数', typeof gate === 'function');
store.setUser({ name: '访客', role: 'viewer' });
gate();
check('只读访客禁用顶栏「基本信息」', elementFor('editBasic').disabled === true);
check('只读访客禁用「重新填写」', elementFor('resetBtn').disabled === true);
check('只读访客禁用向导提交与示例载入',
  elementFor('wizardSubmit').disabled === true && elementFor('wizardSample').disabled === true);
check('只读访客禁用 AI 补全与批量生成',
  elementFor('aiFillManifest').disabled === true && elementFor('generateMaterials').disabled === true);
store.setUser({ name: '同学', role: 'organizer' });
gate();
check('切回组织者后顶栏按钮恢复可写',
  elementFor('editBasic').disabled === false && elementFor('resetBtn').disabled === false);
check('切回组织者后向导恢复可写', elementFor('wizardSubmit').disabled === false);
store.signOut();

/* ── 8. AI 合并规则：不覆盖用户手改 ───────── */
const p1 = store.freshProject();
p1.basic.name = '用户手写的活动名';
p1.meta.basic.name = 'user';
const filled = window.WB.ai.mergeBasic(p1, { name: 'AI 想改的名字', organizer: '校学生会' });
check('AI 不覆盖用户已填写字段', p1.basic.name === '用户手写的活动名', p1.basic.name);
check('AI 只填补空白字段', p1.basic.organizer === '校学生会' && filled === 1, `filled=${filled} organizer=${p1.basic.organizer}`);

const p2 = store.freshProject();
p2.basic.venue = '待确认';
p2.meta.basic.venue = 'pending';
window.WB.ai.mergeBasic(p2, { venue: '新场地' });
check('AI 可覆盖仍是「待确认」的字段', p2.basic.venue === '新场地', `venue=${p2.basic.venue}`);

const p3 = store.freshProject();
window.WB.ai.mergeBasic(p3, { type: '不存在的活动类型' });
check('枚举字段收到非法值时降级为「待确认」', p3.basic.type === '待确认', `type=${p3.basic.type}`);

const p4 = store.freshProject();
p4.outputs.proposal = true;
p4.meta.outputs.proposal = 'user';
window.WB.ai.mergeOutputs(p4, { proposal: false, poster: true });
check('AI 不会取消用户已勾选的产出', p4.outputs.proposal === true);
check('AI 可补勾未选择的产出', p4.outputs.poster === true);

/* ── 汇总 ──────────────────────────────── */
/* ── 9. 视图渲染冒烟：每个视图都要能出表且不抛错 ── */
const VIEW_IDS = ['projects', 'overview', 'manifest', 'tasks', 'decision', 'risk',
  'resources', 'drills', 'material', 'assets', 'help'];
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scriptOrder = [...html.matchAll(/src="\.\/(.+?)"/g)].map((match) => match[1]);
check('自测的模块加载顺序与 index.html 脚本顺序一致',
  scriptOrder.join('|') === MODULES.join('|'),
  `index.html: ${scriptOrder.join(', ')}`);

store.importBundle(JSON.parse(JSON.stringify(bundle)));

/* 准备一份「什么都有」的状态，尽量把分支都走一遍 */
const live = store.state;
live.resources = [
  store.normaliseResource({ name: '志愿者', kind: 'staff', phase: 'execute', available: 30, assigned: 36, owner: '志愿者负责人' }),
  store.normaliseResource({ name: '备用场地', kind: 'venue', phase: 'execute', available: 1, assigned: 0 })
];
const runningDrill = store.normaliseDrill({
  id: 'drill-smoke', scenarioId: 'venue-unavailable', title: '主场地临时不可用', category: 'venue', phase: 'execute',
  status: 'running', steps: window.WB.drills.byId('venue-unavailable').steps.map((s) => ({ ...s, done: false })),
  rollback: '条件', followUp: ['改进项']
});
live.drills = [runningDrill, store.normaliseDrill({ ...runningDrill, id: 'drill-done', status: 'done', finishedAt: new Date().toISOString(), outcome: '已完成' })];
live.ui.drillId = runningDrill.id;
live.assets.push({ id: 'asset-ai', name: 'AI 宣传图', kind: 'image', url: '/generated/demo.png', phase: 'prepare', tags: [], note: 'AI 生成', createdAt: new Date().toISOString() });
live.poster = { ...(live.poster || {}), images: [{ url: '/generated/demo.png', model: 'gpt-image-2', prompt: '测试', createdAt: new Date().toISOString() }] };

for (const id of VIEW_IDS) {
  const view = window.WB.views[id];
  check(`视图「${id}」已注册`, Boolean(view && typeof view.render === 'function'));
  check(`index.html 有 #${id}Panel 面板`, html.includes(`id="${id}Panel"`));
  check(`index.html 已加载 views/${id}.js`, html.includes(`views/${id}.js`));
  try {
    view.render();
    check(`视图「${id}」渲染无异常`, true);
  } catch (error) {
    check(`视图「${id}」渲染无异常`, false, `${error.message}`);
  }
  try {
    view.mount?.();
    check(`视图「${id}」mount 无异常`, true);
  } catch (error) {
    check(`视图「${id}」mount 无异常`, false, `${error.message}`);
  }
}

/* ── 9b. 分页路由：一次只显示一个视图，标签栏覆盖全部视图 ── */
window.WB.switchView('overview');
const navHtml = document.getElementById('tabs').innerHTML;
const navViews = [...navHtml.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
check('标签栏覆盖全部视图且顺序与 VIEW_IDS 一致',
  navViews.join('|') === VIEW_IDS.join('|'), navViews.join(','));
check('index.html 的面板默认隐藏', (html.match(/class="panel hidden"/g) || []).length === VIEW_IDS.length);
const visiblePanels = VIEW_IDS.filter((id) => !document.getElementById(`${id}Panel`).classList.contains('hidden'));
check('一次只显示当前视图', visiblePanels.length === 1 && visiblePanels[0] === 'overview', visiblePanels.join(','));
window.WB.switchView('tasks');
check('切换视图后只有目标任务面板可见',
  !document.getElementById('tasksPanel').classList.contains('hidden')
  && document.getElementById('overviewPanel').classList.contains('hidden'));
check('切换视图写入了 state.view', store.state.view === 'tasks', store.state.view);
check('当前标签被标记为选中', document.getElementById('tabs').innerHTML.includes('tab is-active" data-view="tasks"'));
/* 真正走一遍标签按钮的 click 监听，防止编排层出现未定义的跳转函数 */
document.getElementById('tabs').emit('click', {
  target: { closest: (selector) => (selector === '.tab' ? { dataset: { view: 'risk' } } : null) }
});
check('点击标签按钮切换视图', store.state.view === 'risk', `view=${store.state.view}`);
window.WB.switchView('overview');

/* ── 9c. 阶段门禁：证据推断、自动打勾与人工覆盖 ── */
store.setUser({ name: '组织者', role: 'organizer' });
store.importBundle(JSON.parse(JSON.stringify(bundle)));
const WBSAPI = window.WB.wbs;
check('门禁推断与自动打勾接口已导出',
  typeof WBSAPI.gateReview === 'function' && typeof WBSAPI.autoTick === 'function'
  && typeof WBSAPI.setGate === 'function' && typeof WBSAPI.gateMetaOf === 'function');
const gateIds = Object.entries(GATES).filter(([key]) => key !== 'hint').flatMap(([, items]) => items.map((item) => item.id));
check('每个检查点都有推断规则', gateIds.every((id) => WBSAPI.gateRuleIds.includes(id)),
  gateIds.filter((id) => !WBSAPI.gateRuleIds.includes(id)).join(','));
const reviewBefore = WBSAPI.gateReview(store.state);
const reviewItems = reviewBefore.phases.flatMap((phase) => phase.items);
check('推断覆盖全部检查点', reviewItems.length === gateIds.length, `实际 ${reviewItems.length}`);
check('每条推断都带证据说明与合法等级',
  reviewItems.every((item) => item.evidence && ['ready', 'partial', 'manual', 'done'].includes(item.level)),
  reviewItems.filter((item) => !item.evidence).map((item) => item.id).join(','));
check('推断给出的跳转目标都是已注册视图',
  reviewItems.every((item) => !item.fix || VIEW_IDS.includes(item.fix.view)),
  reviewItems.filter((item) => item.fix && !VIEW_IDS.includes(item.fix.view)).map((item) => item.id).join(','));
const readyBefore = reviewBefore.ready;
check('示例项目上推断出可自动确认的检查点', readyBefore >= 5, `可自动确认 ${readyBefore} 项`);

/* 自动打勾：有证据的直接勾上，并记下来源与证据 */
const ticked = WBSAPI.autoTick(store.state);
check('自动打勾数量与推断结果一致', ticked === readyBefore, `打勾 ${ticked} / 推断 ${readyBefore}`);
check('自动打勾后没有遗留的证据项', WBSAPI.gateReview(store.state).ready === 0);
const autoEntries = [];
for (const phase of WBSAPI.gateReview(store.state).phases) {
  for (const item of phase.items) {
    const meta = WBSAPI.gateMetaOf(store.state, phase.phase, item.id);
    if (meta && meta.source === 'auto') autoEntries.push({ phase: phase.phase, id: item.id, evidence: meta.evidence });
  }
}
check('自动勾上的检查点都记了来源与证据',
  autoEntries.length === ticked && autoEntries.every((entry) => entry.evidence),
  `自动项 ${autoEntries.length}`);
check('自动打勾是幂等的（再跑一次不重复打勾）', WBSAPI.autoTick(store.state) === 0);

/* 人工取消之后，不再被自动勾回来 */
const firstAuto = autoEntries[0];
WBSAPI.setGate(store.state, firstAuto.phase, firstAuto.id, false);
check('人工取消后该项回到未确认', store.state.gates[firstAuto.phase][firstAuto.id] === false);
check('人工取消后不会被自动勾回来',
  WBSAPI.autoTick(store.state) === 0 && store.state.gates[firstAuto.phase][firstAuto.id] === false);
check('取消状态被记成手动静音', WBSAPI.gateMetaOf(store.state, firstAuto.phase, firstAuto.id)?.muted === true);
check('解除静音后又能自动确认',
  WBSAPI.resumeAuto(store.state, firstAuto.phase, firstAuto.id) >= 1
  && store.state.gates[firstAuto.phase][firstAuto.id] === true);

/* 走一遍真实的点击路径：撤销按钮要同时改状态、写日志，且之后不会被自动勾回 */
const logBeforeUndo = (store.state.log || []).length;
document.getElementById('tasksPanel').emit('click', {
  target: { closest: (selector) => (selector === '[data-gate-undo]' ? { dataset: { gateUndo: `${firstAuto.phase}:${firstAuto.id}` } } : null) }
});
check('点击撤销按钮后状态与变更日志都更新',
  store.state.gates[firstAuto.phase][firstAuto.id] === false
  && (store.state.log || []).length > logBeforeUndo
  && String(store.state.log[0].detail).includes('撤销'),
  store.state.log[0] && store.state.log[0].detail);
check('撤销后不会被自动勾回来', WBSAPI.autoTick(store.state) === 0 && store.state.gates[firstAuto.phase][firstAuto.id] === false);

/* 用户要的场景：某个产出材料一生成，对应检查点就自动检测并打勾 */
const trainItem = WBSAPI.gateReview(store.state).phases.flatMap((phase) => phase.items).find((item) => item.id === 'train');
check('材料没生成时培训检查点属于需人工确认',
  Boolean(trainItem) && trainItem.done === false && trainItem.level === 'manual', trainItem && trainItem.level);
store.state.materials.training = { sections: [{ title: '培训要点' }] };
const tickedByMaterial = WBSAPI.autoTick(store.state);
check('生成培训提纲后检查点自动确认',
  tickedByMaterial === 1 && store.state.gates.prepare.train === true, `打勾 ${tickedByMaterial}`);
check('自动确认附带证据说明',
  String(WBSAPI.gateMetaOf(store.state, 'prepare', 'train')?.evidence || '').includes('培训提纲'),
  WBSAPI.gateMetaOf(store.state, 'prepare', 'train')?.evidence);

/* 项目包要把确认来源一起带走 */
const gateMetaBundle = store.exportBundle();
check('项目包包含门禁确认来源', Boolean(gateMetaBundle.gateMeta && gateMetaBundle.gateMeta.prepare));

/* 门禁界面要真的渲染出「自动」标记与撤销入口 */
store.state.ui.taskView = 'gate';
window.WB.views.tasks.render();
const gateHtml = document.getElementById('taskViewBody').innerHTML;
check('门禁界面渲染出自动标记、证据与撤销入口',
  gateHtml.includes('is-auto') && gateHtml.includes('gate-banner') && gateHtml.includes('data-gate-undo='),
  `长度 ${gateHtml.length}`);
check('门禁界面没有 undefined / [object Object]',
  !gateHtml.includes('undefined') && !gateHtml.includes('[object Object]'));

/* 门禁勾选框必须算写入控件：属性名里的 phase 不能让它被误判成只读 */
const fakeGateInput = {
  closest: () => null, classList: { contains: () => false }, id: '',
  hasAttribute: (name) => name === 'data-write',
  getAttributeNames: () => ['data-write', 'data-gate-phase', 'data-gate'],
  getAttribute: (name) => (name === 'data-gate-phase' ? 'plan' : name === 'data-gate' ? 'goal' : '')
};
check('门禁勾选框被判定为写入控件（只读访客会被禁用）',
  window.WB.isReadOnlyControl(fakeGateInput) === false);
const fakeFilterChip = {
  closest: () => null, classList: { contains: () => false }, id: '',
  hasAttribute: () => false, getAttributeNames: () => ['data-task-phase'], getAttribute: () => 'plan'
};
check('阶段筛选筹码仍被判定为只读控件（访客可用）',
  window.WB.isReadOnlyControl(fakeFilterChip) === true);
store.state.ui.taskView = 'table';

/* 空项目也要能渲染 */
store.reset();
for (const id of VIEW_IDS) {
  try {
    window.WB.views[id].render();
    check(`空项目下视图「${id}」渲染无异常`, true);
  } catch (error) {
    check(`空项目下视图「${id}」渲染无异常`, false, error.message);
  }
}

/* 只读访客：门禁只禁用写入控件，不抛错 */
store.setUser({ name: '访客', role: 'viewer' });
const canOperateGuest = U.canOperate();
check('只读访客不允许编辑', canOperateGuest === false);
store.signOut();

/* 导出在新视图上也要有内容 */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.resources = [store.normaliseResource({ name: '志愿者', kind: 'staff', available: 2, assigned: 5, unit: '人' })];
const resourceMd = X.resourcesToMarkdown();
check('资源台账导出包含冲突自检', resourceMd.includes('占用冲突自检') && resourceMd.includes('缺口 3'), `长度 ${resourceMd.length}`);
store.state.drills = [store.normaliseDrill({ id: 'd', scenarioId: 'venue-unavailable', title: '主场地临时不可用', category: 'venue', phase: 'execute', status: 'done', finishedAt: new Date().toISOString(), decisions: '换场地', outcome: '12 分钟内完成', steps: [{ text: '确认封锁范围', done: true, note: '' }] })];
const drillMd = X.drillsToMarkdown();
check('演练导出包含步骤与结论', drillMd.includes('主场地临时不可用') && drillMd.includes('确认封锁范围') && drillMd.includes('12 分钟内完成'), `长度 ${drillMd.length}`);
const archive = X.fullArchive();
check('全量档案纳入资源与演练', archive.includes('人员与资源台账') && archive.includes('突发变更演练记录'));

/* ── 10. 跨视图跳转：总览的待办 / 阶段块 / 节点 / 产出都要带有效目标 ── */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
const VIEW_ID_SET = new Set(VIEW_IDS);
const gapItems = window.WB.wbs.gaps(store.state);
check('缺口项带文案与跳转目标',
  gapItems.length > 0 && gapItems.every((item) => item.text && item.target && VIEW_ID_SET.has(item.target.view)),
  JSON.stringify(gapItems.map((item) => item.target && item.target.view)));

window.WB.views.overview.render();
const overviewHtml = document.getElementById('overviewPanel').innerHTML;
const gotoViews = [...overviewHtml.matchAll(/data-goto-view="([^"]+)"/g)].map((match) => match[1]);
check('总览渲染出可点击的跳转入口', gotoViews.length >= 10, `入口 ${gotoViews.length} 个`);
check('总览跳转目标全部指向已注册视图', gotoViews.every((id) => VIEW_ID_SET.has(id)),
  gotoViews.filter((id) => !VIEW_ID_SET.has(id)).join(','));
const jumpRows = [...overviewHtml.matchAll(/data-goto-row="([^"]+)"/g)].map((match) => match[1]);
check('关键节点带可定位的任务行 id',
  jumpRows.length > 0 && jumpRows.every((id) => store.state.wbs.some((row) => row.id === id)),
  jumpRows.join(','));

store.state.ui.taskView = 'table';
store.state.ui.taskPhase = 'all';
window.WB.views.tasks.render();
const allRowsHtml = document.getElementById('taskViewBody').innerHTML;
const rowIdCount = (allRowsHtml.match(/data-row-id=/g) || []).length;
check('任务表每行带稳定行 id 供跳转定位', rowIdCount === store.state.wbs.length,
  `行 ${rowIdCount} / 任务 ${store.state.wbs.length}`);
const phaseChips = (document.getElementById('wbsSummary').innerHTML.match(/data-task-phase=/g) || []).length;
check('任务表提供「全部 + 各阶段」筛选筹码', phaseChips === U.PHASES.length + 1, `筹码 ${phaseChips} 个`);

store.state.ui.taskPhase = 'plan';
window.WB.views.tasks.render();
const planRowCount = (document.getElementById('taskViewBody').innerHTML.match(/data-row-id=/g) || []).length;
check('按阶段筛选后只剩该阶段任务',
  planRowCount === store.state.wbs.filter((row) => row.phase === 'plan').length, `行 ${planRowCount}`);

window.WB.jumpFrom({ dataset: { gotoView: 'tasks', gotoTaskview: 'table', gotoPhase: 'close' } });
check('jumpFrom 切到目标视图并写入阶段筛选',
  store.state.view === 'tasks' && store.state.ui.taskPhase === 'close',
  `view=${store.state.view} phase=${store.state.ui.taskPhase}`);
store.state.ui.taskPhase = 'all';
console.log(`\n结构化活动工作台 · 离线自测`);
console.log(`模块 ${MODULES.length} 个 · 断言 ${checks} 项 · 失败 ${failures.length} 项`);
if (failures.length) {
  console.log('');
  for (const item of failures) console.log(`  ✗ ${item}`);
  console.log('');
  process.exit(1);
}
console.log('  ✓ 全部通过\n');
