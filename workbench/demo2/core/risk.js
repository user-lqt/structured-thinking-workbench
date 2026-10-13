/* 风险计算：分值、分级、分布与覆盖度检查。 */
window.WB = window.WB || {};

(function () {
  const { RISK, PHASE_LABEL, PHASE_ORDER, RISK_CATEGORY } = window.WB.util;

  const scoreOf = (risk) => Number(risk.probability) * Number(risk.impact);

  function levelOf(score) {
    if (score >= 15) return 'high';
    if (score >= 8) return 'medium';
    return 'low';
  }

  const levelOfRisk = (risk) => levelOf(scoreOf(risk));

  function distribution(risks) {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const risk of risks) counts[levelOfRisk(risk)] += 1;
    return counts;
  }

  function byLevel(risks, level) {
    return risks.filter((risk) => levelOfRisk(risk) === level);
  }

  /* 覆盖度检查：阶段、类别、分级分布、字段完整性、任务挂靠 */
  function coverage(risks, tasks = []) {
    const rules = RISK.coverage;
    const issues = [];
    const stats = {
      total: risks.length,
      phases: {},
      categories: {},
      distribution: distribution(risks),
      linked: 0,
      complete: 0
    };

    if (!risks.length) {
      return { ok: false, issues: ['还没有风险台账，先运行「生成风险清单」或手动添加。'], stats };
    }

    for (const phase of Object.keys(PHASE_ORDER)) stats.phases[phase] = 0;
    for (const risk of risks) stats.phases[risk.phase] = (stats.phases[risk.phase] || 0) + 1;
    for (const risk of risks) stats.categories[risk.category] = (stats.categories[risk.category] || 0) + 1;

    const thin = Object.entries(stats.phases).filter(([, count]) => count < rules.minPerPhase);
    if (thin.length) {
      issues.push(`${thin.map(([phase, count]) => `${PHASE_LABEL[phase]}仅 ${count} 项`).join('、')}，低于每阶段至少 ${rules.minPerPhase} 项的要求。`);
    }

    const usedCategories = Object.keys(stats.categories).length;
    if (usedCategories < rules.minCategories) {
      const missing = RISK.categories
        .filter((category) => !stats.categories[category.value])
        .slice(0, 4)
        .map((category) => category.label);
      issues.push(`仅覆盖 ${usedCategories} 个风险类别，少于要求的 ${rules.minCategories} 个。尚未涉及：${missing.join('、')}。`);
    }

    for (const required of rules.requiredCategories) {
      const label = RISK_CATEGORY[required];
      if (!stats.categories[required]) issues.push(`缺少「${label}」类风险，这类风险必须显式列出。`);
    }

    const taskNames = new Set(tasks.map((row) => row.task).filter(Boolean));
    stats.linked = risks.filter((risk) => risk.task && risk.task !== '待确认' && (!taskNames.size || taskNames.has(risk.task))).length;
    if (taskNames.size && stats.linked < risks.length) {
      issues.push(`有 ${risks.length - stats.linked} 项风险未挂靠到任务分解表的具体任务。`);
    }

    stats.complete = risks.filter((risk) => risk.trigger && risk.prevention && risk.response && risk.escalation
      && risk.trigger !== '待确认' && risk.prevention !== '待确认'
      && risk.response !== '待确认' && risk.escalation !== '待确认').length;
    if (stats.complete < risks.length) {
      issues.push(`有 ${risks.length - stats.complete} 项风险的触发信号 / 预防 / 响应 / 升级路径尚未写全。`);
    }

    const unowned = risks.filter((risk) => !risk.owner || risk.owner === '待确认').length;
    if (unowned) issues.push(`有 ${unowned} 项风险未指定责任人角色。`);

    return { ok: issues.length === 0, issues, stats };
  }

  window.WB.risk = { scoreOf, levelOf, levelOfRisk, distribution, byLevel, coverage };
}());
