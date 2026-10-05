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
    emit: (type, event) => { let result; /* 派发期间新注册的监听器不参与本轮（与浏览器一致，避免重绘后反复追加） */ for (const fn of [...(events[type] || [])]) result = fn(event); return result; },
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

/* 视图挂载会碰窗口级监听与轮询：这里补上；计时器给个不落地的假实现，
   否则自测进程会被轮询定时器一直挂着不退出（浏览器里才需要真的定时器）。 */
globalThis.window.addEventListener = noop;
globalThis.window.removeEventListener = noop;
globalThis.window.setInterval = () => 0;
globalThis.window.clearInterval = noop;

const MODULES = [
  'schemas.js', 'materials.js',
  'core/util.js', 'core/qr.js', 'core/signup.js', 'core/store.js', 'core/risk.js', 'core/wbs.js', 'core/guide.js', 'core/drills.js', 'core/ai.js', 'core/interview.js', 'core/markdown.js', 'core/ooxml.js', 'core/docx.js', 'core/export.js',
  'views/projects.js', 'views/overview.js', 'views/manifest.js', 'views/tasks.js', 'views/decision.js',
  'views/risk.js', 'views/resources.js', 'views/drills.js', 'views/material.js', 'views/assets.js', 'views/signup.js', 'views/help.js',
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

/* 交付格式：技能包要声明主交付格式，且与产出类型自洽 */
const DELIVERABLE_BY_KIND = { table: 'excel', document: 'word', graphic: 'svg' };
const deliverableBad = registry.skills.filter((skill) => {
  if (!registry.deliverables || !registry.deliverables[skill.deliverable]) return true;
  return DELIVERABLE_BY_KIND[skill.kind]
    ? skill.deliverable !== DELIVERABLE_BY_KIND[skill.kind]
    : !['markdown', 'none'].includes(skill.deliverable);
});
check('每个技能都声明了合法的交付格式', deliverableBad.length === 0,
  deliverableBad.map((skill) => `${skill.id}:${skill.deliverable}`).join(', '));

const skillDocMismatch = registry.skills.filter((skill) => {
  const text = fs.readFileSync(path.join(root, 'skills', skill.id, 'SKILL.md'), 'utf8');
  const declared = new RegExp(`\\ndeliverable: ${skill.deliverable}\\r?\\n`).test(text);
  return !declared || !text.includes('## 交付格式');
});
check('SKILL.md 的交付格式与 registry 一致且含「交付格式」章节', skillDocMismatch.length === 0,
  skillDocMismatch.map((skill) => skill.id).join(', '));

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

/* ── 6b. Markdown 渲染与 Word / Excel 生成 ── */
const MD = window.WB.markdown;
const OX = window.WB.ooxml;

const tableHtml = MD.toHtml('| 科目 | 金额 |\n| --- | ---: |\n| 场地 | 2000 |');
check('Markdown 表格渲染成 HTML 表格',
  tableHtml.includes('<table') && tableHtml.includes('<th>科目</th>') && tableHtml.includes('<td>2000</td>'),
  tableHtml.slice(0, 80));
const escaped = MD.toHtml('**加粗** 与 <script>alert(1)</script>');
check('Markdown 渲染转义 HTML 且支持行内强调',
  escaped.includes('<strong>加粗</strong>') && escaped.includes('&lt;script&gt;') && !escaped.includes('<script>'));
const mdBlocks = MD.parseBlocks('# 标题\n\n正文一\n正文二\n\n- 甲\n- 乙\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
check('Markdown 结构块类型齐全',
  mdBlocks.map((block) => block.type).join(',') === 'heading,paragraph,list,table',
  mdBlocks.map((block) => block.type).join(','));
check('Markdown 相邻行合并为同一段', mdBlocks[1].lines.length === 2, JSON.stringify(mdBlocks[1]));

/* CRC32 用标准校验值锚定（"123456789" → 0xCBF43926），确保打包层没写错 */
check('OOXML CRC32 与标准一致', OX.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);

const probeDoc = {
  title: '校园科技文化节｜预算表',
  sections: [
    { heading: '一、预算总览', body: '| 科目 | 金额 |\n| --- | --- |\n| 场地与设备 | 6000 |\n| 物料制作 | 4000 |' },
    { heading: '二、成本控制与审批', body: '先审批，再采购。\n\n- 500 元以上需要负责人签字\n- 采购后三日内报销' }
  ]
};
const isZip = (bytes) => bytes instanceof Uint8Array
  && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;

const docxBytes = X.materialToDocx(probeDoc);
check('导出 Word 得到 ZIP 容器（.docx）', isZip(docxBytes), `${docxBytes?.length ?? 0} 字节`);
const docxParts = OX.readEntries(docxBytes);
const docxNames = docxParts.map((part) => part.name);
check('Word 包结构完整',
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']
    .every((name) => docxNames.includes(name)), docxNames.join(', '));
const docxBody = new TextDecoder().decode(docxParts.find((part) => part.name === 'word/document.xml').data);
check('Word 正文含章节标题、标题样式与表格',
  docxBody.includes('一、预算总览') && docxBody.includes('w:val="Heading1"') && docxBody.includes('<w:tbl>'));
check('Word 表格保留每个单元格文本',
  ['科目', '金额', '场地与设备', '6000'].every((cell) => docxBody.includes(cell)));
check('Word 列表渲染为项目符号段落', docxBody.includes('• 500 元以上需要负责人签字'));

/* OOXML 的 pPr / worksheet 是有序序列，顺序错了 Word、Excel 会要求「修复」 */
const PPR_ORDER = ['w:pStyle', 'w:spacing', 'w:ind', 'w:jc'];
const pprBlocks = [...docxBody.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)].map((match) => match[1]);
const pprOrderOk = pprBlocks.length > 0 && pprBlocks.every((inner) => {
  const positions = [...inner.matchAll(/<w:(\w+)[\s/>]/g)]
    .map((match) => `w:${match[1]}`)
    .filter((tag) => PPR_ORDER.includes(tag))
    .map((tag) => PPR_ORDER.indexOf(tag));
  return positions.every((value, index) => index === 0 || positions[index - 1] <= value);
});
check('Word 段落属性顺序符合 OOXML 序列（pStyle → spacing → ind → jc）', pprOrderOk, `${pprBlocks.length} 个 pPr`);

const xlsxBytes = X.materialToXlsx(probeDoc);
check('导出 Excel 得到 ZIP 容器（.xlsx）', isZip(xlsxBytes), `${xlsxBytes?.length ?? 0} 字节`);
const xlsxParts = OX.readEntries(xlsxBytes);
const sheetParts = xlsxParts.filter((part) => part.name.startsWith('xl/worksheets/'));
check('Excel 每章一张工作表', sheetParts.length === probeDoc.sections.length,
  `sheets=${sheetParts.length} sections=${probeDoc.sections.length}`);
check('Excel 含工作簿与样式表',
  xlsxParts.some((part) => part.name === 'xl/workbook.xml') && xlsxParts.some((part) => part.name === 'xl/styles.xml'));
const firstSheet = new TextDecoder().decode(sheetParts[0].data);
check('Excel 的 cols 排在 sheetData 之前', firstSheet.indexOf('<cols') >= 0 && firstSheet.indexOf('<cols') < firstSheet.indexOf('<sheetData'));check('Excel 表格首行为表头并冻结首行',
  firstSheet.includes('t="inlineStr"') && firstSheet.includes('state="frozen"') && firstSheet.includes('科目'));

check('材料包 Word 也能生成', isZip(X.materialsPackDocx()));

check('主交付格式随产出类型切换',
  X.primaryFormat({ kind: 'table' }) === 'xlsx'
  && X.primaryFormat({ kind: 'document' }) === 'docx'
  && X.primaryFormat({ kind: 'structure' }) === 'xlsx'
  && X.primaryFormat({ kind: 'graphic' }) === 'md');

/* 真实示例材料也要能导出不报错 */
const materialItem = U.OUTPUT_ITEMS.find((item) => state.materials[item.key]);
check('示例项目带有可导出的材料', Boolean(materialItem), '缺少已生成材料');
if (materialItem) {
  const realDoc = state.materials[materialItem.key];
  const realDocx = X.materialToDocx(realDoc);
  const realXlsx = X.materialToXlsx(realDoc);
  check('示例材料导出 Word / Excel 成功', isZip(realDocx) && isZip(realXlsx),
    `docx=${realDocx.length} xlsx=${realXlsx.length}`);
  check('示例材料 Excel 工作表数 = 章节数',
    OX.readEntries(realXlsx).filter((part) => part.name.startsWith('xl/worksheets/')).length === realDoc.sections.length);
}

/* 材料视图默认渲染 Markdown 预览，而不是裸文本框 */
state.ui.openMaterial = materialItem.key;
window.WB.views.material.render();
const previewHtml = document.querySelector('#materialList').innerHTML;
check('材料视图默认渲染 Markdown 预览并带模式开关',
  previewHtml.includes('md-body') && previewHtml.includes('material-mode'));
check('预览模式不再输出裸 textarea',
  !previewHtml.includes('data-material-body') && previewHtml.includes('md-table-wrap'));
check('导出按钮提供 Word / Excel / Markdown 三种格式',
  previewHtml.includes('data-format="docx"') && previewHtml.includes('data-format="xlsx"') && previewHtml.includes('data-format="md"'));
/* ── 6c. 在线编辑 + 发票列 ──────────────────
   预览即编辑面：正文块 contenteditable、表格单元格直接改，改完只回写这一块；
   金额表最右自动多一列「发票」，文件拖到对应行即可挂上。 */

const invDocKey = 'budgetSheet';
const invDoc = {
  title: '发票测试｜预算表',
  templateName: '测试模板',
  generatedAt: new Date().toISOString(),
  source: 'ai',
  sections: [
    { heading: '一、预算总览', body: '| 科目 | 金额 |\n| --- | ---: |\n| 场地与设备 | 6000 |\n| 物料制作 | 4000 |' },
    { heading: '二、成本控制', body: '先审批再采购。\n\n- 500 元以上需签字' }
  ]
};
const savedUser = store.state.user;
state.materials[invDocKey] = invDoc;
state.project.outputs[invDocKey] = true;
state.ui.openMaterial = invDocKey;

/* 只读访客：看得到发票栏，但没有编辑入口 */
store.setUser({ name: '只读同学', role: 'viewer' });
window.WB.views.material.render();
const guestHtml = document.querySelector('#materialList').innerHTML;
check('访客只读：预览不带 contenteditable', !guestHtml.includes('contenteditable="true"'));
check('访客只读：不出现「添加一行」与删行按钮',
  !guestHtml.includes('data-material-row-add') && !guestHtml.includes('data-material-row-remove'));
check('访客也能看到金额表的发票列', guestHtml.includes('md-invoice-head') && guestHtml.includes('发票'));

/* 成员：可在线编辑 */
store.setUser({ name: '编辑同学', role: 'member' });
window.WB.views.material.render();
const editHtml = document.querySelector('#materialList').innerHTML;
check('成员可写：正文与表格带上 contenteditable', editHtml.includes('contenteditable="true"'));
check('成员可写：表格提供「添加一行」', editHtml.includes('data-material-row-add'));
check('成员可写：发票格可拖拽也能点选上传',
  editHtml.includes('md-invoice-add') && editHtml.includes('data-material-invoice-add'));
check('金额表提示发票拖到对应行', editHtml.includes('发票文件直接拖到对应那一行的'));

/* 金额表识别：认得出才挂发票列 */
check('金额表识别：表头含金额 / 单价 / 费用 / 合计',
  X.isMoneyTable(['科目', '金额']) && X.isMoneyTable(['项目', '单价（元）']) && X.isMoneyTable(['费用项', '合计']));
check('金额表识别：章节名带预算 / 经费 / 决算也算',
  X.isMoneyTable(['项目', '数量'], '二、预算明细') && X.isMoneyTable([], '三、经费决算'));
check('非金额表不挂发票列', !X.isMoneyTable(['阶段', '任务', '负责人'], '二、任务分解'));
check('发票键按「章节:表块:行」生成', X.invoiceKey(2, 1, 5) === '2:1:5');

/* 只改这一块：空行与相邻段落原样保留 */
const spliceSource = '甲段\n\n乙段\n\n丙段';
check('只替换目标块，空行与相邻段落原样保留',
  MD.spliceBlock(spliceSource, MD.parseBlocks(spliceSource)[1], '乙段（改）') === '甲段\n\n乙段（改）\n\n丙段');

/* 在线改单元格：写回该表块，表头 / 对齐 / 其它章节都不动 */
const invTable = () => MD.parseBlocks(invDoc.sections[0].body)[0];
const fakeCell = (innerHTML, derived = false) => ({ innerHTML, derived });
const fakeRow = (cells) => {
  cells.forEach((cell, col) => { if (cell) cell.dataset = { col: String(col) }; });
  return {
    querySelector: (selector) => {
      const match = /data-col="(\d+)"/.exec(selector);
      return match && cells[Number(match[1])] ? cells[Number(match[1])] : null;
    },
    querySelectorAll: (selector) => {
      if (!/td\[data-col\]/.test(selector)) return [];
      const onlyDerived = selector.includes(':not([contenteditable])');
      return cells.filter((cell) => cell && (!onlyDerived || cell.derived));
    }
  };
};
window.WB.views.material.commitTable({
  dataset: { materialBlock: invDocKey, sectionIndex: '0', blockIndex: '0' },
  querySelector: (selector) => (selector === 'thead tr'
    ? { querySelectorAll: () => [fakeCell('科目'), fakeCell('金额')] } : null),
  querySelectorAll: (selector) => (selector === 'tbody tr'
    ? [fakeRow([fakeCell('场地与设备'), fakeCell('**800**')]), fakeRow([fakeCell('物料制作'), fakeCell('4000')])]
    : [])
});
check('在线改单元格：改的那格写回（行内标记也还原）',
  invTable().rows[0][1] === '**800**', invDoc.sections[0].body);
check('在线改单元格：表头与其它行不动',
  invTable().header.join('|') === '科目|金额' && invTable().rows[1][1] === '4000');
check('在线改单元格：对齐占位（---:）保留', invDoc.sections[0].body.split('\n')[1] === '| --- | ---: |');
check('在线改单元格：其它章节完全不受影响',
  invDoc.sections[1].body === '先审批再采购。\n\n- 500 元以上需签字');
check('commitTable 对非表格块本身不写入',
  (window.WB.views.material.commitTable({ dataset: { materialBlock: invDocKey, sectionIndex: '1', blockIndex: '0' },
    querySelector: () => null, querySelectorAll: () => [] }),
  invDoc.sections[1].body === '先审批再采购。\n\n- 500 元以上需签字'));

/* 发票：小文件内联、超大只记文件名；导出才补列，不写回正文 */
const invKey = X.invoiceKey(0, 0, 1);
const attached = window.WB.views.material.attachInvoices(invDocKey, invKey, [
  { name: '场地租赁发票.pdf', size: 200 * 1024, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,QUJD' },
  { name: '大图扫描件.png', size: 900 * 1024, type: 'image/png', dataUrl: '' }
]);
check('发票挂到指定行', Array.isArray(attached) && X.invoicesOf(invDoc, invKey).length === 2);
check('小发票内联保存，超大只留文件名',
  X.invoicesOf(invDoc, invKey)[0].stored === true && X.invoicesOf(invDoc, invKey)[1].stored === false);
check('正文本身不含「发票」（发票是导出层派生）', !invDoc.sections[0].body.includes('发票'));

const withCol = X.withInvoices(invDoc, 0, MD.parseBlocks(invDoc.sections[0].body));
check('withInvoices：有附件的表补出发票列',
  withCol[0].header[withCol[0].header.length - 1] === '发票'
  && withCol[0].rows[1][withCol[0].rows[1].length - 1] === '场地租赁发票.pdf、大图扫描件.png');
const withNone = X.withInvoices({ sections: [] }, 0, MD.parseBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |'));
check('withInvoices：没有附件时不补空列',
  withNone[0].header.length === 2 && withNone[0].header.join('|') === 'a|b');

const invDocxBody = new TextDecoder().decode(OX.readEntries(X.materialToDocx(invDoc)).find((part) => part.name === 'word/document.xml').data);
check('导出 Word：有附件的那行带上发票列与文件名',
  invDocxBody.includes('发票') && invDocxBody.includes('场地租赁发票.pdf'));
const invSheet = new TextDecoder().decode(OX.readEntries(X.materialToXlsx(invDoc)).find((part) => part.name === 'xl/worksheets/sheet1.xml').data);
check('导出 Excel：明细表带上发票列与文件名',
  invSheet.includes('发票') && invSheet.includes('场地租赁发票.pdf'));

/* 加行 / 删行：发票跟着行走，删掉的那行发票一起清 */
window.WB.views.material.removeRow(invDocKey, 0, 0, 0);
check('删除行：表格少一行', invTable().rows.length === 1, invDoc.sections[0].body);
check('删除行：其余行的发票索引前移',
  X.invoicesOf(invDoc, X.invoiceKey(0, 0, 0)).length === 2
  && X.invoicesOf(invDoc, X.invoiceKey(0, 0, 1)).length === 0, JSON.stringify(invDoc.invoices));
window.WB.views.material.addRow(invDocKey, 0, 0);
check('添加一行：表格多一行且原有发票不受影响',
  invTable().rows.length === 2 && X.invoicesOf(invDoc, X.invoiceKey(0, 0, 0)).length === 2);
window.WB.views.material.removeRow(invDocKey, 0, 0, 0);
window.WB.views.material.removeRow(invDocKey, 0, 0, 0);
check('表格至少保留一行（不会被删空）', invTable().rows.length === 1, invDoc.sections[0].body);

const paraBlock = MD.parseBlocks(invDoc.sections[1].body)[0];
check('预览块：可写时带 contenteditable，只读时没有',
  window.WB.views.material.previewBlock(invDocKey, invDoc, 1, 0, paraBlock, true).includes('contenteditable="true"')
  && !window.WB.views.material.previewBlock(invDocKey, invDoc, 1, 0, paraBlock, false).includes('contenteditable'));

/* 合计行：数值自动求和，且不能编辑、不能删除 */
check('合计行识别：含合计 / 总计 / 小计',
  X.isTotalRow(['合计', '1']) && X.isTotalRow(['总计', '1']) && X.isTotalRow(['', '小计', '1']));
check('非合计行不误判', !X.isTotalRow(['场地与设备', '6000', '30%']));
const totalHead = ['科目', '金额', '占比'];
const totalRows = MD.parseBlocks('| 科目 | 金额 | 占比 |\n| --- | ---: | ---: |\n| 场地 | 6000 | 30% |\n| 物料 | 4000 | 20% |\n| 合计 | 1 | 50% |')[0].rows;
const summed = X.applyTotals(totalHead, totalRows);
check('合计列自动求和（6000 + 4000 = 10000）', summed[2][1] === '10000', JSON.stringify(summed[2]));
check('占比列按「本行金额 ÷ 合计金额」实时算出',
  summed[0][2] === '60%' && summed[1][2] === '40%' && summed[2][2] === '100%',
  summed.map((row) => row[2]).join(' / '));
check('写死 / 写错的占比会被重算，不是简单求和',
  summed[2][2] !== '50%' && X.isShareCell('30%') && !X.isShareCell('30'));
check('派生列规划：金额是基数、占比是派生列',
  X.columnPlan(totalHead, totalRows).baseCol === 1
  && X.columnPlan(totalHead, totalRows).shareCols.includes(2)
  && X.columnPlan(['阶段', '任务'], [['前期', '立项']]).shareCols.length === 0);
check('合计为 0 时不做除法，占比不硬算',
  X.applyTotals(['科目', '金额', '占比'], [['甲', '0', '50%'], ['合计', '0', '50%']])[1][2] === '50%');
check('合计标签列原样保留，其它行不动',
  summed[2][0] === '合计' && summed[0][1] === '6000' && summed[1][1] === '4000');
check('没有合计行时原样返回',
  X.applyTotals(totalHead, [['场地', '6000', '30%'], ['物料', '4000', '20%']]).length === 2);
check('金额带 ¥ / 千分位 / 「元」也能求和',
  X.applyTotals(['科目', '金额'], [['甲', '¥1,200元'], ['乙', '800'], ['合计', '0']])[2][1] === '2000');

/* 视图层：合计行不可编辑、不可删除，加行插在它上方 */
const totKey = 'settlement';
const totDoc = {
  title: '合计测试｜经费决算表',
  templateName: '测试模板',
  generatedAt: new Date().toISOString(),
  source: 'ai',
  sections: [
    { heading: '一、决算明细', body: '| 科目 | 金额 |\n| --- | ---: |\n| 场地 | 6000 |\n| 物料 | 4000 |\n| 合计 | 1 |' },
    { heading: '二、说明', body: '与预算口径一致。' }
  ]
};
state.materials[totKey] = totDoc;
state.project.outputs[totKey] = true;
state.ui.openMaterial = totKey;
window.WB.views.material.render();
const totHtml = document.querySelector('#materialList').innerHTML;
const totalRowHtml = (totHtml.match(/<tr class="md-total-row">[\s\S]*?<\/tr>/) || [''])[0];
check('预览：合计行标成 md-total-row，数值已自动求和（10000）',
  totalRowHtml.includes('md-total-cell') && totalRowHtml.includes('10000'), totalRowHtml.slice(0, 120));
check('预览：合计行整行不可编辑', !totalRowHtml.includes('contenteditable'));
check('预览：合计行没有删除按钮',
  !totalRowHtml.includes('data-material-row-remove') && (totHtml.match(/data-material-row-remove/g) || []).length === 2);
check('预览：金额表的合计行不出发票格（数据行仍可拖入）',
  totalRowHtml.includes('md-invoice') && !totalRowHtml.includes('data-material-invoice') && totHtml.includes('data-material-invoice='));
check('预览：表格工具条给出自动求和说明', totHtml.includes('「合计」行自动求和'));

/* 预览：占比格也是不可编辑的派生格（用独立材料，避免动到上面的 totDoc） */
const calcKey = 'review';
state.materials[calcKey] = {
  title: '占比测试｜复盘报告',
  generatedAt: new Date().toISOString(),
  source: 'ai',
  sections: [{ heading: '一、费用构成', body: '| 科目 | 金额 | 占比 |\n| --- | ---: | ---: |\n| 场地与设备 | 6000 | 30% |\n| 物料制作 | 4000 | 20% |\n| 合计 | 1 | 50% |' }]
};
state.project.outputs[calcKey] = true;
state.ui.openMaterial = calcKey;
window.WB.views.material.render();
const calcHtml = document.querySelector('#materialList').innerHTML;
const calcShareCells = calcHtml.match(/<td[^>]*class="md-calc-cell"[^>]*>[^<]*<\/td>/g) || [];
check('预览：占比格标成 md-calc-cell 且不可编辑（60% / 40%）',
  calcShareCells.length === 2
  && !calcShareCells.some((cell) => cell.includes('contenteditable'))
  && calcShareCells[0].includes('60%') && calcShareCells[1].includes('40%'),
  calcShareCells.join(' '));
const calcTotalRow = (calcHtml.match(/<tr class="md-total-row">[\s\S]*?<\/tr>/) || [''])[0];
check('预览：合计行的占比自动写成 100%', calcTotalRow.includes('100%'), calcTotalRow.slice(0, 160));
check('预览：工具条说明占比是按金额实时算的', calcHtml.includes('「占比」按金额实时计算'));

/* 派生格就地刷新：改金额后合计与占比一起变，正文也写回重算值 */
const liveTrs = [
  fakeRow([fakeCell('场地与设备'), fakeCell('6000'), fakeCell('60%', true)]),
  fakeRow([fakeCell('物料制作'), fakeCell('4000'), fakeCell('40%', true)]),
  fakeRow([fakeCell('合计'), fakeCell('10000', true), fakeCell('100%', true)])
];
window.WB.views.material.commitTable({
  dataset: { materialBlock: calcKey, sectionIndex: '0', blockIndex: '0' },
  querySelector: (selector) => (selector === 'thead tr'
    ? { querySelectorAll: () => [fakeCell('科目'), fakeCell('金额'), fakeCell('占比')] } : null),
  querySelectorAll: (selector) => (selector === 'tbody tr' ? liveTrs : [])
});
liveTrs[0].querySelector('td[data-col="1"]').innerHTML = '12000';
window.WB.views.material.commitTable({
  dataset: { materialBlock: calcKey, sectionIndex: '0', blockIndex: '0' },
  querySelector: (selector) => (selector === 'thead tr'
    ? { querySelectorAll: () => [fakeCell('科目'), fakeCell('金额'), fakeCell('占比')] } : null),
  querySelectorAll: (selector) => (selector === 'tbody tr' ? liveTrs : [])
});
check('改金额后：界面上的合计与占比就地刷新',
  liveTrs[2].querySelector('td[data-col="1"]').innerHTML === '16000'
  && liveTrs[0].querySelector('td[data-col="2"]').innerHTML === '75%'
  && liveTrs[1].querySelector('td[data-col="2"]').innerHTML === '25%',
  liveTrs.map((tr) => tr.querySelectorAll('td[data-col]').map((td) => td.innerHTML).join('|')).join(' / '));
check('改金额后：正文写回重算后的合计与占比',
  state.materials[calcKey].sections[0].body.includes('| 场地与设备 | 12000 | 75% |')
  && state.materials[calcKey].sections[0].body.includes('| 合计 | 16000 | 100% |'), state.materials[calcKey].sections[0].body);
delete state.materials[calcKey];
delete state.project.outputs[calcKey];

/* 非金额表：每行都要有删行按钮，且按钮必须有定位祖先
   （曾经因为 .md-act-col 没有 position，按钮被定位到页面右上角，看起来就是「不能删行」） */
const plainKey = 'runbook';
state.materials[plainKey] = {
  title: '现场执行手册',
  generatedAt: new Date().toISOString(),
  source: 'ai',
  sections: [{ heading: '四、成本控制与审批流程', body: '| 控制点 | 触发条件 | 审批人角色 |\n| --- | --- | --- |\n| 500 元以上 | 采购前 | 负责人 |\n| 场地变更 | 签约前 | 指导老师 |' }]
};
state.project.outputs[plainKey] = true;
state.ui.materialPhase = 'all';
state.ui.openMaterial = plainKey;
window.WB.views.material.render();
const plainHtml = document.querySelector('#materialList').innerHTML;
check('非金额表：每一行都有删行按钮，且不出现发票列',
  (plainHtml.match(/data-material-row-remove/g) || []).length === 2 && !plainHtml.includes('md-invoice-head'),
  `${(plainHtml.match(/data-material-row-remove/g) || []).length} 个按钮`);
check('非金额表：表头留出操作列并给出删行提示',
  plainHtml.includes('<th class="md-act-col"></th>') && plainHtml.includes('悬停行尾的 × 可删除该行'));
check('删行按钮有定位祖先（.md-act-col 必须 positioned）',
  /\.md-act-col \{[^}]*position: relative/.test(fs.readFileSync(path.join(root, 'styles.css'), 'utf8')));
delete state.materials[plainKey];
delete state.project.outputs[plainKey];
state.ui.openMaterial = null;

const totRowsBefore = MD.parseBlocks(totDoc.sections[0].body)[0].rows.length;
window.WB.views.material.removeRow(totKey, 0, 0, 2);
check('删除「合计」行被拒绝',
  MD.parseBlocks(totDoc.sections[0].body)[0].rows.length === totRowsBefore, totDoc.sections[0].body);

window.WB.views.material.addRow(totKey, 0, 0);
const totAdded = MD.parseBlocks(totDoc.sections[0].body)[0];
check('加行插在合计行上方，合计仍在最后一行',
  totAdded.rows.length === 4 && X.isTotalRow(totAdded.rows[3]), totDoc.sections[0].body);
check('加行后合计重新求和（空行按 0 计，仍 10000）', totAdded.rows[3][1] === '10000', totAdded.rows[3][1]);

window.WB.views.material.commitTable({
  dataset: { materialBlock: totKey, sectionIndex: '0', blockIndex: '0' },
  querySelector: (selector) => (selector === 'thead tr'
    ? { querySelectorAll: () => [fakeCell('科目'), fakeCell('金额')] } : null),
  querySelectorAll: (selector) => (selector === 'tbody tr'
    ? [fakeRow([fakeCell('场地'), fakeCell('6000')]), fakeRow([fakeCell('物料'), fakeCell('9000')]),
      fakeRow([fakeCell(''), fakeCell('')]), fakeRow([fakeCell('合计'), fakeCell('10000')])]
    : [])
});
const totCommitted = MD.parseBlocks(totDoc.sections[0].body)[0];
check('改一格后合计自动重算（6000 + 9000 = 15000）', totCommitted.rows[3][1] === '15000', totDoc.sections[0].body);
check('同一张表的其它改动照旧写回（4000 → 9000）', totCommitted.rows[1][1] === '9000');

/* 导出以重算值为准：正文里写错的合计会在成品里被纠正 */
const staleDoc = {
  title: '合计测试｜经费决算表',
  sections: [{ heading: '一、决算明细', body: '| 科目 | 金额 |\n| --- | ---: |\n| 场地 | 6000 |\n| 物料 | 4000 |\n| 合计 | 1 |' }]
};
const staleSheet = new TextDecoder().decode(OX.readEntries(X.materialToXlsx(staleDoc)).find((part) => part.name === 'xl/worksheets/sheet1.xml').data);
check('导出 Excel：正文里写错的合计被重算为 10000', staleSheet.includes('10000'), staleSheet.slice(0, 160));
const staleWord = new TextDecoder().decode(OX.readEntries(X.materialToDocx(staleDoc)).find((part) => part.name === 'word/document.xml').data);
check('导出 Word：正文里写错的合计被重算为 10000', staleWord.includes('10000'));

delete state.materials[totKey];
delete state.project.outputs[totKey];
state.ui.openMaterial = null;
/* 收尾：把合成材料与身份收干净，避免影响后续用例 */
delete state.materials[invDocKey];
delete state.project.outputs[invDocKey];
state.ui.openMaterial = null;
if (savedUser) store.setUser(savedUser); else store.signOut();
window.WB.views.material.render();

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
  'resources', 'drills', 'material', 'assets', 'signup', 'help'];
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

/* ── 10b. 填写路线图：步骤、完成状态与顶栏引导 ──
   引导的每一步都不靠「用户点过」，而是从项目数据推断，所以这里故意把数据清空再逐项加回去。 */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.project.basic = {};
store.state.wbs = [];
store.state.risks = [];
store.state.resources = [];
store.state.assets = [];
store.state.materials = {};
store.state.references = {};
store.state.fillDrafts = {};
for (const key of Object.keys(store.state.project.outputs)) delete store.state.project.outputs[key];
const guideAPI = window.WB.guide;
check('填写路线图已导出（steps / progress / current）',
  typeof guideAPI?.steps === 'function' && typeof guideAPI?.progress === 'function' && typeof guideAPI?.current === 'function');
const emptyGuide = guideAPI.progress(store.state);
check('填写路线图：每一步都带说明、按钮文案与有效跳转目标',
  emptyGuide.steps.length >= 6
  && emptyGuide.steps.every((step) => step.title && step.why && step.cta && step.detail && VIEW_ID_SET.has(step.target.view)),
  emptyGuide.steps.map((step) => step.target.view).join(','));
check('填写路线图：空项目时 0 完成、停在第一步，可选步骤不计入总数',
  emptyGuide.done === 0 && emptyGuide.current?.id === 'basic'
  && emptyGuide.total === emptyGuide.steps.filter((step) => !step.optional).length
  && emptyGuide.steps.some((step) => step.optional));
store.state.project.basic = { type: '科技文化节', name: '路线图测试', date: '2026-11-08' };
const step1Guide = guideAPI.progress(store.state);
check('填写路线图：填上必填项后第一步自动完成、当前步前进到「勾选产出」',
  step1Guide.steps.find((step) => step.id === 'basic').status === 'done' && step1Guide.current?.id === 'outputs');
store.state.project.outputs.proposal = true;
store.state.wbs = ['plan', 'prepare', 'execute', 'close'].map((phase) => store.normaliseRow({ phase, task: `任务-${phase}` }));
const step3Guide = guideAPI.progress(store.state);
check('填写路线图：勾产出 + 任务分解一到位，状态就跟着前进',
  step3Guide.steps.find((step) => step.id === 'outputs').status === 'done'
  && step3Guide.steps.find((step) => step.id === 'wbs').status === 'done'
  && step3Guide.current?.id === 'risk');
window.WB.renderTopbar();
const guideChip = document.getElementById('guideChip');
let chipTarget = null;
try { chipTarget = JSON.parse(guideChip.dataset.guideTarget || 'null'); } catch (error) { chipTarget = null; }
check('顶栏引导按钮给出「下一步」文案', guideChip.innerHTML.includes('下一步') && guideChip.innerHTML.includes('风险'));
check('顶栏引导按钮带可解析、可跳转的目标',
  Boolean(chipTarget) && VIEW_ID_SET.has(chipTarget.view) && window.WB.gotoTarget(chipTarget) === true);

/* ── 10c. 二维码（自实现）：容量、功能图案格数、格式/版本信息、纠错码与独立解码往返 ──
   解码器是照标准另写的一份：功能区域、蛇形填位、反交错、RS 校验都不复用 core/qr.js，
   所以「编码 → 解码 → 原文一致」同时证明了布局、掩码、交错与纠错码都写对了。 */
const QR = window.WB.qr;
check('二维码模块已导出（encode / svg / pngDataUrl）',
  typeof QR?.encode === 'function' && typeof QR?.svg === 'function' && typeof QR?.pngDataUrl === 'function');
check('二维码容量上限 = 122 字节（纠错等级 M、版本 7 封顶）',
  QR.MAX_BYTES === 122 && QR.MAX_VERSION === 7, `${QR.MAX_BYTES}/${QR.MAX_VERSION}`);
QR.VERSIONS.forEach((info, index) => {
  check(`二维码 v${index + 1} 版本表自洽（分块 × 每块码字 = 总码字）`,
    info.blocks * (info.data / info.blocks + info.ec) === info.total,
    `${info.blocks}×(${info.data / info.blocks}+${info.ec}) ≠ ${info.total}`);
});
check('纠错等级 M 的格式信息 M/0 = 0x5412（标准值）', QR.formatBits(0) === 0x5412, QR.formatBits(0).toString(16));
const qrBchOk = (bits) => {
  let rem = bits ^ 0x5412;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  return rem === 0;
};
check('8 个掩码的格式信息都通过 BCH 自检',
  Array.from({ length: 8 }, (_, mask) => qrBchOk(QR.formatBits(mask))).every(Boolean));
{
  let rem = 7;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) ? 0x1f25 : 0);
  check('二维码 v7 版本信息 = 0x07C94（标准值）', ((7 << 12) | rem) === 0x07c94, ((7 << 12) | rem).toString(16));
}
/* 照标准重画一遍功能图案：剩下的数据格数必须恰好等于 数据位 + 剩余位 */
const QR_ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38]];
function qrFunctionMap(version) {
  const size = version * 4 + 17;
  const fn = new Set();
  const add = (row, col) => { if (row >= 0 && col >= 0 && row < size && col < size) fn.add(row * size + col); };
  for (const [row0, col0] of [[0, 0], [0, size - 7], [size - 7, 0]])
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) add(row0 + dr, col0 + dc);
  for (let i = 8; i <= size - 9; i++) { add(6, i); add(i, 6); }
  for (const row of QR_ALIGN[version - 1]) for (const col of QR_ALIGN[version - 1]) {
    if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) add(row + dr, col + dc);
  }
  if (version >= 7) for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    add(b, a); add(a, b);
  }
  for (let i = 0; i <= 5; i++) add(i, 8);
  add(7, 8); add(8, 8); add(8, 7);
  for (let i = 9; i < 15; i++) add(8, 14 - i);
  for (let i = 0; i < 8; i++) add(8, size - 1 - i);
  for (let i = 8; i < 15; i++) add(size - 15 + i, 8);
  add(size - 8, 8);
  return fn;
}
for (let version = 1; version <= QR.MAX_VERSION; version++) {
  const code = QR.encode('a'.repeat(QR.maxBytes(version)));
  check(`二维码 v${version} 数据区格数 = 数据位 + 剩余位`,
    code.base.free === code.base.totalBits, `${code.base.free} vs ${code.base.totalBits}`);
}
/* GF(256) 与独立解码器 */
const QR_EXP = new Uint8Array(512);
const QR_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i++) { QR_EXP[i] = value; QR_LOG[value] = i; value <<= 1; if (value & 0x100) value ^= 0x11d; }
  for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255];
}
const qrMul = (a, b) => (a === 0 || b === 0 ? 0 : QR_EXP[QR_LOG[a] + QR_LOG[b]]);
function qrDecode(code) {
  const size = code.size;
  const version = (size - 17) / 4;
  const at = (row, col) => code.modules[row * size + col] === 1;
  /* 读回来的是原始位（还没去掩码）：qrBchOk 自己会异或 0x5412，别在这里重复一次 */
  const readCopy = (list) => {
    let bits = 0;
    list.forEach(([row, col], index) => { if (at(row, col)) bits |= 1 << index; });
    return bits;
  };
  const copy1 = [];
  for (let i = 0; i <= 5; i++) copy1.push([i, 8]);
  copy1.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) copy1.push([8, 14 - i]);
  const copy2 = [];
  for (let i = 0; i < 8; i++) copy2.push([8, size - 1 - i]);
  for (let i = 8; i < 15; i++) copy2.push([size - 15 + i, 8]);
  const first = readCopy(copy1);
  const second = readCopy(copy2);
  if (first !== second || !qrBchOk(first)) return null;
  const mask = (first ^ 0x5412) >>> 10;
  const fn = qrFunctionMap(version);
  const info = QR.VERSIONS[version - 1];
  const total = info.total;
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = upward ? size - 1 - vert : vert;
        if (fn.has(row * size + col)) continue;
        let bit = at(row, col);
        if (QR.maskAt(mask, row, col)) bit = !bit;
        bits.push(bit ? 1 : 0);
      }
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
    words.push(value);
  }
  if (words.length !== total) return null;
  const perBlock = info.data / info.blocks;
  const dataBlocks = Array.from({ length: info.blocks }, () => []);
  let cursor = 0;
  for (let i = 0; i < perBlock; i++) for (const block of dataBlocks) block.push(words[cursor++]);
  const ecBlocks = Array.from({ length: info.blocks }, () => []);
  for (let i = 0; i < info.ec; i++) for (const block of ecBlocks) block.push(words[cursor++]);
  const syndromeFree = (block) => {
    for (let i = 0; i < info.ec; i++) {
      let sum = 0;
      for (const word of block) sum = qrMul(sum, QR_EXP[i]) ^ word;
      if (sum !== 0) return false;
    }
    return true;
  };
  for (let b = 0; b < info.blocks; b++) if (!syndromeFree([...dataBlocks[b], ...ecBlocks[b]])) return null;
  const payload = dataBlocks.flat();
  const mode = payload[0] >> 4;
  const length = ((payload[0] & 0x0f) << 4) | (payload[1] >> 4);
  if (mode !== 4) return null;
  const bytes = [];
  let bitPos = 12;
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (let j = 0; j < 8; j++) {
      const index = bitPos + j;
      value = (value << 1) | ((payload[index >> 3] >>> (7 - (index & 7))) & 1);
    }
    bytes.push(value);
    bitPos += 8;
  }
  return { version, mask, text: new TextDecoder().decode(Uint8Array.from(bytes)) };
}
const qrSamples = [
  'http://127.0.0.1:4175/signup.html#p=proj-m1abc2-d3e4f&d=UzF8',
  'HELLO',
  '姓名,1;学号*,1;班级;手机,p,1;备注,m',
  '活动参与者信息收集 · 扫码填写 · 校内小活动',
  'R1|s|k3f9q1|t3uwow|hhxn|张三|20230101|一班|13800001111'
];
qrSamples.forEach((text) => {
  const code = QR.encode(text);
  check(`二维码可编码：${text.slice(0, 20)}`, Boolean(code), `${QR.byteLength(text)} 字节`);
  if (!code) return;
  const out = qrDecode(code);
  check(`二维码往返解码一致：${text.slice(0, 20)}`, Boolean(out) && out.text === text, out ? out.text.slice(0, 30) : '解码失败');
  check(`二维码掩码号与格式信息一致：v${code.version}`, Boolean(out) && out.mask === code.mask);
});
for (let version = 1; version <= QR.MAX_VERSION; version++) {
  const payload = 'z'.repeat(QR.maxBytes(version));
  const code = QR.encode(payload);
  check(`二维码 v${version} 恰好装满仍可往返`, Boolean(code) && code.version === version && qrDecode(code)?.text === payload);
}
check('二维码超长返回 null 而不是截断', QR.encode('x'.repeat(QR.MAX_BYTES + 1)) === null);
check('二维码按 UTF-8 计字节（姓名 = 6 字节）', QR.byteLength('姓名') === 6, `${QR.byteLength('姓名')}`);
check('二维码 SVG 结构完整', /^<svg xmlns=.*viewBox="0 0 \d+ \d+".*<\/svg>$/.test(QR.svg('HELLO') || ''));
check('无 canvas 环境下 pngDataUrl 返回 null 而不是抛错', QR.pngDataUrl('HELLO') === null);

/* ── 10d. 参与者信息收集：字段预设、表单码、链接容量与降级、回执码、队列折叠、去重与导出 ── */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
const SG = window.WB.signup;
check('参与者模块已导出（fresh / linkFor / mergeEvents / toCsv）',
  typeof SG?.fresh === 'function' && typeof SG?.linkFor === 'function'
  && typeof SG?.mergeEvents === 'function' && typeof SG?.toCsv === 'function');
check('参与者视图已注册且带上限常量', Boolean(window.WB.views.signup?.render) && SG.MAX_FIELDS === 12);
check('四套字段预设齐全', SG.PRESETS.map((item) => item.id).join('|') === 'minimal|signup|checkin|feedback',
  SG.PRESETS.map((item) => item.id).join('|'));
check('示例项目自带参与者收集演示数据',
  store.state.signup.enabled && store.state.signup.records.length >= 4,
  JSON.stringify({ enabled: store.state.signup.enabled, records: store.state.signup.records.length }));
const sgSampleTally = SG.stats(store.state.signup);
check('示例项目的参与者数据含签到与重复报名',
  sgSampleTally.checkins >= 2 && sgSampleTally.dupeValues >= 1,
  JSON.stringify({ checkins: sgSampleTally.checkins, dupes: sgSampleTally.dupeValues }));
check('参与者信息随项目包往返', (() => {
  const pack = store.exportBundle();
  const before = JSON.stringify(pack.signup);
  store.importBundle(JSON.parse(JSON.stringify(pack)));
  return JSON.stringify(store.state.signup) === before && store.state.signup.records.length >= 4;
})());

const sgMin = SG.fresh({ preset: 'minimal', enabled: true });
check('最小信息预设 = 5 个字段', sgMin.fields.length === 5, `${sgMin.fields.length}`);
check('最小信息预设的必填 = 姓名 / 学号 / 手机',
  sgMin.fields.filter((field) => field.required).map((field) => field.label).join('/') === '姓名/学号/手机');
check('预设的去重字段指向学号', SG.fieldByLabel(sgMin, '学号')?.id === sgMin.keyField);
check('字段可增删与排序', (() => {
  const probe = SG.fresh({ preset: 'minimal' });
  SG.addField(probe, { label: '年级' });
  const okAdd = probe.fields.length === 6 && probe.fields[5].label === '年级';
  const okMove = SG.moveField(probe, 5, -1) && probe.fields[4].label === '年级' && probe.preset === 'custom';
  const okRemove = SG.removeField(probe, 4) && probe.fields.length === 5;
  return okAdd && okMove && okRemove;
})());
check('字段数量超出上限时拒绝新增', (() => {
  const probe = SG.fresh({ preset: 'minimal' });
  while (SG.addField(probe, { label: '更多' })) { /* 填到上限 */ }
  return probe.fields.length === SG.MAX_FIELDS && SG.addField(probe, { label: '过量' }) === null;
})());

const sgCode = SG.packSchema(sgMin);
check('表单码带版本前缀', sgCode.startsWith('S1|'), sgCode);
check('表单码用 * 标记去重字段（省字节）', sgCode.includes('学号*,1'), sgCode);
check('表单码往返：字段名与顺序', SG.unpackSchema(sgCode)?.fields.map((field) => field.label).join('/') === '姓名/学号/班级/手机/备注');
check('表单码往返：类型与必填',
  SG.unpackSchema(sgCode)?.fields.map((field) => field.type).join('/') === 'text/text/text/phone/textarea'
  && SG.unpackSchema(sgCode)?.fields.filter((field) => field.required).length === 3);
check('表单码往返：去重字段', SG.fieldByLabel(SG.unpackSchema(sgCode), '学号')?.id === SG.unpackSchema(sgCode).keyField);
check('表单码往返：选项按 / 分隔',
  (() => {
    const probe = SG.fresh({ preset: 'signup' });
    const back = SG.unpackSchema(SG.packSchema(probe));
    const field = back.fields.find((item) => item.label === '报名项目');
    return Boolean(field) && field.options.join('/') === '主舞台/互动展位/志愿服务/观众';
  })());
check('base64url 与百分号编码的表单码都能解',
  Boolean(SG.unpackSchema(SG.encodeBase64Url(sgCode))) && Boolean(SG.unpackSchema(encodeURIComponent(SG.encodeBase64Url(sgCode)))));
check('缺版本前缀 / 无关文字判为无效表单码',
  SG.unpackSchema('姓名,1;学号,1') === null && SG.unpackSchema('不太像表单码') === null && SG.unpackSchema('') === null);
check('表单指纹随字段结构变化', SG.fingerprint(sgMin) !== SG.fingerprint(SG.fresh({ preset: 'feedback' }))
  && /^[0-9a-z]{4}$/.test(SG.fingerprint(sgMin)));

const sgLink = SG.linkFor(sgMin, 'proj-demo', 'http://127.0.0.1:4175');
check('最小预设的链接装得进二维码（含表单定义）',
  sgLink.fits && sgLink.level === 'full' && sgLink.bytes <= sgLink.limit, `${sgLink.bytes}/${sgLink.limit}`);
check('链接含项目号与表单码', sgLink.url.includes('p=proj-demo') && sgLink.url.includes('&d='));
check('链接真的能编成二维码', Boolean(QR.encode(sgLink.url)));
check('填写页地址固定为 signup.html', SG.pageUrl('http://127.0.0.1:4175/').endsWith('/signup.html'));
check('填写页地址容忍三种写法，不会拼成 signup.html/signup.html', (() => {
  const forms = ['http://h:1', 'http://h:1/', 'http://h:1/signup.html'];
  const urls = forms.map((base) => SG.pageUrl(base));
  return urls[0] === 'http://h:1/signup.html' && urls[1] === urls[0] && urls[2] === urls[0]
    && SG.pageUrl('https://h/demo2/') === 'https://h/demo2/signup.html'
    && SG.pageUrl('https://h/demo2/signup.html') === 'https://h/demo2/signup.html';
})());
check('访问地址留空就跟着当前网址走（换端口 / 静态托管子目录都不用改）', (() => {
  globalThis.location = { origin: 'https://me.pages.dev', pathname: '/demo2/index.html' };
  try { return SG.pageUrl('') === 'https://me.pages.dev/demo2/signup.html'; }
  finally { delete globalThis.location; }
})());
check('示例项目不带写死的访问地址（本机 / 局域网 / 静态托管都能直接生成二维码）',
  sample.signup.base === '' && SG.normalise(sample.signup).base === '');
check('自定义标题下二维码会走降级档位', (() => {
  const heavy = SG.fresh({ preset: 'signup', enabled: true, title: '诗韵秋兴 · 雅集启翔参与者信息登记表', note: '请如实填写，仅用于本次活动签到与必要联系，活动结束后删除。' });
  const link = SG.linkFor(heavy, 'proj-demo', 'http://127.0.0.1:4175');
  return !link.fits ? link.level === 'none' && Boolean(SG.unpackSchema(link.code)) : QR.fits(link.url);
})());

const sgEvent = { kind: 'submit', id: 'r1a2b3', at: 1760000000000, h: SG.fingerprint(sgMin), values: ['张三', '20230101', '一班', '13800001111', '带竖线|的备注'] };
const sgReceipt = SG.packReceipt(sgEvent);
check('回执码以 R1 开头且可解析', sgReceipt.startsWith('R1|') && SG.parseReceipt(sgReceipt)?.id === 'r1a2b3');
check('回执码保留秒级时间', Math.abs(SG.parseReceipt(sgReceipt).at - 1760000000000) <= 999, `${SG.parseReceipt(sgReceipt).at}`);
check('回执码转义竖线后仍逐字还原',
  SG.parseReceipt(sgReceipt).values.join('|') === sgEvent.values.join('|'), SG.parseReceipt(sgReceipt).values.join('|'));
check('坏回执码返回 null', SG.parseReceipt('hello world') === null && SG.parseReceipt('') === null);
const sgMerged = SG.mergeEvents(sgMin, [sgReceipt]);
check('折入一条提交并按字段 id 落库',
  sgMerged.added === 1 && sgMin.records.length === 1 && sgMin.records[0].values[sgMin.fields[0].id] === '张三');
check('重复导入同一条不会翻倍', (() => {
  const again = SG.mergeEvents(sgMin, [sgReceipt]);
  return again.added === 0 && again.updated === 1 && sgMin.records.length === 1;
})());
check('签到事件落到对应记录', SG.mergeEvents(sgMin, [{ kind: 'checkin', id: 'r1a2b3', at: 1760003600000 }]).checkin === 1
  && sgMin.records[0].checkinAt === 1760003600000);
check('找不到记录的签到被忽略', (() => {
  const result = SG.mergeEvents(sgMin, [{ kind: 'checkin', id: 'nope', at: Date.now() }]);
  return result.ignored === 1 && result.checkin === 0;
})());
check('现场补登与勾选签到可用',
  (() => {
    const probe = SG.fresh({ preset: 'minimal', enabled: true });
    const record = SG.addRecord(probe, ['李四', '20230102', '二班', '13800002222', ''], 'manual');
    const okToggle = SG.toggleCheckin(probe, record.id);
    return probe.records.length === 1 && record.source === 'manual' && okToggle && probe.records[0].checkinAt > 0;
  })());
check('删除记录可用', (() => {
  const probe = SG.fresh({ preset: 'minimal', enabled: true });
  const record = SG.addRecord(probe, ['王五', '20230103', '', '', '']);
  return SG.removeRecord(probe, record.id) && probe.records.length === 0;
})());

/* 队列：同源实时同步靠 append-only，折叠按记录 id 幂等 */
const sgQueueMemory = new Map();
const sgQueueStorage = {
  getItem: (key) => (sgQueueMemory.has(key) ? sgQueueMemory.get(key) : null),
  setItem: (key, value) => sgQueueMemory.set(key, String(value)),
  removeItem: (key) => sgQueueMemory.delete(key)
};
const sgSecond = SG.packReceipt({ kind: 'submit', id: 'r9z', at: 1760000100000, h: SG.fingerprint(sgMin), values: ['李四', '20230102', '二班', '13800002222', ''] });
SG.appendToQueue('proj-q', sgReceipt, sgQueueStorage);
SG.appendToQueue('proj-q', sgSecond, sgQueueStorage);
check('队列按顺序累积', SG.readQueue('proj-q', sgQueueStorage).length === 2);
const sgBoard = SG.fresh({ preset: 'minimal', enabled: true });
const sgSync1 = SG.syncFromQueue(sgBoard, 'proj-q', sgQueueStorage);
check('首次同步折入 2 条并记录水位',
  sgSync1.added === 2 && sgBoard.records.length === 2 && sgBoard.applied === 2, JSON.stringify(sgSync1));
const sgSync2 = SG.syncFromQueue(sgBoard, 'proj-q', sgQueueStorage);
check('再次同步不重复折入', sgSync2.added === 0 && sgSync2.pending === 0 && sgBoard.records.length === 2);
check('清空队列后水位归零可重新同步',
  SG.clearQueue('proj-q', sgQueueStorage) && SG.readQueue('proj-q', sgQueueStorage).length === 0);

/* 统计、去重与导出 */
check('统计口径：总数 / 签到 / 完整率',
  SG.stats(sgBoard).total === 2 && SG.stats(sgBoard).checkins === 0 && SG.stats(sgBoard).complete === 100,
  JSON.stringify(SG.stats(sgBoard)));
check('按去重字段识别重复报名', (() => {
  const probe = SG.fresh({ preset: 'minimal', enabled: true });
  SG.addRecord(probe, ['王五', '20230101', '一班', '', '']);
  SG.addRecord(probe, ['赵六', '20230101', '二班', '', '']);
  return SG.stats(probe).dupeValues === 1 && SG.dupeValues(probe).has('20230101') && SG.stats(probe).dupeRecords === 2;
})());
check('CSV 导出含表头与全部记录', (() => {
  const csv = SG.toCsv(sgBoard).split('\r\n');
  return csv.length === 3 && csv[0].startsWith('序号,提交时间,来源,姓名,学号,班级,手机,备注');
})());
check('Markdown 导出是管道表格', SG.toMarkdown(sgBoard).split('\n')[1].includes('---'));
check('CSV 单元格里的逗号与引号被正确转义',
  SG.toCsv(sgMin).includes('"含逗号,的备注"') === false && SG.toCsv(sgMin).includes('带竖线'));
check('CSV 导入：带表头按表头映射',
  (() => {
    const probe = SG.fresh({ preset: 'minimal', enabled: true });
    const result = SG.parseCsv(probe, '姓名,学号,班级,手机\n孙七,20230103,三班,13800003333\n周八,20230104,四班,13800004444\n');
    return result.added === 2 && probe.records[0].values[probe.fields[0].id] === '孙七'
      && probe.records[0].values[probe.fields[3].id] === '13800003333';
  })());
check('CSV 导入：无表头按列顺序读入',
  (() => {
    const probe = SG.fresh({ preset: 'minimal', enabled: true });
    return SG.parseCsv(probe, '吴九,20230105,五班,13800005555\n').added === 1
      && probe.records[0].values[probe.fields[1].id] === '20230105';
  })());
check('AI 上下文带真实份数、字段定义与样例记录', (() => {
  const context = SG.contextFor(sgBoard);
  return context.已收到份数 === 2 && context.字段定义.length === 5 && context.记录样例.length === 2;
})());
check('未启用时不向 AI 暴露参与者信息', SG.contextFor({ enabled: false }) === '未启用');
check('表单结构变了会给记录打标记', (() => {
  const probe = SG.fresh({ preset: 'minimal', enabled: true });
  probe.fields = probe.fields.slice(0, 3);
  SG.mergeEvents(probe, [sgReceipt]);
  return probe.records[0].schemaChanged === true;
})());
check('同源存储的表单可读回（短链接也能打开正式表单）', (() => {
  SG.storeForm(sgMin, 'proj-q', sgQueueStorage);
  return SG.readStoredForm('proj-q', sgQueueStorage)?.fields.map((field) => field.label).join('/') === '姓名/学号/班级/手机/备注';
})());
check('链接没带项目号时，靠本机唯一那份已存表单定位项目（多份就不猜）', (() => {
  const memory = new Map();
  const store = {
    get length() { return memory.size; },
    key: (index) => [...memory.keys()][index] ?? null,
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key)
  };
  const none = SG.soleStoredProjectId(store);
  store.setItem(SG.formKey('proj-solo'), '{}');
  const one = SG.soleStoredProjectId(store);
  store.setItem('demo2-signup-queue-proj-solo', '[]');
  const withQueue = SG.soleStoredProjectId(store);
  store.setItem(SG.formKey('proj-other'), '{}');
  const two = SG.soleStoredProjectId(store);
  return none === '' && one === 'proj-solo' && withQueue === 'proj-solo' && two === '';
})());

/* 与编排层接线：路线图可选步骤、材料上下文、视图渲染 */
check('填写路线图有「可选」的参与者步骤且目标合法',
  window.WB.guide.STEPS.some((step) => step.id === 'signup' && step.optional && VIEW_ID_SET.has(step.target.view)));
check('材料生成的上下文里带上了参与者信息', (() => {
  const context = window.WB.views.material.fillContext('attendance');
  return context && context.参与者信息收集 && context.参与者信息收集.已收到份数 >= 4;
})());
store.state.signup = SG.fresh({ preset: 'minimal', enabled: true });
window.WB.views.signup.render();
check('参与者视图能渲染出字段设计器与开启入口', document.getElementById('signupBody').innerHTML.includes('data-signup-preset'));
/* 示例项目的访问地址留空，得先给个 location 才会按「当前网址」推出链接。
   顺带把 122 字节这个边界钉住：刚好够时带项目号，再长一点就只剩表单定义 + 界面提示。 */
check('项目号装得下时二维码照常显示（示例项目实测正好卡在 122 字节）', (() => {
  globalThis.location = { origin: 'http://127.0.0.1:4175', pathname: '/index.html' };
  try {
    store.state.signup = SG.normalise(sample.signup);
    window.WB.views.signup.render();
    const body = document.getElementById('signupBody').innerHTML;
    const link = SG.linkFor(store.state.signup, store.state.activeId, store.state.signup.base);
    return link.fits && link.withId === true && body.includes('signup-qr') && !body.includes('放不下项目号');
  } finally {
    delete globalThis.location;
  }
})(), '示例项目的表单 + 项目号超出了 122 字节');
check('链接放不下项目号时，界面写明手机端要走回执码', (() => {
  globalThis.location = { origin: 'http://127.0.0.1:4175', pathname: '/index.html' };
  const savedId = store.state.activeId;
  try {
    store.state.signup = SG.normalise(sample.signup);
    store.state.activeId = 'proj-' + 'x'.repeat(24);
    window.WB.views.signup.render();
    const body = document.getElementById('signupBody').innerHTML;
    const link = SG.linkFor(store.state.signup, store.state.activeId, store.state.signup.base);
    return link.fits && link.withId === false && body.includes('放不下项目号') && body.includes('回执码');
  } finally {
    store.state.activeId = savedId;
    delete globalThis.location;
  }
})());
store.state.signup = SG.fresh({ preset: 'minimal', enabled: false });
window.WB.views.signup.render();
check('关闭状态只显示说明不显示字段表',
  !document.getElementById('signupBody').innerHTML.includes('data-signup-field')
  && document.getElementById('signupBody').innerHTML.includes('data-signup-enable'));

/* ── 10e. 独立填写页：渲染 → 校验 → 提交 → 签到 → 修改 → 再填一位 ──
   这一页要能被手机单独打开，所以单独跑一遍：给它一个最小 DOM，走真实的事件路径。 */
const pageHtml = fs.readFileSync(path.join(root, 'signup.html'), 'utf8');
check('填写页按顺序加载 core/qr.js 与 core/signup.js',
  /<script src="\.\/core\/qr\.js"><\/script>[\s\S]*<script src="\.\/core\/signup\.js"><\/script>/.test(pageHtml));
const pageSrc = [...pageHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()?.[1] || '';
check('填写页内联脚本可编译', (() => {
  try { new Function(pageSrc); return true; } catch (error) { return false; }
})());
function pageNode(tag = 'div', id = '') {
  const listeners = {};
  const classes = new Set();
  return {
    tagName: tag, id, value: '', textContent: '', innerHTML: '', checked: false, title: '',
    dataset: {}, style: {}, parentNode: null,
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name), toggle: (name, force) => (force ? classes.add(name) : classes.delete(name))
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    emit: (type, event) => { for (const fn of [...(listeners[type] || [])]) fn(event || { preventDefault() {} }); },
    hasListener: (type) => Boolean((listeners[type] || []).length),
    scrollIntoView: () => {}, select: () => {}, remove: () => {},
    setAttribute: (key, value) => { if (key === 'title') { this.title = value; } },
    appendChild: () => {}, insertBefore: () => {},
    querySelector: () => null, querySelectorAll: () => []
  };
}
function pageDocument() {
  const byId = new Map();
  const app = pageNode('div', 'app');
  byId.set('app', app);
  return {
    app,
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, pageNode('div', id)); return byId.get(id); },
    createElement: (tag) => pageNode(tag),
    querySelector: () => null, querySelectorAll: () => [],
    head: pageNode('head'), body: pageNode('body'), documentElement: pageNode('html')
  };
}
/* 把表单字段接到可控的假节点上，便于注入填写值 */
const pageFields = [];
function attachPageFields(doc) {
  doc.app.querySelector = (selector) => {
    const field = /^\[data-field="(\d+)"\]$/.exec(selector);
    if (field) {
      const index = Number(field[1]);
      const node = doc.getElementById(`pfield-${index}`);
      node.value = pageFields[index] == null ? '' : pageFields[index];
      return node;
    }
    const row = /^\[data-row="(\d+)"\]$/.exec(selector);
    if (row) return doc.getElementById(`prow-${row[1]}`);
    const err = /^\[data-err="(\d+)"\]$/.exec(selector);
    if (err) return doc.getElementById(`perr-${err[1]}`);
    return null;
  };
  doc.app.querySelectorAll = (selector) => {
    if (selector === '.field' || selector === '.field.is-bad') return [];
    if (selector === '.err') return pageFields.map((_, index) => doc.getElementById(`perr-${index}`));
    return [];
  };
}
const pageMemory = new Map();
const pageStorage = {
  get length() { return pageMemory.size; },
  key: (index) => [...pageMemory.keys()][index] ?? null,
  getItem: (key) => (pageMemory.has(key) ? pageMemory.get(key) : null),
  setItem: (key, value) => pageMemory.set(key, String(value)),
  removeItem: (key) => pageMemory.delete(key)
};
const realDocument = globalThis.document;
const realLocalStorage = globalThis.localStorage;
globalThis.localStorage = pageStorage;
globalThis.alert = () => {};
let pageDoc = null;
const runPage = (hash) => {
  pageDoc = pageDocument();
  globalThis.document = pageDoc;
  globalThis.location = { hash };
  pageFields.length = 0;
  new Function(pageSrc)();
  attachPageFields(pageDoc);
  return pageDoc;
};
const pageLink = SG.linkFor(SG.fresh({ preset: 'minimal', enabled: true }), 'proj-page', 'http://127.0.0.1:4175');
let page = runPage(`#${pageLink.url.split('#')[1]}`);
check('填写页按链接渲染出 5 个字段',
  new Set([...page.app.innerHTML.matchAll(/data-field="(\d+)"/g)].map((match) => match[1])).size === 5);
check('填写页字段名与必填星号来自链接',
  page.app.innerHTML.includes('姓名') && (page.app.innerHTML.match(/<b>\*<\/b>/g) || []).length === 3);
check('填写页说明表单来源', page.app.innerHTML.includes('表单来自二维码/链接'));
check('填写页有表单码粘贴入口', page.app.innerHTML.includes('id="formCode"'));
pageFields.push('', '', '', '', '');
page.getElementById('signupForm').emit('submit');
check('必填缺失时拦住并提示', page.getElementById('perr-0').textContent.includes('需要填写')
  && page.getElementById('prow-0').classList.contains('is-bad') && page.app.innerHTML.includes('id="signupForm"'));
check('必填缺失时不写队列', SG.readQueue('proj-page').length === 0);
pageFields.splice(0, pageFields.length, '张三', '20230101', '一班', '123', '');
page.getElementById('signupForm').emit('submit');
check('手机号格式校验生效', page.getElementById('perr-3').textContent.includes('手机号'));
pageFields.splice(0, pageFields.length, '张三', '20230101', '一班', '13800001111', '帮我留个前排');
page.getElementById('signupForm').emit('submit');
const pageQueue = SG.readQueue('proj-page');
check('提交写入队列并进入成功页', pageQueue.length === 1 && page.app.innerHTML.includes('提交成功'));
check('成功页展示回执码与二维码', page.app.innerHTML.includes('R1|') && page.app.innerHTML.includes('<svg'));
check('回执码内容与填写值一致', SG.parseReceipt(pageQueue[0])?.values[0] === '张三' && SG.parseReceipt(pageQueue[0])?.values[4] === '帮我留个前排');
check('回执码带当前表单指纹', SG.parseReceipt(pageQueue[0])?.h === SG.fingerprint(SG.fresh({ preset: 'minimal', enabled: true })));
check('签到按钮已接线', page.getElementById('checkin').hasListener('click'));
page.getElementById('checkin').emit('click');
check('签到追加一条签到事件', SG.readQueue('proj-page').length === 2
  && SG.parseReceipt(SG.readQueue('proj-page')[1])?.kind === 'checkin'
  && page.app.innerHTML.includes('已提交并签到'));
const pageBoard = SG.fresh({ preset: 'minimal', enabled: true });
const pageSync = SG.syncFromQueue(pageBoard, 'proj-page', pageStorage);
check('工作台侧折叠出 1 条记录 + 1 次签到',
  pageSync.added === 1 && pageSync.checkin === 1 && pageBoard.records.length === 1 && pageBoard.records[0].checkinAt > 0,
  JSON.stringify(pageSync));
check('折叠后的来源标记为扫码填写', pageBoard.records[0].source === 'scan' && !pageBoard.records[0].schemaChanged);
page = runPage(`#${pageLink.url.split('#')[1]}`);
check('重新打开链接显示「已提交」并可修改', page.app.innerHTML.includes('已提交') && page.getElementById('editMine').hasListener('click'));
page.getElementById('editMine').emit('click');
check('点「修改我的信息」回到带原值的表单', page.app.innerHTML.includes('id="signupForm"'));
pageFields.splice(0, pageFields.length, '张三', '20230101', '一班', '13800002222', '换了号码');
page.getElementById('signupForm').emit('submit');
const pageBoard2 = SG.fresh({ preset: 'minimal', enabled: true });
SG.syncFromQueue(pageBoard2, 'proj-page', pageStorage);
check('修改走同一条记录（号码更新且不新增）',
  pageBoard2.records.length === 1 && pageBoard2.records[0].values[pageBoard2.fields[3].id] === '13800002222',
  JSON.stringify(pageBoard2.records.map((record) => record.values)));
page.getElementById('another').emit('click');
check('「再填一位」回到空白表单', page.app.innerHTML.includes('id="signupForm"'));
pageFields.splice(0, pageFields.length, '李四', '20230102', '二班', '13800003333', '');
page.getElementById('signupForm').emit('submit');
const pageBoard3 = SG.fresh({ preset: 'minimal', enabled: true });
SG.syncFromQueue(pageBoard3, 'proj-page', pageStorage);
check('「再填一位」落成第 2 条独立记录',
  pageBoard3.records.length === 2
  && pageBoard3.records.map((record) => record.values[pageBoard3.fields[0].id]).join('/') === '张三/李四',
  pageBoard3.records.map((record) => record.values[pageBoard3.fields[0].id]).join('/'));
page = runPage('#p=proj-page2');
check('链接里没有表单定义时退回通用表单并说明原因',
  page.app.innerHTML.includes('通用最小表单') && page.app.innerHTML.includes('data-field="0"'));
page.getElementById('formCode').value = SG.packSchema(SG.fresh({ preset: 'checkin' }));
page.getElementById('applyCode').emit('click');
check('粘贴表单码后换成签到表单',
  page.app.innerHTML.includes('到场方式') && page.app.innerHTML.includes('表单来自粘贴的表单码'));
page = runPage('#d=不太像表单码');
check('坏表单码退回通用表单而不是空白页', page.app.innerHTML.includes('通用最小表单'));

/* 表单太长放不下 p= 时（链接只有 d=）：本机唯一那份已存表单决定项目号，
   提交要落回项目队列，而不是无人认领的 default 桶 */
pageStorage.setItem(SG.formKey('proj-solo'),
  JSON.stringify({ at: Date.now(), code: SG.packSchema(SG.fresh({ preset: 'minimal', enabled: true }), 'full') }));
const pageFormOnly = SG.packSchema(SG.fresh({ preset: 'minimal', enabled: true }), 'full');
page = runPage(`#d=${SG.encodeBase64Url(pageFormOnly)}`);
check('链接只带表单定义时，靠本机已存表单认出项目并按该项目渲染',
  page.app.innerHTML.includes('id="signupForm"') && !page.app.innerHTML.includes('通用最小表单'));
pageFields.splice(0, pageFields.length, '周八', '20230108', '八班', '13800008888', '');
page.getElementById('signupForm').emit('submit');
check('没带项目号的链接，提交仍落回项目队列（不发到 default 桶）',
  SG.readQueue('proj-solo', pageStorage).length === 1 && SG.readQueue('default', pageStorage).length === 0,
  `proj-solo=${SG.readQueue('proj-solo', pageStorage).length} default=${SG.readQueue('default', pageStorage).length}`);
check('同源提交时成功页仍说「组织者会实时看到」',
  page.app.innerHTML.includes('组织者会实时看到你的信息'));
pageStorage.removeItem(SG.formKey('proj-solo'));
/* ── 10f. 公网 / 局域网开放的安全边界（server.mjs 契约） ──
   默认只听回环；DEMO2_HOST=0.0.0.0 或走 cloudflared 隧道时，非本机请求只能读填写页
   那一小块、只能提交一条回执码；工作台页面与 AI 接口（里面有 API Key）必须始终只
   允许本机——这几条是「手机扫码填写」敢开出去的前提。 */
const serverSrc = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const remoteGetList = (serverSrc.match(/const REMOTE_GET = new Set\(\[([^\]]*)\]\);/ ) || [])[1] || '';
const remotePostList = (serverSrc.match(/const REMOTE_POST = new Set\(\[([^\]]*)\]\);/ ) || [])[1] || '';
check('server.mjs 默认仍只监听回环地址',
  serverSrc.includes("process.env.DEMO2_HOST || '127.0.0.1'") && serverSrc.includes('server.listen(port, host,'));
check('非本机只能读：填写页 + 它加载的两个脚本 + 按短码取表单',
  ['/signup.html', '/core/qr.js', '/core/signup.js', '/api/signup/form'].every((item) => remoteGetList.includes(item)),
  remoteGetList);
check('非本机只能写一条：提交回执码（登记短码与拉增量只对本机开放）',
  remotePostList.includes('/api/signup/submit') && !remotePostList.includes('/api/signup/link')
  && !remotePostList.includes('/api/signup/queue') && !remoteGetList.includes('/api/signup/queue'), remotePostList);
check('AI 接口 / 工作台页面 / 生成图片都不在放行名单里',
  ['/api/structure', '/api/image', '/api/template', '/api/health', '/app.js', '/index.html', '/styles.css', '/generated/']
    .every((item) => !remoteGetList.includes(item) && !remotePostList.includes(item)));
check('隧道 / 反向代理的请求头会被当成「非本机」（否则工作台与 AI 会被一起暴露）',
  ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'].every((header) => serverSrc.includes("req.headers['" + header + "']"))
  && serverSrc.includes('const remote = Boolean(forwarded) || !isLoopback(req.socket?.remoteAddress);'));
check('拦截发生在 /api 与静态分发之前', (() => {
  const guard = serverSrc.indexOf('const remote = Boolean(forwarded)');
  return guard > 0
    && guard < serverSrc.indexOf("url.pathname === '/api/health'")
    && guard < serverSrc.indexOf('const file = path.resolve(here, requested);');
})());
check('提交接口有体积上限、限流与总量上限，且只认 R1| 开头的回执码',
  serverSrc.includes('readBuffer(req, JOIN_BODY_LIMIT)') && serverSrc.includes('submitAllowed(clientIp)')
  && serverSrc.includes('JOIN_MAX_RECORDS') && serverSrc.includes("receipt.startsWith('R1|')")
  && serverSrc.includes('const known = lines.includes(receipt);'));
check('启动日志打印隧道命令与网卡名',
  serverSrc.includes('cloudflared tunnel --url http://127.0.0.1:') && serverSrc.includes('lanAddresses().map(')
  && serverSrc.includes('item.name'));
check('填写页只引用白名单里的那两个脚本（白名单才够用）', (() => {
  const page = fs.readFileSync(path.join(root, 'signup.html'), 'utf8');
  const refs = [...page.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((match) => match[1]);
  return refs.length === 2 && refs.every((ref) => ['core/qr.js', 'core/signup.js'].includes(ref));
})());
check('填写页直传：取表单走 /api/signup/form，提交走 /api/signup/submit，失败仍有回执码兜底', (() => {
  const page = fs.readFileSync(path.join(root, 'signup.html'), 'utf8');
  return page.includes("'/api/signup/submit'") && page.includes('/api/signup/form?p=')
    && page.includes('pushAndReport') && page.includes('loadRemoteSchema');
})());

/* ── 10g. 静态托管打包：清单与页面引用一致，禁品一律拦下 ──
   打包脚本是「发布」那道门：页面加载的每个文件都必须在清单里，
   而 .env / server.mjs / tools / docs 一个都不许被带出去。 */
const packSrc = fs.readFileSync(path.join(root, 'tools/pack-static.mjs'), 'utf8');
const packArray = (name) => {
  const match = packSrc.match(new RegExp('const ' + name + ' = \\[([^\\]]*)\\];'));
  return match ? JSON.parse('[' + match[1].replace(/'/g, '"') + ']') : null;
};
const PACK_CORE = packArray('CORE');
const PACK_VIEWS = packArray('VIEWS');
const packPagesMatch = packSrc.match(/const PAGES = \[([\s\S]*?)\r?\n\];/);
const PACK = packPagesMatch
  ? new Function('CORE', 'VIEWS', 'return [' + packPagesMatch[1] + '];')(PACK_CORE, PACK_VIEWS)
  : null;
check('打包脚本的发布清单能解析出来（CORE / VIEWS / PAGES 三段）',
  Array.isArray(PACK_CORE) && Array.isArray(PACK_VIEWS) && Array.isArray(PACK) && PACK.length >= 30,
  'core=' + PACK_CORE?.length + ' views=' + PACK_VIEWS?.length + ' pages=' + PACK?.length);
const packRefsOf = (file) => [...fs.readFileSync(path.join(root, file), 'utf8')
  .matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((match) => match[1]);
const packNeeds = [...new Set([...packRefsOf('index.html'), ...packRefsOf('signup.html')])];
const packMissing = PACK ? packNeeds.filter((ref) => !PACK.includes(ref)) : packNeeds;
check('index.html / signup.html 加载的每个文件都在发布清单里',
  packMissing.length === 0, '缺 ' + packMissing.join('、'));
check('脚本里 fetch 的示例数据也在发布清单里（发布后「试试示例项目」还能用）',
  !!PACK && ['samples/示例项目-校园科技文化节.json'].every((rel) => PACK.includes(rel)));
const packAbsent = PACK ? PACK.filter((rel) => !fs.existsSync(path.join(root, rel))) : ['清单没解析出来'];
check('发布清单里的文件都真实存在', packAbsent.length === 0, packAbsent.join('、'));
check('发布清单不含 .env / server.mjs / tools / docs / generated',
  !!PACK && PACK.every((rel) => !/\.env|server\.mjs|^tools\/|^docs\/|^generated\//.test(rel)));
check('打包脚本自带禁品名单与源码目录黑名单',
  packSrc.includes("'.env', 'server.mjs', 'tools/', 'docs/'")
  && packSrc.includes("'generated/'") && packSrc.includes('const SOURCE_DIRS = '));
check('打包脚本拒绝把产物写回项目本身、源码子目录或项目上级',
  packSrc.includes('输出目录不能就是 demo2 本身')
  && packSrc.includes('输出目录不要放在') && packSrc.includes('输出目录不能是 demo2 的上级目录'));
check('打包脚本默认写进 dist/，逐项清掉上次的残留，并把「产物与清单不一致」当失败',
  packSrc.includes("valueOf('--out') || 'dist'") && packSrc.includes('fs.unlinkSync(target)')
  && packSrc.includes('fs.rmdirSync(target)') && packSrc.includes('产物里混进了清单之外的文件'));
check('打包脚本拷完会复查页面引用，并声明不含 .env',
  packSrc.includes('产物里都在') && packSrc.includes('不含 .env、server.mjs、tools/、docs/'));

/* ── 10h. 手机直传：短码链接 + 按游标合并 ──
   隧道域名（xxx.trycloudflare.com）比局域网 IP 长，老写法把表单定义塞进二维码会装不下；
   短码模式只带 4 位码，表单定义由本机服务按码提供。手机提交的回执码按行落盘，
   工作台按 since 游标拉回来，折进表格走的还是 mergeEvents（按记录 id 幂等）。 */
/* 页面测试到此为止，先把浏览器环境换回来：下面第一处 await 会让事件循环跑起来，
   boot 时那次「AI 在不在」的续跑会顺手重绘任务视图，还拿着页面用的精简 DOM 就会找不到 #wbsSummary。 */
globalThis.document = realDocument;
globalThis.localStorage = realLocalStorage;
globalThis.location = { origin: 'http://127.0.0.1:4175', pathname: '/index.html' };
const joinSignup = SG.normalise(sample.signup);
const tunnelBase = 'https://calm-sunset-a1b2.trycloudflare.com';
const shortLink = SG.linkFor(joinSignup, 'k7f2', tunnelBase, { short: true });
check('短码模式：二维码只带 4 位短码，长隧道域名也装得下',
  shortLink.fits === true && shortLink.level === 'short' && shortLink.url.endsWith('#p=k7f2') && shortLink.url.indexOf('d=') < 0,
  shortLink.bytes + '/' + shortLink.limit + ' ' + shortLink.url);
/* 老写法的降级梯子：链接里既要真实项目号又要表单定义，长隧道域名下塞不下，
   只能丢掉项目号、把表单压成精简版才塞得进去——这正是短码模式要解决的问题。 */
const plainLink = SG.linkFor(joinSignup, 'proj-m3k9x2a1-b7c2d', tunnelBase);
check('同一个隧道域名下，老写法要丢掉项目号、降级表单才塞得进二维码',
  plainLink.fits === true && plainLink.withId === false && plainLink.level !== 'full',
  plainLink.bytes + '/' + plainLink.limit + ' ' + plainLink.level);
check('短码登记与拉增量都挂在视图上，供工作台调用',
  typeof window.WB.views.signup.registerLink === 'function' && typeof window.WB.views.signup.pullServer === 'function');

const joinBackup = JSON.parse(JSON.stringify(store.state.signup));
const fetchBackup = globalThis.fetch;
store.state.signup = SG.normalise(sample.signup);
store.state.signup.enabled = true;
store.state.signup.linkCode = 'k7f2';
store.state.signup.serverCursor = 0;
const joinValues = store.state.signup.fields.map((field, index) => '填值' + (index + 1));
const joinReceipt = SG.packReceipt({ kind: 'submit', id: 'rec-join-1', at: Date.now(), h: SG.fingerprint(store.state.signup), values: joinValues });
let joinCalls = 0;
let joinUrl = '';
globalThis.fetch = async (url) => {
  joinUrl = String(url);
  if (joinUrl.indexOf('/api/signup/queue') >= 0) {
    joinCalls += 1;
    return { ok: true, json: async () => ({ ok: true, total: 1, records: [joinReceipt] }) };
  }
  return { ok: false, json: async () => ({}) };
};
const joinMerged = await window.WB.views.signup.pullServer({ render: false });
check('手机直传：拉回来的回执码折进表格，来源标成「填写页」',
  Boolean(joinMerged) && joinMerged.added === 1
  && store.state.signup.records.some((record) => record.id === 'rec-join-1' && record.source === 'link'),
  JSON.stringify(joinMerged));
check('手机直传：请求带 project 与 since（按游标拉增量）',
  joinUrl.indexOf('/api/signup/queue?project=') >= 0 && joinUrl.indexOf('&since=0') >= 0, joinUrl);
check('手机直传：游标推进到服务端的 total', store.state.signup.serverCursor === 1, String(store.state.signup.serverCursor));
await window.WB.views.signup.pullServer({ render: false });
check('手机直传：同一条再拉一次不会翻倍（按记录 id 幂等）',
  store.state.signup.records.filter((record) => record.id === 'rec-join-1').length === 1);
store.state.signup.linkCode = '';
const joinCallsBefore = joinCalls;
const joinNone = await window.WB.views.signup.pullServer({ render: false });
check('没登记短码时不发请求（纯静态托管那条路照旧走回执码）',
  joinNone === null && joinCalls === joinCallsBefore, joinCalls + '/' + joinCallsBefore);

/* 开启收集之后必须去登记短码，否则二维码里就没有项目号，手机提交会落进谁也看不见的桶 */
check('视图导出了「要不要登记短码」的判断', typeof window.WB.views.signup.needRegister === 'function');
const needCurrent = SG.normalise(sample.signup);
needCurrent.enabled = true;
check('还没登记过短码时要登记', window.WB.views.signup.needRegister(needCurrent) === true);
needCurrent.linkCode = 'k7f2';
needCurrent.linkFp = SG.fingerprint(needCurrent);
check('登记过且表单没改时不再重复登记', window.WB.views.signup.needRegister(needCurrent) === false);
needCurrent.linkFp = 'stale';
check('表单改过要重新登记', window.WB.views.signup.needRegister(needCurrent) === true);

/* 填写页只在「知道项目号 + 表单来源可信」时才直传：否则数据会落进谁也看不见的桶 */
const pageSrcGuard = fs.readFileSync(path.join(root, 'signup.html'), 'utf8');
check('填写页没有项目号时不直传（不往服务端的 default 桶塞数据）',
  pageSrcGuard.includes('const knownProject = Boolean(ownProject);')
  && pageSrcGuard.includes('let trustedForm = false;')
  && pageSrcGuard.includes('if (!knownProject || !trustedForm) return false;')
  && pageSrcGuard.includes("if (!knownProject || !trustedForm) { pushed = 'fail'; render(); return; }"));
check('服务端拒绝没有项目号的提交（不再写进看不见的 default 桶）',
  fs.readFileSync(path.join(root, 'server.mjs'), 'utf8').includes("entry.projectId === 'default'"));
globalThis.fetch = fetchBackup;
store.state.signup = joinBackup;

/* 浏览器环境已在 10h 开头换回，这里只清掉临时 location */
delete globalThis.location;
/* ── 11. 问答式补全：只问空白、只填空白、AI 不覆盖手改 ── */
store.setUser({ name: '组织者', role: 'organizer' });
store.importBundle(JSON.parse(JSON.stringify(bundle)));
const IVAPI = window.WB.interview;
check('访谈引擎已导出', typeof IVAPI?.plan === 'function' && typeof IVAPI?.apply === 'function');
check('intake 技能包已注册', registryIds.has('intake'));
check('intake 的 SKILL.md 存在', fs.existsSync(path.join(root, 'skills/intake/SKILL.md')));
const intakeSkill = fs.readFileSync(path.join(root, 'skills/intake/SKILL.md'), 'utf8');
check('intake 的 frontmatter 按课程模板写全（含触发词与 agent_created）',
  /^---\r?\n[\s\S]*?\nagent_created: true\r?\n---/.test(intakeSkill)
  && /description:[\s\S]*?触发词/.test(intakeSkill.split('---')[1] || ''),
  intakeSkill.split('---')[1]);
check('intake 的正文按「适用场景 / 执行流程 / 输出格式 / 验收标准」组织',
  ['## 适用场景', '## 执行流程', '## 输出格式', '## 验收标准'].every((h) => intakeSkill.includes(h)));
check('intake 写入了六类追问句式与任务定制三条件',
  ['依据', '前提', '反例', '边界', '替代', '自评'].every((s) => intakeSkill.includes(s))
  && intakeSkill.includes('定条数') && intakeSkill.includes('定顺序') && intakeSkill.includes('不许推论'));
check('AI 访谈契约已导出',
  typeof window.WB.ai.intakeAskContract === 'function' && typeof window.WB.ai.intakeComposeContract === 'function');
const ivAskContract = window.WB.ai.intakeAskContract();
check('追问契约把字段白名单写给了模型', IVAPI.AI_KEYS.every((key) => ivAskContract.includes(key)));
const ivComposeContract = window.WB.ai.intakeComposeContract();
check('成稿契约只要求三个文本区', IVAPI.COMPOSED_KEYS.every((key) => ivComposeContract.includes(key)));
check('追问契约要求模型标明句式并写清缺口',
  ivAskContract.includes('why') && IVAPI.ASK_STYLES.every((style) => ivAskContract.includes(style)),
  ivAskContract);

/* 只填必填项，其余留空：访谈应当只问空白字段 */
const ivState = store.state;
ivState.project.basic = { type: '科技文化节', name: '校园科技文化节', date: '2026-05-18' };
ivState.project.meta.basic = { type: 'user', name: 'user', date: 'user' };
const ivQuestions = IVAPI.plan(ivState);
check('访谈只问空白字段（文本区例外，用于重写）',
  ivQuestions.every((q) => !q.filled || IVAPI.COMPOSED_KEYS.includes(q.key)),
  ivQuestions.filter((q) => q.filled && !IVAPI.COMPOSED_KEYS.includes(q.key)).map((q) => q.key).join(','));
check('已填的活动类型/名称/日期不再追问',
  !ivQuestions.some((q) => ['type', 'name', 'date'].includes(q.id)), ivQuestions.map((q) => q.id).join(','));
check('科技文化节问到展区与互动环节',
  ivQuestions.some((q) => q.id === 'content-area') && ivQuestions.some((q) => q.id === 'content-interact'),
  ivQuestions.map((q) => q.id).join(','));
check('核心目标拆成「目标 + 衡量」两问', ivQuestions.filter((q) => q.key === 'goal').length === 2);
check('每道题都指认了缺口（这一项不填会怎样）',
  ivQuestions.every((q) => Boolean(q.why) && q.why.length >= 6),
  ivQuestions.filter((q) => !q.why).map((q) => q.id).join(','));
check('每道题都带句式字段（本地题留空，AI 追问才填）',
  ivQuestions.every((q) => typeof q.style === 'string'));
check('每个问题都指向真实字段且带问法',
  ivQuestions.every((q) => Boolean(q.ask) && U.BASIC_FIELDS.some((f) => f.key === q.key)));

ivState.project.basic.type = '运动会';
const ivSportQuestions = IVAPI.plan(ivState);
check('换活动类型后追问跟着换',
  ivSportQuestions.some((q) => q.id === 'content-events') && !ivSportQuestions.some((q) => q.id === 'content-area'),
  ivSportQuestions.map((q) => q.id).join(','));
ivState.project.basic.type = '科技文化节';

/* 回答 → 成稿：同字段多问合并，没答的问题不出现 */
const ivAnswers = {
  'content-area': '创客展区、舞台演出、互动体验三个板块',
  'content-interact': '打卡集章与工作坊',
  'goal-main': '让新生在两周内认识 3 个以上社团',
  'goal-metric': '参与人数 ≥ 800，满意度 ≥ 4.5/5',
  venue: '科创中心一层展厅',
  guests: '800',
  budget: '45000',
  constraint: '22:00 前必须结束'
};
const ivRows = IVAPI.composeDraft(ivState, ivQuestions, ivAnswers);
check('成稿把同字段的多个追问合并成一条', ivRows.length === 6, ivRows.map((r) => r.key).join(','));
const ivGoalRow = ivRows.find((r) => r.key === 'goal');
check('核心目标写成「目标（衡量：…）」',
  Boolean(ivGoalRow?.proposed.includes('（衡量：')) && ivGoalRow.proposed.includes('满意度'));
check('活动内容用分号连接多个回答',
  ivRows.find((r) => r.key === 'content')?.proposed === '创客展区、舞台演出、互动体验三个板块；打卡集章与工作坊');
check('没回答的问题不会凭空出现', !ivRows.some((r) => r.key === 'approval'));
check('拟填清单区分空字段与已有内容', ivRows.every((r) => typeof r.filled === 'boolean'));
check('拟填清单保留原始回答供 AI 整理',
  Array.isArray(ivRows[0]?.values) && ivRows[0].values.length > 0, JSON.stringify(ivRows[0]));

/* 写入：空字段自动填 */
const ivChoices = Object.fromEntries(ivRows.map((row) => [row.key, true]));
const ivResult = IVAPI.apply(ivState, ivRows, ivChoices);
check('空字段全部写入且计数正确', ivResult.applied.length === 6 && ivResult.replaced.length === 0, JSON.stringify(ivResult));
check('写入值与成稿一致',
  ivState.project.basic.venue === '科创中心一层展厅' && ivState.project.basic.goal === ivGoalRow.proposed);
check('写入的字段标记为用户填写',
  ivState.project.meta.basic.venue === 'user' && ivState.project.meta.basic.budget === 'user');
check('数字字段写入后是数字而不是字符串',
  ivState.project.basic.guests === 800 && ivState.project.basic.budget === 45000,
  `${typeof ivState.project.basic.guests}/${ivState.project.basic.guests}`);

/* 已有内容的文本区：默认不勾，勾了就是整段替换（成稿里已并入原话，不会丢信息） */
const ivAgain = IVAPI.composeDraft(ivState, IVAPI.plan(ivState), { 'goal-main': '补充：覆盖两个校区' });
const ivGoalAgain = ivAgain.find((r) => r.key === 'goal');
check('已填字段被标记为需确认后才替换',
  ivGoalAgain?.filled === true && ivGoalAgain.appendable === true, JSON.stringify(ivGoalAgain));
check('本地成稿把字段当前内容并了进去，替换后不会丢原话',
  String(ivGoalAgain?.proposed).includes(ivState.project.basic.goal)
  && String(ivGoalAgain?.proposed).includes('补充：覆盖两个校区'),
  String(ivGoalAgain?.proposed));
const ivGoalBefore = ivState.project.basic.goal;
const ivSkip = IVAPI.apply(ivState, ivAgain, {});
check('没勾选的字段一个都不动',
  ivSkip.applied.length === 0 && ivSkip.replaced.length === 0 && ivState.project.basic.goal === ivGoalBefore);
const ivReplace = IVAPI.apply(ivState, ivAgain, { goal: true });
check('勾选后是整段替换，而不是把新内容拼在后面',
  ivReplace.replaced.join(',') === 'goal'
  && ivState.project.basic.goal === ivGoalAgain.proposed
  && !ivState.project.basic.goal.includes('\n'),
  String(ivState.project.basic.goal));
check('替换过的字段标记为用户填写', ivState.project.meta.basic.goal === 'user');
const ivStale = [{ key: 'venue', label: '活动地点', proposed: '体育馆', current: '科创中心一层展厅', filled: true, appendable: false, source: 'user' }];
const ivStaleResult = IVAPI.apply(ivState, ivStale, { venue: true });
check('已填的非文本字段即使被勾选也不会被改写',
  ivState.project.basic.venue === '科创中心一层展厅' && ivStaleResult.skipped.includes('venue'));

/* AI 追问的白名单与去重 */
const ivFakeAi = IVAPI.normaliseAiQuestions({ questions: [
  { key: 'approval', ask: '审批走哪个部门？' },
  { key: 'unknown-field', ask: '不在白名单里的字段' },
  { key: '', ask: '字段名为空' },
  { key: 'approval', ask: '审批走哪个部门？' },
  { key: 'goal', ask: '目标怎么量化？' },
  { key: 'audience', ask: '主要面向谁？' },
  { key: 'guests', ask: '预计多少人？' }
] }, []);
check('AI 追问只保留白名单内的字段', ivFakeAi.every((q) => IVAPI.AI_KEYS.includes(q.key)), JSON.stringify(ivFakeAi.map((q) => q.key)));
check('AI 追问去掉重复与非法问题', ivFakeAi.length === 4 && new Set(ivFakeAi.map((q) => q.ask)).size === 4, JSON.stringify(ivFakeAi.map((q) => q.ask)));
check('AI 追问补上字段中文名与控件类型', ivFakeAi.every((q) => q.label && q.type && q.ai === true));
const ivStyledAi = IVAPI.normaliseAiQuestions({ questions: [
  { key: 'approval', ask: '审批走哪个部门？', style: '边界', why: '漏审批会被卡' },
  { key: 'goal', ask: '目标怎么量化？', style: '不存在的句式', why: '' }
] }, []);
check('AI 追问保留缺口说明', ivStyledAi[0]?.why === '漏审批会被卡', JSON.stringify(ivStyledAi[0]?.why));
check('AI 追问的句式只接受六类之一，非法值留空',
  ivStyledAi[0]?.style === '边界' && ivStyledAi[1]?.style === '',
  JSON.stringify(ivStyledAi.map((q) => q.style)));
const ivManyAi = IVAPI.normaliseAiQuestions({ questions: Array.from({ length: 8 }, (_, i) => ({ key: 'audience', ask: `问题 ${i}` })) }, []);
check('AI 追问最多 5 条', ivManyAi.length === 5, String(ivManyAi.length));

/* 草稿：关掉弹窗再打开不丢答案 */
IVAPI.draftOf(store.state).answers.probe = 'x';
check('访谈草稿写入 state.ui.interview', store.state.ui.interview.answers.probe === 'x');
IVAPI.resetDraft(store.state);
check('重置草稿后清空答案', Object.keys(store.state.ui.interview.answers).length === 0);

/* UI 冒烟：问题卡、进度、确认清单、真实 click 路径 */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.project.basic = { type: '科技文化节', name: '校园科技文化节', date: '2026-05-18', goal: '已有目标：让新生认识社团' };
store.state.project.meta.basic = { type: 'user', name: 'user', date: 'user', goal: 'user' };
const manifestView = window.WB.views.manifest;
check('信息表视图导出了问答式补全入口',
  typeof manifestView.openInterview === 'function' && typeof manifestView.interview?.confirm === 'function');
manifestView.openInterview();
const ivBox = document.getElementById('interview');
const ivSession = manifestView.interview.session;
check('问答弹窗已打开', ivBox.classList.contains('is-open') === true);
check('访谈按活动类型生成了问题', ivSession.questions.length >= 5, `问题 ${ivSession.questions.length} 个`);
const ivIds = ivSession.questions.map((q) => q.id);
check('弹窗里已填的类型/名称/日期不再出现', !ivIds.some((id) => ['type', 'name', 'date'].includes(id)), ivIds.join(','));
const ivPlanHtml = manifestView.interview.html();
check('问题卡渲染出追问、输入控件与进度',
  ivPlanHtml.includes('data-interview-input=') && ivPlanHtml.includes('iv-ask') && ivPlanHtml.includes('iv-dot'));
check('问题卡没有 undefined', !ivPlanHtml.includes('undefined'));
check('问题卡先讲清缺口再让用户回答',
  ivPlanHtml.includes('iv-why') && ivPlanHtml.includes('缺这一项会怎样'));
manifestView.interview.go(ivIds.indexOf('goal-main'));
const ivGoalHtml = manifestView.interview.html();
check('已有内容的字段在问题卡上被标出并显示现值',
  ivGoalHtml.includes('已有内容') && ivGoalHtml.includes('已有目标'));

const ivDraft = window.WB.interview.draftOf(store.state);
ivSession.questions.forEach((q, i) => { ivDraft.answers[q.id] = ivDraft.answers[q.id] || `回答${i + 1}`; });
manifestView.interview.render();
check('答题后进度圆点标记为已完成', manifestView.interview.html().includes('is-done'));
await manifestView.interview.compose();
check('存在已填字段时进入确认步骤', ivSession.stage === 'confirming', ivSession.stage);
const ivConfirmHtml = manifestView.interview.html();
check('确认清单渲染出勾选项与替换口径', ivConfirmHtml.includes('data-interview-choice=') && ivConfirmHtml.includes('替换'));
check('空字段默认勾选', /data-interview-choice="venue"[^>]*checked/.test(ivConfirmHtml));
check('已有内容的目标默认不勾选', /data-interview-choice="goal"[^>]*\/>/.test(ivConfirmHtml) && !/data-interview-choice="goal"[^>]*checked/.test(ivConfirmHtml));
check('确认清单没有 undefined', !ivConfirmHtml.includes('undefined'));
check('确认清单给出替换前后的对照', ivConfirmHtml.includes('现在：') && ivConfirmHtml.includes('已有目标'));
check('确认清单提供全部勾选 / 全部取消',
  ivConfirmHtml.includes('data-interview-choiceall="1"') && ivConfirmHtml.includes('data-interview-choiceall="0"'));
ivBox.emit('click', { target: { closest: (selector) => (selector === '[data-interview-choiceall]' ? { dataset: { interviewChoiceall: '0' } } : null) } });
check('点「全部取消」后所有字段都不写入',
  Object.values(ivSession.choices).every((open) => open === false), JSON.stringify(ivSession.choices));
ivBox.emit('click', { target: { closest: (selector) => (selector === '[data-interview-choiceall]' ? { dataset: { interviewChoiceall: '1' } } : null) } });
check('点「全部勾选」后所有字段都写入',
  Object.values(ivSession.choices).every((open) => open === true), JSON.stringify(ivSession.choices));
/* 确认步骤点「上一题」要回到问答，而不是再渲染一遍确认清单 */
manifestView.interview.step(-1);
check('确认清单点上一题回到问答',
  ivSession.stage === 'asking' && manifestView.interview.html().includes('data-interview-input='),
  ivSession.stage);
await manifestView.interview.compose();
check('返回后再生成仍然进入确认步骤', ivSession.stage === 'confirming', ivSession.stage);
const ivGoalBefore2 = store.state.project.basic.goal;
ivSession.choices.goal = true;
manifestView.interview.confirm();
check('确认后空字段被自动填入', U.text(store.state.project.basic.venue).length > 0, store.state.project.basic.venue);
check('确认后已有内容的目标被整段替换，原话仍在成稿里',
  store.state.project.basic.goal.startsWith(ivGoalBefore2)
  && !store.state.project.basic.goal.includes('\n')
  && store.state.project.basic.goal.includes('（衡量：'),
  String(store.state.project.basic.goal));
check('写入后草稿被清空', Object.keys(window.WB.interview.draftOf(store.state).answers).length === 0);
check('问答式补全写入变更记录', store.state.log.some((entry) => String(entry.detail).includes('问答式补全')));
check('确认后弹窗收起', ivBox.classList.contains('is-open') === false);

/* 忙碌中再点要有提示，不能静默吞掉点击 */
ivSession.busy = true;
ivBox.classList.add('is-open');
manifestView.interview.compose();
check('忙碌中再点「生成并填入」会给出提示而不是没反应',
  String(document.getElementById('toast').textContent).includes('稍等'),
  document.getElementById('toast').textContent);
ivSession.busy = false;

/* AI 整理成稿的兜底：超时或报错都退回本地成稿，绝不卡住 */
const ivTimeout = manifestView.withTimeout;
check('视图导出了超时兜底助手与超时阈值', typeof ivTimeout === 'function' && manifestView.AI_POLISH_TIMEOUT > 0);
const ivSlow = new Promise((resolve) => setTimeout(() => resolve('late'), 300));
const ivStarted = Date.now();
const ivFast = await ivTimeout(ivSlow, 20, 'fallback');
check('AI 超时会退回本地成稿', ivFast === 'fallback' && Date.now() - ivStarted < 200, `${ivFast}/${Date.now() - ivStarted}ms`);
const ivFailed = await ivTimeout(Promise.reject(new Error('boom')), 50, 'fallback');
check('AI 报错也会退回本地成稿', ivFailed === 'fallback');
check('AI 正常返回时不改动结果',
  (await ivTimeout(Promise.resolve('polished'), 50, 'fallback')) === 'polished');

/* 真实 click：进度圆点跳题、关闭按钮收起 */
manifestView.openInterview();
const ivClickBox = document.getElementById('interview');
ivClickBox.emit('click', { target: { closest: (selector) => (selector === '[data-interview-jump]' ? { dataset: { interviewJump: '2' } } : null) } });
check('点击进度圆点跳到第 3 问', manifestView.interview.session.index === 2, String(manifestView.interview.session.index));
ivClickBox.emit('click', { target: { closest: (selector) => (selector === '.close-interview' ? {} : null) } });
check('点击关闭按钮收起弹窗', ivBox.classList.contains('is-open') === false);
/* AI 在线路径（假 fetch，不联网）：成稿要真的用上 AI 文本，失败要退回本地而不是卡住 */
const stubAi = (ok) => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/health')) {
      return { ok: true, json: async () => ({ providers: { deepseek: true, yoshub: false } }) };
    }
    if (!ok) return { ok: false, status: 502, json: async () => ({ error: 'DeepSeek 请求失败（HTTP 502）' }) };
    return { ok: true, json: async () => ({ data: { basic: { goal: 'AI 成稿目标', content: 'AI 成稿内容', constraint: 'AI 成稿约束' } } }) };
  };
};
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.project.basic = { type: '科技文化节', name: '校园科技文化节', date: '2026-05-18' };
store.state.project.meta.basic = { type: 'user', name: 'user', date: 'user' };
stubAi(true);
await window.WB.ai.check();
check('假 fetch 下 AI 判定为可用', window.WB.ai.ready === true);
manifestView.openInterview();
const aiDraft = window.WB.interview.draftOf(store.state);
manifestView.interview.session.questions.forEach((q, i) => {
  aiDraft.answers[q.id] = ({ guests: '900', budget: '50000' })[q.id] || `回答${i + 1}`;
});
const aiApplyBtn = document.getElementById('interviewApply');
const pendingCompose = manifestView.interview.compose();
check('生成期间按钮进入「生成中…」并禁用',
  aiApplyBtn.disabled === true && aiApplyBtn.textContent === '生成中…', `${aiApplyBtn.disabled}/${aiApplyBtn.textContent}`);
await pendingCompose;
check('生成结束后按钮恢复可用', aiApplyBtn.disabled === false && aiApplyBtn.textContent === '生成并填入');
check('AI 在线时成稿真的用上 AI 文本',
  store.state.project.basic.goal === 'AI 成稿目标' && store.state.project.basic.content === 'AI 成稿内容',
  String(store.state.project.basic.goal));
check('AI 成稿标记为 AI 建议', store.state.project.meta.basic.goal === 'ai', store.state.project.meta.basic.goal);
check('直接字段仍是用户填写', store.state.project.meta.basic.venue === 'user' && store.state.project.basic.venue === '回答1');
check('数字字段经归一化仍是数字', store.state.project.basic.guests === 900, String(store.state.project.basic.guests));

/* AI 返回 502：退回本地成稿，不卡住、有提示 */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.project.basic = { type: '科技文化节', name: '校园科技文化节', date: '2026-05-18' };
store.state.project.meta.basic = { type: 'user', name: 'user', date: 'user' };
stubAi(false);
manifestView.openInterview();
const failDraft = window.WB.interview.draftOf(store.state);
manifestView.interview.session.questions.forEach((q, i) => { failDraft.answers[q.id] = `本地${i + 1}`; });
await manifestView.interview.compose();
check('AI 报错时退回本地成稿而不是卡住',
  manifestView.interview.session.stage === 'closed' && String(store.state.project.basic.goal).includes('（衡量：'),
  `${manifestView.interview.session.stage}/${store.state.project.basic.goal}`);
check('AI 报错后按钮恢复可用', aiApplyBtn.disabled === false && aiApplyBtn.textContent === '生成并填入');
/* 恢复离线判定，避免影响后续断言 */
globalThis.fetch = async () => ({ ok: true, json: async () => ({ providers: { deepseek: false, yoshub: false } }) });
await window.WB.ai.check();
check('恢复为离线模式', window.WB.ai.ready === false);
/* 一题都没答就点生成，也要给出提示 */
IVAPI.resetDraft(store.state);
manifestView.openInterview();
document.getElementById('toast').textContent = '';
manifestView.interview.compose();
check('一题都没答时点「生成并填入」会给出提示',
  String(document.getElementById('toast').textContent).includes('还没有回答'),
  document.getElementById('toast').textContent);
/* ── 11b. 引导参考：常见做法 / 示例答案 / 模糊回答不算回答 ── */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.project.basic = { type: '科技文化节', name: '校园科技文化节', date: '2026-05-18' };
store.state.project.meta.basic = { type: 'user', name: 'user', date: 'user' };
const gState = store.state;
const gContentGuide = IVAPI.guideFor(gState, { key: 'content' });
check('每道题都配了可直接采用的参考', Boolean(gContentGuide && gContentGuide.chips.length >= 5 && gContentGuide.samples.length >= 1),
  JSON.stringify(gContentGuide && { chips: gContentGuide.chips.length, samples: gContentGuide.samples.length }));
check('参考默认来自本地参考库而不是 AI', gContentGuide.fromAi === false);
check('没有参考的字段返回 null，而不是渲染一个空块', IVAPI.guideFor(gState, { key: 'coOrganizer' }) === null);

gState.project.basic.type = '运动会';
const gSportGuide = IVAPI.guideFor(gState, { key: 'content' });
check('参考内容随活动类型变化',
  gSportGuide.chips.map((c) => c.value).join(',') !== gContentGuide.chips.map((c) => c.value).join(','),
  `${gSportGuide.chips.length} 条 vs ${gContentGuide.chips.length} 条`);
gState.project.basic.type = '科技文化节';

const gGuests = IVAPI.guideFor(gState, { key: 'guests' });
check('人数这类字段给的是能直接写入的参考档位',
  gGuests.chips.every((c) => c.value && Number.isFinite(Number(c.value))), JSON.stringify(gGuests.chips));

/* 点选常见做法：三个文本区可拼可撤，其余字段直接替换 */
const gChipA = gContentGuide.chips[0].value;
const gChipB = gContentGuide.chips[1].value;
const gOne = IVAPI.toggleChip('content', '', { value: gChipA });
check('点一下常见做法就写进内容', gOne === gChipA, gOne);
const gTwo = IVAPI.toggleChip('content', gOne, { value: gChipB });
check('再点一条会拼在后面', gTwo === `${gChipA}；${gChipB}`, gTwo);
check('已点过的做法会被标为选中', IVAPI.chipsIn('content', gTwo).length === 2, String(IVAPI.chipsIn('content', gTwo).length));
check('再点一次就取消这条做法', IVAPI.toggleChip('content', gTwo, { value: gChipA }) === gChipB);
check('非文本字段点选是替换而不是拼接', IVAPI.toggleChip('venue', '旧场地', { value: '新场地' }) === '新场地');
check('输入框里写着「你帮我想」时，点参考是整段替换而不是拼在废话后面',
  IVAPI.toggleChip('content', '你帮我想', { value: gChipA }) === gChipA);

/* 模糊回答不再算回答 */
check('「你帮我想」被识别为模糊回答', IVAPI.isVague('你帮我想') === true);
check('「待确认」被识别为模糊回答', IVAPI.isVague('待确认') === true);
check('「随便吧」被识别为模糊回答', IVAPI.isVague('随便吧') === true);
check('正常回答不会被误判', IVAPI.isVague('创客展区、舞台演出、互动体验') === false && IVAPI.isVague('') === false);
const gQuestions = IVAPI.plan(gState);
const gVagueRows = IVAPI.composeDraft(gState, gQuestions,
  { 'goal-main': '你帮我想', 'content-area': '你看着办', 'content-interact': '创客展区' });
check('模糊回答不会写进拟填清单', !gVagueRows.some((r) => r.key === 'goal'), gVagueRows.map((r) => r.key).join(','));
check('模糊回答绝不会变成表单里的字',
  !gVagueRows.some((r) => `${r.proposed}`.includes('你帮我想') || `${r.proposed}`.includes('你看着办')),
  JSON.stringify(gVagueRows));
check('同一字段里有真实回答时照样成稿', gVagueRows.some((r) => r.key === 'content'));
check('模糊回答会被统计出来提示用户',
  IVAPI.vagueAnswers(gQuestions, { 'goal-main': '你帮我想', 'content-area': '你看着办' }).length === 2);

/* AI 再给两版：合并进参考块并标记来源 */
const gAiGuide = IVAPI.withAiOptions(gContentGuide, ['版本一', '版本二', '版本三', '版本四']);
check('AI 参考覆盖示例并最多保留 3 版', gAiGuide.fromAi === true && gAiGuide.samples.length === 3, JSON.stringify(gAiGuide.samples));
check('AI 参考不会冲掉已有的常见做法', gAiGuide.chips.length === gContentGuide.chips.length);
check('没有 AI 结果时参考块保持原样', IVAPI.withAiOptions(gContentGuide, []).fromAi === false);

/* 界面路径：问题卡里能看到参考块，点做法/示例真的写进输入框 */
store.importBundle(JSON.parse(JSON.stringify(bundle)));
store.state.project.basic = { type: '科技文化节', name: '校园科技文化节', date: '2026-05-18' };
store.state.project.meta.basic = { type: 'user', name: 'user', date: 'user' };
manifestView.openInterview();
const gIdx = manifestView.interview.session.questions.findIndex((q) => q.id === 'content-area');
check('访谈里能找到「活动内容」这一问', gIdx >= 0, String(gIdx));
manifestView.interview.go(gIdx);
const gQuestion = manifestView.interview.session.questions[gIdx];
const gChipHtml = manifestView.interview.html();
check('问题卡里渲染出参考块与「常见做法」标题',
  gChipHtml.includes('iv-guide') && gChipHtml.includes('常见做法'));
check('参考块给出可点选的常见做法', gChipHtml.includes('data-interview-chip='));
check('参考块给出「AI 再给两版」入口', gChipHtml.includes('data-interview-aidraft'));
check('折叠状态先不铺开示例，留一个展开入口',
  gChipHtml.includes('data-interview-withsamples') && !gChipHtml.includes('data-interview-sample='));
check('参考块没有 undefined', !gChipHtml.includes('undefined'));

const gClickBox2 = document.getElementById('interview');
gClickBox2.emit('click', { target: { closest: (selector) => (selector === '[data-interview-withsamples]' ? {} : null) } });
const gSampleHtml = manifestView.interview.html();
check('展开后能看到整段示例并一键采用',
  gSampleHtml.includes('data-interview-sample=') && gSampleHtml.includes('用这一版'));
check('展开示例后仍能收起', gSampleHtml.includes('收起示例'));

gClickBox2.emit('click', { target: { closest: (selector) => (selector === '[data-interview-chip]' ? { dataset: { interviewChip: gChipA } } : null) } });
check('点一下常见做法就写进这一题的输入框',
  `${window.WB.interview.draftOf(store.state).answers[gQuestion.id] || ''}`.includes(gChipA),
  String(window.WB.interview.draftOf(store.state).answers[gQuestion.id]));

/* 输入框里还留着「你帮我想」时点参考，要整段替换掉那句废话 */
window.WB.interview.draftOf(store.state).answers[gQuestion.id] = '你帮我想';
manifestView.interview.render();
gClickBox2.emit('click', { target: { closest: (selector) => (selector === '[data-interview-chip]' ? { dataset: { interviewChip: gChipB } } : null) } });
check('模糊回答会参考时被整段替换掉',
  window.WB.interview.draftOf(store.state).answers[gQuestion.id] === gChipB,
  String(window.WB.interview.draftOf(store.state).answers[gQuestion.id]));

const gSample = IVAPI.guideFor(store.state, gQuestion).samples[0];
gClickBox2.emit('click', { target: { closest: (selector) => (selector === '[data-interview-sample]' ? { dataset: { interviewSample: '0' } } : null) } });
check('「用这一版」把整段示例填进输入框',
  window.WB.interview.draftOf(store.state).answers[gQuestion.id] === gSample,
  String(window.WB.interview.draftOf(store.state).answers[gQuestion.id]));

/* 全都写成「你帮我想」：不写入，并明确指路 */
manifestView.interview.session.questions.forEach((q) => { window.WB.interview.draftOf(store.state).answers[q.id] = '你帮我想'; });
manifestView.interview.render();
document.getElementById('toast').textContent = '';
await manifestView.interview.compose();
check('全是模糊回答时不写入，并提示去看常见做法',
  manifestView.interview.session.stage === 'asking'
  && String(document.getElementById('toast').textContent).includes('帮我想'),
  `${manifestView.interview.session.stage}/${document.getElementById('toast').textContent}`);
check('模糊回答数量被记下来，用于写入后的说明',
  manifestView.interview.session.skippedVague === manifestView.interview.session.questions.length,
  String(manifestView.interview.session.skippedVague));

/* AI：成稿里的占位词要拦掉，拟稿要接进参考块，成稿请求要带上字段当前内容 */
let gComposeInput = null;
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/api/health')) {
    return { ok: true, json: async () => ({ providers: { deepseek: true, yoshub: false } }) };
  }
  const body = JSON.parse(options?.body || '{}');
  if (body.input?.mode === 'compose') gComposeInput = body.input;
  if (body.input?.mode === 'draft') {
    return { ok: true, json: async () => ({ data: { options: ['版本一：三板块 + 两处互动', '版本二：纯白天展览', '版本三：市集加工作坊'] } }) };
  }
  if (body.input?.mode === 'compose') {
    return { ok: true, json: async () => ({ data: { basic: { goal: '待确认', content: '上午创客展区，下午打卡集章', constraint: '' } } }) };
  }
  return { ok: true, json: async () => ({ data: {} }) };
};
await window.WB.ai.check();
check('假 fetch 下 AI 判定为可用（拟稿用）', window.WB.ai.ready === true);
check('占位词识别：待确认是占位词，正常描述不是',
  IVAPI.isPlaceholder('待确认') === true && IVAPI.isPlaceholder('创客展区') === false);
/* 让「已知约束」先有内容，验证它会被原样喂给 AI */
gState.project.basic.constraint = '22:00 前必须结束';
const gRows = IVAPI.composeDraft(gState, gQuestions,
  { 'goal-main': '让新生认识 3 个社团', 'content-area': '创客展区', 'content-interact': '打卡集章', constraint: '不可使用食堂经费科目' });
check('已填文本区的拟填行带着当前内容',
  gRows.find((r) => r.key === 'constraint')?.current === '22:00 前必须结束',
  String(gRows.find((r) => r.key === 'constraint')?.current));
const gPolished = await IVAPI.composeAi(gState, gRows);
check('AI 成稿请求带上「字段名 + 当前内容」的原文对照',
  Array.isArray(gComposeInput?.当前内容)
  && gComposeInput.当前内容.some((line) => line === '已知约束当前内容：22:00 前必须结束'),
  JSON.stringify(gComposeInput?.当前内容));
check('成稿请求把「当前内容」与「本次回答」分开给，便于重写而不是拼接',
  Array.isArray(gComposeInput?.成稿字段)
  && gComposeInput.成稿字段.some((item) => item.当前内容 === '22:00 前必须结束')
  && gComposeInput.成稿字段.some((item) => String(item.本次回答).includes('不可使用食堂经费科目')),
  JSON.stringify(gComposeInput?.成稿字段));
const gPolishedGoal = gPolished.find((r) => r.key === 'goal');
check('AI 交回「待确认」时不会被写进表单',
  !`${gPolishedGoal?.proposed}`.includes('待确认'), String(gPolishedGoal?.proposed));
check('AI 只对有效字段采用成稿，占位字段保留本地版本',
  gPolished.find((r) => r.key === 'content')?.source === 'ai'
  && gPolishedGoal?.source !== 'ai',
  JSON.stringify(gPolished.map((r) => `${r.key}:${r.source}`)));
manifestView.interview.go(gIdx);
await manifestView.interview.aiDraft();
const gAiGuide2 = manifestView.interview.session.guides[gQuestion.id];
check('AI 就当前题给出可直接采用的 2–3 版',
  gAiGuide2?.fromAi === true && gAiGuide2.samples.length === 3, JSON.stringify(gAiGuide2?.samples));
check('AI 参考接进参考块并自动展开',
  manifestView.interview.html().includes('AI 给的参考')
  && manifestView.interview.html().includes('data-interview-sample='));
globalThis.fetch = async () => ({ ok: true, json: async () => ({ providers: { deepseek: false, yoshub: false } }) });
await window.WB.ai.check();
check('拟稿测试后恢复离线判定', window.WB.ai.ready === false);
manifestView.interview.close();
IVAPI.resetDraft(store.state);

/* ── 12. 参考件（上传参考）：Word 解析、结构与字段对齐、覆盖核对 ── */
const DX = window.WB.docx;
check('参考件模块已加载', Boolean(DX && DX.parseDocumentXml && DX.readFile));
const refRejected = await DX.readFile({ name: 'a.pdf' }).then(() => '', (error) => error.message);
check('参考件：只认 .docx / .md / .txt 三类参考文件', refRejected.includes('支持'), refRejected);

const REF_XML = [
  '<w:document><w:body>',
  '<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>一、活动基本信息</w:t></w:r></w:p>',
  '<w:tbl>',
  '<w:tr><w:tc><w:p><w:r><w:t>&#x6d3b;&#x52a8;&#x540d;&#x79f0;</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>示例活动</w:t></w:r></w:p></w:tc></w:tr>',
  '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>负责人姓名</w:t></w:r></w:p></w:tc>',
  '<w:tc><w:p><w:r><w:t>张三</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>联系方式</w:t></w:r></w:p></w:tc>',
  '<w:tc><w:p><w:r><w:t>13800000000</w:t></w:r></w:p></w:tc></w:tr>',
  '<w:tr><w:tc><w:p><w:r><w:t>二、活动内容与流程</w:t></w:r></w:p></w:tc></w:tr>',
  '</w:tbl>',
  '<w:p><w:r><w:t>0.748元/张</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>3.在提交电子版之前，请把文件重命名为“社团名称－活动名称”。</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>六、经费预算</w:t></w:r></w:p>',
  '</w:body></w:document>'
].join('');
const refParsed = DX.parseDocumentXml(REF_XML);
check('参考件：栏目按文档顺序合并标题与表格整行小标题',
  refParsed.sections.map((section) => section.heading).join('|') === '一、活动基本信息|二、活动内容与流程|六、经费预算',
  refParsed.sections.map((section) => section.heading).join('|'));
check('参考件：字段清单只留字段名，剔除人名与电话',
  refParsed.fields.join('|') === '活动名称|负责人姓名|联系方式', refParsed.fields.join('|'));
check('参考件：数值行与说明句不会被误当成栏目',
  !refParsed.sections.some((section) => /元\/张|重命名/.test(section.heading)),
  refParsed.sections.map((section) => section.heading).join('|'));
check('参考件：XML 实体被还原成中文', refParsed.text.includes('负责人姓名') && refParsed.text.includes('活动名称'));
check('参考件：原文渲染成 Markdown 管道表格',
  /\n\| .+ \|\n\| --- \|/.test(refParsed.text), refParsed.text.slice(0, 120));

const sampleBytes = new Uint8Array(fs.readFileSync(path.join(root, 'samples', '示例-学院活动策划书模板.docx')));
const sampleEntry = DX.findEntry(sampleBytes, 'word/document.xml');
check('参考件：能从真实 .docx 里定位正文条目（deflate 压缩）',
  Boolean(sampleEntry) && sampleEntry.method === 8, sampleEntry ? `method=${sampleEntry.method}` : '未找到');
const sampleRef = DX.parseDocumentXml(new TextDecoder('utf-8').decode(await DX.inflateEntry(sampleBytes, 'word/document.xml')));
check('参考件：真实 Word 样本解压出 10 个以上栏目', sampleRef.sections.length >= 10, String(sampleRef.sections.length));
check('参考件：摘要把栏目数、字段数、字数都写出来',
  /栏目/.test(DX.summaryOf(sampleRef)) && /字段/.test(DX.summaryOf(sampleRef)) && /字/.test(DX.summaryOf(sampleRef)),
  DX.summaryOf(sampleRef));

const alignedDoc = { sections: [
  { heading: '一、活动基本信息', body: '| 活动名称 | 示例 |\n| --- | --- |\n| 负责人姓名 | 张三 |\n| 联系方式 | 13800000000 |' },
  { heading: '二、活动内容与流程', body: '两大板块。' },
  { heading: '六、经费预算', body: '| 科目 | 金额 |' }
] };
const alignedReport = DX.matchReport(refParsed, alignedDoc);
check('参考件核对：栏目与字段全中时显示 x/x',
  alignedReport.columns.covered === alignedReport.columns.total && alignedReport.fields.covered === alignedReport.fields.total,
  JSON.stringify(alignedReport));
const gapReport = DX.matchReport(refParsed, { sections: [{ heading: '一、活动基本信息', body: '| 活动名称 | 示例 |' }] });
check('参考件核对：缺项按原始文字列出来',
  gapReport.fields.missing.includes('联系方式') && gapReport.columns.missing.includes('六、经费预算'),
  JSON.stringify(gapReport));
check('参考件核对：没有参考件时返回 null', DX.matchReport(null, alignedDoc) === null);

/* 挂上参考后：章节换成参考栏目，生成请求必须带「参考样例」 */
const refKey = 'application';
const refPrevUser = state.user;
const hadRefOutput = Boolean(state.project.outputs[refKey]);
const prevRefMaterial = state.materials[refKey];
store.setUser({ name: '参考测试同学', role: 'organizer' });
state.project.outputs[refKey] = true;
state.materials[refKey] = {
  title: '活动申报表', templateName: '默认章节', source: 'ai', generatedAt: new Date().toISOString(),
  sections: window.SKILLS.materials['activity-application'].sections.map((heading) => ({ heading, body: '待补充' }))
};
state.ui.openMaterial = refKey;

/* 真机路径：uploadReference 读一份真实 .docx 再挂上去 */
await window.WB.views.material.uploadReference(refKey, {
  name: '示例-学院活动策划书模板.docx',
  arrayBuffer: async () => sampleBytes.slice().buffer
});
check('上传参考：真实 .docx 解析后挂到该材料上',
  state.references[refKey]?.name === '示例-学院活动策划书模板.docx' && state.references[refKey].sections.length >= 10,
  `${state.references[refKey]?.sections.length} 栏目`);
check('上传参考：字段与原文一并留下，供核对与提示词使用',
  state.references[refKey].fields.length >= 2 && String(state.references[refKey].text).includes('申报单位'),
  JSON.stringify(state.references[refKey]?.fields));

/* 只读访客：上传参考要被拦下 */
store.setUser({ name: '只读同学', role: 'viewer' });
const keptReference = state.references[refKey];
await window.WB.views.material.uploadReference(refKey, { name: 'x.docx', arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
check('上传参考：只读访客被拦下，原参考不被替换', state.references[refKey] === keptReference);
store.setUser({ name: '参考测试同学', role: 'organizer' });

/* 拖拽上传：把文件丢到卡片上，等同于点「上传参考」 */
const panelElement = document.getElementById('materialPanel');
const dragState = { on: 0, prevented: 0 };
const zoneElement = {
  dataset: { materialDropzone: refKey },
  classList: { add: () => { dragState.on += 1; }, remove: () => { dragState.on -= 1; } },
  contains: () => false
};
const dragEventOf = (files, types) => ({
  target: { closest: (selector) => (selector === '[data-material-dropzone]' ? zoneElement : null) },
  dataTransfer: { files, types: types || ['Files'] },
  relatedTarget: null,
  preventDefault: () => { dragState.prevented += 1; }
});
panelElement.emit('dragover', dragEventOf([{ name: '拖进来的样表.docx' }]));
check('拖拽上传：文件悬停在卡片上会高亮该卡片', dragState.on === 1, String(dragState.on));
delete state.references[refKey];
/* 拖拽是外部动作，不会让输入框失焦：落点里要先手动收掉正在编辑的块 */
let flushes = 0;
const editingBlock = {
  tagName: 'DIV',
  closest: (selector) => (selector === '[data-material-block]' ? editingBlock : null),
  blur: () => { flushes += 1; }
};
document.activeElement = editingBlock;
await panelElement.emit('drop', dragEventOf([{ name: '拖进来的样表.docx', arrayBuffer: async () => sampleBytes.slice().buffer }]));
document.activeElement = null;
check('拖拽上传：放下前先收掉正在编辑的块，重绘不会冲掉未提交的改动', flushes === 1, String(flushes));
check('拖拽上传：把 .docx 丢到卡片上就挂成参考件',
  state.references[refKey]?.name === '拖进来的样表.docx' && state.references[refKey].sections.length >= 10,
  `${state.references[refKey]?.sections.length} 栏目`);
check('拖拽上传：落点高亮在放下后清掉', dragState.on === 0, String(dragState.on));

const savedToast = window.WB.toast;
const refToasts = [];
window.WB.toast = (text) => { refToasts.push(String(text)); };
await panelElement.emit('drop', dragEventOf([{ name: '说明书.pdf' }]));
check('拖拽上传：不支持的格式会提示且不替换参考',
  state.references[refKey]?.name === '拖进来的样表.docx' && refToasts.some((text) => text.includes('支持 .docx')),
  refToasts.join(' / '));
window.WB.toast = savedToast;

dragState.prevented = 0;
panelElement.emit('dragover', dragEventOf([], ['text/plain']));
check('拖拽上传：拖选中文字不会被当成参考件拦下', dragState.prevented === 0, String(dragState.prevented));
window.WB.views.material.render();
check('材料卡片带参考拖放区标记，且操作区给出虚线「上传参考」入口',
  document.querySelector('#materialList').innerHTML.includes(`data-material-dropzone="${refKey}"`)
  && document.querySelector('#materialList').innerHTML.includes('reference-add'));

/* 换成 3 栏目的小参考，断言生成链路 */
state.references[refKey] = { id: 'ref-test', name: '往届申报表.docx', kind: 'docx', createdAt: new Date().toISOString(), ...refParsed };
window.WB.views.material.render();
const refHtml = document.querySelector('#materialList').innerHTML;
check('材料卡片：有参考时显示文件名、覆盖核对与换/删入口',
  refHtml.includes('reference-chip') && refHtml.includes('reference-check') && refHtml.includes('data-material-reference-remove'),
  refHtml.slice(0, 0) || '');
check('材料卡片：编辑器里给出参考面板（栏目 / 字段 / 原文）',
  refHtml.includes('material-reference') && refHtml.includes('reference-tag') && refHtml.includes('reference-source'));

let gRefInput = null;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options?.body || '{}');
  if (String(url).includes('/api/health')) return { ok: true, json: async () => ({ providers: { deepseek: true, yoshub: false } }) };
  if (String(url).includes('/api/material')) {
    gRefInput = body.input;
    return { ok: true, json: async () => ({ data: { title: '活动申报表', sections: refParsed.sections.map((section, index) => ({ heading: section.heading, body: index ? '正文' : '| 活动名称 | 示例 |' })) } }) };
  }
  return { ok: true, json: async () => ({}) };
};
await window.WB.ai.check();
const refOk = await window.WB.views.material.generateOne(refKey, { silent: true });
check('挂上参考后能生成', refOk === true);
check('生成请求带「参考样例」：栏目 + 字段清单 + 原文',
  gRefInput?.参考样例?.栏目?.length === 3
  && gRefInput.参考样例.字段清单.includes('活动名称')
  && String(gRefInput.参考样例.原文).includes('负责人姓名'),
  JSON.stringify(gRefInput?.参考样例?.栏目));
check('生成后章节按参考栏目对齐（不是内置的 5 章）',
  state.materials[refKey].sections.map((section) => section.heading).join('|') === '一、活动基本信息|二、活动内容与流程|六、经费预算',
  state.materials[refKey].sections.map((section) => section.heading).join('|'));
check('生成后文档记下章节来源是参考件',
  state.materials[refKey].templateName === '参考《往届申报表.docx》', state.materials[refKey].templateName);

/* ── 版式套件：参考 Word 的样式表 / 页面设置 / 页眉页脚也一并取出来 ── */
const RAW_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const kitFixture = window.WB.ooxml.zip([
  { name: '[Content_Types].xml', data: `${RAW_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>` },
  { name: '_rels/.rels', data: `${RAW_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
  { name: 'word/_rels/document.xml.rels', data: `${RAW_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>` },
  { name: 'word/styles.xml', data: `${RAW_XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="仿宋_GB2312"/><w:sz w:val="32"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="3"><w:name w:val="heading 2"/><w:basedOn w:val="a"/><w:rPr><w:b/></w:rPr></w:style></w:styles>` },
  { name: 'word/numbering.xml', data: `${RAW_XML}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>` },
  { name: 'word/header1.xml', data: `${RAW_XML}<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:r><w:t>XX大学学生活动申报表</w:t></w:r></w:p></w:hdr>` },
  { name: 'word/_rels/header1.xml.rels', data: `${RAW_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>` },
  { name: 'word/media/logo.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
  { name: 'word/document.xml', data: `${RAW_XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`
    + '<w:p><w:pPr><w:pStyle w:val="2"/><w:jc w:val="center"/></w:pPr><w:r><w:t>一、活动基本信息</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:t>正文示例</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>二、活动内容与流程</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="3"/></w:pPr><w:r><w:t>（一）活动主题</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="2"/></w:pPr><w:r><w:t>六、经费预算</w:t></w:r></w:p>'
    + '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>活动名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>示例</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>活动时间</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>'
    + '<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:t>尾段</w:t></w:r></w:p>'
    + '<w:sectPr><w:headerReference w:type="default" r:id="rId9"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="1134" w:bottom="850" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>' }
]);
const kit = await DX.styleKit(kitFixture, '学院申报表样表.docx');
check('版式套件：样式表 / 编号 / 页眉图片一并取出', Boolean(kit)
  && Boolean(kit.parts['word/styles.xml']) && Boolean(kit.parts['word/numbering.xml'])
  && kit.refs.length === 1 && kit.refs[0].path === 'word/header1.xml' && kit.media.length === 1,
  JSON.stringify({ parts: Object.keys(kit?.parts || {}), refs: kit?.refs?.length, media: kit?.media?.length }));
check('版式套件：取到标题与正文的段落样本、标题样式号与模板字体',
  Boolean(kit.pPr.heading1) && Boolean(kit.pPr.body) && kit.headingIds[1] === '2' && kit.fonts.includes('仿宋_GB2312'),
  JSON.stringify({ headingIds: kit.headingIds, fonts: kit.fonts }));
check('版式套件：页面设置与表格样式取到，并摘掉页眉引用（导出时重新挂）',
  kit.sectPr.includes('w:top="850"') && !kit.sectPr.includes('headerReference')
  && kit.tblPr.includes('w:sz="8"') && kit.tblGrid.includes('w:w="4000"'));
check('版式套件：体积在本地存档预算内（< 700 KB）', kit.bytes < 700 * 1024, `${(kit.bytes / 1024).toFixed(1)} KB`);

/* ── 按参考的版式导出 Word ── */
state.references[refKey] = { ...state.references[refKey], kit };
check('styleFor：挂了参考的产出能取到版式套件', window.WB.exporters.styleFor(refKey) === kit);
const kitDoc = { title: '诗韵秋兴｜活动申报表', sections: [
  { heading: '一、活动基本信息', body: '正文一' },
  { heading: '六、经费预算', body: '| 科目 | 金额 |\n| --- | --- |\n| 场地 | 800 |' }
] };
const kitBytes = window.WB.exporters.materialToDocx(kitDoc, { style: kit });
const kitEntries = window.WB.ooxml.readEntries(kitBytes);
const kitNames = kitEntries.map((entry) => entry.name);
const kitEntryText = (name) => new TextDecoder().decode((kitEntries.find((entry) => entry.name === name) || { data: new Uint8Array() }).data);
check('导出：参考的样式表 / 编号 / 页眉 / 图片都进了包',
  ['word/styles.xml', 'word/numbering.xml', 'word/header1.xml', 'word/_rels/header1.xml.rels', 'word/media/logo.png'].every((name) => kitNames.includes(name)),
  kitNames.join(', '));
check('导出：正文套用参考的段落样本、页面设置与页眉',
  kitEntryText('word/document.xml').includes('<w:pStyle w:val="2"/>')
  && kitEntryText('word/document.xml').includes('w:top="850"')
  && kitEntryText('word/document.xml').includes('r:id="rId100"'));
check('导出：表格套用参考的边框，列数不同时按参考总宽均分',
  kitEntryText('word/document.xml').includes('w:sz="8" w:color="000000"')
  && (kitEntryText('word/document.xml').match(/<w:gridCol w:w="4500"\/>/g) || []).length === 2
  && (kitEntryText('word/document.xml').match(/<w:tcW w:w="4500" w:type="dxa"\/>/g) || []).length === 4,
  (kitEntryText('word/document.xml').match(/<w:gridCol[^>]*\/>/g) || []).join(''));
check('导出：列数与参考表格一致时照抄参考列宽', (() => {
  const wide = window.WB.exporters.materialToDocx({ title: 't', sections: [{ heading: 'x', body: '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |' }] }, { style: kit });
  const xml = new TextDecoder().decode(window.WB.ooxml.readEntries(wide).find((entry) => entry.name === 'word/document.xml').data);
  return xml.includes('<w:gridCol w:w="2000"/>') && xml.includes('<w:gridCol w:w="4000"/>') && xml.includes('<w:gridCol w:w="3000"/>');
})());
check('导出：样式表用的是参考的字体（不是内置等线）',
  kitEntryText('word/styles.xml').includes('仿宋_GB2312') && kitEntryText('[Content_Types].xml').includes('/word/header1.xml'));
const plainBytes = window.WB.exporters.materialToDocx(kitDoc, { style: null });
check('导出：没挂参考时仍用内置版式（5 个部件 + 内置字体）',
  window.WB.ooxml.readEntries(plainBytes).length === 5
  && new TextDecoder().decode(window.WB.ooxml.readEntries(plainBytes).find((entry) => entry.name === 'word/styles.xml').data).includes('等线'));
check('上传参考：真实 .docx 的版式套件随参考件一起落库（走 uploadReference）', await (async () => {
  await window.WB.views.material.uploadReference(refKey, { name: '学院申报表样表.docx', arrayBuffer: async () => kitFixture.slice().buffer });
  const saved = state.references[refKey];
  return Boolean(saved?.kit?.pPr?.heading1) && saved.kit.media.length === 1;
})());

/* ── 按参考重排（AI）：栏目/字段/表格列照抄参考，值只来自本项目 ── */
let reframeRequest = null;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options?.body || '{}');
  if (String(url).includes('/api/health')) return { ok: true, json: async () => ({ providers: { deepseek: true, yoshub: false } }) };
  if (String(url).includes('/api/material')) {
    reframeRequest = body;
    return { ok: true, json: async () => ({ data: { title: '诗韵秋兴｜活动申报表', sections: [
      { heading: '一、活动基本信息', body: '| 活动名称 | 诗韵秋兴 |' },
      { heading: '二、活动内容与流程', body: '两大板块。' },
      { heading: '（一）活动主题', body: '吟唱与手作。' },
      { heading: '六、经费预算', body: '| 科目 | 金额 |' }
    ] } }) };
  }
  return { ok: true, json: async () => ({}) };
};
await window.WB.ai.check();
const beforeReframe = JSON.stringify(state.materials[refKey].sections);
const reframed = await window.WB.views.material.reframeMaterial(refKey);
check('按参考重排：AI 返回的栏目按参考顺序落地', reframed === true
  && state.materials[refKey].sections.map((section) => section.heading).join('|') === '一、活动基本信息|二、活动内容与流程|（一）活动主题|六、经费预算',
  state.materials[refKey].sections.map((section) => section.heading).join('|'));
check('按参考重排：契约写明照抄栏目 / 字段 / 表格列，缺的写待确认、不许编造',
  /不得增删或改名/.test(reframeRequest.contract) && /照抄/.test(reframeRequest.contract)
  && /待确认/.test(reframeRequest.contract) && /不要照抄/.test(reframeRequest.contract));
check('按参考重排：请求里带上现有正文、参考样例与输出栏目',
  reframeRequest.input.现有正文.length === 3 && reframeRequest.input.参考样例.栏目.length === 4
  && reframeRequest.input.输出栏目.join('|') === '一、活动基本信息|二、活动内容与流程|（一）活动主题|六、经费预算',
  JSON.stringify({ 现有正文: reframeRequest.input.现有正文.length, 输出栏目: reframeRequest.input.输出栏目.length }));
check('按参考重排：记下参考来源，并留一份撤回用的旧正文',
  state.materials[refKey].reframedFrom === '学院申报表样表.docx' && state.materials[refKey].previous.sections.length === 3);
window.WB.views.material.render();
check('按参考重排：卡片上出现「版式 ✓」与「已重排」标记，并给出撤回入口',
  document.querySelector('#materialList').innerHTML.includes('版式 ✓')
  && document.querySelector('#materialList').innerHTML.includes('已重排')
  && document.querySelector('#materialList').innerHTML.includes('data-material-reframe-undo'));
store.setUser({ name: '只读同学', role: 'viewer' });
const viewerReframe = await window.WB.views.material.reframeMaterial(refKey);
check('按参考重排：只读访客被拦下，正文不变', viewerReframe === false && state.materials[refKey].reframedFrom === '学院申报表样表.docx');
store.setUser({ name: '参考测试同学', role: 'organizer' });
const undone = window.WB.views.material.undoReframe(refKey);
check('撤回重排：正文回到重排前', undone === true
  && JSON.stringify(state.materials[refKey].sections) === beforeReframe && !state.materials[refKey].reframedFrom);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ providers: { deepseek: false, yoshub: false } }) });
await window.WB.ai.check();
check('参考件测试后恢复离线判定', window.WB.ai.ready === false);
delete state.references[refKey];
if (prevRefMaterial) state.materials[refKey] = prevRefMaterial; else delete state.materials[refKey];
if (!hadRefOutput) delete state.project.outputs[refKey];
if (refPrevUser) store.setUser(refPrevUser); else store.signOut();
state.ui.openMaterial = null;
window.WB.views.material.render();

/* ── 13. 参考表填值（原表填充）：结构照抄，只换识别出来的值 ── */
/* 读回压缩过的部件：readEntries 只解 STORE 条目，method 8 要自己解 */
const inflatePart = async (zipBytes, name) => {
  const item = DX.listEntries(zipBytes).find((entry) => entry.name === name);
  if (!item) return '';
  const raw = DX.entryBytes(zipBytes, item);
  if (item.method === 0) return new TextDecoder().decode(raw);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer()));
};

const FILL_XML = RAW_XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
  + '<w:p><w:r><w:t>活动立项申报表</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>活动名称：示例活动</w:t></w:r></w:p>'
  + '<w:tbl>'
  + '<w:tr><w:tc><w:p><w:r><w:t>一、活动基本信息</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>活 动 地 点</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>旧地点</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>活动时间</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>序号</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>物品名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>横幅</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>二、活动内容</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>（一）活动背景</w:t></w:r></w:p><w:p><w:r><w:t>去年写的内容</w:t></w:r></w:p>'
  + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>积分标准</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr>'
  + '</w:tbl>'
  + '<w:p><w:r><w:t>附件1</w:t></w:r></w:p>'
  + '</w:body></w:document>';

const fillParsed = DX.fillSlots(FILL_XML);
const fillPick = (label, kind) => fillParsed.slots.find((slot) => slot.label === label && (!kind || slot.kind === kind));
check('原表填值：栏目仍按整行小标题识别', fillParsed.headings.join('|') === '一、活动基本信息|二、活动内容',
  fillParsed.headings.join('|'));
check('原表填值：段首「活动名称：值」拆成字段，值只取冒号之后',
  fillPick('活动名称')?.kind === 'field' && fillPick('活动名称')?.now === '示例活动',
  JSON.stringify(fillPick('活动名称')));
check('原表填值：字段格里带空格的字段名也认得（活 动 地 点）',
  fillPick('活 动 地 点')?.now === '旧地点' && fillPick('活 动 地 点')?.kind === 'field');
check('原表填值：值是空的字段格给出插入位置', fillPick('活动时间')?.now === '' && Boolean(fillPick('活动时间')?.anchor),
  JSON.stringify(fillPick('活动时间')?.anchor));
check('原表填值：表头行不当空位，数据行按列名标注',
  fillParsed.slots.every((slot) => !['序号', '物品名称', '数量'].includes(slot.now))
  && fillParsed.slots.some((slot) => slot.label === '物品名称' && slot.now === '横幅'));
check('原表填值：数据行里的纯序号不当值', !fillParsed.slots.some((slot) => slot.now === '1' && slot.kind === 'cell'));
const fillPara = fillPick('（一）活动背景');
check('原表填值：整格正文连同小标题算一个空位，小标题留在结构里',
  fillPara?.kind === 'text' && fillPara?.now === '去年写的内容', JSON.stringify(fillPara));
check('原表填值：值区间不碰格子里的子表（子表文字不算值）',
  fillPara.ranges.every((range) => FILL_XML.slice(range.start, range.end) === '去年写的内容'),
  JSON.stringify(fillPara.ranges.map((r) => FILL_XML.slice(r.start, r.end))));
check('原表填值：封面文字也是空位（附件1 / 活动立项申报表）',
  fillParsed.slots.some((slot) => slot.now === '附件1') && fillParsed.slots.some((slot) => slot.now === '活动立项申报表'));

/* 起草值：项目信息表 → 参考表里的字段 */
const fillDraft = DX.fillDraft(fillParsed, {
  name: '2026 校园科技文化节', date: '2026-11-08', start: '09:30', end: '17:00', venue: '科创中心报告厅'
});
check('起草值：按字段名对上项目信息表（带空格与括注也能对）',
  fillDraft.values[fillPick('活 动 地 点').id] === '科创中心报告厅'
  && fillDraft.values[fillPick('活动名称', 'field').id] === '2026 校园科技文化节',
  JSON.stringify(fillDraft));
check('起草值：日期换成「年月日 + 时段」的写法',
  fillDraft.values[fillPick('活动时间').id] === '2026年11月8日 09:30—17:00',
  String(fillDraft.values[fillPick('活动时间').id]));
check('起草值：没对上的一律留空（保留参考原文）',
  fillDraft.values[fillPara.id] === undefined && fillDraft.matched === 3, String(fillDraft.matched));

/* 填值：只动值，不动结构 */
const fillEdit = {
  [fillPick('活 动 地 点').id]: '新地点',
  [fillPick('活动时间').id]: '2026年11月8日',
  [fillPara.id]: '今年的活动内容',
  [fillPick('物品名称').id]: '易拉宝'
};
const filledXml = DX.applyFill(FILL_XML, fillParsed, fillEdit);
check('填值：旧值被换掉、新值写进去', !filledXml.includes('旧地点') && !filledXml.includes('去年写的内容')
  && filledXml.includes('新地点') && filledXml.includes('今年的活动内容') && filledXml.includes('易拉宝'));
check('填值：栏目 / 表头 / 子表 / 封面结构一字不动',
  ['一、活动基本信息', '序号', '物品名称', '数量', '积分标准', '附件1', '（一）活动背景', '<w:tbl>']
    .every((token) => filledXml.includes(token)));
check('填值：空值格子插进新 run（连段落属性一起保留）',
  filledXml.includes('<w:r><w:t xml:space="preserve">2026年11月8日</w:t></w:r>'));
check('填值：XML 特殊字符被转义，不会破坏文档',
  DX.applyFill(FILL_XML, fillParsed, { [fillPick('活动名称').id]: 'A&B<C>' }).includes('A&amp;B&lt;C&gt;'));
check('填值：传空串表示这一格输出为空',
  !DX.applyFill(FILL_XML, fillParsed, { [fillPick('活 动 地 点').id]: '' }).includes('旧地点'));
check('填值：没给值的空位原样保留参考里的文字',
  DX.applyFill(FILL_XML, fillParsed, { [fillPara.id]: '改过' }).includes('旧地点'));
(() => {
  const spans = [];
  for (const slot of fillParsed.slots) {
    if (!(slot.id in fillEdit)) continue;
    const text = String(fillEdit[slot.id]).replace(/\s+/g, ' ').trim();
    if (slot.ranges.length) {
      spans.push({ start: slot.ranges[0].start, end: slot.ranges[0].end, text });
      for (const range of slot.ranges.slice(1)) spans.push({ start: range.start, end: range.end, text: '' });
    } else if (slot.anchor?.at != null) {
      spans.push({ start: slot.anchor.at, end: slot.anchor.at, text: '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r>' });
    } else if (slot.anchor?.replace) {
      spans.push({
        start: slot.anchor.replace.start,
        end: slot.anchor.replace.end,
        text: slot.anchor.replace.text + '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>'
      });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  let cursor = 0;
  let delta = 0;
  let bad = 0;
  for (const span of spans) {
    if (FILL_XML.slice(cursor, span.start) !== filledXml.slice(cursor + delta, span.start + delta)) bad += 1;
    delta += span.text.length - (span.end - span.start);
    cursor = span.end;
  }
  if (FILL_XML.slice(cursor) !== filledXml.slice(cursor + delta)) bad += 1;
  check('填值：除空位之外，正文逐字节与参考一致', bad === 0, `${bad} 段不一致`);
})();

/* 整包存档与重打包：字体清掉、其余部件逐字节照搬 */
const fontFixture = window.WB.ooxml.zip([
  { name: '[Content_Types].xml', data: RAW_XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscated-font"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>' },
  { name: 'word/document.xml', data: RAW_XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>活动名称</w:t></w:r></w:p></w:body></w:document>' },
  { name: 'word/styles.xml', data: RAW_XML + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/></w:style></w:styles>' },
  { name: 'word/settings.xml', data: RAW_XML + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:embedTrueTypeFonts/><w:zoom w:percent="100"/></w:settings>' },
  { name: 'word/fontTable.xml', data: RAW_XML + '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:font w:name="宋体"><w:embedRegular r:id="rId1" w:fontKey="{AAA}"/></w:font></w:fonts>' },
  { name: 'word/_rels/fontTable.xml.rels', data: RAW_XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font1.odttf"/></Relationships>' },
  { name: 'word/fonts/font1.odttf', data: new Uint8Array(2048).fill(7) },
  { name: 'word/media/logo.png', data: new Uint8Array([137, 80, 78, 71]) }
]);
const fontPkg = await DX.readPackage(fontFixture);
check('整包存档：部件带回来压缩方式 / CRC / 原始大小', Boolean(fontPkg)
  && fontPkg.entries.every((entry) => Number.isInteger(entry.crc) && entry.size >= 0 && entry.b64)
  && fontPkg.entries.length === 7, `${fontPkg?.entries.length} 个部件`);
check('整包存档：嵌入字体不进本地存档（省几百 KB）',
  !fontPkg.entries.some((entry) => /fonts\//.test(entry.name))
  && fontPkg.dropped.some((item) => /font1\.odttf/.test(item.name)),
  JSON.stringify(fontPkg.dropped));
const fontOut = await DX.fillPackage(fontPkg, RAW_XML + '<w:document><w:body><w:p><w:r><w:t>新内容</w:t></w:r></w:p></w:body></w:document>');
const fontEntries = window.WB.ooxml.readEntries(fontOut);
const fontText = (name) => new TextDecoder().decode((fontEntries.find((entry) => entry.name === name) || { data: new Uint8Array() }).data);
check('重打包：正文换成填好的，其余部件照搬（图片字节一致）',
  (await inflatePart(fontOut, 'word/document.xml')).includes('新内容')
  && fontEntries.find((entry) => entry.name === 'word/media/logo.png').data.length === 4
  && new TextDecoder().decode(fontEntries.find((entry) => entry.name === 'word/styles.xml').data).includes('Normal'));
check('重打包：丢掉字体后，内容类型 / 关系 / 字体表 / 设置里的印记一并清掉',
  !fontEntries.some((entry) => /fonts\//.test(entry.name))
  && !fontText('[Content_Types].xml').includes('odttf')
  && !fontText('word/_rels/fontTable.xml.rels').includes('font1.odttf')
  && !fontText('word/fontTable.xml').includes('w:embedRegular')
  && !fontText('word/settings.xml').includes('embedTrueTypeFonts'));
check('重打包：条目 CRC 与解压后大小自洽（Word 能正常打开的关键）', (() => {
  const list = DX.listEntries(fontOut);
  return list.length === fontEntries.length && list.every((entry) => entry.method === 0 || entry.method === 8);
})());
const noDocPkg = await DX.readPackage(window.WB.ooxml.zip([{ name: 'a.txt', data: 'x' }]));
check('整包存档：没有 document.xml 的包直接判为不可用', noDocPkg === null);

/* 嵌套表格：最外层表格算一个块，里面的子表不当独立块 */
const nestedRanges = DX.blockRanges(FILL_XML);
const nestedTbl = nestedRanges.find((range) => range.tag === 'tbl');
check('结构扫描：整张表算一个块（子表不会被非贪心正则截断）',
  nestedRanges.filter((range) => range.tag === 'tbl').length === 1
  && FILL_XML.slice(nestedTbl.start, nestedTbl.end).includes('积分标准')
  && !nestedRanges.some((range) => range.tag === 'tbl' && range.start > nestedTbl.start),
  JSON.stringify(nestedRanges.map((range) => range.tag)));

/* 界面接线：上传参考时整包一起存、面板可渲染、只读访客改不动 */
const fillPrevUser = state.user;
const fillHadOutput = Boolean(state.project.outputs[refKey]);
const fillPrevMaterial = state.materials[refKey];
store.setUser({ name: '参考测试同学', role: 'organizer' });
state.project.outputs[refKey] = true;
state.fillDrafts = {};
await window.WB.views.material.uploadReference(refKey, { name: '学院申报表样表.docx', arrayBuffer: async () => fontFixture.slice().buffer });
const storedRef = state.references[refKey];
check('上传参考：整包一起存档，可以按原表填值',
  Boolean(storedRef?.package) && storedRef.package.entries.length === 7, JSON.stringify(storedRef?.package?.entries?.length));
const viewFill = await window.WB.views.material.fillModel(refKey);
check('参考表填值：解析出空位表，并从项目信息表推出默认值',
  viewFill.model.slots.length > 0 && typeof viewFill.draft.values === 'object',
  `${viewFill.model.slots.length} 个空位`);
const fillPanelHtml = window.WB.views.material.fillPanel(refKey);
check('参考表填值面板：空位输入框 / 置空开关 / 三个范围都在',
  ['data-fill-panel', 'data-fill-input', 'data-fill-blank', '字段与段落', '仅字段', '全部空位']
    .every((token) => fillPanelHtml.includes(token)));
check('参考表填值面板：说明写清「留空 = 保留参考原文」', fillPanelHtml.includes('保留参考里的文字'));
const fillSlot = viewFill.model.slots[0];
window.WB.views.material.setFillValue(refKey, fillSlot.id, '手填的值');
check('参考表填值：手改记在 fillDrafts 上（空的值会被删掉）',
  state.fillDrafts[refKey][fillSlot.id] === '手填的值' && window.WB.views.material.fillValues(refKey, viewFill)[fillSlot.id] === '手填的值');
window.WB.views.material.setFillValue(refKey, fillSlot.id, viewFill.draft.values[fillSlot.id] || '');
check('参考表填值：改回默认值时不留手改痕迹', state.fillDrafts[refKey][fillSlot.id] === undefined);
store.setUser({ name: '只读访客', role: 'viewer' });
window.WB.views.material.setFillValue(refKey, fillSlot.id, '访客不该写进去');
check('参考表填值：只读访客改不动填值表', state.fillDrafts[refKey][fillSlot.id] === undefined);
store.setUser({ name: '参考测试同学', role: 'organizer' });
let fillBlob = null;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
URL.createObjectURL = (blob) => { fillBlob = blob; return 'blob:selftest'; };
URL.revokeObjectURL = noop;
const fillDownloaded = await window.WB.views.material.fillFromReference(refKey);
URL.createObjectURL = realCreate;
URL.revokeObjectURL = realRevoke;
const fillOutBytes = fillBlob ? new Uint8Array(await fillBlob.arrayBuffer()) : new Uint8Array();
const fillOutEntries = window.WB.ooxml.readEntries(fillOutBytes);
check('参考表填值：导出走的是参考包本身（同一批部件、同一张表）',
  fillDownloaded === true && fillOutEntries.length === 7
  && fillOutEntries.some((entry) => entry.name === 'word/media/logo.png'));
check('参考表填值：导出的正文里保留参考的结构文字',
  (await inflatePart(fillOutBytes, 'word/document.xml')).includes('活动名称'));

/* 挂了参考件之后，卡片上的 Word 默认导「参考原表」，AI 正文退成第二颗按钮 */
const keepMaterialPhase = state.ui.materialPhase;
const cardDocBackup = state.materials[refKey];
state.materials[refKey] = cardDocBackup || {
  title: '2026 校园科技文化节｜活动申报表',
  sections: [{ heading: '一、活动基本信息', body: '| 字段 | 内容 |\n| --- | --- |\n| 活动名称 | 2026 校园科技文化节 |' }]
};
state.ui.materialPhase = 'all';
window.WB.views.material.render();
const refCardHtml = elementFor('materialList').innerHTML;
state.ui.materialPhase = keepMaterialPhase;
check('挂了参考件：卡片 Word 默认走「参考原表」',
  refCardHtml.includes('data-material-fill-export=') && refCardHtml.includes('Word（参考原表）'));
check('挂了参考件：AI 正文的 Word 退成第二颗按钮并标清用途',
  refCardHtml.includes('Word（正文）') && refCardHtml.includes('material-export-hint'));
check('挂了参考件：点「Word（参考原表）」走的就是参考包导出',
  typeof window.WB.views.material.fillFromReference === 'function' && fillOutEntries.length === 7);

/* 升级之前挂的参考只有栏目 / 字段 / 版式，没有整包快照，要提示重新上传 */
const keepPkg = state.references[refKey].package;
delete state.references[refKey].package;
window.WB.views.material.render();
const staleCardHtml = elementFor('materialList').innerHTML;
check('旧参考（没整包快照）：卡片提示重传后可用「参考原表」，且不谎报可填值',
  staleCardHtml.includes('重传参考可用') && !staleCardHtml.includes('data-material-fill-export'));
state.references[refKey].package = keepPkg;

/* ── AI 补空位：上下文与「生成正文」同源、数字格也发、一批 12 个、每个 id 都要回 ──
   把基本信息清空 + 换掉参考 id 逼它重新建空位表，这样所有空位都是「待补」状态。 */
const keepBasic = state.project.basic;
const keepRefId = state.references[refKey].id;
state.project.basic = {};
state.references[refKey].id = 'ref-ai-fill-test';
state.fillDrafts[refKey] = {};
const prevFillFetch = globalThis.fetch;
const fillCalls = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options?.body || '{}');
  if (String(url).includes('/api/health')) return { ok: true, json: async () => ({ providers: { deepseek: true, yoshub: false } }) };
  if (String(url).includes('/api/material')) {
    fillCalls.push(body.input);
    return { ok: true, json: async () => ({ data: { values: (body.input.空位 || []).map((slot, index) => ({ id: slot.id, value: index % 2 ? '' : `AI-${slot.id}` })) } }) };
  }
  return { ok: true, json: async () => ({}) };
};
await window.WB.ai.check();
const aiFilled = await window.WB.views.material.aiFillSlots(refKey);
globalThis.fetch = prevFillFetch;
await window.WB.ai.check();
state.project.basic = keepBasic;
state.references[refKey].id = keepRefId;
const firstFillCall = fillCalls[0] || {};
const aiSlots = (await window.WB.views.material.fillModel(refKey)).model.slots;
const cellSlots = aiSlots.filter((slot) => slot.kind === 'cell').length;
check('AI 补空位：确实发出去了请求，且一次最多 12 个空位',
  fillCalls.length >= 1 && fillCalls.every((input) => input.空位.length > 0 && input.空位.length <= 12),
  `${fillCalls.length} 批`);
check('AI 补空位：表格数据格也发出去（不再整类跳过）',
  cellSlots === 0 || fillCalls[0].空位.some((slot) => slot.类型), `cell 空位 ${cellSlots} 个`);
check('AI 补空位：上下文与生成同源（基本信息 / 任务分解 / 风险台账 / 资源台账 / 参考样例）',
  ['项目信息表', '任务分解', '风险台账', '资源台账', '参考样例'].every((key) => key in firstFillCall));
check('AI 补空位：参考原文截到 3000 字，清单不会被 40k 输入上限挤掉',
  String(firstFillCall.参考样例?.原文 || '').length <= 3000 && Array.isArray(firstFillCall.空位));
check('AI 补空位：约束要求每个 id 都回一行、数字格不许编',
  /每一个 id/.test(firstFillCall.约束 || '') && /数字格/.test(firstFillCall.约束 || ''));
check('AI 补空位：值写进 fillDrafts，空串不回写',
  aiFilled === true && Object.values(state.fillDrafts[refKey] || {}).filter((value) => value !== '').length > 0
  && Object.values(state.fillDrafts[refKey] || {}).every((value) => value !== ''));
check('AI 补空位：三种返回形状都能解析（数组 / values 数组 / id→value 映射）',
  window.WB.views.material.normaliseFillRows({ values: [{ id: 'a', value: '甲' }] }, [{ id: 'a' }]).length === 1
  && window.WB.views.material.normaliseFillRows({ values: { a: '甲' } }, [{ id: 'a' }])[0].value === '甲'
  && window.WB.views.material.normaliseFillRows([{ id: 'a', value: { value: '甲' } }], [{ id: 'a' }])[0].value === '甲'
  && window.WB.views.material.normaliseFillRows({ values: [{ id: 'zz', value: '甲' }] }, [{ id: 'a' }]).length === 0);

/* 逐格填空：一次只看一格，AI 也只问这一格。
   R19 那份参考件只有 1 个空位，翻页与跳空格测不出来，这里单独造一份两格的参考件。 */
const stepFixture = window.WB.ooxml.zip([
  { name: '[Content_Types].xml', data: `${RAW_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>` },
  { name: 'word/document.xml', data: `${RAW_XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>活动名称：</w:t></w:r></w:p><w:p><w:r><w:t>活动地点：</w:t></w:r></w:p></w:body></w:document>` }
]);
const stepKey = 'proposal';
await window.WB.views.material.uploadReference(stepKey, { name: '逐格测试.docx', arrayBuffer: async () => stepFixture.slice().buffer });
/* 清掉项目信息表，让两格都是空的，导航与「跳空格」才有确定行为 */
const stepBasicBackup = state.project.basic;
state.project.basic = {};
state.fillDrafts[stepKey] = {};
state.references[stepKey].id = 'ref-step-test';
const stepModel = await window.WB.views.material.fillModel(stepKey);
window.WB.views.material.toggleFillStep(stepKey);
const stepHtml = window.WB.views.material.fillPanel(stepKey);
const stepList = window.WB.views.material.fillStepSlots(stepKey, stepModel);
const stepStart = window.WB.views.material.fillStepIndex(stepKey, stepList);
check('逐格填空：切换后面板一次只显示一格',
  window.WB.views.material.fillStepOn(stepKey) === true && stepList.length >= 2
  && stepHtml.includes('data-fill-step-body') && !stepHtml.includes('class="fill-group"'),
  `空位 ${stepList.length} 个`);
check('逐格填空：标出第几格 / 共几格，并带上一格 / 下一格 / 跳空格 / 置空 / 单格 AI',
  stepHtml.includes(`第 ${stepStart + 1} / ${stepList.length} 格`) && stepHtml.includes('data-fill-step-prev')
  && stepHtml.includes('data-fill-step-next') && stepHtml.includes('data-fill-step-skip')
  && stepHtml.includes('data-fill-step-blank') && stepHtml.includes('data-fill-step-ai'));
window.WB.views.material.fillStepMove(stepKey, 1);
check('逐格填空：下一格往后走一格',
  window.WB.views.material.fillStepIndex(stepKey, stepList) === Math.min(stepStart + 1, stepList.length - 1));
window.WB.views.material.fillStepMove(stepKey, -9);
check('逐格填空：往前越界时停在第一格', window.WB.views.material.fillStepIndex(stepKey, stepList) === 0);
const oneCalls = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options?.body || '{}');
  if (String(url).includes('/api/health')) return { ok: true, json: async () => ({ providers: { deepseek: true, yoshub: false } }) };
  if (String(url).includes('/api/material')) {
    oneCalls.push(body.input);
    return { ok: true, json: async () => ({ data: { values: [{ id: body.input.空位[0].id, value: '单格值', basis: '任务分解' }] } }) };
  }
  return { ok: true, json: async () => ({}) };
};
await window.WB.ai.check();
const stepFirst = stepList[0];
const oneOk = await window.WB.views.material.aiFillOne(stepKey, stepFirst.id);
check('逐格填空：AI 一次只问一个空位，值写回该格',
  oneOk === true && oneCalls.length === 1 && oneCalls[0].空位.length === 1
  && state.fillDrafts[stepKey][stepFirst.id] === '单格值');
check('逐格填空：AI 给出的依据会记下来供界面显示',
  window.WB.views.material.fillBasisOf(stepKey, stepFirst.id) === '任务分解');
check('逐格填空：跳到下一个空格会跳过已填的格子',
  window.WB.views.material.fillStepSeek(stepKey, 1) === true
  && window.WB.views.material.fillStepIndex(stepKey, stepList) === 1);
const stepSecond = stepList[1];
await window.WB.views.material.aiFillOne(stepKey, stepSecond.id);
globalThis.fetch = prevFillFetch;
await window.WB.ai.check();
check('逐格填空：全部填满后再跳空格会如实说没有',
  window.WB.views.material.fillStepSeek(stepKey, 1) === false);
window.WB.views.material.toggleFillStep(stepKey);
check('逐格填空：再点一次回到列表视图',
  window.WB.views.material.fillStepOn(stepKey) === false
  && window.WB.views.material.fillPanel(stepKey).includes('class="fill-group"'));
state.project.basic = stepBasicBackup;
delete state.references[stepKey];
delete state.fillDrafts[stepKey];

if (cardDocBackup) state.materials[refKey] = cardDocBackup; else delete state.materials[refKey];
delete state.references[refKey];
if (fillPrevMaterial) state.materials[refKey] = fillPrevMaterial; else delete state.materials[refKey];
if (!fillHadOutput) delete state.project.outputs[refKey];
state.fillDrafts = {};
if (fillPrevUser) store.setUser(fillPrevUser); else store.signOut();

/* ── 14. 表格容错：表头写短了 / 漏写表头，都不许丢列 ── */
const MDL = window.WB.markdown;
const shortHead = MDL.parseBlocks('| 阶段 |\n| --- | --- | --- |\n| 前期策划 | 编制预算表 | 策划组 |')[0];
check('表格容错：表头比数据短时补到最宽行的列数（后面的格子不再被裁掉）',
  shortHead.type === 'table' && shortHead.header.length === 3 && shortHead.rows[0].join('|') === '前期策划|编制预算表|策划组',
  JSON.stringify({ header: shortHead.header, rows: shortHead.rows }));
const blankHead = MDL.parseBlocks('|  |  |\n| --- | --- |\n| 甲 | 乙 |')[0];
check('表格容错：空表头同样按最宽行补齐，数据一行不丢',
  blankHead.type === 'table' && blankHead.header.length === 2 && blankHead.rows[0].join('|') === '甲|乙');
const noHead = MDL.parseBlocks('| --- | --- |\n| 前期策划 | 编制预算表 |\n| 活动筹备 | 设计海报 |')[0];
check('表格容错：漏写表头的表也能认出来（不再退化成一堆竖线文本）',
  noHead.type === 'table' && noHead.header.every((cell) => cell === '') && noHead.rows.length === 2 && noHead.rows[0].join('|') === '前期策划|编制预算表');
const noHeadXml = new TextDecoder('utf-8').decode(window.WB.ooxml.readEntries(
  window.WB.ooxml.docx({ title: 't', blocks: [noHead], style: null })).find((entry) => entry.name === 'word/document.xml').data);
check('表格容错：无表头表格在 Word 里不画空表头行', (noHeadXml.match(/<w:tr>/g) || []).length === 2 && (noHeadXml.match(/<w:tc>/g) || []).length === 4);
check('表格容错：无表头表格在预览里也不画空表头行', !MDL.toHtml('| --- | --- |\\n| 前期策划 | 编制预算表 |').includes('<thead>'));
const looseText = MDL.parseBlocks('| --- | --- |\n| 前期策划 | 编制预算表 |').filter((block) => block.type === 'paragraph').length;
check('表格容错：无表头表格不再落成段落文本', looseText === 0);
const wordShort = window.WB.ooxml.docx({ title: 't', blocks: [{ type: 'table', header: ['阶段'], rows: [['a', 'b', 'c']] }], style: null });
const wordShortXml = new TextDecoder('utf-8').decode(window.WB.ooxml.readEntries(wordShort).find((entry) => entry.name === 'word/document.xml').data);
check('Word 导出：表格格数按最宽行算，表头短也不吞列',
  (wordShortXml.match(/<w:tc>/g) || []).length === 6, String((wordShortXml.match(/<w:tc>/g) || []).length));
const wordEmptyHead = window.WB.ooxml.docx({ title: 't', blocks: [{ type: 'table', header: [], rows: [['a', 'b']] }], style: null });
const wordEmptyXml = new TextDecoder('utf-8').decode(window.WB.ooxml.readEntries(wordEmptyHead).find((entry) => entry.name === 'word/document.xml').data);
check('Word 导出：空表头不再生成没有格子的空行，也不多挂一排空格子',
  (wordEmptyXml.match(/<w:tc>/g) || []).length === 2 && (wordEmptyXml.match(/<w:tr>/g) || []).length === 1 && !/<w:tr><\/w:tr>/.test(wordEmptyXml));

console.log(`\n结构化活动工作台 · 离线自测`);
console.log(`模块 ${MODULES.length} 个 · 断言 ${checks} 项 · 失败 ${failures.length} 项`);
if (failures.length) {
  console.log('');
  for (const item of failures) console.log(`  ✗ ${item}`);
  console.log('');
  process.exit(1);
}
console.log('  ✓ 全部通过\n');
