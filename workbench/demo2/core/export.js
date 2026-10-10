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
          /* 活动日期是数组，导出成一句话摘要，别把 [object Object] 写进表里 */
          const value = field.type === 'days' ? U.scheduleSummary(project?.basic || {}) : project?.basic?.[field.key];
          lines.push(`- ${field.label}：${value === '' || value == null ? '待补充' : value}`);
          /* 每个时间段的起止与内容在「活动安排」里，单独补一行 */
          if (field.key === 'days' && U.agendaOf(project?.basic || {}).length) {
            lines.push(`- 活动安排：${U.agendaSummary(project.basic)}`);
          }
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



  /* ── 材料 → Word / Excel ─────────────────────
     主交付格式按产出类型定（见 PRIMARY_FORMAT 表）：表格型 → Excel，正文型 → Word，图形型 → Markdown。
     三种格式随时都能导出，主格式只决定默认按钮。 */
  const FORMAT_LABEL = { docx: 'Word', xlsx: 'Excel', md: 'Markdown' };
  const PRIMARY_FORMAT = { table: 'xlsx', document: 'docx', structure: 'xlsx', graphic: 'md' };
  const primaryFormat = (item) => PRIMARY_FORMAT[item?.kind] || 'md';

  /* ── 发票栏 ─────────────────────────────
     附件存在 doc.invoices 里，键是「章节:表块:行」；预览与导出时才拼成表格的一列，
     不写回正文，避免和附件数据互相污染。 */
  const MONEY_RE = /金额|预算|费用|单价|合计|经费|决算/;
  const invoiceKey = (sectionIndex, blockIndex, rowIndex) => `${sectionIndex}:${blockIndex}:${rowIndex}`;
  const invoicesOf = (doc, key) => (doc && doc.invoices && doc.invoices[key]) || [];

  /* ── 合计行：数值由上方各行自动累加，不能编辑也不能删除 ──
     识别「合计 / 总计 / 小计」；只重算原本就是数字的格，单价、占比（%）这类不动。 */
  const TOTAL_RE = /合计|总计|小计/;
  const isTotalRow = (cells) => (cells || []).some((cell) => TOTAL_RE.test(String(cell ?? '')));

  /* 容忍 ¥ / ￥ / 千分位 / 尾随「元」；带 % 的占比一律不参与求和 */
  function numericOf(value) {
    const text = String(value ?? '').trim();
    if (!text || text.includes('%')) return null;
    const cleaned = text.replace(/[¥￥,，\s]/g, '').replace(/元$/, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
  }

  const formatNumber = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

  /* 占比列：表头叫「占比 / 比例 / 百分比 / 份额」，或该列有格子写成 xx% */
  const SHARE_RE = /占比|比例|百分比|份额/;
  const SHARE_CELL_RE = /^-?\d+(\.\d+)?\s*%$/;
  const isShareCell = (value) => SHARE_CELL_RE.test(String(value ?? '').trim());
  const BASE_RE = /金额|费用|总额|预算|支出|收入|经费|价款|合价|小计|合计/;
  const shareText = (ratio) => `${Math.round(ratio * 1000) / 10}%`;

  /* 一张表的派生列：哪些列求和（sumCols）、哪些列是占比（shareCols）、占比以哪一列为基数（baseCol） */
  function columnPlan(header, rows) {
    const list = rows || [];
    const head = header || [];
    const width = Math.max(head.length, 0, ...list.map((cells) => cells.length));
    const columns = Array.from({ length: width }, (_, col) => col);
    const totalRows = list.filter((cells) => isTotalRow(cells));
    const sumCols = totalRows.length
      ? columns.filter((col) => totalRows.some((cells) => numericOf(cells[col]) !== null))
      : [];
    const shareCols = columns.filter((col) => SHARE_RE.test(String(head[col] ?? ''))
      || list.some((cells) => !isTotalRow(cells) && isShareCell(cells[col])));
    const baseCol = sumCols.find((col) => BASE_RE.test(String(head[col] ?? '')))
      ?? sumCols[0]
      ?? columns.find((col) => !shareCols.includes(col) && BASE_RE.test(String(head[col] ?? '')));
    return { sumCols, shareCols, baseCol: baseCol === undefined ? -1 : baseCol };
  }

  /* 合计行的数字格 = 上方各行之和；占比列 = 该行金额 ÷ 合计金额。两者都由明细实时派生。 */
  function applyTotals(header, rows) {
    const list = rows || [];
    if (!list.length) return list;
    const plan = columnPlan(header, list);
    if (!plan.sumCols.length && !plan.shareCols.length) return list;
    const body = list.filter((cells) => !isTotalRow(cells));
    if (!body.length) return list;
    const sumOf = (col) => {
      const values = body.map((cells) => numericOf(cells[col])).filter((value) => value !== null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const totals = new Map();
    const totalOf = (col) => { if (!totals.has(col)) totals.set(col, sumOf(col)); return totals.get(col); };
    plan.sumCols.forEach(totalOf);
    if (plan.baseCol >= 0) totalOf(plan.baseCol);
    const base = plan.baseCol >= 0 ? totalOf(plan.baseCol) : null;
    return list.map((cells) => {
      const total = isTotalRow(cells);
      return cells.map((original, col) => {
        if (total) {
          if (plan.sumCols.includes(col) && numericOf(original) !== null) {
            const value = totalOf(col);
            if (value !== null) return formatNumber(value);
          }
          if (plan.shareCols.includes(col) && base) return '100%';
          return original ?? '';
        }
        if (plan.shareCols.includes(col) && base) {
          const amount = numericOf(cells[plan.baseCol]);
          if (amount !== null) return shareText(amount / base);
        }
        return original ?? '';
      });
    });
  }
  /* 金额表才挂发票栏：表头出现金额 / 单价 / 费用 / 合计，或章节名带预算 / 经费 / 决算 */
  const isMoneyTable = (header, heading) => {
    const cells = (header || []).map((cell) => String(cell ?? ''));
    if (cells.some((cell) => /发票/.test(cell))) return true;
    if (cells.some((cell) => /金额|单价|费用|合计/.test(cell))) return true;
    return MONEY_RE.test(String(heading ?? ''));
  };

  /* 导出前先把合计行重算到位，再在真有附件时补「发票」列；空列不出现在成品里 */
  function withInvoices(doc, sectionIndex, blocks) {
    return blocks.map((block, blockIndex) => {
      if (block.type !== 'table') return block;
      const rows = applyTotals(block.header, block.rows);
      const attached = rows.map((_, rowIndex) => invoicesOf(doc, invoiceKey(sectionIndex, blockIndex, rowIndex)));
      if (!attached.some((files) => files.length)) return { ...block, rows };
      const width = Math.max(block.header.length, ...rows.map((row) => row.length), 1);
      const pad = (cells) => Array.from({ length: width }, (_, col) => cells[col] ?? '');
      return {
        ...block,
        header: [...block.header, '发票'],
        rows: rows.map((cells, rowIndex) => [...pad(cells),
          isTotalRow(cells) ? '' : (attached[rowIndex] || []).map((file) => file.name).join('、')])
      };
    });
  }

  /* 文档正文 → 结构块：章节标题作为一级标题，正文交给 Markdown 解析 */
  const docBlocks = (doc) => doc.sections.flatMap((section, sectionIndex) => [
    { type: 'heading', level: 1, text: section.heading },
    ...withInvoices(doc, sectionIndex, window.WB.markdown.parseBlocks(section.body))
  ]);

  /* Word 导出：挂了参考件就带上它的版式套件（字体 / 页边距 / 页眉页脚 / 表格线），
     正文仍是当前材料的章节；「按参考重排」过的正文天然就在这里。 */
  const styleFor = (key) => window.WB.store.state.references?.[key]?.kit || null;
  const materialToDocx = (doc, options = {}) => window.WB.ooxml.docx({
    title: doc.title,
    blocks: docBlocks(doc),
    style: options.style ?? null
  });

  /* 每个章节一张工作表：含表格的取表格（首行表头），纯正文的按行铺开 */
  function materialToXlsx(doc) {
    const sheets = doc.sections.map((section, sectionIndex) => {
      const blocks = withInvoices(doc, sectionIndex, window.WB.markdown.parseBlocks(section.body));
      const table = blocks.find((block) => block.type === 'table');
      if (table) return { name: section.heading, rows: (table.header.some((cell) => String(cell ?? '').trim()) ? [table.header, ...table.rows] : table.rows) };
      const lines = [];
      for (const block of blocks) {
        if (block.type === 'heading') lines.push([block.text]);
        else if (block.type === 'list') block.items.forEach((item) => lines.push([`· ${item}`]));
        else if (block.type === 'quote') lines.push([block.text]);
        else if (block.type === 'paragraph') block.lines.forEach((line) => lines.push([line]));
      }
      return { name: section.heading, rows: lines.length ? [['内容'], ...lines] : [['（本章暂无内容）']] };
    });
    return window.WB.ooxml.xlsx({ title: doc.title, sheets });
  }

  /* 材料包：一份 Word 汇总全部已生成材料 */
  function materialsPackDocx() {
    const state = window.WB.store.state;
    const items = OUTPUT_ITEMS.filter((item) => state.materials[item.key]);
    const blocks = [];
    items.forEach((item, index) => {
      if (index) blocks.push({ type: 'hr' });
      blocks.push(...docBlocks(state.materials[item.key]));
    });
    /* 材料包用第一份挂得住的参考版式，整本看起来是学校那份表的样式 */
    const style = OUTPUT_ITEMS.map((item) => styleFor(item.key)).find(Boolean) || null;
    return window.WB.ooxml.docx({ title: `${projectName()}｜过程材料包`, blocks, style });
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
    materialToDocx,
    styleFor,
    materialToXlsx,
    materialsPackDocx,
    primaryFormat,
    FORMAT_LABEL,
    isMoneyTable,
    invoiceKey,
    isTotalRow,
    applyTotals,
    columnPlan,
    isShareCell,
    invoicesOf,
    withInvoices,
    materialsPack,
    logToMarkdown,
    fullArchive
  };
}());
