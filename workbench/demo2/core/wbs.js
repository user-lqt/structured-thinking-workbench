/* 任务与进度：阶段统计、门禁检查、甘特排布。 */
window.WB = window.WB || {};

(function () {
  const { PHASES, PHASE_LABEL, GATES, parseDue, dateFromDue, fmtDate, daysToEvent } = window.WB.util;

  const taskState = (row) => window.WB.taskLifecycle.replay(row);

  function taskStats(rows) {
    const states = rows.map(taskState);
    const count = (status) => states.filter((item) => item.status === status).length;
    const done = count('accepted');
    return { total: rows.length, done, accepted: done, todo: count('todo'), doing: count('doing'), review: count('review'),
      blocked: states.filter((item) => item.blocked).length, verification: states.filter((item) => item.needsVerification).length,
      percent: rows.length ? Math.round(done / rows.length * 100) : 0 };
  }

  function phaseStats(rows, phase) {
    const items = rows.filter((row) => row.phase === phase);
    return { ...taskStats(items), items };
  }

  function overall(rows) {
    return {
      ...taskStats(rows),
      milestones: rows.filter((row) => row.milestone).length,
      milestonesDone: rows.filter((row) => row.milestone && taskState(row).status === 'accepted').length
    };
  }

  function gateStats(checked = {}, phase) {
    const items = GATES[phase] || [];
    const done = items.filter((item) => checked[item.id]).length;
    return { items, done, total: items.length, ok: items.length > 0 && done === items.length };
  }

  /* 甘特：把 D-N 转成真实日期，返回可绘制的条形 */
  function gantt(rows, eventDate) {
    const bars = [];
    for (const row of rows) {
      const start = dateFromDue(eventDate, row.due);
      if (!start) continue;
      const span = Math.max(1, Number(row.duration) || 1);
      const end = new Date(start);
      end.setDate(end.getDate() + span - 1);
      bars.push({ row, start, end, span });
    }
    if (!bars.length) return { bars: [], start: null, end: null, days: 0 };

    const starts = bars.map((bar) => bar.start.getTime());
    const ends = bars.map((bar) => bar.end.getTime());
    const event = eventDate ? new Date(`${eventDate}T00:00:00`).getTime() : null;
    const all = [...starts, ...ends, ...(Number.isFinite(event) ? [event] : [])];
    const min = new Date(Math.min(...all));
    const max = new Date(Math.max(...all));
    min.setDate(min.getDate() - 1);
    max.setDate(max.getDate() + 1);
    const days = Math.max(1, Math.round((max - min) / 86_400_000) + 1);
    return { bars, start: min, end: max, days };
  }

  function offsetDays(from, to) {
    return Math.round((to - from) / 86_400_000);
  }

  /* 关键节点：里程碑 + 各阶段最早/最晚任务 */
  function timeline(rows, eventDate) {
    return rows
      .filter((row) => row.milestone || parseDue(row.due) != null)
      .map((row) => ({ row, date: dateFromDue(eventDate, row.due) }))
      .filter((item) => item.date)
      .sort((a, b) => a.date - b.date);
  }

  function daysLeft(eventDate) {
    return daysToEvent(eventDate);
  }

  /* 缺口检查：告诉用户还差什么才能进入下一阶段。
     每条缺口都带 text / hint / target，总览页据此渲染成可点击入口，
     点一下直接跳到能处理它的视图，并把界面过滤到对应范围。 */
  function gaps(state) {
    const rows = state.wbs || [];
    const out = [];
    if (!state.project) {
      return [{ text: '尚未建立项目信息表', hint: '先补齐活动事实与必填项', target: { view: 'manifest' } }];
    }
    if (!rows.length) {
      out.push({ text: '还没有任务分解表', hint: '进入任务分解表，用 AI 生成或手动添加', target: { view: 'tasks', taskView: 'table' } });
    }

    for (const phase of PHASES) {
      const stats = phaseStats(rows, phase.value);
      if (!stats.total) {
        out.push({
          text: `${phase.label}没有任何任务`,
          hint: `筛选到${phase.label}后添加任务`,
          target: { view: 'tasks', taskView: 'table', phase: phase.value }
        });
      }
      const gate = gateStats(state.gates?.[phase.value], phase.value);
      if (gate.total && !gate.ok) {
        out.push({
          text: `${phase.label}检查点还有 ${gate.total - gate.done} 项未确认`,
          hint: '进入阶段检查点逐项确认',
          target: { view: 'tasks', taskView: 'gate', phase: phase.value }
        });
      }
    }

    if (!(state.risks || []).length) {
      out.push({ text: '还没有风险台账', hint: '进入风险预案运行「生成风险清单」', target: { view: 'risk' } });
    }
    const outputs = window.WB.util.OUTPUT_ITEMS.filter((item) => state.project?.outputs?.[item.key]);
    const generated = outputs.filter((item) => state.materials?.[item.key]).length;
    if (outputs.length && generated < outputs.length) {
      const pending = outputs.find((item) => !state.materials?.[item.key]);
      out.push({
        text: `已勾选 ${outputs.length} 份产出，还有 ${outputs.length - generated} 份未生成`,
        hint: '进入过程材料逐份生成',
        target: { view: 'material', phase: 'all', openMaterial: pending ? pending.key : null }
      });
    }
    if (!(state.options?.selected || []).length) {
      out.push({ text: '还没有做过方案比选', hint: '进入方案比选载入预设或让 AI 给方案', target: { view: 'decision' } });
    }
    return out;
  }

  /* 兼容只取文本的调用方 */
  function gapTexts(state) {
    return gaps(state).map((item) => item.text);
  }

  /* ── 阶段门禁的证据推断 ──────────────────────────────
     阶段检查点记的是「人确认过的事实」，所以既不自动勾选、也不交给 AI 猜。
     但项目里很多数据本身就能证明某一项已具备条件，这里把这些数据找出来当证据，
     让人一次点击批量采纳；推断不出来的（现场类、会议类）明确标成「需人工确认」。
     注意：ready 只表示「项目数据里有可核验的证据」，不代表系统替人下结论。 */

  const readyVerdict = (evidence) => ({ level: 'ready', evidence, fix: null });
  const partialVerdict = (evidence, fix = null) => ({ level: 'partial', evidence, fix });
  const manualVerdict = (evidence, fix = null) => ({ level: 'manual', evidence, fix });

  /* 空值与「待确认」这类占位词都不算填过；数字类判据另外要求为正数。
     与 guide.js 共用同一份判断，避免一处认「待确认」、另一处不认。 */
  const filled = (value) => window.WB.util.filled(value);
  const positive = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  };
  const clip = (value, max) => {
    const str = String(value ?? '').trim();
    return str.length > max ? `${str.slice(0, max)}…` : str;
  };
  const generated = (state, key) => Boolean(state.materials?.[key]);
  const chosen = (state, key) => Boolean(state.project?.outputs?.[key]);
  const materialFix = (key) => ({ view: 'material', phase: 'all', openMaterial: key });
  const resourcesOf = (state, kinds) => (state.resources || []).filter((item) => kinds.includes(item.kind));
  const overCommitted = (state) => (state.resources || []).filter((item) => Number(item.assigned) > Number(item.available));
  const tasksOf = (state, phase) => (state.wbs || []).filter((row) => row.phase === phase);
  const riskCoverage = (state) => window.WB.risk?.coverage?.(state.risks || [], state.wbs) || { ok: false, issues: [] };

  const GATE_RULES = {
    /* ── 前期策划 ── */
    goal: (s) => {
      const goal = filled(s.project?.basic?.goal) ? String(s.project.basic.goal).trim() : '';
      if (goal.length >= 8) return readyVerdict(`核心目标已写成可核验的描述：「${clip(goal, 24)}」`);
      if (goal) return partialVerdict(`核心目标只写了 ${goal.length} 个字，还不够可核验`, { view: 'manifest' });
      return manualVerdict('项目信息表里还没填核心目标', { view: 'manifest' });
    },
    scope: (s) => {
      const audience = filled(s.project?.basic?.audience);
      const guests = positive(s.project?.basic?.guests);
      if (audience && guests) return readyVerdict('目标受众与预计人数都已填写');
      if (audience || guests) return partialVerdict(`还缺「${audience ? '预计人数' : '目标受众'}」`, { view: 'manifest' });
      return manualVerdict('活动对象与规模还没填', { view: 'manifest' });
    },
    venue: (s) => {
      const main = filled(s.project?.basic?.venue) ? String(s.project.basic.venue).trim() : '';
      const backup = filled(s.project?.basic?.venueBackup) ? String(s.project.basic.venueBackup).trim() : '';
      const venueCount = resourcesOf(s, ['venue']).length;
      if (main && (backup || venueCount >= 2)) return readyVerdict(`主场地「${clip(main, 16)}」与备用方案都已登记`);
      if (main) return partialVerdict(`已定主场地「${clip(main, 16)}」，但还没有备用场地`, { view: 'resources' });
      return manualVerdict('场地还没确定', { view: 'manifest' });
    },
    budget: (s) => {
      const budget = positive(s.project?.basic?.budget);
      const ledger = resourcesOf(s, ['budget']).length;
      if (budget && generated(s, 'budgetSheet')) return readyVerdict('预算上限已定，预算表已生成');
      if (budget && ledger) return readyVerdict(`预算上限已定，经费台账已登记 ${ledger} 条`);
      if (budget) return partialVerdict('预算上限已定，但还没有预算表或经费台账', materialFix('budgetSheet'));
      return manualVerdict('预算方案还没建立', { view: 'manifest' });
    },
    staffing: (s) => {
      if (generated(s, 'staffing')) return readyVerdict('组织分工与职责表已生成');
      const assigned = tasksOf(s, 'plan').filter((row) => filled(row.owner)).length;
      if (assigned >= 3) return readyVerdict(`前期策划已有 ${assigned} 条任务指派了负责角色`);
      return partialVerdict('还没有组织分工表，任务也大多没指派负责角色', materialFix('staffing'));
    },
    approval: (s) => {
      const requirement = filled(s.project?.basic?.approval) ? String(s.project.basic.approval).trim() : '';
      if (generated(s, 'application')) return readyVerdict('活动申报表已生成');
      if (requirement) return partialVerdict(`审批要求已写明「${clip(requirement, 16)}」，但申报材料还没生成`, materialFix('application'));
      return manualVerdict('审批要求还没写，申报材料也没生成', { view: 'manifest' });
    },
    option: (s) => {
      const count = (s.options?.selected || []).length;
      if (count >= 2 && filled(s.options?.decision)) return readyVerdict(`已比选 ${count} 个方案并写明决策结论`);
      if (count >= 2) return partialVerdict(`已录 ${count} 个方案，但还没写决策结论`, { view: 'decision' });
      if (count === 1) return partialVerdict('只录了 1 个方案，比选至少需要 2 个', { view: 'decision' });
      return manualVerdict('还没有做过方案比选', { view: 'decision' });
    },

    /* ── 活动筹备 ── */
    promo: (s) => {
      const poster = generated(s, 'poster');
      const copy = generated(s, 'promoCopy');
      if (poster && copy) return readyVerdict('海报与宣传文案都已生成');
      if (poster || copy) return partialVerdict(`已生成${poster ? '海报' : '宣传文案'}，还缺${poster ? '宣传文案' : '海报'}`, materialFix(poster ? 'promoCopy' : 'poster'));
      return manualVerdict('宣传物料还没生成', materialFix('poster'));
    },
    signup: (s) => (generated(s, 'signup')
      ? readyVerdict('报名表 / 报名页已生成')
      : manualVerdict('报名表还没生成；报名截止与名单统计需要人工确认', materialFix('signup'))),
    material: (s) => {
      const stock = resourcesOf(s, ['material', 'equipment']).length;
      const over = overCommitted(s).length;
      if (over) return partialVerdict(`有 ${over} 项资源占用超出可用数量，先解决冲突`, { view: 'resources' });
      if (generated(s, 'materialList') && stock) return readyVerdict('物料清单已生成，物料与设备台账也已登记');
      if (generated(s, 'materialList')) return readyVerdict('物料清单已生成');
      if (stock) return readyVerdict(`已登记 ${stock} 条物料 / 设备台账`);
      return manualVerdict('物料清单还没生成，物料台账也是空的', materialFix('materialList'));
    },
    shift: (s) => {
      const staff = resourcesOf(s, ['staff']);
      const named = staff.filter((item) => filled(item.owner)).length;
      if (generated(s, 'shift')) return readyVerdict('排班表已生成');
      if (staff.length) return readyVerdict(`人员台账已登记 ${staff.length} 项${named ? `，其中 ${named} 项指派了负责人` : ''}`);
      return manualVerdict('还没有排班表，人员台账也是空的', materialFix('shift'));
    },
    train: (s) => (generated(s, 'training')
      ? readyVerdict('志愿者培训提纲已生成')
      : manualVerdict('培训提纲还没生成；实际是否已培训需要人工确认', materialFix('training'))),
    risk: (s) => {
      const risks = s.risks || [];
      const coverage = riskCoverage(s);
      if (generated(s, 'riskPlan') && coverage.ok) return readyVerdict(`风险应急预案已生成，覆盖度自检通过（${risks.length} 项风险）`);
      if (generated(s, 'riskPlan')) return partialVerdict(`风险预案已生成，但覆盖度自检还有 ${coverage.issues.length} 项待改进`, { view: 'risk' });
      if (risks.length) return partialVerdict(`已有 ${risks.length} 项风险台账，还没生成风险应急预案`, materialFix('riskPlan'));
      return manualVerdict('还没有风险台账', { view: 'risk' });
    },
    final: () => manualVerdict('筹备收口会属于人工确认事项', { view: 'tasks', taskView: 'table', phase: 'prepare' }),

    /* ── 现场执行 ── */
    setup: (s) => {
      const stock = resourcesOf(s, ['venue', 'equipment']).length;
      const over = overCommitted(s).length;
      if (over) return partialVerdict(`有 ${over} 项场地 / 设备占用超出可用数量`, { view: 'resources' });
      if (stock) return readyVerdict(`已登记 ${stock} 条场地 / 设备资源，无占用冲突`);
      return manualVerdict('还没登记场地与设备资源', { view: 'resources' });
    },
    checkin: (s) => (generated(s, 'attendance')
      ? readyVerdict('签到表已生成')
      : manualVerdict('签到表还没生成', materialFix('attendance'))),
    rundown: (s) => (generated(s, 'runbook')
      ? readyVerdict('现场执行手册已生成')
      : manualVerdict('现场执行手册还没生成', materialFix('runbook'))),
    log: (s) => (generated(s, 'liveLog')
      ? readyVerdict('现场记录表已生成')
      : manualVerdict('现场记录表还没生成', materialFix('liveLog'))),
    emergency: (s) => {
      const coverage = riskCoverage(s);
      if (generated(s, 'riskPlan') && coverage.ok) return readyVerdict('风险应急预案已生成，覆盖度自检通过');
      const planned = (s.wbs || []).some((row) => row.phase === 'execute' && /应急|医疗|对讲|疏散|消防/.test(`${row.task} ${row.output}`));
      if (planned) return readyVerdict('执行阶段已有应急相关任务安排');
      return manualVerdict('应急通道、医疗点、对讲频道需要现场确认', { view: 'risk' });
    },
    close: () => manualVerdict('撤场与物资回收需要现场确认', { view: 'resources' }),

    /* ── 活动收尾 ── */
    settle: (s) => {
      if (generated(s, 'settlement')) return readyVerdict('经费决算表已生成');
      if (chosen(s, 'settlement')) return partialVerdict('已勾选经费决算表，但还没生成', materialFix('settlement'));
      return manualVerdict('还没有经费决算表', materialFix('settlement'));
    },
    return: (s) => {
      const borrowed = resourcesOf(s, ['equipment', 'vehicle']).length;
      if (borrowed) return readyVerdict(`已登记 ${borrowed} 条设备 / 车辆资源，可逐项核对归还`);
      return manualVerdict('还没登记需要归还的设备与车辆', { view: 'resources' });
    },
    review: (s) => (generated(s, 'review')
      ? readyVerdict('复盘报告已生成')
      : manualVerdict('复盘报告还没生成', materialFix('review'))),
    riskReview: (s) => {
      const risks = s.risks || [];
      const withResponse = risks.filter((item) => filled(item.response)).length;
      const ended = (s.drills || []).filter(item => item.status === 'done');
      const drills = ended.length;
      const latest = ended.filter(d => !ended.some(next => next.parentId === d.id));
      const unresolved = latest.some(d => !d.steps?.length || d.steps.some(step => !['pass', 'na'].includes(step.result)));
      if (drills && unresolved) return partialVerdict(`已结束 ${drills} 场演练，仍有问题或未验证记录，请核对整改与复测`, { view: 'drills' });
      if (risks.length && withResponse >= risks.length && drills) {
        return readyVerdict(`风险台账 ${risks.length} 项都写了处置措施，并有 ${drills} 场演练记录；有效性仍需人工审核`);
      }
      if (risks.length && withResponse >= risks.length) {
        return partialVerdict('风险台账都写了处置措施，但还没做过变更演练', { view: 'drills' });
      }
      if (risks.length) return partialVerdict(`还有 ${risks.length - withResponse} 项风险没写处置措施`, { view: 'risk' });
      return manualVerdict('还没有风险台账', { view: 'risk' });
    },
    news: (s) => (generated(s, 'news')
      ? readyVerdict('新闻稿 / 感谢信已生成')
      : manualVerdict('新闻稿还没生成', materialFix('news'))),
    archive: (s) => (generated(s, 'archive')
      ? readyVerdict('资料归档清单已生成')
      : manualVerdict('资料归档清单还没生成', materialFix('archive')))
  };

  /* 逐项推断：已勾选的一律记 done，其余走规则，没规则的兜底成人工确认 */
  function gateReview(state) {
    const checked = state.gates || {};
    const phases = PHASES.map((phase) => {
      const items = (GATES[phase.value] || []).map((item) => {
        const done = Boolean(checked[phase.value]?.[item.id]);
        const verdict = done
          ? { level: 'done', evidence: '已确认', fix: null }
          : (GATE_RULES[item.id]?.(state) || manualVerdict('系统没有找到可用的证据，需要人工确认'));
        return { id: item.id, label: item.label, phase: phase.value, done, ...verdict };
      });
      const count = (level) => items.filter((entry) => !entry.done && entry.level === level).length;
      return {
        phase: phase.value,
        label: phase.label,
        items,
        summary: {
          total: items.length,
          done: items.filter((entry) => entry.done).length,
          ready: count('ready'),
          partial: count('partial'),
          manual: count('manual')
        }
      };
    });
    return { phases, ready: phases.reduce((sum, phase) => sum + phase.summary.ready, 0) };
  }

  /* ── 自动打勾 ────────────────────────────────────────
     有证据就自动勾上，省掉逐项点击：生成一份材料、登记一条资源、写完比选结论，
     对应的检查点会在下次渲染时自动确认。但人一旦手动取消，就记成 muted，
     之后不会再被自动勾回来——和「AI 只补空白、不覆盖用户手改」同一条原则。 */
  function autoTick(state) {
    if (!state || !state.project) return 0;
    const review = gateReview(state);
    state.gates = state.gates || {};
    state.gateMeta = state.gateMeta || {};
    let ticked = 0;
    for (const phase of review.phases) {
      state.gates[phase.phase] = state.gates[phase.phase] || {};
      state.gateMeta[phase.phase] = state.gateMeta[phase.phase] || {};
      const meta = state.gateMeta[phase.phase];
      for (const item of phase.items) {
        if (item.done || item.level !== 'ready') continue;
        if (meta[item.id] && meta[item.id].muted) continue;
        state.gates[phase.phase][item.id] = true;
        meta[item.id] = { source: 'auto', at: new Date().toISOString(), evidence: item.evidence, muted: false };
        ticked += 1;
      }
    }
    return ticked;
  }

  /* 查某个检查点的确认来源与证据 */
  function gateMetaOf(state, phase, id) {
    return state?.gateMeta?.[phase]?.[id] || null;
  }

  /* 人工表态：勾上记 user；取消记 muted，之后自动勾选不再覆盖这个决定 */
  function setGate(state, phase, id, checked) {
    state.gates = state.gates || {};
    state.gateMeta = state.gateMeta || {};
    state.gates[phase] = state.gates[phase] || {};
    state.gateMeta[phase] = state.gateMeta[phase] || {};
    state.gates[phase][id] = Boolean(checked);
    state.gateMeta[phase][id] = checked
      ? { source: 'user', at: new Date().toISOString(), evidence: '', muted: false }
      : { source: 'user', at: new Date().toISOString(), evidence: '', muted: true };
    return state.gates[phase][id];
  }

  /* 解除「手动取消」标记，把这一项交回给自动勾选判断 */
  function resumeAuto(state, phase, id) {
    state.gates = state.gates || {};
    state.gateMeta = state.gateMeta || {};
    state.gates[phase] = state.gates[phase] || {};
    state.gateMeta[phase] = state.gateMeta[phase] || {};
    state.gates[phase][id] = false;
    state.gateMeta[phase][id] = { source: 'user', at: new Date().toISOString(), evidence: '', muted: false };
    return autoTick(state);
  }

  window.WB.wbs = {
    phaseStats, overall, gateStats, gantt, offsetDays, timeline, daysLeft, gaps, gapTexts,
    gateReview, autoTick, setGate, resumeAuto, gateMetaOf, gateRuleIds: Object.keys(GATE_RULES)
  };
}());
