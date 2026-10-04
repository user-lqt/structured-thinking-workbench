/* 突发变更演练：按风险类别选择场景，逐步推演处置动作，并把结论回写到风险与变更记录。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASE_LABEL, RISK_CATEGORY, LEVEL_LABEL, LEVEL_CLASS, RESOURCE_KIND, fmtDateTime, canOperate } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  /* 场景类别 → 需要检查备用能力的资源类型 */
  const CATEGORY_RESOURCE = {
    safety: ['staff', 'equipment'],
    health: ['staff', 'material'],
    venue: ['venue', 'equipment'],
    tech: ['equipment'],
    program: ['staff'],
    weather: ['venue', 'material'],
    finance: ['fund'],
    compliance: ['staff'],
    publicity: ['staff'],
    participation: ['venue', 'material']
  };

  const catLabel = (value) => RISK_CATEGORY[value] || value || '未分类';

  function stat(label, value, unit, tone = '') {
    return `<div class="stat ${tone ? `stat-${tone}` : ''}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong>
    </div>`;
  }

  function renderStats(current) {
    const coverage = window.WB.drills.coverage();
    const running = current.drills.filter((item) => item.status === 'running').length;
    const done = current.drills.filter((item) => item.status === 'done').length;
    $('#drillsStats').innerHTML = `<div class="wbs-summary">
      ${stat('演练场景库', window.WB.drills.SCENARIOS.length, '个')}
      ${stat('风险类别覆盖', coverage.missing.length ? `${10 - coverage.missing.length}/10` : '10/10', '', coverage.ok ? '' : 'danger')}
      ${stat('进行中演练', running, '场')}
      ${stat('已完成演练', done, '场')}
    </div>`;
  }

  function renderToolbar() {
    const canWrite = canOperate();
    $('#drillsToolbar').innerHTML = `
      <span class="asset-filter">
        <select data-drill-filter="category">
          <option value="">全部风险类别</option>
          ${Object.entries(RISK_CATEGORY).map(([value, label]) => `<option value="${value}" ${state().ui.drillCategory === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </span>
      <div class="panel-actions">
        <button class="button button-ghost" data-drill-export ${state().drills.length ? '' : 'disabled'}>导出演练记录</button>
        <button class="button button-ghost danger" data-drill-clear ${state().drills.length && canWrite ? '' : 'disabled'}>清空演练记录</button>
      </div>`;
  }

  /* ── 备用能力检查：演练前先看资源还有没有余量 ── */
  function capability(scenario) {
    const kinds = CATEGORY_RESOURCE[scenario.category] || [];
    const rows = state().resources.filter((item) => kinds.includes(item.kind));
    if (!rows.length) return { rows: [], spare: null, kinds };
    const spare = rows.filter((item) => Number(item.available) - Number(item.assigned) > 0).length;
    return { rows, spare, kinds };
  }

  function capabilityBlock(scenario) {
    const { rows, spare, kinds } = capability(scenario);
    if (!rows.length) {
      return `<div class="check-line is-warn">资源台账里还没有登记「${kinds.map((k) => RESOURCE_KIND[k] || k).join(' / ')}」类资源，无法判断执行这场变更时还有多少余量。建议先到「人员与资源」页补齐。</div>`;
    }
    const tone = spare === 0 ? 'is-warn' : 'is-ok';
    const text = spare === 0
      ? `相关资源全部排满，突发变更时没有额外余量，需要提前约定「谁让出资源」`
      : `相关资源中有 ${spare} 项仍有余量，可作为变更时的缓冲`;
    return `<div class="check-line ${tone}">${escapeHtml(text)}</div>
      <ul class="drill-res-list">${rows.map((item) => {
        const gap = Number(item.available) - Number(item.assigned);
        return `<li><span class="chip chip-${gap > 0 ? 'ok' : 'over'}">${escapeHtml(RESOURCE_KIND[item.kind] || item.kind)}</span>
          ${escapeHtml(item.name || '未命名资源')}：可用 ${Number(item.available)} / 已安排 ${Number(item.assigned)}
          ${gap > 0 ? '' : '<b class="warn">无余量</b>'}</li>`;
      }).join('')}</ul>`;
  }

  /* ── 场景库 ───────────────────────────── */

  function scenarioCard(scenario) {
    const canWrite = canOperate();
    const steps = scenario.steps.length;
    return `<article class="drill-card" data-scenario="${scenario.id}">
      <div class="drill-card-head">
        <span class="phase-pill phase-${scenario.phase}">${escapeHtml(PHASE_LABEL[scenario.phase] || scenario.phase)}</span>
        <span class="risk-level ${LEVEL_CLASS[scenario.severity] || ''}">${escapeHtml(LEVEL_LABEL[scenario.severity] || scenario.severity)}</span>
        <span class="chip">${escapeHtml(catLabel(scenario.category))}</span>
      </div>
      <h3>${escapeHtml(scenario.title)}</h3>
      <p class="drill-trigger"><b>触发</b>${escapeHtml(scenario.trigger)}</p>
      <p class="drill-impact"><b>影响</b>${escapeHtml(scenario.impact)}</p>
      <div class="drill-card-foot">
        <small>${steps} 步处置 · 升级至 ${escapeHtml(scenario.escalateTo[0] || '总协调')}</small>
        <button class="button button-primary" data-drill-start="${scenario.id}" ${canWrite ? '' : 'disabled'}>启动演练</button>
      </div>
    </article>`;
  }

  function renderScenarios(current) {
    const category = current.ui.drillCategory || '';
    const list = window.WB.drills.SCENARIOS.filter((item) => !category || item.category === category);
    $('#drillScenarios').innerHTML = list.length
      ? `<div class="drill-grid">${list.map(scenarioCard).join('')}</div>`
      : '<div class="card"><div class="empty">该类别下暂无预置场景。</div></div>';
  }

  /* ── 演练运行台 ───────────────────────── */

  function currentDrill() {
    const current = state();
    if (!current.ui.drillId) return null;
    return current.drills.find((item) => item.id === current.ui.drillId) || null;
  }

  function runnerBlock(drill) {
    const scenario = window.WB.drills.byId(drill.scenarioId);
    const done = drill.steps.filter((step) => step.done).length;
    const percent = drill.steps.length ? Math.round((done / drill.steps.length) * 100) : 0;
    const canWrite = canOperate();
    const lock = canWrite ? '' : 'disabled';
    const aiEnabled = Boolean(window.WB.ai?.ready) && !window.WB.ai.busy;
    const aiTitle = !canWrite ? '只读访客不能运行演练' : window.WB.ai?.ready ? '' : U.AI_OFFLINE_HINT;
    const steps = drill.steps.map((step, index) => `<li class="drill-step ${step.done ? 'is-done' : ''}">
        <label class="drill-step-line">
          <input type="checkbox" data-drill-step="${step.id}" ${step.done ? 'checked' : ''} ${lock} />
          <span class="drill-step-index">${index + 1}</span>
          <span class="drill-step-text">${escapeHtml(step.text || '（空步骤）')}</span>
        </label>
        <input class="drill-step-note" data-drill-step-note="${step.id}" value="${escapeHtml(step.note || '')}" placeholder="执行情况 / 偏差记录" ${lock} />
      </li>`).join('');

    return `<div class="card drill-runner">
      <div class="card-title">
        <h3>${drill.status === 'running' ? '演练进行中' : '演练记录'}：${escapeHtml(drill.title)}</h3>
        <small>${escapeHtml(catLabel(drill.category))} · ${escapeHtml(PHASE_LABEL[drill.phase] || drill.phase)} · 开始于 ${escapeHtml(fmtDateTime(drill.startedAt))}${drill.finishedAt ? ` · 结束于 ${escapeHtml(fmtDateTime(drill.finishedAt))}` : ''}</small>
      </div>
      <div class="drill-progress"><span>处置进度</span><div class="bar"><i style="width:${percent}%"></i></div><b>${done}/${drill.steps.length}</b></div>
      ${scenario ? `<p class="drill-trigger"><b>触发</b>${escapeHtml(scenario.trigger)}</p>` : ''}
      ${capabilityBlock(scenario || { category: drill.category, phase: drill.phase })}
      <ol class="drill-steps">${steps}</ol>
      <div class="drill-fields">
        <label><span>关键决策</span><textarea data-drill-field="decisions" rows="2" placeholder="例如：选择更换场地而不是顺延，因为嘉宾返程时间不可调整" ${lock}>${escapeHtml(drill.decisions || '')}</textarea></label>
        <label><span>演练结果 / 复盘结论</span><textarea data-drill-field="outcome" rows="2" placeholder="例如：12 分钟内完成场地切换，未影响主线流程；暴露备用场地无投影的问题" ${lock}>${escapeHtml(drill.outcome || '')}</textarea></label>
      </div>
      ${scenario ? `<div class="drill-refs">
        <div><b>回退条件</b>${escapeHtml(drill.rollback || scenario.rollback)}</div>
        <div><b>升级路径</b>${escapeHtml(scenario.escalateTo.join(' → '))}</div>
        <div><b>改进项</b>${escapeHtml((drill.followUp?.length ? drill.followUp : scenario.followUp).join('；'))}</div>
      </div>` : ''}
      <div class="panel-actions drill-actions">
        <button class="button button-ghost" data-drill-ai ${drill.status === 'running' && canWrite && aiEnabled ? '' : 'disabled'} title="${escapeHtml(aiTitle)}"><span>✦</span> AI 生成处置步骤</button>
        <label class="drill-check-inline"><input type="checkbox" data-drill-write-risk ${drill.writeRisk === false ? '' : 'checked'} ${lock} /><span>结束后写入风险台账</span></label>
        <button class="button button-primary" data-drill-finish ${drill.status === 'running' ? '' : 'disabled'}>结束演练</button>
        <button class="button button-ghost" data-drill-abandon>放弃本场</button>
        <button class="button button-ghost" data-drill-close>收起</button>
      </div>
    </div>`;
  }

  function renderRunner(current) {
    const drill = currentDrill();
    const box = $('#drillRunner');
    if (!drill) { box.innerHTML = ''; return; }
    box.innerHTML = runnerBlock(drill);
  }

  /* ── 历史记录 ─────────────────────────── */

  function renderHistory(current) {
    const list = current.drills.filter((item) => item.status === 'done');
    if (!list.length) {
      $('#drillHistory').innerHTML = '';
      return;
    }
    $('#drillHistory').innerHTML = `<div class="card">
      <div class="card-title"><h3>已完成演练 ${list.length} 场</h3><small>演练记录会进入变更记录，并可直接写入风险台账</small></div>
      <ul class="drill-history">${list.map((item) => {
        const done = item.steps.filter((step) => step.done).length;
        return `<li>
          <div class="drill-history-main">
            <b>${escapeHtml(item.title)}</b>
            <small>${escapeHtml(catLabel(item.category))} · ${escapeHtml(fmtDateTime(item.finishedAt || item.startedAt))} · 处置 ${done}/${item.steps.length} 步</small>
            <p>${escapeHtml(item.outcome || '（未填写演练结论）')}</p>
          </div>
          <div class="drill-history-actions">
            <button class="button button-ghost" data-drill-open="${item.id}">查看</button>
            <button class="button button-ghost danger" data-drill-delete="${item.id}">删除</button>
          </div>
        </li>`;
      }).join('')}</ul>
    </div>`;
  }

  function render() {
    const current = state();
    renderStats(current);
    renderToolbar(current);
    renderRunner(current);
    renderScenarios(current);
    renderHistory(current);
  }

  /* ── 操作 ─────────────────────────────── */

  function startDrill(scenarioId) {
    const scenario = window.WB.drills.byId(scenarioId);
    if (!scenario) return;
    const drill = {
      id: U.uid('drill'),
      scenarioId: scenario.id,
      title: scenario.title,
      category: scenario.category,
      phase: scenario.phase,
      riskName: scenario.title,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      decisions: '',
      outcome: '',
      rollback: scenario.rollback,
      followUp: [...scenario.followUp],
      status: 'running',
      writeRisk: true,
      steps: scenario.steps.map((step) => ({ id: step.id, done: false, note: '' })),
      source: 'user'
    };
    state().drills.unshift(drill);
    state().ui.drillId = drill.id;
    store().log('drill', `启动演练：${scenario.title}（${catLabel(scenario.category)}）`);
    store().save();
    render();
    window.WB.toast(`已启动演练：${scenario.title}`);
  }

  async function aiSteps() {
    const drill = currentDrill();
    const scenario = drill && window.WB.drills.byId(drill.scenarioId);
    if (!drill || !scenario) return;
    const current = state();
    const data = await window.WB.ai.run('change-drill', {
      场景: { 标题: scenario.title, 风险类别: catLabel(scenario.category), 阶段: scenario.phase, 触发信号: scenario.trigger, 影响: scenario.impact, 预置步骤: scenario.steps.map((s) => s.text) },
      项目信息: current.project?.basic || {},
      可用资源: current.resources.map((item) => `${RESOURCE_KIND[item.kind] || item.kind}｜${item.name}｜可用 ${item.available}｜已安排 ${item.assigned}`),
      同类别已有风险: current.risks.filter((risk) => risk.category === scenario.category).map((risk) => risk.name),
      要求: '把场景落到本项目的真实资源与角色上，输出 4-8 步可执行处置动作'
    }, window.WB.ai.drillContract());
    if (!data) return;
    if (Array.isArray(data.steps) && data.steps.length) {
      drill.steps = data.steps
        .map((step) => (typeof step === 'string' ? { text: step } : step))
        .filter((step) => U.text(step.text))
        .slice(0, 8)
        .map((step, index) => ({ id: `${drill.id}-ai${index + 1}`, done: false, note: '' , text: U.text(step.text) }));
    }
    if (data.decisions) drill.decisions = U.text(data.decisions);
    if (data.rollback) drill.rollback = U.text(data.rollback);
    if (Array.isArray(data.followUp)) drill.followUp = data.followUp.map(String).slice(0, 3);
    if (data.risk && typeof data.risk === 'object') drill.aiRisk = data.risk;
    store().log('ai', `演练「${scenario.title}」生成 ${drill.steps.length} 步处置动作`);
    store().save();
    render();
  }

  /* 把演练结论沉淀成一条风险台账记录（同名同类别则更新响应内容） */
  function writeRisk(drill) {
    const scenario = window.WB.drills.byId(drill.scenarioId);
    const ai = drill.aiRisk || {};
    const name = U.text(ai.name) || drill.riskName || drill.title;
    const existing = state().risks.find((risk) => risk.name === name);
    const patch = {
      name,
      category: scenario?.category || drill.category || 'safety',
      phase: scenario?.phase || drill.phase || 'execute',
      probability: Number(ai.probability) || 3,
      impact: Number(ai.impact) || 4,
      trigger: U.text(ai.trigger) || scenario?.trigger || '',
      prevention: U.text(ai.prevention) || scenario?.followUp?.join('；') || '',
      response: U.text(ai.response) || drill.steps.filter((step) => step.done).map((step) => step.text).join('；') || drill.decisions,
      escalation: U.text(ai.escalation) || scenario?.escalateTo?.join(' → ') || '',
      owner: U.text(ai.owner) || scenario?.escalateTo?.[0] || '',
      source: 'drill'
    };
    if (existing) Object.assign(existing, patch);
    else state().risks.push(store().normaliseRisk(patch));
    return name;
  }

  function finishDrill() {
    const drill = currentDrill();
    if (!drill || drill.status !== 'running') return;
    const undone = drill.steps.filter((step) => !step.done).length;
    if (undone && !confirm(`还有 ${undone} 步未勾选完成，仍要结束本场演练？`)) return;
    drill.status = 'done';
    drill.finishedAt = new Date().toISOString();
    if (!drill.outcome) drill.outcome = drill.steps.filter((step) => step.done).map((step) => step.text).join('；').slice(0, 200) || '已完成演练，未填写结论';
    store().log('drill', `结束演练：${drill.title}，处置 ${drill.steps.filter((step) => step.done).length}/${drill.steps.length} 步`);
    if (drill.writeRisk !== false) {
      const name = writeRisk(drill);
      drill.riskName = name;
      store().log('risk', `演练结论已写入风险台账：${name}`);
    }
    store().save();
    render();
    window.WB.toast('演练已结束，结论已进入变更记录');
  }

  function abandonDrill() {
    const drill = currentDrill();
    if (!drill) return;
    if (!confirm('放弃本场演练并删除记录？')) return;
    const index = state().drills.indexOf(drill);
    if (index >= 0) state().drills.splice(index, 1);
    state().ui.drillId = null;
    store().save();
    render();
  }

  function mount() {
    const panel = $('#drillsPanel');

    panel.addEventListener('click', (event) => {
      const start = event.target.closest('[data-drill-start]');
      if (start) { startDrill(start.dataset.drillStart); return; }
      if (event.target.closest('[data-drill-ai]')) { aiSteps(); return; }
      if (event.target.closest('[data-drill-finish]')) { finishDrill(); return; }
      if (event.target.closest('[data-drill-abandon]')) { abandonDrill(); return; }
      if (event.target.closest('[data-drill-close]')) { state().ui.drillId = null; store().save(); render(); return; }
      if (event.target.closest('[data-drill-export]')) {
        U.downloadText(`${U.safeFileName(store().projectName())}-突发变更演练记录.md`, window.WB.exporters.drillsToMarkdown());
        return;
      }
      if (event.target.closest('[data-drill-clear]')) {
        if (!confirm('清空全部演练记录？风险台账中已写入的条目会保留。')) return;
        state().drills = [];
        state().ui.drillId = null;
        store().save();
        render();
        return;
      }
      const open = event.target.closest('[data-drill-open]');
      if (open) { state().ui.drillId = open.dataset.drillOpen; store().save(); render(); return; }
      const remove = event.target.closest('[data-drill-delete]');
      if (remove) {
        const index = state().drills.findIndex((item) => item.id === remove.dataset.drillDelete);
        if (index >= 0) state().drills.splice(index, 1);
        if (state().ui.drillId === remove.dataset.drillDelete) state().ui.drillId = null;
        store().save();
        render();
      }
    });

    panel.addEventListener('change', (event) => {
      const step = event.target.closest('[data-drill-step]');
      if (step) {
        const drill = currentDrill();
        const target = drill?.steps.find((item) => item.id === step.dataset.drillStep);
        if (target) { target.done = step.checked; store().save(); render(); }
        return;
      }
      const writeRiskBox = event.target.closest('[data-drill-write-risk]');
      if (writeRiskBox) {
        const drill = currentDrill();
        if (drill) { drill.writeRisk = writeRiskBox.checked; store().save(); }
        return;
      }
      const filter = event.target.closest('[data-drill-filter]');
      if (filter) {
        state().ui.drillCategory = filter.value;
        store().save();
        render();
      }
    });

    panel.addEventListener('input', (event) => {
      const drill = currentDrill();
      if (!drill) return;
      const note = event.target.closest('[data-drill-step-note]');
      if (note) {
        const target = drill.steps.find((item) => item.id === note.dataset.drillStepNote);
        if (target) { target.note = note.value; store().save(); }
        return;
      }
      const field = event.target.closest('[data-drill-field]');
      if (field) {
        drill[field.dataset.drillField] = field.value;
        store().save();
      }
    });
  }

  window.WB.views.drills = { id: 'drills', label: '变更演练', render, mount, startDrill };
}());
