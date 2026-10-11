/* Resource ledger is the source of material lists; old documents remain archived. */
window.WB = window.WB || {};
(function () {
  const U = window.WB.util;
  const cell = (v) => String(v ?? '').replace(/\|/g, '／').replace(/\r?\n/g, ' ');
  const row = (values) => `| ${values.map(cell).join(' | ')} |`;
  function documentOf(state) {
    const records = (state.resources || []).filter((r) => ['material', 'equipment'].includes(r.kind));
    const header = ['资源编号', '资源名称', '类型', '阶段', '单位', '库存可用', '计划需求', '已借出', '净可用', '待补数量', '单价（元）', '预计费用（元）', '存放地点', '责任人', '采购 / 来源', '状态', '备注', '发票 / 凭证'];
    const body = [row(header), row(header.map(() => '---'))];
    for (const r of records) body.push(row([r.id, r.name, U.RESOURCE_KIND[r.kind], U.PHASE_LABEL[r.phase], r.unit, r.available, r.assigned, r.loaned || 0,
      Math.max(0, Number(r.available) - Number(r.loaned || 0)), Math.max(0, Number(r.assigned) - Math.max(0, Number(r.available) - Number(r.loaned || 0))), r.unitCost || 0,
      (Number(r.assigned) * Number(r.unitCost || 0)).toFixed(2), r.location, r.owner, r.supplier, r.condition || '待核验', r.note, (r.invoices || []).map((f) => `${f.name}${f.stored ? '' : '（原件另存）'}`).join('；')]));
    return { title: `${state.project?.basic?.name || '活动'}｜物料与设备清单`, source: 'resource-ledger', sections: [
      { heading: '物料与设备清单', body: records.length ? body.join('\n') : '尚未登记物料或设备，请在「人员与资源」补齐。' },
      { heading: '口径与检查', body: '本清单由人员与资源台账生成，统一在资源台账编辑。库存可用为登记的库存总量，净可用扣除已借出；计划需求与班次预留分别记录，不能相加当作同一占用。费用按计划需求 × 单价估算，不代表实际决算。正式库存、采购与归还情况由负责人核验。' }
    ] };
  }
  function sync(state) {
    if (!state.project || !state.materials) return;
    if (!state.project.outputs?.materialList && !state.materials.materialList) return;
    if (!(state.resources || []).some((r) => ['material', 'equipment'].includes(r.kind)) && !state.materials.materialList) return;
    const previous = state.materials.materialList;
    if (previous && previous.source !== 'resource-ledger') state.resourceMaterialBackup ||= JSON.parse(JSON.stringify(previous));
    state.materials.materialList = { ...documentOf(state), materialId: previous?.materialId || 'MAT-materialList', deliveries: previous?.deliveries || [] };
  }
  function legacyRows(doc) {
    const records = [];
    for (const [sectionIndex, section] of (doc?.sections || []).entries()) for (const [blockIndex, block] of window.WB.markdown.parseBlocks(section.body || '').entries()) {
      if (block.type !== 'table') continue;
      const column = (pattern) => block.header.findIndex((h) => pattern.test(String(h)));
      const name = column(/物料名称|资源名称|物品名称|设备名称|物料|物品|名称/), qty = column(/计划需求|需求数量|数量|需求量/);
      if (name < 0 || qty < 0) continue;
      const unit = column(/单位/), price = column(/单价/), owner = column(/责任人|负责人/), note = column(/备注|说明/);
      for (const [rowIndex, cells] of block.rows.entries()) {
        const label = String(cells[name] || '').trim(), amount = Number(String(cells[qty] || '').replace(/,/g, ''));
        if (!label || /合计|总计/.test(label) || !Number.isFinite(amount) || amount < 0) continue;
        records.push({ name: label, kind: 'material', phase: 'prepare', unit: unit >= 0 ? cells[unit] || '件' : '件', assigned: amount, available: 0, loaned: 0,
          unitCost: price >= 0 ? Math.max(0, Number(String(cells[price] || '').replace(/[¥￥,]/g, '')) || 0) : 0,
          owner: owner >= 0 ? cells[owner] : '', invoices: JSON.parse(JSON.stringify(doc.invoices?.[`${sectionIndex}:${blockIndex}:${rowIndex}`] || [])), note: `${note >= 0 ? cells[note] || '' : ''} 由旧清单导入；库存待核实`, source: 'user', condition: '待核验' });
      }
    }
    return records;
  }
  window.WB.inventory = { documentOf, sync, legacyRows };
}());
