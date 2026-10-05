/* 总览：阶段进度、关键节点、风险分布、缺口提醒与快捷入口。
   卡片里的阶段块 / 关键节点 / 产出 / 缺口都带 data-goto-* 属性，是可点击入口，
   统一由 app.js 的 jumpFrom() 处理：跳到能处理它的视图、过滤到对应阶段、并定位高亮目标行。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, PHASE_LABEL, LEVEL_LABEL, OUTPUT_ITEMS, fmtDate } = U;

  const statCard = (label, value, unit, tone = '') => `
    <div class="stat ${tone ? `stat-${tone}` : ''}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong>
    </div>`;

  function renderCountdown(state) {
    const days = window.WB.wbs.daysLeft(state.project?.basic?.date);
    if (days == null) return statCard('距活动', '待定', '');
    if (days > 0) return statCard('距活动', String(days), '天');
    if (days === 0) return statCard('活动日', '就是今天', '', 'accent');
    return statCard('活动已结束', String(-days), '天', 'muted');
  }

  /* 填写路线图：从空项目到能导出材料的有序引导。
     每一步「做没做完」由 core/guide.js 从项目数据推断，点一行就跳到能处理它的地方；
     顶栏那颗「引导」按钮用的是同一份判断。 */
  function renderGuide(state) {
    const guide = window.WB.guide.progress(state);
    const gotoAttrs = (target) => [
      `data-goto-view="${escapeHtml(target.view)}"`,
      target.taskView ? `data-goto-taskview="${escapeHtml(target.taskView)}"` : '',
      target.phase ? `data-goto-phase="${escapeHtml(target.phase)}"` : '',
      target.openMaterial ? `data-goto-open="${escapeHtml(target.openMaterial)}"` : ''
    ].filter(Boolean).join(' ');
    const rows = guide.steps.map((step) => {
      const isCurrent = Boolean(guide.current) && guide.current.id === step.id;
      const tag = isCurrent ? '<i class="guide-tag is-now">当前</i>'
        : (step.optional ? '<i class="guide-tag">可选</i>' : '');
      return `<li><button type="button" class="guide-step is-${step.status}${isCurrent ? ' is-current' : ''}" ${gotoAttrs(step.target)} title="${escapeHtml(step.why)}">
        <span class="guide-num">${step.status === 'done' ? '✓' : step.index}</span>
        <span class="guide-body"><b>${escapeHtml(step.title)}${tag}</b><small>${escapeHtml(step.detail)}</small></span>
        <span class="guide-go">${step.status === 'done' ? '已完成' : escapeHtml(step.cta)} →</span>
      </button></li>`;
    }).join('');
    const next = guide.current
      ? `<button type="button" class="button button-primary guide-next" ${gotoAttrs(guide.current.target)}>下一步：${escapeHtml(guide.current.title)} →</button>`
      : '<span class="guide-all-done">✓ 主线都走完了，可以去做方案比选、变更演练或归档导出</span>';
    return `<div class="card guide-card">
      <div class="card-title"><h3>填写路线图</h3><small>按顺序做 · 完成状态由系统从项目数据推断，不用手动打勾 · 点任意一步直接过去</small></div>
      <div class="guide-top">
        <div class="guide-progress"><div class="bar"><i style="width:${guide.percent}%"></i></div><span>${guide.done} / ${guide.total} 步</span></div>
        ${next}
      </div>
      <ol class="guide-steps">${rows}</ol>
    </div>`;
  }
  function renderPhases(state) {
    const overall = window.WB.wbs.overall(state.wbs);
    const blocks = PHASES.map((phase) => {
      const stats = window.WB.wbs.phaseStats(state.wbs, phase.value);
      const gate = window.WB.wbs.gateStats(state.gates?.[phase.value], phase.value);
      const suffix = stats.percent >= 100 ? '已全部完成' : stats.total ? '去看任务' : '去补任务';
      return `<button type="button" class="phase-block phase-${phase.value}"
        data-goto-view="tasks" data-goto-taskview="table" data-goto-phase="${phase.value}"
        title="点击进入${escapeHtml(phase.label)}的任务分解表">
        <div class="phase-block-head">
          <span class="phase-pill phase-${phase.value}">${escapeHtml(phase.label)}</span>
          <span class="phase-window">${escapeHtml(phase.window)}</span>
          <strong class="phase-percent">${stats.percent}%</strong>
        </div>
        <div class="bar"><i style="width:${stats.percent}%"></i></div>
        <div class="phase-block-meta">
          <span>任务 ${stats.done}/${stats.total}</span>
          <span>门禁 ${gate.done}/${gate.total}</span>
          ${stats.blocked ? `<span class="warn">受阻 ${stats.blocked}</span>` : ''}
          <span class="phase-go">${suffix} →</span>
        </div>
      </button>`;
    }).join('');
    return `<div class="card">
      <div class="card-title"><h3>全周期进度</h3><small>总完成度 ${overall.percent}% · 里程碑 ${overall.milestonesDone}/${overall.milestones} · 点任意阶段直接进入它的任务表</small></div>
      <div class="phase-grid">${blocks}</div>
    </div>`;
  }

  function renderTimeline(state) {
    const items = window.WB.wbs.timeline(state.wbs, state.project?.basic?.date).slice(0, 6);
    if (!items.length) return '';
    const rows = items.map(({ row, date }) => `<li>
      <button type="button" class="tl-jump"
        data-goto-view="tasks" data-goto-taskview="table" data-goto-phase="${row.phase}" data-goto-row="${escapeHtml(row.id)}"
        title="跳到任务表里这一行">
        <span class="tl-date">${escapeHtml(fmtDate(date))}</span>
        <span class="tl-dot ${row.milestone ? 'is-milestone' : ''}"></span>
        <span class="tl-task">${escapeHtml(row.task || '未命名任务')}</span>
        <span class="phase-pill phase-${row.phase}">${escapeHtml(PHASE_LABEL[row.phase])}</span>
        <span class="tl-owner">${escapeHtml(row.owner || '待定')}</span>
        <span class="jump-go">→</span>
      </button>
    </li>`).join('');
    return `<div class="card">
      <div class="card-title"><h3>最近的关键节点</h3><small>按活动日期换算出的真实日期，含里程碑 · 点一条直接跳到任务表对应行</small></div>
      <ul class="timeline-mini">${rows}</ul>
    </div>`;
  }

  function renderRiskBlock(state) {
    const risks = state.risks || [];
    if (!risks.length) {
      return `<div class="card"><div class="card-title"><h3>风险态势</h3></div>
        <div class="empty"><strong>还没有风险台账</strong>先完成项目信息表与任务分解，再生成风险清单。
          <button type="button" class="button button-ghost empty-jump" data-goto-view="tasks" data-goto-taskview="table">先去任务分解表 →</button></div></div>`;
    }
    const dist = window.WB.risk.distribution(risks);
    const total = risks.length || 1;
    const check = window.WB.risk.coverage(risks, state.wbs);
    const segments = ['high', 'medium', 'low'].map((level) => `
      <div class="risk-seg risk-seg-${level}" style="flex:${dist[level] || 0.001}">
        <span>${escapeHtml(LEVEL_LABEL[level])}</span><strong>${dist[level]}</strong>
      </div>`).join('');
    return `<div class="card">
      <div class="card-title"><h3>风险态势</h3><small>共 ${risks.length} 项 · 覆盖 ${new Set(risks.map((r) => r.phase)).size}/4 个阶段</small></div>
      <div class="risk-bar">${segments}</div>
      <div class="risk-legend">高风险占比 ${Math.round((dist.high / total) * 100)}%</div>
      ${check.ok
        ? '<div class="check-line is-ok">覆盖度自检通过</div>'
        : `<button type="button" class="check-line is-warn is-clickable" data-goto-view="risk">发现 ${check.issues.length} 项待改进 · 点这里去风险预案处理 →</button>`}
    </div>`;
  }

  function renderGaps(state) {
    const gaps = window.WB.wbs.gaps(state);
    if (!gaps.length) {
      return `<div class="card"><div class="card-title"><h3>待办与缺口</h3></div>
        <div class="check-line is-ok">当前没有检测到明显缺口，可以进入收尾归档。</div></div>`;
    }
    const items = gaps.map((item) => {
      const target = item.target || {};
      const attrs = [
        `data-goto-view="${escapeHtml(target.view || 'overview')}"`,
        target.taskView ? `data-goto-taskview="${escapeHtml(target.taskView)}"` : '',
        target.phase ? `data-goto-phase="${escapeHtml(target.phase)}"` : '',
        target.openMaterial ? `data-goto-open="${escapeHtml(target.openMaterial)}"` : ''
      ].filter(Boolean).join(' ');
      return `<li><button type="button" class="gap-item" ${attrs}>
        <span class="gap-body"><b>${escapeHtml(item.text)}</b><small>${escapeHtml(item.hint || '')}</small></span>
        <span class="jump-go">去处理 →</span>
      </button></li>`;
    }).join('');
    return `<div class="card">
      <div class="card-title"><h3>待办与缺口</h3><small>系统自动检查出的待补齐项 · 点任意一条直接跳到处理它的地方</small></div>
      <ul class="gap-actions">${items}</ul>
    </div>`;
  }

  function renderOutputs(state) {
    const selected = OUTPUT_ITEMS.filter((item) => state.project?.outputs?.[item.key]);
    const generated = selected.filter((item) => state.materials?.[item.key]).length;
    const byPhase = PHASES.map((phase) => {
      const items = selected.filter((item) => item.phase === phase.value);
      if (!items.length) return '';
      const done = items.filter((item) => state.materials?.[item.key]).length;
      const pending = items.find((item) => !state.materials?.[item.key]);
      const title = pending ? `跳到过程材料并展开「${pending.label}」` : `跳到${phase.label}的材料`;
      return `<li><button type="button" class="out-jump"
        data-goto-view="material" data-goto-phase="${phase.value}"${pending ? ` data-goto-open="${escapeHtml(pending.key)}"` : ''}
        title="${escapeHtml(title)}">
        <span class="phase-pill phase-${phase.value}">${escapeHtml(phase.label)}</span>
        <span class="out-count">${done}/${items.length}</span>
        <span class="jump-go">${pending ? '去生成' : '去查看'} →</span>
      </button></li>`;
    }).join('');
    return `<div class="card">
      <div class="card-title"><h3>产出完成情况</h3><small>共勾选 ${selected.length} 份，已生成 ${generated} 份 · 点一行直接跳到过程材料</small></div>
      <ul class="out-list">${byPhase}</ul>
    </div>`;
  }

  function render() {
    const state = window.WB.store.state;
    const panel = $('#overviewPanel');
    if (!state.project) {
      panel.innerHTML = `<div class="card"><div class="empty"><strong>还没有项目</strong>点击右上角「重新填写」，或从「数据与帮助」载入示例项目。</div></div>`;
      return;
    }
    const overall = window.WB.wbs.overall(state.wbs);
    const stats = [
      renderCountdown(state),
      statCard('任务完成度', String(overall.percent), '%'),
      statCard('进行中 / 受阻', `${overall.doing} / ${overall.blocked}`, '项', overall.blocked ? 'warn' : ''),
      statCard('风险总数', String((state.risks || []).length), '项')
    ].join('');

    panel.innerHTML = `
      <div class="stats-row">${stats}</div>
      ${renderGuide(state)}
      ${renderPhases(state)}
      <div class="two-col">
        ${renderRiskBlock(state)}
        ${renderGaps(state)}
      </div>
      <div class="two-col">
        ${renderTimeline(state)}
        ${renderOutputs(state)}
      </div>`;
  }

  window.WB.views.overview = { id: 'overview', label: '总览', render };
}());
