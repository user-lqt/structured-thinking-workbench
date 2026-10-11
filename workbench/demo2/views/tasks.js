/* 全周期任务：任务分解表 / 进度甘特 / 阶段检查点 三种视图。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, PHASE_LABEL, PHASE_ORDER, WBS, GATES, sourceBadge, fmtDate, dateFromDue } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;
  const Task = window.WB.taskLifecycle;
  let actionDraft = null, actionBusy = false;
  let detailContext = null, detailError = '', detailLoading = false, detailRequest = 0;
  const Delivery = window.WB.deliveries;
  function peopleOfTask() {
    return detailContext?.projectId === state().activeId && detailContext.taskId === actionDraft?.taskId ? detailContext.people : window.WB.personnel?.snapshot?.id === state().activeId ? window.WB.personnel.snapshot.people : [];
  }
  const rosterLoaded = () => (detailContext?.projectId === state().activeId && detailContext.taskId === actionDraft?.taskId)
    || (window.WB.personnel?.snapshot?.id === state().activeId && window.WB.personnel.snapshot.manager);
  function responsibleText(row) {
    if (!row.responsiblePersonId) return '实名责任人待补充';
    const person = peopleOfTask().find((p) => p.id === row.responsiblePersonId);
    return person ? `${person.name}${person.sample ? '（示例人员，实名责任人待补充）' : person.status !== 'active' ? '（已停用，待补充）' : ''}` : rosterLoaded() ? `实名责任人关联失效，待补充（${row.responsiblePersonId}）` : `已关联人员 ${row.responsiblePersonId}（待载入名册）`;
  }
  function refreshResponsibleNames() {
    for (const el of document.querySelectorAll('[data-task-responsible]')) {
      const row = state().wbs.find((task) => task.id === el.dataset.taskResponsible);
      if (row) el.textContent = responsibleText(row);
    }
  }
  async function loadDetails(taskId) {
    const projectId = state().activeId, request = ++detailRequest;
    if (detailContext?.taskId !== taskId || detailContext?.projectId !== projectId) detailContext = null;
    detailLoading = true; detailError = ''; renderActionPanel();
    try {
      const data = window.WB.sync?.role ? await window.WB.sync.taskDetails(taskId) : { people: [], shifts: [] };
      if (request === detailRequest && projectId === state().activeId && actionDraft?.taskId === taskId) detailContext = { ...data, projectId };
    } catch (error) { if (request === detailRequest) detailError = error.message; }
    finally { if (request === detailRequest) { detailLoading = false; refreshResponsibleNames(); renderActionPanel(); } }
  }
  const scopeLocked = (row) => ['review', 'accepted'].includes(Task.replay(row).status);

  /* 阶段筛选：总览点阶段块、或这里的筛选筹码，都会写 state().ui.taskPhase */
  function visibleRows() {
    const rows = state().wbs;
    const phase = state().ui.taskPhase || 'all';
    return phase === 'all' ? rows : rows.filter((row) => row.phase === phase);
  }

  /* ── 任务分解表 ───────────────────────── */

  function cell(row, index, key, extra = '') {
    const locked = ['task', 'output'].includes(key) && scopeLocked(row);
    return `<td><input data-row="${index}" data-key="${key}" value="${escapeHtml(row[key] ?? '')}" ${extra} ${!U.canOperate() ? 'disabled' : ''} ${locked ? 'readonly title="已提交的任务与产出要求已锁定；需先由组织者退回"' : ''} /></td>`;
  }

  function statusHtml(row) {
    const s = Task.replay(row), id = escapeHtml(row.id);
    const button = (kind) => `<button type="button" data-write data-task-action="${kind}" data-task-id="${id}" ${!U.canOperate() || actionBusy ? 'disabled' : ''}>${Task.actionLabels[kind]}</button>`;
    const actions = s.status === 'todo' ? button('start') : s.status === 'doing' && !s.blocked ? button('submit') : '';
    const review = !s.blocked && U.canManage() ? s.status === 'review' ? button('approve') + button('reject') : s.status === 'accepted' ? button('reject') : '' : '';
    return `<div class="task-state"><strong>${Task.labels[s.status]}</strong>${s.blocked ? '<b class="task-warning">受阻</b>' : ''}${s.needsVerification ? '<b class="task-warning">待核实</b>' : ''}</div>
      ${s.blocked ? `<small class="task-block-reason">原因：${escapeHtml(s.blockReason || '旧记录未填写，请补充原因')}</small>` : ''}
      <div class="task-actions">${actions}${review}${s.status !== 'accepted' ? button(s.blocked ? 'unblock' : 'block') : ''}
      <button type="button" data-task-history="${id}">任务详情 / 记录${row.legacyReporting ? ' / 历史填报' : ''}</button></div>`;
  }

  function rowHtml(row, index) {
    const index_ = state().wbs.indexOf(row);
    const phaseOptions = PHASES
      .map((p) => `<option value="${p.value}" ${row.phase === p.value ? 'selected' : ''}>${p.label}</option>`)
      .join('');
    return `<tr data-row="${index_}" data-row-id="${escapeHtml(row.id)}" class="${row.blocked ? 'is-blocked' : ''}">
      <td><select data-row="${index_}" data-key="phase" ${!U.canOperate() ? 'disabled' : ''}>${phaseOptions}</select></td>
      ${cell(row, index_, 'task', 'placeholder="任务描述"')}
      <td class="task-assignment-cell"><p data-task-responsible="${escapeHtml(row.id)}">${escapeHtml(responsibleText(row))}</p><div data-task-assignment="${escapeHtml(row.id)}">${window.WB.personnel?.taskCell(row.id) || ''}</div></td>
      ${cell(row, index_, 'owner', 'placeholder="负责角色"')}
      ${cell(row, index_, 'due', 'placeholder="D-7"')}
      ${cell(row, index_, 'duration', 'type="number" min="1" placeholder="0"')}
      ${cell(row, index_, 'output', 'placeholder="产出物"')}
      ${cell(row, index_, 'depends', 'placeholder="前置任务"')}
      <td class="task-lifecycle-cell">${statusHtml(row)}</td>
      <td class="cell-check"><input type="checkbox" data-row="${index_}" data-key="milestone" ${row.milestone ? 'checked' : ''} ${!U.canOperate() ? 'disabled' : ''} /></td>
      <td>${sourceBadge(row.source)}</td>
      <td class="actions"><button class="row-remove" data-remove="${index_}" title="删除该行" ${!U.canOperate() ? 'disabled' : ''}>×</button></td>
    </tr>`;
  }

  function executionHtml(row) {
    const s = Task.replay(row);
    const next = s.blocked ? '先处理受阻原因并解除受阻，再继续执行、提交或验收。' : {
      todo: '安排人员后，点击“开始执行”。成员在“我的任务”接受班次、签到签退，结束班次时填写执行报告。',
      doing: '完成工作后，在“过程材料”核对内容并确认交付版本，再点击“提交验收”，选择实际版本并填写交付说明。',
      review: '实际交付已提交，等待组织者核验。合格则“验收通过”，需要修改则“退回执行”。',
      accepted: '该任务已有有效验收记录。需要修改任务要求或交付时，由组织者退回后重新提交。'
    }[s.status];
    return `<section class="task-execution-guide" data-task-execution="${escapeHtml(row.id)}"><h4>任务执行与验收 · ${escapeHtml(row.task || row.name || '未命名任务')}</h4><p>安排人员 → 开始执行 → 提交验收 → 验收通过</p><p class="task-execution-next">${escapeHtml(next)}</p>${statusHtml(row)}<div class="panel-actions"><button type="button" class="button button-ghost" data-goto-view="material">准备材料 / 确认交付版本</button><a class="button button-ghost" href="./staff.html?project=${encodeURIComponent(state().activeId)}" target="_blank" rel="noreferrer">我的任务 / 班次报告</a></div><small>提交前需在任务详情指定真实责任人。签到签退证明到场与工时，班次报告记录执行情况；整项任务须另行提交实际交付版本并验收。</small></section>`;
  }

  function renderTable(rows) {
    if (!state().wbs.length) {
      return '<div class="card"><div class="empty"><strong>还没有任务分解</strong>填好项目信息表后，点「AI 生成任务分解」，或手动添加任务。</div></div>';
    }
    if (!rows.length) {
      return '<div class="card"><div class="empty"><strong>该阶段还没有任务</strong>点上方「全部」看其它阶段，或用工具栏「＋ 添加任务」补一条。</div></div>';
    }
    /* 固定列宽，保留任务操作区的可读性。 */
    return `<div class="card table-card"><div class="table-scroll"><table class="matrix wbs-table">
      <thead><tr>${WBS.columns.map((c, i) => `<th style="width:${c.width}">${escapeHtml(c.label)}</th>${i === 1 ? '<th style="width:190px">服务人员与班次</th>' : ''}`).join('')}<th style="width:44px"></th></tr></thead>
      <tbody>${rows.map((row, i) => rowHtml(row, i)).join('')}</tbody>
    </table></div></div>`;
  }

  /* ── 甘特 ─────────────────────────────── */

  function renderGantt(rows) {
    const current = state();
    if (!rows.length) {
      return '<div class="card"><div class="empty"><strong>该阶段还没有任务</strong>点上方「全部」看其它阶段，或用工具栏「＋ 添加任务」补一条。</div></div>';
    }
    const layout = window.WB.wbs.gantt(rows, current.project?.basic?.date);
    if (!layout.bars.length) {
      return `<div class="card"><div class="empty"><strong>无法绘制甘特图</strong>任务需要有「相对时间」（如 D-7）这类可解析的时间。填好活动日期与相对时间后再看。</div></div>`;
    }
    const { start, days } = layout;
    const pos = (date) => (window.WB.wbs.offsetDays(start, date) / days) * 100;
    const ticks = [];
    for (let i = 0; i < days; i += Math.max(1, Math.round(days / 10))) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      ticks.push(`<span class="gantt-tick" style="left:${(i / days) * 100}%">${escapeHtml(fmtDate(date).slice(5))}</span>`);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLeft = pos(today);
    const todayLine = todayLeft >= 0 && todayLeft <= 100
      ? `<span class="gantt-today" style="left:${todayLeft}%" title="今天"></span>` : '';
    const eventDate = dateFromDue(current.project?.basic?.date, 'D-Day');
    const eventLeft = eventDate ? pos(eventDate) : null;
    const eventLine = eventLeft != null && eventLeft >= 0 && eventLeft <= 100
      ? `<span class="gantt-event" style="left:${eventLeft}%" title="活动日"></span>` : '';

    const groups = PHASES.map((phase) => {
      const bars = layout.bars.filter((bar) => bar.row.phase === phase.value);
      if (!bars.length) return '';
      const items = bars.sort((a, b) => a.start - b.start).map((bar) => {
        const left = pos(bar.start);
        const width = Math.max(1.4, (bar.span / days) * 100);
        const s = Task.replay(bar.row);
        const cls = `gantt-bar phase-${phase.value} ${s.status === 'accepted' ? 'is-done' : ''} ${s.blocked ? 'is-blocked' : ''}`;
        return `<div class="gantt-row" data-gantt-row="${bar.row.id}">
          <div class="gantt-label">
            <span class="gantt-task">${bar.row.milestone ? '◆ ' : ''}${escapeHtml(bar.row.task || '未命名任务')}</span>
            <span class="gantt-owner">${escapeHtml(bar.row.owner || '')} · ${Task.labels[s.status]}${s.blocked ? ' · 受阻' : ''}${s.needsVerification ? ' · 待核实' : ''}</span>
          </div>
          <div class="gantt-track">
            <span class="${cls}" style="left:${left}%;width:${width}%"
              data-full="${s.status === 'accepted' ? '1' : '0'}"
              title="${escapeHtml(`${bar.row.task}｜${fmtDate(bar.start)} ~ ${fmtDate(bar.end)}｜${Task.labels[s.status]}${s.blocked ? `｜受阻：${s.blockReason}` : ''}`)}">
              ${s.status === 'accepted' ? '<i style="width:100%"></i>' : ''}
            </span>
          </div>
        </div>`;
      }).join('');
      return `<div class="gantt-group">
        <div class="gantt-group-head"><span class="phase-pill phase-${phase.value}">${escapeHtml(phase.label)}</span>
          <span class="gantt-group-window">${escapeHtml(phase.window)}</span></div>
        ${items}
      </div>`;
    }).join('');

    return `<div class="card">
      <div class="card-title"><h3>计划甘特与验收状态</h3><small>横条表示计划工期，深色表示已验收；◆ 为里程碑。时间流逝不改变任务状态。</small></div>
      <div class="gantt">
        <div class="gantt-axis">${ticks.join('')}${todayLine}${eventLine}</div>
        ${groups}
      </div>
    </div>`;
  }

  /* ── 阶段检查点 ───────────────────────── */

  /* 把推断出的跳转目标翻译成总览那套 data-goto-* 属性，复用同一条跳转通道 */
  function fixAttrs(fix) {
    if (!fix) return '';
    return [
      fix.view ? `data-goto-view="${escapeHtml(fix.view)}"` : '',
      fix.taskView ? `data-goto-taskview="${escapeHtml(fix.taskView)}"` : '',
      fix.phase ? `data-goto-phase="${escapeHtml(fix.phase)}"` : '',
      fix.openMaterial ? `data-goto-open="${escapeHtml(fix.openMaterial)}"` : ''
    ].filter(Boolean).join(' ');
  }

  /* 一个检查点的状态行：自动勾上的标出来源并可撤销，取消过的可恢复，
     没证据的把「该去哪补」摆出来，人只需要处理剩下那几项。 */
  function gateEvidenceHtml(item, phase, meta) {
    const undo = `<button type="button" class="gate-act is-ghost" data-write="gate" data-gate-undo="${phase}:${item.id}">`;
    if (item.done) {
      if (meta && meta.source === 'auto') {
        return `<span class="gate-evidence is-auto"><b>自动</b>${escapeHtml(meta.evidence || '按项目数据自动确认')}</span>${undo}撤销</button>`;
      }
      return '<span class="gate-evidence is-done">已确认</span>';
    }
    if (meta && meta.muted && item.level === 'ready') {
      return `<span class="gate-evidence is-muted"><b>已取消</b>${escapeHtml(item.evidence)}（你手动取消过，不再自动勾选）</span>${undo}恢复自动勾选</button>`;
    }
    const tone = item.level === 'ready' ? 'is-ready' : item.level === 'partial' ? 'is-partial' : 'is-manual';
    const label = item.level === 'ready' ? '证据' : item.level === 'partial' ? '部分证据' : '需人工确认';
    const go = item.fix ? `<button type="button" class="gate-act is-ghost" ${fixAttrs(item.fix)}>去补 →</button>` : '';
    return `<span class="gate-evidence ${tone}"><b>${label}</b>${escapeHtml(item.evidence)}</span>${go}`;
  }

  /* ── 阶段检查点 ─────────────────────────
     进这一屏之前先跑一次自动打勾：项目数据里有证据的检查点会被自动确认，
     只剩推断不出来的（现场类、会议类）需要人点；取消过的项不会再被自动勾回来。 */
  function renderGates() {
    const current = state();
    const review = window.WB.wbs.gateReview(current);
    const metaOf = (phase, id) => window.WB.wbs.gateMetaOf(current, phase, id);
    const columns = review.phases.map((info) => {
      const { summary } = info;
      const percent = summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
      const isTarget = current.ui.gatePhase === info.phase;
      const list = info.items.map((item) => `<li class="gate-row">
          <label class="gate-item ${item.done ? 'is-done' : ''}">
            <input type="checkbox" data-write="gate" data-gate-phase="${info.phase}" data-gate="${item.id}" ${item.done ? 'checked' : ''} />
            <span>${escapeHtml(item.label)}</span>
          </label>
          <div class="gate-meta">${gateEvidenceHtml(item, info.phase, metaOf(info.phase, item.id))}</div>
        </li>`).join('');
      return `<div class="gate-col phase-${info.phase} ${isTarget ? 'is-target' : ''}">
        <div class="gate-head">
          <button type="button" class="phase-pill phase-${info.phase}" data-goto-view="tasks" data-goto-taskview="table" data-goto-phase="${info.phase}" title="查看${escapeHtml(info.label)}的任务">${escapeHtml(info.label)}</button>
          <strong>${summary.done}/${summary.total}</strong>
        </div>
        <div class="bar"><i style="width:${percent}%"></i></div>
        <ul class="gate-list">${list}</ul>
        ${summary.done === summary.total ? '<p class="gate-ok">已满足进入下一阶段的条件</p>' : `<p class="gate-warn">还差 ${summary.total - summary.done} 项 · <button type="button" class="inline-jump" data-goto-view="tasks" data-goto-taskview="table" data-goto-phase="${info.phase}">看${escapeHtml(info.label)}任务 →</button></p>`}
      </div>`;
    }).join('');
    const autoCount = review.phases.reduce((sum, info) => sum + info.items.filter((item) => item.done && metaOf(info.phase, item.id)?.source === 'auto').length, 0);
    const mutedCount = review.phases.reduce((sum, info) => sum + info.items.filter((item) => metaOf(info.phase, item.id)?.muted).length, 0);
    const banner = (autoCount || mutedCount) ? `<div class="gate-banner">
        <span>系统按项目数据自动确认了 <b>${autoCount}</b> 项${mutedCount ? `；另有 ${mutedCount} 项你手动取消过，不会再自动勾上` : ''}。</span>
        <span class="gate-banner-hint">生成材料、登记资源、写完比选结论后自动同步</span>
      </div>` : '';
    return `<div class="card">
      <div class="card-title"><h3>阶段检查点（门禁）</h3><small>${escapeHtml(GATES.hint)}</small></div>
      ${banner}
      <div class="gate-grid">${columns}</div>
    </div>`;
  }
  /* ── 汇总条 ───────────────────────────── */

  function renderSummary() {
    const rows = state().wbs;
    if (!rows.length) {
      $('#wbsSummary').innerHTML = '';
      return;
    }
    const overall = window.WB.wbs.overall(rows);
    const active = state().ui.taskPhase || 'all';
    const filters = [{ value: 'all', label: '全部' }, ...PHASES.map((p) => ({ value: p.value, label: p.label }))]
      .map((entry) => {
        const items = entry.value === 'all' ? rows : rows.filter((row) => row.phase === entry.value);
        const blocked = items.filter((row) => Task.replay(row).blocked).length;
        return `<button type="button" class="summary-chip chip-filter ${active === entry.value ? 'is-active' : ''}"
          data-task-phase="${entry.value}" title="只看${escapeHtml(entry.label)}的任务">
          <span>${escapeHtml(entry.label)}</span><strong>${items.length}</strong>${blocked ? `<em class="chip-blocked">受阻 ${blocked}</em>` : ''}
        </button>`;
      }).join('');
    const stats = [
      { label: '已验收', value: overall.done },
      { label: '进行中', value: overall.doing },
      { label: '待验收', value: overall.review },
      { label: '待核实', value: overall.verification },
      { label: '已验收占比', value: `${overall.percent}%` }
    ].map((chip) => `<div class="summary-chip"><span>${escapeHtml(chip.label)}</span><strong>${escapeHtml(chip.value)}</strong></div>`).join('');
    $('#wbsSummary').innerHTML = `<span class="summary-label">按阶段筛选</span>${filters}<span class="summary-label">整体</span>${stats}`;
  }

  function render() {
    /* 进这一屏先同步一次：项目数据里出现新证据（生成材料、登记资源、写完比选结论）就自动勾上 */
    if (U.canOperate() && window.WB.wbs.autoTick(state())) store().save();
    const current = state();
    renderSummary();
    const view = current.ui.taskView || 'table';
    $('#taskSeg').querySelectorAll('button').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.taskview === view);
    });
    const body = { table: renderTable, gantt: renderGantt, gate: renderGates }[view] || renderTable;
    $('#taskViewBody').innerHTML = body(visibleRows());
    const has = Boolean(current.project);
    for (const id of ['generateWbs', 'addWbsRow', 'exportWbsMd', 'exportWbsCsv']) {
      const el = document.getElementById(id);
      if (el) el.disabled = !has;
    }
    U.gateAi(document.getElementById('generateWbs'), has);
    U.gateRole([$('#generateWbs'), $('#addWbsRow')], has);
    U.gateAi(document.getElementById('generateWbs'), has && U.canOperate());
    renderActionPanel();
    window.WB.personnel?.render();
  }

  /* ── AI 生成任务分解 ───────────────────── */

  async function generate() {
    const current = state();
    if (!current.project || !U.canOperate()) return;
    const projectId = current.activeId;
    const linkedTasks = new Set((window.WB.personnel?.snapshot?.shifts || []).map((s) => s.taskId));
    if (window.WB.sync?.role && !window.WB.personnel?.snapshot?.manager) {
      try {
        const summaries = await Promise.all(current.wbs.filter((row) => row.source === 'ai' && !row.responsiblePersonId && !row.lifecycle?.events?.length && !row.legacyReporting).map((row) => window.WB.sync.taskDetails(row.id)));
        for (const summary of summaries) if (summary.shifts.length) linkedTasks.add(summary.taskId);
      } catch (error) { window.WB.toast(`未能核对现有排班，任务规划尚未替换：${error.message}`); return; }
    }
    if (state().activeId !== projectId || !U.canOperate()) return;
    const selected = U.OUTPUT_ITEMS.filter((item) => current.project.outputs[item.key]);
    const data = await window.WB.ai.run('wbs', {
      活动基本信息: current.project.basic,
      已勾选产出: selected.map((item) => `${item.label}（${PHASE_LABEL[item.phase]}）`),
      阶段划分: PHASES.map((p) => `${p.label}（${p.window}）`),
      要求: '每个阶段至少 4 项任务，任务要能落到具体角色与产出物；关键交付节点标为里程碑'
    }, window.WB.ai.wbsContract());
    if (!data || !Array.isArray(data.rows) || state().activeId !== projectId || !U.canOperate()) return;
    const kept = current.wbs.filter((row) => row.source === 'user' || row.responsiblePersonId || linkedTasks.has(row.id) || row.lifecycle?.events?.length || row.legacyReporting || row.needsVerification);
    const generated = data.rows.map((row) => store().normaliseRow({
      task: row.task, owner: row.owner, due: row.due, duration: row.duration, output: row.output, depends: row.depends,
      lifecycle: Task.fresh(),
      phase: PHASE_ORDER[row.phase] != null ? row.phase : 'plan',
      milestone: row.milestone === true || row.milestone === '是' || row.milestone === 'true',
      source: 'ai'
    })).filter((row) => row.task);
    current.wbs = [...generated, ...kept];
    store().log('wbs', `生成任务分解 ${generated.length} 项`);
    store().save();
    window.WB.renderAll();
    window.WB.toast(`生成 ${generated.length} 项规划任务${kept.length ? `，保留 ${kept.length} 项已有任务及记录` : ''}`);
  }

  function renderActionPanel() {
    const panel = $('#taskActionPanel');
    if (!actionDraft || actionDraft.projectId !== state().activeId) { actionDraft = null; panel.innerHTML = ''; panel.dataset.key = ''; return; }
    const row = state().wbs.find((item) => item.id === actionDraft.taskId);
    if (!row) { actionDraft = null; panel.innerHTML = ''; return; }
    const s = Task.replay(row), key = JSON.stringify([actionDraft.projectId, row, state().materials, detailContext, detailError, detailLoading, actionDraft.kind, U.currentRole(), actionBusy, window.WB.personnel?.snapshot?.manager]);
    if (panel.dataset.key === key) return;
    panel.dataset.key = key;
    const invalid = new Map(s.invalid.map((item) => [item.index, item.reason]));
    const records = row.lifecycle.events.map((e, i) => `<li>${escapeHtml(Task.actionLabels[e?.kind] || e?.kind || '无效操作')} · ${escapeHtml(e?.actor?.name || '身份缺失')} · ${escapeHtml(U.fmtDateTime(e?.at))}${invalid.has(i) ? ` <b class="task-warning">无效：${escapeHtml(invalid.get(i))}</b>` : ''}<p>${escapeHtml(e?.evidence || e?.note || '')}</p>${(e?.deliveries || []).map(versionHtml).join('')}${e?.responsiblePersonId ? `<small>提交时责任人编号：${escapeHtml(e.responsiblePersonId)}</small>` : ''}</li>`).join('');
    const legacy = row.legacyReporting;
    const history = legacy ? `<p class="task-history">历史填报（不计当前验收）：原状态 ${escapeHtml(({ done: '已完成', blocked: '受阻', ...Task.labels })[legacy.status] || legacy.status || '未填写')}；原百分比 ${escapeHtml(legacy.progress == null ? '未填写' : `${legacy.progress}%`)}</p>` : '';
    const kind = actionDraft.kind, label = kind === 'submit' ? '交付依据（交付物位置、链接或可核验说明）' : kind === 'block' ? '受阻原因' : kind === 'reject' ? '退回原因与整改要求' : '验收结论（说明核验了什么）';
    const roster = peopleOfTask(), manager = window.WB.personnel?.snapshot?.id === state().activeId && window.WB.personnel.snapshot.manager && U.canOperate();
    const context = detailContext?.projectId === state().activeId && detailContext.taskId === row.id ? detailContext : { shifts: [] };
    const versions = Object.values(state().materials || {}).flatMap((m) => (m.deliveries || []).filter((v) => v.origin === 'server').map((v) => ({ materialId: m.materialId, versionId: v.id })));
    const expanded = new Set(Array.from(panel.querySelectorAll('details[open]')).map((el) => el.querySelector('summary')?.textContent));
    panel.innerHTML = `<div class="card task-action-card"><div class="card-title"><h3>${kind === 'history' ? '任务详情' : Task.actionLabels[kind]} · ${escapeHtml(row.task || '未命名任务')}</h3><button type="button" data-task-action-close>关闭</button></div>
      <p>当前：${Task.labels[s.status]}${s.needsVerification ? ' · 待核实：已有完成声明尚无适用的有效验收' : ''}${s.blocked ? ` · 受阻：${escapeHtml(s.blockReason || '旧记录缺少原因')}` : ''}</p>${history}
      ${row.importedLifecycle ? '<p class="task-history">导入前的执行记录已保留在项目包 importedLifecycle 中；本共享项目需重新提交和验收。</p>' : ''}
      ${kind === 'history' ? executionHtml(row) : ''}
      <h4>责任与执行人员</h4><p>实名责任人：${escapeHtml(responsibleText(row))} · 岗位：${escapeHtml(row.owner || '待补充')}</p>
      ${!row.responsiblePersonId || rosterLoaded() && !roster.some((p) => p.id === row.responsiblePersonId && p.status === 'active' && !p.sample) ? '<p class="task-warning">实名责任人待补充，不按岗位文字推断人员。</p>' : ''}
      <form id="taskResponsibilityForm"><label>实名责任人<select name="responsiblePersonId" ${!manager || scopeLocked(row) || actionBusy ? 'disabled' : ''}><option value="">待补充</option>${roster.filter((p) => !p.sample && (p.status === 'active' || p.id === row.responsiblePersonId)).map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === (actionDraft.responsiblePersonId ?? row.responsiblePersonId) ? 'selected' : ''}>${escapeHtml(p.name)}${p.status !== 'active' ? '（已停用）' : ''}</option>`).join('')}</select></label><button class="button button-ghost" ${!manager || scopeLocked(row) || actionBusy ? 'disabled' : ''}>保存责任人</button></form>
      <div class="panel-actions"><button class="button button-ghost" data-task-assign="${escapeHtml(row.id)}" ${!manager ? 'disabled' : ''}>安排执行人员 / 班次</button><button class="button button-ghost" data-goto-view="resources" data-goto-resource-section="personnel">人员名册与打卡</button><a class="button button-ghost" href="./staff.html?project=${encodeURIComponent(state().activeId)}" target="_blank" rel="noreferrer">我的任务 / 提交班次报告</a><button class="button button-quiet" data-task-details-refresh>刷新关联信息</button></div>
      ${detailLoading ? '<p>正在读取人员与班次…</p>' : ''}${detailError ? `<p class="task-warning">${escapeHtml(detailError)}</p>` : ''}
      <div class="task-linked-shifts">${context.shifts.map((shift) => shiftHtml(shift, roster)).join('') || '<p>尚无执行人员与班次关联，待补充；不按姓名自动匹配。</p>'}</div>
      <h4>实际交付版本</h4><p>编辑草稿与 AI 生成材料须人工核对并保存交付版本。签到时长和班次结束均不等于任务验收。</p><button class="button button-ghost" data-goto-view="material">准备材料 / 确认交付版本</button>
      <p>提交人：${escapeHtml(s.submission?.actor?.name || '尚未提交')} · 验收人：${escapeHtml(s.acceptance?.actor?.name || '尚未验收')}</p>
      ${s.submission?.deliveries?.length ? s.submission.deliveries.map(versionHtml).join('') : '<p class="task-warning">本任务尚无实际交付关联，待补充。</p>'}
      ${kind === 'history' ? '' : `<form id="taskActionForm">${kind === 'submit' ? `<fieldset><legend>选择本次实际交付版本（可多选）</legend>${versions.map((ref) => `<label class="task-delivery-choice"><input type="checkbox" name="delivery" value="${escapeHtml(JSON.stringify(ref))}" ${(actionDraft.deliveries || []).some((r) => r.materialId === ref.materialId && r.versionId === ref.versionId) ? 'checked' : ''} ${!U.canOperate() || actionBusy ? 'disabled' : ''} />${versionLabel(ref)}</label>${versionHtml(ref)}`).join('') || '<p>暂无已确认版本，请先准备材料并确认交付。</p>'}</fieldset>` : ''}<label>${label}<textarea name="${kind === 'submit' ? 'evidence' : 'note'}" maxlength="4000" required ${!U.canOperate() || actionBusy ? 'disabled' : ''}>${escapeHtml(kind === 'submit' ? actionDraft.evidence : actionDraft.note)}</textarea></label><button class="button button-primary" type="submit" data-write ${!U.canOperate() || actionBusy || (['approve', 'reject'].includes(kind) && !U.canManage()) ? 'disabled' : ''}>${actionBusy ? '正在保存…' : `确认${Task.actionLabels[kind]}`}</button></form>`}
      <ol class="task-event-list">${records || '<li>暂无执行或验收操作记录。</li>'}</ol></div>`;
    for (const el of panel.querySelectorAll('details')) el.open = expanded.has(el.querySelector('summary')?.textContent);
  }

  function versionLabel(ref) {
    const resolved = Delivery.resolve(state(), ref);
    if (!resolved?.version.snapshot?.material) return `${escapeHtml(ref?.materialId || '材料编号缺失')} / ${escapeHtml(ref?.versionId || '版本编号缺失')}（关联缺失，待补充）`;
    const { material, version } = resolved;
    const renamed = material.title !== version.snapshot.material.title ? ` · 材料现名：${escapeHtml(material.title)}` : '';
    const latest = Math.max(...material.deliveries.filter((v) => v?.origin === 'server').map((v) => Number(v.number) || 0));
    const updated = latest > version.number ? ` · 已有 V${latest}，本次仍关联 V${version.number}` : '';
    return `${escapeHtml(ref.materialId)} / V${version.number} · ${escapeHtml(version.snapshot.material.title)}${renamed}${updated} · ${escapeHtml(version.actor?.name || '交付人待补充')} · ${escapeHtml(U.fmtDateTime(version.at))}`;
  }
  function versionHtml(ref) {
    const r = Delivery.resolve(state(), ref);
    if (!r?.version.snapshot?.material || !Array.isArray(r.version.snapshot.material.sections)) return `<p class="task-warning">${versionLabel(ref)} · 版本正文待补充</p>`;
    const snapshot = r.version.snapshot;
    return `<details class="task-version"><summary>${versionLabel(ref)}</summary><p>版本编号：${escapeHtml(ref.versionId)} · ${escapeHtml(r.version.note || '')}</p>${snapshot.material.sections.map((s) => `<h5>${escapeHtml(s?.heading)}</h5><pre>${escapeHtml(s?.body)}</pre>`).join('')}${snapshot.reference ? `<p>参考文件：${escapeHtml(snapshot.reference.name)}（原包与填值已保存在快照）</p>` : ''}${Object.keys(snapshot.fillDrafts || {}).length ? `<pre>参考填值：${escapeHtml(JSON.stringify(snapshot.fillDrafts, null, 2))}</pre>` : ''}<button type="button" class="button button-quiet" data-task-version-download="${escapeHtml(r.key)}" data-version-id="${escapeHtml(ref.versionId)}">下载完整版本快照（含附件）</button></details>`;
  }
  function shiftHtml(s, roster) {
    return `<article class="staff-shift"><strong>${escapeHtml(roster.find((p) => p.id === s.personId)?.name || `人员关联缺失：${s.personId}`)} · ${escapeHtml(s.title)}</strong><p>${escapeHtml(U.fmtDateTime(s.start))} → ${escapeHtml(U.fmtDateTime(s.end))} · ${escapeHtml(({ assigned: '待接受', accepted: '已接受', done: '班次已结束', cancelled: '已取消' })[s.status] || s.status)}</p><p>接受：${s.acceptance ? `${escapeHtml(s.acceptance.actor)} · ${escapeHtml(U.fmtDateTime(s.acceptance.at))} · ${escapeHtml(s.acceptance.by)}` : s.status === 'assigned' ? '尚未接受' : '旧记录未记录接受人和时间，待补充'}；到场：${s.attendance.present ? '在场' : '当前不在场'}；确认工时 ${Math.floor(s.attendance.completedMs / 60000)} 分钟</p><details><summary>签到签退流水 ${s.events.length} 条</summary>${s.events.map((e) => `<p>${e.kind === 'checkin' ? '签到' : '签退'} · ${escapeHtml(U.fmtDateTime(e.at))} · ${escapeHtml(e.actor)}（${escapeHtml(e.by)}）</p>`).join('')}</details>${(s.reports || []).map((r) => `<p>执行报告 · ${escapeHtml(r.actor)} · ${escapeHtml(U.fmtDateTime(r.at))}</p><pre>${escapeHtml(r.text)}</pre>`).join('') || '<p>执行报告待补充。</p>'}</article>`;
  }

  async function executeAction(taskId, action) {
    if (actionBusy) return;
    if (!U.canOperate()) throw new Error('只读访客不能操作任务');
    if (['approve', 'reject'].includes(action.kind) && !U.canManage()) throw new Error('只有组织者可以验收或退回任务');
    const index = state().wbs.findIndex((row) => row.id === taskId);
    if (index < 0) throw new Error('任务不存在');
    actionBusy = true; renderActionPanel();
    try {
      if (window.WB.sync?.role) await window.WB.sync.taskAction(taskId, action);
      else {
        if (['submit', 'approve', 'reject'].includes(action.kind)) throw new Error('请登录并打开共享项目，补齐实名人员和实际交付版本后再提交或验收');
        const user = U.currentUser();
        state().wbs[index] = store().normaliseRow(Task.apply(state().wbs[index], action, {
          id: U.uid('task-event'), at: new Date().toISOString(), origin: 'local',
          actor: { id: window.WB.personnel?.account?.id || `local:${user.name}`, name: user.name, role: U.currentRole() }
        }));
        store().log('task', `${Task.actionLabels[action.kind]}：${state().wbs[index].task}`); store().save();
      }
      actionDraft = null; window.WB.toast(`${Task.actionLabels[action.kind]}已记录`);
    } finally { actionBusy = false; window.WB.renderAll(); }
  }

  function mount() {
    const panel = $('#tasksPanel');
    /* 只挂一次：重复 mount 会让点击监听器叠加，同一次点击被处理多次 */
    if (panel.dataset.mounted) return;
    panel.dataset.mounted = '1';

    panel.addEventListener('input', (event) => {
      if (event.target.closest('#taskActionForm')) { if (actionDraft) { if (event.target.name === 'delivery') actionDraft.deliveries = Array.from(event.target.form.querySelectorAll('[name=delivery]:checked')).map((el) => JSON.parse(el.value)); else actionDraft[event.target.name] = event.target.value; } return; }
      if (event.target.closest('#taskResponsibilityForm')) { if (actionDraft) actionDraft.responsiblePersonId = event.target.value; return; }
      const el = event.target.closest('[data-row][data-key]');
      if (!el || !U.canOperate()) return;
      const row = state().wbs[Number(el.dataset.row)];
      if (!row) return;
      const key = el.dataset.key;
      if (!['task', 'owner', 'due', 'duration', 'output', 'depends'].includes(key)) return;
      if (['task', 'output'].includes(key) && scopeLocked(row)) return;
      if (key === 'duration') {
        row.duration = el.value === '' ? '' : Number(el.value) || '';
      } else {
        row[key] = el.value;
      }
      row.source = 'user';
      store().save();
      const tr = el.closest('tr');
      const badge = tr?.querySelector('.badge');
      if (badge) badge.outerHTML = sourceBadge('user');
      if (key === 'task' || key === 'source') window.WB.renderTopbar();
    });

    panel.addEventListener('change', (event) => {
      if (!U.canOperate()) return;
      const rowEl = event.target.closest('[data-row][data-key]');
      if (rowEl) {
        const row = state().wbs[Number(rowEl.dataset.row)];
        if (!row) return;
        const key = rowEl.dataset.key;
        if (!['milestone', 'phase', 'duration', 'task', 'owner', 'due', 'output', 'depends'].includes(key)) return;
        if (key === 'milestone') {
          row.milestone = rowEl.checked;
        } else if (key === 'phase') {
          row.phase = rowEl.value;
        } else if (key === 'duration') {
          row.duration = rowEl.value === '' ? '' : Number(rowEl.value) || '';
        }
        row.source = 'user';
        store().save();
        window.WB.views.tasks.render();
        window.WB.renderTopbar();
        return;
      }
      const gate = event.target.closest('[data-gate]');
      if (gate) {
        const phase = gate.dataset.gatePhase;
        const id = gate.dataset.gate;
        window.WB.wbs.setGate(state(), phase, id, gate.checked);
        const name = GATES[phase].find((g) => g.id === id)?.label;
        store().log('gate', `${PHASE_LABEL[phase]}检查点「${name}」${gate.checked ? '手动确认' : '手动取消（之后不再自动勾选）'}`);
        store().save();
        window.WB.views.tasks.render();
      }
    });

    panel.addEventListener('submit', async (event) => {
      if (event.target.id === 'taskResponsibilityForm') {
        event.preventDefault();
        if (actionBusy || !U.canOperate() || window.WB.personnel?.snapshot?.id !== state().activeId || !window.WB.personnel.snapshot.manager) return;
        const row = state().wbs.find((r) => r.id === actionDraft?.taskId);
        if (!row || scopeLocked(row)) { window.WB.toast('已提交任务需先退回才能更换责任人'); return; }
        const previous = row.responsiblePersonId, projectId = state().activeId;
        const selected = new FormData(event.target).get('responsiblePersonId') || '';
        if (selected && !peopleOfTask().some((p) => p.id === selected && p.status === 'active')) { window.WB.toast('请选择已确认的实名人员'); return; }
        const rollback = () => {
          if (state().activeId !== projectId) return;
          const current = state().wbs.find((r) => r.id === row.id);
          if (current) current.responsiblePersonId = previous;
          if (actionDraft?.taskId === row.id) actionDraft.responsiblePersonId = previous;
          store().save();
        };
        actionBusy = true;
        try {
          row.responsiblePersonId = selected; store().save(); renderActionPanel();
          if (!window.WB.sync?.role || !await window.WB.sync.flush()) { rollback(); window.WB.toast('责任人尚未同步，请检查共享栏提示'); }
          else if (state().activeId === projectId) window.WB.toast(selected ? '实名责任人已保存' : '已标记待补充');
        } catch (error) { rollback(); window.WB.toast(error.message); }
        finally { actionBusy = false; render(); }
        return;
      }
      if (event.target.id !== 'taskActionForm') return;
      event.preventDefault();
      if (!actionDraft || actionDraft.projectId !== state().activeId) return;
      try { actionDraft.deliveries = new FormData(event.target).getAll('delivery').map((v) => JSON.parse(v)); await executeAction(actionDraft.taskId, actionDraft); } catch (error) { window.WB.toast(error.message); }
    });

    window.addEventListener('personnel-refresh', () => { refreshResponsibleNames(); if (actionDraft && !actionBusy) loadDetails(actionDraft.taskId); });
    panel.addEventListener('click', async (event) => {
      if (event.target.closest('[data-task-details-refresh]') && actionDraft) { detailContext = null; await loadDetails(actionDraft.taskId); return; }
      const download = event.target.closest('[data-task-version-download]');
      if (download) { try { window.WB.views.material.downloadDelivery(download.dataset.taskVersionDownload, download.dataset.versionId); } catch (error) { window.WB.toast(error.message); } return; }

      if (event.target.closest('[data-task-action-close]')) { if (!actionBusy) { actionDraft = null; renderActionPanel(); } return; }
      const operation = event.target.closest('[data-task-action]'), history = event.target.closest('[data-task-history],[data-task-details-open]');
      if (operation || history) {
        const taskId = operation?.dataset.taskId || history.dataset.taskHistory || history.dataset.taskDetailsOpen, kind = operation?.dataset.taskAction || 'history';
        try {
          if (kind !== 'history' && !U.canOperate()) throw new Error('只读访客不能操作任务');
          if (['approve', 'reject'].includes(kind) && !U.canManage()) throw new Error('只有组织者可以验收或退回任务');
          if (['start', 'unblock'].includes(kind)) await executeAction(taskId, { kind });
          else { actionDraft = { projectId: state().activeId, taskId, kind, note: '', evidence: '', deliveries: [], responsiblePersonId: state().wbs.find((r) => r.id === taskId)?.responsiblePersonId || '' }; renderActionPanel(); loadDetails(taskId); $('#taskActionPanel').scrollIntoView({ block: 'nearest' }); }
        } catch (error) { window.WB.toast(error.message); }
        return;
      }
      const assignment = event.target.closest('[data-task-assign]');
      if (assignment) { window.WB.personnel?.openTaskAssignment(assignment.dataset.taskAssign); return; }
      const undo = event.target.closest('[data-gate-undo]');
      if (undo) {
        if (!window.WB.util.canOperate()) { window.WB.toast('只读访客不能修改检查点'); return; }
        const [phase, id] = undo.dataset.gateUndo.split(':');
        const name = GATES[phase].find((g) => g.id === id)?.label;
        if (window.WB.wbs.gateMetaOf(state(), phase, id)?.source === 'auto') {
          window.WB.wbs.setGate(state(), phase, id, false);
          store().log('gate', `${PHASE_LABEL[phase]}检查点「${name}」撤销自动确认（之后不再自动勾选）`);
        } else {
          const ticked = window.WB.wbs.resumeAuto(state(), phase, id);
          store().log('gate', `${PHASE_LABEL[phase]}检查点「${name}」${ticked ? '恢复自动确认' : '恢复自动勾选，但当前已无证据'}`);
        }
        store().save();
        window.WB.views.tasks.render();
        return;
      }
      const remove = event.target.closest('[data-remove]');
      if (remove) {
        if (!U.canOperate()) return;
        const index = Number(remove.dataset.remove);
        const dropped = state().wbs[index];
        if ((dropped?.lifecycle?.events?.length || dropped?.legacyReporting) && !confirm('删除此任务也会删除其执行、验收及历史填报记录。确定删除？')) return;
        state().wbs.splice(index, 1);
        /* 删掉的是当前筛选阶段的最后一条时把筛选复位，避免停在一个空列表上 */
        if (dropped && state().ui.taskPhase === dropped.phase && !state().wbs.some((row) => row.phase === dropped.phase)) {
          state().ui.taskPhase = 'all';
        }
        store().save();
        window.WB.renderAll();
        return;
      }
      const phaseFilter = event.target.closest('[data-task-phase]');
      if (phaseFilter) {
        state().ui.taskPhase = phaseFilter.dataset.taskPhase;
        store().save();
        window.WB.views.tasks.render();
        return;
      }
      const seg = event.target.closest('[data-taskview]');
      if (seg) {
        state().ui.taskView = seg.dataset.taskview;
        store().save();
        window.WB.views.tasks.render();
      }
    });

    $('#generateWbs').addEventListener('click', generate);
    $('#addWbsRow').addEventListener('click', () => {
      if (!U.canOperate()) return;
      state().wbs.push(store().normaliseRow({ phase: 'plan', task: '', source: 'user' }));
      store().save();
      window.WB.renderAll();
    });
    $('#exportWbsMd').addEventListener('click', () => {
      if (!state().wbs.length) { window.WB.toast('还没有任务分解'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-任务分解表.md`, window.WB.exporters.wbsToMarkdown());
    });
    $('#exportWbsCsv').addEventListener('click', () => {
      if (!state().wbs.length) { window.WB.toast('还没有任务分解'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-任务分解表.csv`, window.WB.exporters.wbsToCsv(), 'text/csv;charset=utf-8');
    });
  }

  window.WB.views.tasks = { id: 'tasks', label: '全周期任务', render, mount, generate, executeAction, executionHtml };
}());
