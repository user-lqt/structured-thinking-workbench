/* 全周期任务：任务分解表 / 进度甘特 / 阶段检查点 三种视图。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, PHASE_LABEL, PHASE_ORDER, WBS, GATES, sourceBadge, clamp, fmtDate, dateFromDue } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  /* 阶段筛选：总览点阶段块、或这里的筛选筹码，都会写 state().ui.taskPhase */
  function visibleRows() {
    const rows = state().wbs;
    const phase = state().ui.taskPhase || 'all';
    return phase === 'all' ? rows : rows.filter((row) => row.phase === phase);
  }

  /* ── 任务分解表 ───────────────────────── */

  function cell(row, index, key, extra = '') {
    return `<td><input data-row="${index}" data-key="${key}" value="${escapeHtml(row[key] ?? '')}" ${extra} /></td>`;
  }

  function rowHtml(row, index) {
    const index_ = state().wbs.indexOf(row);
    const phaseOptions = PHASES
      .map((p) => `<option value="${p.value}" ${row.phase === p.value ? 'selected' : ''}>${p.label}</option>`)
      .join('');
    const statusOptions = WBS.statuses
      .map((s) => `<option value="${s.value}" ${row.status === s.value ? 'selected' : ''}>${s.label}</option>`)
      .join('');
    return `<tr data-row="${index_}" data-row-id="${escapeHtml(row.id)}" class="${row.status === 'blocked' ? 'is-blocked' : ''}">
      <td><select data-row="${index_}" data-key="phase">${phaseOptions}</select></td>
      ${cell(row, index_, 'task', 'placeholder="任务描述"')}
      ${cell(row, index_, 'owner', 'placeholder="负责角色"')}
      ${cell(row, index_, 'due', 'placeholder="D-7"')}
      ${cell(row, index_, 'duration', 'type="number" min="1" placeholder="0"')}
      ${cell(row, index_, 'output', 'placeholder="产出物"')}
      ${cell(row, index_, 'depends', 'placeholder="前置任务"')}
      <td><select data-row="${index_}" data-key="status">${statusOptions}</select></td>
      <td class="cell-progress"><input data-row="${index_}" data-key="progress" type="number" min="0" max="100" value="${row.progress ?? 0}" /><i style="width:${clamp(Number(row.progress), 0, 100, 0)}%"></i></td>
      <td class="cell-check"><input type="checkbox" data-row="${index_}" data-key="milestone" ${row.milestone ? 'checked' : ''} /></td>
      <td>${sourceBadge(row.source)}</td>
      <td class="actions"><button class="row-remove" data-remove="${index_}" title="删除该行">×</button></td>
    </tr>`;
  }

  function renderTable(rows) {
    if (!state().wbs.length) {
      return '<div class="card"><div class="empty"><strong>还没有任务分解</strong>填好项目信息表后，点「AI 生成任务分解」，或手动添加任务。</div></div>';
    }
    if (!rows.length) {
      return '<div class="card"><div class="empty"><strong>该阶段还没有任务</strong>点上方「全部」看其它阶段，或用工具栏「＋ 添加任务」补一条。</div></div>';
    }
    /* 表格用固定列宽 + 最小宽度，避免窄屏下百分比列被压成 0 宽而看不见。 */
    return `<div class="card table-card"><div class="table-scroll"><table class="matrix wbs-table">
      <thead><tr>${WBS.columns.map((c) => `<th style="width:${c.width}">${escapeHtml(c.label)}</th>`).join('')}<th style="width:44px"></th></tr></thead>
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
        const cls = `gantt-bar phase-${phase.value} ${bar.row.status === 'done' ? 'is-done' : ''} ${bar.row.status === 'blocked' ? 'is-blocked' : ''}`;
        const progress = clamp(Number(bar.row.progress), 0, 100, 0);
        return `<div class="gantt-row" data-gantt-row="${bar.row.id}">
          <div class="gantt-label">
            <span class="gantt-task">${bar.row.milestone ? '◆ ' : ''}${escapeHtml(bar.row.task || '未命名任务')}</span>
            <span class="gantt-owner">${escapeHtml(bar.row.owner || '')}</span>
          </div>
          <div class="gantt-track">
            <span class="${cls}" style="left:${left}%;width:${width}%"
              data-full="${progress >= 100 ? '1' : '0'}"
              title="${escapeHtml(`${bar.row.task}｜${fmtDate(bar.start)} ~ ${fmtDate(bar.end)}｜完成度 ${bar.row.progress || 0}%`)}">
              <i style="width:${progress}%"></i>
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
      <div class="card-title"><h3>进度甘特</h3><small>按活动日期把 D-N 换算为真实日期；◆ 为里程碑，条内深色为完成度</small></div>
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
        const blocked = items.filter((row) => row.status === 'blocked').length;
        return `<button type="button" class="summary-chip chip-filter ${active === entry.value ? 'is-active' : ''}"
          data-task-phase="${entry.value}" title="只看${escapeHtml(entry.label)}的任务">
          <span>${escapeHtml(entry.label)}</span><strong>${items.length}</strong>${blocked ? `<em class="chip-blocked">受阻 ${blocked}</em>` : ''}
        </button>`;
      }).join('');
    const stats = [
      { label: '已完成', value: overall.done },
      { label: '进行中', value: overall.doing },
      { label: '总完成度', value: `${overall.percent}%` }
    ].map((chip) => `<div class="summary-chip"><span>${escapeHtml(chip.label)}</span><strong>${escapeHtml(chip.value)}</strong></div>`).join('');
    $('#wbsSummary').innerHTML = `<span class="summary-label">按阶段筛选</span>${filters}<span class="summary-label">整体</span>${stats}`;
  }

  function render() {
    /* 进这一屏先同步一次：项目数据里出现新证据（生成材料、登记资源、写完比选结论）就自动勾上 */
    if (window.WB.wbs.autoTick(state())) store().save();
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
  }

  /* ── AI 生成任务分解 ───────────────────── */

  async function generate() {
    const current = state();
    if (!current.project) return;
    const selected = U.OUTPUT_ITEMS.filter((item) => current.project.outputs[item.key]);
    const data = await window.WB.ai.run('wbs', {
      活动基本信息: current.project.basic,
      已勾选产出: selected.map((item) => `${item.label}（${PHASE_LABEL[item.phase]}）`),
      阶段划分: PHASES.map((p) => `${p.label}（${p.window}）`),
      要求: '每个阶段至少 4 项任务，任务要能落到具体角色与产出物；关键交付节点标为里程碑'
    }, window.WB.ai.wbsContract());
    if (!data || !Array.isArray(data.rows)) return;
    const kept = current.wbs.filter((row) => row.source === 'user');
    const generated = data.rows.map((row) => store().normaliseRow({
      ...row,
      phase: PHASE_ORDER[row.phase] != null ? row.phase : 'plan',
      milestone: row.milestone === true || row.milestone === '是' || row.milestone === 'true',
      source: 'ai'
    })).filter((row) => row.task);
    current.wbs = [...generated, ...kept];
    store().log('wbs', `生成任务分解 ${generated.length} 项`);
    store().save();
    window.WB.renderAll();
    window.WB.toast(`生成 ${generated.length} 项任务${kept.length ? `，保留 ${kept.length} 项手动任务` : ''}`);
  }

  function mount() {
    const panel = $('#tasksPanel');
    /* 只挂一次：重复 mount 会让点击监听器叠加，同一次点击被处理多次 */
    if (panel.dataset.mounted) return;
    panel.dataset.mounted = '1';

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-row][data-key]');
      if (!el) return;
      const row = state().wbs[Number(el.dataset.row)];
      if (!row) return;
      const key = el.dataset.key;
      if (key === 'progress') {
        row.progress = clamp(Number(el.value), 0, 100, 0);
        if (row.status === 'done' && row.progress < 100) row.progress = 100;
        if (row.progress === 100) row.status = 'done';
        else if (row.status === 'done') row.status = 'doing';
      } else if (key === 'duration') {
        row.duration = el.value === '' ? '' : Number(el.value) || '';
      } else {
        row[key] = el.value;
      }
      row.source = 'user';
      store().save();
      const tr = el.closest('tr');
      const badge = tr?.querySelector('.badge');
      if (badge) badge.outerHTML = sourceBadge('user');
      if (key === 'progress') {
        tr?.querySelector('.cell-progress i')?.setAttribute('style', `width:${row.progress}%`);
        window.WB.views.tasks.render();
      }
      if (key === 'task' || key === 'source') window.WB.renderTopbar();
    });

    panel.addEventListener('change', (event) => {
      const rowEl = event.target.closest('[data-row][data-key]');
      if (rowEl) {
        const row = state().wbs[Number(rowEl.dataset.row)];
        if (!row) return;
        const key = rowEl.dataset.key;
        if (key === 'status') {
          row.status = rowEl.value;
          if (row.status === 'done') row.progress = 100;
          else if (row.progress === 100) row.progress = 90;
        } else if (key === 'milestone') {
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

    panel.addEventListener('click', (event) => {
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
        const index = Number(remove.dataset.remove);
        const dropped = state().wbs[index];
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

  window.WB.views.tasks = { id: 'tasks', label: '全周期任务', render, mount, generate };
}());
