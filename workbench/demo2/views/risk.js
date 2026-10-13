/* 风险预案：台账、5×5 矩阵、分级响应、覆盖度自检。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, RISK, PHASES, PHASE_LABEL, PHASE_ORDER, RISK_CATEGORY, LEVEL_LABEL, LEVEL_CLASS, sourceBadge, clamp } = U;
  const risk = () => window.WB.risk;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  /* ── 汇总与筛选 ───────────────────────── */

  function renderSummary() {
    const current = state();
    const risks = current.risks;
    const filter = current.ui.riskFilter;
    if (!risks.length && !filter) { $('#riskSummary').innerHTML = ''; return; }
    const counts = risk().distribution(risks);
    const chips = [
      { label: '风险总数', value: risks.length },
      { label: '高风险', value: counts.high },
      { label: '中风险', value: counts.medium },
      { label: '低风险', value: counts.low },
      { label: '覆盖阶段', value: `${new Set(risks.map((r) => r.phase)).size}/4` },
      { label: '覆盖类别', value: `${new Set(risks.map((r) => r.category)).size}/${RISK.categories.length}` }
    ];
    let html = chips.map((chip) => `<div class="summary-chip"><span>${escapeHtml(chip.label)}</span><strong>${escapeHtml(chip.value)}</strong></div>`).join('');
    if (filter) {
      const matched = risks.filter((r) => Number(r.probability) === filter.p && Number(r.impact) === filter.i).length;
      html += `<button class="summary-chip is-filter" data-clear-risk-filter>筛选中 可能性${filter.p} × 影响${filter.i}（${matched} 项） · 清除</button>`;
    }
    $('#riskSummary').innerHTML = html;
  }

  function renderMatrix() {
    const risks = state().risks;
    const filter = state().ui.riskFilter;
    const countAt = (p, i) => risks.filter((r) => Number(r.probability) === p && Number(r.impact) === i).length;
    const head = `<div class="mx-corner">影响 ＼ 可能性</div>${[1, 2, 3, 4, 5]
      .map((p) => `<div class="mx-col-label">${p}<small>${escapeHtml(RISK.probabilityAnchors[p - 1])}</small></div>`).join('')}`;
    const rows = [5, 4, 3, 2, 1].map((i) => `<div class="mx-row-label">${i}<small>${escapeHtml(RISK.impactAnchors[i - 1])}</small></div>${[1, 2, 3, 4, 5]
      .map((p) => {
        const count = countAt(p, i);
        const level = risk().levelOf(p * i);
        const active = filter && filter.p === p && filter.i === i;
        const cls = [`mx-cell`, LEVEL_CLASS[level], count ? '' : 'is-empty', active ? 'is-active' : ''].filter(Boolean).join(' ');
        return `<div class="${cls}" data-p="${p}" data-i="${i}"><b>${p * i}</b><small>${count ? `${count} 项` : '—'}</small></div>`;
      }).join('')}`).join('');
    $('#riskMatrix').innerHTML = `<div class="mx-grid has-row-labels">${head}${rows}</div>`;
  }

  function riskCard(item, index) {
    const score = risk().scoreOf(item);
    const level = risk().levelOf(score);
    const categoryOptions = RISK.categories
      .map((c) => `<option value="${c.value}" ${item.category === c.value ? 'selected' : ''}>${c.label}</option>`).join('');
    const phaseOptions = PHASES
      .map((p) => `<option value="${p.value}" ${item.phase === p.value ? 'selected' : ''}>${p.label}</option>`).join('');
    const scaleOptions = (selected) => [1, 2, 3, 4, 5]
      .map((value) => `<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${value}</option>`).join('');
    const fields = RISK.fields.map((field) => `<label><span>${escapeHtml(field.label)}</span>
      <textarea data-risk-field="${field.key}" placeholder="${escapeHtml(field.hint || '')}">${escapeHtml(item[field.key] || '')}</textarea></label>`).join('');
    return `<article class="risk-card" data-risk="${index}">
      <div class="risk-card-head">
        <span class="risk-dot ${LEVEL_CLASS[level]}"></span>
        <input class="risk-name" data-risk-field="name" value="${escapeHtml(item.name || '')}" placeholder="风险名称" />
        <span class="risk-score">${item.probability} × ${item.impact} = <b>${score}</b></span>
        ${sourceBadge(item.source)}
        <button class="row-remove" data-risk-remove="${index}" title="删除">×</button>
      </div>
      <div class="risk-meta">
        <label><span>类别</span><select data-risk-field="category">${categoryOptions}</select></label>
        <label><span>阶段</span><select data-risk-field="phase">${phaseOptions}</select></label>
        <label><span>挂靠任务</span><input data-risk-field="task" list="wbsTaskOptions" value="${escapeHtml(item.task || '')}" placeholder="任务分解表中的任务" /></label>
        <label><span>责任人</span><input data-risk-field="owner" value="${escapeHtml(item.owner || '')}" placeholder="角色" /></label>
        <label><span>可能性</span><select data-risk-field="probability">${scaleOptions(item.probability)}</select></label>
        <label><span>影响</span><select data-risk-field="impact">${scaleOptions(item.impact)}</select></label>
      </div>
      <div class="risk-fields">${fields}</div><p>风险编号：${escapeHtml(item.id || "待保存")} · 关联演练 ${state().drills.filter(d=>d.riskId===item.id).length} 场 · 预案修订 ${(item.planHistory||[]).length} 次</p><button class="button button-primary" data-risk-drill="${escapeHtml(item.id)}" ${U.canOperate() ? '' : 'disabled'}>对此风险发起演练</button>
      ${(item.planHistory||[]).length ? `<details><summary>查看预案修订记录</summary>${item.planHistory.map(h=>`<p>${escapeHtml(h.at)} · ${escapeHtml(h.actor)} · 演练 ${escapeHtml(h.drillId)}</p><pre style="white-space:pre-wrap">${escapeHtml(Object.keys(h.after||{}).filter(k=>h.after[k]!==h.before?.[k]).map(k=>`${k}：${h.before?.[k]||'未填写'} → ${h.after[k]}`).join('\n'))}</pre>`).join('')}</details>` : ''}
    </article>`;
  }

  function renderCheck() {
    const current = state();
    const result = risk().coverage(current.risks, current.wbs);
    const box = $('#riskCheck');
    if (!current.risks.length) { box.innerHTML = ''; return; }
    const stats = result.stats;
    const phaseChips = PHASES.map((phase) => {
      const count = stats.phases[phase.value] || 0;
      const ok = count >= RISK.coverage.minPerPhase;
      return `<span class="cv-chip ${ok ? 'is-ok' : 'is-warn'}">${escapeHtml(phase.label)} ${count}</span>`;
    }).join('');
    box.innerHTML = `<div class="card check-card ${result.ok ? 'is-ok' : 'is-warn'}">
      <div class="card-title"><h3>覆盖度自检（完整性提示，不代表安全保证）</h3><small>${escapeHtml(RISK.coverage.hint)}</small></div>
      <div class="cv-chips">${phaseChips}
        <span class="cv-chip ${stats.complete === stats.total ? 'is-ok' : 'is-warn'}">四要素写全 ${stats.complete}/${stats.total}</span>
        <span class="cv-chip ${stats.linked === stats.total ? 'is-ok' : 'is-warn'}">挂靠任务 ${stats.linked}/${stats.total}</span>
      </div>
      ${result.ok ? '<p class="check-line is-ok">通过：阶段、类别、分级分布与字段完整性均满足要求</p>'
        : `<ul class="gap-list">${result.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>`}
    </div>`;
  }

  function renderGroups() {
    const current = state();
    const risks = current.risks;
    const filter = current.ui.riskFilter;
    if (!risks.length) {
      $('#riskGroups').innerHTML = '<div class="card"><div class="empty"><strong>还没有风险台账</strong>先完成项目信息表与任务分解，再点「生成风险清单」。</div></div>';
      return;
    }
    const html = RISK.levels.map((level) => {
      const items = risks
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => risk().levelOfRisk(item) === level.value)
        .filter(({ item }) => !filter || (Number(item.probability) === filter.p && Number(item.impact) === filter.i));
      if (!items.length) return '';
      return `<section class="risk-group is-${level.value}">
        <div class="risk-group-head"><h3>${escapeHtml(level.label)}</h3><span class="count">${items.length} 项</span></div>
        <p class="risk-group-note">${escapeHtml(level.note)}</p>
        ${items.map(({ item, index }) => riskCard(item, index)).join('')}
      </section>`;
    }).join('');
    $('#riskGroups').innerHTML = html || '<div class="card"><div class="empty"><strong>该格没有风险</strong>点击矩阵中的格子可切换筛选。</div></div>';
  }

  function render() {
    const current = state();
    renderSummary();
    renderMatrix();
    renderCheck();
    renderGroups();
    const note = $('#riskCompliance');
    note.textContent = current.riskCompliance.length ? `合规提示：${current.riskCompliance.join('；')}` : '';
    note.classList.toggle('hidden', !current.riskCompliance.length);
    $('#wbsTaskOptions').innerHTML = current.wbs.filter((row) => row.task)
      .map((row) => `<option value="${escapeHtml(row.task)}"></option>`).join('');
    const disabled = !current.project || window.WB.ai.busy;
    $('#generateRisks').disabled = disabled;
    $('#calibrateRisks').disabled = disabled || !current.risks.length;
    U.gateAi($('#generateRisks'), Boolean(current.project) && !window.WB.ai.busy);
    U.gateAi($('#calibrateRisks'), Boolean(current.project) && !window.WB.ai.busy && current.risks.length > 0);
    $('#addRisk').disabled = !current.project;
    $('#exportRiskPlan').disabled = !current.risks.length;
    $('#exportChecklist').disabled = !current.risks.length;
  }

  /* ── 生成与校准 ───────────────────────── */

  function taskOptions() {
    return state().wbs.map((row) => row.task).filter(Boolean);
  }

  function matchTask(value) {
    const raw = U.text(value);
    if (!raw) return '';
    const tasks = taskOptions();
    if (tasks.includes(raw)) return raw;
    return tasks.filter((task) => raw.includes(task)).sort((a, b) => b.length - a.length)[0] || raw;
  }

  function normaliseRisk(raw) {
    const guarded = (value) => (U.text(value) && U.text(value) !== '待确认' ? U.text(value) : '待确认');
    return {
      id: U.uid("risk"), planHistory: [],
      name: U.text(raw.name).slice(0, 40),
      category: RISK_CATEGORY[raw.category] ? raw.category : 'safety',
      phase: PHASE_ORDER[raw.phase] != null ? raw.phase : 'prepare',
      task: matchTask(raw.task) || '待确认',
      probability: clamp(Number(raw.probability), 1, 5, 3),
      impact: clamp(Number(raw.impact), 1, 5, 3),
      trigger: guarded(raw.trigger),
      prevention: guarded(raw.prevention),
      response: guarded(raw.response),
      escalation: guarded(raw.escalation),
      owner: U.text(raw.owner) || '待确认',
      source: 'ai'
    };
  }

  async function calibrate({ silent = false } = {}) {
    if (!U.canOperate()) return false;
    const current = state(), project = current.project, snapshot = JSON.stringify(current.risks);
    const targets = current.risks.map((item, index) => ({ item, index })).filter(({ item }) => item.source !== 'user');
    if (targets.length < 4) return false;
    const data = await window.WB.ai.run('risk-calibrate', {
      评估要求: '按真实触发条件、预防措施和项目环境评估概率与影响；不得为凑分布调整分数',
      风险清单: targets.map(({ item, index }) => ({
        index: index + 1, 名称: item.name, 类别: RISK_CATEGORY[item.category] || '',
        阶段: PHASE_LABEL[item.phase] || '', 挂靠任务: item.task, 触发:item.trigger, 预防:item.prevention, 响应:item.response
      }))
    }, window.WB.ai.riskCalibrateContract());
    if (!data || !Array.isArray(data.scores)) return false;
    if (!U.canOperate() || current.project !== project || JSON.stringify(current.risks) !== snapshot) return false;
    if (!confirm("是否采用 AI 评分建议？建议不代表风险已消除，请根据实际证据核对。\n" + data.scores.map(e=>`${current.risks[Number(e.index)-1]?.name || "未知"}：${e.probability} × ${e.impact}`).join("\n"))) return false;
    let applied = 0;
    for (const entry of data.scores) {
      const item = current.risks[Number(entry.index) - 1];
      if (!item || item.source === 'user') continue;
      item.probability = clamp(Number(entry.probability), 1, 5, item.probability);
      item.impact = clamp(Number(entry.impact), 1, 5, item.impact);
      applied += 1;
    }
    if (!applied) return false;
    store().log('risk', `重新校准 ${applied} 项风险评分`);
    store().save();
    render();
    if (!silent) window.WB.toast(`已重新校准 ${applied} 项风险的评分`);
    return true;
  }

  async function generate() {
    const current = state();
    if (!current.project || !U.canOperate()) return;
    const project = current.project;
    if (!current.wbs.length) { window.WB.toast('请先生成任务分解表'); return; }
    const data = await window.WB.ai.run('risk-register', {
      活动基本信息: current.project.basic,
      任务分解: current.wbs.map((row) => ({ 任务: row.task, 阶段: PHASE_LABEL[row.phase] || row.phase, 负责角色: row.owner || '待确认' })),
      已勾选产出: U.OUTPUT_ITEMS.filter((item) => current.project.outputs[item.key]).map((item) => item.label)
    }, window.WB.ai.riskContract());
    if (!data || !Array.isArray(data.risks)) return;
    if (!U.canOperate() || current.project !== project) return;
    const kept = current.risks;
    const names = new Set(kept.map(r => `${r.category}|${r.name}`));
    const generated = data.risks.map(normaliseRisk).filter(item => { const key=`${item.category}|${item.name}`; if(!item.name || names.has(key)) return false; names.add(key); return true; });
    current.risks = [...generated, ...kept];
    current.riskCompliance = Array.isArray(data.compliance) ? data.compliance.slice(0, 3).map(String) : [];
    current.ui.riskFilter = null;
    store().log('risk', `生成风险清单 ${generated.length} 项`);
    store().save();
    render();
    window.WB.toast(`新增 ${generated.length} 项风险建议，保留原有 ${kept.length} 项；请人工核对评分`);
  }

  /* 应急联络卡：把高风险项压成一页可打印的处置卡 */
  function checklistToMarkdown() {
    const current = state();
    const name = store().projectName();
    const lines = [`# ${name}｜应急处置卡`, '', `> 升级链：${RISK.escalation}`, ''];
    const top = current.risks
      .map((item) => ({ item, score: risk().scoreOf(item) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    for (const { item, score } of top) {
      lines.push(`## ${item.name}（${risk().levelOf(score) === 'high' ? '高风险' : risk().levelOf(score) === 'medium' ? '中风险' : '低风险'}｜${score} 分）`, '');
      lines.push(`- 触发信号：${item.trigger || '待补充'}`);
      lines.push(`- 第一时间：${item.response || '待补充'}`);
      lines.push(`- 责任角色：${item.owner || '待确认'}｜挂靠任务：${item.task || '待确认'}`);
      lines.push(`- 升级到：${item.escalation || '待补充'}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function mount() {
    const panel = $('#riskPanel');

    panel.addEventListener('click', (event) => {
      const cell = event.target.closest('.mx-cell');
      if (cell && !cell.classList.contains('is-empty')) {
        const p = Number(cell.dataset.p);
        const i = Number(cell.dataset.i);
        const same = state().ui.riskFilter?.p === p && state().ui.riskFilter?.i === i;
        state().ui.riskFilter = same ? null : { p, i };
        store().save();
        render();
        return;
      }
      if (event.target.closest('[data-clear-risk-filter]')) {
        state().ui.riskFilter = null;
        store().save();
        render();
        return;
      }
      const drill = event.target.closest('[data-risk-drill]');
      if (drill) { window.WB.views.drills.startFromRisk(drill.dataset.riskDrill); return; }
      const remove = event.target.closest('[data-risk-remove]');
      if (remove) {
        if (!U.canOperate() || !confirm("删除此风险？历史演练仍保留原编号与预案快照。")) return;
        state().risks.splice(Number(remove.dataset.riskRemove), 1);
        store().save();
        render();
      }
    });

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-risk-field]');
      if (!el || !U.canOperate()) return;
      const card = el.closest('[data-risk]');
      const item = state().risks[Number(card?.dataset.risk)];
      if (!item) return;
      const key = el.dataset.riskField;
      item[key] = key === 'probability' || key === 'impact' ? Number(el.value) : el.value;
      item.source = 'user';
      store().save();
      if (key === 'probability' || key === 'impact') { render(); return; }
      const badge = card.querySelector('.badge');
      if (badge) badge.outerHTML = sourceBadge('user');
      if (key === 'category' || key === 'phase') render();
    });

    $('#generateRisks').addEventListener('click', generate);
    $('#calibrateRisks').addEventListener('click', () => calibrate());
    $('#addRisk').addEventListener('click', () => {
      if (!U.canOperate()) return;
      state().risks.push({
        id: U.uid('risk'), planHistory: [], name: '新风险', category: 'safety', phase: 'execute', task: '',
        probability: 3, impact: 3, trigger: '', prevention: '', response: '', escalation: '', owner: '', source: 'user'
      });
      store().save();
      render();
    });
    $('#exportRiskPlan').addEventListener('click', () => {
      if (!state().risks.length) { window.WB.toast('还没有风险台账'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-分级风险应急预案.md`, window.WB.exporters.riskPlanToMarkdown());
    });
    $('#exportChecklist').addEventListener('click', () => {
      if (!state().risks.length) { window.WB.toast('还没有风险台账'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-应急处置卡.md`, checklistToMarkdown());
    });
  }

  window.WB.views.risk = { id: 'risk', label: '风险预案', render, mount, generate, calibrate };
}());
