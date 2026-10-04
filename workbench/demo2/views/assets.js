/* 素材库：多模态素材（图片 / 文本 / 链接 / 文件）的登记、标注与引用。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, PHASE_LABEL, fmtDateTime } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  const IMAGE_LIMIT = 400_000;
  const KIND_LABEL = { image: '图片', text: '文本', link: '链接', file: '文件' };

  function renderToolbar() {
    $('#assetsToolbar').innerHTML = `
      <button class="button button-primary" data-asset-upload>⇪ 上传素材</button>
      <button class="button button-ghost" data-asset-text>＋ 登记文本</button>
      <button class="button button-ghost" data-asset-link>＋ 登记链接</button>
      <span class="asset-filter">
        <select data-asset-filter="kind">
          <option value="">全部类型</option>
          ${Object.entries(KIND_LABEL).map(([value, label]) => `<option value="${value}" ${state().ui.assetKind === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <select data-asset-filter="phase">
          <option value="">全部阶段</option>
          ${PHASES.map((p) => `<option value="${p.value}" ${state().ui.assetPhase === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </span>`;
  }

  function assetPreview(asset) {
    /* dataUrl = 本地上传；url = AI 生图等由服务端落盘的地址 */
    if (asset.kind === 'image' && (asset.dataUrl || asset.url)) {
      return `<img class="asset-thumb" src="${escapeHtml(asset.dataUrl || asset.url)}" alt="${escapeHtml(asset.name)}" loading="lazy" />`;
    }
    if (asset.kind === 'text') return `<div class="asset-text-preview">${escapeHtml(U.text(asset.content).slice(0, 90)) || '（空）'}</div>`;
    if (asset.kind === 'link') return `<div class="asset-text-preview"><a href="${escapeHtml(asset.url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(U.text(asset.url).slice(0, 60))}</a></div>`;
    return `<div class="asset-text-preview">${escapeHtml(asset.mime || '二进制文件')} · ${Math.max(1, Math.round((asset.size || 0) / 1024))} KB</div>`;
  }

  function assetCard(asset, index) {
    return `<article class="asset-card" data-asset="${index}">
      <div class="asset-media">${assetPreview(asset)}</div>
      <div class="asset-info">
        <input class="asset-name" data-asset-field="name" value="${escapeHtml(asset.name)}" placeholder="素材名称" />
        <div class="asset-meta-row">
          <select data-asset-field="phase">
            <option value="">未指定阶段</option>
            ${PHASES.map((p) => `<option value="${p.value}" ${asset.phase === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
          <span class="kind-chip">${escapeHtml(KIND_LABEL[asset.kind] || asset.kind)}</span>
        </div>
        <input data-asset-field="tags" value="${escapeHtml((asset.tags || []).join(' '))}" placeholder="标签，空格分隔" />
        <input data-asset-field="note" value="${escapeHtml(asset.note || '')}" placeholder="用途说明" />
        <div class="asset-foot">
          <small>${escapeHtml(fmtDateTime(asset.createdAt))}</small>
          <button class="row-remove" data-asset-remove="${index}" title="删除">×</button>
        </div>
      </div>
    </article>`;
  }

  function render() {
    const current = state();
    renderToolbar();
    const kind = current.ui.assetKind || '';
    const phase = current.ui.assetPhase || '';
    const list = current.assets
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => (!kind || asset.kind === kind) && (!phase || asset.phase === phase));
    $('#assetSummary').textContent = current.assets.length
      ? `共 ${current.assets.length} 项素材，当前显示 ${list.length} 项；生成材料时会把素材清单作为上下文一起交给模型`
      : '';
    $('#assetList').innerHTML = list.length
      ? `<div class="asset-grid">${list.map(({ asset, index }) => assetCard(asset, index)).join('')}</div>`
      : `<div class="card"><div class="empty"><strong>还没有素材</strong>上传图片、粘贴文案或登记参考链接，生成宣传材料时会自动引用。</div></div>`;
    $('#exportAssets').disabled = !current.assets.length;
  }

  /* ── 入库 ─────────────────────────────── */

  function addAsset(asset) {
    state().assets.push({
      id: U.uid('asset'),
      tags: [],
      phase: '',
      note: '',
      createdAt: new Date().toISOString(),
      ...asset
    });
    store().save();
    render();
  }

  function readFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      if (file.type.startsWith('image/')) reader.readAsDataURL(file);
      else if (file.type.startsWith('text/') || /\.(md|txt|csv|json)$/i.test(file.name)) reader.readAsText(file, 'utf-8');
      else reader.readAsArrayBuffer(file);
    });
  }

  async function handleFiles(files) {
    let added = 0;
    let skipped = 0;
    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      if (isImage && file.size > IMAGE_LIMIT) { skipped += 1; continue; }
      const result = await readFile(file);
      const base = {
        name: file.name.replace(/\.[^.]+$/, ''),
        mime: file.type || 'application/octet-stream',
        size: file.size
      };
      if (isImage && typeof result === 'string') addAsset({ ...base, kind: 'image', dataUrl: result });
      else if (typeof result === 'string') addAsset({ ...base, kind: 'text', content: result });
      else addAsset({ ...base, kind: 'file' });
      added += 1;
    }
    render();
    window.WB.toast(`已登记 ${added} 项素材${skipped ? `，${skipped} 张图片超过 ${Math.round(IMAGE_LIMIT / 1000)} KB 未收录` : ''}`);
  }

  function mount() {
    const panel = $('#assetsPanel');
    const input = $('#assetFile');

    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-asset-upload]')) { input.click(); return; }
      if (event.target.closest('[data-asset-text]')) {
        const content = prompt('粘贴要登记的文本素材（如宣传口号、往届文案）：');
        if (content == null) return;
        addAsset({ name: `文本素材 ${state().assets.length + 1}`, kind: 'text', content });
        return;
      }
      if (event.target.closest('[data-asset-link]')) {
        const url = prompt('输入参考链接（如往届活动推文、模板下载地址）：');
        if (!url) return;
        addAsset({ name: url.replace(/^https?:\/\//, '').slice(0, 30), kind: 'link', url });
        return;
      }
      const remove = event.target.closest('[data-asset-remove]');
      if (remove) {
        state().assets.splice(Number(remove.dataset.assetRemove), 1);
        store().save();
        render();
      }
    });

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-asset-field]');
      if (!el) return;
      const card = el.closest('[data-asset]');
      const asset = state().assets[Number(card?.dataset.asset)];
      if (!asset) return;
      const key = el.dataset.assetField;
      asset[key] = key === 'tags' ? el.value.split(/\s+/).filter(Boolean) : el.value;
      store().save();
    });

    panel.addEventListener('change', (event) => {
      const el = event.target.closest('[data-asset-field="phase"]');
      if (!el) return;
      const asset = state().assets[Number(el.closest('[data-asset]')?.dataset.asset)];
      if (asset) { asset.phase = el.value; store().save(); }
    });

    panel.addEventListener('change', (event) => {
      const filter = event.target.closest('[data-asset-filter]');
      if (!filter) return;
      if (filter.dataset.assetFilter === 'kind') state().ui.assetKind = filter.value;
      else state().ui.assetPhase = filter.value;
      store().save();
      render();
    });

    input.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      await handleFiles(files);
    });

    $('#exportAssets').addEventListener('click', () => {
      if (!state().assets.length) { window.WB.toast('还没有素材'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-素材库清单.md`, window.WB.exporters.assetsToMarkdown());
    });
  }

  window.WB.views.assets = { id: 'assets', label: '素材库', render, mount, addAsset, handleFiles };
}());
