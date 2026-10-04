/* 过程材料：21 类产出的生成、编辑、模板套用与导出，含海报设计器。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, OUTPUT_ITEMS, PHASES, PHASE_LABEL } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  const materialDef = (skillId) => window.SKILLS.materials?.[skillId] || null;

  function chosenSections(outputKey) {
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const templateId = state().materialTemplates[outputKey];
    const template = state().templates.find((entry) => entry.id === templateId);
    if (template) return template.sections.map((section) => section.heading);
    return materialDef(item?.skill)?.sections || [];
  }

  function renderTemplateBar() {
    const templates = state().templates;
    const bar = $('#templateBar');
    if (!templates.length) {
      bar.innerHTML = '<div class="template-chip"><small>尚未上传模板，材料将使用内置默认章节。上传学校模板后，生成时会按模板章节逐字对齐。</small></div>';
      return;
    }
    bar.innerHTML = templates.map((template) => `<div class="template-chip">
      <b>${escapeHtml(template.name)}</b>
      <small>${escapeHtml(template.kind)} · ${template.sections.length} 个章节${template.tables?.length ? ` · ${template.tables.length} 张表格` : ''}</small>
      <button data-template-remove="${template.id}" title="删除模板">×</button>
    </div>`).join('');
  }

  /* ── 材料卡片 ─────────────────────────── */

  function materialCard(item) {
    const doc = state().materials[item.key];
    const open = state().ui.openMaterial === item.key;
    const def = materialDef(item.skill);
    const sections = chosenSections(item.key);
    /* structure 类产出（方案比选决策矩阵）不生成正文文档，由「方案比选」视图维护，
       这里给出跳转入口，而不是显示成「未定义章节」。 */
    const isStructure = item.kind === 'structure';
    const ready = Boolean(def) || isStructure;
    const templateId = state().materialTemplates[item.key] || '';
    const templateOptions = state().templates.length
      ? `<select class="material-template" data-material-template="${item.key}">
          <option value="">默认章节（${def?.sections.length || 0} 章）</option>
          ${state().templates.map((t) => `<option value="${t.id}" ${t.id === templateId ? 'selected' : ''}>${escapeHtml(t.name)}（${t.sections.length} 节）</option>`).join('')}
        </select>`
      : '';
    const options = state().options;
    const stateText = isStructure
      ? `由「方案比选」维护 · ${options.selected.length} 个方案 × ${options.criteria.length} 个维度`
      : doc
        ? `已生成 · ${doc.sections.length} 章 · ${doc.sections.reduce((sum, section) => sum + U.text(section.body).length, 0)} 字`
        : ready ? `未生成 · 将输出 ${sections.length} 章` : '未定义章节';
    const isPoster = item.kind === 'graphic';
    const aiOffline = U.offline();
    return `<article class="material-card ${open ? 'is-open' : ''}" data-material="${item.key}">
      <header class="material-head">
        <span class="phase-pill phase-${item.phase}">${escapeHtml(PHASE_LABEL[item.phase])}</span>
        <h3>${escapeHtml(item.label)}</h3>
        <span class="kind-chip">${escapeHtml({ document: '文档', table: '表格', graphic: '图形' }[item.kind] || '')}</span>
        <span class="material-state">${escapeHtml(stateText)}</span>
        <div class="material-actions">
          ${ready && !isStructure ? templateOptions : ''}
          ${isPoster ? `<button class="button button-ghost" data-poster-open>海报设计器</button>` : ''}
          ${isStructure
            ? `<button class="button button-primary" data-material-goto="decision">前往方案比选</button>
               <button class="button button-ghost" data-material-struct-export>导出 Markdown</button>`
            : `<button class="button button-primary" data-material-generate="${item.key}" ${ready && !aiOffline ? '' : 'disabled'} title="${aiOffline ? escapeHtml(U.AI_OFFLINE_HINT) : ''}">${doc ? '重新生成' : 'AI 生成'}</button>
               ${doc ? `<button class="button button-ghost" data-material-toggle="${item.key}">${open ? '收起' : '编辑'}</button>` : ''}
               ${doc ? `<button class="button button-ghost" data-material-export="${item.key}">导出</button>` : ''}`}
        </div>
      </header>
      ${open && doc ? materialEditor(item.key, doc) : ''}
      ${isPoster && open ? posterEditor() : ''}
    </article>`;
  }

  function materialEditor(outputKey, doc) {
    const sections = doc.sections.map((section, index) => `<section class="material-section">
      <h4>${escapeHtml(section.heading)}</h4>
      <textarea data-material-body="${outputKey}" data-section="${index}" rows="6">${escapeHtml(section.body)}</textarea>
    </section>`).join('');
    return `<div class="material-body">
      <label class="material-title"><span>文档标题</span>
        <input data-material-title="${outputKey}" value="${escapeHtml(doc.title || '')}" /></label>
      <div class="material-meta">模板：${escapeHtml(doc.templateName || '默认章节')} · 生成于 ${escapeHtml(U.fmtDateTime(doc.generatedAt))}${doc.source === 'user' ? ' · 已人工编辑' : ''}</div>
      ${sections}
    </div>`;
  }

  /* ── 海报设计器（离线可用，不依赖 AI） ── */

  const POSTER_THEMES = {
    tech: { label: '科技青', from: '#0f7a6c', to: '#0b3d5c', accent: '#7ee8d3' },
    warm: { label: '活力橙', from: '#d2691e', to: '#8c2f39', accent: '#ffd8a8' },
    violet: { label: '学院紫', from: '#4c3f91', to: '#221a4a', accent: '#c3b6ff' },
    mono: { label: '极简灰', from: '#2f3437', to: '#1a1d1f', accent: '#e6e8ea' }
  };

  const posterDesign = () => {
    const base = state().poster || {};
    const basic = state().project?.basic || {};
    return {
      title: base.title ?? basic.name ?? '校园活动',
      subtitle: base.subtitle ?? (basic.content ? String(basic.content).slice(0, 22) : ''),
      time: base.time ?? [basic.date, basic.start].filter(Boolean).join(' '),
      place: base.place ?? basic.venue ?? '',
      org: base.org ?? basic.organizer ?? '',
      slogan: base.slogan ?? '',
      theme: base.theme || 'tech',
      layout: base.layout || 'center'
    };
  };

  function posterSvg(design) {
    const theme = POSTER_THEMES[design.theme] || POSTER_THEMES.tech;
    const w = 1080;
    const h = 1440;
    const center = design.layout === 'center';
    const align = center ? 'middle' : 'start';
    const x = center ? w / 2 : 96;
    const titleSize = U.text(design.title).length > 12 ? 76 : 96;
    const meta = [design.time && `时间　${design.time}`, design.place && `地点　${design.place}`, design.org && `主办　${design.org}`]
      .filter(Boolean);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.from}"/><stop offset="100%" stop-color="${theme.to}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <g fill="none" stroke="${theme.accent}" stroke-opacity="0.28" stroke-width="2">
    <circle cx="${w - 120}" cy="180" r="190"/><circle cx="${w - 120}" cy="180" r="130"/>
    <circle cx="120" cy="${h - 200}" r="160"/><circle cx="120" cy="${h - 200}" r="100"/>
  </g>
  <text x="${x}" y="330" text-anchor="${align}" fill="${theme.accent}" font-family="Segoe UI, Microsoft YaHei" font-size="34" letter-spacing="8">CAMPUS  EVENT</text>
  <text x="${x}" y="450" text-anchor="${align}" fill="#ffffff" font-family="Microsoft YaHei, Segoe UI" font-size="${titleSize}" font-weight="700">${escapeHtml(U.text(design.title).slice(0, 20))}</text>
  ${design.subtitle ? `<text x="${x}" y="530" text-anchor="${align}" fill="#ffffff" fill-opacity="0.86" font-family="Microsoft YaHei" font-size="40">${escapeHtml(U.text(design.subtitle).slice(0, 24))}</text>` : ''}
  <rect x="${center ? w / 2 - 60 : 96}" y="600" width="120" height="6" fill="${theme.accent}" rx="3"/>
  ${meta.map((line, index) => `<text x="${x}" y="${700 + index * 74}" text-anchor="${align}" fill="#ffffff" fill-opacity="0.95" font-family="Microsoft YaHei" font-size="44">${escapeHtml(U.text(line).slice(0, 30))}</text>`).join('')}
  ${design.slogan ? `<text x="${x}" y="${h - 260}" text-anchor="${align}" fill="${theme.accent}" font-family="Microsoft YaHei" font-size="46" font-weight="600">${escapeHtml(U.text(design.slogan).slice(0, 24))}</text>` : ''}
  <text x="${x}" y="${h - 150}" text-anchor="${align}" fill="#ffffff" fill-opacity="0.6" font-family="Microsoft YaHei" font-size="28">本海报由工作台自动排版 · 请核对时间地点后再发布</text>
</svg>`;
  }

  function posterEditor() {
    const design = posterDesign();
    const options = Object.entries(POSTER_THEMES)
      .map(([key, theme]) => `<option value="${key}" ${design.theme === key ? 'selected' : ''}>${escapeHtml(theme.label)}</option>`).join('');
    return `<div class="material-body poster-body">
      <div class="poster-form">
        <div class="card-title"><h3>海报设计器</h3><small>离线可用的自动排版；改完即时预览，可导出 SVG / PNG</small></div>
        <label><span>主标题</span><input data-poster="title" value="${escapeHtml(design.title)}" /></label>
        <label><span>副标题</span><input data-poster="subtitle" value="${escapeHtml(design.subtitle)}" /></label>
        <label><span>时间</span><input data-poster="time" value="${escapeHtml(design.time)}" /></label>
        <label><span>地点</span><input data-poster="place" value="${escapeHtml(design.place)}" /></label>
        <label><span>主办</span><input data-poster="org" value="${escapeHtml(design.org)}" /></label>
        <label><span>标语</span><input data-poster="slogan" value="${escapeHtml(design.slogan)}" placeholder="如：让创意被看见" /></label>
        <label><span>配色</span><select data-poster="theme">${options}</select></label>
        <label><span>版式</span><select data-poster="layout">
          <option value="center" ${design.layout === 'center' ? 'selected' : ''}>居中</option>
          <option value="left" ${design.layout === 'left' ? 'selected' : ''}>左对齐</option>
        </select></label>
        <div class="poster-actions">
          <button class="button button-ghost" data-poster-download="svg">下载 SVG</button>
          <button class="button button-ghost" data-poster-download="png">下载 PNG</button>
          <button class="button button-ghost" data-poster-reset>恢复项目信息</button>
        </div>
      </div>
      <div class="poster-preview">
        <p class="preview-hint">预览（导出尺寸 1080 × 1440）</p>
        ${posterSvg(design)}
      </div>
      ${posterImageBlock()}
    </div>`;
  }

  /* ── AI 生图（YosHub）：服务端落盘到 demo2/generated/，并登记进素材库 ── */

  function imageCard(image, index) {
    return `<figure class="poster-ai-item">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.prompt || 'AI 生成图片')}" loading="lazy" />
      <figcaption>
        <small>${escapeHtml(image.model || 'AI')} · ${escapeHtml(U.fmtDateTime(image.createdAt))}</small>
        <span class="poster-ai-actions">
          <a class="button button-ghost" href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer">打开</a>
          <button class="button button-ghost" data-ai-image-remove="${index}">删除</button>
        </span>
      </figcaption>
    </figure>`;
  }

  function posterImageBlock() {
    const images = state().poster?.images || [];
    const ready = Boolean(window.WB.ai.imageReady);
    const canWrite = U.canOperate();
    const hint = !ready
      ? '未配置 YOSHUB_API_KEY，生图不可用；海报设计器、SVG 导出等离线功能不受影响。'
      : '模型不擅长生成中文文字，建议让画面留白，文字交给海报设计器叠加。生成的图片会自动登记到素材库。';
    return `<div class="poster-ai">
      <div class="card-title"><h3>AI 生图</h3><small>由 YosHub 生成并落盘到本地服务，仅作视觉参考</small></div>
      <div class="poster-ai-input">
        <textarea data-ai-image-prompt rows="2" placeholder="描述画面：如「科技感光束与悬浮立方体，青蓝渐变，中上部留出标题空白」" ${canWrite ? '' : 'disabled'}></textarea>
        <button class="button button-primary" data-ai-image ${ready && canWrite ? '' : 'disabled'} title="${ready ? '' : escapeHtml(hint)}"><span>✦</span> 生成图片</button>
      </div>
      <p class="help-muted">${escapeHtml(hint)}</p>
      <div class="poster-ai-gallery">
        ${images.length ? images.map(imageCard).join('') : '<p class="help-muted">还没有生成过图片。</p>'}
      </div>
    </div>`;
  }

  async function runImageGen(button) {
    const current = state();
    if (!U.canOperate()) { window.WB.toast('只读访客不能生成图片'); return; }
    if (!window.WB.ai.imageReady) { window.WB.toast('未配置 YOSHUB_API_KEY，生图不可用'); return; }
    const promptEl = button.closest('.poster-ai')?.querySelector('[data-ai-image-prompt]');
    const prompt = U.text(promptEl?.value);
    if (!prompt) { window.WB.toast('先写一句画面描述'); promptEl?.focus(); return; }
    const label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '生成中…';
    try {
      const basic = current.project?.basic || {};
      const full = `为校园活动「${basic.name || '校园活动'}」创作宣传视觉。${prompt}。不要生成未提供的时间、地点、主办方、品牌、二维码、数字或可读文字。`;
      const result = await window.WB.ai.generateImage(full);
      current.poster ||= {};
      current.poster.images ||= [];
      current.poster.images.unshift({
        url: result.url,
        model: result.model || '',
        prompt,
        width: result.width || null,
        height: result.height || null,
        createdAt: new Date().toISOString()
      });
      store().log('image', `生成宣传图：${prompt.slice(0, 30)}`);
      window.WB.views.assets.addAsset({
        name: `AI 宣传图 ${current.poster.images.length}`,
        kind: 'image',
        url: result.url,
        mime: 'image/png',
        phase: 'prepare',
        note: prompt.slice(0, 40)
      });
      store().save();
      render();
      window.WB.toast('图片已生成并登记到素材库');
    } catch (error) {
      window.WB.toast(error.message);
      if (button.isConnected) { button.disabled = false; button.innerHTML = label; }
    }
  }

  function downloadPoster(format) {
    const svg = posterSvg(posterDesign());
    const name = U.safeFileName(store().projectName());
    if (format === 'svg') {
      U.downloadBlob(`${name}-海报.svg`, new Blob([svg], { type: 'image/svg+xml' }));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1440;
      canvas.getContext('2d').drawImage(image, 0, 0, 1080, 1440);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob && U.downloadBlob(`${name}-海报.png`, blob), 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(url); window.WB.toast('PNG 导出失败，可改用 SVG'); };
    image.src = url;
  }

  /* ── 批量渲染 ─────────────────────────── */

  function renderPhaseSeg() {
    const current = state().ui.materialPhase || 'all';
    const counts = (phase) => OUTPUT_ITEMS.filter((item) => currentProjectSelected(item, phase)).length;
    const seg = $('#materialPhaseSeg');
    seg.innerHTML = [{ value: 'all', label: '全部' }, ...PHASES.map((p) => ({ value: p.value, label: p.label }))]
      .map((entry) => `<button data-material-phase="${entry.value}" class="${current === entry.value ? 'is-active' : ''}">${escapeHtml(entry.label)}${entry.value === 'all' ? '' : ` ${counts(entry.value)}`}</button>`)
      .join('');
  }

  const currentProjectSelected = (item, phase) => Boolean(state().project?.outputs?.[item.key]) && (!phase || item.phase === phase);

  function render() {
    const current = state();
    renderTemplateBar();
    renderPhaseSeg();
    const selected = OUTPUT_ITEMS.filter((item) => current.project?.outputs?.[item.key]);
    const generated = selected.filter((item) => current.materials[item.key]).length;
    $('#materialSummary').textContent = current.project
      ? `已勾选 ${selected.length} 项产出，已生成 ${generated} 份；离线状态下所有编辑与导出功能可用`
      : '';
    U.gateAi($('#generateAllMaterials'), Boolean(current.project));
    const phase = current.ui.materialPhase || 'all';
    const visible = selected.filter((item) => phase === 'all' || item.phase === phase);
    if (!visible.length) {
      $('#materialList').innerHTML = selected.length
        ? '<div class="card"><div class="empty"><strong>该阶段没有已勾选的产出</strong>可切换上方阶段，或回到项目信息表勾选更多产出。</div></div>'
        : '<div class="card"><div class="empty"><strong>还没有勾选产出</strong>回到「项目信息表」，在产出配置里勾选需要的材料。</div></div>';
      return;
    }
    $('#materialList').innerHTML = PHASES
      .map((p) => {
        const items = visible.filter((item) => item.phase === p.value);
        if (!items.length) return '';
        return `<div class="material-group">
          <div class="material-group-head"><span class="phase-pill phase-${p.value}">${escapeHtml(p.label)}</span>
            <small>${escapeHtml(p.window)}</small></div>
          ${items.map((item) => materialCard(item)).join('')}
        </div>`;
      }).join('');
  }

  /* ── 生成 ─────────────────────────────── */

  function materialInput(item, template) {
    const current = state();
    return {
      产出: item.label,
      模板: template
        ? { 来源: `学校模板《${template.name}》`, 章节: template.sections.map((s) => `${'　'.repeat(Math.max(0, s.level - 1))}${s.heading}`), 表格: template.tables?.map((t) => t.headers) || [] }
        : '未提供，使用内置默认章节',
      项目信息表: current.project?.basic || {},
      方案比选结论: current.options.decision || '未进行比选',
      任务分解: current.wbs.map((row) => ({ 阶段: PHASE_LABEL[row.phase] || row.phase, 任务: row.task, 负责角色: row.owner, 时间: row.due, 产出物: row.output, 状态: U.STATUS_LABEL[row.status] })),
      风险台账: current.risks.map((risk) => ({
        风险: risk.name, 等级: U.LEVEL_LABEL[window.WB.risk.levelOfRisk(risk)], 分值: window.WB.risk.scoreOf(risk),
        挂靠任务: risk.task, 触发信号: risk.trigger, 预防措施: risk.prevention, 现场响应: risk.response, 升级路径: risk.escalation, 责任人: risk.owner
      })),
      素材库: current.assets.map((asset) => ({ 名称: asset.name, 类型: asset.kind, 标签: (asset.tags || []).join('/'), 说明: asset.note }))
    };
  }

  async function generateOne(outputKey, { silent = false } = {}) {
    const current = state();
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    if (!item || !current.project) return false;
    const templateId = current.materialTemplates[outputKey];
    const template = current.templates.find((entry) => entry.id === templateId);
    const headings = chosenSections(outputKey);
    if (!headings.length) { window.WB.toast('该产出还没有可用的章节模板'); return false; }
    const data = await window.WB.ai.run(item.skill, materialInput(item, template), window.WB.ai.documentContract(headings), '/api/material');
    if (!data || !Array.isArray(data.sections)) return false;
    const sections = headings.map((heading, index) => {
      const matched = data.sections.find((section) => U.text(section.heading) === heading) || data.sections[index];
      return { heading, body: U.text(matched?.body) || '待补充' };
    });
    current.materials[outputKey] = {
      title: U.text(data.title) || `${current.project.basic.name || '未命名活动'}｜${item.label}`,
      sections,
      templateId: template?.id || '',
      templateName: template?.name || '默认章节',
      source: 'ai',
      generatedAt: new Date().toISOString()
    };
    current.ui.openMaterial = outputKey;
    store().log('material', `生成《${item.label}》`);
    store().save();
    if (!silent) {
      render();
      window.WB.toast(`已生成《${item.label}》${sections.length} 章`);
    }
    return true;
  }

  async function generateAll() {
    const current = state();
    if (!current.project) return;
    if (!window.WB.ai.ready) { window.WB.toast('未连接 AI，离线模式只能手动编辑已有材料'); return; }
    const targets = OUTPUT_ITEMS.filter((item) => current.project.outputs[item.key] && !current.materials[item.key] && materialDef(item.skill));
    if (!targets.length) { window.WB.toast('没有待生成的产出'); return; }
    let done = 0;
    for (const item of targets) {
      window.WB.toast(`正在生成《${item.label}》（${done + 1}/${targets.length}）…`);
      const ok = await generateOne(item.key, { silent: true });
      if (ok) done += 1;
    }
    render();
    window.WB.toast(`批量生成完成：成功 ${done}/${targets.length} 份`);
  }

  async function uploadTemplate(file) {
    if (!file) return;
    window.WB.toast(`正在解析《${file.name}》…`);
    try {
      const res = await fetch(`/api/template?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { window.WB.toast(data.error || `模板解析失败（HTTP ${res.status}）`); return; }
      if (!data.sections?.length) { window.WB.toast('没有识别到章节标题，请确认模板用了标题样式或「一、」这类编号'); return; }
      state().templates.push({
        id: U.uid('tpl'),
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: data.kind,
        sections: data.sections,
        tables: data.tables || [],
        createdAt: new Date().toISOString()
      });
      store().log('template', `上传模板《${file.name}》，识别 ${data.sections.length} 个章节`);
      store().save();
      render();
      window.WB.toast(`已解析《${file.name}》，识别 ${data.sections.length} 个章节`);
    } catch (error) {
      window.WB.toast(error.message || '模板上传失败');
    }
  }

  function mount() {
    const panel = $('#materialPanel');

    panel.addEventListener('click', (event) => {
      const current = state();
      const generate = event.target.closest('[data-material-generate]');
      if (generate) { generateOne(generate.dataset.materialGenerate); return; }
      const goto = event.target.closest('[data-material-goto]');
      if (goto) { window.WB.switchView(goto.dataset.materialGoto); return; }
      if (event.target.closest('[data-material-struct-export]')) {
        U.downloadText(`${U.safeFileName(store().projectName())}-方案比选决策矩阵.md`, window.WB.exporters.decisionToMarkdown());
        return;
      }
      const toggle = event.target.closest('[data-material-toggle]');
      if (toggle) {
        const key = toggle.dataset.materialToggle;
        current.ui.openMaterial = current.ui.openMaterial === key ? null : key;
        store().save();
        render();
        return;
      }
      const exportOne = event.target.closest('[data-material-export]');
      if (exportOne) {
        const key = exportOne.dataset.materialExport;
        const doc = current.materials[key];
        const item = OUTPUT_ITEMS.find((entry) => entry.key === key);
        if (doc) U.downloadText(`${U.safeFileName(store().projectName())}-${U.safeFileName(item?.label || key)}.md`, window.WB.exporters.materialToMarkdown(doc));
        return;
      }
      const posterOpen = event.target.closest('[data-poster-open]');
      if (posterOpen) {
        current.ui.openMaterial = 'poster';
        store().save();
        render();
        return;
      }
      const posterDownload = event.target.closest('[data-poster-download]');
      if (posterDownload) { downloadPoster(posterDownload.dataset.posterDownload); return; }
      const aiImage = event.target.closest('[data-ai-image]');
      if (aiImage) { runImageGen(aiImage); return; }
      const removeImage = event.target.closest('[data-ai-image-remove]');
      if (removeImage) {
        const images = current.poster?.images || [];
        images.splice(Number(removeImage.dataset.aiImageRemove), 1);
        store().save();
        render();
        return;
      }
      if (event.target.closest('[data-poster-reset]')) {
        /* 只重置排版文案，保留已生成的图片 */
        const images = current.poster?.images;
        current.poster = images ? { images } : {};
        store().save();
        render();
        window.WB.toast('已按项目信息重置海报文案');
        return;
      }
      const phaseButton = event.target.closest('[data-material-phase]');
      if (phaseButton) {
        current.ui.materialPhase = phaseButton.dataset.materialPhase;
        store().save();
        render();
      }
    });

    panel.addEventListener('input', (event) => {
      const current = state();
      const posterField = event.target.closest('[data-poster]');
      if (posterField) {
        current.poster ||= {};
        current.poster[posterField.dataset.poster] = posterField.value;
        store().save();
        const preview = panel.querySelector('.poster-preview');
        if (preview) preview.innerHTML = `<p class="preview-hint">预览（导出尺寸 1080 × 1440）</p>${posterSvg(posterDesign())}`;
        return;
      }
      const title = event.target.closest('[data-material-title]');
      if (title) {
        const doc = current.materials[title.dataset.materialTitle];
        if (!doc) return;
        doc.title = title.value;
        doc.source = 'user';
        store().save();
        return;
      }
      const body = event.target.closest('[data-material-body]');
      if (body) {
        const doc = current.materials[body.dataset.materialBody];
        const section = doc?.sections[Number(body.dataset.section)];
        if (!section) return;
        section.body = body.value;
        doc.source = 'user';
        store().save();
      }
    });

    panel.addEventListener('change', (event) => {
      const select = event.target.closest('[data-material-template]');
      if (!select) return;
      const key = select.dataset.materialTemplate;
      if (select.value) state().materialTemplates[key] = select.value;
      else delete state().materialTemplates[key];
      store().save();
      render();
    });

    $('#uploadTemplate').addEventListener('click', () => $('#templateFile').click());
    $('#templateFile').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      await uploadTemplate(file);
    });
    $('#generateAllMaterials').addEventListener('click', generateAll);
    $('#exportMaterials').addEventListener('click', () => {
      const docs = Object.keys(state().materials);
      if (!docs.length) { window.WB.toast('还没有已生成的材料'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-过程材料包.md`, window.WB.exporters.materialsPack());
    });
    $('#templateBar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-template-remove]');
      if (!button) return;
      const id = button.dataset.templateRemove;
      const current = state();
      current.templates = current.templates.filter((template) => template.id !== id);
      for (const key of Object.keys(current.materialTemplates)) {
        if (current.materialTemplates[key] === id) delete current.materialTemplates[key];
      }
      store().save();
      render();
    });
  }

  window.WB.views.material = { id: 'material', label: '过程材料', render, mount, generateOne, generateAll, uploadTemplate, posterSvg: () => posterSvg(posterDesign()) };
}());
