/* 基础工具与常量：全站共享的派生常量、DOM 助手、格式化与下载。 */
window.WB = window.WB || {};

(function () {
  const MANIFEST = window.SKILLS.manifest;
  const WBS = window.SKILLS.wbs;
  const RISK = window.SKILLS.risk;

  /* 资源台账：六类资源与默认计量单位，供资源视图与演练上下文共用 */
  const RESOURCE_KINDS = [
    { value: 'staff', label: '人员', unit: '人' },
    { value: 'venue', label: '场地', unit: '处' },
    { value: 'equipment', label: '设备', unit: '台' },
    { value: 'material', label: '物料', unit: '件' },
    { value: 'fund', label: '经费', unit: '元' },
    { value: 'vehicle', label: '车辆', unit: '辆' }
  ];

  /* 本地演示身份：这不是真实鉴权，只是本地角色开关，用来演示协作与只读边界 */
  const ROLES = [
    { value: 'organizer', label: '活动组织者', hint: '可管理项目库、删除项目与全部内容' },
    { value: 'member', label: '活动成员', hint: '可编辑内容与运行演练，不能删除项目' },
    { value: 'viewer', label: '只读访客', hint: '只能查看与导出，所有写入按钮禁用' }
  ];

  const consts = {
    MANIFEST,
    WBS,
    RISK,
    GATES: window.SKILLS.gates,
    DECISION: window.SKILLS.decision,
    BASIC_FIELDS: MANIFEST.sections.find((s) => s.id === 'basic').fields,
    OUTPUT_ITEMS: MANIFEST.sections.find((s) => s.id === 'outputs').items,
    PHASES: WBS.phases,
    PHASE_LABEL: Object.fromEntries(WBS.phases.map((p) => [p.value, p.label])),
    PHASE_ORDER: Object.fromEntries(WBS.phases.map((p, i) => [p.value, i])),
    STATUS_LABEL: Object.fromEntries(WBS.statuses.map((s) => [s.value, s.label])),
    STATUS_CLASS: { todo: 'st-todo', doing: 'st-doing', blocked: 'st-blocked', done: 'st-done' },
    SOURCE_LABEL: { user: '用户填写', ai: 'AI 建议', pending: '待确认' },
    RISK_CATEGORY: Object.fromEntries(RISK.categories.map((c) => [c.value, c.label])),
    LEVEL_LABEL: Object.fromEntries(RISK.levels.map((l) => [l.value, l.label])),
    LEVEL_CLASS: { high: 'lv-high', medium: 'lv-medium', low: 'lv-low' },
    RESOURCE_KINDS,
    ROLES,
    RESOURCE_KIND: Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind.value, kind.label])),
    RESOURCE_UNIT: Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind.value, kind.unit])),
    ROLE_LABEL: Object.fromEntries(ROLES.map((role) => [role.value, role.label]))
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));

  const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const clamp = (value, min, max, fallback) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  };

  const text = (value) => String(value ?? '').trim();

  /* 占位词：AI 补空白时写的「待确认」这类词，表示「还没定」，是给人看的标记，不是项目事实。
     凡是靠项目数据推断「这一项填没填」的地方，都要把它和空值一样看待。 */
  const PLACEHOLDER_RE = /^(待确认|待定|待补充|待完善|待核实|暂定|未确定|tbd|n\/a)$/i;
  const filled = (value) => {
    const raw = text(value);
    return raw !== '' && !PLACEHOLDER_RE.test(raw);
  };

  /* 把 D-7 / D+3 / D-Day 解析为相对活动日的天数偏移（负数=活动前） */
  function parseDue(raw) {
    const value = text(raw).replace(/\s/g, '');
    if (!value) return null;
    if (/^d(-|—|–)?day$/i.test(value) || /^d0$/i.test(value)) return 0;
    const match = value.match(/^d\s*([+-])\s*(\d+)$/i);
    if (match) return match[1] === '-' ? -Number(match[2]) : Number(match[2]);
    const bare = value.match(/^([+-]?\d+)$/);
    if (bare) return Number(bare[1]);
    return null;
  }

  /* 活动日期 + 偏移天数 → 本地日期；无活动日期时返回 null */
  function dateFromDue(eventDate, due) {
    const offset = parseDue(due);
    if (offset == null || !eventDate) return null;
    const base = new Date(`${eventDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    base.setDate(base.getDate() + offset);
    return base;
  }

  const fmtDate = (date) => (date instanceof Date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '');

  const fmtDateTime = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${fmtDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  /* 距活动日的天数：正数=还有 N 天，0=就是今天 */
  function daysToEvent(eventDate) {
    if (!eventDate) return null;
    const base = new Date(`${eventDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((base - today) / 86_400_000);
  }

  function downloadText(filename, content, mime = 'text/markdown;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: mime }));
    triggerDownload(url, filename);
  }

  function downloadBlob(filename, blob) {
    triggerDownload(URL.createObjectURL(blob), filename);
  }

  /* 二进制产物（.docx / .xlsx）下载：不加文本 BOM，按原始字节写出 */
  function downloadBytes(filename, bytes, mime = 'application/octet-stream') {
    downloadBlob(filename, new Blob([bytes], { type: mime }));
  }

  function triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = String(filename).replace(/[\\/:*?"<>|]/g, '-');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function sourceBadge(source) {
    if (!source) return '';
    return `<span class="badge badge-${escapeHtml(source)}">${escapeHtml(consts.SOURCE_LABEL[source] || source)}</span>`;
  }

  function paintBadge(id, source) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = sourceBadge(source);
  }

  const safeFileName = (value) => text(value).replace(/[\\/:*?"<>|]/g, '-') || '未命名';

  const percent = (done, total) => (total ? Math.round((done / total) * 100) : 0);

  /* 离线模式：未配置 API Key 时，所有 AI 按钮统一禁用并给出原因，
     其余（手工编辑、甘特、检查点、海报、导出）一律照常可用。 */
  const AI_OFFLINE_HINT = '离线模式：未配置 API Key，这一项需要 AI；其余功能全部可用';
  const offline = () => !(window.WB.ai && window.WB.ai.ready);
  /* AI 按钮的统一开关：离线、没有项目、已经有一次生成在跑，都不该再点第二次。
     忙碌判断只写在这一处，免得各视图各写一遍——少写一处就会漏（tasks / material / decision 都漏过）。 */
  const gateAi = (el, enabled = true) => {
    if (!el) return;
    const busy = Boolean(window.WB.ai?.busy);
    el.disabled = !enabled || offline() || busy;
    el.title = offline() ? AI_OFFLINE_HINT : (busy ? 'AI 正在生成，请稍候' : '');
  };

  /* ── 身份与权限（本地演示，非真实鉴权）────
     组织者可管理项目库；成员可编辑内容与跑演练；访客只读。
     未登录时按最低权限处理，避免登录门出现前出现可写按钮。 */
  const currentUser = () => window.WB.store?.state?.user || null;
  const currentRole = () => currentUser()?.role || 'viewer';
  const canManage = () => currentRole() === 'organizer';
  const canOperate = () => canManage() || currentRole() === 'member';
  const roleLabel = (value) => consts.ROLE_LABEL[value || currentRole()] || '未登录';

  /* 按当前角色统一处理一批写入控件的可用性；只读访客一律禁用 */
  const gateRole = (els, enabled = true) => {
    const allow = enabled && canOperate();
    for (const el of Array.isArray(els) ? els : [els]) {
      if (el) el.disabled = !allow;
    }
    return allow;
  };

  window.WB.util = {
    ...consts,
    $,
    $$,
    escapeHtml,
    uid,
    clamp,
    text,
    filled,
    PLACEHOLDER_RE,
    parseDue,
    dateFromDue,
    fmtDate,
    fmtDateTime,
    daysToEvent,
    downloadText,
    downloadBlob,
    downloadBytes,
    sourceBadge,
    paintBadge,
    safeFileName,
    percent,
    offline,
    gateAi,
    currentUser,
    currentRole,
    canManage,
    canOperate,
    roleLabel,
    gateRole,
    AI_OFFLINE_HINT
  };
}());
