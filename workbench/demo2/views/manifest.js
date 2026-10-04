/* 项目信息表：事实区（可编辑）+ 产出配置（按阶段分组勾选）。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, BASIC_FIELDS, PHASES, PHASE_LABEL, OUTPUT_ITEMS, sourceBadge, paintBadge } = U;

  function inputType(type) {
    if (type === 'date') return 'date';
    if (type === 'time') return 'time';
    if (type === 'number') return 'number';
    return 'text';
  }

  /* 生成表单控件，向导与信息表共用 */
  function fieldControl(field, attrs = '') {
    const required = field.required ? ' required' : '';
    if (field.type === 'enum') {
      const options = ['<option value="">请选择</option>']
        .concat(field.options.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`))
        .join('');
      return `<select ${attrs}${required}>${options}</select>`;
    }
    if (field.type === 'textarea') {
      return `<textarea ${attrs} rows="3" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>`;
    }
    return `<input type="${inputType(field.type)}" ${attrs} placeholder="${escapeHtml(field.placeholder || '')}"${required} />`;
  }

  window.WB.fieldControl = fieldControl;

  function renderBasic(state) {
    const project = state.project;
    const basic = project?.basic || {};
    const meta = project?.meta?.basic || {};
    const rows = BASIC_FIELDS.map((field) => `<div class="kv-row">
      <div class="kv-label">${escapeHtml(field.label)}${field.required ? '<span class="req">*</span>' : ''}</div>
      <div class="kv-value">${fieldControl(field, `data-basic="${field.key}"`)}</div>
      <div class="kv-meta" id="badge-basic-${field.key}">${sourceBadge(meta[field.key] || (basic[field.key] ? 'user' : ''))}</div>
    </div>`).join('');
    $('#basicSection').innerHTML = `<div class="card-title"><h3>一、活动基本信息</h3><small>手改过的字段会标记为「用户填写」，AI 不会覆盖</small></div>${rows}`;
    for (const field of BASIC_FIELDS) {
      const el = $(`[data-basic="${field.key}"]`);
      if (el && basic[field.key] != null) el.value = basic[field.key];
    }
  }

  const KIND_LABEL = { document: '文档', table: '表格', graphic: '图形', structure: '结构化表' };

  function renderOutputs(state) {
    const project = state.project;
    const groups = PHASES.map((phase) => {
      const items = OUTPUT_ITEMS.filter((item) => item.phase === phase.value);
      const cards = items.map((item) => {
        const on = Boolean(project?.outputs?.[item.key]);
        const source = project?.meta?.outputs?.[item.key];
        const ready = window.WB.ai.isReady(item.skill);
        return `<label class="output-item ${on ? 'is-on' : ''}" data-output-item="${item.key}">
          <input type="checkbox" data-output="${item.key}" ${on ? 'checked' : ''} />
          <span class="output-text">
            <span class="output-label">${escapeHtml(item.label)}${item.core ? '<i class="core-mark" title="核心产出">核心</i>' : ''}</span>
            <span class="output-skill ${ready ? 'is-ready' : ''}">${escapeHtml(KIND_LABEL[item.kind] || '')} · ${escapeHtml(item.skill)}</span>
          </span>
          <span id="badge-output-${item.key}">${on ? sourceBadge(source || 'user') : ''}</span>
        </label>`;
      }).join('');
      const done = items.filter((item) => state.materials?.[item.key]).length;
      return `<div class="output-group">
        <div class="output-group-title">${escapeHtml(phase.label)}
          <span class="output-group-meta">已勾选 ${items.filter((i) => project?.outputs?.[i.key]).length}/${items.length} · 已生成 ${done}</span>
        </div>
        <div class="output-grid">${cards}</div>
      </div>`;
    }).join('');
    $('#outputSection').innerHTML = `
      <div class="card-title"><h3>二、产出配置</h3><small>勾选决定后续阶段生成哪些任务与材料</small></div>
      <div class="output-toolbar">
        <button class="button button-ghost" data-output-preset="all">全选</button>
        <button class="button button-ghost" data-output-preset="core">仅核心产出</button>
        <button class="button button-ghost" data-output-preset="none">清空</button>
      </div>
      ${groups}`;
  }

  function renderNotes(state) {
    const notes = state.project?.notes;
    const box = $('#manifestNotes');
    if (!Array.isArray(notes) || !notes.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card">
      <div class="card-title"><h3>AI 补充说明</h3><small>仅供参考，请自行核实</small></div>
      <ul class="note-list">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
    </div>`;
  }

  function render() {
    const state = window.WB.store.state;
    const has = Boolean(state.project);
    for (const id of ['aiFillManifest', 'generateMaterials', 'exportManifestJson', 'exportManifestMd']) {
      const el = document.getElementById(id);
      if (el) el.disabled = !has;
    }
    U.gateAi(document.getElementById('aiFillManifest'), has);
    U.gateAi(document.getElementById('generateMaterials'), has);
    if (!has) {
      $('#basicSection').innerHTML = '<div class="empty"><strong>还没有项目信息表</strong>点击右上角「重新填写」开始。</div>';
      $('#outputSection').innerHTML = '';
      $('#manifestNotes').innerHTML = '';
      return;
    }
    renderBasic(state);
    renderOutputs(state);
    renderNotes(state);
    const selected = OUTPUT_ITEMS.filter((item) => state.project.outputs[item.key]).length;
    $('#manifestTitle').textContent = state.project.basic.name || '项目信息表';
    $('#manifestSubtitle').textContent = `事实区由你确认；已勾选 ${selected} 项产出。AI 补全只填空白，不覆盖手改内容。`;
  }

  function setOutput(state, keys, value) {
    for (const item of OUTPUT_ITEMS) {
      if (!keys.includes(item.key)) continue;
      state.project.outputs[item.key] = value;
      state.project.meta.outputs[item.key] = 'user';
    }
  }

  function mount() {
    const panel = $('#manifestPanel');
    const state = () => window.WB.store.state;

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-basic]');
      if (!el || !state().project) return;
      const key = el.dataset.basic;
      const field = BASIC_FIELDS.find((f) => f.key === key);
      const raw = el.value;
      const asNumber = field?.type === 'number' && raw !== '' ? Number(raw) : null;
      state().project.basic[key] = Number.isFinite(asNumber) ? asNumber : raw;
      state().project.meta.basic[key] = 'user';
      window.WB.store.save();
      paintBadge(`badge-basic-${key}`, 'user');
      window.WB.renderTopbar();
      /* 名称 / 日期会影响总览倒计时与任务甘特，但那些面板在切过去时才重绘，
         这里不再整页重绘——否则会把正在输入的字段一起重建，输入焦点会丢。 */
    });

    panel.addEventListener('change', (event) => {
      const el = event.target.closest('[data-output]');
      if (!el || !state().project) return;
      const key = el.dataset.output;
      state().project.outputs[key] = el.checked;
      state().project.meta.outputs[key] = 'user';
      el.closest('.output-item')?.classList.toggle('is-on', el.checked);
      paintBadge(`badge-output-${key}`, el.checked ? 'user' : '');
      window.WB.store.save();
      window.WB.renderTopbar();
      window.WB.views.manifest.render();
      window.WB.renderPanelsMeta?.();
    });

    panel.addEventListener('click', (event) => {
      const preset = event.target.closest('[data-output-preset]');
      if (!preset || !state().project) return;
      const mode = preset.dataset.outputPreset;
      const keys = OUTPUT_ITEMS.filter((item) => (mode === 'core' ? item.core : true)).map((item) => item.key);
      const allKeys = OUTPUT_ITEMS.map((item) => item.key);
      /* 「仅核心产出」必须先清空再勾核心，否则只会往已有选择里追加。 */
      if (mode === 'none') setOutput(state(), allKeys, false);
      else if (mode === 'core') { setOutput(state(), allKeys, false); setOutput(state(), keys, true); }
      else setOutput(state(), keys, true);
      window.WB.store.save();
      window.WB.views.manifest.render();
      window.WB.renderPanelsMeta?.();
    });
  }

  window.WB.views.manifest = { id: 'manifest', label: '项目信息表', render, mount, fieldControl };
}());
