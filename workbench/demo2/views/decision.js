/* 方案比选：多方案 × 多准则加权评分，输出可追溯的决策结论。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, DECISION, uid } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  const weighted = (option, criteria, scores) => {
    const totalWeight = criteria.reduce((sum, c) => sum + Number(c.weight || 0), 0) || 1;
    const sum = criteria.reduce((acc, c) => acc + Number(scores?.[option.name]?.[c.label] || 0) * Number(c.weight || 0), 0);
    return sum / totalWeight;
  };

  const score = (scores, option, criterion) => Number(scores?.[option.name]?.[criterion.label] || 0);

  function renderOptions(options) {
    if (!options.length) return '<div class="empty"><strong>还没有候选方案</strong>点击「载入预设」或「＋ 添加方案」开始比选。</div>';
    return options.map((option, index) => `<div class="option-row" data-option="${index}">
      <span class="option-index">${index + 1}</span>
      <input data-option-field="name" value="${escapeHtml(option.name)}" placeholder="方案名称" />
      <input data-option-field="summary" value="${escapeHtml(option.summary || '')}" placeholder="一句话说明这个方案的思路" />
      <button class="row-remove" data-option-remove="${index}" title="删除">×</button>
    </div>`).join('');
  }

  function renderCriteria(criteria) {
    if (!criteria.length) return '<div class="empty"><strong>还没有评价维度</strong>点击「载入预设」或「＋ 添加维度」。</div>';
    return criteria.map((criterion, index) => `<div class="criterion-row" data-criterion="${index}">
      <input data-criterion-field="label" value="${escapeHtml(criterion.label)}" placeholder="维度名称" />
      <input data-criterion-field="weight" type="number" min="1" max="5" value="${criterion.weight}" title="权重 1–5" />
      <input data-criterion-field="hint" value="${escapeHtml(criterion.hint || '')}" placeholder="这个维度看什么" />
      <button class="row-remove" data-criterion-remove="${index}" title="删除">×</button>
    </div>`).join('');
  }

  function renderMatrix(options, criteria, scores) {
    if (!options.length || !criteria.length) return '';
    const head = `<tr><th class="mx-name">方案 \\ 维度</th>${criteria
      .map((c) => `<th><span class="mx-criterion">${escapeHtml(c.label)}</span><small>权重 ${criterion_weight(c)}</small></th>`).join('')}<th class="mx-total">加权得分</th></tr>`;
    const rows = options.map((option) => {
      const cells = criteria.map((criterion) => {
        const value = score(scores, option, criterion);
        const reason = scores?.[option.name]?.[`${criterion.label}__reason`] || '';
        return `<td class="mx-score" data-score-cell="${escapeHtml(option.name)}|${escapeHtml(criterion.label)}">
          <select data-score="${escapeHtml(option.name)}|${escapeHtml(criterion.label)}">
            <option value="0" ${value ? '' : 'selected'}>—</option>
            ${DECISION.scale.map((s) => `<option value="${s.value}" ${value === s.value ? 'selected' : ''}>${s.value}</option>`).join('')}
          </select>
          <input class="mx-reason" data-reason="${escapeHtml(option.name)}|${escapeHtml(criterion.label)}" value="${escapeHtml(reason)}" placeholder="理由（选填）" />
        </td>`;
      }).join('');
      return `<tr><th class="mx-name">${escapeHtml(option.name)}</th>${cells}
        <td class="mx-total">${weighted(option, criteria, scores).toFixed(2)}</td></tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="matrix decision-matrix"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  const criterion_weight = (criterion) => criterion.weight;

  function renderRanking(options, criteria, scores) {
    if (!options.length || !criteria.length) return '';
    const ranked = options
      .map((option) => ({ option, value: weighted(option, criteria, scores) }))
      .sort((a, b) => b.value - a.value);
    const best = ranked[0];
    const items = ranked.map((item, index) => `<li class="${index === 0 ? 'is-best' : ''}">
      <span class="rank-index">${index + 1}</span>
      <span class="rank-name">${escapeHtml(item.option.name)}</span>
      <span class="rank-value">${item.value.toFixed(2)}</span>
      <span class="rank-bar"><i style="width:${(item.value / 5) * 100}%"></i></span>
    </li>`).join('');
    const gap = ranked.length > 1 ? best.value - ranked[1].value : best.value;
    const advice = ranked.length < 2
      ? '至少需要两个方案才能形成比选。'
      : gap < 0.3
        ? `前两名仅差 ${gap.toFixed(2)} 分，区分度不足，建议补充维度或重新打分后再定。`
        : `推荐「${best.option.name}」，领先第二名 ${gap.toFixed(2)} 分。`;
    return `<div class="card">
      <div class="card-title"><h3>加权结果与建议</h3><small>加权得分 = Σ(评分 × 权重) / Σ权重，满分 5 分</small></div>
      <ul class="rank-list">${items}</ul>
      <p class="decision-advice">${escapeHtml(advice)}</p>
    </div>`;
  }

  function render() {
    const current = state();
    const { selected: options, criteria, scores, decision, note } = current.options;
    const has = Boolean(current.project);
    for (const id of ['decisionPreset', 'decisionAi', 'addOption', 'addCriterion', 'exportDecision', 'decisionLoadProject']) {
      const el = document.getElementById(id);
      if (el) el.disabled = !has && id !== 'decisionPreset' && id !== 'decisionLoadProject';
    }
    U.gateAi(document.getElementById('decisionAi'), has);
    if (!has) {
      $('#decisionBody').innerHTML = '<div class="card"><div class="empty"><strong>请先建立项目信息表</strong>比选要围绕活动目标展开。</div></div>';
      return;
    }
    $('#decisionBody').innerHTML = `
      <div class="two-col">
        <div class="card">
          <div class="card-title"><h3>候选方案</h3><small>同一活动目标下的不同实现路径</small></div>
          ${renderOptions(options)}
        </div>
        <div class="card">
          <div class="card-title"><h3>评价维度与权重</h3><small>权重 1–5，权重越高对决策影响越大</small></div>
          ${renderCriteria(criteria)}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>评分矩阵</h3><small>1–5 分，可写打分理由；未评分的格子不计入</small></div>
        ${renderMatrix(options, criteria, scores)}
      </div>
      ${renderRanking(options, criteria, scores)}
      <div class="card">
        <div class="card-title"><h3>决策结论</h3><small>写清楚选了什么、为什么、放弃的方案理由</small></div>
        <textarea class="big-textarea" data-decision-field="decision" placeholder="例：选定方案 B，因为……；放弃方案 A，因为……">${escapeHtml(decision)}</textarea>
        <label class="material-title" style="margin-top:12px"><span>补充说明（约束、假设、待验证事项）</span>
          <textarea data-decision-field="note" rows="3" placeholder="选填">${escapeHtml(note)}</textarea></label>
      </div>`;
  }

  function loadPreset() {
    const current = state();
    if (!current.project) return;
    current.options.criteria = DECISION.presetCriteria.map((c) => ({ ...c }));
    current.options.selected = DECISION.presetOptions.map((name, index) => ({
      id: uid('opt'), name, summary: ['集中办会，场面大、组织简单', '多点开花，覆盖广、协调成本高', '线上线下混合，触达广、依赖设备'][index] || ''
    }));
    current.options.scores = {};
    store().log('decision', '载入方案比选预设');
    store().save();
    render();
    window.WB.toast('已载入预设方案与维度，可按需修改');
  }

  async function aiSuggest() {
    const current = state();
    if (!current.project) return;
    const data = await window.WB.ai.run('decision-matrix', {
      活动基本信息: current.project.basic,
      已有方案: current.options.selected.map((o) => o.name),
      已有维度: current.options.criteria.map((c) => c.label),
      要求: '给出 3 个互斥可行的方案，以及 5–6 个评价维度；为每个方案 × 每个维度给出 1–5 分与一句理由'
    }, window.WB.ai.decisionContract());
    if (!data) return;
    const options = (data.options || []).map((o) => ({ id: uid('opt'), name: U.text(o.name), summary: U.text(o.summary) })).filter((o) => o.name);
    const criteria = (data.criteria || []).map((c) => ({ label: U.text(c.label), weight: U.clamp(Number(c.weight), 1, 5, 3), hint: U.text(c.hint) })).filter((c) => c.label);
    if (!options.length || !criteria.length) { window.WB.toast('AI 返回的方案或维度不完整，请重试'); return; }
    const scores = {};
    for (const item of data.scores || []) {
      const optionName = U.text(item.option);
      const criterion = U.text(item.criterion);
      if (!optionName || !criterion) continue;
      scores[optionName] ||= {};
      scores[optionName][criterion] = U.clamp(Number(item.score), 1, 5, 3);
      if (item.reason) scores[optionName][`${criterion}__reason`] = U.text(item.reason);
    }
    current.options.selected = options;
    current.options.criteria = criteria;
    current.options.scores = scores;
    store().log('decision', `AI 生成 ${options.length} 个方案、${criteria.length} 个维度`);
    store().save();
    render();
    window.WB.toast(`已生成 ${options.length} 个方案 × ${criteria.length} 个维度`);
  }

  function mount() {
    const panel = $('#decisionPanel');

    panel.addEventListener('input', (event) => {
      const current = state();
      const optionField = event.target.closest('[data-option-field]');
      if (optionField) {
        const index = Number(optionField.closest('[data-option]').dataset.option);
        const option = current.options.selected[index];
        if (!option) return;
        const key = optionField.dataset.optionField;
        const before = option.name;
        option[key] = optionField.value;
        if (key === 'name' && before !== optionField.value) {
          current.options.scores[optionField.value] = current.options.scores[before] || {};
          delete current.options.scores[before];
        }
        store().save();
        return;
      }
      const criterionField = event.target.closest('[data-criterion-field]');
      if (criterionField) {
        const index = Number(criterionField.closest('[data-criterion]').dataset.criterion);
        const criterion = current.options.criteria[index];
        if (!criterion) return;
        const key = criterionField.dataset.criterionField;
        const before = criterion.label;
        criterion[key] = key === 'weight' ? U.clamp(Number(criterionField.value), 1, 5, 3) : criterionField.value;
        if (key === 'label' && before !== criterionField.value) {
          for (const option of current.options.selected) {
            const bucket = current.options.scores[option.name] ||= {};
            bucket[criterionField.value] = bucket[before];
            bucket[`${criterionField.value}__reason`] = bucket[`${before}__reason`];
            delete bucket[before];
            delete bucket[`${before}__reason`];
          }
        }
        store().save();
        if (key === 'weight') render();
        return;
      }
      const decisionField = event.target.closest('[data-decision-field]');
      if (decisionField) {
        current.options[decisionField.dataset.decisionField] = decisionField.value;
        store().save();
      }
    });

    panel.addEventListener('change', (event) => {
      const select = event.target.closest('[data-score]');
      if (select) {
        const [optionName, criterion] = select.dataset.score.split('|');
        const bucket = state().options.scores;
        bucket[optionName] ||= {};
        bucket[optionName][criterion] = Number(select.value);
        store().save();
        render();
        return;
      }
      const reason = event.target.closest('[data-reason]');
      if (reason) {
        const [optionName, criterion] = reason.dataset.reason.split('|');
        const bucket = state().options.scores;
        bucket[optionName] ||= {};
        bucket[optionName][`${criterion}__reason`] = reason.value;
        store().save();
      }
    });

    panel.addEventListener('click', (event) => {
      const current = state();
      const removeOption = event.target.closest('[data-option-remove]');
      if (removeOption) {
        const index = Number(removeOption.dataset.optionRemove);
        const [removed] = current.options.selected.splice(index, 1);
        if (removed) delete current.options.scores[removed.name];
        store().save();
        render();
        return;
      }
      const removeCriterion = event.target.closest('[data-criterion-remove]');
      if (removeCriterion) {
        current.options.criteria.splice(Number(removeCriterion.dataset.criterionRemove), 1);
        store().save();
        render();
      }
    });

    $('#decisionPreset').addEventListener('click', loadPreset);
    $('#decisionAi').addEventListener('click', aiSuggest);
    $('#addOption').addEventListener('click', () => {
      state().options.selected.push({ id: uid('opt'), name: `方案 ${String.fromCharCode(65 + state().options.selected.length)}`, summary: '' });
      store().save();
      render();
    });
    $('#addCriterion').addEventListener('click', () => {
      state().options.criteria.push({ label: '新维度', weight: 3, hint: '' });
      store().save();
      render();
    });
    $('#exportDecision').addEventListener('click', () => {
      if (!state().options.selected.length) { window.WB.toast('还没有比选方案'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-方案比选决策矩阵.md`, window.WB.exporters.decisionToMarkdown());
    });
  }

  window.WB.views.decision = { id: 'decision', label: '方案比选', render, mount, loadPreset, aiSuggest };
}());
