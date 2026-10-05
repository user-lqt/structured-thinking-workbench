/* 编排层：视图路由、本地身份与角色门禁、多项目切换、项目向导、全局事件与启动。 */
window.WB = window.WB || {};

(function () {
  const U = window.WB.util;
  const store = window.WB.store;
  const { $, $$, escapeHtml, BASIC_FIELDS, ROLES } = U;
  const VIEWS = ['projects', 'overview', 'manifest', 'tasks', 'decision', 'risk', 'resources', 'drills', 'material', 'assets', 'signup', 'help'];

  /* 只读放行的控件特征：筛选、分段切换、导出、打开/关闭、下载、跳转都是「看」的动作。
     其余按钮、输入框、下拉框一律视为写入，只读访客会被禁用。 */
  const READONLY_ATTR = /(filter|phase|taskview|export|open|close|toggle|goto|view|download)/i;
  /* 这几个控件只由角色门禁管理，所以在切回可写角色时可以安全地恢复 */
  const ROLE_ONLY = ['editBasic', 'resetBtn', 'wizardSubmit', 'wizardSample', 'wizardSkip'];
  const ROLE_HINT = '当前身份为只读访客，不能修改内容';

  let toastTimer;

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2600);
  }

  window.WB.toast = toast;

  /* ── 角色门禁 ─────────────────────────── */

  function isReadOnlyControl(el) {
    if (el.closest('.tabs, .seg-switch')) return true;
    if (el.classList.contains('close-wizard')) return true;
    if (el.id && el.id.startsWith('export')) return true;
    /* 显式写入标记优先：属性名里恰好含 phase / view 这类只读动词时用它兜底 */
    if (el.hasAttribute?.('data-write')) return false;
    /* 属性名或属性值命中只读动词都算「只看不改」，例如 data-data="export-bundle" */
    return el.getAttributeNames().some((attr) => {
      if (!attr.startsWith('data-')) return false;
      if (READONLY_ATTR.test(attr.slice(5))) return true;
      return READONLY_ATTR.test(el.getAttribute(attr) || '');
    });
  }

  /* 只读访客：把所有写入控件禁用；组织者与成员不做任何额外处理。 */
  function gateWrites() {
    const canWrite = U.canOperate();
    /* 顶栏与向导是静态 HTML，视图重绘不会重建它们，所以要双向设置 */
    for (const id of ROLE_ONLY) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.disabled = !canWrite;
      if (canWrite) el.removeAttribute('title');
      else el.title = ROLE_HINT;
    }
    if (canWrite) return;
    for (const id of ['aiFillManifest', 'generateMaterials', 'interviewStart']) {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.title = ROLE_HINT; }
    }
    const root = $('.content');
    if (root) {
      for (const el of root.querySelectorAll('input, textarea, select, button')) {
        if (isReadOnlyControl(el)) continue;
        el.disabled = true;
        if (!el.title) el.title = ROLE_HINT;
      }
    }
  }

  window.WB.gateWrites = gateWrites;
  window.WB.isReadOnlyControl = isReadOnlyControl;

  /* 视图内部会直接调用自己的 render 重新出表，这里用观察器兜住这些重绘 */
  function observeContent() {
    const target = $('.content');
    if (!target || !window.MutationObserver) return;
    new MutationObserver(() => gateWrites()).observe(target, { childList: true, subtree: true });
  }

  /* ── 本地身份 ─────────────────────────── */

  function renderLoginRoles() {
    const box = $('#loginRoles');
    if (!box) return;
    box.innerHTML = ROLES.map((role) => `<label class="login-role">
      <input type="radio" name="role" value="${role.value}" ${role.value === 'organizer' ? 'checked' : ''} />
      <span><b>${escapeHtml(role.label)}</b><small>${escapeHtml(role.hint)}</small></span>
    </label>`).join('');
  }

  function openLogin() {
    $('#loginName').value = store.state.user?.name || '';
    $('#loginGate').classList.add('is-open');
    setTimeout(() => $('#loginName')?.focus(), 80);
  }

  function closeLogin() {
    $('#loginGate').classList.remove('is-open');
  }

  window.WB.openLogin = openLogin;

  function submitLogin(event) {
    event.preventDefault();
    const name = U.text($('#loginName').value) || '未命名同学';
    const role = $('input[name="role"]:checked')?.value || 'organizer';
    store.setUser({ name, role });
    closeLogin();
    window.WB.renderIdentity();
    renderAll();
    toast(`已以「${U.roleLabel(role)}」身份进入`);
    if (!store.state.project) openWizard();
  }

  /* ── 顶部状态栏 ───────────────────────── */

  function renderTopbar() {
    const state = store.state;
    const basic = state.project?.basic || {};
    $('#projectName').textContent = basic.name || '未命名活动';
    const meta = [basic.type, basic.date, basic.venue].filter(Boolean).join(' · ');
    const overall = window.WB.wbs.overall(state.wbs);
    const owner = state.projects.length > 1 ? ` · 共 ${state.projects.length} 个项目` : '';
    $('#projectMeta').textContent = state.project
      ? `${meta || '尚未填写活动信息'} · 任务完成度 ${overall.percent}%${owner}`
      : `尚未建立项目信息表${owner}`;
    renderGuideChip();
  }

  /* 顶栏引导按钮：任何时候都告诉你「下一步做什么」，点一下直接过去。
     状态由 core/guide.js 从项目数据推断，与总览的「填写路线图」是同一份判断。 */
  function renderGuideChip() {
    const chip = $('#guideChip');
    if (!chip) return;
    const state = store.state;
    if (!state.project) {
      chip.classList.remove('is-done');
      chip.innerHTML = '<b>引导</b> 先建项目 →';
      chip.dataset.guideTarget = JSON.stringify({ view: 'overview' });
      chip.title = '还没有项目：先在「项目信息表」补上活动类型、名称与日期';
      return;
    }
    const guide = window.WB.guide.progress(state);
    if (!guide.current) {
      chip.classList.add('is-done');
      chip.innerHTML = `<b>引导</b> ${guide.total}/${guide.total} 步已完成 ✓`;
      chip.dataset.guideTarget = JSON.stringify({ view: 'overview' });
      chip.title = '主线走完了：可以去做方案比选、变更演练或归档导出';
      return;
    }
    chip.classList.remove('is-done');
    chip.innerHTML = `<b>引导 ${guide.done}/${guide.total}</b>下一步：${escapeHtml(guide.current.title)}<span>→</span>`;
    chip.dataset.guideTarget = JSON.stringify(guide.current.target);
    chip.title = `${guide.current.why}（点一下直接过去）`;
  }

  function renderIdentity() {
    const state = store.state;
    const user = state.user;
    const chip = $('#userChip');
    if (chip) {
      chip.textContent = user ? `${user.name} · ${U.roleLabel(user.role)}` : '未登录';
      chip.classList.toggle('is-viewer', Boolean(user) && !U.canOperate());
    }
    const select = $('#projectSwitch');
    if (select) {
      const list = state.projects.filter((item) => !item.archived || item.id === state.activeId);
      select.innerHTML = list.length
        ? list.map((item) => `<option value="${item.id}" ${item.id === state.activeId ? 'selected' : ''}>${escapeHtml(item.name || '未命名活动')}</option>`).join('')
        : '<option value="">（暂无项目）</option>';
      select.disabled = list.length < 2;
    }
    const menu = $('#userMenu');
    if (menu && !menu.classList.contains('hidden')) renderUserMenu();
  }

  window.WB.renderIdentity = renderIdentity;

  function renderUserMenu() {
    const state = store.state;
    const user = state.user;
    $('#userMenu').innerHTML = `
      <div class="user-menu-head">
        <b>${escapeHtml(user?.name || '未登录')}</b>
        <small>${escapeHtml(U.roleLabel())}</small>
      </div>
      <div class="user-menu-body">
        <p class="help-muted">切换演示身份（本地保存，不校验密码）</p>
        ${ROLES.map((role) => `<button class="user-menu-role ${user?.role === role.value ? 'is-active' : ''}" data-user-role="${role.value}">
          <b>${escapeHtml(role.label)}</b><small>${escapeHtml(role.hint)}</small></button>`).join('')}
      </div>
      <div class="user-menu-foot">
        <button class="button button-ghost" data-user-action="projects">项目库</button>
        <button class="button button-ghost danger" data-user-action="signout">退出登录</button>
      </div>`;
  }

  function toggleUserMenu(force) {
    const menu = $('#userMenu');
    if (!menu) return;
    const open = force ?? menu.classList.contains('hidden');
    if (open) renderUserMenu();
    menu.classList.toggle('hidden', !open);
  }

  function setAiStatus(kind, label) {
    const el = $('#aiStatus');
    if (!el) return;
    el.className = `ai-status ${kind ? `is-${kind}` : ''}`;
    el.innerHTML = `<i></i>${escapeHtml(label)}`;
  }

  window.WB.onAiStatus = setAiStatus;

  function updateAiButtons() {
    const state = store.state;
    const disabled = !state.project || window.WB.ai.busy || !U.canOperate();
    for (const id of ['aiFillManifest', 'generateMaterials']) {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    }
    window.WB.views.tasks.render();
    window.WB.views.risk.render();
    window.WB.views.resources.render();
    window.WB.views.drills.render();
    gateWrites();
  }

  window.WB.updateAiButtons = updateAiButtons;

  /* ── 视图路由 ─────────────────────────── */

  function renderTabs() {
    const state = store.state;
    const counts = {
      projects: state.projects.length,
      tasks: state.wbs.length,
      risk: state.risks.length,
      resources: state.resources.length,
      drills: state.drills.length,
      material: Object.keys(state.materials).length,
      assets: state.assets.length,
      signup: state.signup ? state.signup.records.length : 0
    };
    $('#tabs').innerHTML = VIEWS.map((id) => {
      const view = window.WB.views[id];
      const count = counts[id];
      return `<button class="tab ${state.view === id ? 'is-active' : ''}" data-view="${id}">
        ${escapeHtml(view.label)}${count ? `<span class="nav-count">${count}</span>` : ''}
      </button>`;
    }).join('');
  }

  function renderAll() {
    const state = store.state;
    /* 门禁自动打勾：生成材料、登记资源、写完比选结论等数据一变，检查点就同步 */
    if (window.WB.wbs.autoTick(state)) store.save();
    renderTopbar();
    renderIdentity();
    renderTabs();
    for (const id of VIEWS) {
      const panel = document.getElementById(`${id}Panel`);
      if (!panel) continue;
      const active = state.view === id;
      panel.classList.toggle('hidden', !active);
      if (!active) continue;
      // 单个视图渲染失败不应连累其它视图，这里做隔离并留下可诊断的痕迹。
      try {
        window.WB.views[id].render();
      } catch (error) {
        console.error(`[工作台] 视图「${id}」渲染失败`, error);
        toast(`「${window.WB.views[id].label}」渲染出错：${error.message}`);
      }
    }
    gateWrites();
  }

  window.WB.renderAll = renderAll;
  window.WB.renderTopbar = renderTopbar;
  window.WB.renderPanelsMeta = renderTabs;

  function switchView(id) {
    if (!window.WB.views[id]) return;
    store.state.view = id;
    store.save();
    renderAll();
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.WB.switchView = switchView;

  /* ── 跳转与定位 ─────────────────────────
     总览的待办、阶段块、关键节点、产出缺口都带 data-goto-* 属性，是可点击入口。
     点一下就跳到能处理它的视图，并把该视图过滤到对应阶段、滚动到目标行并高亮，
     省掉用户在长表格里自己翻找的过程。 */
  /* 跳转的唯一入口：把「去哪、看什么」写成目标对象。
     视图里的 data-goto-* 由 jumpFrom 解析后调用它，顶栏的引导按钮直接用目标对象调用，
     两条路共用同一份筛选与定位逻辑，不会各写一套。 */
  function gotoTarget(target) {
    const view = target?.view;
    if (!view || !window.WB.views[view]) return false;
    const ui = store.state.ui;
    const phase = target.phase || '';
    const taskView = target.taskView || '';
    if (taskView) ui.taskView = taskView;
    if (phase) {
      if (view === 'tasks') {
        ui.taskPhase = taskView === 'gate' ? 'all' : phase;
        ui.gatePhase = phase;
      }
      if (view === 'material') ui.materialPhase = phase;
      if (view === 'assets') ui.assetPhase = phase;
      if (view === 'resources') ui.resourcePhase = phase;
    }
    if (view === 'material') ui.openMaterial = target.openMaterial || null;
    store.state.view = view;
    store.save();
    renderAll();
    focusLanding(target.row || '');
    return true;
  }

  function jumpFrom(el) {
    return gotoTarget({
      view: el.dataset.gotoView,
      phase: el.dataset.gotoPhase,
      taskView: el.dataset.gotoTaskview,
      openMaterial: el.dataset.gotoOpen,
      row: el.dataset.gotoRow
    });
  }
  /* 落地反馈：滚动到视口中间并闪一下底色，避免用户在长表里自己找目标行 */
  function focusLanding(rowId) {
    if (!rowId) return;
    window.setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${rowId}"]`);
      if (!el || typeof el.scrollIntoView !== 'function') return;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      el.classList.add('is-landing');
      window.setTimeout(() => el.classList.remove('is-landing'), 2000);
    }, 30);
  }

  window.WB.jumpFrom = jumpFrom;
  window.WB.gotoTarget = gotoTarget;

  /* ── 项目向导 ─────────────────────────── */

  function renderWizard() {
    const container = $('#wizardFields');
    container.innerHTML = BASIC_FIELDS.map((field) => {
      const wide = field.type === 'textarea' ? ' wide' : '';
      const hint = field.hint ? `<span class="hint">${escapeHtml(field.hint)}</span>` : '';
      return `<div class="field${wide}">
        <label for="w-${field.key}">${escapeHtml(field.label)}${field.required ? '<span class="req">*</span>' : ''}</label>
        ${window.WB.fieldControl(field, `id="w-${field.key}" name="${field.key}"`)}
        ${hint}
      </div>`;
    }).join('');
  }

  function openWizard() {
    const basic = store.state.project?.basic || {};
    for (const field of BASIC_FIELDS) {
      const el = $(`#w-${field.key}`);
      if (el) el.value = basic[field.key] ?? '';
    }
    $('#wizardTitle').textContent = store.state.project ? '修改活动基本信息' : '先告诉我这次活动的基本信息';
    $('#wizard').classList.add('is-open');
    setTimeout(() => $(`#w-${BASIC_FIELDS[0].key}`)?.focus(), 60);
  }

  function closeWizard() {
    $('#wizard').classList.remove('is-open');
  }

  window.WB.openWizard = openWizard;
  window.WB.closeWizard = closeWizard;

  function submitWizard(event) {
    event.preventDefault();
    if (!U.canOperate()) { toast('只读访客不能修改项目信息'); return; }
    const hadProject = Boolean(store.state.project);
    store.ensureProject();
    const project = store.state.project;
    let changed = 0;
    for (const field of BASIC_FIELDS) {
      const el = $(`#w-${field.key}`);
      if (!el) continue;
      const raw = el.value.trim();
      const value = field.type === 'number' && raw !== '' ? Number(raw.replace(/[^\d.-]/g, '')) : raw;
      const before = project.basic[field.key] ?? '';
      if (String(before) === String(value)) continue;
      project.basic[field.key] = value;
      project.meta.basic[field.key] = 'user';
      changed += 1;
    }
    store.log('project', '更新项目信息');
    store.save();
    closeWizard();
    store.state.view = 'manifest';
    renderAll();
    toast(`已更新 ${changed} 个字段`);
    if (!hadProject && changed) window.WB.autoFillManifest();
  }

  async function autoFillManifest() {
    const state = store.state;
    if (!state.project) return;
    if (!U.canOperate()) { toast('只读访客不能使用 AI 补全'); return; }
    const selected = U.OUTPUT_ITEMS.filter((item) => state.project.outputs[item.key]);
    const data = await window.WB.ai.run('manifest', {
      用户填写的基本信息: state.project.basic,
      已勾选产出: selected.map((item) => item.label),
      要求: '补齐缺失的字段（缺失一律填「待确认」，不要编造），并根据活动类型推荐应该生成的产出（true/false）'
    }, window.WB.ai.manifestContract());
    if (!data) return;
    const filled = window.WB.ai.mergeBasic(state.project, data.basic);
    const added = window.WB.ai.mergeOutputs(state.project, data.outputs);
    state.project.notes = Array.isArray(data.notes) ? data.notes.slice(0, 3).map(String) : [];
    store.log('ai', `AI 补全 ${filled} 个字段，推荐 ${added} 项产出`);
    store.save();
    renderAll();
    toast(`AI 补全 ${filled} 个字段，推荐 ${added} 项产出`);
  }

  window.WB.autoFillManifest = autoFillManifest;

  /* ── 全局事件 ─────────────────────────── */

  function bindGlobal() {
    $('#tabs').addEventListener('click', (event) => {
      const tab = event.target.closest('.tab');
      if (tab) switchView(tab.dataset.view);
    });

    /* 顶栏引导：目标由 renderGuideChip 写进 data 属性，点一下走统一跳转 */
    $('#guideChip')?.addEventListener('click', () => {
      const chip = $('#guideChip');
      let target = null;
      try { target = JSON.parse(chip.dataset.guideTarget || 'null'); } catch (error) { target = null; }
      if (!target || !gotoTarget(target)) switchView('overview');
    });

    $('#loginForm').addEventListener('submit', submitLogin);
    $('#wizardForm').addEventListener('submit', submitWizard);
    $('#wizardSkip').addEventListener('click', () => {
      if (!U.canOperate()) { toast('只读访客不能新建项目'); return; }
      store.ensureProject();
      store.save();
      closeWizard();
      renderAll();
    });
    $('#wizardSample').addEventListener('click', async () => {
      await window.WB.views.help.loadSample();
      closeWizard();
    });
    $$('.close-wizard').forEach((el) => el.addEventListener('click', closeWizard));

    $('#editBasic').addEventListener('click', () => {
      if (!U.canOperate()) { toast('只读访客不能修改项目信息'); return; }
      openWizard();
    });
    $('#resetBtn').addEventListener('click', () => {
      if (!U.canOperate()) { toast('只读访客不能重置项目'); return; }
      if (!confirm('将清空当前项目、任务、风险与材料，确定重新开始？建议先导出项目包。')) return;
      store.reset();
      renderAll();
      openWizard();
    });
    $('#aiFillManifest').addEventListener('click', autoFillManifest);
    $('#generateMaterials').addEventListener('click', () => window.WB.views.material.generateAll());

    $('#projectSwitch').addEventListener('change', (event) => {
      const id = event.target.value;
      if (!id || id === store.state.activeId) return;
      if (store.switchProject(id)) {
        renderAll();
        toast(`已切换到「${store.projectName()}」`);
      }
    });

    $('#userChip').addEventListener('click', (event) => {
      event.stopPropagation();
      toggleUserMenu();
    });

    document.addEventListener('click', (event) => {
      const menu = $('#userMenu');
      if (!menu || menu.classList.contains('hidden')) return;
      const role = event.target.closest('[data-user-role]');
      if (role) {
        store.setUser({ name: store.state.user?.name || '未命名同学', role: role.dataset.userRole });
        renderAll();
        toast(`已切换为「${U.roleLabel(role.dataset.userRole)}」`);
        return;
      }
      const action = event.target.closest('[data-user-action]')?.dataset.userAction;
      if (action === 'projects') { toggleUserMenu(false); switchView('projects'); return; }
      if (action === 'signout') {
        toggleUserMenu(false);
        store.signOut();
        renderAll();
        openLogin();
        return;
      }
      if (!event.target.closest('#userMenu, #userChip')) toggleUserMenu(false);
    });

    /* 跨视图跳转：任何带 data-goto-view 的元素点一下都走同一条通道 */
    document.addEventListener('click', (event) => {
      const jump = event.target.closest('[data-goto-view]');
      if (jump) jumpFrom(jump);
    });

    $('#exportManifestJson').addEventListener('click', () => {
      if (!store.state.project) return;
      U.downloadText(`${U.safeFileName(store.projectName())}-项目信息表.json`, JSON.stringify(store.state.project, null, 2), 'application/json;charset=utf-8');
    });
    $('#exportManifestMd').addEventListener('click', () => {
      if (!store.state.project) return;
      U.downloadText(`${U.safeFileName(store.projectName())}-项目信息表.md`, window.WB.exporters.manifestToMarkdown());
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('#wizard').classList.contains('is-open')) closeWizard();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        store.save();
        toast('已保存到本机浏览器');
      }
    });
  }

  /* ── 启动 ─────────────────────────────── */

  async function init() {
    const menu = document.createElement('div');
    menu.id = 'userMenu';
    menu.className = 'user-menu hidden';
    document.body.appendChild(menu);

    renderWizard();
    renderLoginRoles();
    bindGlobal();
    for (const id of VIEWS) window.WB.views[id].mount?.();
    observeContent();
    renderAll();
    if (!store.state.user) openLogin();
    else if (!store.state.project) openWizard();
    window.WB.ai.healthPromise = window.WB.ai.check();
    await window.WB.ai.loadSkills();
    renderAll();
  }

  init();
}());
