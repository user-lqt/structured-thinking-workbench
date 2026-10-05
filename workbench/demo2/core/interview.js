/* 访谈式补全：按活动类型与已填信息生成追问清单，答完把答案写回仍空白的字段。
 * 离线可用：问题来自本地题库，内容全部由用户自己回答，不编造任何事实。
 * 在线时 AI 只做两件事：追加更贴合本项目的追问、把回答整理成通顺的成稿。 */
window.WB = window.WB || {};

(function () {
  const U = window.WB.util;
  const { BASIC_FIELDS, text } = U;

  const FIELD = Object.fromEntries(BASIC_FIELDS.map((field) => [field.key, field]));
  /* 这三项是多句话的文本区：生成时把该字段的当前内容一并交给 AI（本地成稿则并进句子），勾选写回时整段替换；其余字段只填空、绝不覆盖 */
  const COMPOSED_KEYS = ['goal', 'content', 'constraint'];
  /* AI 追问只允许落到这些字段，保证答案一定能被写回表单 */
  const AI_KEYS = ['goal', 'content', 'constraint', 'audience', 'venueBackup', 'coOrganizer', 'approval', 'budget', 'guests', 'start', 'end'];

  /* 按活动类型追问「活动内容与形式」——这才是这次活动独有的信息 */
  const TYPE_PROBES = {
    '科技文化节': [
      { id: 'content-area', key: 'content', ask: '展区或舞台分成哪些板块？主题是什么？', why: '板块不清，场地分区、摊位和用电都排不出来', hint: '例如：创客展区 / 舞台演出 / 互动体验' },
      { id: 'content-interact', key: 'content', ask: '有哪些参与方式或互动环节？', why: '没有互动，观众逛十分钟就走，人数指标也做不实', hint: '例如：打卡集章、工作坊、投票评比' }
    ],
    '运动会': [
      { id: 'content-events', key: 'content', ask: '比赛项目与赛制怎么安排？', why: '赛制不清，赛程天数、裁判和器材清单都定不下来', hint: '例如：田径 12 项 + 趣味项目，预赛决赛两天' },
      { id: 'content-weather', key: 'content', ask: '遇到下雨或大风怎么调整？', why: '没有天气方案，当天只能临时延期或取消', hint: '例如：转体育馆，项目缩减为室内 6 项' }
    ],
    '迎新系列': [
      { id: 'content-station', key: 'content', ask: '迎新流程包含哪些站点或环节？', why: '站点顺序不清，人流动线和志愿者排班都会乱', hint: '例如：报到注册、宿舍引导、校园导览' },
      { id: 'content-scale', key: 'content', ask: '面向哪一级、多少人？分几批到场？', why: '批次不明，报到口会挤成一团', hint: '例如：2026 级本科新生约 3000 人，按学院分 4 批' }
    ],
    '竞赛选拔': [
      { id: 'content-rule', key: 'content', ask: '赛制与晋级规则是什么？', why: '规则不写死，晋级和申诉都会有争议', hint: '例如：初赛线上评审、决赛现场答辩' },
      { id: 'content-judge', key: 'content', ask: '评审标准与评委来源是什么？', why: '评分口径不公开，参赛队会觉得不公', hint: '例如：创新性 40% / 可行性 30% / 展示 30%' }
    ],
    '其他': [
      { id: 'content-core', key: 'content', ask: '核心环节按时间顺序有哪些？', why: '环节顺序不清，时间表和人员分工没法倒排', hint: '例如：开场致辞 → 主题分享 → 自由交流' }
    ]
  };

  /* 访谈主干：活动类型、名称、日期在向导弹窗里已必填，这里补齐其余要素。
     每条都带 why——「这一项不填会导致什么」，即追问的缺口；没有缺口的问题不该问。 */
  const CORE_QUESTIONS = [
    { key: 'type', ask: '这次活动属于哪一类？', why: '类型决定后面追问哪些细节：展区？赛制？批次？' },
    { key: 'name', ask: '活动的正式名称是什么？', why: '名称要出现在所有材料与海报标题上，写错得一份份改' },
    { key: 'date', ask: '活动在哪一天举行？', why: '日期是倒排任务和甘特图的起点' },
    { key: 'venue', ask: '主场地在哪里？', why: '场地决定容量、用电报备与审批链路' },
    { key: 'venueBackup', ask: '雨天或场地冲突时用哪个备用地点？', why: '没有备案，下雨当天只能延期或取消' },
    { key: 'guests', ask: '预计多少人参加？（含观众、选手与工作人员）', why: '人数决定物料、座位、志愿者与预算量级' },
    { key: 'budget', ask: '预算上限是多少元？', why: '上限决定场地和物料能选到什么档位' },
    { key: 'organizer', ask: '主办单位是？', why: '主办决定审批口径与对外署名' },
    { key: 'approval', ask: '需要走哪些审批？', why: '漏一项审批，场地或物料可能在活动前一天被卡' },
    { id: 'goal-main', key: 'goal', ask: '这次活动最想达成什么？用一句话说清。', why: '目标含糊，后面的任务、验收和复盘都没有依据', hint: '例如：让新生在两周内认识 3 个以上社团' },
    { id: 'goal-metric', key: 'goal', ask: '用什么指标判断目标达成了？', why: '没有指标，复盘只能说「办得挺好」', hint: '例如：参与人数 ≥ 500，满意度 ≥ 4.5/5' },
    { key: 'content' },
    { key: 'constraint', ask: '有哪些硬性约束？', why: '约束不写清，方案可能整体不成立：超时、超预算、违规', hint: '例如：不可占用某场地、经费不能用于礼品、22:00 前必须结束' }
  ];

  /* ── 参考库：每道题都给「常见做法」，点一下就填，不用从零想 ──
     内容按活动类型分，规模/预算给的是参考区间（点选后仍可改）。 */
  const GUIDES = {
    name: {
      samples: ['2026 校园科技文化节', '第 12 届校园运动会', '2026 级迎新系列活动', '大学生创新创业竞赛校内选拔']
    },
    venue: {
      byType: {
        '科技文化节': ['科创中心一层展厅与报告厅', '学生活动中心 201 与中庭', '图书馆前广场'],
        '运动会': ['校本部田径场', '体育馆（雨天备用）', '东区运动场'],
        '迎新系列': ['学生活动中心一层大厅', '各学院报到点', '体育馆'],
        '竞赛选拔': ['教学楼报告厅', '创新实验室', '图书馆学术厅']
      },
      samples: ['科创中心一层展厅与报告厅（含中庭）']
    },
    venueBackup: {
      samples: ['遇雨转到学生活动中心 201', '备用体育馆（需提前一天确认）', '改线上腾讯会议 + 物料自取']
    },
    guests: {
      chips: [
        { label: '小型 100–300', value: '200' },
        { label: '中型 300–800', value: '500' },
        { label: '大型 800–2000', value: '1500' },
        { label: '超大型 2000+', value: '3000' }
      ],
      note: '参考区间：按往届规模或场地容量估，点选后可以改成具体数字'
    },
    budget: {
      chips: [
        { label: '约 1 万', value: '10000' },
        { label: '约 3 万', value: '30000' },
        { label: '约 6 万', value: '60000' },
        { label: '约 12 万', value: '120000' }
      ],
      note: '参考档位：小型活动 0.5–1 万、中型 1–3 万、大型 3 万以上'
    },
    organizer: {
      samples: ['校学生会', '校团委', '学院学生会', '学生社团联合会']
    },
    approval: {
      chips: ['需报校团委审批', '场地申请单', '用电需报备', '消防与安保报备', '宣传物料需审核', '无需校级审批'],
      samples: ['需报校团委审批；涉及用电与消防需另行报备']
    },
    audience: {
      chips: ['大一新生', '全校学生', '参赛选手与评委', '教职工', '校友', '社团成员', '周边社区居民']
    },
    goal: {
      byType: {
        '科技文化节': {
          samples: [
            '让至少 600 名同学现场体验科创项目，活动后社团报名 ≥ 120 人',
            '展出社团成果 ≥ 40 件，参与打卡 ≥ 800 人次'
          ]
        },
        '运动会': {
          samples: [
            '覆盖 8 个学院、运动员 ≥ 400 人，完赛率 ≥ 90%，全程零安全事故',
            '参与人数 ≥ 1200，破纪录项目 ≥ 3 项'
          ]
        },
        '迎新系列': {
          samples: [
            '让新生在两周内完成报到并认识 3 个以上社团，服务满意度 ≥ 4.5/5',
            '报到流程人均等待 ≤ 20 分钟，绿色通道覆盖率 100%'
          ]
        },
        '竞赛选拔': {
          samples: [
            '收到 ≥ 60 份有效作品，选出 10 支队伍进入决赛，评审申诉 ≤ 1 例',
            '参赛队伍 ≥ 30 支，作品落地可行性评分平均 ≥ 3.5/5'
          ]
        }
      },
      chips: ['参与人数 ≥ 500', '满意度 ≥ 4.5/5', '新增报名 ≥ 100 人', '零安全事故', '覆盖 8 个学院', '沉淀可复用物料模板'],
      note: '写法（定条数 + 定顺序）：1 个可衡量的结果 + 1 个数字指标，先写目标再写衡量'
    },
    content: {
      byType: {
        '科技文化节': {
          chips: ['创客展区', '舞台演出', '互动体验区', '社团招新', '主题讲座', '打卡集章', '工作坊', '成果评比', '文创市集', '机器人/无人机演示'],
          samples: [
            '三个板块：一层创客展区（约 20 个社团展位）、报告厅舞台演出、中庭互动体验区；参与方式是打卡集章 + 工作坊报名。',
            '上午主题讲座与成果评比，下午社团展位互动与舞台演出，全天开放打卡集章兑奖。'
          ]
        },
        '运动会': {
          chips: ['田径 12 项', '趣味项目', '拔河', '4×100 接力', '开幕式方阵', '闭幕颁奖', '啦啦队表演', '教工组比赛'],
          samples: [
            '两天赛程：第一天预赛（田径 + 趣味 6 项），第二天决赛与闭幕颁奖；开幕式按学院方阵入场。',
            '半天紧凑版：4×100 接力、拔河、趣味闯关三项，结束现场颁奖；雨天转体育馆进行室内 6 项。'
          ]
        },
        '迎新系列': {
          chips: ['报到注册', '宿舍引导', '校园导览', '迎新晚会', '社团招新市集', '家长接待区', '行李寄存', '绿色通道'],
          samples: [
            '报到日流程：校门引导 → 报到注册 → 宿舍分流 → 校园导览；按学院分 4 批错峰到场。',
            '两天迎新：第一天报到注册与宿舍引导，第二天迎新晚会与社团招新市集。'
          ]
        },
        '竞赛选拔': {
          chips: ['线上初赛', '现场决赛', '答辩路演', '专家评审', '观众投票', '赛前培训', '赛后点评'],
          samples: [
            '两轮赛制：线上初赛提交作品（评审打分）→ 现场决赛答辩路演；评分创新性 40% / 可行性 30% / 展示 30%。',
            '单轮现场赛：抽题 → 90 分钟方案设计 → 5 分钟答辩；评委由 3 位专业教师 + 2 位企业导师组成。'
          ]
        }
      },
      chips: ['开场致辞', '主题分享', '自由交流', '分组讨论', '成果展示', '合影留念', '茶歇'],
      samples: [
        '开场致辞 → 主题分享 → 分组讨论 → 成果展示 → 合影留念，中间设 15 分钟茶歇。'
      ],
      note: '写法（定条数 + 定顺序）：3–5 个环节按时间先后写，再补一句参与方式'
    },
    constraint: {
      chips: ['22:00 前必须结束', '不可占用教学时间', '经费不可用于礼品', '不可使用食堂经费科目', '用电需提前报备', '禁止明火', '音量不超过 65 分贝', '户外活动受天气影响', '场地需提前 3 天申请', '不得占用人行通道'],
      samples: [
        '22:00 前必须结束；不可使用食堂经费科目；用电需提前 3 天报备。'
      ],
      note: '写法（不许推论）：只列真实存在的硬约束，常见的就在上面；没有就跳过这题'
    }
  };

  /* 追问句式工具箱（来自课程手册 4.4）：每类句式解决一种「说得不到位」，
     优先「依据 → 边界 → 替代」，连追 2–3 类即可，不必六类都用。 */
  const ASK_STYLES = ['依据', '前提', '反例', '边界', '替代', '自评'];

  const VAGUE_RE = /帮我想|帮我拟|你帮|你定|你看着办|不知道|不确定|不清楚|没想好|没想|随便|都行|无所谓|待确认/;
  /* AI 成稿里冒出的占位词一律不采用，保住用户原话拼出的本地成稿 */
  const PLACEHOLDER_RE = /待确认|待定|TBD|tbd|暂定|未确定|待补充/;
  const isPlaceholder = (value) => PLACEHOLDER_RE.test(text(value));

  const questionType = (key) => {
    const type = FIELD[key]?.type;
    return type === 'enum' ? 'enum' : type || 'text';
  };

  const probesFor = (type) => TYPE_PROBES[text(type)] || TYPE_PROBES['其他'];

  const normaliseChip = (item) => (typeof item === 'string'
    ? { label: item, value: item }
    : { label: text(item?.label) || text(item?.value), value: text(item?.value) || text(item?.label) });

  const isVague = (value) => VAGUE_RE.test(text(value));

  /* 这题给哪些参考：常见做法（点一下就填）+ 示例答案（可整段采用） */
  function guideFor(state, question) {
    const basic = state?.project?.basic || {};
    const type = text(basic.type) || '其他';
    const entry = GUIDES[question?.key];
    if (!entry) return null;
    const typed = entry.byType?.[type] || entry.byType?.['其他'] || null;
    const chips = (typed?.chips || entry.chips || []).map(normaliseChip).filter((chip) => chip.label && chip.value);
    const samples = (typed?.samples || entry.samples || []).map(text).filter(Boolean).slice(0, 3);
    const note = text(typed?.note || entry.note || '');
    if (!chips.length && !samples.length && !note) return null;
    return { key: question.key, type, chips, samples, note, fromAi: false };
  }

  /* 点选一个常见做法：单选字段直接替换，三个文本区做拼接 / 取消拼接 */
  function toggleChip(key, current, chip) {
    const value = text(typeof chip === 'string' ? chip : chip?.value);
    if (!value) return text(current);
    if (!COMPOSED_KEYS.includes(key)) return value;
    /* 先前写的是「你帮我想」这类模糊话：点参考时整段替换，不要拼在废话后面 */
    const base = isVague(current) ? '' : text(current);
    const parts = base.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean);
    const at = parts.indexOf(value);
    if (at >= 0) parts.splice(at, 1);
    else parts.push(value);
    return parts.join('；');
  }

  const chipsIn = (key, current) => {
    if (!COMPOSED_KEYS.includes(key)) return [];
    return text(current).split(/[；;\n]/).map((item) => item.trim()).filter(Boolean);
  };

  function vagueAnswers(questions = [], answers = {}) {
    return questions.filter((question) => isVague(answers[question.id]));
  }

  const withAiOptions = (guide, options) => {
    if (!guide || !Array.isArray(options) || !options.length) return guide;
    return { ...guide, samples: options.map(text).filter(Boolean).slice(0, 3), fromAi: true };
  };

  /* 让 AI 就这一题拟 2–3 版可直接采用的参考（在线时才走这里） */
  async function draftAi(state, question, answers) {
    if (!window.WB.ai?.ready || !question) return null;
    const basic = state?.project?.basic || {};
    const data = await window.WB.ai.run('intake', {
      mode: 'draft',
      活动类型: text(basic.type) || '未填',
      活动名称: text(basic.name) || '未填',
      活动日期: text(basic.date) || '未填',
      已填信息: Object.fromEntries(Object.entries(basic).filter(([, value]) => text(value))),
      当前字段: question.label,
      问题: question.ask,
      用户目前写的: text(answers?.[question.id]) || '（还没写，或写了「你帮我想」）',
      要求: '给 2–3 个可以直接采用的回答版本，贴合本项目的活动类型与规模；只做结构化建议，不要编造人名、单位、电话'
    }, window.WB.ai.intakeDraftContract());
    const options = Array.isArray(data?.options) ? data.options.map(text).filter(Boolean) : [];
    return options.length ? options.slice(0, 3) : null;
  }
  /* 只问还没有内容的字段；三类文本区即使已填写也会问，用于「重写」而不是追加 */
  function plan(state) {
    const basic = state?.project?.basic || {};
    const filled = (key) => text(basic[key]) !== '';
    const out = [];
    const push = (item) => {
      const key = item.key;
      out.push({
        id: item.id || key,
        key,
        label: FIELD[key]?.label || key,
        ask: item.ask,
        /* 缺口：这一项不填会导致什么——标题栏里直接写给用户看 */
        why: text(item.why),
        /* 追问句式：依据 / 前提 / 反例 / 边界 / 替代 / 自评（只有 AI 追问会带） */
        style: ASK_STYLES.includes(text(item.style)) ? text(item.style) : '',
        hint: item.hint || FIELD[key]?.hint || '',
        placeholder: item.placeholder ?? FIELD[key]?.placeholder ?? '',
        type: item.type || questionType(key),
        options: FIELD[key]?.options || [],
        filled: filled(key),
        ai: Boolean(item.ai)
      });
    };
    for (const item of CORE_QUESTIONS) {
      if (item.key === 'content') {
        for (const probe of probesFor(basic.type)) push(probe);
        continue;
      }
      const isText = COMPOSED_KEYS.includes(item.key);
      if (filled(item.key) && !isText) continue;
      push(item);
    }
    return out;
  }

  /* 多个追问落到同一个字段时按字段合并：目标写成「目标（衡量：…）」，其余用分号连句 */
  function composeParts(key, list) {
    const parts = list.map(text).filter(Boolean);
    if (!parts.length) return '';
    if (key === 'goal') return parts.length > 1 ? `${parts[0]}（衡量：${parts.slice(1).join('；')}）` : parts[0];
    return parts.join('；');
  }

  /* 把答案按字段归并成「拟填清单」；已填文本区先并进当前内容，由用户逐项确认是否整段替换 */
  function composeDraft(state, questions, answers = {}) {
    const basic = state?.project?.basic || {};
    const groups = [];
    for (const question of questions) {
      const value = text(answers[question.id]);
      /* 「你帮我想」「待确认」这类不算回答，直接跳过，避免把废话写进表单 */
      if (!value || isVague(value)) continue;
      let group = groups.find((item) => item.key === question.key);
      if (!group) {
        group = { key: question.key, label: question.label, values: [], sources: [] };
        groups.push(group);
      }
      group.values.push(value);
      group.sources.push(question.ai ? 'ai' : 'user');
    }
    const rows = [];
    for (const group of groups) {
      const current = text(basic[group.key]);
      /* 已填的文本区先把原话并进成稿：写回是整段替换，成稿里必须留住原来的信息 */
      const proposed = COMPOSED_KEYS.includes(group.key)
        ? composeParts(group.key, current ? [current, ...group.values] : group.values)
        : group.values.join('；');
      if (!proposed) continue;
      rows.push({
        key: group.key,
        label: group.label || FIELD[group.key]?.label || group.key,
        proposed,
        /* composeAi 要把原始回答交给 AI，这里必须带上，否则整理成稿会直接报错 */
        values: group.values.slice(),
        current,
        filled: current !== '',
        appendable: COMPOSED_KEYS.includes(group.key),
        source: group.sources.every((item) => item === 'ai') ? 'ai' : 'user'
      });
    }
    return rows;
  }

  /* 与向导、AI 合并共用同一套归一化：数字字段存数字，枚举值非法时写「待确认」 */
  function normaliseValue(key, value) {
    const field = FIELD[key];
    const convert = window.WB.ai?.normaliseValue;
    return field && typeof convert === 'function' ? convert(field, value) : value;
  }

  /* 空字段直接写入；已填的文本区仅在用户勾选后整段替换（生成时已经读过原内容）。
     其余已填字段一律不动——手写的事实类内容 AI 永远不覆盖。 */
  function apply(state, rows, choices = {}) {
    const project = state?.project;
    if (!project) return { applied: [], replaced: [], skipped: [] };
    /* 兜底：老项目包或手工改过的数据可能缺这两个容器，缺了就补上，避免写入时抛错 */
    project.basic ||= {};
    project.meta ||= {};
    project.meta.basic ||= {};
    const applied = [];
    const replaced = [];
    const skipped = [];
    for (const row of rows) {
      if (!choices[row.key] || !row.proposed) { skipped.push(row.key); continue; }
      if (row.filled) {
        if (!row.appendable) { skipped.push(row.key); continue; }
        /* 整段替换：清掉原有文本，用这条成稿覆盖（AI 已按原文重写，本地成稿也已并入原话） */
        project.basic[row.key] = normaliseValue(row.key, row.proposed);
        project.meta.basic[row.key] = row.source === 'ai' ? 'ai' : 'user';
        replaced.push(row.key);
        continue;
      }
      project.basic[row.key] = normaliseValue(row.key, row.proposed);
      project.meta.basic[row.key] = row.source === 'ai' ? 'ai' : 'user';
      applied.push(row.key);
    }
    return { applied, replaced, skipped };
  }

  /* 访谈草稿存在 state.ui.interview，随时关掉弹窗再打开都不会丢 */
  function draftOf(state) {
    if (!state.ui) state.ui = {};
    if (!state.ui.interview || typeof state.ui.interview !== 'object') state.ui.interview = { answers: {}, index: 0, aiAsked: false };
    const draft = state.ui.interview;
    if (!draft.answers || typeof draft.answers !== 'object') draft.answers = {};
    if (!Number.isFinite(draft.index)) draft.index = 0;
    return draft;
  }

  function resetDraft(state) {
    if (!state.ui) state.ui = {};
    state.ui.interview = { answers: {}, index: 0, aiAsked: false };
    return state.ui.interview;
  }

  /* AI 追问：只接受白名单字段，最多 5 条，避免问出写不回表单的问题 */
  function normaliseAiQuestions(raw, existing = []) {
    const list = Array.isArray(raw?.questions) ? raw.questions : [];
    const asked = new Set(existing.map((item) => item.ask));
    const answeredKeys = new Set(existing.filter((item) => item.filled).map((item) => item.key));
    const out = [];
    for (const item of list) {
      const key = text(item?.key);
      const ask = text(item?.ask);
      if (!ask || asked.has(ask) || !AI_KEYS.includes(key) || !FIELD[key]) continue;
      asked.add(ask);
      out.push({
        id: `ai-${key}-${out.length + 1}`,
        key,
        label: FIELD[key].label,
        ask,
        why: text(item.why),
        style: ASK_STYLES.includes(text(item.style)) ? text(item.style) : '',
        hint: text(item.hint),
        placeholder: '',
        type: questionType(key),
        options: FIELD[key].options || [],
        filled: answeredKeys.has(key),
        ai: true
      });
      if (out.length >= 5) break;
    }
    return out;
  }

  const aiContext = (state, questions, answers) => {
    const basic = state?.project?.basic || {};
    return {
      mode: 'ask',
      活动类型: text(basic.type) || '未填',
      活动名称: text(basic.name) || '未填',
      活动日期: text(basic.date) || '未填',
      已填信息: Object.fromEntries(Object.entries(basic).filter(([, value]) => text(value))),
      当前追问清单: questions.map((item) => ({ 字段: item.label, 问题: item.ask })),
      仍未回答: questions.filter((item) => !text(answers[item.id])).map((item) => item.ask),
      允许的字段: AI_KEYS
    };
  };

  async function askAi(state, questions, answers) {
    if (!window.WB.ai?.ready) return null;
    const data = await window.WB.ai.run('intake', aiContext(state, questions, answers), window.WB.ai.intakeAskContract());
    if (!data) return null;
    return normaliseAiQuestions(data, questions);
  }

  /* AI 成稿只作用于三个文本区（目标 / 内容 / 约束）。生成时把每个字段的「当前内容」一并喂给模型：
     写回是整段替换，模型必须先看过原文，才能既清掉旧文本又不丢已有信息。 */
  async function composeAi(state, rows) {
    if (!window.WB.ai?.ready || !rows.length) return null;
    const basic = state?.project?.basic || {};
    const data = await window.WB.ai.run('intake', {
      mode: 'compose',
      活动类型: text(basic.type),
      活动名称: text(basic.name),
      已填信息: basic,
      /* 直白的原文对照，形如「已知约束当前内容：22:00 前必须结束」 */
      当前内容: rows.filter((row) => row.current).map((row) => `${row.label}当前内容：${row.current}`),
      成稿字段: rows.map((row) => ({
        字段: row.label,
        当前内容: row.current || '（空）',
        本次回答: row.values.join(' / ')
      })),
      要求: '按「任务定制三条件」重写：①定条数——目标 1 条、内容 3–5 个环节、约束逐条列出；②定顺序——内容按时间先后，目标先写目标再写衡量；③不许推论——只用用户给出的事实。以「当前内容」为基础输出这一字段完整的替换版本，保留原文中仍然有效的信息；不要写「待确认」这类占位词，也不要写成新旧拼接'
    }, window.WB.ai.intakeComposeContract());
    if (!data?.basic) return null;
    return rows.map((row) => {
      if (!COMPOSED_KEYS.includes(row.key)) return row;
      const value = text(data.basic[row.key]);
      /* 占位词不算成稿，保留本地版本，避免把「待确认」写进表单 */
      if (!value || isPlaceholder(value)) return row;
      return { ...row, proposed: value, source: 'ai' };
    });
  }

  window.WB.interview = {
    plan,
    composeParts,
    composeDraft,
    apply,
    normaliseValue,
    draftOf,
    resetDraft,
    normaliseAiQuestions,
    askAi,
    composeAi,
    draftAi,
    guideFor,
    toggleChip,
    chipsIn,
    isVague,
    vagueAnswers,
    withAiOptions,
    probesFor,
    GUIDES,
    VAGUE_RE,
    ASK_STYLES,
    PLACEHOLDER_RE,
    isPlaceholder,
    COMPOSED_KEYS,
    AI_KEYS,
    CORE_QUESTIONS,
    TYPE_PROBES,
  };
}());