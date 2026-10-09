/* 填写路线图：把「从空项目到能导出材料」拆成有顺序的几步。
   每一步「做没做完」全部由项目数据推断，不需要人手动打勾；当前该做哪一步也由数据算出来。
   总览的「填写路线图」卡片与顶栏的引导按钮共用这里的 progress()，判断只有一份。 */
window.WB = window.WB || {};

(function () {
  const U = window.WB.util;
  const { BASIC_FIELDS, OUTPUT_ITEMS, PHASES } = U;

  /* 「待确认」这类占位词表示这项还没定，不能算「这步做完了」 */
  const has = (value) => U.filled(value);
  const basicOf = (state) => state.project?.basic || {};
  const outputsOf = (state) => OUTPUT_ITEMS.filter((item) => state.project?.outputs?.[item.key]);
  const materialsOf = (state) => outputsOf(state).filter((item) => state.materials?.[item.key]);

  /* 四个阶段的检查点合计，与「阶段检查点」视图同源 */
  function gateTally(state) {
    return PHASES.reduce((acc, phase) => {
      const stats = window.WB.wbs.gateStats(state.gates?.[phase.value], phase.value);
      return { done: acc.done + stats.done, total: acc.total + stats.total };
    }, { done: 0, total: 0 });
  }

  /* 每一步：title 是一句话目标，why 解释为什么排在这，detail 写出当前进度，
     target 交给 app.js 的跳转，cta 是按钮文案。done 只看项目数据，不看用户有没有点过什么。 */
  const STEPS = [
    {
      id: 'basic',
      title: '填写活动基本信息',
      why: '活动类型、名称、日期是后面所有推导（任务、风险、材料）的起点。',
      cta: '去填基本信息',
      target: { view: 'manifest' },
      done: (state) => BASIC_FIELDS.filter((field) => field.required).every((field) => has(basicOf(state)[field.key])),
      detail: (state) => {
        const missing = BASIC_FIELDS.filter((field) => field.required && !has(basicOf(state)[field.key]));
        if (missing.length) return `还差必填：${missing.map((field) => field.label).join(' / ')}`;
        const filled = BASIC_FIELDS.filter((field) => has(basicOf(state)[field.key])).length;
        return `必填项齐了，已填 ${filled}/${BASIC_FIELDS.length} 个字段`;
      }
    },
    {
      id: 'outputs',
      title: '勾选这次要产出的材料',
      why: '勾了哪些，后面就按哪些准备任务、风险与材料。',
      cta: '去勾选产出',
      target: { view: 'manifest' },
      done: (state) => outputsOf(state).length > 0,
      detail: (state) => {
        const list = outputsOf(state);
        if (!list.length) return '还没有勾选任何产出';
        const core = list.filter((item) => item.core).length;
        return `已勾选 ${list.length} 份${core ? `（含 ${core} 份核心产出）` : ''}`;
      }
    },
    {
      id: 'wbs',
      title: '生成任务分解',
      why: '把活动拆成带负责人、时间与产出物的任务，后面才排得了资源、挂得上风险。',
      cta: '去生成任务分解',
      target: { view: 'tasks', taskView: 'table' },
      done: (state) => {
        const rows = state.wbs || [];
        return rows.length > 0 && PHASES.every((phase) => rows.some((row) => row.phase === phase.value));
      },
      detail: (state) => {
        const rows = state.wbs || [];
        if (!rows.length) return '还没有任务分解表';
        const covered = PHASES.filter((phase) => rows.some((row) => row.phase === phase.value)).length;
        return `${rows.length} 条任务，覆盖 ${covered}/${PHASES.length} 个阶段`;
      }
    },
    {
      id: 'risk',
      title: '生成风险台账与应急预案',
      why: '任务排好之后，才看得出每个环节可能出什么问题。',
      cta: '去生成风险清单',
      target: { view: 'risk' },
      done: (state) => (state.risks || []).length > 0 && window.WB.risk.coverage(state.risks || [], state.wbs || []).ok,
      detail: (state) => {
        const risks = state.risks || [];
        if (!risks.length) return '还没有风险台账';
        const check = window.WB.risk.coverage(risks, state.wbs || []);
        return check.ok ? `${risks.length} 项风险，覆盖度自检通过` : `${risks.length} 项风险，还有 ${check.issues.length} 项待改进`;
      }
    },
    {
      id: 'resources',
      title: '登记人员与资源台账',
      why: '人员、场地、设备、物料、经费、车辆登记好，才看得出占用冲突。',
      cta: '去登记资源',
      target: { view: 'resources' },
      done: (state) => (state.resources || []).length > 0,
      detail: (state) => {
        const list = state.resources || [];
        if (!list.length) return '还没有资源台账';
        const conflicts = list.filter((item) => Number(item.assigned) > Number(item.available)).length;
        return `${list.length} 项资源${conflicts ? `，${conflicts} 处占用冲突待调整` : '，没有占用冲突'}`;
      }
    },
    {
      id: 'signup',
      title: '（可选）开启参与者信息收集',
      why: '校内小活动要收集参与者信息时再用：字段自己定，发二维码给参与者扫，现场提交实时进表。',
      cta: '去设置收集',
      optional: true,
      target: { view: 'signup' },
      done: (state) => Boolean(state.signup?.enabled),
      detail: (state) => {
        const collect = state.signup;
        if (!collect?.enabled) return '可选：需要收集报名 / 签到信息时再开，关着不产生任何数据';
        const total = (collect.records || []).length;
        if (!total) return '已开启，还没有收到提交：把二维码或链接发出去';
        const checkins = (collect.records || []).filter((record) => record.checkinAt).length;
        return `已收到 ${total} 份${checkins ? `，签到 ${checkins} 人` : ''}`;
      }
    },
    {
      id: 'assets',
      title: '登记文案与图片素材',
      why: '生成宣传类材料时会作为上下文；这一步是可选的，随时能补。',
      cta: '去登记素材',
      optional: true,
      target: { view: 'assets' },
      done: (state) => (state.assets || []).length > 0,
      detail: (state) => ((state.assets || []).length ? `已登记 ${(state.assets || []).length} 项素材` : '可以跳过，之后随时补')
    },
    {
      id: 'materials',
      title: '逐份生成过程材料',
      why: '前面填的事实与任务都会作为生成上下文；有参考样表就上传后按原表填值导出。',
      cta: '去生成材料',
      target: { view: 'material', phase: 'all' },
      done: (state) => {
        const chosenList = outputsOf(state);
        return chosenList.length > 0 && materialsOf(state).length === chosenList.length;
      },
      detail: (state) => {
        const chosenList = outputsOf(state);
        if (!chosenList.length) return '先去勾选要产出的材料';
        const done = materialsOf(state).length;
        const pending = chosenList.find((item) => !state.materials?.[item.key]);
        const refs = chosenList.filter((item) => state.references?.[item.key]).length;
        return `已生成 ${done}/${chosenList.length} 份${refs ? `，其中 ${refs} 份挂了参考件` : ''}${pending ? `；下一份：${pending.label}` : ''}`;
      }
    },
    {
      id: 'gates',
      title: '确认阶段检查点',
      why: '进入下一阶段前的最后一道闸；能从项目数据推断的会自动打勾，其余需要你确认。',
      cta: '去确认检查点',
      target: { view: 'tasks', taskView: 'gate', phase: 'plan' },
      done: (state) => {
        const tally = gateTally(state);
        return tally.total > 0 && tally.done === tally.total;
      },
      detail: (state) => {
        const tally = gateTally(state);
        if (!tally.total) return '还没有任务分解，先完成第 3 步';
        return `已确认 ${tally.done}/${tally.total} 项`;
      }
    }
  ];

  function steps(state) {
    return STEPS.map((step, index) => ({
      ...step,
      index: index + 1,
      status: step.done(state) ? 'done' : 'todo',
      detail: step.detail(state)
    }));
  }

  function progress(state) {
    const list = steps(state);
    const required = list.filter((step) => !step.optional);
    const done = required.filter((step) => step.status === 'done').length;
    const current = required.find((step) => step.status !== 'done') || null;
    return {
      steps: list,
      required,
      done,
      total: required.length,
      current,
      allDone: !current,
      percent: required.length ? Math.round((done / required.length) * 100) : 0
    };
  }

  window.WB.guide = { STEPS, steps, progress, current: (state) => progress(state).current };
}());
