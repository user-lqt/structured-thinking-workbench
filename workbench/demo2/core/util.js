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

  /* ── 活动日期与活动安排 ──────────────────────────────
     basic.days   = ['YYYY-MM-DD', ...]              哪天办（唯一事实来源）
     basic.agenda = [{ date, start, end, title }]     每个时间段几点到几点、做什么（内容可选）
     basic.date / start / end 是它们的投影（首日日期、最早开始、最晚结束），
     好让倒计时、甘特、导出、海报这些只认单一日期的既有逻辑继续照常工作。 */
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* 兼容上一版的 schedule = [{date,start,end}]（以及更早的 date/start/end 单日） */
  function legacySchedule(basic = {}) {
    const clean = (item) => ({
      date: String(item?.date ?? '').trim().slice(0, 10),
      start: String(item?.start ?? '').trim().slice(0, 5),
      end: String(item?.end ?? '').trim().slice(0, 5)
    });
    if (Array.isArray(basic.schedule)) {
      return basic.schedule.map(clean).filter((item) => item.date || item.start || item.end);
    }
    if (basic.date || basic.start || basic.end) {
      return [clean({ date: basic.date, start: basic.start, end: basic.end })];
    }
    return [];
  }

  /* 哪几天：只认合法日期，去重并按日期升序 */
  function normaliseDays(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const day = String(item?.date ?? item ?? '').trim().slice(0, 10);
      if (DATE_RE.test(day) && !out.includes(day)) out.push(day);
    }
    return out.sort();
  }

  /* 时间段：date 可空（还没归到某一天）；四样全空的行直接丢掉 */
  function normaliseAgenda(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => ({
      date: String(item?.date ?? '').trim().slice(0, 10),
      start: String(item?.start ?? '').trim().slice(0, 5),
      end: String(item?.end ?? '').trim().slice(0, 5),
      title: String(item?.title ?? '').trim()
    })).filter((item) => item.date || item.start || item.end || item.title);
  }

  /* 活动日期：优先 basic.days，其次用旧数据里的日期兜底 */
  function daysOf(basic = {}) {
    const days = normaliseDays(basic.days);
    if (days.length) return days;
    const fromLegacy = normaliseDays(legacySchedule(basic).map((item) => item.date));
    if (fromLegacy.length) return fromLegacy;
    const one = String(basic.date ?? '').trim().slice(0, 10);
    return DATE_RE.test(one) ? [one] : [];
  }

  /* 活动安排：优先 basic.agenda，其次把旧 schedule 里的时间原样搬过来 */
  function agendaOf(basic = {}) {
    const agenda = normaliseAgenda(basic.agenda);
    if (agenda.length) return agenda;
    return legacySchedule(basic).map((item) => ({ ...item, title: '' }));
  }

  /* 把 days / agenda 投影回 date / start / end：首日日期、最早开始、最晚结束 */
  function syncSchedule(basic) {
    if (!basic) return basic;
    const days = normaliseDays(basic.days);
    const agenda = normaliseAgenda(basic.agenda);
    const agendaDays = agenda.map((item) => item.date).filter((day) => DATE_RE.test(day)).sort();
    basic.date = days[0] || agendaDays[0] || '';
    const starts = agenda.map((item) => item.start).filter(Boolean).sort();
    const ends = agenda.map((item) => item.end).filter(Boolean).sort();
    basic.start = starts[0] || '';
    basic.end = ends[ends.length - 1] || '';
    return basic;
  }

  /* 「2026-11-14」→「11/14」 */
  const shortDate = (date) => {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[2])}/${Number(match[3])}` : String(date || '');
  };

  /* 日期区间的一句话：11/14–11/16（共 3 天） */
  function dayRangeText(days) {
    const list = normaliseDays(days);
    if (!list.length) return '';
    if (list.length === 1) return shortDate(list[0]);
    return `${shortDate(list[0])}–${shortDate(list[list.length - 1])}（共 ${list.length} 天）`;
  }

  /* 给人看的一句话摘要（项目信息表 / 海报 / AI 上下文用）：以「哪几天」为主 */
  function scheduleSummary(basic = {}) {
    return dayRangeText(daysOf(basic));
  }

  /* 顶栏与项目卡片用的一行式活动日期 */
  const scheduleLabel = (basic = {}) => scheduleSummary(basic);

  /* 活动安排的一句话：11/14 09:00–12:00 开幕式、14:00–17:00 展区；11/15 08:30–12:00 决赛 */
  function agendaSummary(basic = {}) {
    const agenda = agendaOf(basic);
    if (!agenda.length) return '';
    const parts = [];
    let currentDay = null;
    for (const item of agenda) {
      const span = [item.start, item.end].filter(Boolean).join('–');
      const bits = [];
      if (item.date && item.date !== currentDay) { bits.push(shortDate(item.date)); currentDay = item.date; }
      if (span) bits.push(span);
      if (item.title) bits.push(item.title);
      if (bits.length) parts.push(bits.join(' '));
    }
    return parts.join('；');
  }

  /* 导出 Word 用的完整写法：2026年11月14日 09:00—12:00 开幕式、14:00—17:00 展区；2026年11月15日 … */
  function scheduleDocText(basic = {}) {
    const longDay = (date) => {
      const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : String(date || '');
    };
    const days = daysOf(basic);
    const agenda = agendaOf(basic);
    if (!agenda.length) {
      if (!days.length) return '';
      if (days.length === 1) return longDay(days[0]);
      return `${longDay(days[0])}—${longDay(days[days.length - 1])}（共 ${days.length} 天）`;
    }
    const parts = [];
    let currentDay = null;
    for (const item of agenda) {
      const span = [item.start, item.end].filter(Boolean).join('—');
      const bits = [];
      if (item.date && item.date !== currentDay) { bits.push(longDay(item.date)); currentDay = item.date; }
      if (span) bits.push(span);
      if (item.title) bits.push(item.title);
      if (bits.length) parts.push(bits.join(' '));
    }
    for (const day of days) {
      if (!agenda.some((item) => item.date === day)) parts.push(longDay(day));
    }
    return parts.join('；');
  }

  /* 访谈答案里存「哪几天」用的紧凑文本（一天一段，可无损解析） */
  const daysText = (days) => normaliseDays(days).join('；');
  const parseDays = (raw) => normaliseDays(String(raw ?? '').split(/[；;、,\s]+/));

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
    /* 日程是数组：只看有没有排期，不能把空数组当成「填了」 */
    if (Array.isArray(value)) return value.length > 0;
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
  const currentRole = () => window.WB.sync?.role || currentUser()?.role || 'viewer';
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
    AI_OFFLINE_HINT,
    normaliseDays,
    normaliseAgenda,
    daysOf,
    agendaOf,
    syncSchedule,
    scheduleSummary,
    scheduleLabel,
    agendaSummary,
    scheduleDocText,
    daysText,
    parseDays
  };
}());
