/* 人员与资源视图：资源台账 + 占用冲突检查，供排班、场地与经费安排共用。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, RESOURCE_KINDS, RESOURCE_UNIT, canOperate } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;
  const inventoryKinds = RESOURCE_KINDS.filter((kind) => kind.value !== 'staff');
  const inventory = () => state().resources.filter((item) => item.kind !== 'staff');

  /* 冲突判定：超额为缺口，刚好排满为提醒，其余正常 */
  function check(item) {
    const gap = Number(item.assigned) - Math.max(0, Number(item.available) - Number(item.loaned || 0));
    if (gap > 0) return { level: 'over', label: `超出 ${gap} ${item.unit || ''}`.trim() };
    if (gap === 0 && Number(item.assigned) > 0) return { level: 'full', label: '已排满' };
    return { level: 'ok', label: '正常' };
  }

  const CREATABLE = () => canOperate();

  function stat(label, value, unit, tone = '') {
    return `<div class="stat ${tone ? `stat-${tone}` : ''}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong>
    </div>`;
  }

  function renderToolbar() {
    const canWrite = CREATABLE();
    const aiEnabled = canWrite && Boolean(state().project) && Boolean(window.WB.ai?.ready) && !window.WB.ai.busy;
    const aiTitle = !canWrite ? '只读访客不能修改资源台账' : window.WB.ai?.ready ? '' : U.AI_OFFLINE_HINT;
    $('#resourcesToolbar').innerHTML = `
      <span class="asset-filter">
        <select data-res-filter="kind">
          <option value="">全部类型</option>
          ${inventoryKinds.map((kind) => `<option value="${kind.value}" ${state().ui.resourceKind === kind.value ? 'selected' : ''}>${kind.label}</option>`).join('')}
        </select>
        <select data-res-filter="phase">
          <option value="">全部阶段</option>
          ${PHASES.map((p) => `<option value="${p.value}" ${state().ui.resourcePhase === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </span>
      <div class="panel-actions">
        <button class="button button-ghost" data-goto-view="material" data-goto-phase="all" data-goto-open="budgetSheet">预算 / 决算表发票入口</button>
        <button class="button button-ghost" data-res-add ${canWrite ? '' : 'disabled'}>＋ 添加物资 / 资源</button>
        <button class="button button-ghost" data-res-ai ${aiEnabled ? '' : 'disabled'} title="${escapeHtml(aiTitle)}"><span>✦</span> AI 提炼资源台账</button>
        <button class="button button-ghost" data-res-sample ${canWrite ? '' : 'disabled'}>载入示例台账</button>
        <button class="button button-ghost" data-res-export ${inventory().length ? '' : 'disabled'}>导出资源台账</button>
        <button class="button button-ghost" data-res-material-export>导出物料与设备清单（Excel）</button>
        ${state().resourceMaterialBackup ? `<button class="button button-ghost" data-res-legacy-import ${canWrite ? '' : 'disabled'}>旧物料清单导入台账</button><button class="button button-ghost" data-res-legacy-export>导出旧清单备份</button>` : ''}
      </div><label class="asset-filter">采购发票 / 凭证<select data-res-invoice-target aria-label="选择发票关联的资源"${canWrite ? '' : ' disabled'}><option value="">请选择对应资源</option>${inventory().map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name || '未命名资源')}</option>`).join('')}</select><button type="button" class="button button-primary" data-res-invoice-submit${canWrite && inventory().length ? '' : ' disabled'}>提交发票</button></label>`;
  }

  function renderStats(list) {
    const over = list.filter((item) => check(item).level === 'over');
    const full = list.filter((item) => check(item).level === 'full');
    const kinds = new Set(list.map((item) => item.kind)).size;

    $('#resourcesStats').innerHTML = `<div class="wbs-summary">
      ${stat('资源条目', list.length, '项')}
      ${stat('覆盖类型', kinds, `/ ${inventoryKinds.length}`)}
      ${stat('占用冲突', over.length, '项', over.length ? 'danger' : '')}
      ${stat('已排满', full.length, '项')}
      ${stat('物料与设备', list.filter((r) => ['material', 'equipment'].includes(r.kind)).length, '项')}
    </div>`;
  }

  function renderConflicts(list) {
    const over = list.map((item, index) => ({ item, index })).filter(({ item }) => check(item).level === 'over');
    if (!over.length) {
      $('#resourceConflicts').innerHTML = list.length
        ? '<div class="check-line is-ok">占用检查通过：没有资源被超额安排。</div>'
        : '';
      return;
    }
    $('#resourceConflicts').innerHTML = `<div class="card conflict-card">
      <div class="card-title"><h3>资源冲突 ${over.length} 项</h3><small>「已安排」超过「可用数量」，需要调整排期、追加资源或压缩需求</small></div>
      <ul class="gap-list">${over.map(({ item }) => `<li><b>${escapeHtml(item.name || '未命名资源')}</b>：净可用 ${Math.max(0, Number(item.available) - Number(item.loaned || 0))} ${escapeHtml(item.unit || '')} / 计划需求 ${Number(item.assigned)} ${escapeHtml(item.unit || '')}，缺口 ${Number(item.assigned) - Math.max(0, Number(item.available) - Number(item.loaned || 0))} ${escapeHtml(item.unit || '')}</li>`).join('')}</ul>
    </div>`;
  }

  function row(item, index) {
    const verdict = check(item);
    const net = Math.max(0, Number(item.available) - Number(item.loaned || 0));
    const pct = net > 0
      ? Math.round((Number(item.assigned) / net) * 100)
      : (Number(item.assigned) > 0 ? 100 : 0);
    const canWrite = CREATABLE();
    const lock = canWrite ? '' : 'disabled';
    return `<tr data-res-row="${index}" class="${verdict.level === 'over' ? 'is-over' : ''}">
      <td><input data-res-field="name" value="${escapeHtml(item.name)}" placeholder="如：指示牌 / 报告厅" ${lock} /></td>
      <td><select data-res-field="kind" ${lock}>${inventoryKinds.map((kind) => `<option value="${kind.value}" ${item.kind === kind.value ? 'selected' : ''}>${kind.label}</option>`).join('')}</select></td>
      <td><select data-res-field="phase" ${lock}>${PHASES.map((p) => `<option value="${p.value}" ${item.phase === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}</select></td>
      <td><input data-res-field="unit" class="w-xs" value="${escapeHtml(item.unit)}" ${lock} /></td>
      <td><input type="number" min="0" data-res-field="available" class="w-xs" value="${Number(item.available)}" ${lock} /></td>
      <td><input type="number" min="0" data-res-field="assigned" class="w-xs" value="${Number(item.assigned)}" ${lock} /></td>
      <td><input type="number" min="0" data-res-field="loaned" class="w-xs" value="${Number(item.loaned || 0)}" ${lock} /></td>
      <td><input type="number" min="0" step="0.01" data-res-field="unitCost" class="w-xs" value="${Number(item.unitCost || 0)}" ${lock} /></td>
      <td><input data-res-field="location" value="${escapeHtml(item.location || '')}" placeholder="存放地点" ${lock} /></td>
      <td><input data-res-field="supplier" value="${escapeHtml(item.supplier || '')}" placeholder="采购 / 来源" ${lock} /></td>
      <td><select data-res-field="condition" ${lock}>${['待核验', '可用', '采购中', '待归还', '维修中', '报废'].map((v) => `<option ${v === (item.condition || '待核验') ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><span class="res-pct">${pct}%</span></td>
      <td><span class="res-check is-${verdict.level}">${escapeHtml(verdict.label)}</span></td>
      <td><input data-res-field="owner" value="${escapeHtml(item.owner || '')}" placeholder="责任人角色" ${lock} /></td>
      <td><input data-res-field="note" value="${escapeHtml(item.note || '')}" placeholder="用途 / 备注" ${lock} /></td>
      <td data-resource-invoices="${escapeHtml(item.id)}" class="resource-invoices">${(item.invoices || []).map((file, i) => `<div class="resource-invoice-file"><button class="button button-quiet" data-res-invoice-download="${escapeHtml(item.id)}" data-file-index="${i}" ${file.dataUrl ? '' : 'disabled'} title="${escapeHtml(file.stored ? '下载已保存原件' : '仅保存文件名，原件需另存')}">${escapeHtml(file.name)}${file.stored ? '' : '（原件另存）'}</button>${canWrite ? `<button class="row-remove" data-res-invoice-remove="${escapeHtml(item.id)}" data-file-index="${i}" title="移除此凭证">×</button>` : ''}</div>`).join('')}<button class="button button-ghost" data-res-invoice-add="${escapeHtml(item.id)}" ${lock}>上传 / 拖入发票</button></td>
      <td><button class="row-remove" data-res-remove="${index}" title="删除" ${lock}>×</button></td>
    </tr>`;
  }

  function render() {
    window.WB.inventory?.sync(state());
    const section = state().ui.resourceSection === 'inventory' ? 'inventory' : 'personnel';
    $('#personnelSection').classList.toggle('hidden', section !== 'personnel');
    $('#inventorySection').classList.toggle('hidden', section !== 'inventory');
    $('#resourcesPanel').querySelectorAll('[data-resource-section]').forEach((button) => {
      const active = button.dataset.resourceSection === section;
      button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
    });
    window.WB.personnel?.render();
    renderLegacyStaff();
    if (state().ui.resourceKind === 'staff') state().ui.resourceKind = '';
    renderToolbar();
    const current = state();
    const kind = current.ui.resourceKind || '';
    const phase = current.ui.resourcePhase === 'all' ? '' : current.ui.resourcePhase || '';
    const list = current.resources.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.kind !== 'staff' && (!kind || item.kind === kind) && (!phase || item.phase === phase));

    renderStats(inventory());
    renderConflicts(inventory());

    $('#resourceTable').innerHTML = list.length
      ? `<div class="table-scroll"><table class="res-table">
          <thead><tr>
            <th>资源</th><th>类型</th><th>阶段</th><th>单位</th>
            <th>库存可用</th><th>计划需求</th><th>已借出</th><th>单价（元）</th><th>存放地点</th><th>采购 / 来源</th><th>状态</th><th>计划占用</th><th>检查</th>
            <th>责任人</th><th>备注</th><th>采购发票 / 凭证</th><th></th>
          </tr></thead>
          <tbody>${list.map(({ item, index }) => row(item, index)).join('')}</tbody>
        </table></div>`
      : `<div class="card"><div class="empty"><strong>${inventory().length ? '没有符合筛选条件的资源' : '还没有登记物资与资源'}</strong>登记物料、设备、场地、经费与车辆，系统会自动检查占用冲突。</div></div>`;
    const legacyFiles = Object.values(current.resourceMaterialBackup?.invoices || {}).flat();
    if (legacyFiles.length) $('#resourceTable').innerHTML += `<details class="card staff-pad"><summary>旧物料清单发票备份 · ${legacyFiles.length} 份</summary><p class="staff-note">原发票保留在旧清单备份中；导入台账时按原表行关联到资源。</p>${legacyFiles.map((file, i) => `<button class="button button-ghost" data-res-legacy-invoice-download="${i}"${file.dataUrl ? '' : ' disabled'}>${escapeHtml(file.name)}${file.dataUrl ? '' : '（原件另存）'}</button>`).join('')}</details>`;

    $('#resourceSummary').textContent = inventory().length
      ? `已登记 ${inventory().length} 项物资与资源；物料与设备清单统一来自本台账。每行可上传采购发票 / 凭证，≤400 KB 原件随项目保存，较大文件仅登记名称并另存原件。净可用 = 库存可用 − 已借出。`
      : '';
  }

  function renderLegacyStaff() {
    const rows = state().resources.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'staff');
    const lock = CREATABLE() ? '' : 'disabled';
    $('#legacyStaffTable').innerHTML = !rows.length ? '' : `<div class="card"><div class="card-title"><h3>历史人员需求汇总</h3><small>保留旧项目的计划人数；实名人员与实际班次以账号名册为准</small></div>
      <div class="table-scroll"><table class="res-table"><thead><tr><th>岗位 / 人员类别</th><th>阶段</th><th>计划可用人数</th><th>计划需求人数</th><th>负责人</th><th>备注</th><th></th></tr></thead><tbody>${rows.map(({ item, index }) => `<tr data-res-row="${index}">
      <td><input data-res-field="name" value="${escapeHtml(item.name)}" ${lock} /></td><td>${escapeHtml(U.PHASE_LABEL[item.phase])}</td>
      <td><input type="number" min="0" data-res-field="available" value="${Number(item.available)}" ${lock} /></td><td><input type="number" min="0" data-res-field="assigned" value="${Number(item.assigned)}" ${lock} /></td>
      <td><input data-res-field="owner" value="${escapeHtml(item.owner)}" ${lock} /></td><td><input data-res-field="note" value="${escapeHtml(item.note)}" ${lock} /></td>
      <td><button class="row-remove" data-res-remove="${index}" title="删除历史汇总行" ${lock}>×</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  /* ── 数据操作 ─────────────────────────── */

  function addResource(patch = {}) {
    if (!canOperate()) return;
    const kind = inventoryKinds.some((k) => k.value === patch.kind) ? patch.kind : 'material';
    state().resources.push({
      id: U.uid('res'),
      name: '',
      kind,
      phase: 'prepare',
      unit: RESOURCE_UNIT[kind] || '个',
      available: 1,
      assigned: 0,
      owner: '',
      note: '',
      source: 'user',
      ...patch, kind
    });
    store().save();
    render();
  }

  function sampleLedger() {
    if (!canOperate()) return;
    const samples = [
      { name: '主会场报告厅', kind: 'venue', phase: 'execute', unit: '处', available: 1, assigned: 1, owner: '场地负责人', note: '含 200 座与投影' },
      { name: '备用场地（体育馆副馆）', kind: 'venue', phase: 'execute', unit: '处', available: 1, assigned: 0, owner: '场地负责人', note: '雨天或场地冲突时启用' },
      { name: '无线麦克风', kind: 'equipment', phase: 'execute', unit: '台', available: 4, assigned: 6, owner: '技术负责人', note: '含备用 2 台' },
      { name: '投影与切换台', kind: 'equipment', phase: 'execute', unit: '台', available: 1, assigned: 1, owner: '技术负责人', note: '需提前 1 小时调试' },
      { name: '桁架与喷绘', kind: 'material', phase: 'prepare', unit: '件', available: 8, assigned: 8, owner: '物料负责人', note: '含主背景与指引牌' },
      { name: '活动经费', kind: 'fund', phase: 'plan', unit: '元', available: 18000, assigned: 16500, owner: '财务负责人', note: '不占用餐饮科目' },
      { name: '物料运输车辆', kind: 'vehicle', phase: 'prepare', unit: '辆', available: 2, assigned: 3, owner: '后勤负责人', note: '往返科创中心' }
    ];
    const existing = new Set(state().resources.map((item) => item.name));
    const added = samples.filter((item) => !existing.has(item.name));
    state().resources.push(...added.map((item) => ({ id: U.uid('res'), source: 'user', ...item })));
    store().log('resource', `新增示例物资与资源 ${added.length} 项`);
    store().save();
    render();
    window.WB.toast(`新增 ${added.length} 项示例物资与资源，已有台账与凭证保留`);
  }

  async function aiSuggest() {
    if (!canOperate()) return;
    const current = state();
    if (!current.project) { window.WB.toast('先建立项目信息表'); return; }
    const data = await window.WB.ai.run('resource-plan', {
      项目信息: current.project.basic,
      任务分解: current.wbs.map((row) => `${row.phase}｜${row.task}｜${row.owner}`),
      物资与场地产出: current.materials.venuePlan?.sections?.map((s) => s.heading) || [],
      已有资源: inventory().map((item) => item.name),
      要求: '仅提炼物料、设备、场地、经费和车辆。服务人员通过账号名册管理，不生成 staff 类型。'
    }, window.WB.ai.resourceContract());
    if (!data) return;
    const added = window.WB.ai.mergeResources(current, (data.resources || []).filter((r) => r.kind !== 'staff'));
    store().log('ai', `AI 提炼 ${added} 项资源`);
    store().save();
    render();
    window.WB.toast(added ? `AI 新增 ${added} 项资源，请核对数量` : 'AI 没有发现需要新增的资源');
  }

  function mount() {
    window.WB.personnel?.mount();
    const panel = $('#resourcesPanel');
    const invoiceInput = document.createElement('input'); invoiceInput.type = 'file'; invoiceInput.id = 'resourceInvoiceFile'; invoiceInput.multiple = true; invoiceInput.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx'; invoiceInput.hidden = true; panel.appendChild(invoiceInput);
    async function uploadInvoices(id, files) {
      if (!canOperate() || !files.length || !inventory().some((r) => r.id === id)) return;
      const projectId = state().activeId;
      const prepared = await window.WB.views.material.readInvoices(files);
      if (state().activeId !== projectId || !canOperate()) { window.WB.toast('项目或权限已变化，请重新上传'); return; }
      const item = inventory().find((r) => r.id === id); if (!item) return;
      item.invoices ||= []; let added = 0;
      for (const file of prepared) { if (item.invoices.length >= 6) break; item.invoices.push({ ...file, id: U.uid('inv'), stored: Boolean(file.dataUrl), at: new Date().toISOString() }); added++; }
      store().log('resource', `「${item.name}」提交采购发票 / 凭证 ${added} 份`); store().save(); render();
      window.WB.toast(`已保存 ${added} 份凭证；每项最多 6 份${prepared.some((f) => !f.dataUrl) ? '，较大文件仅登记名称，原件请另存' : ''}`);
    }
    invoiceInput.addEventListener('change', async () => { const files = Array.from(invoiceInput.files || []), id = invoiceInput.dataset.resourceId; invoiceInput.value = ''; await uploadInvoices(id, files); });
    panel.addEventListener('dragover', (event) => { if (event.target.closest('[data-resource-invoices]') && Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
    panel.addEventListener('drop', (event) => { const target = event.target.closest('[data-resource-invoices]'); if (!target || !event.dataTransfer?.files?.length) return; event.preventDefault(); uploadInvoices(target.dataset.resourceInvoices, Array.from(event.dataTransfer.files)); });

    panel.addEventListener('click', (event) => {
      const section = event.target.closest('[data-resource-section]');
      if (section) { state().ui.resourceSection = section.dataset.resourceSection; store().save(); render(); return; }
      if (event.target.closest('[data-res-invoice-submit]') && canOperate()) { const id = panel.querySelector('[data-res-invoice-target]')?.value; if (!id) { window.WB.toast('先选择这张发票对应的资源'); return; } invoiceInput.dataset.resourceId = id; invoiceInput.click(); return; }
      const upload = event.target.closest('[data-res-invoice-add]');
      if (upload && canOperate()) { invoiceInput.dataset.resourceId = upload.dataset.resInvoiceAdd; invoiceInput.click(); return; }
      const download = event.target.closest('[data-res-invoice-download]');
      const legacyDownload = event.target.closest('[data-res-legacy-invoice-download]');
      if (download || legacyDownload) {
        const file = download ? state().resources.find((r) => r.id === download.dataset.resInvoiceDownload)?.invoices?.[Number(download.dataset.fileIndex)] : Object.values(state().resourceMaterialBackup?.invoices || {}).flat()[Number(legacyDownload.dataset.resLegacyInvoiceDownload)];
        if (file?.dataUrl?.startsWith('data:')) { const link = document.createElement('a'); link.href = file.dataUrl; link.download = file.name; link.click(); } return;
      }
      const invoiceRemove = event.target.closest('[data-res-invoice-remove]');
      if (invoiceRemove && canOperate()) { const item = state().resources.find((r) => r.id === invoiceRemove.dataset.resInvoiceRemove); item?.invoices?.splice(Number(invoiceRemove.dataset.fileIndex), 1); store().save(); render(); return; }
      if (event.target.closest('[data-res-add]')) { addResource(); return; }
      if (event.target.closest('[data-res-sample]')) { sampleLedger(); return; }
      if (event.target.closest('[data-res-ai]')) { aiSuggest(); return; }
      if (event.target.closest('[data-res-export]')) {
        if (!state().resources.length) { window.WB.toast('还没有资源可导出'); return; }
        U.downloadText(`${U.safeFileName(store().projectName())}-人员与资源台账.md`, window.WB.exporters.resourcesToMarkdown());
        return;
      }
      if (event.target.closest('[data-res-material-export]')) {
        U.downloadBytes(`${U.safeFileName(store().projectName())}-物料与设备清单.xlsx`, window.WB.exporters.materialToXlsx(window.WB.inventory.documentOf(state())), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); return;
      }
      if (event.target.closest('[data-res-legacy-export]')) { U.downloadText('旧物料清单备份.md', window.WB.exporters.materialToMarkdown(state().resourceMaterialBackup)); return; }
      if (event.target.closest('[data-res-legacy-import]')) {
        if (!canOperate()) return;
        const rows = window.WB.inventory.legacyRows(state().resourceMaterialBackup);
        if (!rows.length) { window.WB.toast('旧正文没有可识别的名称 / 数量表格，请手动补录，旧备份仍可导出'); return; }
        if (!confirm(`识别 ${rows.length} 项：${rows.map((r) => `${r.name} ${r.assigned}${r.unit}`).join('、')}。导入后库存为 0（待核实），相同名称和单位跳过。继续？`)) return;
        let added = 0;
        for (const row of rows) {
          const existing = state().resources.find((r) => r.name === row.name && r.unit === row.unit);
          if (!existing) { state().resources.push({ id: U.uid('res'), ...row }); added++; }
          else { existing.invoices ||= []; for (const file of row.invoices || []) if (!existing.invoices.some((f) => f.id === file.id || f.name === file.name && f.size === file.size && f.at === file.at)) existing.invoices.push(file); }
        }
        store().log('resource', `旧清单导入资源 ${added} 项，库存待核实`); store().save(); render(); window.WB.toast(`新增 ${added} 项；旧正文已保留，库存需人工核实`); return;
      }
      const remove = event.target.closest('[data-res-remove]');
      if (remove && canOperate()) {
        state().resources.splice(Number(remove.dataset.resRemove), 1);
        store().save();
        render();
      }
    });

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-res-field]');
      if (!el || !canOperate()) return;
      const item = state().resources[Number(el.closest('[data-res-row]')?.dataset.resRow)];
      if (!item) return;
      const key = el.dataset.resField;
      if (['available', 'assigned', 'loaned', 'unitCost'].includes(key)) item[key] = Math.max(0, Number(el.value) || 0);
      else item[key] = el.value;
      if (key === 'kind') item.unit = RESOURCE_UNIT[el.value] || item.unit;
      item.source = 'user';
      store().save();
      /* 输入数量时就刷新派生提示，保留当前单元格焦点。 */
      if (['available', 'assigned', 'loaned', 'unitCost'].includes(key)) {
        renderStats(inventory()); renderConflicts(inventory());
        const tr = el.closest('[data-res-row]'), verdict = check(item), net = Math.max(0, Number(item.available) - Number(item.loaned || 0));
        const badge = tr.querySelector('.res-check'), pct = tr.querySelector('.res-pct');
        if (badge) { badge.textContent = verdict.label; badge.className = `res-check is-${verdict.level}`; }
        if (pct) pct.textContent = `${net > 0 ? Math.round(Number(item.assigned) / net * 100) : Number(item.assigned) > 0 ? 100 : 0}%`;
        tr.classList.toggle('is-over', verdict.level === 'over');
      }
      if (['kind', 'phase', 'condition'].includes(key)) render();
    });

    panel.addEventListener('change', (event) => {
      const filter = event.target.closest('[data-res-filter]');
      if (!filter) {
        const field = event.target.closest('[data-res-field]');
        if (field && canOperate()) { const item = state().resources[Number(field.closest('[data-res-row]')?.dataset.resRow)]; if (item) { const key = field.dataset.resField; item[key] = ['available','assigned','loaned','unitCost'].includes(key) ? Math.max(0, Number(field.value) || 0) : field.value; store().save(); render(); } }
        return;
      }
      if (filter.dataset.resFilter === 'kind') state().ui.resourceKind = filter.value;
      else state().ui.resourcePhase = filter.value;
      store().save();
      render();
    });
  }

  window.WB.views.resources = { id: 'resources', label: '人员与资源', render, mount, addResource, check };
}());
