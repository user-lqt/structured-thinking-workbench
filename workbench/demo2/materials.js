/* 21 类产出（材料）的默认章节定义。
 * 每份材料的章节既可由这里提供，也可由用户上传的学校模板覆盖（模板优先级更高）。
 * kind: document 正文型 / table 表格型 / graphic 图形型
 */
window.SKILLS.materials = {
  'activity-application': {
    title: '活动申报表',
    kind: 'table',
    sections: [
      '一、活动基本信息',
      '二、活动内容与流程概要',
      '三、经费预算概要',
      '四、安全与保障措施',
      '五、审批流转记录'
    ]
  },
  'activity-proposal': {
    title: '活动策划书',
    kind: 'document',
    sections: [
      '一、活动背景与目标',
      '二、活动对象与规模',
      '三、活动内容与流程',
      '四、时间与场地安排',
      '五、组织分工',
      '六、预算与经费',
      '七、宣传与报名',
      '八、风险与应急预案'
    ]
  },
  'budget-sheet': {
    title: '预算表',
    kind: 'table',
    sections: [
      '一、预算总览',
      '二、分项预算明细',
      '三、经费来源与到位计划',
      '四、成本控制与审批流程'
    ]
  },
  'venue-plan': {
    title: '场地与资源方案',
    kind: 'document',
    sections: [
      '一、场地需求与选型',
      '二、场地布置方案',
      '三、设备与物资需求',
      '四、用电、消防与安全要求',
      '五、备用与切换方案'
    ]
  },
  'staffing-plan': {
    title: '组织分工与职责表',
    kind: 'table',
    sections: [
      '一、组织架构与指挥关系',
      '二、岗位职责表',
      '三、协作与汇报机制',
      '四、志愿者需求与来源'
    ]
  },
  'poster': {
    title: '海报 / 宣传图',
    kind: 'graphic',
    sections: [
      '一、海报文案',
      '二、视觉设计说明',
      '三、尺寸与投放渠道'
    ]
  },
  'promo-copy': {
    title: '宣传文案',
    kind: 'document',
    sections: [
      '一、宣传主题与核心信息',
      '二、主推文文案',
      '三、短文案（群通知 / 朋友圈 / 广播）',
      '四、发布节奏与渠道安排'
    ]
  },
  'signup-form': {
    title: '报名表 / 报名页',
    kind: 'table',
    sections: [
      '一、报名须知',
      '二、报名表单字段',
      '三、报名统计口径',
      '四、截止与确认流程'
    ]
  },
  'invitation': {
    title: '邀请函 / 通知稿',
    kind: 'document',
    sections: [
      '一、正式邀请函',
      '二、嘉宾接待与动线安排',
      '三、校内通知稿',
      '四、回执与跟进'
    ]
  },
  'material-list': {
    title: '物料清单',
    kind: 'table',
    sections: [
      '一、物料总览',
      '二、采购与制作清单',
      '三、领用与归还登记',
      '四、到场清点检查表'
    ]
  },
  'shift-table': {
    title: '排班表',
    kind: 'table',
    sections: [
      '一、排班总览',
      '二、分时段排班表',
      '三、岗位交接要求',
      '四、替补与请假机制'
    ]
  },
  'training-brief': {
    title: '志愿者培训提纲',
    kind: 'document',
    sections: [
      '一、培训目标与对象',
      '二、活动概况与当日流程',
      '三、岗位职责与通用话术',
      '四、应急处理要点',
      '五、培训安排与考核方式'
    ]
  },
  'risk-plan': {
    title: '风险应急预案',
    kind: 'document',
    sections: [
      '一、风险识别与分级规则',
      '二、风险清单与分级',
      '三、分级响应流程',
      '四、应急联络与资源保障',
      '五、演练与复盘要求'
    ]
  },
  'runbook': {
    title: '现场执行手册',
    kind: 'document',
    sections: [
      '一、总体时间轴',
      '二、分环节 Rundown',
      '三、岗位分工与通讯频道',
      '四、现场指挥与决策规则',
      '五、收场与撤场流程'
    ]
  },
  'attendance': {
    title: '签到表',
    kind: 'table',
    sections: [
      '一、签到说明与统计口径',
      '二、观众签到表',
      '三、工作人员签到表',
      '四、签到统计汇总'
    ]
  },
  'live-log': {
    title: '现场记录表',
    kind: 'table',
    sections: [
      '一、记录规则与填写责任',
      '二、时段记录表',
      '三、异常与处置记录',
      '四、影像素材登记'
    ]
  },
  'review-report': {
    title: '复盘报告',
    kind: 'document',
    sections: [
      '一、活动概况与目标达成',
      '二、数据回顾',
      '三、做得好与不足',
      '四、问题归因分析',
      '五、改进措施与责任分工',
      '六、下次可直接复用的清单'
    ]
  },
  'news-release': {
    title: '新闻稿 / 感谢信',
    kind: 'document',
    sections: [
      '一、新闻稿正文',
      '二、配图与素材说明',
      '三、致合作单位感谢信',
      '四、致志愿者与工作人员',
      '五、发布渠道与时间'
    ]
  },
  'settlement': {
    title: '经费决算表',
    kind: 'table',
    sections: [
      '一、决算总览',
      '二、分项决算明细',
      '三、预算与决算差异分析',
      '四、报销与凭证清单'
    ]
  },
  'archive-list': {
    title: '资料归档清单',
    kind: 'table',
    sections: [
      '一、归档范围与命名规则',
      '二、文档类归档清单',
      '三、影像与素材归档清单',
      '四、移交与保管要求'
    ]
  }
};
