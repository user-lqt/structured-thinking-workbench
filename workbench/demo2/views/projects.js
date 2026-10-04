/* 项目库：多项目的建立、切换、复制、归档与删除，以及项目包的导入导出。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, fmtDateTime, canManage } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  const FILTERS = [
    { value: 'active', label: '进行中' },
    { value: 'archived', label: '已归档' },
    { value: 'all', label: '全部' }
  ];

  const today = () => new Date().toISOString().slice(0, 10);

  const stat = (label, value, unit) => `<div class="stat">
    <span class="stat-label">${escapeHtml(label)}</span>
    <strong class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong>
  </div>`;

  function renderStats(current) {
    const projects = current.projects || [];
    const archived = projects.filter((item) => item.archived).length;
    const ended = projects.filter((item) => item.date && item.date < today()).length;
    return `<div class="wbs-summary">
      ${stat('项目总数', projects.length, '个')}
      ${stat('进行中', projects.length - archived, '个')}
      ${stat('已归档', archived, '个')}
      ${stat('活动日期已过', ended, '个')}
    </div>`;
  }

  function renderToolbar(current) {
    const canWrite = canManage();
    $('#projectsToolbar').innerHTML = `
      <div class="seg-switch" id="projectSeg">
        ${FILTERS.map((item) => `<button data-project-filter="${item.value}" class="${(current.ui.projectFilter || 'active') === item.value ? 'is-active' : ''}">${escapeHtml(item.label)}</button>`).join('')}
      </div>
      <div class="panel-actions">
        <button class="button button-primary" data-project-new ${canWrite ? '' : 'disabled'} title="${canWrite ? '' : '当前身份为只读访客或活动成员，只有活动组织者可以新建项目'}">＋ 新建项目</button>
        <button class="button button-ghost" data-project-import>导入项目包</button>
        <button class="button button-ghost" data-project-export ${current.activeId ? '' : 'disabled'}>导出当前项目包</button>
      </div>`;
  }

  function projectCard(item, current) {
    const isActive = item.id === current.activeId;
    const percent = Number(item.percent) || 0;
    const canWrite = canManage();
    const meta = [item.type, item.date, item.venue].filter(Boolean).join(' · ');
    return `<article class="project-card ${isActive ? 'is-active' : ''}" data-project-card="${item.id}">
      <div class="project-card-head">
        <span class="project-type-mark">${escapeHtml((item.type || '活').slice(0, 1))}</span>
        <div class="project-card-title">
          <h3>${escapeHtml(item.name || '未命名活动')}</h3>
          <p>${escapeHtml(meta || '尚未填写活动信息')}</p>
        </div>
        ${isActive ? '<span class="project-badge">当前</span>' : ''}
        ${item.archived ? '<span class="project-badge is-muted">已归档</span>' : ''}
      </div>
      <div class="project-progress">
        <span>任务完成度</span>
        <div class="bar"><i style="width:${percent}%"></i></div>
        <b>${percent}%</b>
      </div>
      <div class="project-card-meta">任务 ${Number(item.tasks) || 0} 项 · 风险 ${Number(item.risks) || 0} 项 · 材料 ${Number(item.materials) || 0} 份</div>
      <div class="project-card-foot">
        <small>更新于 ${escapeHtml(fmtDateTime(item.updatedAt) || '—')}</small>
        <div class="project-card-actions">
          <button class="button button-ghost" data-project-open="${item.id}">打开</button>
          <button class="button button-ghost" data-project-rename="${item.id}" ${canWrite ? '' : 'disabled'}>重命名</button>
          <button class="button button-ghost" data-project-duplicate="${item.id}" ${canWrite ? '' : 'disabled'}>复制</button>
          <button class="button button-ghost" data-project-archive="${item.id}" ${canWrite ? '' : 'disabled'}>${item.archived ? '取消归档' : '归档'}</button>
          <button class="button button-ghost danger" data-project-delete="${item.id}" ${canWrite ? '' : 'disabled'}>删除</button>
        </div>
      </div>
    </article>`;
  }

  function render() {
    const current = state();
    renderToolbar(current);
    $('#projectsStats').innerHTML = renderStats(current);

    const filter = current.ui.projectFilter || 'active';
    const list = (current.projects || []).filter((item) => (
      filter === 'all' ? true : filter === 'archived' ? item.archived : !item.archived
    ));

    $('#projectList').innerHTML = list.length
      ? `<div class="project-grid">${list.map((item) => projectCard(item, current)).join('')}</div>`
      : `<div class="card"><div class="empty"><strong>这里还没有项目</strong>
          ${filter === 'archived' ? '归档的项目会出现在这里。' : '点击「＋ 新建项目」开始第一场活动，或导入此前导出的项目包。'}
        </div></div>`;
  }

  function openProject(id) {
    if (id === state().activeId) { window.WB.switchView('overview'); return; }
    if (!store().switchProject(id)) { window.WB.toast('项目打开失败，本地数据可能已损坏'); return; }
    window.WB.renderAll();
    window.WB.toast(`已切换到「${store().projectName()}」`);
  }

  function renameProject(id) {
    if (!canManage()) { window.WB.toast('只有活动组织者可以重命名项目'); return; }
    const entry = state().projects.find((item) => item.id === id);
    if (!entry) return;
    const name = prompt('新的项目名称：', entry.name || '');
    if (name == null) return;
    store().renameProject(id, name);
    store().log('project', `重命名项目为「${U.text(name) || '未命名活动'}」`);
    store().save();
    window.WB.renderAll();
  }

  function duplicateProject(id) {
    if (!canManage()) { window.WB.toast('只有活动组织者可以复制项目'); return; }
    const newId = store().duplicateProject(id);
    if (!newId) { window.WB.toast('复制失败：项目内容不可读'); return; }
    window.WB.renderAll();
    window.WB.toast('已复制为一份新项目，可直接修改');
  }

  function archiveProject(id) {
    if (!canManage()) { window.WB.toast('只有活动组织者可以归档项目'); return; }
    const entry = state().projects.find((item) => item.id === id);
    if (!entry) return;
    const next = !entry.archived;
    store().archiveProject(id, next);
    store().log('project', `${next ? '归档' : '取消归档'}项目「${entry.name}」`);
    store().save();
    window.WB.renderAll();
    window.WB.toast(next ? '项目已归档，可在「已归档」中找回' : '项目已恢复为进行中');
  }

  function deleteProject(id) {
    if (!canManage()) { window.WB.toast('只有活动组织者可以删除项目'); return; }
    const entry = state().projects.find((item) => item.id === id);
    if (!entry) return;
    if (!confirm(`删除项目「${entry.name}」及其全部任务、风险与材料？该操作不可撤销，建议先导出项目包。`)) return;
    store().deleteProject(id);
    window.WB.renderAll();
    window.WB.toast('项目已删除');
  }

  function mount() {
    const panel = $('#projectsPanel');
    const input = $('#projectBundleFile');

    panel.addEventListener('click', (event) => {
      const filter = event.target.closest('[data-project-filter]');
      if (filter) {
        state().ui.projectFilter = filter.dataset.projectFilter;
        store().save();
        render();
        return;
      }
      if (event.target.closest('[data-project-new]')) {
        if (!canManage()) { window.WB.toast('只有活动组织者可以新建项目'); return; }
        store().createProject();
        store().log('project', '新建项目');
        store().save();
        window.WB.renderAll();
        window.WB.openWizard();
        return;
      }
      if (event.target.closest('[data-project-import]')) { input.click(); return; }
      if (event.target.closest('[data-project-export]')) {
        U.downloadText(`${U.safeFileName(store().projectName())}-项目包.json`, JSON.stringify(store().exportBundle(), null, 2), 'application/json;charset=utf-8');
        store().log('export', '导出当前项目包');
        store().save();
        window.WB.toast('当前项目包已导出');
        return;
      }
      const open = event.target.closest('[data-project-open]');
      if (open) { openProject(open.dataset.projectOpen); return; }
      const rename = event.target.closest('[data-project-rename]');
      if (rename) { renameProject(rename.dataset.projectRename); return; }
      const duplicate = event.target.closest('[data-project-duplicate]');
      if (duplicate) { duplicateProject(duplicate.dataset.projectDuplicate); return; }
      const archive = event.target.closest('[data-project-archive]');
      if (archive) { archiveProject(archive.dataset.projectArchive); return; }
      const remove = event.target.closest('[data-project-delete]');
      if (remove) { deleteProject(remove.dataset.projectDelete); }
    });

    input.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const bundle = JSON.parse(await file.text());
        const id = store().importBundle(bundle, { asNew: true });
        window.WB.renderAll();
        window.WB.toast(`已导入为新项目（${store().projects.find((item) => item.id === id)?.name || '未命名活动'}）`);
      } catch (error) {
        window.WB.toast(`导入失败：${error.message}`);
      }
    });
  }

  window.WB.views.projects = { id: 'projects', label: '项目库', render, mount };
}());
