const events = {
  showcase: {
    name: '科创作品展', category: '校园科技文化节', date: '2026-10-08', start: '13:30', end: '17:30', guests: 96, budget: 6000, used: 4280,
    venue: { name: '科创中心报告厅', capacity: 120 },
    tasks: [
      ['确认活动流程', '策划', '林同学', '10-01', 'done'], ['发布报名通知', '宣传', '周同学', '10-02', 'done'], ['确认展示场地', '场地', '陈同学', '10-03', 'progress'],
      ['展位布局与物资运送', '布展', '许同学', '10-08', 'todo', true], ['作品展示与评委评审', '执行', '林同学', '10-08', 'todo', true], ['现场设备检查', '执行', '周同学', '10-08', 'todo', true],
      ['发送评委流程单', '评审', '林同学', '10-06', 'todo'], ['整理活动影像', '宣传', '陈同学', '10-09', 'todo']
    ],
    risks: [['展示设备兼容性', '高', '活动前 2 天 · 许同学', '准备转接设备并提前逐台测试'], ['评委时间变更', '中', '活动前 3 天 · 林同学', '活动前一天再次确认到场时间']],
    venues: [['综合楼阶梯教室', 150, true, 680], ['图书馆报告厅', 80, true, 300], ['创新工坊', 100, false, 450], ['学生活动中心', 180, true, 2100]]
  },
  welcome: {
    name: '迎新社团市集', category: '2026 · 新生季', date: '2026-10-12', start: '09:00', end: '16:00', guests: 260, budget: 9000, used: 5720,
    venue: { name: '中心广场', capacity: 400 },
    tasks: [
      ['确认社团报名名单', '招募', '周同学', '10-03', 'done'], ['发布摊位分区图', '宣传', '陈同学', '10-04', 'done'], ['完成摊位与电源规划', '场地', '林同学', '10-06', 'progress'],
      ['搭建摊位与指引牌', '布置', '许同学', '10-12', 'todo', true], ['社团签到与物资发放', '执行', '周同学', '10-12', 'todo', true], ['现场巡查与秩序维护', '执行', '林同学', '10-12', 'todo', true],
      ['汇总社团需求', '招募', '陈同学', '10-07', 'todo'], ['归还公共物资', '收尾', '许同学', '10-13', 'todo']
    ],
    risks: [['户外天气变化', '高', '活动前 1 天 · 林同学', '确认室内备选区域并通知各社团'], ['临时用电负荷', '中', '布置当天 · 许同学', '统一登记设备并分区检查用电']],
    venues: [['体育馆副馆', 500, true, 1200], ['学生活动中心', 220, true, 900], ['图书馆报告厅', 180, true, 450], ['综合楼大厅', 300, false, 500]]
  },
  forum: {
    name: '青年学术论坛', category: '2026 · 校园学术周', date: '2026-10-16', start: '14:00', end: '18:00', guests: 140, budget: 7500, used: 4960,
    venue: { name: '学术交流中心 201', capacity: 180 },
    tasks: [
      ['确认主讲嘉宾', '议程', '陈同学', '10-05', 'done'], ['开放参会报名', '宣传', '周同学', '10-07', 'done'], ['确认会场与直播方案', '场地', '林同学', '10-09', 'progress'],
      ['布置会场与导视', '会务', '许同学', '10-16', 'todo', true], ['嘉宾接待与彩排', '会务', '陈同学', '10-16', 'todo', true], ['论坛录制与现场保障', '执行', '周同学', '10-16', 'todo', true],
      ['整理嘉宾简介', '议程', '林同学', '10-11', 'todo'], ['发送参会提醒', '宣传', '陈同学', '10-14', 'todo']
    ],
    risks: [['线上直播中断', '高', '彩排当天 · 周同学', '准备备用网络和本地录制设备'], ['嘉宾行程延误', '中', '活动前 1 天 · 陈同学', '准备压缩版议程及线上接入方案']],
    venues: [['综合楼阶梯教室', 160, true, 650], ['科创中心报告厅', 120, true, 420], ['学生活动中心', 240, true, 1350], ['图书馆报告厅', 100, true, 280]]
  }
};

const initialState = { eventId: 'showcase', incident: false, resolved: false, chosenVenue: null, extraCost: 0, logs: [] };
const storageKey = 'event-workbench-demo-v1';
let state = loadState();
let toastTimer;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const currentEvent = () => events[state.eventId];
const formatDate = (date, withYear = false) => {
  const d = new Date(`${date}T12:00:00`);
  return `${withYear ? `${d.getFullYear()} 年 ` : ''}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
const dateShort = (value) => `10 月 ${Number(value.split('-')[1])} 日`;

function loadState() {
  try { return { ...initialState, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; }
  catch { return { ...initialState }; }
}
function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  $('.saved-status').innerHTML = '<i></i>已保存';
}
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}
function openView(view) {
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.add('hidden'));
  $(`#${view}View`).classList.remove('hidden');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function render() {
  const event = currentEvent();
  const venue = state.chosenVenue ? { name: state.chosenVenue.name, capacity: state.chosenVenue.capacity } : event.venue;
  const used = event.used + (state.eventId === state.resolvedEvent ? state.extraCost : 0);
  const completed = event.tasks.filter((task) => task[4] === 'done').length;
  const inProgress = event.tasks.filter((task) => task[4] === 'progress').length;
  const todo = event.tasks.length - completed - inProgress;
  const progress = Math.round(completed / event.tasks.length * 100);

  $('#activitySelect').innerHTML = Object.entries(events).map(([id, item]) => `<option value="${id}">${escapeHtml(item.name)}</option>`).join('');
  $('#activitySelect').value = state.eventId;
  $('#eventEyebrow').textContent = `${event.category} · ${formatDate(event.date)}`;
  $('#eventTitle').textContent = event.name;
  $('#eventDescription').textContent = `${event.guests} 位预计参与者 · ${event.start} - ${event.end} · ${event.budget.toLocaleString()} 元预算`;
  $('#daysToEvent').textContent = `活动日期：${formatDate(event.date, true)}`;
  $('#progressValue').innerHTML = `${progress}<small>%</small>`;
  $('#progressBar').style.width = `${progress}%`;
  $('#taskMetric').innerHTML = `${completed}<small> / ${event.tasks.length} 已完成</small>`;
  $('#taskMetricNote').textContent = `${inProgress} 项进行中 · ${todo} 项待开始`;
  $('#budgetMetric').innerHTML = `¥${used.toLocaleString()}<small> / ${event.budget.toLocaleString()}</small>`;
  $('#budgetBar').style.width = `${Math.min(100, used / event.budget * 100)}%`;
  $('#budgetRemaining').textContent = `剩余 ¥${Math.max(0, event.budget - used).toLocaleString()}`;
  $('#riskCount').innerHTML = `${event.risks.length + (state.incident && !state.resolved ? 1 : 0)}<small> 项</small>`;
  const riskTotal = event.risks.length + (state.incident && !state.resolved ? 1 : 0);
  $('#riskCountNav').textContent = riskTotal; $('#riskCountTab').textContent = riskTotal;
  $('#taskCountNav').textContent = event.tasks.length; $('#taskCountTab').textContent = event.tasks.length;
  $('#filterAll').textContent = event.tasks.length; $('#filterProgress').textContent = inProgress; $('#filterTodo').textContent = todo; $('#filterDone').textContent = completed;
  $('#venueName').textContent = venue.name;
  $('#venueTime').textContent = `◷ ${formatDate(event.date)} · ${event.start} - ${event.end}`;
  $('#venueCapacity').textContent = `♙ 容纳 ${venue.capacity} 人`;
  $('#venueState').innerHTML = state.resolved ? '<i></i> 已调整 <span>· 林同学</span>' : '<i></i> 已确认 <span>· 项目组</span>';
  $('#venueState').classList.toggle('unconfirmed', state.incident && !state.resolved);
  $('#incidentBanner').classList.toggle('hidden', !state.incident || state.resolved);
  $('#incidentDetails').textContent = `${event.venue.name} · ${formatDate(event.date)} ${event.start} - ${event.end} · 影响 ${event.tasks.filter((task) => task[5]).length} 项任务`;
  $('#taskListRows').innerHTML = event.tasks.slice(0, 6).map(taskRow).join('');
  $('#taskViewSummary').textContent = `${event.tasks.length} 项任务 · 按截止日期排序`;
  $('#tasksTableBody').innerHTML = event.tasks.map((task) => `<tr><td>${escapeHtml(task[0])}${state.resolvedEvent === state.eventId && task[5] ? `<small class="task-location"> · ${escapeHtml(venue.name)}</small>` : ''}</td><td>${escapeHtml(task[1])}</td><td>${escapeHtml(task[2])}</td><td>${dateShort(task[3])}</td><td>${task[5] ? (state.resolvedEvent === state.eventId ? escapeHtml(venue.name) : '场地确认') : '—'}</td><td><span class="table-status ${task[4]}">${statusName(task[4])}</span></td></tr>`).join('');
  $('#resourceTime').textContent = `${formatDate(event.date)} · ${event.start} - ${event.end}`;
  $('#attendeeCount').innerHTML = `${event.guests} 人 <small>/ 预计</small>`;
  $('#budgetLimit').textContent = `¥${event.budget.toLocaleString()}`;
  $('#resourcesTableBody').innerHTML = [
    [venue.name, '场地', venue.capacity, event.guests, venue.capacity >= event.guests ? '满足人数' : '容量不足'],
    ['执行小组', '人员', 4, 4, '已分配'], ['音视频设备', '设备', 6, 4, '待检查'], ['活动经费', '预算', `¥${event.budget}`, `¥${used}`, event.budget >= used ? '额度充足' : '超出预算']
  ].map((row) => `<tr>${row.map((cell, index) => `<td>${index === 4 ? `<span class="table-status ${cell === '容量不足' || cell === '超出预算' ? '' : 'done'}">${cell}</span>` : cell}</td>`).join('')}</tr>`).join('');
  $('#riskSummary').textContent = `${event.risks.length + (state.incident && !state.resolved ? 1 : 0)} 项待跟进 · 每项风险都要有责任人与应对措施`;
  const riskMarkup = event.risks.map((risk) => `<article class="risk-card"><span class="risk-level ${risk[1] === '高' ? 'high' : 'medium'}">${risk[1]}</span><div><strong>${escapeHtml(risk[0])}</strong><p>${escapeHtml(risk[3])}</p><small>${escapeHtml(risk[2])}</small></div></article>`).join('');
  $('#riskCards').innerHTML = riskMarkup + (state.incident && !state.resolved ? '<article class="risk-card"><span class="risk-level high">高</span><div><strong>活动场地临时不可用</strong><p>确认替代场地并通知任务负责人。</p><small>当前 · 项目组织者</small></div></article>' : '');
  $('#riskPreview').innerHTML = event.risks.slice(0, 2).map((risk) => `<div class="risk-item"><span class="risk-level ${risk[1] === '高' ? 'high' : 'medium'}">${risk[1]}</span><div><strong>${escapeHtml(risk[0])}</strong><small>${escapeHtml(risk[2])}</small></div></div>`).join('');
  const timelineStart = new Date(`${event.date}T12:00:00`); timelineStart.setDate(timelineStart.getDate() - 6);
  $('#timelineDate').textContent = `${formatDate(timelineStart.toISOString().slice(0, 10), true)} - ${formatDate(event.date)}`;
  $('#timelineDays').innerHTML = Array.from({ length: 7 }, (_, i) => { const d = new Date(timelineStart); d.setDate(d.getDate() + i); return `<span class="${i === 3 ? 'today' : ''} ${i === 6 ? 'event-day' : ''}">${['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]}<br><b>${d.getDate()}</b></span>`; }).join('');
  $('#timelineTrack').innerHTML = `<div class="timeline-line"></div>${event.tasks.filter((task) => task[5]).slice(0, 3).map((task, i) => `<div class="timeline-block ${['block-teal','block-gold','block-coral'][i]}" style="--start:${i * 2};--span:2"><b>${escapeHtml(task[0])}</b><small>${escapeHtml(task[2])}</small></div>`).join('')}`;
  $('#logList').innerHTML = state.logs.length ? [...state.logs].reverse().map((log) => `<article class="log-entry"><span class="log-time">${escapeHtml(log.time)}</span><div><strong>${escapeHtml(log.title)}</strong><p>${escapeHtml(log.detail)}</p></div><span class="log-tag">${escapeHtml(log.tag)}</span></article>`).join('') : '<div class="empty-log">还没有变更记录。模拟一次活动调整后，处理过程会记录在这里。</div>';
  $('#simulateBtn').disabled = state.incident && !state.resolved;
  $('#simulateBtn').innerHTML = state.incident && !state.resolved ? '<span>!</span> 正在处理变更' : '<span>⚡</span> 模拟场地取消';
  saveState();
}
function statusName(status) { return ({ done: '已完成', progress: '进行中', todo: '待开始' })[status]; }
function taskRow(task) {
  const status = task[4];
  return `<div class="task-row ${status === 'done' ? 'done' : status === 'progress' ? 'in-progress' : ''}"><span class="task-check">${status === 'done' ? '✓' : status === 'progress' ? '◔' : ''}</span><div class="task-main"><strong>${escapeHtml(task[0])}</strong><small>${escapeHtml(task[1])} · ${escapeHtml(task[2])}${state.resolvedEvent === state.eventId && task[5] ? ` · ${escapeHtml(state.chosenVenue.name)}` : ''}</small></div><span class="task-date">${dateShort(task[3])}</span><span class="task-status status-${status}">${statusName(status)}</span></div>`;
}
function showResolution() {
  const event = currentEvent();
  $('#dialogIncidentTitle').textContent = `${event.venue.name}无法使用`;
  $('#dialogIncidentDetails').textContent = `影响：${formatDate(event.date)} ${event.start} - ${event.end} · 预计 ${event.guests} 人`;
  const affected = event.tasks.filter((task) => task[5]);
  $('#impactCount').textContent = `${affected.length} 项任务需要调整`;
  $('#impactTasks').innerHTML = affected.map((task) => `<li>${escapeHtml(task[0])}<small>${dateShort(task[3])} · ${escapeHtml(task[2])}</small></li>`).join('');
  const availableBudget = event.budget - event.used;
  $('#alternatives').innerHTML = event.venues.map(([name, capacity, available, cost], index) => {
    const meetsCapacity = capacity >= event.guests;
    const meetsBudget = cost <= availableBudget;
    const eligible = meetsCapacity && available && meetsBudget;
    const reason = !meetsCapacity ? `容量不足（需 ${event.guests} 人）` : !available ? '时段冲突' : !meetsBudget ? `超出剩余预算 ¥${availableBudget.toLocaleString()}` : '满足人数、时段与预算';
    return `<label class="alternative-option ${eligible ? '' : 'disabled'}"><input type="radio" name="venue" value="${index}" ${eligible ? '' : 'disabled'}><span><strong>${escapeHtml(name)}</strong><small>容量 ${capacity} 人 · 占用时段 ${available ? '可用' : '冲突'}</small></span><span class="option-meta"><b>¥${cost.toLocaleString()}</b><small class="${eligible ? 'eligibility' : 'ineligible'}">${reason}</small></span></label>`;
  }).join('');
  $('#selectedReason').className = 'selection-reason';
  $('#selectedReason').textContent = '选择一个满足人数、时段和预算要求的场地，确认后同步更新安排。';
  $('#confirmResolution').disabled = true;
  $('#resolutionDialog').showModal();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.view)));
document.querySelectorAll('[data-open-view]').forEach((button) => button.addEventListener('click', () => openView(button.dataset.openView)));
$('#activitySelect').addEventListener('change', (event) => {
  state.eventId = event.target.value; state.incident = false; state.resolved = false; state.chosenVenue = null; state.extraCost = 0; state.resolvedEvent = null;
  saveState(); render(); openView('overview');
});
$('#simulateBtn').addEventListener('click', () => { state.incident = true; saveState(); render(); showResolution(); });
$('#resolveBtn').addEventListener('click', showResolution);
$('#dismissIncident').addEventListener('click', () => { $('#incidentBanner').classList.add('hidden'); });
$('#cancelResolution').addEventListener('click', () => $('#resolutionDialog').close());
$('#resolutionDialog').addEventListener('click', (event) => { if (event.target === $('#resolutionDialog')) $('#resolutionDialog').close(); });
$('#alternatives').addEventListener('change', (event) => {
  const option = event.target.closest('.alternative-option'); if (!option) return;
  const selected = currentEvent().venues[Number(event.target.value)];
  $('#confirmResolution').disabled = false;
  $('#selectedReason').className = 'selection-reason';
  $('#selectedReason').textContent = `${selected[0]}符合容量、时段和预算要求。预计新增费用 ¥${selected[3].toLocaleString()}，确认后将同步更新场地、任务与变更记录。`;
});
$('#confirmResolution').addEventListener('click', () => {
  const chosenIndex = Number(document.querySelector('input[name="venue"]:checked')?.value);
  if (!Number.isInteger(chosenIndex)) return;
  const event = currentEvent(); const [name, capacity, , cost] = event.venues[chosenIndex];
  state.chosenVenue = { name, capacity }; state.extraCost = cost; state.resolved = true; state.resolvedEvent = state.eventId;
  const affected = event.tasks.filter((task) => task[5]).map((task) => task[0]).join('、');
  state.logs.push({ time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), title: `活动场地调整为「${name}」`, detail: `原场地：${event.venue.name}。更新关联任务：${affected}。新增场地费用 ¥${cost.toLocaleString()}。`, tag: '场地变更' });
  $('#resolutionDialog').close(); saveState(); render(); showToast('场地、资源和任务安排已同步更新');
});
$('#exportBtn').addEventListener('click', () => {
  const event = currentEvent();
  const venue = state.chosenVenue?.name || event.venue.name;
  const lines = [['活动', event.name], ['日期', `${formatDate(event.date)} ${event.start}-${event.end}`], ['活动场地', venue], ['预计人数', event.guests], ['预算上限', event.budget], ['预算已用', event.used + (state.resolvedEvent === state.eventId ? state.extraCost : 0)], [], ['任务', '负责人', '截止日期', '状态'], ...event.tasks.map((task) => [task[0], task[2], dateShort(task[3]), statusName(task[4])])];
  const content = '\ufeff' + lines.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${event.name}-执行清单.csv`; link.click(); URL.revokeObjectURL(url); showToast('执行清单已导出');
});
$('#resetBtn').addEventListener('click', () => {
  state = { ...initialState, logs: [] }; localStorage.removeItem(storageKey); render(); openView('overview'); showToast('演示数据已恢复初始状态');
});
$('#addTaskBtn').addEventListener('click', () => showToast('任务新建为演示入口，当前原型聚焦活动变更流程'));
document.querySelectorAll('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
  document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
  chip.classList.add('active');
  const filter = chip.textContent.trim().split(' ')[0];
  document.querySelectorAll('#tasksTableBody tr').forEach((row) => { row.hidden = filter !== '全部' && !row.querySelector('.table-status').textContent.startsWith(filter.replace('待开始', '待开始')); });
}));

render();
