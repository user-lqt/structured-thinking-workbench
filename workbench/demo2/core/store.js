/* 状态层：多项目库、本地身份、持久化、v1/v2 → v3 迁移、变更记录、项目包导入导出。
 *
 * 存储布局：
 *   demo2-workbench-v3      项目库索引 { user, projects[], activeId, view, ui }
 *   demo2-project-v3-<id>   单个项目的完整文档（含素材 DataURL，分开放避免互相拖累）
 */
window.WB = window.WB || {};

(function () {
  const { uid, text } = window.WB.util;

  const INDEX_KEY = 'demo2-workbench-v3';
  const LEGACY_V2 = 'demo2-workbench-v2';
  const LEGACY_V1 = 'demo2-workbench-v1';
  const DOC_PREFIX = 'demo2-project-v3-';
  const VERSION = 3;
  const LOG_LIMIT = 300;

  /* 这些键属于「单个项目」，按项目分文件存储；其余属于全局索引。 */
  const DOC_KEYS = ['project', 'wbs', 'risks', 'riskCompliance', 'options', 'gates', 'gateMeta',
    'materials', 'templates', 'materialTemplates', 'assets', 'poster', 'resources', 'drills', 'log'];

  const nowIso = () => new Date().toISOString();

  function freshProject() {
    return { basic: {}, outputs: {}, meta: { basic: {}, outputs: {} }, createdAt: nowIso() };
  }

  function freshProjectDoc() {
    return {
      project: null,
      wbs: [],
      risks: [],
      riskCompliance: [],
      options: { selected: [], criteria: [], scores: {}, decision: '', note: '' },
      gates: { plan: {}, prepare: {}, execute: {}, close: {} },
      /* 每个检查点的确认来源：source=auto 表示系统按证据自动勾上，muted=人手动取消过 */
      gateMeta: { plan: {}, prepare: {}, execute: {}, close: {} },
      materials: {},
      templates: [],
      materialTemplates: {},
      assets: [],
      poster: {},
      resources: [],
      drills: [],
      log: []
    };
  }

  function freshState() {
    return {
      version: VERSION,
      user: null,
      projects: [],
      activeId: null,
      ...freshProjectDoc(),
      view: 'overview',
      ui: {
        taskView: 'table', materialPhase: 'all', openMaterial: null,
        riskFilter: null, gatePhase: 'plan', assetKind: '', assetPhase: '',
        resourceKind: '', resourcePhase: '', drillId: null, drillCategory: '', projectFilter: 'active'
      }
    };
  }

  /* ── 归一化 ───────────────────────────── */

  function normaliseRow(row) {
    return {
      id: row.id || uid('task'),
      phase: window.WB.util.PHASE_ORDER[row.phase] != null ? row.phase : 'plan',
      task: text(row.task),
      owner: text(row.owner),
      due: text(row.due),
      duration: row.duration === '' || row.duration == null ? '' : Number(row.duration) || '',
      output: text(row.output),
      depends: text(row.depends),
      status: ['todo', 'doing', 'blocked', 'done'].includes(row.status) ? row.status : 'todo',
      progress: Number.isFinite(Number(row.progress)) ? Math.min(100, Math.max(0, Math.round(Number(row.progress)))) : 0,
      milestone: row.milestone === true || row.milestone === 'true' || row.milestone === 'yes',
      source: row.source || 'user'
    };
  }

  function normaliseRisk(risk) {
    return {
      name: text(risk.name),
      category: risk.category || 'safety',
      phase: risk.phase || 'prepare',
      task: text(risk.task),
      probability: Number(risk.probability) || 3,
      impact: Number(risk.impact) || 3,
      trigger: text(risk.trigger),
      prevention: text(risk.prevention),
      response: text(risk.response),
      escalation: text(risk.escalation),
      owner: text(risk.owner),
      source: risk.source || 'user'
    };
  }

  function normaliseResource(item) {
    const available = Number(item.available);
    const assigned = Number(item.assigned);
    return {
      id: item.id || uid('res'),
      name: text(item.name),
      kind: window.WB.util.RESOURCE_KINDS.some((k) => k.value === item.kind) ? item.kind : 'staff',
      phase: window.WB.util.PHASE_ORDER[item.phase] != null ? item.phase : 'prepare',
      unit: text(item.unit) || '个',
      available: Number.isFinite(available) ? Math.max(0, available) : 0,
      assigned: Number.isFinite(assigned) ? Math.max(0, assigned) : 0,
      owner: text(item.owner),
      note: text(item.note),
      source: item.source || 'user'
    };
  }

  function normaliseDrill(item) {
    return {
      id: item.id || uid('drill'),
      scenarioId: text(item.scenarioId),
      title: text(item.title),
      category: text(item.category),
      phase: window.WB.util.PHASE_ORDER[item.phase] != null ? item.phase : 'execute',
      riskName: text(item.riskName),
      startedAt: item.startedAt || nowIso(),
      finishedAt: item.finishedAt || '',
      decisions: text(item.decisions),
      outcome: text(item.outcome),
      rollback: text(item.rollback),
      followUp: Array.isArray(item.followUp) ? item.followUp.map(String) : [],
      writeRisk: item.writeRisk !== false,
      aiRisk: item.aiRisk && typeof item.aiRisk === 'object' ? item.aiRisk : null,
      status: ['running', 'done'].includes(item.status) ? item.status : 'running',
      steps: Array.isArray(item.steps) ? item.steps.map((step, index) => ({
        id: text(step.id) || `${item.id || 'drill'}-s${index + 1}`,
        text: text(step.text),
        done: Boolean(step.done),
        note: text(step.note)
      })) : [],
      source: item.source || 'user'
    };
  }

  function migrateDoc(raw) {
    const doc = freshProjectDoc();
    doc.project = raw.project || null;
    if (doc.project) {
      doc.project.basic ||= {};
      doc.project.outputs ||= {};
      doc.project.meta ||= { basic: {}, outputs: {} };
      doc.project.meta.basic ||= {};
      doc.project.meta.outputs ||= {};
    }
    doc.wbs = (raw.wbs || []).map(normaliseRow);
    doc.risks = (raw.risks || []).map(normaliseRisk);
    doc.riskCompliance = Array.isArray(raw.riskCompliance) ? raw.riskCompliance.map(String) : [];
    doc.materials = raw.materials || {};
    doc.templates = raw.templates || [];
    doc.materialTemplates = raw.materialTemplates || {};
    doc.options = { ...freshProjectDoc().options, ...(raw.options || {}) };
    doc.assets = raw.assets || [];
    doc.poster = raw.poster && typeof raw.poster === 'object' ? raw.poster : {};
    doc.resources = Array.isArray(raw.resources) ? raw.resources.map(normaliseResource) : [];
    doc.drills = Array.isArray(raw.drills) ? raw.drills.map(normaliseDrill) : [];
    doc.gates = { ...freshProjectDoc().gates, ...(raw.gates || {}) };
    doc.gateMeta = { ...freshProjectDoc().gateMeta, ...(raw.gateMeta || {}) };
    doc.log = Array.isArray(raw.log) ? raw.log : [];
    return doc;
  }

  /* ── 内存状态 ─────────────────────────── */

  let state = freshState();

  function docOf(source) {
    const doc = {};
    for (const key of DOC_KEYS) doc[key] = source[key];
    return doc;
  }

  function applyDoc(doc) {
    for (const key of DOC_KEYS) state[key] = doc[key];
  }

  function summarise(index) {
    const entry = index.projects.find((item) => item.id === index.activeId);
    if (!entry) return;
    const basic = index.project?.basic || {};
    entry.name = text(basic.name) || entry.name || '未命名活动';
    entry.type = text(basic.type) || entry.type || '';
    entry.date = text(basic.date) || entry.date || '';
    entry.venue = text(basic.venue) || entry.venue || '';
    entry.updatedAt = nowIso();
    /* 项目库卡片用的进度快照：只反映最近一次保存时的状态 */
    entry.tasks = index.wbs.length;
    entry.risks = index.risks.length;
    entry.materials = Object.keys(index.materials || {}).length;
    entry.percent = window.WB.wbs ? window.WB.wbs.overall(index.wbs).percent : 0;
  }

  function indexPayload() {
    summarise(state);
    return {
      version: VERSION,
      user: state.user,
      projects: state.projects,
      activeId: state.activeId,
      view: state.view,
      ui: state.ui,
      savedAt: nowIso()
    };
  }

  function save() {
    try {
      if (state.activeId) {
        const doc = { ...docOf(state), id: state.activeId, updatedAt: nowIso() };
        localStorage.setItem(DOC_PREFIX + state.activeId, JSON.stringify(doc));
      }
      localStorage.setItem(INDEX_KEY, JSON.stringify(indexPayload()));
    } catch (error) {
      window.WB.toast?.('本地存储写入失败，可能已超出浏览器容量限制；建议导出项目包后清理素材');
      console.warn('[工作台] 保存失败', error);
    }
  }

  /* ── 载入与迁移 ───────────────────────── */

  function readDoc(id) {
    try {
      const raw = JSON.parse(localStorage.getItem(DOC_PREFIX + id) || 'null');
      return raw ? migrateDoc(raw) : null;
    } catch {
      return null;
    }
  }

  function entryFromDoc(id, doc, extra = {}) {
    const basic = doc.project?.basic || {};
    return {
      id,
      name: text(basic.name) || '未命名活动',
      type: text(basic.type) || '',
      date: text(basic.date) || '',
      venue: text(basic.venue) || '',
      createdAt: doc.project?.createdAt || nowIso(),
      updatedAt: nowIso(),
      tasks: doc.wbs.length,
      risks: doc.risks.length,
      materials: Object.keys(doc.materials || {}).length,
      percent: 0,
      archived: false,
      ...extra
    };
  }

  function load() {
    /* v3：索引 + 项目文档 */
    try {
      const index = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
      if (index && typeof index === 'object' && Array.isArray(index.projects)) {
        const next = freshState();
        next.user = index.user && index.user.name ? index.user : null;
        next.projects = index.projects;
        next.activeId = index.projects.some((item) => item.id === index.activeId) ? index.activeId : (index.projects[0]?.id || null);
        next.view = index.view || 'overview';
        next.ui = { ...freshState().ui, ...(index.ui || {}) };
        const doc = next.activeId ? readDoc(next.activeId) : null;
        applyDocTo(next, doc || freshProjectDoc());
        return next;
      }
    } catch { /* 索引损坏则继续尝试旧版本 */ }

    /* v2 / v1：单项目版本，整体迁移成一个项目 */
    for (const key of [LEGACY_V2, LEGACY_V1]) {
      try {
        const raw = JSON.parse(localStorage.getItem(key) || 'null');
        if (!raw || typeof raw !== 'object') continue;
        const next = freshState();
        next.user = null;
        const doc = migrateDoc(raw);
        const id = uid('proj');
        next.projects = [entryFromDoc(id, doc)];
        next.activeId = id;
        next.view = raw.view || 'overview';
        const legacyUi = { openMaterial: raw.openMaterial ?? null, riskFilter: raw.riskFilter ?? null };
        next.ui = { ...next.ui, ...(raw.ui || {}), ...legacyUi };
        applyDocTo(next, doc);
        localStorage.setItem(DOC_PREFIX + id, JSON.stringify({ ...doc, id, updatedAt: nowIso() }));
        localStorage.setItem(INDEX_KEY, JSON.stringify(indexPayloadOf(next)));
        return next;
      } catch { /* 忽略损坏的本地数据 */ }
    }
    return freshState();
  }

  /* load() 阶段 state 还没赋值，用不上 save()，这里提供纯函数版本 */
  function applyDocTo(target, doc) {
    for (const key of DOC_KEYS) target[key] = doc[key];
  }

  function indexPayloadOf(source) {
    const entry = source.projects.find((item) => item.id === source.activeId);
    if (entry) {
      const basic = source.project?.basic || {};
      entry.name = text(basic.name) || entry.name;
      entry.type = text(basic.type) || '';
      entry.date = text(basic.date) || '';
      entry.venue = text(basic.venue) || '';
      entry.updatedAt = nowIso();
    }
    return {
      version: VERSION, user: source.user, projects: source.projects,
      activeId: source.activeId, view: source.view, ui: source.ui, savedAt: nowIso()
    };
  }

  state = load();

  /* ── 项目库操作 ───────────────────────── */

  function createProject(basic = {}) {
    if (state.activeId) save();
    const id = uid('proj');
    const doc = freshProjectDoc();
    doc.project = freshProject();
    doc.project.basic = { ...basic };
    const entry = entryFromDoc(id, doc);
    entry.archived = false;
    state.projects.unshift(entry);
    state.activeId = id;
    applyDoc(doc);
    state.view = 'manifest';
    save();
    return id;
  }

  /* 向导提交时若还没有项目槽位，先补一个空的 */
  function ensureProject() {
    if (!state.activeId) createProject();
    if (!state.project) state.project = freshProject();
    return state.activeId;
  }

  function switchProject(id) {
    if (!id || id === state.activeId) return false;
    const doc = readDoc(id);
    if (!doc) return false;
    save();
    state.activeId = id;
    applyDoc(doc);
    state.view = 'overview';
    state.ui = { ...freshState().ui, openMaterial: null, riskFilter: null };
    save();
    return true;
  }

  function renameProject(id, name) {
    const entry = state.projects.find((item) => item.id === id);
    if (!entry) return;
    entry.name = text(name) || '未命名活动';
    if (id === state.activeId && state.project) state.project.basic.name = entry.name;
    save();
  }

  function archiveProject(id, archived = true) {
    const entry = state.projects.find((item) => item.id === id);
    if (!entry) return;
    entry.archived = Boolean(archived);
    save();
  }

  function deleteProject(id) {
    const at = state.projects.findIndex((item) => item.id === id);
    if (at < 0) return;
    state.projects.splice(at, 1);
    try { localStorage.removeItem(DOC_PREFIX + id); } catch { /* 忽略 */ }
    if (state.activeId === id) {
      const next = state.projects.find((item) => !item.archived) || state.projects[0];
      if (next) {
        state.activeId = next.id;
        applyDoc(readDoc(next.id) || freshProjectDoc());
      } else {
        state.activeId = null;
        applyDoc(freshProjectDoc());
      }
    }
    save();
  }

  function duplicateProject(id) {
    const doc = id === state.activeId ? docOf(state) : readDoc(id);
    if (!doc) return null;
    const copy = migrateDoc(JSON.parse(JSON.stringify(doc)));
    const newId = uid('proj');
    copy.project ||= freshProject();
    copy.project.basic = { ...copy.project.basic, name: `${text(copy.project.basic?.name) || '未命名活动'}（副本）` };
    copy.log = [{ at: nowIso(), kind: 'project', detail: '由已有项目复制而来' }];
    state.projects.unshift(entryFromDoc(newId, copy));
    state.activeId = newId;
    applyDoc(copy);
    save();
    return newId;
  }

  /* 清空当前项目内容（保留项目槽位） */
  function reset() {
    const doc = freshProjectDoc();
    applyDoc(doc);
    const entry = state.projects.find((item) => item.id === state.activeId);
    if (entry) { entry.name = '未命名活动'; entry.type = ''; entry.date = ''; entry.venue = ''; }
    save();
  }

  /* 清空全部本地数据（所有项目 + 身份） */
  function clearAll() {
    try {
      for (const entry of state.projects) localStorage.removeItem(DOC_PREFIX + entry.id);
      localStorage.removeItem(INDEX_KEY);
      localStorage.removeItem(LEGACY_V2);
      localStorage.removeItem(LEGACY_V1);
    } catch { /* 忽略 */ }
    state = freshState();
  }

  function setUser(user) {
    state.user = user && user.name ? { name: text(user.name), role: user.role || 'member' } : null;
    save();
  }

  function signOut() {
    state.user = null;
    save();
  }

  /* ── 变更记录 ─────────────────────────── */

  function log(kind, detail) {
    state.log.unshift({ at: nowIso(), kind, detail: text(detail), by: state.user?.name || '未登录' });
    if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
  }

  function projectName() {
    return text(state.project?.basic?.name) || '未命名活动';
  }

  /* ── 项目包 ───────────────────────────── */

  function exportBundle() {
    return {
      format: 'structured-activity-workbench',
      version: VERSION,
      exportedAt: nowIso(),
      ...docOf(state),
      ui: state.ui
    };
  }

  function importBundle(bundle, { asNew = true } = {}) {
    if (!bundle || typeof bundle !== 'object') throw new Error('项目包内容为空或格式不正确');
    if (bundle.format && bundle.format !== 'structured-activity-workbench') throw new Error('不是本工作台导出的项目包');
    const doc = migrateDoc(bundle);
    doc.project ||= freshProject();
    if (asNew) {
      if (state.activeId) save();
      const id = uid('proj');
      state.projects.unshift(entryFromDoc(id, doc));
      state.activeId = id;
      applyDoc(doc);
    } else {
      applyDoc(doc);
    }
    log('import', asNew ? '导入为一份新项目' : '导入并覆盖当前项目');
    save();
    return state.activeId;
  }

  window.WB.store = {
    INDEX_KEY,
    DOC_PREFIX,
    VERSION,
    get state() { return state; },
    set state(next) { state = next; },
    freshState,
    freshProject,
    freshProjectDoc,
    normaliseRow,
    normaliseRisk,
    normaliseResource,
    normaliseDrill,
    migrateDoc,
    save,
    replace: (next) => { const doc = migrateDoc(next); applyDoc(doc); save(); },
    reset,
    clearAll,
    createProject,
    ensureProject,
    switchProject,
    renameProject,
    archiveProject,
    deleteProject,
    duplicateProject,
    setUser,
    signOut,
    log,
    projectName,
    exportBundle,
    importBundle
  };
}());
