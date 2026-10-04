/* 人员与资源视图：资源台账 + 占用冲突检查，供排班、场地与经费安排共用。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASES, RESOURCE_KINDS, RESOURCE_UNIT, canOperate } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  /* 冲突判定：超额为缺口，刚好排满为提醒，其余正常 */
  function check(item) {
    const gap = Number(item.assigned) - Number(item.available);
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
          ${RESOURCE_KINDS.map((kind) => `<option value="${kind.value}" ${state().ui.resourceKind === kind.value ? 'selected' : ''}>${kind.label}</option>`).join('')}
        </select>
        <select data-res-filter="phase">
          <option value="">全部阶段</option>
          ${PHASES.map((p) => `<option value="${p.value}" ${state().ui.resourcePhase === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select>
      </span>
      <div class="panel-actions">
        <button class="button button-ghost" data-res-add ${canWrite ? '' : 'disabled'}>＋ 添加资源</button>
        <button class="button button-ghost" data-res-ai ${aiEnabled ? '' : 'disabled'} title="${escapeHtml(aiTitle)}"><span>✦</span> AI 提炼资源台账</button>
        <button class="button button-ghost" data-res-sample ${canWrite ? '' : 'disabled'}>载入示例台账</button>
        <button class="button button-ghost" data-res-export ${state().resources.length ? '' : 'disabled'}>导出资源台账</button>
      </div>`;
  }

  function renderStats(list) {
    const over = list.filter((item) => check(item).level === 'over');
    const full = list.filter((item) => check(item).level === 'full');
    const kinds = new Set(list.map((item) => item.kind)).size;
    const gap = over.reduce((sum, item) => sum + (Number(item.assigned) - Number(item.available)), 0);
    $('#resourcesStats').innerHTML = `<div class="wbs-summary">
      ${stat('资源条目', list.length, '项')}
      ${stat('覆盖类型', kinds, `/ ${RESOURCE_KINDS.length}`)}
      ${stat('占用冲突', over.length, '项', over.length ? 'danger' : '')}
      ${stat('已排满', full.length, '项')}
      ${stat('缺口合计', gap, '（按各单位折算）')}
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
      <ul class="gap-list">${over.map(({ item }) => `<li><b>${escapeHtml(item.name || '未命名资源')}</b>：可用 ${Number(item.available)} ${escapeHtml(item.unit || '')} / 已安排 ${Number(item.assigned)} ${escapeHtml(item.unit || '')}，缺口 ${Number(item.assigned) - Number(item.available)} ${escapeHtml(item.unit || '')}</li>`).join('')}</ul>
    </div>`;
  }

  function row(item, index) {
    const verdict = check(item);
    const pct = Number(item.available) > 0
      ? Math.round((Number(item.assigned) / Number(item.available)) * 100)
      : (Number(item.assigned) > 0 ? 100 : 0);
    const canWrite = CREATABLE();
    const lock = canWrite ? '' : 'disabled';
    return `<tr data-res-row="${index}" class="${verdict.level === 'over' ? 'is-over' : ''}">
      <td><input data-res-field="name" value="${escapeHtml(item.name)}" placeholder="如：志愿者 / 报告厅" ${lock} /></td>
      <td><select data-res-field="kind" ${lock}>${RESOURCE_KINDS.map((kind) => `<option value="${kind.value}" ${item.kind === kind.value ? 'selected' : ''}>${kind.label}</option>`).join('')}</select></td>
      <td><select data-res-field="phase" ${lock}>${PHASES.map((p) => `<option value="${p.value}" ${item.phase === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}</select></td>
      <td><input data-res-field="unit" class="w-xs" value="${escapeHtml(item.unit)}" ${lock} /></td>
      <td><input type="number" min="0" data-res-field="available" class="w-xs" value="${Number(item.available)}" ${lock} /></td>
      <td><input type="number" min="0" data-res-field="assigned" class="w-xs" value="${Number(item.assigned)}" ${lock} /></td>
      <td><span class="res-pct">${pct}%</span></td>
      <td><span class="res-check is-${verdict.level}">${escapeHtml(verdict.label)}</span></td>
      <td><input data-res-field="owner" value="${escapeHtml(item.owner || '')}" placeholder="责任人角色" ${lock} /></td>
      <td><input data-res-field="note" value="${escapeHtml(item.note || '')}" placeholder="用途 / 备注" ${lock} /></td>
      <td><button class="row-remove" data-res-remove="${index}" title="删除" ${lock}>×</button></td>
    </tr>`;
  }

  function render() {
    renderToolbar();
    const current = state();
    const kind = current.ui.resourceKind || '';
    const phase = current.ui.resourcePhase || '';
    const list = current.resources.map((item, index) => ({ item, index }))
      .filter(({ item }) => (!kind || item.kind === kind) && (!phase || item.phase === phase));

    renderStats(current.resources);
    renderConflicts(current.resources);

    $('#resourceTable').innerHTML = list.length
      ? `<div class="table-scroll"><table class="res-table">
          <thead><tr>
            <th>资源</th><th>类型</th><th>阶段</th><th>单位</th>
            <th>可用</th><th>已安排</th><th>占用</th><th>检查</th>
            <th>责任人</th><th>备注</th><th></th>
          </tr></thead>
          <tbody>${list.map(({ item, index }) => row(item, index)).join('')}</tbody>
        </table></div>`
      : `<div class="card"><div class="empty"><strong>还没有登记资源</strong>把人员、场地、设备、物料、经费与车辆都登记进来，系统会自动检查占用冲突。</div></div>`;

    $('#resourceSummary').textContent = current.resources.length
      ? `已登记 ${current.resources.length} 项资源；「已安排」超出「可用数量」的条目会标红并计入冲突，可作为排班与场地方案的自检依据`
      : '';
  }

  /* ── 数据操作 ─────────────────────────── */

  function addResource(patch = {}) {
    const kind = patch.kind || 'staff';
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
      ...patch
    });
    store().save();
    render();
  }

  function sampleLedger() {
    const samples = [
      { name: '志愿者', kind: 'staff', phase: 'execute', unit: '人', available: 30, assigned: 36, owner: '志愿者负责人', note: '含引导、签到、秩序维护' },
      { name: '工作人员', kind: 'staff', phase: 'prepare', unit: '人', available: 12, assigned: 12, owner: '活动总协调', note: '筹备期物料与对接' },
      { name: '主会场报告厅', kind: 'venue', phase: 'execute', unit: '处', available: 1, assigned: 1, owner: '场地负责人', note: '含 200 座与投影' },
      { name: '备用场地（体育馆副馆）', kind: 'venue', phase: 'execute', unit: '处', available: 1, assigned: 0, owner: '场地负责人', note: '雨天或场地冲突时启用' },
      { name: '无线麦克风', kind: 'equipment', phase: 'execute', unit: '台', available: 4, assigned: 6, owner: '技术负责人', note: '含备用 2 台' },
      { name: '投影与切换台', kind: 'equipment', phase: 'execute', unit: '台', available: 1, assigned: 1, owner: '技术负责人', note: '需提前 1 小时调试' },
      { name: '桁架与喷绘', kind: 'material', phase: 'prepare', unit: '件', available: 8, assigned: 8, owner: '物料负责人', note: '含主背景与指引牌' },
      { name: '活动经费', kind: 'fund', phase: 'plan', unit: '元', available: 18000, assigned: 16500, owner: '财务负责人', note: '不占用餐饮科目' },
      { name: '物料运输车辆', kind: 'vehicle', phase: 'prepare', unit: '辆', available: 2, assigned: 3, owner: '后勤负责人', note: '往返科创中心' }
    ];
    state().resources = samples.map((item) => ({ id: U.uid('res'), source: 'user', ...item }));
    store().log('resource', `载入示例资源台账 ${samples.length} 项`);
    store().save();
    render();
    window.WB.toast('示例资源台账已载入，可直接看到 3 处占用冲突');
  }

  async function aiSuggest() {
    const current = state();
    if (!current.project) { window.WB.toast('先建立项目信息表'); return; }
    const data = await window.WB.ai.run('resource-plan', {
      项目信息: current.project.basic,
      任务分解: current.wbs.map((row) => `${row.phase}｜${row.task}｜${row.owner}`),
      物资与场地产出: current.materials.venuePlan?.sections?.map((s) => s.heading) || [],
      已有资源: current.resources.map((item) => item.name)
    }, window.WB.ai.resourceContract());
    if (!data) return;
    const added = window.WB.ai.mergeResources(current, data.resources);
    store().log('ai', `AI 提炼 ${added} 项资源`);
    store().save();
    render();
    window.WB.toast(added ? `AI 新增 ${added} 项资源，请核对数量` : 'AI 没有发现需要新增的资源');
  }

  function mount() {
    const panel = $('#resourcesPanel');

    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-res-add]')) { addResource(); return; }
      if (event.target.closest('[data-res-sample]')) { sampleLedger(); return; }
      if (event.target.closest('[data-res-ai]')) { aiSuggest(); return; }
      if (event.target.closest('[data-res-export]')) {
        if (!state().resources.length) { window.WB.toast('还没有资源可导出'); return; }
        U.downloadText(`${U.safeFileName(store().projectName())}-人员与资源台账.md`, window.WB.exporters.resourcesToMarkdown());
        return;
      }
      const remove = event.target.closest('[data-res-remove]');
      if (remove) {
        state().resources.splice(Number(remove.dataset.resRemove), 1);
        store().save();
        render();
      }
    });

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-res-field]');
      if (!el) return;
      const item = state().resources[Number(el.closest('[data-res-row]')?.dataset.resRow)];
      if (!item) return;
      const key = el.dataset.resField;
      if (key === 'available' || key === 'assigned') item[key] = Math.max(0, Number(el.value) || 0);
      else item[key] = el.value;
      if (key === 'kind') item.unit = RESOURCE_UNIT[el.value] || item.unit;
      item.source = 'user';
      store().save();
      /* 数量变化会影响冲突结论，这里整体重绘；文本输入保持焦点不重绘 */
      if (key === 'available' || key === 'assigned' || key === 'kind' || key === 'phase') render();
    });

    panel.addEventListener('change', (event) => {
      const filter = event.target.closest('[data-res-filter]');
      if (!filter) return;
      if (filter.dataset.resFilter === 'kind') state().ui.resourceKind = filter.value;
      else state().ui.resourcePhase = filter.value;
      store().save();
      render();
    });
  }

  window.WB.views.resources = { id: 'resources', label: '人员与资源', render, mount, addResource, check };
}());
