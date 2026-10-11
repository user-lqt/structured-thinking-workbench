/* Authenticated personnel portal, shared by the resource view and staff.html. */
window.WB = window.WB || {};
(function () {
  const key = 'demo2-staff-session';
  let token = '', account = null, projects = [], data = null, selected = '', pending = false, message = '', mounted = false, dirty = false;
  const detailStates = new Map(), reportDrafts = new Map();
  const reportKey = (id) => JSON.stringify([account?.id, selectedId(), id]);
  let renderedScope = '';
  let assignmentScope = '', assignmentTask = '';
  try { token = localStorage.getItem(key) || ''; } catch {}
  const el = () => document.querySelector('#personnelPanel');
  const standalone = () => el()?.dataset.standalone === 'true';
  const assignmentEl = () => document.querySelector('#taskAssignmentPanel');
  const hosts = () => [el(), assignmentEl()].filter(Boolean);
  const controls = (selector) => hosts().flatMap((host) => Array.from(host.querySelectorAll(selector)));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const role = (r) => ({ organizer: '组织者', manager: '现场管理者', volunteer: '志愿者' }[r] || r);
  const status = (s) => ({ pending: '待确认', active: '已加入', inactive: '已停用', assigned: '待接受班次', accepted: '已接受班次', done: '班次已结束', cancelled: '班次已取消' }[s] || s);
  const dt = (v) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—';
  const duration = (v) => `${Math.floor(v / 3600000)} 小时 ${Math.floor(v / 60000) % 60} 分钟`;
  const selectedId = () => standalone() ? selected : window.WB.store?.state.activeId || '';
  const requestId = () => crypto.randomUUID();
  function changed() { window.dispatchEvent(new CustomEvent('personnel-session', { detail: { account } })); }
  async function api(path, body) {
    const requestToken = token;
    const response = await fetch(`/api/personnel${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Staff-Session': requestToken }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401 && path !== '/login' && requestToken === token) { token = ''; account = null; data = null; localStorage.removeItem(key); changed(); } const error = response.status === 404 && result.error === 'API 路径不存在。' ? '当前后端尚未加载账号接口。请运行 start.bat 重新启动服务，再刷新页面。' : result.error || '人员服务不可用'; throw Object.assign(new Error(error), { status: response.status }); }
    return result;
  }
  async function authenticate(value) {
    const result = await api(`/${value.mode || 'login'}`, value);
    token = result.token; account = result.account; projects = []; data = null; dirty = false;
    localStorage.setItem(key, token); projects = (await api('/me')).projects; changed(); return account;
  }
  async function restore() {
    if (!token) return null;
    const sessionToken = token, result = await api('/me'); if (sessionToken !== token) return account; account = result.account; projects = result.projects; return account;
  }
  async function saveProfile(profile) {
    const result = await api('/profile', { profile }); account = result.account; changed(); return account;
  }
  async function logout() {
    if (token) await api('/logout', {});
    token = ''; account = null; data = null; projects = []; dirty = false; localStorage.removeItem(key); changed(); render();
  }
  async function enterWorkbench() {
    if (!account || !window.WB.store?.state.project || window.WB.sync?.role === 'viewer') return;
    const id = selectedId(), sessionToken = token;
    await window.WB.sync.prepare();
    if (id !== selectedId() || token !== sessionToken) return;
    const result = window.WB.sync.ownerToken && !projects.some((p) => p.id === id)
      ? await api('/projects', { projectId: id, ownerToken: window.WB.sync.ownerToken })
      : await api(`/projects/${id}/enter`, { accessToken: window.WB.sync.accessToken });
    if (id !== selectedId() || token !== sessionToken) return;
    data = result; projects = (await api('/me')).projects; dirty = false; message = '已将本人资料自动登记到项目名册'; render();
    return result;
  }
  async function openPortalProject(id, code = '') {
    if (!account) { window.WB.openLogin?.(); return; }
    await api(`/projects/${encodeURIComponent(id)}/enter`, { code });
    location.href = `./staff.html?project=${encodeURIComponent(id)}`;
  }
  function fields(profile = {}, omitName = false) {
    return `<div class="staff-fields">${[['name', '姓名', 'text'], ['phone', '联系方式', 'tel'], ['department', '学院 / 部门', 'text'], ['skills', '技能 / 擅长岗位', 'text'], ['availability', '可服务日期和时段', 'text']].filter(([key]) => !omitName || key !== 'name').map(([k, name, type]) => `<label>${name}<input name="${k}" type="${type}" maxlength="${k === 'skills' || k === 'availability' ? 500 : 120}" value="${esc(profile[k] || (k === 'name' ? account?.name : ''))}"${k === 'name' ? ' required' : ''} /></label>`).join('')}</div>`;
  }
  function formValues(form) { return Object.fromEntries(new FormData(form)); }
  function authHtml() {
    if (!standalone()) return '<div class="card staff-pad"><p>请先登录账号，再打开项目。个人资料会自动登记到本项目。</p><button class="button button-primary" data-duty-login data-personnel-control>登录账号</button></div>';
    return `<div class="card"><div class="card-title"><h3>服务人员账号</h3><small>与本地演示身份分开；一个账号可以加入多个项目</small></div><form data-personnel-form="auth" class="staff-form" data-personnel-control>
      <div class="staff-fields"><label>操作<select name="mode"><option value="login">登录已有账号</option><option value="register">注册新账号</option></select></label><label>账号<input name="username" required minlength="3" maxlength="60" pattern="[A-Za-z0-9_.-]+" autocomplete="username" placeholder="字母、数字或 _.-" /></label><label>密码<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="current-password" /></label><label>姓名（注册时填写）<input name="name" maxlength="60" /></label></div>
      <button class="button button-primary">登录 / 注册</button><a class="button button-ghost" href="./staff.html" target="_blank" rel="noreferrer">独立打开“我的任务”</a>
      <details data-personnel-detail="register-profile"><summary>注册时填写个人资料（打开项目后自动登记）</summary>${fields({}, true)}</details>
    </form></div>`;
  }
  function mineHtml() {
    if (!data) return '';
    const me = data.me, shifts = data.shifts.filter((s) => s.personId === me.id);
    const totals = shifts.reduce((a, s) => { a.completed += s.attendance.completedMs; a.live += s.attendance.liveMs; return a; }, { completed: 0, live: 0 });
    return `<div class="card"><div class="card-title"><h3>我的服务资料 · ${esc(role(me.role))}</h3><small>${esc(status(me.status))} · 加入 ${esc(dt(me.joinedAt))}</small></div>
      <details class="staff-profile" data-personnel-detail="project-profile"><summary>查看 / 修改基本信息</summary><form data-personnel-form="profile" data-personnel-control class="staff-form">${fields(me)}<button class="button button-ghost">保存本人资料</button></form></details>
      <p class="staff-note">已确认服务工时 ${duration(totals.completed)}；当前在场 ${duration(totals.live)}。未签退时段单列，不计入已确认工时。</p>
      <div class="staff-shift-list">${shifts.map((s) => shiftCard(s, true)).join('') || '<p class="staff-note">暂未分配班次，负责人确认加入后会安排任务。</p>'}</div></div>`;
  }
  function shiftCard(s, mine) {
    const person = data.people.find((p) => p.id === s.personId);
    const task = tasks().find((t) => t.id === s.taskId), Task = window.WB.taskLifecycle;
    const lifecycle = task?.lifecycle ? Task.replay(task) : s.taskState;
    const taskLabel = lifecycle ? `${Task.labels[lifecycle.status] || '待核实'}${lifecycle.needsVerification ? ' · 待核实' : ''}${lifecycle.blocked ? ` · 受阻：${lifecycle.blockReason || '旧记录缺少原因'}` : ''}` : '关联任务已移除';
    const ended = ['done', 'cancelled'].includes(s.status), active = (person || data.me).status === 'active';
    return `<article class="staff-shift"><div class="staff-shift-head"><strong>${esc(s.title)}</strong><span>${esc(status(s.status))} · ${s.attendance.present ? '在场' : '不在场'}</span></div>
      <p>人员：${esc(person?.name)} · 关联任务：${esc(task?.name || s.taskName)}</p><p data-duty-task-state>任务状态：${esc(taskLabel)}</p><p>计划班次：${esc(dt(s.start))} → ${esc(dt(s.end))}</p><p>地点：${esc(s.location || '待确认')} · 技能要求：${esc(s.requiredSkills || '未指定')}</p>
      <p>${esc(s.instructions || '请按岗位安排执行，遇到问题联系负责人。')}</p>
      <p>资源：${esc(s.resources.map((r) => `${r.name} ${r.quantity} ${r.unit}`).join('、') || '未预留')}</p>
      <p>确认工时 ${duration(s.attendance.completedMs)} · 当前在场 ${duration(s.attendance.liveMs)}</p>
      ${!ended || s.status === 'done' && !s.reports?.length ? `<form data-personnel-form="report:${esc(s.id)}" data-personnel-control><label>班次执行报告（结束前填写）<textarea name="report" maxlength="4000" rows="2" placeholder="完成事项、交付情况、交接与遗留问题"></textarea></label></form>` : ''}
      <p>接受情况：${s.acceptance ? `${esc(s.acceptance.actor)} · ${esc(dt(s.acceptance.at))}（${esc(s.acceptance.by)}）` : s.status === 'assigned' ? '尚未接受' : '旧记录缺少接受时间，待补充'}</p>
      ${(s.reports || []).map((r) => `<p class="staff-note">执行报告 · ${esc(r.actor)} · ${esc(dt(r.at))}<br />${esc(r.text)}</p>`).join('')}${s.status === 'done' && !s.reports?.length ? '<p class="task-warning">旧班次缺少执行报告，待补充；不代表任务已验收。</p>' : ''}
      <div class="panel-actions" data-personnel-control>${mine || person?.sample ? `<button class="button button-ghost" data-duty-event="accept" data-shift="${s.id}"${ended || !active ? ' disabled' : ''}>${person?.sample ? '模拟接受' : '接受班次'}</button>` : ''}
        <button class="button button-primary" data-duty-event="${s.attendance.present ? 'checkout' : 'checkin'}" data-shift="${s.id}"${!s.attendance.present && (ended || !active) ? ' disabled' : ''}>${person?.sample ? '模拟' : mine ? '' : '代'}${s.attendance.present ? '签退' : '签到'}</button>
        <button class="button button-ghost" data-duty-event="done" data-shift="${s.id}"${s.status === 'cancelled' || s.status === 'done' && s.reports?.length || s.attendance.present ? ' disabled' : ''}>${s.status === 'done' ? '补充执行报告' : '结束班次'}</button>
        ${data.manager ? `<button class="button button-ghost" data-duty-cancel="${s.id}"${ended || s.attendance.present ? ' disabled' : ''}>取消班次</button>` : ''}</div>
      <details data-personnel-detail="shift:${mine ? 'mine' : 'all'}:${esc(s.id)}"><summary>打卡流水 ${s.events.length} 条</summary>${s.events.map((e) => `<p>${esc(dt(e.at))} · ${e.kind === 'checkin' ? '签到' : '签退'} · ${esc(e.actor)}（${esc(e.by)}）</p>`).join('') || '尚无打卡'}</details>
    </article>`;
  }
  function tasks() {
    return standalone() ? data?.tasks || [] : (window.WB.store?.state.wbs || []).map((t) => ({ ...t, name: t.task }));
  }
  function taskShifts(id) { return data?.id === selectedId() ? data.shifts.filter((s) => s.taskId === id && s.status !== 'cancelled') : []; }
  function taskCell(id) {
    const shifts = taskShifts(id), names = [...new Set(shifts.map((s) => s.personId))].map((personId) => data.people.find((p) => p.id === personId)?.name || '未命名人员');
    const canAssign = !pending && data?.id === selectedId() && data?.manager && window.WB.sync?.role !== 'viewer';
    return `<span class="task-assignment-summary">${shifts.length ? `${esc(names.join('、'))}<br /><small>${names.length} 人 · ${shifts.length} 班</small>` : '<small>尚未安排服务班次</small>'}</span><button type="button" class="button button-ghost" data-task-assign="${esc(id)}"${canAssign ? '' : ' disabled'} title="${canAssign ? '为此任务安排已确认人员和班次' : '登录项目负责人或现场管理者账号后安排'}">安排人员</button><button type="button" class="button button-ghost" data-task-details-open="${esc(id)}">查看任务 / 提交与验收</button>`;
  }
  function updateTaskCells() {
    document.querySelectorAll('[data-task-assignment]').forEach((cell) => { cell.innerHTML = taskCell(cell.dataset.taskAssignment); });
  }
  function sampleControls() {
    const count = data.people.filter((p) => p.sample).length;
    const disabled = pending || window.WB.sync?.role === 'viewer' ? ' disabled' : '';
    return `<div class="staff-sample-controls"><span>课堂示例：${count} 名示例人员 · 仅演示，无登录账号</span><button type="button" class="button button-ghost" data-duty-samples="load"${disabled}>载入 10 名示例人员</button>${count ? `<button type="button" class="button button-quiet" data-duty-samples="remove-unused"${disabled}>移除未排班示例人员</button>` : ''}</div>`;
  }
  const selectedPeople = (form) => Array.from(form.querySelectorAll('[name="personIds"]:checked')).map((input) => input.value);
  function personPicker() {
    return `<fieldset class="staff-people-picker" data-assignee-picker${assignmentTask ? '' : ' disabled'}><legend>② 安排服务人员（可多选）</legend><div class="staff-people-tools"><span data-selection-count>已选 0 人</span><button type="button" class="button button-quiet" data-assignees-all>全选</button><button type="button" class="button button-quiet" data-assignees-clear>清空选择</button></div><div class="staff-people-grid">${data.people.filter((p) => p.status === 'active').map((p) => `<label class="staff-person-choice"><input type="checkbox" name="personIds" value="${esc(p.id)}" /><span><strong>${esc(p.name)}</strong><small>${esc(p.skills || '未登记技能')} · ${p.sample ? '示例人员' : esc(role(p.role))}</small></span></label>`).join('') || '<p class="staff-note">暂无已确认人员，可先载入示例人员演示。</p>'}</div></fieldset>`;
  }
  function assignmentHtml() {
    if (!data?.manager || (!standalone() && window.WB.sync?.role === 'viewer')) return '<div class="card staff-pad"><p class="staff-note">项目负责人或现场管理者登录后，可从任务行安排已确认的服务人员。成员在“我的任务”查看本人安排。</p></div>';
    const taskList = tasks().filter((t) => t.name);
    if (!taskList.some((t) => t.id === assignmentTask)) assignmentTask = '';
    const selectedTask = taskList.find((t) => t.id === assignmentTask);
    return `<div class="card task-assignment-card"><div class="card-title"><h3>为任务安排人员与班次</h3><small>先选任务，再安排人员；同一任务可分配多人和多个班次</small></div>
      <p class="staff-message staff-pad" role="status">${esc(message)}</p>${sampleControls()}<div data-assignment-execution></div>
      <form data-personnel-form="shift" data-personnel-control class="staff-form">
      <div class="staff-fields"><label>① 选择任务<select name="taskId" required><option value="">从任务表点击“安排人员”，或在此选择</option>${taskList.map((t) => `<option value="${esc(t.id)}"${t.id === assignmentTask ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      </div>${personPicker()}
      <div class="task-assignment-body${selectedTask ? '' : ' hidden'}" data-assignment-body><div class="task-assignment-context" data-assignment-task-info></div><div class="staff-note" data-assignee-info>选择人员后查看技能、可服务时段和已有班次。</div>
      <div class="staff-fields"><label>③ 岗位 / 班次名称<input name="title" maxlength="120" value="${esc(selectedTask?.name || '')}" /></label><label>地点<input name="location" maxlength="120" /></label><label>开始<input name="start" type="datetime-local" required /></label><label>结束<input name="end" type="datetime-local" required /></label><label>必要技能（逗号分隔）<input name="requiredSkills" maxlength="120" /></label></div>
      <label>执行要求<textarea name="instructions" maxlength="2000" rows="3"></textarea></label>
      <details data-personnel-detail="shift-resources"><summary>为班次预留物资 / 资源（填写每人数量）</summary><div class="staff-fields">${data.resources.filter((r) => r.kind !== 'staff').map((r) => `<label>${esc(r.name)} · 净可用 ${Math.max(0, Number(r.available) - Number(r.loaned || 0))} ${esc(r.unit)}<input type="number" min="0" step="any" name="resource:${esc(r.id)}" value="0" /><small data-resource-total="${esc(r.id)}">共预留 0 ${esc(r.unit)}</small></label>`).join('') || '先在“物资与资源”登记库存。'}</div></details>
      <p class="staff-note">一次为所有勾选人员分别创建相同时间、地点及要求的班次，真实成员在“我的任务”查看本人安排。物资按每人数量 × 所选人数预留；任一人员或资源校验失败时整组不保存。可服务时间由负责人核对。班次结束后，关联任务仍需提交交付依据并由组织者验收。</p>
      <button type="submit" class="button button-primary"${taskList.length && data.people.some((p) => p.status === 'active') ? '' : ' disabled'}>保存人员与班次安排</button>
      <div class="task-assignment-existing" data-assignment-existing></div></div></form></div>`;
  }
  function updateAssignmentContext(form) {
    const task = tasks().find((t) => t.id === form.elements.taskId.value), shifts = taskShifts(task?.id);
    form.querySelector('[data-assignment-body]').classList.toggle('hidden', !task);
    form.querySelector("[data-assignee-picker]").disabled = !task;
    form.querySelector('[data-assignment-task-info]').textContent = task ? `任务：${task.name} · 负责角色：${task.owner || '待明确'}${task.output ? ` · 交付：${task.output}` : ''}` : '请先明确要完成的任务，再安排人员和轮班。';
    form.querySelector('[data-assignment-existing]').innerHTML = task ? `<h4>该任务已有安排 · ${shifts.length} 班</h4>${shifts.map((s) => `<p>${esc(data.people.find((p) => p.id === s.personId)?.name)} · ${esc(s.title)} · ${esc(dt(s.start))} → ${esc(dt(s.end))} · ${esc(status(s.status))}</p>`).join('') || '<p>尚未安排人员。保存后可继续为本任务安排其他人员或班次。</p>'}` : '';
    const selected = selectedPeople(form), people = data.people.filter((p) => selected.includes(p.id));
    form.querySelector('[data-selection-count]').textContent = task ? `已选 ${selected.length} 人 · 为每人创建独立班次` : '请先选择任务';
    form.querySelector('[data-assignee-info]').innerHTML = people.length ? people.map((person) => `<p><b>${esc(person.name)}</b> · 技能：${esc(person.skills || '未登记')} · 可服务时间：${esc(person.availability || '未登记，请先核对')} · 已有 ${data.shifts.filter((s) => s.personId === person.id && !['cancelled', 'done'].includes(s.status)).length} 个未结束班次</p>`).join('') : '勾选一名或多名人员，查看技能、可服务时段和已有班次。';
    form.querySelectorAll('[data-resource-total]').forEach((element) => { const resource = data.resources.find((r) => r.id === element.dataset.resourceTotal), input = form.elements[`resource:${resource.id}`]; element.textContent = `共预留 ${Math.max(0, Number(input.value) || 0) * selected.length} ${resource.unit}（${selected.length} 人）`; });
    updateExecutionContext(form);
  }
  function updateExecutionContext(form) {
    const task = tasks().find((t) => t.id === form.elements.taskId.value), host = form.closest('.task-assignment-card').querySelector('[data-assignment-execution]');
    if (host) host.innerHTML = task && !standalone() ? window.WB.views.tasks.executionHtml(task) : '';
  }
  function openTaskAssignment(id) {
    if (pending) return;
    if (!data?.manager || data.id !== selectedId() || window.WB.sync?.role === 'viewer') { window.WB.toast?.('请登录项目负责人或现场管理者账号后安排人员'); return; }
    if (dirty && assignmentTask !== id) { window.WB.toast?.('请先保存当前未提交的表单，再切换安排的任务'); return; }
    assignmentTask = id;
    window.WB.gotoTarget?.({ view: 'tasks', taskView: 'table' });
    assignmentEl()?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    assignmentEl()?.querySelector('[name="personIds"]')?.focus({ preventScroll: true });
  }
  function managerHtml() {
    if (!data?.manager) return '';
    return `<div class="card"><div class="card-title"><h3>服务人员名册</h3><small>真实人员 ${data.people.filter((p) => !p.sample).length} 人 · 示例人员 ${data.people.filter((p) => p.sample).length} 人</small></div>
      <p class="staff-note">加入码：<b>${esc(data.joinCode)}</b> · ${data.open ? '开放加入' : '关闭加入'} · 服务入口 <a href="./staff.html" target="_blank" rel="noreferrer">我的任务</a></p>
      <div class="panel-actions staff-pad" data-personnel-control><button class="button button-ghost" data-duty-setting="open">${data.open ? '关闭加入' : '开放加入'}</button><button class="button button-ghost" data-duty-setting="rotate">重置加入码</button><button class="button button-ghost" data-duty-export>导出人员 / 班次 / 考勤 JSON</button></div>
      ${sampleControls()}<div class="table-scroll"><table class="matrix staff-table"><thead><tr><th>姓名 / 账号</th><th>身份 / 状态</th><th>联系方式</th><th>学院 / 部门</th><th>技能</th><th>可服务时间</th><th>班次 / 工时</th><th>管理</th></tr></thead><tbody>${data.people.map((p) => {
        const shifts = data.shifts.filter((s) => s.personId === p.id), ms = shifts.reduce((sum, s) => sum + s.attendance.completedMs, 0);
        return `<tr><td>${esc(p.name)}<br /><small>${p.sample ? '示例人员 · 无登录账号' : esc(p.username)}</small></td><td>${esc(role(p.role))}<br />${esc(status(p.status))}</td><td>${esc(p.phone)}</td><td>${esc(p.department)}</td><td>${esc(p.skills)}</td><td>${esc(p.availability)}</td><td>${shifts.filter((s) => s.status !== 'cancelled').length} 班<br />${duration(ms)}</td><td data-personnel-control>${p.role !== 'organizer' ? `<button class="button button-ghost" data-duty-person="${p.id}" data-person-status="${p.status === 'active' ? 'inactive' : 'active'}">${p.status === 'active' ? '停用' : '确认加入'}</button>${data.me.role === 'organizer' && !p.sample ? `<button class="button button-ghost" data-duty-person="${p.id}" data-person-role="${p.role === 'manager' ? 'volunteer' : 'manager'}">${p.role === 'manager' ? '取消管理授权' : '授权管理者'}</button>` : ''}` : '项目原负责人'}</td></tr>`;
      }).join('')}</tbody></table></div></div>
      ${standalone() ? assignmentHtml() : '<div class="card staff-pad"><h3>任务与人员安排</h3><p class="staff-note">从全周期任务选择任务，再安排已确认的服务人员、班次和执行要求；这里查看名册与考勤。</p><button class="button button-primary" data-goto-view="tasks" data-goto-taskview="table">前往任务安排人员</button></div>'}
      <details class="card staff-pad" data-personnel-detail="all-shifts"><summary>全部班次与考勤 · ${data.shifts.length} 班</summary><div class="staff-shift-list">${data.shifts.map((s) => shiftCard(s, false)).join('')}</div></details>
      <details class="card staff-pad" data-personnel-detail="management-log"><summary>管理操作记录</summary>${data.log.slice(0, 60).map((e) => `<p>${esc(dt(e.at))} · ${esc(e.actor)} · ${esc(e.detail)}</p>`).join('')}</details>`;
  }
  function render() {
    const host = el(); if (!host) return;
    const scope = JSON.stringify([account?.id || '', selectedId()]);
    updateTaskCells();
    if (dirty && renderedScope === scope && host.children.length) { controls('[data-personnel-form="shift"]').forEach(updateExecutionContext); return; }
    dirty = false;
    const id = selectedId();
    // Record the old DOM under its original account/project before changing context.
    if (renderedScope) {
      const previous = detailStates.get(renderedScope);
      controls('details[data-personnel-detail]').forEach((detail) => previous.set(detail.dataset.personnelDetail, detail.open));
    }
    renderedScope = scope;
    if (assignmentScope !== scope) { assignmentScope = scope; assignmentTask = ''; }
    if (!detailStates.has(renderedScope)) detailStates.set(renderedScope, new Map());
    if (data?.id !== id) data = null;
    const header = `<div class="staff-banner"><h3>服务人员、轮班与考勤</h3><p>打开项目后，账号资料自动登记到人员名册；新成员确认后从任务页安排班次。服务班次与参与者考勤分别记录。</p></div>`;
    host.innerHTML = header + `<p class="staff-message" role="status">${esc(message)}</p>` + (!account ? authHtml() : `
      <div class="staff-account" data-personnel-control><b>${esc(account.name)} · ${esc(account.username)}</b><button class="button button-ghost" data-duty-refresh>刷新</button><button class="button button-ghost" data-duty-logout>退出服务账号</button><a href="./staff.html" target="_blank" rel="noreferrer">独立打开我的任务</a></div>
      ${standalone() ? `<details class="card staff-pad" data-personnel-detail="account-profile"><summary>账号个人资料 · 打开项目时自动登记</summary><form data-personnel-form="account-profile" class="staff-form" data-personnel-control>${fields(account.profile)}<button class="button button-ghost">保存账号资料</button></form></details><label class="staff-project" data-personnel-control>选择并打开项目<select data-duty-project><option value="">请选择</option>${projects.map((p) => `<option value="${p.id}"${id === p.id ? ' selected' : ''}>${esc(p.name)} · ${esc(status(p.membership) || '首次打开需加入码')}</option>`).join('')}</select></label>` : ''}
      ${data ? `<h3>${esc(data.name)}</h3>${mineHtml()}${managerHtml()}` : id ? `<div class="card staff-pad">${standalone() ? `<p>首次打开此项目，请填写加入码。账号中的姓名、联系方式、技能等资料会自动录入项目名册。</p><form data-personnel-form="join" class="staff-form" data-personnel-control><label>项目加入码<input name="code" required /></label><button class="button button-primary">打开并自动登记</button></form>` : '<p>打开项目时自动登记本人资料；如登记未完成，请返回项目库重新打开。</p><button class="button button-primary" data-duty-enter data-personnel-control>重新登记当前项目</button>'}</div>` : '<p class="staff-note">先核对账号资料，再选择项目；首次打开需要负责人提供的加入码。</p>'}`);
    if (assignmentEl()) assignmentEl().innerHTML = assignmentHtml();
    controls('[data-personnel-form="shift"]').forEach(updateAssignmentContext);
    for (const shift of data?.shifts || []) if (shift.status === 'done' && shift.reports?.length) reportDrafts.delete(reportKey(shift.id));
    for (const form of controls('form[data-personnel-form^="report:"]')) form.elements.report.value = reportDrafts.get(reportKey(form.dataset.personnelForm.slice(7))) || '';
    const savedDetails = detailStates.get(renderedScope);
    controls('details[data-personnel-detail]').forEach((detail) => { if (savedDetails.has(detail.dataset.personnelDetail)) detail.open = savedDetails.get(detail.dataset.personnelDetail); });
    if (pending) controls('button,form input,form select,form textarea').forEach((field) => { field.disabled = true; });
  }
  async function refresh({ quiet = false } = {}) {
    if (!token) { render(); return; }
    const id = selectedId(), sessionToken = token;
    try {
      const me = await api('/me'); if (sessionToken !== token) return; account = me.account; projects = me.projects;
      let result = null;
      if (id && projects.some((p) => p.id === id && p.membership)) result = await api(`/projects/${id}`);
      if (id !== selectedId() || sessionToken !== token) return;
      data = result; if (!quiet) message = ''; render(); window.dispatchEvent(new CustomEvent('personnel-refresh'));
    } catch (error) { message = error.message; render(); }
  }
  async function action(fn, { keepDraft = false, successMessage = '操作已保存' } = {}) {
    if (pending) return; pending = true; const origin = selectedId(), wasDirty = dirty;
    updateTaskCells();
    const draft = controls('form input,form select,form textarea').filter((f) => f.type !== 'password').map((f) => ({ form: f.closest('form').dataset.personnelForm, name: f.name, value: f.value, checked: f.checked, type: f.type }));
    let failed = false;
    controls('button,form input,form select,form textarea').forEach((field) => { field.disabled = true; });
    try { const result = await fn(); if (origin === selectedId() && result?.id) data = result; message = typeof successMessage === 'function' ? successMessage(result) : successMessage; window.dispatchEvent(new CustomEvent('personnel-refresh')); }
    catch (error) { message = error.message; failed = true; if (error.status === 409 && origin === selectedId()) await refresh({ quiet: true }); }
    finally { pending = false; dirty = false; render(); if ((failed || keepDraft) && origin === selectedId()) { for (const field of controls('form input,form select,form textarea')) { const saved = draft.find((d) => d.form === field.closest('form').dataset.personnelForm && d.name === field.name && (field.type !== 'checkbox' || d.value === field.value)); if (saved) { if (field.type === 'checkbox') field.checked = saved.checked; else field.value = saved.value; } } controls('[data-personnel-form="shift"]').forEach(updateAssignmentContext); dirty = failed || wasDirty; } }
  }
  function mount() {
    if (mounted || !el() || !window.location?.href) return; mounted = true;
    selected = new URLSearchParams(location.search).get('project') || localStorage.getItem('demo2-staff-project') || '';
    for (const root of hosts()) {
    root.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-personnel-form]'); if (!form) return; event.preventDefault();
      const value = formValues(form), type = form.dataset.personnelForm, id = selectedId(), personIds = type === 'shift' ? selectedPeople(form) : [], revision = data?.revision;
      if (type === 'shift' && window.WB.sync?.role === 'viewer') { window.WB.toast?.('只读邀请不能安排人员'); return; }
      if (type === 'shift' && !personIds.length) { message = '请至少勾选一名服务人员'; form.closest('.card').querySelector('.staff-message').textContent = message; return; }
      await action(async () => {
        if (type === 'auth') { await authenticate({ ...value, workspace: 'volunteer', profile: { ...value, name: value.name } }); selected = ''; localStorage.removeItem('demo2-staff-project'); await refresh(); return; }
        if (type === 'account-profile') { await saveProfile(value); await refresh(); return; }
        if (type === 'publish') { await window.WB.sync.flush(); const result = await api('/projects', { projectId: id, ownerToken: window.WB.sync.ownerToken, profile: value }); projects = (await api('/me')).projects; return result; }
        if (type === 'join') { const result = await api(`/projects/${id}/enter`, { code: value.code }); projects = (await api('/me')).projects; return result; }
        if (type.startsWith('report:')) return api(`/projects/${id}/event`, { shiftId: type.slice(7), kind: 'done', report: value.report, requestId: requestId() });
        if (type === 'profile') return api(`/projects/${id}/profile`, { profile: value });
        if (type === 'shift') {
          if (window.WB.sync?.role && !await window.WB.sync.flush()) throw new Error('项目尚未同步，请完成同步后再安排人员');
          if (id !== selectedId()) throw new Error('项目已切换，本次安排尚未保存');
          return api(`/projects/${id}/shifts`, { ...value, personIds, start: new Date(value.start).toISOString(), end: new Date(value.end).toISOString(), revision, resources: Object.entries(value).filter(([k, v]) => k.startsWith('resource:') && Number(v) > 0).map(([k, v]) => ({ id: k.slice(9), quantity: Number(v) })) });
        }
      }, { successMessage: type === 'shift' ? `已为 ${personIds.length} 名人员分别保存班次` : '操作已保存' });
    });
    root.addEventListener('change', async (event) => {
      const form = event.target.closest('[data-personnel-form="shift"]');
      if (form && ['taskId', 'personIds'].includes(event.target.name)) {
        if (event.target.name === 'taskId') { const previous = tasks().find((t) => t.id === assignmentTask); assignmentTask = event.target.value; form.querySelectorAll('[name=personIds]').forEach((input) => { input.checked = false; }); if (!form.elements.title.value || form.elements.title.value === previous?.name) form.elements.title.value = tasks().find((t) => t.id === assignmentTask)?.name || ''; }
        dirty = true; updateAssignmentContext(form);
      }
      if (event.target.matches('[data-duty-project]')) { selected = event.target.value; localStorage.setItem('demo2-staff-project', selected); data = null; dirty = false; if (projects.some((p) => p.id === selected && p.membership)) await action(() => api(`/projects/${selected}/enter`, {})); else await refresh(); }
    });
    root.addEventListener('input', (event) => {
      if (event.target.closest('form')) dirty = true;
      const assignment = event.target.closest('[data-personnel-form="shift"]'); if (assignment && event.target.name.startsWith('resource:')) updateAssignmentContext(assignment);
      const form = event.target.closest('form[data-personnel-form^="report:"]');
      if (form) reportDrafts.set(reportKey(form.dataset.personnelForm.slice(7)), event.target.value);
    });
    root.addEventListener('click', async (event) => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.hasAttribute('data-assignees-all') || target.hasAttribute('data-assignees-clear')) {
        const form = target.closest('form'); if (!form || pending || !form.elements.taskId.value) return;
        form.querySelectorAll('[name=personIds]').forEach((input) => { input.checked = target.hasAttribute('data-assignees-all'); }); dirty = true; updateAssignmentContext(form); return;
      }
      if (target.dataset.dutySamples) {
        if (window.WB.sync?.role === 'viewer') { window.WB.toast?.('只读邀请不能修改示例人员'); return; }
        await action(() => api(`/projects/${selectedId()}/samples`, { mode: target.dataset.dutySamples, revision: data.revision }), { keepDraft: true, successMessage: (result) => target.dataset.dutySamples === 'load' ? `示例人员已就绪，共 ${result.people.filter((p) => p.sample).length} 名；勾选后可演示多人排班` : '已移除未排班示例人员，已有班次及报告继续保留' }); return;
      }
      if (target.hasAttribute('data-duty-login')) { window.WB.openLogin?.(); return; }
      if (target.hasAttribute('data-duty-enter')) { await action(enterWorkbench); return; }
      if (target.hasAttribute('data-duty-refresh')) { if (dirty && !confirm('刷新将丢弃未提交的表单内容，继续？')) return; dirty = false; await refresh(); return; }
      if (target.hasAttribute('data-duty-logout')) { await action(logout); return; }
      if (target.hasAttribute('data-duty-export')) {
        const blob = new Blob([JSON.stringify({ format: 'demo2-personnel-archive', exportedAt: new Date().toISOString(), project: data }, null, 2)], { type: 'application/json' });
        const link = document.createElement('a'), url = URL.createObjectURL(blob); link.href = url; link.download = '服务人员-任务班次与考勤.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      const id = selectedId();
      if (target.dataset.dutyEvent) await action(() => api(`/projects/${id}/event`, { shiftId: target.dataset.shift, kind: target.dataset.dutyEvent, report: target.closest('.staff-shift').querySelector('[name="report"]')?.value || '', requestId: requestId() }));
      if (target.dataset.dutyPerson) await action(() => api(`/projects/${id}/people`, { personId: target.dataset.dutyPerson, ...(target.dataset.personStatus ? { status: target.dataset.personStatus } : { role: target.dataset.personRole }) }));
      if (target.dataset.dutyCancel && confirm('取消此班次并释放计划资源？已有考勤流水会保留。')) await action(() => api(`/projects/${id}/shifts`, { id: target.dataset.dutyCancel, cancel: true, revision: data.revision }));
      if (target.dataset.dutySetting) await action(() => api(`/projects/${id}/settings`, target.dataset.dutySetting === 'rotate' ? { rotate: true } : { open: !data.open }));
    });
    }
    window.addEventListener('storage', async (event) => { if (event.key === key) { token = event.newValue || ''; account = null; data = null; dirty = false; try { await restore(); } catch {} changed(); refresh(); } });
    render(); refresh();
    setInterval(() => { if (!pending && !dirty && hosts().some((host) => !host.closest('.hidden')) && !document.activeElement?.matches('input,textarea,select')) refresh({ quiet: true }); }, 4000);
  }
  window.WB.personnel = { mount, render, refresh, authenticate, restore, saveProfile, logout, enterWorkbench, openPortalProject, openTaskAssignment, taskCell, fields, get sessionToken() { return token; }, get account() { return account; }, get catalogue() { return projects; }, get snapshot() { return data; } };
}());
