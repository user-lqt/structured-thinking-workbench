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

const initialState = { eventId: 'showcase', page: 'home', incident: false, resolved: false, chosenVenue: null, extraCost: 0, logs: [], customEvents: {}, projectOwners: {}, archivedProjects: {}, generatedImages: {}, materials: {}, taskStatuses: {}, phaseChecks: {}, user: null, currentPhase: 'plan' };
const storageKey = 'event-workbench-demo-v1';
let state = loadState();
Object.assign(events, state.customEvents || {});
let toastTimer;
let editingMaterialId = null;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const currentEvent = () => events[state.eventId];
const roleNames = { organizer: '活动组织者', member: '活动成员', viewer: '只读访客' };
const canManage = () => state.user?.role === 'organizer';
const canOperate = () => state.user?.role === 'organizer' || state.user?.role === 'member';
const phases = {
  plan: { title: '前期策划', description: '明确活动目标、受众、形式、时间、预算与协作分工。', checks: ['目标与受众明确', '活动形式与流程有草案', '预算与责任分工已核对'] },
  prepare: { title: '活动筹备', description: '落实场地、人员、物料、宣传和各项确认工作。', checks: ['场地与资源已确认', '宣传和报名信息已发布', '关键负责人已完成到场确认'] },
  execute: { title: '现场执行', description: '按现场手册组织签到、流程、人员调度与突发响应。', checks: ['执行人员已签到并完成岗位交接', '关键设备与安全通道已检查', '现场联络人与升级路径已确认'] },
  close: { title: '活动收尾', description: '完成撤场、物资归还、费用核对、反馈收集与复盘。', checks: ['场地恢复并完成物资归还', '费用凭证与参与数据已核对', '经验问题与改进项已记录'] }
};
const formatDate = (date, withYear = false) => {
  const d = new Date(`${date}T12:00:00`);
  return `${withYear ? `${d.getFullYear()} 年 ` : ''}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
const dateShort = (value) => {
  const parts = value.split('-');
  return `${Number(parts.at(-2))} 月 ${Number(parts.at(-1))} 日`;
};
const dateOffset = (date, days) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
};
function taskPhase(task) {
  if (task[6] && phases[task[6]]) return task[6];
  if (task[5]) return 'execute';
  if (/复盘|归还|整理活动影像|收尾/.test(task[0]) || task[1] === '收尾') return 'close';
  if (['策划', '议程', '招募'].includes(task[1])) return 'plan';
  return 'prepare';
}
function taskStatus(eventId, index, task) {
  return state.taskStatuses?.[eventId]?.[index] || task[4];
}
function riskRecords(event) {
  const plans = [
    { match: /天气|户外/, trigger: '预报出现降雨、大风或高温预警；场地环境不再适合继续活动。', prevention: '提前落实室内备选场地，明确切换决定人并预留通知时间。', response: '暂停户外环节，按现场广播引导人员转移至备选区域，清点人员后再恢复活动。', escalation: '现场负责人先处置；无法在 15 分钟内恢复时报告活动组织者；涉及人身安全时联系校方保障与急救。' },
    { match: /设备|兼容|直播|网络/, trigger: '彩排或现场检查中关键设备、投影、音频或网络连续两次未通过。', prevention: '提前彩排；准备备用线材、设备、本地文件和离线录制方案。', response: '切换备用设备或离线方案；暂停受影响环节并向参与者说明调整。', escalation: '设备负责人先切换；超过 10 分钟未恢复则由流程负责人调整议程，并通知组织者。' },
    { match: /人数|人流|报名|秩序|用电/, trigger: '到场人数超过核定容量、入口排队回流，或用电与通道检查不合格。', prevention: '设置签到分流与容量阈值；活动前巡检通道、负荷和设备布点。', response: '暂停入场或相关设备使用，安排人员分流，清出安全通道并复核现场人数。', escalation: '秩序负责人先控制入口；仍有拥挤或安全隐患时立即通知组织者及校方保障，必要时停止活动。' },
    { match: /嘉宾|评委|行程|人员|缺席/, trigger: '关键嘉宾或岗位负责人未按约定时间到场，流程无法按原计划开始。', prevention: '提前复核行程与联系方式；安排替补负责人并准备压缩版议程。', response: '启用替补或调整环节顺序；由接待负责人联系迟到人员并更新主持流程。', escalation: '延误超过 15 分钟时由总协调人决定延后、线上接入或取消该环节，并通知参与者。' },
    { match: /预算|费用|物资|需求/, trigger: '采购或临时需求将导致预算超支，或关键物资未按时到位。', prevention: '设置预算预警线与替代物资清单；采购前复核数量、报价与负责人。', response: '暂停非必要支出，优先保障安全和核心流程，启用可替代物资。', escalation: '预计超预算 10% 或核心物资缺失时提交组织者审批并记录调整原因。' }
  ];
  const baselines = [
    { name: '活动目标与审批要求未按期确认', level: '中', phase: 'plan', probability: 3, impact: 3, due: '方案评审前', owner: '活动组织者', trigger: '关键目标、审批要求或参与条件仍未确认，但已进入宣传或采购。', prevention: '设置方案评审节点，明确审批人与决策截止时间；未确认内容不对外承诺。', response: '暂停相关宣传或不可撤销采购，列出未决事项并安排负责人限时确认。', escalation: '超过评审节点仍未确认时，由项目组织者协调任课教师/主管部门；涉及安全或合规要求时不得跳过审批。' },
    { name: '场地、物料或关键人员未按期到位', level: '中', phase: 'prepare', probability: 3, impact: 3, due: '活动前 1 天', owner: '筹备负责人', trigger: '场地确认、关键物料交付或岗位人员确认晚于计划节点。', prevention: '设置到期提醒和前一天复核，准备备选场地、供应渠道及岗位替补。', response: '启用清单中的替代资源，重排不影响安全与核心目标的流程，并通知相关负责人。', escalation: '备用资源仍无法满足活动条件时，由组织者决定调整规模、时间或活动形式并更新通知。' },
    { name: '现场安全或秩序事件', level: '高', phase: 'execute', probability: 3, impact: 5, due: '活动全时段', owner: '现场总协调', trigger: '人员拥挤、受伤、通道阻塞、设施异常或其他人身安全风险。', prevention: '活动前检查疏散通道与设备；公布集合点、现场联络人和暂停活动的授权人。', response: '立即停止受影响环节，按现场预案疏散或隔离风险区域，清点人员并联系校方保障/急救。', escalation: '安全事件直接升级现场总协调与校方保障；未经风险复核和负责人确认不得恢复活动。' },
    { name: '费用结算、物资归还或资料归档遗漏', level: '低', phase: 'close', probability: 2, impact: 2, due: '活动后 3 个工作日', owner: '收尾负责人', trigger: '活动结束后仍有未核销票据、未归还物资或未归档的审批与现场记录。', prevention: '使用收尾清单逐项签认，指定资料归档位置与最终负责人。', response: '补齐凭证、联系物资责任人完成交接，记录缺失原因和后续完成时间。', escalation: '逾期或涉及较大金额、损坏与争议时报告组织者并按学校财务/资产流程处理。' }
  ];
  const custom = event.risks.map((risk) => {
    const raw = Array.isArray(risk) ? { name: risk[0], level: risk[1], ownerText: risk[2], note: risk[3] } : risk;
    const action = plans.find((plan) => plan.match.test(raw.name)) || { trigger: '关键任务未按计划完成或影响活动目标、参与者体验与现场安全。', prevention: '为关键任务设置负责人、截止时间和复核点；准备可行的替代流程。', response: '先保障人身安全和活动核心环节，暂停受影响部分，协调备用资源并记录处置过程。', escalation: '现场负责人先处置；影响扩大或预计延误超过 15 分钟时上报活动组织者；安全事件立即联系校方保障。' };
    const isHigh = raw.level === '高';
    const probability = raw.probability ?? (isHigh ? 4 : 3);
    const impact = raw.impact ?? (isHigh ? 4 : 3);
    const score = probability * impact;
    const level = raw.level || (score >= 15 ? '高' : score >= 8 ? '中' : '低');
    const phase = raw.phase || (/预算|报名|需求|人数/.test(raw.name) ? 'prepare' : 'execute');
    return { ...action, ...raw, level, probability, impact, score, phase, owner: raw.owner || raw.ownerText?.split('·').at(-1)?.trim() || '活动组织者', due: raw.due || raw.ownerText?.split('·')[0]?.trim() || '活动前复核' };
  });
  return [...baselines, ...custom];
}
function artifactDefinitions(event) {
  const tasksFor = (phase) => event.tasks.filter((task) => taskPhase(task) === phase);
  const riskList = riskRecords(event);
  const assignedTasks = (phase) => tasksFor(phase).map((task) => `- [${taskStatus(state.eventId, event.tasks.indexOf(task), task) === 'done' ? 'x' : ' '}] ${task[0]}｜负责人：${task[2]}｜截止：${dateShort(task[3])}`).join('\n') || '- 待补充阶段任务';
  const schedule = `${event.start} 前 60 分钟｜场地、通道和设备检查（建议安排，待确认）\n${event.start} 前 15 分钟｜签到与入场引导（建议安排，待确认）\n${event.start} - ${event.end}｜活动流程按主持稿执行（具体环节待补充）\n${event.end} 后｜人员清场、物资清点与场地恢复（建议安排，待确认）`;
  const riskMarkdown = riskList.map((risk) => `### ${risk.name}｜${risk.level}风险（${risk.probability} × ${risk.impact} = ${risk.score}）\n- 阶段 / 责任人：${phases[risk.phase].title} / ${risk.owner}\n- 触发条件：${risk.trigger}\n- 预防措施：${risk.prevention}\n- 现场响应：${risk.response}\n- 升级路径：${risk.escalation}`).join('\n\n') || '当前未登记风险，请在各阶段检查并补充。';
  return [
    { id: 'plan', title: '活动策划书', phase: 'plan', kind: '策划方案', content: `# ${event.name}｜活动策划书\n\n## 一、活动基本信息\n- 活动类别：${event.category}\n- 活动时间：${formatDate(event.date, true)} ${event.start} - ${event.end}\n- 当前场地：${event.venue.name}（预计 ${event.guests} 人）\n- 预算上限：¥${event.budget.toLocaleString()}\n\n## 二、背景与目标\n- 活动背景：待补充\n- 活动目标：待补充（建议填写可核验的目标）\n- 目标受众：待补充\n\n## 三、活动形式与内容\n- 活动形式：待补充\n- 核心环节：待补充\n- 参与方式：待补充\n\n## 四、阶段任务与分工\n${assignedTasks('plan')}\n\n## 五、筹备与执行安排\n${assignedTasks('prepare')}\n\n## 六、预算控制\n- 预算上限：¥${event.budget.toLocaleString()}\n- 分项预算、报价与审批人：待补充\n\n## 七、风险与应急\n${riskList.map((risk) => `- ${risk.name}（${risk.level}，${risk.score}/25）：${risk.response}`).join('\n') || '待补充风险识别结果'}\n\n## 八、待确认事项\n- 活动目标、审批要求、报名方式、联络方式及数据来源均待项目组确认。` },
    { id: 'promo', title: '宣传与招募材料', phase: 'prepare', kind: '宣传文案', content: `# ${event.name}｜宣传与招募材料\n\n## 海报主文案\n**${event.name}**\n${event.category} · ${formatDate(event.date)} ${event.start} - ${event.end}\n地点：${event.venue.name}\n面向人群：待补充｜参与方式：待补充\n\n## 活动简介（草稿）\n${event.name}即将举行。欢迎关注活动安排，并通过【待补充：报名入口/联系人】了解参与方式。活动内容、报名截止时间及参与条件请以主办方最终通知为准。\n\n## 社交平台短文案\n【${event.name}报名/预告】\n时间：${formatDate(event.date)} ${event.start} - ${event.end}\n地点：${event.venue.name}\n适合谁参加：待补充\n报名方式：待补充\n\n## 报名信息建议项\n姓名 / 联系方式 / 参与人数 / 特殊需求（按实际需要采集，隐私告知待补充）\n\n## 视觉方向与生图提示词\n为“${event.name}”设计校园活动宣传海报。主题和视觉元素：待补充；主标题醒目，时间与地点留出清晰信息区，排版便于手机阅读，不要虚构主办单位、赞助商、二维码、数据或奖项。建议尺寸：竖版 4:5；生成后由组织者核对文字与事实。\n\n## 发布前核对\n- [ ] 时间、地点、报名方式已经活动负责人确认\n- [ ] 参与对象、名额、截止时间和费用说明已补充\n- [ ] 主办单位标识、图片授权与隐私说明已核对` },
    { id: 'runbook', title: '现场执行手册', phase: 'execute', kind: '执行手册', content: `# ${event.name}｜现场执行手册\n\n## 活动信息\n- 日期 / 时段：${formatDate(event.date, true)} ${event.start} - ${event.end}\n- 场地：${event.venue.name}\n- 预计人数：${event.guests}\n- 现场总协调：待补充\n- 紧急联络方式：待补充\n\n## 建议时间轴（须由负责人确认）\n${schedule}\n\n## 现场岗位\n${tasksFor('execute').map((task) => `- ${task[1]}：${task[2]}｜${task[0]}｜完成标准与交接人待补充`).join('\n') || '- 现场岗位与人员：待补充'}\n\n## 开场前检查\n- [ ] 入口、疏散通道和消防设施无阻挡\n- [ ] 音视频、电源、网络及备用方案已测试\n- [ ] 签到表、指引牌、物料和岗位联络方式已核对\n- [ ] 现场负责人确认继续、调整或暂停活动的决策路径\n\n## 现场异常处置\n先确保人员安全，再暂停受影响环节、启用备用方案并记录时间、负责人、影响范围和处置结果。按《分级风险应急预案》升级报告。\n\n## 收场交接\n清点人员和物资，确认场地恢复；记录遗失、损坏、费用凭证及未完成事项。` },
    { id: 'risk', title: '分级风险应急预案', phase: 'prepare', kind: '风险预案', content: `# ${event.name}｜全流程风险识别与分级应急预案\n\n## 评估规则\n风险分值 = 发生可能性（1–5）× 影响程度（1–5）。分级：15–25 高，8–14 中，1–7 低。当前示例按已列风险给出初始判断，需由活动组结合现场信息复核。\n\n## 风险登记与响应\n${riskMarkdown}\n\n## 分级响应机制\n- **高风险**：活动总协调立即介入；涉及人身安全时先暂停/疏散并通知校方保障或急救；未经确认不得恢复。\n- **中风险**：责任人执行预防或替代方案，向总协调报告进度；超时或影响扩大时升级为高风险流程。\n- **低风险**：责任人跟踪并记录；若触发条件改变，重新评估可能性与影响。\n\n## 通用升级链\n发现人 → 对应任务负责人 → 现场总协调 → 活动组织者 → 校方保障/相关部门。具体电话、集合点、备用场地与授权人：待补充。\n\n## 事件记录\n发生时间、地点、发现人、受影响人数、风险等级、处置动作、升级对象、恢复条件和复盘结论均需留档。` },
    { id: 'closeout', title: '活动收尾与复盘报告', phase: 'close', kind: '复盘报告', content: `# ${event.name}｜活动收尾与复盘报告\n\n## 一、活动基本信息\n- 活动日期：${formatDate(event.date, true)}\n- 计划人数：${event.guests}（实际到场：待填写）\n- 预算上限：¥${event.budget.toLocaleString()}（实际支出：待填写）\n\n## 二、收尾清单\n${assignedTasks('close')}\n- [ ] 物资归还、损耗与场地恢复已登记\n- [ ] 票据、审批记录和供应商结算已归档\n- [ ] 参与者反馈与影像资料已按授权要求整理\n\n## 三、结果记录（仅填写核实后的事实）\n- 完成情况与目标对照：待填写\n- 实际参与人数及统计口径：待填写\n- 实际支出及凭证：待填写\n- 现场事件与处置结果：待填写\n- 反馈摘要及收集方式：待填写\n\n## 四、复盘与改进\n- 做得好的部分：待填写\n- 遇到的问题及原因：待填写\n- 下次可执行的改进项、负责人和截止日期：待填写\n\n## 五、资料归档\n最终策划书、宣传定稿、执行手册、签到统计、审批与费用凭证、风险处置记录：归档位置待补充。` }
  ].map((doc) => ({ ...doc, content: state.materials?.[state.eventId]?.[doc.id] ?? doc.content }));
}
function renderLifecycle(event) {
  const counts = Object.keys(phases).map((phase) => {
    const tasks = event.tasks.map((task, index) => ({ task, index })).filter(({ task }) => taskPhase(task) === phase);
    return [phase, tasks, tasks.filter(({ task, index }) => taskStatus(state.eventId, index, task) === 'done').length];
  });
  counts.forEach(([phase, tasks, done]) => { $(`#phaseCount-${phase}`).textContent = `${done}/${tasks.length} 项完成`; });
  document.querySelectorAll('[data-phase]').forEach((button) => button.classList.toggle('active', button.dataset.phase === state.currentPhase));
  const phase = state.currentPhase in phases ? state.currentPhase : 'plan';
  state.currentPhase = phase;
  const definition = phases[phase];
  const [, stageTasks, done] = counts.find((row) => row[0] === phase);
  const stageRisks = riskRecords(event).filter((risk) => risk.phase === phase);
  const docs = artifactDefinitions(event).filter((doc) => doc.phase === phase);
  $('#phaseTitle').textContent = definition.title;
  $('#phaseDescription').textContent = definition.description;
  $('#phaseSummary').innerHTML = `<div><span>任务进度</span><strong>${done} / ${stageTasks.length}</strong></div><div><span>阶段风险</span><strong>${stageRisks.length} 项</strong></div><div><span>过程输出</span><strong>${docs.length} 份</strong></div>`;
  $('#phaseTaskProgress').textContent = `${done}/${stageTasks.length} 完成`;
  $('#phaseTaskList').innerHTML = stageTasks.map(({ task, index }) => {
    const status = taskStatus(state.eventId, index, task);
    return `<article class="phase-task"><span class="phase-task-status status-${status}">${statusName(status)}</span><div><strong>${escapeHtml(task[0])}</strong><small>${escapeHtml(task[1])} · ${escapeHtml(task[2])} · ${dateShort(task[3])}</small></div>${canOperate() ? `<button class="task-toggle" data-task-index="${index}" title="${status === 'done' ? '标为未完成' : '标记完成'}">${status === 'done' ? '✓' : '○'}</button>` : ''}</article>`;
  }).join('') || '<div class="empty-log">本阶段还没有任务。</div>';
  $('#phaseMaterialList').innerHTML = docs.map((doc) => `<article class="phase-material"><span class="material-icon">${doc.kind.slice(0, 1)}</span><div><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(doc.kind)} · 可编辑、导出</small></div><button class="quiet-icon" data-open-material="${doc.id}" title="打开材料">→</button></article>`).join('') || '<div class="empty-log">本阶段暂无材料。</div>';
  $('#phaseChecklist').innerHTML = definition.checks.map((check, index) => `<label class="check-row"><input type="checkbox" data-phase-check="${phase}-${index}" ${state.phaseChecks?.[state.eventId]?.[`${phase}-${index}`] ? 'checked' : ''} ${canOperate() ? '' : 'disabled'}><span>${escapeHtml(check)}</span></label>`).join('');
}
function renderMaterials(event) {
  $('#materialsGrid').innerHTML = artifactDefinitions(event).map((doc) => `<article class="material-card"><div class="material-card-top"><span class="material-icon">${doc.kind.slice(0, 1)}</span><span class="material-phase">${phases[doc.phase].title}</span></div><h3>${escapeHtml(doc.title)}</h3><p>${escapeHtml(doc.kind)} · ${doc.content.split('\n').length} 行工作底稿</p><div class="material-actions"><button class="button button-secondary" data-open-material="${doc.id}">查看 / 编辑</button><button class="quiet-icon" data-download-material="${doc.id}" title="下载 Markdown">⇩</button></div></article>`).join('');
}
function renderRisks(event, risks) {
  $('#riskSummary').textContent = `${risks.length} 项已识别 · 高 ${risks.filter((risk) => risk.level === '高').length} · 中 ${risks.filter((risk) => risk.level === '中').length} · 低 ${risks.filter((risk) => risk.level === '低').length}`;
  $('#riskCards').innerHTML = risks.map((risk) => `<article class="risk-card risk-detail"><span class="risk-level ${risk.level === '高' ? 'high' : risk.level === '中' ? 'medium' : 'low'}">${risk.level}</span><div class="risk-detail-content"><div class="risk-title-line"><strong>${escapeHtml(risk.name)}</strong><span>${phases[risk.phase].title} · ${escapeHtml(risk.due)} · ${escapeHtml(risk.owner)}</span></div><div class="risk-score"><b>风险值 ${risk.score}/25</b><span>可能性 ${risk.probability}/5 × 影响 ${risk.impact}/5</span></div><p>触发条件：${escapeHtml(risk.trigger)}</p><p>预防措施：${escapeHtml(risk.prevention)}</p><details><summary>查看分级应急预案</summary><p><b>现场响应：</b>${escapeHtml(risk.response)}</p><p><b>升级路径：</b>${escapeHtml(risk.escalation)}</p></details></div></article>`).join('') || '<div class="empty-log">当前没有登记风险。建议按阶段检查人员、场地、物资、预算、安全和活动收尾风险。</div>';
  $('#riskPreview').innerHTML = risks.slice(0, 2).map((risk) => `<div class="risk-item"><span class="risk-level ${risk.level === '高' ? 'high' : risk.level === '中' ? 'medium' : 'low'}">${risk.level}</span><div><strong>${escapeHtml(risk.name)}</strong><small>${phases[risk.phase].title} · ${escapeHtml(risk.owner)}</small></div></div>`).join('');
}
function downloadText(filename, content, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\ufeff', content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename.replace(/[\\/:*?"<>|]/g, '-'); link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function materialById(id) { return artifactDefinitions(currentEvent()).find((doc) => doc.id === id); }
function openMaterial(id) {
  const doc = materialById(id); if (!doc) return;
  editingMaterialId = id;
  $('#materialTitle').textContent = doc.title;
  $('#materialPhaseLabel').textContent = `${phases[doc.phase].title} · ${doc.kind}`;
  $('#materialEditor').value = doc.content;
  $('#materialEditor').readOnly = !canOperate();
  $('#saveMaterial').classList.toggle('hidden', !canOperate());
  $('#generateTextBtn').classList.toggle('hidden', !canOperate());
  $('#textAiStatus').textContent = '';
  $('#materialDialog').showModal();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return { ...initialState, ...saved, customEvents: saved.customEvents || {}, logs: saved.logs || [] };
  }
  catch { return { ...initialState }; }
}
function saveState() {
  state.customEvents = Object.fromEntries(Object.entries(events).filter(([id]) => !['showcase', 'welcome', 'forum'].includes(id)));
  localStorage.setItem(storageKey, JSON.stringify(state));
  $('.saved-status').innerHTML = '<i></i>已保存';
}
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}
function openView(view) {
  state.page = 'project';
  $('#personalHome').classList.add('hidden');
  $('#projectWorkspace').classList.remove('hidden');
  $('#projectNavigation').classList.remove('hidden');
  document.querySelectorAll('.project-only').forEach((el) => el.classList.remove('hidden'));
  $('#crumbSep').classList.remove('hidden');
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.add('hidden'));
  $(`#${view}View`).classList.remove('hidden');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showHome() {
  state.page = 'home';
  saveState();
  renderHome();
  $('#personalHome').classList.remove('hidden');
  $('#projectWorkspace').classList.add('hidden');
  $('#projectNavigation').classList.add('hidden');
  document.querySelectorAll('.project-only').forEach((el) => el.classList.add('hidden'));
  $('#crumbSep').classList.add('hidden');
  $('#homeNav').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function openProject(id) {
  if (!events[id] || state.archivedProjects?.[id]) return;
  state.eventId = id;
  state.page = 'project';
  state.incident = false; state.resolved = false; state.chosenVenue = null; state.extraCost = 0; state.resolvedEvent = null;
  saveState(); render(); openView('overview');
}
function renderHome() {
  const query = $('#projectSearch').value.trim().toLocaleLowerCase();
  const filter = $('#projectFilter').value;
  const visible = Object.entries(events).filter(([id, item]) => {
    if (state.archivedProjects?.[id]) return false;
    if (filter === 'upcoming' && item.date < new Date().toISOString().slice(0, 10)) return false;
    if (filter === 'custom' && state.projectOwners?.[id] !== state.user?.name) return false;
    return `${item.name} ${item.category}`.toLocaleLowerCase().includes(query);
  });
  const openProjects = Object.entries(events).filter(([id]) => !state.archivedProjects?.[id]);
  const risks = openProjects.reduce((sum, [, item]) => sum + riskRecords(item).filter((risk) => risk.level === '高').length, 0);
  $('#homeProjectCount').textContent = openProjects.length;
  $('#homeActiveCount').textContent = openProjects.filter(([, item]) => item.date >= new Date().toISOString().slice(0, 10)).length;
  $('#homeRiskCount').textContent = risks;
  $('#projectListCount').textContent = `${visible.length} 个项目`;
  $('#projectList').innerHTML = visible.map(([id, item]) => {
    const complete = item.tasks.filter((task, index) => taskStatus(id, index, task) === 'done').length;
    const progress = Math.round(complete / item.tasks.length * 100);
    const nextTask = item.tasks.find((task, index) => taskStatus(id, index, task) !== 'done');
    const custom = !['showcase', 'welcome', 'forum'].includes(id);
    return `<article class="project-card"><div class="project-card-main"><div class="project-card-heading"><span class="project-type-mark">${escapeHtml(item.category.slice(0, 1))}</span><div><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.category)} <span>·</span> ${formatDate(item.date, true)}</p></div><span class="project-card-state ${item.date < new Date().toISOString().slice(0, 10) ? 'state-complete' : ''}">${item.date < new Date().toISOString().slice(0, 10) ? '已结束' : '进行中'}</span></div><div class="project-card-progress"><span>任务进度</span><div><i style="width:${progress}%"></i></div><b>${progress}%</b><small>${complete}/${item.tasks.length} 项</small></div><div class="project-card-foot"><span>${nextTask ? `下一步：${escapeHtml(nextTask[0])}` : '所有任务已完成'}</span><span>${item.guests} 人 · ¥${item.budget.toLocaleString()}</span></div></div><div class="project-card-actions"><button class="button button-primary" data-open-project="${id}">打开项目 <span>→</span></button>${custom && canManage() ? `<button class="quiet-icon" data-copy-project="${id}" title="复制项目">▣</button><button class="quiet-icon" data-archive-project="${id}" title="归档项目">⌑</button>` : ''}</div></article>`;
  }).join('') || '<div class="project-empty"><strong>没有找到项目</strong><span>调整搜索条件，或创建一个新项目。</span></div>';
}
function render() {
  if (!events[state.eventId]) state.eventId = 'showcase';
  if (state.user && !roleNames[state.user.role]) state.user = null;
  const event = currentEvent();
  const venue = state.chosenVenue ? { name: state.chosenVenue.name, capacity: state.chosenVenue.capacity } : event.venue;
  const used = event.used + (state.eventId === state.resolvedEvent ? state.extraCost : 0);
  const completedCount = event.tasks.filter((task, index) => taskStatus(state.eventId, index, task) === 'done').length;
  const inProgressCount = event.tasks.filter((task, index) => taskStatus(state.eventId, index, task) === 'progress').length;
  const todo = event.tasks.length - completedCount - inProgressCount;
  const risks = riskRecords(event);
  if (state.incident && !state.resolved) risks.push({ name: '活动场地临时不可用', level: '高', phase: 'execute', probability: 4, impact: 5, score: 20, due: '活动前立即', owner: '活动组织者', trigger: '原定场地无法进入或不能满足活动安全与使用条件。', prevention: '在活动前确认场地状态并保留可用的替代场地与联络人。', response: '暂停受影响任务，确认人员安全，按人数、时段和预算筛选可用替代场地并通知任务负责人。', escalation: '短时间内无法确认替代场地时，由组织者通知参与者并决定调整时间、场地或活动形式。' });

  $('#activitySelect').innerHTML = Object.entries(events).map(([id, item]) => `<option value="${id}">${escapeHtml(item.name)}</option>`).join('');
  $('#activitySelect').value = state.eventId;
  const authenticated = Boolean(state.user?.name && state.user?.role);
  $('#authGate').classList.toggle('is-open', !authenticated);
  document.querySelector('.app-shell').setAttribute('aria-hidden', String(!authenticated));
  document.querySelector('.app-shell').inert = !authenticated;
  if (!authenticated) requestAnimationFrame(() => $('#loginName').focus());
  if (authenticated) {
    $('#profileName').textContent = state.user.name;
    $('#profileInitial').textContent = state.user.name.slice(0, 1);
    $('#profileRole').textContent = roleNames[state.user.role];
  }
  document.querySelectorAll('.organizer-only').forEach((el) => el.classList.toggle('hidden', !canManage()));
  document.querySelectorAll('.member-only').forEach((el) => el.classList.toggle('hidden', !canOperate()));
  if (state.page === 'home' || !authenticated) {
    $('#personalHome').classList.remove('hidden'); $('#projectWorkspace').classList.add('hidden');
    $('#projectNavigation').classList.add('hidden'); document.querySelectorAll('.project-only').forEach((el) => el.classList.add('hidden'));
    $('#crumbSep').classList.add('hidden'); $('#homeNav').classList.add('active');
  } else {
    $('#personalHome').classList.add('hidden'); $('#projectWorkspace').classList.remove('hidden');
    $('#projectNavigation').classList.remove('hidden'); document.querySelectorAll('.project-only').forEach((el) => el.classList.remove('hidden'));
    $('#crumbSep').classList.remove('hidden'); $('#homeNav').classList.remove('active');
  }
  $('#eventEyebrow').textContent = `${event.category} · ${formatDate(event.date)}`;
  $('#eventTitle').textContent = event.name;
  $('#eventDescription').textContent = `${event.guests} 位预计参与者 · ${event.start} - ${event.end} · ${event.budget.toLocaleString()} 元预算`;
  $('#daysToEvent').textContent = `活动日期：${formatDate(event.date, true)}`;
  $('#progressValue').innerHTML = `${Math.round(completedCount / event.tasks.length * 100)}<small>%</small>`;
  $('#progressBar').style.width = `${Math.round(completedCount / event.tasks.length * 100)}%`;
  $('#taskMetric').innerHTML = `${completedCount}<small> / ${event.tasks.length} 已完成</small>`;
  $('#taskMetricNote').textContent = `${inProgressCount} 项进行中 · ${todo} 项待开始`;
  $('#budgetMetric').innerHTML = `¥${used.toLocaleString()}<small> / ${event.budget.toLocaleString()}</small>`;
  $('#budgetBar').style.width = `${Math.min(100, used / event.budget * 100)}%`;
  $('#budgetRemaining').textContent = `剩余 ¥${Math.max(0, event.budget - used).toLocaleString()}`;
  $('#riskCount').innerHTML = `${risks.length}<small> 项</small>`;
  $('#highRiskSummary').textContent = `${risks.filter((risk) => risk.level === '高').length} 项高优先级`;
  const riskTotal = risks.length;
  $('#riskCountNav').textContent = riskTotal; $('#riskCountTab').textContent = riskTotal;
  $('#taskCountNav').textContent = event.tasks.length; $('#taskCountTab').textContent = event.tasks.length;
  $('#filterAll').textContent = event.tasks.length; $('#filterProgress').textContent = inProgressCount; $('#filterTodo').textContent = todo; $('#filterDone').textContent = completedCount;
  $('#venueName').textContent = venue.name;
  $('#venueTime').textContent = `◷ ${formatDate(event.date)} · ${event.start} - ${event.end}`;
  $('#venueCapacity').textContent = `♙ 容纳 ${venue.capacity} 人`;
  $('#venueState').innerHTML = state.resolved ? '<i></i> 已调整 <span>· 林同学</span>' : '<i></i> 已确认 <span>· 项目组</span>';
  $('#venueState').classList.toggle('unconfirmed', state.incident && !state.resolved);
  $('#incidentBanner').classList.toggle('hidden', !state.incident || state.resolved);
  $('#incidentDetails').textContent = `${event.venue.name} · ${formatDate(event.date)} ${event.start} - ${event.end} · 影响 ${event.tasks.filter((task) => task[5]).length} 项任务`;
  $('#taskListRows').innerHTML = event.tasks.slice(0, 6).map((task, index) => taskRow(task, index)).join('');
  $('#taskViewSummary').textContent = `${event.tasks.length} 项任务 · 按截止日期排序`;
  $('#tasksTableBody').innerHTML = event.tasks.map((task, index) => { const status = taskStatus(state.eventId, index, task); return `<tr><td>${escapeHtml(task[0])}${state.resolvedEvent === state.eventId && task[5] ? `<small class="task-location"> · ${escapeHtml(venue.name)}</small>` : ''}</td><td>${escapeHtml(task[1])}</td><td>${escapeHtml(task[2])}</td><td>${dateShort(task[3])}</td><td>${task[5] ? (state.resolvedEvent === state.eventId ? escapeHtml(venue.name) : '场地确认') : '—'}</td><td><span class="table-status ${status}">${statusName(status)}</span></td></tr>`; }).join('');
  $('#resourceTime').textContent = `${formatDate(event.date)} · ${event.start} - ${event.end}`;
  $('#attendeeCount').innerHTML = `${event.guests} 人 <small>/ 预计</small>`;
  $('#budgetLimit').textContent = `¥${event.budget.toLocaleString()}`;
  $('#resourcesTableBody').innerHTML = [
    [venue.name, '场地', venue.capacity, event.guests, venue.capacity >= event.guests ? '满足人数' : '容量不足'],
    ['执行小组', '人员', 4, 4, '已分配'], ['音视频设备', '设备', 6, 4, '待检查'], ['活动经费', '预算', `¥${event.budget}`, `¥${used}`, event.budget >= used ? '额度充足' : '超出预算']
  ].map((row) => `<tr>${row.map((cell, index) => `<td>${index === 4 ? `<span class="table-status ${cell === '容量不足' || cell === '超出预算' ? '' : 'done'}">${cell}</span>` : cell}</td>`).join('')}</tr>`).join('');
  renderRisks(event, risks);
  const timelineStart = new Date(`${event.date}T12:00:00`); timelineStart.setDate(timelineStart.getDate() - 6);
  $('#timelineDate').textContent = `${formatDate(timelineStart.toISOString().slice(0, 10), true)} - ${formatDate(event.date)}`;
  $('#timelineDays').innerHTML = Array.from({ length: 7 }, (_, i) => { const d = new Date(timelineStart); d.setDate(d.getDate() + i); return `<span class="${i === 3 ? 'today' : ''} ${i === 6 ? 'event-day' : ''}">${['周日','周一','周二','周三','周四','周五','周六'][d.getDay()]}<br><b>${d.getDate()}</b></span>`; }).join('');
  $('#timelineTrack').innerHTML = `<div class="timeline-line"></div>${event.tasks.filter((task) => task[5]).slice(0, 3).map((task, i) => `<div class="timeline-block ${['block-teal','block-gold','block-coral'][i]}" style="--start:${i * 2};--span:2"><b>${escapeHtml(task[0])}</b><small>${escapeHtml(task[2])}</small></div>`).join('')}`;
  $('#logList').innerHTML = state.logs.length ? [...state.logs].reverse().map((log) => `<article class="log-entry"><span class="log-time">${escapeHtml(log.time)}</span><div><strong>${escapeHtml(log.title)}</strong><p>${escapeHtml(log.detail)}</p></div><span class="log-tag">${escapeHtml(log.tag)}</span></article>`).join('') : '<div class="empty-log">还没有变更记录。模拟一次活动调整后，处理过程会记录在这里。</div>';
  renderLifecycle(event);
  renderMaterials(event);
  renderHome();
  $('#generateImageBtn').classList.toggle('hidden', !canOperate());
  $('#generatedImages').innerHTML = (state.generatedImages?.[state.eventId] || []).map((image) => `<a class="generated-image" href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.prompt)}"><span>${escapeHtml(image.model)} · ${escapeHtml(image.createdAt)}</span></a>`).join('');
  $('#simulateBtn').disabled = (state.incident && !state.resolved) || !canOperate();
  $('#simulateBtn').classList.toggle('hidden', !canOperate());
  $('#simulateBtn').innerHTML = state.incident && !state.resolved ? '<span>!</span> 正在处理变更' : '<span>⚡</span> 模拟场地取消';
  saveState();
}
function statusName(status) { return ({ done: '已完成', progress: '进行中', todo: '待开始' })[status]; }
function taskRow(task, index) {
  const status = taskStatus(state.eventId, index, task);
  return `<div class="task-row ${status === 'done' ? 'done' : status === 'progress' ? 'in-progress' : ''}"><span class="task-check">${status === 'done' ? '✓' : status === 'progress' ? '◔' : ''}</span><div class="task-main"><strong>${escapeHtml(task[0])}</strong><small>${escapeHtml(task[1])} · ${escapeHtml(task[2])}${state.resolvedEvent === state.eventId && task[5] ? ` · ${escapeHtml(state.chosenVenue.name)}` : ''}</small></div><span class="task-date">${dateShort(task[3])}</span><span class="task-status status-${status}">${statusName(status)}</span></div>`;
}
function showResolution() {
  if (!canOperate()) return;
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
document.querySelectorAll('[data-phase]').forEach((button) => button.addEventListener('click', () => {
  state.currentPhase = button.dataset.phase; render(); openView('lifecycle');
}));
$('#phaseTaskList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-task-index]'); if (!button || !canOperate()) return;
  const index = Number(button.dataset.taskIndex); const task = currentEvent().tasks[index];
  if (!task) return;
  state.taskStatuses[state.eventId] ||= {};
  state.taskStatuses[state.eventId][index] = taskStatus(state.eventId, index, task) === 'done' ? 'todo' : 'done';
  saveState(); render(); showToast('阶段任务状态已保存');
});
$('#phaseChecklist').addEventListener('change', (event) => {
  const input = event.target.closest('[data-phase-check]'); if (!input || !canOperate()) return;
  state.phaseChecks[state.eventId] ||= {};
  state.phaseChecks[state.eventId][input.dataset.phaseCheck] = input.checked;
  saveState();
});
document.querySelectorAll('#materialsGrid, #phaseMaterialList').forEach((container) => container.addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-material]');
  const download = event.target.closest('[data-download-material]');
  if (open) openMaterial(open.dataset.openMaterial);
  if (download) {
    const doc = materialById(download.dataset.downloadMaterial);
    if (doc) downloadText(`${currentEvent().name}-${doc.title}.md`, doc.content);
  }
}));
$('#materialForm').addEventListener('submit', (event) => {
  event.preventDefault(); if (!canOperate() || !editingMaterialId) return;
  state.materials[state.eventId] ||= {};
  state.materials[state.eventId][editingMaterialId] = $('#materialEditor').value;
  state.logs.push({ time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), title: `更新材料「${materialById(editingMaterialId).title}」`, detail: '编辑后的材料已保存在当前浏览器。', tag: '材料更新' });
  saveState(); $('#materialDialog').close(); render(); showToast('材料已保存');
});
$('#downloadMaterial').addEventListener('click', () => {
  const doc = editingMaterialId && materialById(editingMaterialId);
  if (doc) downloadText(`${currentEvent().name}-${doc.title}.md`, $('#materialEditor').value);
});
$('#downloadAllMaterials').addEventListener('click', () => {
  const combined = artifactDefinitions(currentEvent()).map((doc) => doc.content).join('\n\n---\n\n');
  downloadText(`${currentEvent().name}-全周期材料.md`, combined); showToast('全周期材料已导出');
});
$('#exportRiskPlan').addEventListener('click', () => {
  const doc = materialById('risk');
  if (doc) downloadText(`${currentEvent().name}-分级风险应急预案.md`, doc.content);
});
$('#closeMaterial').addEventListener('click', () => $('#materialDialog').close());
$('#cancelMaterial').addEventListener('click', () => $('#materialDialog').close());
$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.user = { name: String(form.get('name') || '').trim(), role: form.get('role') };
  if (!state.user.name || !roleNames[state.user.role]) { showToast('请输入显示名称并选择演示身份'); return; }
  state.page = 'home'; saveState(); render(); showToast(`已以${roleNames[state.user.role]}身份进入`);
});
$('#profileButton').addEventListener('click', () => {
  state.user = null; state.page = 'home'; saveState(); render(); $('#loginName').value = '';
  document.querySelector('input[name="role"][value="organizer"]').checked = true;
});
$('#activitySelect').addEventListener('change', (event) => {
  openProject(event.target.value);
});
$('#homeNav').addEventListener('click', showHome);
$('#homeBreadcrumb').addEventListener('click', showHome);
$('#projectSearch').addEventListener('input', renderHome);
$('#projectFilter').addEventListener('change', renderHome);
$('#projectList').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open-project]');
  const copy = event.target.closest('[data-copy-project]');
  const archive = event.target.closest('[data-archive-project]');
  if (open) openProject(open.dataset.openProject);
  if (copy && canManage()) {
    const sourceId = copy.dataset.copyProject; const source = events[sourceId];
    if (!source) return;
    const id = `event-${Date.now().toString(36)}`;
    events[id] = structuredClone(source); events[id].name = `${source.name}（副本）`;
    state.projectOwners[id] = state.user.name; saveState(); render(); showHome(); showToast('已复制项目，可继续修改安排');
  }
  if (archive && canManage()) {
    const id = archive.dataset.archiveProject;
    if (!window.confirm(`归档“${events[id]?.name}”？归档后会从项目列表隐藏。`)) return;
    state.archivedProjects[id] = true; saveState(); renderHome(); showToast('项目已归档');
  }
});
$('#simulateBtn').addEventListener('click', () => { if (!canOperate()) return; state.incident = true; saveState(); render(); showResolution(); });
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
  if (!canManage()) return;
  if (!window.confirm('重置会清除当前浏览器中的自建活动与变更记录，是否继续？')) return;
  Object.keys(events).filter((id) => !['showcase', 'welcome', 'forum'].includes(id)).forEach((id) => delete events[id]);
  state = { ...initialState, user: state.user, customEvents: {}, logs: [] };
  localStorage.removeItem(storageKey); render(); openView('overview'); showToast('演示项目已恢复初始状态');
});
$('#addTaskBtn').addEventListener('click', () => showToast('任务新建为演示入口，当前原型聚焦活动变更流程'));
$('#createProjectBtn').addEventListener('click', () => {
  if (!canManage()) return;
  $('#createEventError').textContent = '';
  const today = new Date(); const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  $('#createEventDate').min = todayIso;
  if (!$('#createEventDate').value || $('#createEventDate').value < todayIso) $('#createEventDate').value = dateOffset(todayIso, 14);
  $('#createEventDialog').showModal();
});
$('#closeCreateEvent').addEventListener('click', () => $('#createEventDialog').close());
$('#cancelCreateEvent').addEventListener('click', () => $('#createEventDialog').close());
$('#createEventForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!canManage()) return;
  const formData = new FormData(event.currentTarget);
  const values = Object.fromEntries(formData.entries());
  values.name = String(values.name || '').trim(); values.category = String(values.category || '').trim(); values.venue = String(values.venue || '').trim();
  const guests = Number(values.guests); const budget = Number(values.budget);
  if (!values.name || !values.category || !values.venue) {
    $('#createEventError').textContent = '请填写活动名称、类别和当前场地。'; return;
  }
  if (values.end <= values.start) {
    $('#createEventError').textContent = '结束时间要晚于开始时间。'; return;
  }
  if (!Number.isFinite(guests) || guests < 1 || !Number.isFinite(budget) || budget < 500) {
    $('#createEventError').textContent = '请检查人数与预算，预算至少为 500 元。'; return;
  }
  const eventId = `event-${Date.now().toString(36)}`;
  const dayBefore = dateOffset(values.date, -1); const eventDate = values.date;
  const dayAfter = dateOffset(values.date, 1);
  const tasks = [
    ['确认活动目标与流程', '策划', state.user.name, dateOffset(values.date, -7), 'todo'],
    ['发布活动通知与报名', '宣传', state.user.name, dateOffset(values.date, -5), 'todo'],
    ['确认场地与所需资源', '筹备', state.user.name, dateOffset(values.date, -3), 'todo'],
    ['现场搭建与设备检查', '执行', state.user.name, dayBefore, 'todo', true],
    ['活动执行与现场保障', '执行', state.user.name, eventDate, 'todo', true],
    ['整理反馈并完成复盘', '收尾', state.user.name, dayAfter, 'todo']
  ];
  const venues = [
    ['多功能活动室', Math.max(60, Math.min(120, Math.ceil(guests / 60) * 60)), true, Math.round(budget * .08)],
    ['综合楼报告厅', Math.max(200, guests), true, Math.round(budget * .14)],
    ['学生活动中心', Math.max(500, guests), false, Math.round(budget * .22)],
    ['体育馆', Math.max(1000, guests), true, Math.round(budget * .35)]
  ];
  events[eventId] = {
    name: values.name.trim(), category: values.category.trim(), date: eventDate, start: values.start, end: values.end,
    guests, budget, used: 0, venue: { name: values.venue.trim(), capacity: guests }, tasks,
    risks: [['参与人数或需求变化', '中', `${dateShort(dayBefore)} · ${state.user.name}`, '在报名截止前复核人数与资源需求']], venues
  };
  state.projectOwners[eventId] = state.user.name;
  state.eventId = eventId; state.page = 'home'; state.incident = false; state.resolved = false; state.chosenVenue = null; state.extraCost = 0; state.resolvedEvent = null;
  state.logs.push({ time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), title: `创建活动「${events[eventId].name}」`, detail: `活动日期 ${dateShort(eventDate)}，预计 ${guests} 人参加，预算上限 ¥${budget.toLocaleString()}。`, tag: '新建活动' });
  saveState(); $('#createEventDialog').close(); event.currentTarget.reset(); render(); showHome(); showToast('项目已创建，可从项目列表进入工作台');
});
document.querySelectorAll('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
  document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
  chip.classList.add('active');
  const filter = chip.textContent.trim().split(' ')[0];
  document.querySelectorAll('#tasksTableBody tr').forEach((row) => { row.hidden = filter !== '全部' && !row.querySelector('.table-status').textContent.startsWith(filter.replace('待开始', '待开始')); });
}));

$('#generateTextBtn').addEventListener('click', async () => {
  if (!canOperate() || !editingMaterialId) return;
  const button = $('#generateTextBtn'); const status = $('#textAiStatus');
  button.disabled = true; status.textContent = '正在请求 DeepSeek…';
  try {
    const response = await fetch('/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('#materialTitle').textContent, instruction: $('#aiInstruction').value.trim(), content: $('#materialEditor').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
    $('#materialEditor').value = result.text;
    status.textContent = '草稿已放入编辑区，核对后再保存。';
  } catch (error) { status.textContent = error.message || '文案生成失败'; }
  finally { button.disabled = false; }
});
$('#generateImageBtn').addEventListener('click', async () => {
  if (!canOperate()) return;
  const event = currentEvent(); const prompt = $('#imagePrompt').value.trim();
  const status = $('#imageStatus'); const button = $('#generateImageBtn');
  if (!prompt) { status.textContent = '请先填写画面描述。'; $('#imagePrompt').focus(); return; }
  button.disabled = true; status.textContent = '正在请求 YosHub…';
  try {
    const response = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `为校园活动“${event.name}”创作宣传视觉。${prompt}。不要生成未提供的时间、地点、主办方、品牌、二维码、数字或可读文字。`, size: '1024x1024' }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
    state.generatedImages[state.eventId] ||= [];
    state.generatedImages[state.eventId].unshift({ url: result.url, model: result.model, prompt, createdAt: new Date().toLocaleString('zh-CN') });
    saveState(); $('#generatedImages').innerHTML = state.generatedImages[state.eventId].map((image) => `<a class="generated-image" href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.prompt)}"><span>${escapeHtml(image.model)} · ${escapeHtml(image.createdAt)}</span></a>`).join('');
    status.textContent = `图片已生成并保存到本机（${result.width} × ${result.height}）。`;
  } catch (error) { status.textContent = error.message || '图片生成失败'; }
  finally { button.disabled = false; }
});

render();
