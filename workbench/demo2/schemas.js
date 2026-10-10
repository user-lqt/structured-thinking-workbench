/* 工作台数据契约：项目信息表 / 任务分解 / 阶段门禁 / 方案比选 / 风险台账
 * 产出（材料）章节定义在 materials.js 中，通过 window.SKILLS.materials 挂载。
 */
window.SKILLS = {
  manifest: {
    title: '项目信息表',
    version: '2.0',
    spec: 'manifest.spec.md',
    sections: [
      {
        id: 'basic',
        label: '一、活动基本信息',
        kind: 'fields',
        fields: [
          { key: 'type', label: '活动类型', type: 'enum', required: true, options: ['科技文化节', '运动会', '迎新系列', '竞赛选拔', '其他'] },
          { key: 'name', label: '活动名称', type: 'text', required: true, placeholder: '如：2026 校园科技文化节' },
          { key: 'days', label: '活动日期', type: 'days', required: true, hint: '只选哪天办，可多天；每个时间段几点到几点、做什么，去「活动安排」填。倒计时与甘特按第一天排' },
          { key: 'venue', label: '活动地点', type: 'text', placeholder: '如：科创中心报告厅' },
          { key: 'venueBackup', label: '备用地点', type: 'text', placeholder: '雨天 / 场地冲突时的替代场地' },
          { key: 'guests', label: '预计人数', type: 'number', hint: '含观众、选手与工作人员' },
          { key: 'budget', label: '预算上限（元）', type: 'number' },
          { key: 'organizer', label: '主办单位', type: 'text', placeholder: '如：校学生会' },
          { key: 'coOrganizer', label: '承办 / 协办单位', type: 'text' },
          { key: 'approval', label: '审批要求', type: 'text', placeholder: '如：需报校团委审批' },
          { key: 'audience', label: '目标受众', type: 'text' },
          { key: 'goal', label: '核心目标', type: 'textarea', hint: '写成可核验的目标，不超过 60 字' },
          { key: 'content', label: '活动内容与形式', type: 'textarea', hint: '可自由描述核心环节、亮点与参与方式' },
          { key: 'constraint', label: '已知约束', type: 'textarea', hint: '如不可占用的场地、不可使用的经费科目、硬性时间限制' }
        ]
      },
      {
        id: 'outputs',
        label: '二、产出配置',
        kind: 'checks',
        hint: '勾选的产出会决定后续阶段生成哪些任务与材料',
        items: [
          { key: 'application', label: '活动申报表', phase: 'plan', skill: 'activity-application', kind: 'table' },
          { key: 'proposal', label: '活动策划书', phase: 'plan', skill: 'activity-proposal', kind: 'document', core: true },
          { key: 'optionDecision', label: '方案比选决策矩阵', phase: 'plan', skill: 'decision-matrix', kind: 'structure' },
          { key: 'budgetSheet', label: '预算表', phase: 'plan', skill: 'budget-sheet', kind: 'table' },
          { key: 'venuePlan', label: '场地与资源方案', phase: 'plan', skill: 'venue-plan', kind: 'document' },
          { key: 'staffing', label: '组织分工与职责表', phase: 'plan', skill: 'staffing-plan', kind: 'table' },

          { key: 'poster', label: '海报 / 宣传图', phase: 'prepare', skill: 'poster', kind: 'graphic', core: true },
          { key: 'promoCopy', label: '宣传文案', phase: 'prepare', skill: 'promo-copy', kind: 'document' },
          { key: 'signup', label: '报名表 / 报名页', phase: 'prepare', skill: 'signup-form', kind: 'table' },
          { key: 'invitation', label: '邀请函 / 通知稿', phase: 'prepare', skill: 'invitation', kind: 'document' },
          { key: 'materialList', label: '物料清单', phase: 'prepare', skill: 'material-list', kind: 'table' },
          { key: 'shift', label: '排班表', phase: 'prepare', skill: 'shift-table', kind: 'table' },
          { key: 'training', label: '志愿者培训提纲', phase: 'prepare', skill: 'training-brief', kind: 'document' },
          { key: 'riskPlan', label: '风险应急预案', phase: 'prepare', skill: 'risk-plan', kind: 'document', core: true },

          { key: 'runbook', label: '现场执行手册', phase: 'execute', skill: 'runbook', kind: 'document', core: true },
          { key: 'attendance', label: '签到表', phase: 'execute', skill: 'attendance', kind: 'table' },
          { key: 'liveLog', label: '现场记录表', phase: 'execute', skill: 'live-log', kind: 'table' },

          { key: 'review', label: '复盘报告', phase: 'close', skill: 'review-report', kind: 'document', core: true },
          { key: 'news', label: '新闻稿 / 感谢信', phase: 'close', skill: 'news-release', kind: 'document' },
          { key: 'settlement', label: '经费决算表', phase: 'close', skill: 'settlement', kind: 'table' },
          { key: 'archive', label: '资料归档清单', phase: 'close', skill: 'archive-list', kind: 'table' }
        ]
      }
    ]
  },

  wbs: {
    title: '全周期任务分解表',
    version: '2.0',
    spec: 'wbs.spec.md',
    kind: 'matrix',
    phases: [
      { value: 'plan', label: '前期策划', window: 'D-30 ~ D-15', owner: '策划组' },
      { value: 'prepare', label: '活动筹备', window: 'D-14 ~ D-1', owner: '筹备组' },
      { value: 'execute', label: '现场执行', window: 'D-Day', owner: '执行组' },
      { value: 'close', label: '活动收尾', window: 'D+1 ~ D+7', owner: '收尾组' }
    ],
    statuses: [
      { value: 'todo', label: '未开始' },
      { value: 'doing', label: '进行中' },
      { value: 'blocked', label: '受阻' },
      { value: 'done', label: '已完成' }
    ],
    columns: [
      { key: 'phase', label: '阶段', type: 'enum', locked: true, width: '112px' },
      { key: 'task', label: '任务', type: 'text', width: '240px' },
      { key: 'owner', label: '负责角色', type: 'text', width: '100px' },
      { key: 'due', label: '相对时间', type: 'text', width: '90px' },
      { key: 'duration', label: '工期(天)', type: 'number', width: '76px' },
      { key: 'output', label: '产出物', type: 'text', width: '180px' },
      { key: 'depends', label: '前置任务', type: 'text', width: '160px' },
      { key: 'status', label: '状态', type: 'enum', locked: true, width: '92px' },
      { key: 'progress', label: '完成度%', type: 'number', width: '82px' },
      { key: 'milestone', label: '里程碑', type: 'enum', locked: true, width: '86px' },
      { key: 'source', label: '来源', type: 'enum', locked: true, width: '88px' }
    ]
  },

  gates: {
    hint: '阶段检查点是进入下一阶段的前置条件；项目数据里有证据的项会自动勾上，你也可以手动改，取消过之后不再自动覆盖。',
    plan: [
      { id: 'goal', label: '核心目标已写成可核验的指标' },
      { id: 'scope', label: '活动对象、规模与形式已确定' },
      { id: 'venue', label: '场地已确认，并明确了备用场地' },
      { id: 'budget', label: '预算方案已评审且未超上限' },
      { id: 'staffing', label: '组织分工与责任人角色已明确' },
      { id: 'approval', label: '申报与审批材料已提交' },
      { id: 'option', label: '关键方案已完成比选并记录决策依据' }
    ],
    prepare: [
      { id: 'promo', label: '宣传物料已发布，报名入口可访问' },
      { id: 'signup', label: '报名已截止并完成名单统计' },
      { id: 'material', label: '物料、设备已到位并完成清点' },
      { id: 'shift', label: '排班与岗位交接已确认到人' },
      { id: 'train', label: '志愿者与工作人员已完成培训' },
      { id: 'risk', label: '风险预案已复审，应急联络畅通' },
      { id: 'final', label: '已开筹备收口会，确认执行手册版本' }
    ],
    execute: [
      { id: 'setup', label: '场地布置与设备调试完成' },
      { id: 'checkin', label: '签到与引导岗位就位' },
      { id: 'rundown', label: 'Rundown 与计时机制已启动' },
      { id: 'log', label: '现场记录与影像采集已开启' },
      { id: 'emergency', label: '应急通道、医疗点、对讲频道已确认' },
      { id: 'close', label: '撤场与物资回收完成，无遗留物品' }
    ],
    close: [
      { id: 'settle', label: '经费完成决算，票据齐全' },
      { id: 'return', label: '借用物资与设备已归还' },
      { id: 'review', label: '复盘会已召开并形成结论' },
      { id: 'riskReview', label: '风险处置情况已逐项复盘' },
      { id: 'news', label: '新闻稿与致谢已发布' },
      { id: 'archive', label: '资料与影像已归档并移交' }
    ]
  },

  decision: {
    title: '方案比选决策矩阵',
    scale: [
      { value: 1, label: '1 很差' },
      { value: 2, label: '2 较差' },
      { value: 3, label: '3 一般' },
      { value: 4, label: '4 较好' },
      { value: 5, label: '5 很好' }
    ],
    presetCriteria: [
      { key: 'goal', label: '目标契合度', weight: 5, hint: '是否直接支撑核心目标' },
      { key: 'feasible', label: '可行性', weight: 4, hint: '时间、场地、人力是否支撑得住' },
      { key: 'cost', label: '成本可控', weight: 3, hint: '预算内且弹性足够' },
      { key: 'risk', label: '风险可控', weight: 4, hint: '安全、合规、舆情风险是否可接受' },
      { key: 'impact', label: '参与体验', weight: 4, hint: '对目标受众的吸引力' },
      { key: 'reuse', label: '可复用性', weight: 2, hint: '能否沉淀为下次可复用的做法' }
    ],
    presetOptions: ['方案 A：主会场集中式', '方案 B：分会场分布式', '方案 C：线上线下混合']
  },

  risk: {
    title: '风险台账与分级应急预案',
    version: '2.0',
    kind: 'risk',
    categories: [
      { value: 'safety', label: '安全与秩序' },
      { value: 'health', label: '人员与健康' },
      { value: 'venue', label: '场地与设施' },
      { value: 'tech', label: '技术与网络' },
      { value: 'program', label: '内容与流程' },
      { value: 'weather', label: '天气与环境' },
      { value: 'finance', label: '财务与物资' },
      { value: 'compliance', label: '合规与审批' },
      { value: 'publicity', label: '宣传与舆情' },
      { value: 'participation', label: '参与与体验' }
    ],
    probabilityAnchors: ['极低', '较低', '中等', '较高', '很高'],
    impactAnchors: ['可忽略', '轻微', '中等', '较高', '很严重'],
    levels: [
      { value: 'high', label: '高风险', min: 15, note: '活动总协调立即介入；涉及人身安全先暂停或疏散，通知校方保障或急救；未经风险复核与负责人确认不得恢复。' },
      { value: 'medium', label: '中风险', min: 8, note: '责任人执行预防或替代方案，向总协调报告进度；超时或影响扩大时升级为高风险流程。' },
      { value: 'low', label: '低风险', min: 0, note: '责任人跟踪并记录；触发条件改变时重新评估可能性与影响。' }
    ],
    escalation: '发现人 → 任务负责人 → 现场总协调 → 活动组织者 → 校方保障 / 相关部门（必要时 110 / 120 / 119）',
    coverage: {
      minPerPhase: 2,
      minCategories: 6,
      highRange: [2, 5],
      lowMin: 3,
      requiredCategories: ['compliance'],
      hint: '四个阶段每阶段至少 2 项；至少覆盖 6 个风险类别，其中必须包含合规类；高风险 2–5 项；低风险至少 3 项。'
    },
    fields: [
      { key: 'trigger', label: '触发信号', hint: '可观察的预警指标' },
      { key: 'prevention', label: '预防措施', hint: '规避 / 减轻 / 转移 / 接受' },
      { key: 'response', label: '现场响应', hint: '第一时间的处置动作' },
      { key: 'escalation', label: '升级路径', hint: '升级条件、对象、授权人' }
    ]
  }
};
