/* 导出层：把结构化数据渲染成 Markdown / CSV / JSON 项目包。 */
window.WB = window.WB || {};

(function () {
  const U = window.WB.util;
  const { MANIFEST, WBS, RISK, PHASE_LABEL, STATUS_LABEL, RISK_CATEGORY, LEVEL_LABEL, OUTPUT_ITEMS, fmtDate, dateFromDue } = U;
  const scoreOf = (risk) => window.WB.risk.scoreOf(risk);
  const levelOf = (score) => window.WB.risk.levelOf(score);
  const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;

  const projectName = () => window.WB.store.projectName();
  const eventDate = () => window.WB.store.state.project?.basic?.date || '';

  function manifestToMarkdown() {
    const project = window.WB.store.state.project;
    const lines = [`# ${projectName()}｜项目信息表`, ''];
    for (const section of MANIFEST.sections) {
      lines.push(`## ${section.label}`, '');
      if (section.kind === 'fields') {
        for (const field of section.fields) {
          const value = project?.basic?.[field.key];
          lines.push(`- ${field.label}：${value === '' || value == null ? '待补充' : value}`);
        }
      } else {
        for (const item of section.items) {
          const on = Boolean(project?.outputs?.[item.key]);
          lines.push(`- [${on ? 'x' : ' '}] ${item.label}（${PHASE_LABEL[item.phase]}）`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  function wbsToMarkdown() {
    const rows = window.WB.store.state.wbs;
    const lines = [`# ${projectName()}｜全周期任务分解表`, ''];
    for (const phase of WBS.phases) {
      const items = rows.filter((r) => r.phase === phase.value);
      if (!items.length) continue;
      lines.push(`## ${phase.label}（${phase.window}）`, '');
      lines.push(row(['任务', '负责角色', '相对时间', '工期(天)', '产出物', '前置任务', '状态', '完成度', '里程碑', '来源']));
      lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
      for (const item of items) {
        lines.push(row([
          item.task, item.owner, item.due, item.duration, item.output, item.depends,
          STATUS_LABEL[item.status] || item.status, item.progress ? `${item.progress}%` : '',
          item.milestone ? '是' : '', U.SOURCE_LABEL[item.source] || item.source
        ]));
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  function wbsToCsv() {
    const header = ['阶段', '任务', '负责角色', '相对时间', '绝对日期', '工期(天)', '产出物', '前置任务', '状态', '完成度', '里程碑'];
    const list = [header];
    for (const item of window.WB.store.state.wbs) {
      const date = dateFromDue(eventDate(), item.due);
      list.push([
        PHASE_LABEL[item.phase] || item.phase, item.task, item.owner, item.due, date ? fmtDate(date) : '',
        item.duration, item.output, item.depends, STATUS_LABEL[item.status] || item.status,
        item.progress, item.milestone ? '是' : ''
      ]);
    }
    return list.map((line) => line.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }

  function gatesToMarkdown() {
    const state = window.WB.store.state;
    const lines = [`# ${projectName()}｜阶段检查点`, ''];
    for (const phase of WBS.phases) {
      const items = window.WB.util.GATES[phase.value] || [];
      const checked = state.gates?.[phase.value] || {};
      const done = items.filter((item) => checked[item.id]).length;
      lines.push(`## ${phase.label}（${done}/${items.length}）`, '');
      for (const item of items) lines.push(`- [${checked[item.id] ? 'x' : ' '}] ${item.label}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function decisionToMarkdown() {
    const { selected: options, criteria, scores, decision, note } = window.WB.store.state.options;
    const lines = [`# ${projectName()}｜方案比选决策矩阵`, ''];
    if (!options.length) return `${lines.join('\n')}\n尚未建立比选方案。\n`;
    lines.push('## 一、候选方案', '');
    options.forEach((option, index) => lines.push(`${index + 1}. **${option.name}**${option.summary ? `：${option.summary}` : ''}`));
    lines.push('', '## 二、评价维度与权重', '');
    lines.push(row(['维度', '权重', '说明']));
    lines.push(row(['---', '---', '---']));
    for (const criterion of criteria) lines.push(row([criterion.label, criterion.weight, criterion.hint || '']));
    lines.push('', '## 三、评分与加权结果', '');
    const totalWeight = criteria.reduce((sum, item) => sum + Number(item.weight || 0), 0) || 1;
    lines.push(row(['方案', ...criteria.map((criterion) => `${criterion.label}(${criterion.weight})`), '加权得分']));
    lines.push(row(['---', ...criteria.map(() => '---'), '---']));
    const ranked = options.map((option) => {
      const values = criteria.map((criterion) => Number(scores?.[option.name]?.[criterion.label] || 0));
      const weighted = values.reduce((sum, value, index) => sum + value * Number(criteria[index].weight || 0), 0) / totalWeight;
      return { option, values, weighted };
    }).sort((a, b) => b.weighted - a.weighted);
    for (const item of ranked) lines.push(row([item.option.name, ...item.values, item.weighted.toFixed(2)]));
    lines.push('', '## 四、决策结论', '', decision || '待确认', '');
    if (note) lines.push('## 五、补充说明', '', note, '');
    return lines.join('\n');
  }

  function riskPlanToMarkdown() {
    const state = window.WB.store.state;
    const lines = [`# ${projectName()}｜全流程风险识别与分级应急预案`, ''];
    lines.push('## 一、评估规则', '', '风险分值 = 可能性（1–5）× 影响程度（1–5）。分级：15–25 高风险，8–14 中风险，1–7 低风险。', '');
    lines.push(row(['风险', '类别', '阶段', '挂靠任务', '可能性', '影响', '分值', '等级', '责任人']));
    lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---', '---']));
    for (const risk of state.risks) {
      const score = scoreOf(risk);
      lines.push(row([risk.name, RISK_CATEGORY[risk.category] || '', PHASE_LABEL[risk.phase] || '', risk.task || '',
        risk.probability, risk.impact, score, LEVEL_LABEL[levelOf(score)], risk.owner || '']));
    }
    lines.push('', '## 三、分级应急预案', '');
    for (const level of RISK.levels) {
      const items = state.risks.filter((risk) => levelOf(scoreOf(risk)) === level.value);
      if (!items.length) continue;
      lines.push(`### ${level.label}（${items.length} 项）`, '', `> ${level.note}`, '');
      items.forEach((risk, index) => {
        lines.push(`#### ${index + 1}. ${risk.name}｜${risk.probability} × ${risk.impact} = ${scoreOf(risk)}`, '');
        lines.push(`- 类别 / 阶段：${RISK_CATEGORY[risk.category] || ''} / ${PHASE_LABEL[risk.phase] || ''}`);
        lines.push(`- 挂靠任务：${risk.task || '待确认'}｜责任人：${risk.owner || '待确认'}`);
        lines.push(`- 触发信号：${risk.trigger || '待补充'}`);
        lines.push(`- 预防措施：${risk.prevention || '待补充'}`);
        lines.push(`- 现场响应：${risk.response || '待补充'}`);
        lines.push(`- 升级路径：${risk.escalation || '待补充'}`);
        lines.push('');
      });
    }
    lines.push('## 四、通用升级链', '', RISK.escalation, '');
    if (state.riskCompliance.length) {
      lines.push('## 五、合规提示', '');
      state.riskCompliance.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    const check = window.WB.risk.coverage(state.risks, state.wbs);
    lines.push('## 六、覆盖度自检', '');
    if (check.ok) lines.push('- 通过：阶段、类别、分级分布与字段完整性均满足要求');
    else check.issues.forEach((issue) => lines.push(`- ${issue}`));
    lines.push('');
    return lines.join('\n');
  }

  function assetsToMarkdown() {
    const state = window.WB.store.state;
    const lines = [`# ${projectName()}｜素材库清单`, ''];
    if (!state.assets.length) return `${lines.join('\n')}\n尚未登记素材。\n`;
    lines.push(row(['名称', '类型', '阶段', '标签', '说明', '登记时间']));
    lines.push(row(['---', '---', '---', '---', '---', '---']));
    for (const asset of state.assets) {
      lines.push(row([asset.name, asset.kind, PHASE_LABEL[asset.phase] || asset.phase || '', (asset.tags || []).join(' / '),
        asset.note || '', U.fmtDateTime(asset.createdAt)]));
    }
    lines.push('');
    return lines.join('\n');
  }

  const materialToMarkdown = (doc) => [`# ${doc.title}`, '', ...doc.sections.map((section) => `## ${section.heading}\n\n${section.body}`)].join('\n\n');

  function resourcesToMarkdown() {
    const state = window.WB.store.state;
    const lines = [`# ${projectName()}｜人员与资源台账`, ''];
    if (!state.resources.length) return `${lines.join('\n')}\n尚未登记资源。\n`;
    lines.push(row(['资源', '类型', '阶段', '单位', '可用', '已安排', '占用率', '检查', '责任人', '备注']));
    lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
    for (const item of state.resources) {
      const gap = Number(item.assigned) - Number(item.available);
      const verdict = gap > 0 ? `超出 ${gap}` : gap === 0 && Number(item.assigned) > 0 ? '已排满' : '正常';
      const pct = Number(item.available) > 0
        ? Math.round((Number(item.assigned) / Number(item.available)) * 100)
        : (Number(item.assigned) > 0 ? 100 : 0);
      lines.push(row([item.name, U.RESOURCE_KIND[item.kind] || item.kind, PHASE_LABEL[item.phase] || '', item.unit,
        item.available, item.assigned, `${pct}%`, verdict, item.owner, item.note]));
    }
    lines.push('', '## 占用冲突自检', '');
    const over = state.resources.filter((item) => Number(item.assigned) > Number(item.available));
    if (!over.length) lines.push('- 通过：没有资源被超额安排');
    else for (const item of over) {
      lines.push(`- ${item.name}：可用 ${item.available} ${item.unit} / 已安排 ${item.assigned} ${item.unit}，缺口 ${Number(item.assigned) - Number(item.available)} ${item.unit}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  function drillsToMarkdown() {
    const state = window.WB.store.state;
    const lines = [`# ${projectName()}｜突发变更演练记录`, ''];
    if (!state.drills.length) return `${lines.join('\n')}\n尚未开展演练。\n`;
    for (const drill of state.drills) {
      lines.push(`## ${drill.title}`, '');
      lines.push(`- 风险类别：${RISK_CATEGORY[drill.category] || drill.category || '未分类'}｜阶段：${PHASE_LABEL[drill.phase] || drill.phase}`);
      lines.push(`- 状态：${drill.status === 'done' ? '已完成' : '进行中'}｜开始：${U.fmtDateTime(drill.startedAt)}${drill.finishedAt ? `｜结束：${U.fmtDateTime(drill.finishedAt)}` : ''}`);
      lines.push('');
      lines.push(row(['序号', '处置步骤', '已完成', '执行记录']));
      lines.push(row(['---', '---', '---', '---']));
      drill.steps.forEach((step, index) => lines.push(row([index + 1, step.text, step.done ? '是' : '否', step.note || ''])));
      lines.push('');
      if (drill.decisions) lines.push(`- 关键决策：${drill.decisions}`);
      if (drill.outcome) lines.push(`- 演练结论：${drill.outcome}`);
      if (drill.rollback) lines.push(`- 回退条件：${drill.rollback}`);
      if (drill.followUp?.length) lines.push(`- 改进项：${drill.followUp.join('；')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function materialsPack() {
    const state = window.WB.store.state;
    const docs = OUTPUT_ITEMS
      .filter((item) => state.materials[item.key])
      .map((item) => materialToMarkdown(state.materials[item.key]));
    return [`# ${projectName()}｜过程材料包`, '', `> 导出时间：${U.fmtDateTime(new Date())}`, '', ...docs].join('\n\n---\n\n');
  }

  function logToMarkdown() {
    const state = window.WB.store.state;
    const lines = [`# ${projectName()}｜关键节点记录`, ''];
    if (!state.log.length) return `${lines.join('\n')}\n暂无记录。\n`;
    lines.push(row(['时间', '类型', '内容']));
    lines.push(row(['---', '---', '---']));
    for (const entry of state.log) lines.push(row([U.fmtDateTime(entry.at), entry.kind, entry.detail]));
    lines.push('');
    return lines.join('\n');
  }

  /* 全量项目档案：一份 Markdown 汇总所有中间产物，便于直接归档 */
  function fullArchive() {
    const state = window.WB.store.state;
    const parts = [
      `# ${projectName()}｜全周期策划与管控档案`,
      '',
      `> 导出时间：${U.fmtDateTime(new Date())}`,
      `> 数据来源：活动结构化工作台（本机导出）`,
      ''
    ];
    parts.push('## 目录', '', '- 一、项目信息表', '- 二、全周期任务分解表', '- 三、阶段检查点', '- 四、方案比选决策矩阵',
      '- 五、风险台账与分级应急预案', '- 六、过程材料', '- 七、素材库清单', '- 八、关键节点记录',
      '- 九、人员与资源台账', '- 十、突发变更演练记录', '');
    parts.push('---', '', manifestToMarkdown(), '', '---', '', wbsToMarkdown(), '', '---', '', gatesToMarkdown(), '',
      '---', '', decisionToMarkdown(), '', '---', '', riskPlanToMarkdown(), '');
    const docs = OUTPUT_ITEMS.filter((item) => state.materials[item.key]);
    if (docs.length) {
      parts.push('---', '', '## 六、过程材料', '');
      for (const item of docs) parts.push(materialToMarkdown(state.materials[item.key]), '');
    }
    parts.push('---', '', assetsToMarkdown(), '', '---', '', logToMarkdown(), '',
      '---', '', resourcesToMarkdown(), '', '---', '', drillsToMarkdown());
    return parts.join('\n');
  }

  window.WB.exporters = {
    manifestToMarkdown,
    wbsToMarkdown,
    wbsToCsv,
    gatesToMarkdown,
    decisionToMarkdown,
    riskPlanToMarkdown,
    assetsToMarkdown,
    resourcesToMarkdown,
    drillsToMarkdown,
    materialToMarkdown,
    materialsPack,
    logToMarkdown,
    fullArchive
  };
}());
