/* 知识与素材：分类、检索、来源核验、正文编辑、引用预览及项目内存档。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};
(function () {
  const U = window.WB.util;
  const L = window.WB.library;
  const { $, escapeHtml: E, PHASES, fmtDateTime } = U;
  const store = () => window.WB.store;
  const state = () => store().state;
  const IMAGE_LIMIT = 400_000;
  const TEXT_LIMIT = 60000;
  const KIND_LABEL = { image: '图片', text: '文本', link: '链接', file: '文件' };
  const collection = () => state().ui.assetCollection === 'knowledge' ? 'knowledge' : 'assets';
  const canWrite = () => Boolean(state().project) && U.canOperate();
  const guard = () => { if (canWrite()) return true; window.WB.toast('请先打开项目，并使用可编辑身份'); return false; };
  const option = (value, label, selected) => `<option value="${E(value)}"${value === selected ? ' selected' : ''}>${E(label)}</option>`;

  function renderToolbar() {
    const mode = collection();
    const disabled = canWrite() ? '' : 'disabled';
    $('#assetsToolbar').innerHTML = `
      <div class="library-tabs" role="group" aria-label="资料库切换">
        <button class="button ${mode === 'assets' ? 'button-primary' : 'button-ghost'}" data-library-tab="assets" aria-pressed="${mode === 'assets'}">多模态素材库</button>
        <button class="button ${mode === 'knowledge' ? 'button-primary' : 'button-ghost'}" data-library-tab="knowledge" aria-pressed="${mode === 'knowledge'}">知识库</button>
      </div>
      <button class="button button-ghost" data-asset-upload ${disabled}>⇪ ${mode === 'knowledge' ? '导入知识文档' : '上传素材'}</button>
      <button class="button button-ghost" data-asset-text ${disabled}>＋ ${mode === 'knowledge' ? '新建知识条目' : '登记文本'}</button>
      ${mode === 'assets' ? `<button class="button button-ghost" data-asset-link ${disabled}>＋ 登记链接</button>` : ''}
      <button class="button button-ghost" data-library-sample ${disabled}>载入教学资料示例</button>
      <div class="library-filters">
        <input type="search" data-library-search aria-label="检索资料" placeholder="搜索名称、标签、来源或正文" value="${E(state().ui.assetQuery || '')}" />
        <select data-asset-filter="kind" aria-label="资料类型"><option value="">全部${mode === 'knowledge' ? '分类' : '类型'}</option>${Object.entries(mode === 'knowledge' ? L.CATEGORIES : KIND_LABEL).map(([key, label]) => option(key, label, state().ui.assetKind)).join('')}</select>
        <select data-asset-filter="phase" aria-label="适用阶段"><option value="">全部阶段</option>${PHASES.map((p) => option(p.value, p.label, state().ui.assetPhase)).join('')}</select>
      </div>`;
  }

  function assetPreview(asset) {
    const image = /^data:image\//i.test(asset.dataUrl || '') ? asset.dataUrl : L.safeUrl(asset.url);
    if (asset.kind === 'image' && image) return `<img class="asset-thumb" src="${E(image)}" alt="${E(asset.name)}" loading="lazy" />`;
    if (asset.kind === 'text') return `<div class="asset-text-preview">${E(U.text(asset.content).slice(0, 150)) || '点击下方「正文与摘要」填写资料'}</div>`;
    if (asset.kind === 'link') return `<div class="asset-text-preview">${E(asset.url || '链接未填写')}<br />链接内容需人工整理到正文。</div>`;
    return `<div class="asset-text-preview">${E(asset.originalName || asset.name)}<br />${Math.round((asset.size || 0) / 1024)} KB · ${asset.dataUrl ? '原件随项目包保存' : '仅登记信息，原件需单独归档'}</div>`;
  }

  function assetCard(asset, index) {
    const knowledge = L.isKnowledge(asset);
    const disabled = canWrite() ? '' : ' disabled';
    const source = L.safeUrl(asset.sourceUrl);
    const link = L.safeUrl(asset.url);
    const eligible = !knowledge || ['verified', 'example'].includes(asset.status) && Boolean(U.text(asset.content));
    return `<article class="asset-card library-card" data-asset="${index}">
      <div class="asset-media">${assetPreview(asset)}</div>
      <div class="asset-info">
        <label>名称<input class="asset-name" data-asset-field="name" value="${E(asset.name)}" placeholder="资料名称"${disabled} /></label>
        <div class="asset-meta-row">
          <label>适用阶段<select data-asset-field="phase"${disabled}><option value="">全周期</option>${PHASES.map((p) => option(p.value, p.label, asset.phase)).join('')}</select></label>
          ${knowledge ? `<label>分类<select data-asset-field="knowledgeCategory"${disabled}>${Object.entries(L.CATEGORIES).map(([key, label]) => option(key, label, asset.knowledgeCategory || 'process')).join('')}</select></label>` : `<span class="kind-chip">${E(KIND_LABEL[asset.kind] || asset.kind)}</span>`}
        </div>
        <label>来源<input data-asset-field="source" value="${E(asset.source || '')}" placeholder="文件名称、发布单位或原创作者"${disabled} /></label>
        <label>来源地址<input data-asset-field="sourceUrl" value="${E(asset.sourceUrl || '')}" placeholder="原始资料网址（可选）"${disabled} /></label>
        <label>适用范围<input data-asset-field="scope" value="${E(asset.scope || '')}" placeholder="适用于哪些活动，哪些内容需另行确认"${disabled} /></label>
        <label>标签<input data-asset-field="tags" value="${E((Array.isArray(asset.tags) ? asset.tags : []).join(' '))}" placeholder="标签，空格分隔"${disabled} /></label>
        <label>用途说明<input data-asset-field="note" value="${E(asset.note || '')}" placeholder="用于哪份材料或哪个环节"${disabled} /></label>
        ${knowledge ? `<label>核验状态<select data-asset-field="status"${disabled}>${Object.entries(L.STATUS).map(([key, label]) => option(key, label, asset.status || 'pending')).join('')}</select></label>` : ''}
        ${asset.kind === 'link' ? `<label>素材链接<input data-asset-field="url" value="${E(asset.url || '')}" placeholder="https://…"${disabled} /></label>` : ''}
        <details class="library-content"><summary>正文与摘要 · ${String(asset.content || '').length} 字</summary><textarea data-asset-field="content" aria-label="资料正文" placeholder="粘贴可读正文；图片填写画面说明，链接或附件填写人工核对的摘要" maxlength="${TEXT_LIMIT}"${disabled}>${E(asset.content || '')}</textarea></details>
        <label class="library-use"><input type="checkbox" data-asset-field="useForAi"${L.included(asset) ? ' checked' : ''}${canWrite() && eligible ? '' : ' disabled'} />用于 AI 生成${knowledge && !eligible ? '（先填写正文并核验）' : ''}</label>
        ${knowledge && asset.status === 'example' ? '<p class="library-note">教学示例，仅用于演示；请用真实规范替换。</p>' : ''}
        <div class="library-links">${source ? `<a href="${E(source)}" target="_blank" rel="noreferrer">查看来源</a>` : ''}${link ? `<a href="${E(link)}" target="_blank" rel="noreferrer">打开素材</a>` : ''}${asset.dataUrl ? `<button class="button button-ghost" data-asset-download="${index}">下载原件</button>` : ''}</div>
        <div class="asset-foot"><small>${E(fmtDateTime(asset.updatedAt || asset.createdAt))}</small><button class="row-remove" data-asset-remove="${index}" title="删除资料"${disabled}>×</button></div>
      </div>
    </article>`;
  }

  function renderList() {
    const current = state();
    const mode = collection();
    const query = String(current.ui.assetQuery || '').trim().toLowerCase();
    const records = current.assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => L.collectionOf(asset) === mode);
    const list = records.filter(({ asset }) => (!current.ui.assetKind || (mode === 'knowledge' ? asset.knowledgeCategory : asset.kind) === current.ui.assetKind)
      && (!current.ui.assetPhase || !asset.phase || asset.phase === current.ui.assetPhase)
      && (!query || [asset.name, asset.content, asset.source, asset.note, ...(asset.tags || [])].join(' ').toLowerCase().includes(query)));
    $('#assetSummary').textContent = `${mode === 'knowledge' ? '知识' : '素材'} ${records.length} 项，显示 ${list.length} 项，已选择 AI 引用 ${records.filter(({ asset }) => L.included(asset)).length} 项`;
    $('#assetList').innerHTML = `<p class="library-note">${mode === 'knowledge'
      ? '导入 .md / .txt / .docx 或新建条目 → 补充来源与适用范围 → 人工核验 → 勾选用于 AI 生成。修改已核验的正文或来源后，需要重新核验。'
      : '图片和小附件可随项目包保存；文本正文可供 AI 引用。图片内容、链接网页及 PDF 不会自动识别，请补充摘要并保留原件。'}</p>
      ${list.length ? `<div class="asset-grid">${list.map(({ asset, index }) => assetCard(asset, index)).join('')}</div>` : `<div class="card"><div class="empty"><strong>${records.length ? '没有匹配的资料' : '还没有资料'}</strong>新建、导入，或载入教学示例，再登记来源与用途。</div></div>`}
      <details class="library-context"><summary>预览当前选中的 AI 引用内容</summary><pre>${E(JSON.stringify(L.context(current.assets, mode), null, 2))}</pre></details>`;
    $('#exportAssets').disabled = !records.length;
  }
  function render() { renderToolbar(); renderList(); }

  function addAsset(asset, { defer = false } = {}) {
    if (!guard()) return false;
    const now = new Date().toISOString();
    state().assets.push({ id: U.uid('asset'), tags: [], phase: '', note: '', source: '', sourceUrl: '', scope: '', createdAt: now, updatedAt: now, ...asset });
    if (!defer) { store().save(); render(); }
    return true;
  }

  async function handleFiles(files) {
    if (!guard()) return;
    const projectId = state().activeId;
    const mode = collection();
    let added = 0;
    const issues = [];
    for (const file of files) {
      try {
        const knowledge = mode === 'knowledge';
        const docx = /\.docx$/i.test(file.name);
        const textual = /\.(md|markdown|txt|csv|json)$/i.test(file.name) || file.type.startsWith('text/');
        const image = file.type.startsWith('image/');
        if (knowledge && !docx && !/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('知识文档支持 .md / .txt / .docx；其他文件请在素材库登记并整理正文');
        if (file.size > 4_000_000 && (docx || textual)) throw new Error('文档超过 4 MB，请拆分后导入');
        if (image && file.size > IMAGE_LIMIT) throw new Error('图片超过 400 KB，请压缩后上传');
        const base = { name: file.name.replace(/\.[^.]+$/, ''), originalName: file.name, mime: file.type, size: file.size,
          source: `本机上传《${file.name}》`, collection: mode,
          ...(knowledge ? { knowledgeCategory: 'process', status: 'pending', useForAi: false } : {}) };
        let item;
        if (docx || textual) {
          const parsed = docx ? await window.WB.docx.readFile(file) : { text: await file.text() };
          const full = String(parsed.text || '');
          item = { ...base, kind: 'text', content: full.slice(0, TEXT_LIMIT), note: parsed.truncated || full.length > TEXT_LIMIT ? '导入正文已截断，请保留原文件并核对' : '' };
          if (full.length > TEXT_LIMIT || parsed.truncated) issues.push(`${file.name}：正文已截断`);
        } else if (file.size <= IMAGE_LIMIT) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          item = { ...base, kind: image ? 'image' : 'file', dataUrl: `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}` };
        } else { item = { ...base, kind: 'file', note: '仅登记文件信息；超过 400 KB，原件需单独归档' }; issues.push(`${file.name}：仅登记，原件需另存`); }
        if (state().activeId !== projectId || !canWrite()) { window.WB.toast('项目或权限已变化，停止导入'); return; }
        if (addAsset(item, { defer: true })) { added++; store().save(); }
      } catch (error) { issues.push(`${file.name}：${error.message}`); }
    }
    if (state().activeId !== projectId || !canWrite()) return;
    store().log('library', `导入${mode === 'knowledge' ? '知识' : '素材'} ${added} 项${issues.length ? `；${issues.join('；')}` : ''}`);
    store().save(); render();
    window.WB.toast(`已导入 ${added} 项${issues.length ? `；${issues.join('；')}` : ''}`);
  }

  async function loadSample() {
    if (!guard()) return;
    const projectId = state().activeId;
    try {
      const response = await fetch('./samples/知识与素材示例.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sample = await response.json();
      if (state().activeId !== projectId || !canWrite()) return;
      let added = 0;
      for (const item of sample.items || []) {
        if (state().assets.some((asset) => asset.sampleKey === item.sampleKey)) continue;
        if (addAsset(item, { defer: true })) added++;
      }
      store().log('library', `载入教学知识与素材 ${added} 项`); store().save(); render();
      window.WB.toast(`新增 ${added} 项教学资料；知识示例需主动勾选 AI 引用`);
    } catch (error) { window.WB.toast(`载入失败：${error.message}`); }
  }

  function setField(asset, key, value) {
    if (!guard()) return false;
    if (key === 'status' && value === 'verified' && (!U.text(asset.source) || !U.text(asset.content))) { window.WB.toast('核验前请填写来源和正文'); return false; }
    if (key === 'useForAi' && value && L.isKnowledge(asset) && (!['verified', 'example'].includes(asset.status) || !U.text(asset.content))) return false;
    const invalidates = L.isKnowledge(asset) && asset.status === 'verified' && !['status', 'useForAi'].includes(key) && JSON.stringify(asset[key]) !== JSON.stringify(value);
    asset[key] = value;
    if (invalidates || key === 'status' && value === 'pending') { asset.status = 'pending'; asset.useForAi = false; }
    asset.updatedAt = new Date().toISOString();
    return true;
  }

  function mount() {
    const panel = $('#assetsPanel');
    const input = $('#assetFile');
    panel.addEventListener('click', async (event) => {
      const tab = event.target.closest('[data-library-tab]');
      if (tab) { state().ui.assetCollection = tab.dataset.libraryTab; state().ui.assetKind = ''; store().save(); render(); return; }
      if (event.target.closest('[data-asset-upload]')) { if (guard()) { input.accept = collection() === 'knowledge' ? '.md,.txt,.docx' : 'image/*,.txt,.md,.csv,.json,.docx,.pdf'; input.click(); } return; }
      if (event.target.closest('[data-library-sample]')) { await loadSample(); return; }
      if (event.target.closest('[data-asset-text]')) {
        if (!guard()) return;
        addAsset({ name: collection() === 'knowledge' ? '新知识条目' : '新文本素材', kind: 'text', content: '', collection: collection(),
          ...(collection() === 'knowledge' ? { knowledgeCategory: 'process', status: 'pending', useForAi: false } : {}) }); return;
      }
      if (event.target.closest('[data-asset-link]')) {
        if (!guard()) return;
        const url = prompt('输入参考链接（https://…）；网页内容需手工整理到正文：');
        if (!url) return;
        if (!L.safeUrl(url)) { window.WB.toast('请输入有效的 http / https 地址'); return; }
        addAsset({ name: url.replace(/^https?:\/\//, '').slice(0, 40), kind: 'link', url }); return;
      }
      const download = event.target.closest('[data-asset-download]');
      if (download) {
        const asset = state().assets[Number(download.dataset.assetDownload)];
        const match = String(asset?.dataUrl || '').match(/^data:([^,]*);base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) { window.WB.toast('此素材原件未保存在项目中'); return; }
        try { U.downloadBytes(asset.originalName || `${U.safeFileName(asset.name)}${asset.kind === 'image' ? '.png' : '.bin'}`, Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0)), match[1]); }
        catch { window.WB.toast('原件数据损坏，请重新上传'); } return;
      }
      const remove = event.target.closest('[data-asset-remove]');
      if (remove && guard()) {
        const index = Number(remove.dataset.assetRemove);
        if (!state().assets[index] || !confirm(`删除《${state().assets[index].name}》？`)) return;
        state().assets.splice(index, 1); store().save(); render();
      }
    });
    panel.addEventListener('input', (event) => {
      const search = event.target.closest('[data-library-search]');
      if (search) { state().ui.assetQuery = search.value; renderList(); return; }
      const field = event.target.closest('[data-asset-field]');
      if (!field || !canWrite() || field.tagName === 'SELECT' || field.type === 'checkbox') return;
      const asset = state().assets[Number(field.closest('[data-asset]')?.dataset.asset)];
      if (!asset) return;
      const key = field.dataset.assetField;
      const value = key === 'tags' ? field.value.split(/\s+/).filter(Boolean) : field.value;
      if (setField(asset, key, value)) {
        store().save();
        const card = field.closest('[data-asset]');
        const status = card.querySelector('[data-asset-field="status"]');
        const use = card.querySelector('[data-asset-field="useForAi"]');
        if (status) status.value = asset.status || 'pending';
        if (use && L.isKnowledge(asset)) { use.checked = L.included(asset); use.disabled = !['verified', 'example'].includes(asset.status) || !U.text(asset.content); }
      }
    });
    panel.addEventListener('change', (event) => {
      const filter = event.target.closest('[data-asset-filter]');
      if (filter) { state().ui[filter.dataset.assetFilter === 'kind' ? 'assetKind' : 'assetPhase'] = filter.value; store().save(); renderList(); return; }
      const field = event.target.closest('[data-asset-field]');
      if (!field || !canWrite()) return;
      const asset = state().assets[Number(field.closest('[data-asset]')?.dataset.asset)];
      if (!asset) return;
      const key = field.dataset.assetField;
      if (field.tagName === 'SELECT' || field.type === 'checkbox') { setField(asset, key, field.type === 'checkbox' ? field.checked : field.value); store().save(); renderList(); }
    });
    input.addEventListener('change', async (event) => { const files = Array.from(event.target.files || []); event.target.value = ''; await handleFiles(files); });
    $('#exportAssets').addEventListener('click', () => {
      U.downloadText(`${U.safeFileName(store().projectName())}-${collection() === 'knowledge' ? '知识库' : '素材库'}.md`, L.toMarkdown(state().assets, collection()));
    });
  }
  window.WB.views.assets = { id: 'assets', label: '知识与素材', render, mount, addAsset, handleFiles, loadSample, setField };
}());
