/* 过程材料：21 类产出的生成、编辑、模板套用与导出；海报产出改为「四段装配提示词 → AI 生图」。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, OUTPUT_ITEMS, PHASES, PHASE_LABEL } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  const materialDef = (skillId) => window.SKILLS.materials?.[skillId] || null;

  /* 材料正文的显示模式：preview 渲染 Markdown（默认），edit 显示原始文本。
     只放在内存里，不必为此改动存档结构。 */
  const viewMode = new Map();
  /* 点「上传参考」时先记下是哪份材料，选完文件再回到这里 */
  let pendingReference = null;
  const modeOf = (key) => viewMode.get(key) || 'preview';

  /* 三个格式都能导；主格式按产出类型定（表格 → Excel，正文 → Word），排在最前 */
  /* 挂了能填值的参考件（.docx 整包）时，Word 默认导「参考原表」：
     导出的就是参考件本身，只换识别出来的值——这是唯一能保证「肉眼结构一模一样」的那条路。
     想看 AI 写出来的正文，旁边那颗「Word（正文）」才是老路径。 */
  function downloadButtons(item) {
    const { primaryFormat, FORMAT_LABEL } = window.WB.exporters;
    const primary = primaryFormat(item);
    const fillable = Boolean(referenceOf(item.key)?.package);
    const order = [primary, ...['docx', 'xlsx', 'md'].filter((format) => format !== primary)];
    const buttons = order.map((format) => {
      if (fillable && format === 'docx') {
        return `<button class="button button-ghost is-primary-format" data-material-fill-export="${item.key}" title="${escapeHtml('导出的就是这份参考件：表格怎么画、栏目叫什么、分几部分、缩进与页眉页脚全照原样，只换识别出的值')}">Word（参考原表）</button>`
          + `<button class="button button-quiet" data-material-export="${item.key}" data-format="docx" title="${escapeHtml('导出 AI 写出来的正文（不套参考的表结构）')}">Word（正文）</button>`;
      }
      return `<button class="button ${format === primary ? 'button-ghost is-primary-format' : 'button-quiet'}" data-material-export="${item.key}" data-format="${format}">${escapeHtml(FORMAT_LABEL[format])}</button>`;
    }).join('');
    const reference = referenceOf(item.key);
    const stale = Boolean(reference) && reference.kind === 'docx' && !reference.package;
    const hint = fillable
      ? '<span class="material-export-hint" title="挂了参考件，所以 Word 默认按参考原表导出">按参考原表</span>'
      : (stale ? '<span class="material-export-hint is-warn" title="这份参考是升级之前存的，没留下整包快照；重新上传同一份 Word 就能按原表导出">重传参考可用「参考原表」</span>' : '');
    return `<span class="material-downloads">${buttons}${hint}</span>`;
  }

  /* 参考件：每份材料可挂一份往届样表，生成时按它的栏目与字段对齐 */
  const referenceOf = (outputKey) => state().references?.[outputKey] || null;
  const docxLib = () => window.WB.docx;
  const referenceSections = (outputKey) => (referenceOf(outputKey)?.sections || []).map((section) => section.heading);

  /* 章节优先级：用户自己改过的章节表 > 手选模板 > 参考件栏目 > 内置默认章节。
     用户那份里可能有还没命名的空行（「＋ 添加章节」刚加出来的），所以拆成两层：
     sectionListOf 给编辑面板看原样，chosenSections 给生成 / 计数用（去掉空标题）。 */
  function sectionListOf(outputKey) {
    const custom = state().materialSections?.[outputKey];
    if (Array.isArray(custom) && custom.length) return custom.slice();
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const templateId = state().materialTemplates[outputKey];
    const template = state().templates.find((entry) => entry.id === templateId);
    if (template) return template.sections.map((section) => section.heading);
    const fromReference = referenceSections(outputKey);
    if (fromReference.length) return fromReference;
    return materialDef(item?.skill)?.sections || [];
  }

  const chosenSections = (outputKey) => sectionListOf(outputKey)
    .map((heading) => U.text(heading)).filter(Boolean);

  /* 章节增删改都落到这一处：写进 state.materialSections，并把已生成的正文按新章节重排。
     同一标题的正文原样保留，新加的章节先写「待补充」——不静默丢内容，也不留已经删掉的章。 */
  function setSections(outputKey, list) {
    const cut = (value) => U.text(value).replace(/\s+/g, ' ').trim();
    const next = list.map(cut);
    const def = materialDef(OUTPUT_ITEMS.find((entry) => entry.key === outputKey)?.skill)?.sections || [];
    const custom = (state().materialSections ||= {});
    /* 跟内置默认一模一样时不留自定义，免得以后改了默认章节，这份材料还停在旧版本 */
    if (next.join('|') === def.join('|')) delete custom[outputKey];
    else custom[outputKey] = next;
    syncSectionsToDoc(outputKey);
    store().save();
    render();
  }

  /* 章节变了就让已生成的正文跟着走：标题没变的保留原内容，新章节先占位 */
  function syncSectionsToDoc(outputKey) {
    const doc = state().materials[outputKey];
    if (!doc) return;
    const list = chosenSections(outputKey);
    if (!list.length) return;
    const keep = new Map((doc.sections || []).map((section) => [section.heading, section.body]));
    doc.sections = list.map((heading) => ({ heading, body: keep.get(heading) ?? '待补充' }));
  }

  /* 每章写成正文还是表格：由 materials.js 的 materialForms 指定；
     模板 / 参考件带来的章节不在表里，就交给模型按「是不是清单」自己判断。 */
  function chosenForms(outputKey) {
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const forms = window.SKILLS.materialForms?.[item?.skill] || {};
    const picked = {};
    for (const heading of chosenSections(outputKey)) if (forms[heading]) picked[heading] = forms[heading];
    return picked;
  }

  /* 章节编辑面板：删 / 加 / 改名 / 恢复默认。改动立刻写进状态，已生成的正文跟着重排
     （见 setSections），下一次生成也按这份章节走。 */
  function sectionPanel(outputKey) {
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const list = sectionListOf(outputKey);
    const custom = Boolean(state().materialSections?.[outputKey]?.length);
    const rows = list.map((heading, index) => `<div class="section-row">
      <span class="section-index">${index + 1}</span>
      <input class="section-name" data-section-name="${outputKey}" data-section-index="${index}" value="${escapeHtml(heading)}" placeholder="章节标题，例如「五、应急处置」" />
      <button type="button" class="section-del" data-section-del="${outputKey}" data-section-index="${index}" title="删掉这一章">×</button>
    </div>`).join('');
    return `<section class="section-panel" data-section-panel="${outputKey}">
      <p class="section-hint">这是《${escapeHtml(item?.label || '')}》生成时的章节表：<b>删掉的不再生成</b>，也能改名或添加。改动立刻生效——已生成的正文按新章节重排（标题没变的保留内容，新章节先写「待补充」）。上传模板或挂参考件会把章节整份换掉。</p>
      <div class="section-rows">${rows || '<p class="section-empty">一章都没了，先加一章。</p>'}</div>
      <div class="section-actions">
        <button type="button" class="button button-ghost" data-section-add="${outputKey}">＋ 添加章节</button>
        <button type="button" class="button button-quiet" data-section-reset="${outputKey}" ${custom ? '' : 'disabled'} title="回到内置默认章节">恢复默认</button>
        <button type="button" class="button button-quiet" data-section-close="${outputKey}">收起</button>
      </div>
    </section>`;
  }

  /* 这份材料的章节来自哪里，写进文档元信息，免得误以为是内置章节 */
  function sectionSource(outputKey) {
    if (state().materialSections?.[outputKey]?.length) return '自定义章节';
    const templateId = state().materialTemplates[outputKey];
    const template = state().templates.find((entry) => entry.id === templateId);
    if (template) return `模板《${template.name}》`;
    const reference = referenceOf(outputKey);
    if (reference && referenceSections(outputKey).length) return `参考《${reference.name}》`;
    return '默认章节';
  }

  function renderTemplateBar() {
    const templates = state().templates;
    const bar = $('#templateBar');
    if (!templates.length) {
      bar.innerHTML = '<div class="template-chip"><small>尚未上传模板，材料将使用内置默认章节。上传学校模板后，生成时会按模板章节逐字对齐。</small></div>';
      return;
    }
    bar.innerHTML = templates.map((template) => `<div class="template-chip">
      <b>${escapeHtml(template.name)}</b>
      <small>${escapeHtml(template.kind)} · ${template.sections.length} 个章节${template.tables?.length ? ` · ${template.tables.length} 张表格` : ''}</small>
      <button data-template-remove="${template.id}" title="删除模板">×</button>
    </div>`).join('');
  }

  /* 参考件的覆盖核对：参考的栏目 / 字段在产出里找到几个 */
  function checkBadge(report) {
    const ok = report.columns.covered === report.columns.total && report.fields.covered === report.fields.total;
    const missing = [...report.columns.missing, ...report.fields.missing];
    const title = ok ? '参考里的栏目与字段都覆盖到了' : `还差：${missing.slice(0, 6).join('、')}${missing.length > 6 ? ' 等' : ''}`;
    return `<span class="reference-check ${ok ? 'is-ok' : 'is-gap'}" title="${escapeHtml(title)}">${ok ? '✓' : '!'} 栏目 ${report.columns.covered}/${report.columns.total} · 字段 ${report.fields.covered}/${report.fields.total}</span>`;
  }

  /* 参考件状态：没传就引导上传；传了显示解析结果与核对结论 */
  function referenceControl(outputKey) {
    const reference = referenceOf(outputKey);
    const canWrite = U.canOperate();
    if (!reference) {
      return canWrite
        ? `<button class="button button-ghost reference-add" data-material-reference-add="${outputKey}" title="点这里选文件，或把 .docx / .md / .txt 直接拖到这张卡片上：生成时栏目与字段按它对齐">⇪ 上传参考</button>`
        : '';
    }
    const doc = state().materials[outputKey];
    const report = doc ? docxLib().matchReport(reference, doc) : null;
    const buttons = canWrite
      ? `<button data-material-reference-add="${outputKey}" title="换一份参考件（也可以直接把文件拖到这张卡片上）">↻</button>
         <button data-material-reference-remove="${outputKey}" title="移除参考件">×</button>`
      : '';
    return `<span class="reference-chip" title="${escapeHtml(`生成时按《${reference.name}》的栏目与字段对齐；导出 Word 时照它的版式排版`)}">
      <b>参考</b><span class="reference-name">${escapeHtml(reference.name)}</span>
      <small>${escapeHtml(docxLib().summaryOf(reference))}</small>${report ? checkBadge(report) : ''}${referenceTags(outputKey, reference)}${buttons}</span>`;
  }

  /* 参考件除了「栏目与字段」，还有两件事在卡片上要说清楚：
     ① 版式（字体 / 页边距 / 页眉页脚 / 表格线）会跟着导出；② 正文是否已经按它重排过。 */
  function referenceTags(outputKey, reference) {
    const doc = state().materials[outputKey];
    const tags = [];
    if (reference.kit) tags.push('<span class="reference-check is-ok" title="导出 Word 时会照参考的样式表、页面设置与页眉页脚排版">版式 ✓</span>');
    if (reference.package) tags.push('<span class="reference-check is-ok" title="这份参考整包存下来了：可以「参考表填值」，导出时结构照抄，只换识别出的值">可填值</span>');
    /* 老版本存的参考只有栏目 / 字段 / 版式，没有整包快照 —— 原表填值要的是参考件本身 */
    if (reference.kind === 'docx' && !reference.package) tags.push('<span class="reference-check is-gap" title="这份参考是升级之前存的，没留下整包快照；重新上传同一份 Word 就能用「Word（参考原表）」按原表导出">旧参考</span>');
    if (doc?.reframedFrom === reference.name) tags.push('<span class="reference-check is-ok" title="正文已按这份参考重排过">已重排</span>');
    return tags.join('');
  }

  /* 「按参考重排」按钮：只有挂了参考、且这份材料已经生成时才出现 */
  function reframeButton(outputKey, doc) {
    const reference = referenceOf(outputKey);
    if (!reference || !U.canOperate()) return '';
    if (!window.WB.ai.ready) return `<button class="button button-quiet" disabled title="${escapeHtml(U.AI_OFFLINE_HINT)}">⇄ 按参考重排</button>`;
    if (doc.reframedFrom) {
      return `<button class="button button-quiet" data-material-reframe="${outputKey}" title="再按参考重排一次">⇄ 重新重排</button>
        <button class="button button-quiet" data-material-reframe-undo="${outputKey}" title="回到重排前的正文">↺ 撤回重排</button>`;
    }
    return `<button class="button button-quiet" data-material-reframe="${outputKey}" title="让 AI 按《${escapeHtml(reference.name)}》的栏目、字段与表格列重排当前正文；会替换正文，可撤回">⇄ 按参考重排</button>`;
  }

  /* 编辑器里的参考面板：栏目 / 字段 / 原文 / 缺项 */
  function referencePanel(outputKey, reference) {
    const canWrite = U.canOperate();
    const doc = state().materials[outputKey];
    const report = doc ? docxLib().matchReport(reference, doc) : null;
    const missing = report ? [...report.columns.missing, ...report.fields.missing] : [];
    const gap = Boolean(report) && (report.columns.covered < report.columns.total || report.fields.covered < report.fields.total);
    const tags = (list, empty) => (list.length
      ? list.map((item) => `<span class="reference-tag">${escapeHtml(item)}</span>`).join('')
      : `<span class="reference-tag is-empty">${empty}</span>`);
    return `<details class="material-reference"${gap ? ' open' : ''}>
      <summary><b>参考件</b><span class="reference-name">${escapeHtml(reference.name)}</span>
        <small>${escapeHtml(docxLib().summaryOf(reference))}</small>${report ? checkBadge(report) : ''}</summary>
      <div class="material-reference-body">
        <p class="material-reference-hint">生成时按这份参考的栏目与字段对齐；核对是参考与上方正文逐项比对的结果，只说明有没有写到，不判断内容对错。</p>
        <p class="material-reference-hint">${reference.kit
          ? `导出 Word 会照这份参考的版式：样式表、页面设置${reference.kit.refs?.length ? '与页眉页脚' : ''}都沿用原表${reference.kit.dropped?.length ? '（部分部件超出存档预算已省略）' : ''}。`
          : '这份参考只能用于栏目与字段对齐（可能是 .md / .txt，或版式部件超出了存档预算），Word 导出用默认版式。'}</p>
        ${reference.kind === 'docx' && !reference.package ? '<p class="reference-missing">这份参考是升级之前存的，没留下整包快照，所以只能用于栏目、字段与版式对齐。点「换一份参考」重新上传同一份 Word，卡片上就会出现「Word（参考原表）」——导出的是这份表本身，肉眼结构一致，只换填过的值。</p>' : ''}
        <div class="reference-tags"><i>栏目</i>${tags(reference.sections.map((section) => section.heading), '未识别到栏目')}</div>
        <div class="reference-tags"><i>字段</i>${tags(reference.fields, '未识别到字段')}</div>
        ${missing.length ? `<p class="reference-missing">参考里有、正文里还没找到：${escapeHtml(missing.slice(0, 10).join('、'))}${missing.length > 10 ? ` 等 ${missing.length} 项` : ''}</p>` : ''}
        <details class="reference-source"><summary>查看解析出的原文（${reference.chars} 字${reference.truncated ? '，已截断' : ''}）</summary><pre>${escapeHtml(reference.text)}</pre></details>
        ${canWrite ? `<div class="reference-actions">
          <button class="button button-quiet" data-material-reference-add="${outputKey}">换一份参考</button>
          <button class="button button-quiet" data-material-reference-remove="${outputKey}">移除参考</button>
        </div>` : ''}
      </div>
    </details>`;
  }

  /* ── 参考表填值：原表填充（离线保真）──────────
     把上传的参考 Word 当成一张要填的表：表格怎么画、栏目叫什么、分几个部分、条目数量、
     缩进、页眉页脚、图片全部照抄，只有被识别成「值」的那几处文字换成本项目的内容。
     默认值取自项目信息表，剩下的可以手填，也可以让 AI 补；导出时只重写 document.xml，
     其余部件逐字节照搬，所以导出的就是「这份参考表本身」。与「按参考重排」的区别：
     这条路不重写正文，只换值，离线也能用。 */

  const fillModels = new Map();
  const fillOpen = new Set();
  /* 章节面板的开合：和 fillOpen 一样只放内存，不写进存档 */
  const sectionsOpen = new Set();
  const fillScope = new Map();
  /* 逐格填空：索引只放内存（和 fillOpen / fillScope 一样），不写进存档；
     fillBasis 暂存「这一格的值是谁给的依据」，只在当次会话里显示。 */
  const fillStep = new Map();
  const fillBasis = new Map();
  const AI_FILL_BATCH = 12;
  const FILL_SCOPES = [
    { value: 'main', label: '字段与段落' },
    { value: 'field', label: '仅字段' },
    { value: 'all', label: '全部空位' }
  ];
  const KIND_HINT = { field: '字段', text: '段落', cell: '表格格' };

  const packageOf = (outputKey) => referenceOf(outputKey)?.package || null;
  const fillScopeOf = (outputKey) => fillScope.get(outputKey) || 'main';
  const fillOwnOf = (outputKey) => (state().fillDrafts || {})[outputKey] || {};

  function fillDraftsOf(outputKey) {
    const all = (state().fillDrafts ||= {});
    if (!all[outputKey]) all[outputKey] = {};
    return all[outputKey];
  }

  /* 参考正文 + 空位表 + 从项目信息表推出来的默认值；按参考件的 id 缓存 */
  async function fillModel(outputKey) {
    const reference = referenceOf(outputKey);
    if (!reference?.package) return null;
    const cached = fillModels.get(outputKey);
    if (cached && cached.token === reference.id) return cached;
    const xml = await docxLib().documentXmlOf(reference.package);
    const model = docxLib().fillSlots(xml);
    const draft = docxLib().fillDraft(model, state().project?.basic || {});
    const next = { token: reference.id, name: reference.name, xml, model, draft };
    fillModels.set(outputKey, next);
    return next;
  }

  const fillVisible = (slot, scope) => (scope === 'all'
    ? true
    : scope === 'field' ? slot.kind === 'field' : slot.kind !== 'cell');

  /* 空位当前的值：手改优先，其次项目信息表的草稿；都没有就留空（= 保留参考里的字） */
  function fillValueOf(outputKey, model, slotId) {
    const own = fillOwnOf(outputKey);
    if (own[slotId] !== undefined) return own[slotId];
    return model.draft.values[slotId] || '';
  }

  function fillValues(outputKey, model) {
    return { ...model.draft.values, ...fillOwnOf(outputKey) };
  }

  const fillFilledCount = (outputKey, model) => model.model.slots
    .filter((slot) => U.text(fillValueOf(outputKey, model, slot.id)) !== '').length;

  /* ── 逐格填空 ──────────────────────────────
     一屏几十个输入框容易让人不知道从哪下手，这里改成一次只看一格：
     位置、字段名、参考原文、默认值来源都在眼前，填完自动翻到下一个空格。 */
  const fillStepOn = (outputKey) => fillStep.has(outputKey);
  const fillBasisOf = (outputKey, slotId) => fillBasis.get(outputKey)?.[slotId] || '';
  function basisStore(outputKey) {
    if (!fillBasis.has(outputKey)) fillBasis.set(outputKey, {});
    return fillBasis.get(outputKey);
  }

  function fillStepSlots(outputKey, cache) {
    const scope = fillScopeOf(outputKey);
    return cache.model.slots.filter((slot) => fillVisible(slot, scope));
  }

  function fillStepIndex(outputKey, list) {
    if (!list.length) return 0;
    const raw = fillStep.get(outputKey);
    const index = Number.isInteger(raw) ? raw : 0;
    return Math.min(Math.max(index, 0), list.length - 1);
  }

  function fillStepMove(outputKey, delta) {
    const cache = fillModels.get(outputKey);
    if (!cache) return;
    const list = fillStepSlots(outputKey, cache);
    if (!list.length) return;
    fillStep.set(outputKey, fillStepIndex(outputKey, list) + delta);
  }

  /* 停在当前范围内的第一处空格（没有空格就回到第一格） */
  function fillStepReset(outputKey) {
    if (!fillStepOn(outputKey)) return;
    const cache = fillModels.get(outputKey);
    const list = cache ? fillStepSlots(outputKey, cache) : [];
    const values = cache ? fillValues(outputKey, cache) : {};
    const first = list.findIndex((slot) => U.text(values[slot.id]) === '');
    fillStep.set(outputKey, first === -1 ? 0 : first);
  }

  /* 沿 step 方向找下一个还没填的格子；找不到返回 false，让调用方给个提示 */
  function fillStepSeek(outputKey, step) {
    const cache = fillModels.get(outputKey);
    if (!cache) return false;
    const list = fillStepSlots(outputKey, cache);
    const values = fillValues(outputKey, cache);
    const from = fillStepIndex(outputKey, list);
    for (let index = from + step; index >= 0 && index < list.length; index += step) {
      if (U.text(values[list[index].id]) === '') { fillStep.set(outputKey, index); return true; }
    }
    return false;
  }

  function toggleFillStep(outputKey) {
    if (fillStepOn(outputKey)) {
      fillStep.delete(outputKey);
      render();
      return;
    }
    fillStep.set(outputKey, 0);
    fillStepReset(outputKey);
    const cache = fillModels.get(outputKey);
    const total = cache ? fillStepSlots(outputKey, cache).length : 0;
    render();
    window.WB.toast(total ? `逐格填空：共 ${total} 格，从第一处空格开始` : '这个范围里没有空位');
  }

  function fillStepBody(outputKey, cache) {
    const canWrite = U.canOperate();
    const list = fillStepSlots(outputKey, cache);
    if (!list.length) return '';
    const index = fillStepIndex(outputKey, list);
    const slot = list[index];
    const values = fillValues(outputKey, cache);
    const value = values[slot.id] !== undefined ? values[slot.id] : '';
    const blank = fillOwnOf(outputKey)[slot.id] === '';
    const fromDraft = cache.draft.values[slot.id] !== undefined;
    const basis = fillBasisOf(outputKey, slot.id);
    const placeholder = slot.now ? `留空就保留参考里的「${slot.now}」` : '留空 = 保持原样';
    const input = slot.kind === 'text'
      ? `<textarea class="fill-input fill-step-input" rows="3" data-fill-input="${slot.id}" ${canWrite ? '' : 'disabled '}placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
      : `<input class="fill-input fill-step-input" type="text" data-fill-input="${slot.id}" value="${escapeHtml(value)}" ${canWrite ? '' : 'disabled '}placeholder="${escapeHtml(placeholder)}">`;
    const actions = canWrite ? `<div class="fill-step-actions">
        <button class="button button-ghost" data-fill-step-prev="${outputKey}" ${index === 0 ? 'disabled' : ''}>← 上一格</button>
        <button class="button button-ghost" data-fill-step-next="${outputKey}">下一格 →</button>
        <button class="button button-ghost" data-fill-step-skip="${outputKey}" title="往后找第一个还没填的格子">跳到下一个空格</button>
        <button class="button button-quiet" data-fill-step-ai="${outputKey}"><span>✦</span> 让 AI 只填这一格</button>
        <button class="button button-quiet" data-fill-step-blank="${outputKey}">${blank ? '取消置空' : '这一格置空'}</button>
      </div>` : '';
    return `<div class="fill-step" data-fill-step-body="${outputKey}">
      <div class="fill-step-head">
        <span class="fill-step-pos">第 ${index + 1} / ${list.length} 格 · 已填 ${fillFilledCount(outputKey, cache)}</span>
        <span class="fill-step-where">${escapeHtml(slot.where || (slot.kind === 'cell' ? '表格数据格' : '正文'))}</span>
      </div>
      <div class="fill-step-name">${fromDraft ? '<i class="fill-from" title="默认值来自项目信息表">表</i>' : ''}${slot.label ? escapeHtml(slot.label) : `<i>（${KIND_HINT[slot.kind]}）</i>`}${blank ? '<i class="fill-step-flag">置空</i>' : ''}</div>
      ${input}
      <div class="fill-step-meta">
        <small class="fill-now" title="参考里的原文">参考原文：${escapeHtml(slot.now || '（空）')}</small>
        ${basis ? `<small class="fill-basis">AI 依据：${escapeHtml(basis)}</small>` : ''}
      </div>
      ${actions}
    </div>`;
  }
  function fillRow(outputKey, slot, model, canWrite) {
    const own = fillOwnOf(outputKey);
    const value = fillValueOf(outputKey, model, slot.id);
    const blank = own[slot.id] === '';
    const placeholder = slot.now ? `留空 = 保留「${slot.now}」` : '留空 = 保持原样';
    const input = slot.kind === 'text'
      ? `<textarea class="fill-input" rows="2" data-fill-input="${slot.id}" ${canWrite ? '' : 'disabled '}placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
      : `<input class="fill-input" type="text" data-fill-input="${slot.id}" value="${escapeHtml(value)}" ${canWrite ? '' : 'disabled '}placeholder="${escapeHtml(placeholder)}">`;
    const from = model.draft.values[slot.id] !== undefined ? '<i class="fill-from" title="默认值来自项目信息表">表</i>' : '';
    return `<div class="fill-row${U.text(value) ? ' is-filled' : ''}" data-fill-row="${slot.id}">
        <span class="fill-label">${from}${slot.label ? escapeHtml(slot.label) : `<i>（${KIND_HINT[slot.kind]}）</i>`}</span>
        ${input}
        <label class="fill-blank" title="这一格输出为空（即使参考里有字）">${canWrite ? `<input type="checkbox" data-fill-blank="${slot.id}"${blank ? ' checked' : ''}>` : ''}置空</label>
        <small class="fill-now" title="参考里的原文">${escapeHtml(slot.now || '（空）')}</small>
      </div>`;
  }

  function fillGroups(model, scope) {
    const groups = [];
    const index = new Map();
    for (const slot of model.model.slots) {
      if (!fillVisible(slot, scope)) continue;
      const name = slot.where || '封面 / 表头';
      if (!index.has(name)) { index.set(name, groups.length); groups.push({ name, slots: [] }); }
      groups[index.get(name)].slots.push(slot);
    }
    return groups;
  }

  function fillPanel(outputKey) {
    const reference = referenceOf(outputKey);
    const cache = fillModels.get(outputKey);
    if (!cache) {
      return `<section class="fill-panel" data-fill-panel="${outputKey}"><p class="fill-hint">正在读取《${escapeHtml(reference?.name || '参考件')}》…</p></section>`;
    }
    const canWrite = U.canOperate();
    const slots = cache.model.slots;
    const values = fillValues(outputKey, cache);
    const filled = fillFilledCount(outputKey, cache);
    const counts = {
      main: slots.filter((slot) => fillVisible(slot, 'main')).length,
      field: slots.filter((slot) => slot.kind === 'field').length,
      all: slots.length
    };
    const scope = fillScopeOf(outputKey);
    const stepOn = fillStepOn(outputKey);
    const groups = fillGroups(cache, scope);
    const groupsHtml = groups.map((group) => `<details class="fill-group"${group.slots.some((slot) => U.text(values[slot.id])) ? ' open' : ''}>
        <summary><b>${escapeHtml(group.name)}</b><small>${group.slots.length} 处</small></summary>
        ${group.slots.map((slot) => fillRow(outputKey, slot, cache, canWrite)).join('')}
      </details>`).join('');
    const body = stepOn ? fillStepBody(outputKey, cache) : groupsHtml;
    return `<section class="fill-panel" data-fill-panel="${outputKey}">
      <div class="fill-head">
        <b>参考表填值</b>
        <span class="reference-name">${escapeHtml(reference.name)}</span>
        <span class="fill-count" data-fill-count>${slots.length} 个空位 · 已填 ${filled} 个</span>
        <span class="fill-scopes">${FILL_SCOPES.map((item) => `<button class="fill-scope${item.value === scope ? ' is-on' : ''}" data-fill-scope="${item.value}" data-fill-owner="${outputKey}">${item.label} ${counts[item.value]}</button>`).join('')}</span>
        <span class="fill-actions">
          <button class="button button-quiet" data-fill-step-toggle="${outputKey}" title="一次只看一格，逐格往前填；「让 AI 只填这一格」也只会围绕这一格给建议">${stepOn ? '切换列表视图' : '逐格填空'}</button>
          <button class="button button-primary" data-fill-download="${outputKey}" title="导出的就是这份参考表：表格、栏目、条目数、缩进、页眉页脚全按参考，只有下面填了值的地方被换掉">下载填好的 Word</button>
          <button class="button button-quiet" data-fill-ai="${outputKey}" ${window.WB.ai.ready && canWrite ? '' : 'disabled'} title="${escapeHtml(window.WB.ai.ready ? '让 AI 只补还没填的空位，不动结构' : U.AI_OFFLINE_HINT)}">AI 补全空位</button>
          <button class="button button-quiet" data-fill-reset="${outputKey}" ${canWrite ? '' : 'disabled'} title="清掉手改，回到项目信息表推出来的默认值">清空手改</button>
          <button class="button button-ghost" data-fill-close="${outputKey}">收起</button>
        </span>
      </div>
      <p class="fill-hint">${canWrite ? '留空的位置原样保留参考里的文字，勾「置空」则这一格输出为空；只有填了内容的地方才会被换掉。' : '只读访客可以导出，手改需要成员或组织者身份。'}这里导出的就是参考件本身（等同卡片上的「Word（参考原表）」）：表格、栏目、条目数、缩进、页眉页脚全照参考。需要让 AI 按参考重写一篇正文时，用卡片上的「按参考重排」。带 <i class="fill-from">表</i> 小标记的值，是从这个项目的项目信息表推出来的；点「AI 补全空位」时，AI 也会读你填过的项目信息表 / 任务分解 / 风险台账 / 资源台账 / 素材库与参考原文——不用在这里重抄一遍，直接填到对应的视图里就行。</p>
      ${body || '<p class="fill-hint">这个范围里没有空位，换「全部空位」看看。</p>'}
    </section>`;
  }

  function openFill(outputKey) {
    fillOpen.add(outputKey);
    render();
    fillModel(outputKey).then((model) => {
      if (model && fillOpen.has(outputKey)) render();
    }).catch(() => window.WB.toast('读取参考表失败，请重新上传参考件'));
  }

  function closeFill(outputKey) {
    fillOpen.delete(outputKey);
    fillStep.delete(outputKey);
    render();
  }

  function refreshFillCount(outputKey) {
    const model = fillModels.get(outputKey);
    const node = document.querySelector(`[data-fill-panel="${outputKey}"] [data-fill-count]`);
    if (!model || !node) return;
    node.textContent = `${model.model.slots.length} 个空位 · 已填 ${fillFilledCount(outputKey, model)} 个`;
  }

  /* 打字时只改内存（不落盘、不重绘，免得打断输入）；失焦那次 change 再 save */
  function setFillValue(outputKey, slotId, value) {
    if (!U.canOperate()) return;
    const model = fillModels.get(outputKey);
    if (!model) return;
    const drafts = fillDraftsOf(outputKey);
    const next = String(value ?? '');
    if (next === (model.draft.values[slotId] || '')) delete drafts[slotId];
    else drafts[slotId] = next;
    const row = document.querySelector(`[data-fill-row="${slotId}"]`);
    if (row) row.classList.toggle('is-filled', U.text(next) !== '');
    refreshFillCount(outputKey);
  }

  function setFillBlank(outputKey, slotId, blank) {
    if (!U.canOperate()) return;
    const drafts = fillDraftsOf(outputKey);
    if (blank) drafts[slotId] = '';
    else delete drafts[slotId];
    const row = document.querySelector(`[data-fill-row="${slotId}"]`);
    const input = row?.querySelector('[data-fill-input]');
    if (input) { input.value = blank ? '' : (fillModels.get(outputKey)?.draft.values[slotId] || ''); input.disabled = blank; }
    if (row) row.classList.toggle('is-filled', !blank && Boolean(U.text(input?.value)));
    store().save();
    refreshFillCount(outputKey);
  }

  function resetFill(outputKey) {
    if (!U.canOperate()) return;
    delete (state().fillDrafts || {})[outputKey];
    store().save();
    render();
    window.WB.toast('已清空手改，回到项目信息表推出来的默认值');
  }

  /* 导出：只换值不改结构。参考件里除 document.xml 之外的部件逐字节照搬 */
  async function fillFromReference(outputKey) {
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const reference = referenceOf(outputKey);
    const model = await fillModel(outputKey);
    if (!item || !reference || !model) { window.WB.toast('这份材料还没挂可填值的参考件'); return false; }
    const values = fillValues(outputKey, model);
    const filled = model.model.slots.filter((slot) => U.text(values[slot.id]) !== '').length;
    window.WB.toast(`正在按《${reference.name}》填值…`);
    try {
      const xml = docxLib().applyFill(model.xml, model.model, values);
      const bytes = await docxLib().fillPackage(reference.package, xml);
      const name = `${U.safeFileName(store().projectName())}-${item.label}-按参考.docx`;
      U.downloadBytes(name, bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      store().log('material', `按参考《${reference.name}》填值导出《${item.label}》：${filled}/${model.model.slots.length} 个空位`);
      window.WB.toast(`已导出《${item.label}》：结构照《${reference.name}》，共填入 ${filled} 处`);
      return true;
    } catch (error) {
      window.WB.toast(error.message || '按参考填值失败');
      return false;
    }
  }

  /* AI 只补空位：发出去的是「空位清单 + 项目上下文」，收回来的是 { id, value }，不碰结构。

     踩过的坑：① 一开始只发了 16 个基本信息字段，任务分解 / 风险 / 资源 / 参考原文都没给，
     模型没依据只能留空；② 表格里的数据格（占这份表一多半）被整类跳过，从来没进过提示词；
     ③ 一批 30 个空位，模型经常只答前几个。
     现在：上下文与「生成正文」同源（materialInput），空位一次 12 个，输入里的每个 id 都要求回一行，
     没依据的显式回空串 —— 这样「AI 没看到」和「AI 真没依据」能分开。 */
  const fillSlotView = (slot) => {
    const row = {
      id: slot.id,
      栏目: slot.where,
      字段: U.text(slot.label) || (slot.kind === 'cell' ? '表格数据格' : '正文段'),
      参考原文: slot.now
    };
    if (slot.kind === 'cell') row.类型 = '表格数据格（按表头列名定位）';
    if (slot.max) row.字数上限 = slot.max;
    return row;
  };

  /* 模型可能回 {"values":[...]}、{ id: value } 的映射，或直接一个数组，三种都认 */
  function normaliseFillRows(data, slots) {
    const known = new Set(slots.map((slot) => slot.id));
    /* 值可能是裸字符串，也可能是 { value } / { 值 } 甚至再套一层 */
    const pick = (source) => {
      if (source == null) return '';
      if (typeof source !== 'object') return U.text(source);
      const inner = source.value ?? source.值;
      if (inner && typeof inner === 'object') return U.text(inner.value ?? inner.值);
      return U.text(inner);
    };
    let raw = data;
    if (Array.isArray(raw)) raw = raw;
    else if (raw && typeof raw === 'object' && raw.values !== undefined) raw = raw.values;
    else if (raw && typeof raw === 'object') raw = Object.entries(raw).map(([id, value]) => ({ id, value }));
    else raw = [];
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.entries(raw).map(([id, value]) => ({ id, value })) : []);
    return list.map((row) => {
      const source = row && typeof row === 'object' && !Array.isArray(row) ? row : { value: row };
      const id = U.text(source.id ?? source.ID ?? source.空位 ?? source.slot);
      return { id: known.has(id) ? id : '', value: pick(source), basis: U.text(source.basis ?? source.依据) };
    }).filter((row) => row.id);
  }

  /* 与「生成正文」共用同一套项目上下文（基本信息 / 任务分解 / 风险 / 资源 / 素材 / 参考原文…）；
     只把参考原文截到 3000 字，保证紧随其后的「空位」清单不会被服务端的 40000 字上限截掉 */
  function fillContext(outputKey) {
    const current = state();
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    if (!item) return {};
    const template = current.templates.find((entry) => entry.id === current.materialTemplates[outputKey]);
    const base = materialInput(item, template);
    if (base.参考样例 && typeof base.参考样例 === 'object') {
      base.参考样例 = { ...base.参考样例, 原文: U.text(base.参考样例.原文).slice(0, 3000) };
    }
    return base;
  }

  async function aiFillSlots(outputKey) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改动填值表'); return false; }
    const reference = referenceOf(outputKey);
    const model = await fillModel(outputKey);
    if (!reference || !model) { window.WB.toast('这份材料还没挂参考件'); return false; }
    if (!window.WB.ai.ready) { window.WB.toast(U.AI_OFFLINE_HINT); return false; }
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    if (!item) { window.WB.toast('找不到这份产出的定义'); return false; }
    const values = fillValues(outputKey, model);
    const todo = model.model.slots.filter((slot) => U.text(values[slot.id]) === '');
    if (!todo.length) { window.WB.toast('需要补的空位已经填完了'); return false; }
    const context = fillContext(outputKey);
    let filled = 0;
    let blank = 0;
    const decided = {};
    for (let index = 0; index < todo.length; index += AI_FILL_BATCH) {
      const batch = todo.slice(index, index + AI_FILL_BATCH);
      window.WB.toast(`正在补空位（${index + batch.length}/${todo.length}）…`);
      /* 「空位」与「约束」放最前面：服务端对 input 有 40000 字上限，真要截断也先保住清单；
         体量大的项目上下文（任务分解 / 风险 / 参考原文…）放到最后。 */
      const data = await window.WB.ai.run(item.skill, {
        产出: item.label,
        任务: `《${reference.name}》是一份要填的表。下面 ${batch.length} 个空位还没填，请给出每一格该写的文字。`,
        空位: batch.map(fillSlotView),
        已填对照: Object.entries(decided).slice(-20).map(([id, value]) => ({ id, value })),
        约束: [
          '输入里的每一个 id 都必须原样出现在 values 里，一个都不能少；没有依据的就回空字符串。',
          '只给值：不要写栏目名、不要写「字段：」、不要编号、不要解释。',
          '依据顺序：① 项目信息表 ② 任务分解 / 风险台账 / 资源台账 / 素材库里的既有事实 ③ 参考原文的写法。',
          '数字格（金额 / 费用 / 单价 / 合计 / 数量 / 人数）只能用上面这些既有数字，算不出、找不到依据就留空，不要编。',
          '不要照抄参考原文里属于别的事实的值（时间、地点、人名、单位名、金额）。',
          '同一份表里的口径要一致：同一个负责人 / 环节 / 时间在别处已经定过，就照已填对照里的写法。'
        ].join('\n'),
        ...context
      }, window.WB.ai.fillContract(), '/api/material');
      const drafts = fillDraftsOf(outputKey);
      for (const row of normaliseFillRows(data, model.model.slots)) {
        const { id, value, basis } = row;
        if (!id) continue;
        if (!value) { blank += 1; continue; }
        drafts[id] = value;
        decided[id] = value;
        if (basis) basisStore(outputKey)[id] = basis;
        filled += 1;
      }
      store().save();
    }
    render();
    const skipped = Math.max(0, todo.length - filled - blank);
    const tail = blank ? `，另有 ${blank} 个它认为没有依据（留空）` : '';
    const miss = skipped ? `，${skipped} 个没回` : '';
    window.WB.toast(filled ? `AI 补了 ${filled} 个空位${tail}${miss}，核对后可直接下载` : `AI 没有给出可用的值${tail}，手动填吧`);
    return filled > 0;
  }
  /* 逐格向导专用：一次只问一格。
     上下文只围绕这一处，模型不用在十几个空位里分配注意力，比整批更准；
     回来的 basis 会显示在格子下面，让人知道这个值是从哪推出来的。 */
  async function aiFillOne(outputKey, slotId) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改动填值表'); return false; }
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const model = await fillModel(outputKey);
    if (!item || !model) { window.WB.toast('这份材料还没挂参考件'); return false; }
    if (!window.WB.ai.ready) { window.WB.toast(U.AI_OFFLINE_HINT); return false; }
    const slot = model.model.slots.find((entry) => entry.id === slotId);
    if (!slot) return false;
    const values = fillValues(outputKey, model);
    window.WB.toast('正在让 AI 想这一格…');
    const data = await window.WB.ai.run(item.skill, {
      产出: item.label,
      任务: `这张表里只有 1 个空位要填，请只给出这一格的文字。`,
      空位: [fillSlotView(slot)],
      已填对照: Object.entries(values).filter(([, value]) => U.text(value)).slice(-20).map(([id, value]) => ({ id, value })),
      约束: [
        '只回这一个 id，values 里只需要一行；没有依据就回空字符串。',
        '只给值：不要写栏目名、不要写「字段：」、不要编号、不要解释。',
        '依据顺序：① 项目信息表 ② 任务分解 / 风险台账 / 资源台账 / 素材库里的既有事实 ③ 参考原文的写法。',
        '数字格（金额 / 费用 / 单价 / 合计 / 数量 / 人数）只能用上面这些既有数字，算不出、找不到依据就留空，不要编。',
        '不要照抄参考原文里属于别的事实的值（时间、地点、人名、单位名、金额）。',
        '同一份表里的口径要一致：同一个负责人 / 环节 / 时间在别处已经定过，就照已填对照里的写法。'
      ].join('\n'),
      ...fillContext(outputKey)
    }, window.WB.ai.fillContract(), '/api/material');
    const hit = normaliseFillRows(data, model.model.slots).find((row) => row.id === slotId);
    if (!hit || !hit.value) { window.WB.toast('AI 认为这一格没有依据，留空或手填更稳妥'); return false; }
    fillDraftsOf(outputKey)[slotId] = hit.value;
    if (hit.basis) basisStore(outputKey)[slotId] = hit.basis;
    store().save();
    const preview = U.text(hit.value).slice(0, 24);
    window.WB.toast(`AI 填入：${preview}${hit.basis ? `（依据：${hit.basis}）` : ''}`);
    return true;
  }

  /* ── 材料卡片 ─────────────────────────── */

  function deliveryControls(key, doc) {
    if (!doc) return '';
    return `<div class="delivery-controls"><p>${escapeHtml(doc.materialId || `MAT-${key}`)} · ${doc.aiDraft ? 'AI 草稿（人工编辑后仍须核对）' : '编辑草稿'} · 草稿不作为已交付版本</p>
      <button class="button button-ghost" data-material-publish="${escapeHtml(key)}" data-write ${!U.canOperate() ? 'disabled' : ''}>确认并保存交付版本</button>
      <span>已确认 ${(doc.deliveries || []).filter((v) => v.origin === 'server').length} 个版本</span>
      ${(doc.deliveries || []).map((v) => `<button class="button button-quiet" data-delivery-download="${escapeHtml(key)}" data-version-id="${escapeHtml(v.id)}">下载 V${v.number} 快照${v.origin === 'imported' ? '（导入待确认）' : ''}</button>`).join('')}</div>`;
  }
  async function publishDelivery(key, note = '') {
    if (!U.canOperate()) throw new Error('只读访客不能确认交付版本');
    if (!window.WB.personnel?.account) throw new Error('请先登录本项目实名服务人员账号，再确认交付版本');
    if (!window.WB.sync?.role) await window.WB.personnel.enterWorkbench();
    await window.WB.sync.publishDelivery(key, note);
    render(); window.WB.toast('交付快照已保存；后续编辑草稿不会改变该版本');
  }
  function downloadDelivery(key, id) {
    const material = state().materials[key], version = material?.deliveries?.find((v) => v.id === id);
    if (!version) throw new Error('交付版本不存在');
    U.downloadText(`${U.safeFileName(version.snapshot.material.title)}-${material.materialId}-V${version.number}.json`, JSON.stringify({ materialId: material.materialId, ...version }, null, 2), 'application/json');
  }

  function materialCard(item) {
    if (item.key === 'materialList') {
      const doc = window.WB.inventory.documentOf(state());
      return `<article class="card"><div class="card-title"><h3>物料与设备清单 · 来自资源台账</h3></div><div class="help-body"><p>名称、数量、库存、借出、单价、地点与责任人统一在「人员与资源 → 物资与资源」维护；采购发票在资源行上传，此处按最新台账查看与导出。预算与决算表的逐行发票入口仍保留。</p><button class="button button-primary" data-goto-view="resources" data-goto-resource-section="inventory">去管理物资与上传发票</button><button class="button button-ghost" data-material-export="materialList" data-format="xlsx">Excel</button><button class="button button-ghost" data-material-export="materialList" data-format="docx">Word</button><button class="button button-ghost" data-material-export="materialList" data-format="md">Markdown</button>${deliveryControls(item.key, state().materials[item.key])}${html().toHtml(doc.sections[0].body)}</div></article>`;
    }
    const doc = state().materials[item.key];
    const open = state().ui.openMaterial === item.key;
    const def = materialDef(item.skill);
    const sections = chosenSections(item.key);
    /* structure 类产出（方案比选决策矩阵）不生成正文文档，由「方案比选」视图维护，
       这里给出跳转入口，而不是显示成「未定义章节」。 */
    const isStructure = item.kind === 'structure';
    const ready = Boolean(def) || isStructure;
    const templateId = state().materialTemplates[item.key] || '';
    const templateOptions = state().templates.length
      ? `<select class="material-template" data-material-template="${item.key}">
          <option value="">${escapeHtml(sectionSource(item.key))}（${sections.length} 节）</option>
          ${state().templates.map((t) => `<option value="${t.id}" ${t.id === templateId ? 'selected' : ''}>${escapeHtml(t.name)}（${t.sections.length} 节）</option>`).join('')}
        </select>`
      : '';
    const options = state().options;
    const stateText = isStructure
      ? `由「方案比选」维护 · ${options.selected.length} 个方案 × ${options.criteria.length} 个维度`
      : doc
        ? `${doc.aiDraft || String(doc.source).startsWith('ai') ? 'AI 草稿' : '编辑草稿'} · ${doc.sections.length} 章 · ${doc.sections.reduce((sum, section) => sum + U.text(section.body).length, 0)} 字`
        : ready ? `未生成 · 将输出 ${sections.length} 章` : '未定义章节';
    const isPoster = item.kind === 'graphic';
    const aiOffline = U.offline();
    /* 可写且能挂参考的卡片同时是拖放区：把 .docx / .md / .txt 丢上来就等于点「上传参考」 */
    const dropzone = ready && !isStructure ? ` data-material-dropzone="${item.key}"` : '';
    const reference = referenceOf(item.key);
    const fillable = Boolean(reference?.package);
    return `<article class="material-card ${open ? 'is-open' : ''}" data-material="${item.key}"${dropzone}>
      <header class="material-head">
        <span class="phase-pill phase-${item.phase}">${escapeHtml(PHASE_LABEL[item.phase])}</span>
        <h3>${escapeHtml(item.label)}</h3>
        <span class="kind-chip">${escapeHtml({ document: '文档', table: '表格', graphic: '图形' }[item.kind] || '')}</span>
        <span class="material-state">${escapeHtml(stateText)}</span>
        <div class="material-actions">
          ${ready && !isStructure ? templateOptions : ''}
          ${ready && !isStructure ? `<button class="button button-quiet" data-material-sections-toggle="${item.key}" title="这一份材料生成哪几章：可以删、改名、添加">章节 ${escapeHtml(String(sections.length))}</button>` : ''}
          ${ready && !isStructure ? referenceControl(item.key) : ''}
          ${fillable ? `<button class="button button-ghost" data-material-fill="${item.key}" title="${escapeHtml(`把《${reference.name}》当成一张要填的表：表格、栏目、条目数量、缩进全部照它，只替换识别出的值；离线可用`)}">⇩ 参考表填值</button>` : ''}
          ${isStructure
            ? `<button class="button button-primary" data-material-goto="decision">前往方案比选</button>
               <button class="button button-ghost" data-material-struct-export>导出 Markdown</button>`
            : `<button class="button button-primary" data-material-generate="${item.key}" ${ready && !aiOffline ? '' : 'disabled'} title="${aiOffline ? escapeHtml(U.AI_OFFLINE_HINT) : ''}">${doc ? '重新生成' : 'AI 生成'}</button>
               ${doc ? reframeButton(item.key, doc) : ''}
               ${doc && !isPoster ? `<button class="button button-ghost" data-material-toggle="${item.key}">${open ? '收起' : '编辑'}</button>` : ''}
               ${doc ? downloadButtons(item) : ''}`}
        </div>
      </header>
      ${deliveryControls(item.key, doc)}
      ${sectionsOpen.has(item.key) ? sectionPanel(item.key) : ''}
      ${fillOpen.has(item.key) ? fillPanel(item.key) : ''}
      ${open && doc && !isPoster ? materialEditor(item.key, doc) : ''}
      ${isPoster ? posterCardBody() : ''}
    </article>`;
  }

  /* ── 在线编辑：预览即编辑面 ───────────────
     正文按块渲染成 contenteditable，表格单元格直接点开改；改完只回写这一块，
     其余正文（含表格对齐、空行）原样保留。只有「Markdown 源码」模式才看得到原始文本。 */

  const MAX_INVOICE_BYTES = 400 * 1024;
  const MAX_INVOICE_PER_ROW = 6;

  const html = () => window.WB.markdown;
  const exporters = () => window.WB.exporters;

  const shortName = (name) => {
    const value = String(name || '发票');
    if (value.length <= 16) return value;
    const dot = value.lastIndexOf('.');
    const ext = dot > 0 ? value.slice(dot) : '';
    return `${value.slice(0, Math.max(4, 12 - ext.length))}…${ext}`;
  };

  function previewBlock(outputKey, doc, sectionIndex, blockIndex, block, canWrite) {
    const MD = html();
    const id = `data-material-block="${outputKey}" data-section-index="${sectionIndex}" data-block-index="${blockIndex}"`;
    const edit = canWrite ? ' contenteditable="true" spellcheck="false"' : '';
    if (block.type === 'table') return previewTable(outputKey, doc, sectionIndex, blockIndex, block, canWrite);
    if (block.type === 'hr') return '<hr class="md-hr" />';
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li class="md-edit" ${id}${edit}>${MD.inline(item)}</li>`).join('');
      return `<${tag} class="md-list" ${id}>${items}</${tag}>`;
    }
    if (block.type === 'heading') {
      const level = Math.min(Math.max(block.level + 2, 3), 6);
      return `<h${level} class="md-edit" ${id}${edit}>${MD.inline(block.text)}</h${level}>`;
    }
    if (block.type === 'quote') return `<blockquote class="md-edit" ${id}${edit}>${MD.inline(block.text)}</blockquote>`;
    return `<p class="md-edit" ${id}${edit}>${block.lines.map((line) => MD.inline(line)).join('<br />')}</p>`;
  }

  function invoiceCell(outputKey, doc, sectionIndex, blockIndex, rowIndex, canWrite) {
    const X = exporters();
    const key = X.invoiceKey(sectionIndex, blockIndex, rowIndex);
    const files = X.invoicesOf(doc, key);
    const chips = files.map((file, fileIndex) => {
      const thumb = file.dataUrl && /^image\//.test(file.type || '')
        ? `<img src="${escapeHtml(file.dataUrl)}" alt="" />`
        : '<span class="md-invoice-icon">▤</span>';
      const size = `${Math.max(1, Math.round(Number(file.size || 0) / 1024))} KB`;
      const note = file.stored ? size : `${size}，超过 400 KB 未随项目保存`;
      return `<span class="md-invoice-chip${file.stored ? '' : ' is-meta'}" title="${escapeHtml(`${file.name}（${note}）`)}">
        ${thumb}<b>${escapeHtml(shortName(file.name))}</b>
        ${canWrite ? `<button type="button" class="md-invoice-del" data-material-invoice-remove="${key}" data-invoice-owner="${outputKey}" data-invoice-index="${fileIndex}" title="移除这张发票">×</button>` : ''}
      </span>`;
    }).join('');
    const add = canWrite
      ? `<button type="button" class="md-invoice-add" data-material-invoice-add="${key}" data-invoice-owner="${outputKey}" title="也可以点这里选文件">${files.length ? '＋' : '拖入发票'}</button>`
      : (files.length ? '' : '<span class="md-invoice-empty">—</span>');
    const remove = canWrite
      ? `<button type="button" class="md-row-del" data-material-row-remove="${outputKey}" data-section-index="${sectionIndex}" data-block-index="${blockIndex}" data-row-index="${rowIndex}" title="删除这一行">×</button>`
      : '';
    return `<td class="md-invoice" data-invoice-owner="${outputKey}" data-material-invoice="${key}">${chips}${add}${remove}</td>`;
  }

  function previewTable(outputKey, doc, sectionIndex, blockIndex, block, canWrite) {
    const MD = html();
    const X = exporters();
    const heading = doc.sections[sectionIndex]?.heading || '';
    const money = X.isMoneyTable(block.header, heading);
    const edit = canWrite ? ' contenteditable="true" spellcheck="false"' : '';
    const rows = X.applyTotals(block.header, block.rows);
    const plan = X.columnPlan(block.header, block.rows);
    const hasTotal = rows.some((cells) => X.isTotalRow(cells));
    /* 列数按最宽的一行算：表头比数据短时也不丢列（丢列会连合计 / 占比一起算错） */
    const width = Math.max(block.header.length, ...rows.map((cells) => cells.length), 1);
    const controlHead = money ? '<th class="md-invoice-head">发票</th>' : (canWrite ? '<th class="md-act-col"></th>' : '');
    /* 整行表头是空的（模型漏写表头）时，这一行不画成表头，免得成品顶上挂一排空格子 */
    const headCells = Array.from({ length: width }, (_, colIndex) => `<th data-col="${colIndex}"${edit}>${MD.inline(block.header[colIndex] ?? '')}</th>`).join('');
    const head = block.header.some((cell) => String(cell ?? '').trim()) ? `<thead><tr>${headCells}${controlHead}</tr></thead>` : '';
    const body = rows.map((cells, rowIndex) => {
      const total = X.isTotalRow(cells);
      const tds = Array.from({ length: width }, (_, colIndex) => (total
          ? `<td data-row="${rowIndex}" data-col="${colIndex}" class="md-total-cell" title="自动求和：由上方各行累加，不可编辑">${MD.inline(cells[colIndex] ?? '')}</td>`
          : (plan.shareCols.includes(colIndex)
              ? `<td data-row="${rowIndex}" data-col="${colIndex}" class="md-calc-cell" title="占比 = 本行金额 ÷ 合计金额，自动计算">${MD.inline(cells[colIndex] ?? '')}</td>`
              : `<td data-row="${rowIndex}" data-col="${colIndex}"${edit}>${MD.inline(cells[colIndex] ?? '')}</td>`))).join('');
      const control = money
        ? (total
            ? '<td class="md-invoice md-total-cell" title="合计行不挂发票"></td>'
            : invoiceCell(outputKey, doc, sectionIndex, blockIndex, rowIndex, canWrite))
        : (canWrite
            ? `<td class="md-act-col">${total ? '' : `<button type="button" class="md-row-del" data-material-row-remove="${outputKey}" data-section-index="${sectionIndex}" data-block-index="${blockIndex}" data-row-index="${rowIndex}" title="删除这一行">×</button>`}</td>`
            : '');
      return `<tr${total ? ' class="md-total-row"' : ''}>${tds}${control}</tr>`;
    }).join('');
    const tools = canWrite
      ? `<div class="md-table-tools">
          <button type="button" class="button-quiet" data-material-row-add="${outputKey}" data-section-index="${sectionIndex}" data-block-index="${blockIndex}">＋ 添加一行</button>
          ${money ? '<span class="md-table-hint">发票文件直接拖到对应那一行的「发票」格里</span>' : ''}
          ${money ? '' : '<span class="md-table-hint">悬停行尾的 × 可删除该行</span>'}
          ${hasTotal ? '<span class="md-table-hint">「合计」行自动求和，不能改也不能删</span>' : ''}
          ${plan.shareCols.length ? '<span class="md-table-hint">「占比」按金额实时计算</span>' : ''}
        </div>`
      : '';
    return `<div class="md-table-wrap"><table class="md-table is-editable" data-material-block="${outputKey}" data-section-index="${sectionIndex}" data-block-index="${blockIndex}">
      ${head}
      <tbody>${body}</tbody>
    </table></div>${tools}`;
  }
  function previewBody(outputKey, doc, sectionIndex, section, canWrite) {
    const blocks = html().parseBlocks(section.body);
    if (!blocks.length) {
      return '<p class="md-empty">本章还没有内容。切到「Markdown 源码」写，或点卡片上的「AI 生成」。</p>';
    }
    return blocks.map((block, blockIndex) => previewBlock(outputKey, doc, sectionIndex, blockIndex, block, canWrite)).join('\n');
  }

  function materialEditor(outputKey, doc) {
    const mode = modeOf(outputKey);
    const canWrite = U.canOperate();
    const sections = doc.sections.map((section, index) => {
      const heading = `<h4>${escapeHtml(section.heading)}</h4>`;
      if (mode === 'source') {
        return `<section class="material-section">
      ${heading}
      <textarea data-material-body="${outputKey}" data-section="${index}" rows="8">${escapeHtml(section.body)}</textarea>
    </section>`;
      }
      return `<section class="material-section is-preview">
      ${heading}
      <div class="md-body is-live">${previewBody(outputKey, doc, index, section, canWrite)}</div>
    </section>`;
    }).join('');
    const hint = mode === 'source'
      ? '按 Markdown 保存：表格用 | 分隔，导出 Word / Excel 时会自动拆成表格。'
      : (canWrite
        ? '正文和表格都能直接点开改；金额表最右边可以逐行拖入发票。'
        : '只读身份：可以查看与导出，不能改动正文。');
    return `<div class="material-body">
      <div class="material-toolbar">
        <div class="seg-switch material-mode" role="group" aria-label="正文显示模式">
          <button type="button" data-material-mode="${outputKey}" data-mode="preview" class="${mode === 'preview' ? 'is-active' : ''}">在线编辑</button>
          <button type="button" data-material-mode="${outputKey}" data-mode="source" class="${mode === 'source' ? 'is-active' : ''}">Markdown 源码</button>
        </div>
        <span class="material-toolbar-hint">${hint}</span>
      </div>
      ${referenceOf(outputKey) ? referencePanel(outputKey, referenceOf(outputKey)) : ''}
      <label class="material-title"><span>文档标题</span>
        <input data-material-title="${outputKey}" value="${escapeHtml(doc.title || '')}" /></label>
      <div class="material-meta">模板：${escapeHtml(doc.templateName || '默认章节')} · 生成于 ${escapeHtml(U.fmtDateTime(doc.generatedAt))}${doc.source === 'user' ? ' · 已人工编辑' : ''}</div>
      ${sections}
    </div>`;
  }

  /* ── 回写：把界面上的改动落到该块占用的那几行 ── */

  function applyBody(outputKey, doc, sectionIndex, body) {
    const section = doc.sections[sectionIndex];
    if (!section || section.body === body) return false;
    section.body = body;
    doc.source = 'user';
    store().save();
    return true;
  }

  const blockOf = (doc, sectionIndex, blockIndex) => {
    const section = doc.sections[sectionIndex];
    if (!section) return null;
    return html().parseBlocks(section.body)[blockIndex] || null;
  };

  function commitBlock(element) {
    const outputKey = element.dataset.materialBlock;
    const doc = state().materials[outputKey];
    if (!doc) return;
    const sectionIndex = Number(element.dataset.sectionIndex);
    const blockIndex = Number(element.dataset.blockIndex);
    const block = blockOf(doc, sectionIndex, blockIndex);
    if (!block) return;
    const MD = html();
    let next;
    if (block.type === 'list') {
      const container = element.closest('ul, ol') || element;
      const items = Array.from(container.querySelectorAll('[data-material-block]'))
        .map((item) => MD.htmlToInline(item.innerHTML))
        .filter(Boolean);
      next = MD.blockToMarkdown({ type: 'list', ordered: block.ordered, items });
    } else if (block.type === 'heading') {
      next = MD.blockToMarkdown({ type: 'heading', level: block.level, text: MD.htmlToInline(element.innerHTML) });
    } else if (block.type === 'quote') {
      next = MD.blockToMarkdown({ type: 'quote', text: MD.htmlToInline(element.innerHTML) });
    } else {
      const lines = MD.htmlToInline(element.innerHTML).split('\n').map((line) => line.trim()).filter(Boolean);
      next = MD.blockToMarkdown({ lines });
    }
    const section = doc.sections[sectionIndex];
    applyBody(outputKey, doc, sectionIndex, MD.spliceBlock(section.body, block, next));
  }

  /* 从界面上的表格读出表头与各行；合计格是不可编辑格，读到的就是当前显示值 */
  function readTable(table, block) {
    const MD = html();
    const headRow = table.querySelector('thead tr');
    const header = headRow
      ? Array.from(headRow.querySelectorAll('th[data-col]')).map((cell) => MD.htmlToInline(cell.innerHTML))
      : block.header;
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) => header.map((_, colIndex) => {
      const cell = tr.querySelector(`td[data-col="${colIndex}"]`);
      return cell ? MD.htmlToInline(cell.innerHTML) : '';
    }));
    return { header, rows };
  }

  /* 派生格（合计行、占比列）不可编辑：就地刷新它们，不重绘整表——
     重绘会把正要聚焦的那一格换掉，导致「点一格改一格」断掉。 */
  function syncDerivedCells(table, rows) {
    const MD = html();
    Array.from(table.querySelectorAll('tbody tr')).forEach((tr, rowIndex) => {
      const cells = rows[rowIndex];
      if (!cells) return;
      Array.from(tr.querySelectorAll('td[data-col]:not([contenteditable])')).forEach((td) => {
        const next = MD.inline(cells[Number(td.dataset.col)] ?? '');
        if (td.innerHTML !== next) td.innerHTML = next;
      });
    });
  }

  function commitTable(table) {
    const outputKey = table.dataset.materialBlock;
    const doc = state().materials[outputKey];
    if (!doc) return;
    const sectionIndex = Number(table.dataset.sectionIndex);
    const blockIndex = Number(table.dataset.blockIndex);
    const block = blockOf(doc, sectionIndex, blockIndex);
    if (!block || block.type !== 'table') return;
    const MD = html();
    const { header, rows } = readTable(table, block);
    const totals = exporters().applyTotals(header, rows);
    const section = doc.sections[sectionIndex];
    applyBody(outputKey, doc, sectionIndex, MD.spliceBlock(section.body, block, MD.tableToMarkdown(header, totals, block.aligns)));
    syncDerivedCells(table, totals);
  }

  function addRow(outputKey, sectionIndex, blockIndex) {
    const doc = state().materials[outputKey];
    const block = doc ? blockOf(doc, sectionIndex, blockIndex) : null;
    if (!block || block.type !== 'table') return;
    const MD = html();
    const X = exporters();
    const rows = [...block.rows];
    const at = rows.findIndex((cells) => X.isTotalRow(cells));
    const blank = block.header.map(() => '');
    if (at < 0) rows.push(blank); else rows.splice(at, 0, blank);
    applyBody(outputKey, doc, sectionIndex, MD.spliceBlock(doc.sections[sectionIndex].body, block, MD.tableToMarkdown(block.header, X.applyTotals(block.header, rows), block.aligns)));
    render();
    window.WB.toast(at < 0 ? '已添加一行' : '已在合计行上方添加一行');
  }

  function removeRow(outputKey, sectionIndex, blockIndex, rowIndex) {
    const doc = state().materials[outputKey];
    const block = doc ? blockOf(doc, sectionIndex, blockIndex) : null;
    if (!block || block.type !== 'table') return;
    const X = exporters();
    if (X.isTotalRow(block.rows[rowIndex])) { window.WB.toast('「合计」行自动求和，不能删除'); return; }
    if (block.rows.length <= 1) { window.WB.toast('表格至少保留一行，要整表删除请用「Markdown 源码」'); return; }
    const MD = html();
    const rows = block.rows.filter((_, index) => index !== rowIndex);
    const prefix = `${sectionIndex}:${blockIndex}:`;
    const moved = {};
    for (const [key, value] of Object.entries(doc.invoices || {})) {
      if (!key.startsWith(prefix)) { moved[key] = value; continue; }
      const row = Number(key.slice(prefix.length));
      if (!Number.isInteger(row) || row === rowIndex) continue;
      moved[`${prefix}${row > rowIndex ? row - 1 : row}`] = value;
    }
    doc.invoices = moved;
    applyBody(outputKey, doc, sectionIndex, MD.spliceBlock(doc.sections[sectionIndex].body, block, MD.tableToMarkdown(block.header, X.applyTotals(block.header, rows), block.aligns)));
    render();
    window.WB.toast('已删除该行');
  }

  /* ── 发票：拖进来或点选，存元数据 + 小文件内联 ── */

  function attachInvoices(outputKey, key, files) {
    const doc = state().materials[outputKey];
    if (!doc || !files || !files.length) return null;
    doc.invoices ||= {};
    const list = doc.invoices[key] || (doc.invoices[key] = []);
    let added = 0;
    for (const file of files) {
      if (list.length >= MAX_INVOICE_PER_ROW) { window.WB.toast(`一行最多挂 ${MAX_INVOICE_PER_ROW} 张发票，先移除再用`); break; }
      list.push({
        id: U.uid('inv'),
        name: String(file.name || '发票'),
        size: Number(file.size || 0),
        type: String(file.type || ''),
        dataUrl: String(file.dataUrl || ''),
        stored: Boolean(file.dataUrl),
        at: new Date().toISOString()
      });
      added += 1;
    }
    if (!added) return list;
    doc.source = 'user';
    doc.generatedAt ||= new Date().toISOString();
    store().save();
    try { store().log('material', `《${doc.title || outputKey}》挂了 ${added} 张发票`); } catch { /* 记录失败不影响主流程 */ }
    return list;
  }

  function removeInvoice(outputKey, key, index) {
    const doc = state().materials[outputKey];
    const list = doc?.invoices?.[key];
    if (!list || !list[index]) return;
    list.splice(index, 1);
    if (!list.length) delete doc.invoices[key];
    doc.source = 'user';
    store().save();
    render();
    window.WB.toast('已移除发票');
  }

  /* 大文件不入库：与素材库同一条 400 KB 规则，只留文件名提醒单独归档 */
  function readInvoices(fileList) {
    return Promise.all(Array.from(fileList || []).map((file) => new Promise((resolve) => {
      const base = { name: file.name, size: file.size, type: file.type };
      if (!file.size || file.size > MAX_INVOICE_BYTES || typeof FileReader === 'undefined') { resolve(base); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ ...base, dataUrl: String(reader.result || '') });
      reader.onerror = () => resolve(base);
      reader.readAsDataURL(file);
    })));
  }

  async function handleInvoiceFiles(outputKey, key, files) {
    if (!U.canOperate()) { window.WB.toast('只读身份不能上传发票'); return; }
    try {
      const prepared = await readInvoices(files);
      const skipped = prepared.filter((file) => !file.dataUrl).length;
      const list = attachInvoices(outputKey, key, prepared);
      if (!list) return;
      render();
      window.WB.toast(skipped
        ? `已挂 ${prepared.length} 张，其中 ${skipped} 张超过 400 KB，只记了文件名`
        : `已挂上 ${prepared.length} 张发票`);
    } catch (error) {
      window.WB.toast(error?.message || '发票读入失败');
    }
  }

  function pickInvoiceFile(outputKey, key) {
    let input = document.getElementById('invoiceFileInput');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'invoiceFileInput';
      input.multiple = true;
      input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
      input.hidden = true;
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        const [owner, target] = String(input.dataset.target || '').split('|');
        input.value = '';
        if (files.length && owner && target) handleInvoiceFiles(owner, target, files);
      });
      document.body.appendChild(input);
    }
    input.dataset.target = `${outputKey}|${key}`;
    input.value = '';
    input.click();
  }
  /* ── 生图提示词装配：项目信息表 ＋ 海报文案 ＋ 视觉设计说明 ＋ 追加要求 ──
     在线排版器已下线：这张产出只负责把四段来源拼成提示词，成品由图像模型产出。 */

  const POSTER_COPY_HEADING = '一、海报文案';
  const POSTER_VISUAL_HEADING = '二、视觉设计说明';

  /* 按标题前缀取两节正文；标题被改名或材料没生成时退回该材料全文
     （只在两节都没匹配上时退全文，免得同一段正文在提示词里出现两遍） */
  function posterSections() {
    const doc = state().materials?.poster;
    const list = Array.isArray(doc?.sections) ? doc.sections : [];
    const pick = (prefix) => {
      const hit = list.find((section) => U.text(section?.heading).trim().startsWith(prefix));
      return hit ? U.text(hit.body) : '';
    };
    const copy = pick(POSTER_COPY_HEADING);
    const visual = pick(POSTER_VISUAL_HEADING);
    if (!copy && !visual && list.length) {
      return {
        copy: list.map((section) => `${U.text(section.heading)}\n${U.text(section.body)}`).join('\n\n'),
        visual: ''
      };
    }
    return { copy, visual };
  }

  /* 第一段：项目信息表（state.project.basic），只发填过的字段 */
  function posterProjectBrief() {
    const basic = state().project?.basic || {};
    const lines = [];
    if (basic.name) lines.push(`活动名称：${basic.name}`);
    const when = U.scheduleSummary(basic) || [basic.date, basic.start].filter(Boolean).join(' ');
    if (when) lines.push(`时间：${when}`);
    if (basic.venue) lines.push(`地点：${basic.venue}`);
    if (basic.organizer) lines.push(`主办：${basic.organizer}`);
    if (basic.audience) lines.push(`面向对象：${basic.audience}`);
    if (basic.content) lines.push(`活动内容：${basic.content}`);
    return lines.join('\n');
  }

  /* 界面预览与真正发给模型的都是这一份，避免「看到的」和「发出去的」不是一回事 */
  function posterPromptText() {
    const { copy, visual } = posterSections();
    const brief = U.text(state().poster?.brief);
    const hasMaterial = Boolean(copy || visual);
    const empty = hasMaterial ? '（本节为空）' : '（还没生成海报材料）';
    const parts = [
      `【项目信息表】\n${posterProjectBrief() || '（项目信息表还没填）'}`,
      `【一、海报文案】\n${copy || empty}`,
      `【二、视觉设计说明】\n${visual || empty}`
    ];
    if (brief) parts.push(`【追加要求】\n${brief}`);
    const name = state().project?.basic?.name || '校园活动';
    return `为校园活动「${name}」创作宣传视觉。\n\n${parts.join('\n\n')}\n\n不要生成未提供的时间、地点、主办方、品牌、二维码、数字或可读文字。`;
  }

  /* 手改优先：提示词框里的文字才是真正要发出去的那一份（没手改时就是四段装配的结果）。
     手改之后就锁定，不再被四段刷新覆盖——要回到自动装配点「重新装配」。 */
  const posterPromptUsed = () => U.text(state().poster?.prompt) || posterPromptText();
  const posterPromptEdited = () => Boolean(U.text(state().poster?.prompt));

  /* ── AI 生图（YosHub）：服务端落盘到 demo2/generated/，并登记进素材库 ── */

  function imageCard(image, index) {
    const canWrite = U.canOperate();
    return `<figure class="poster-ai-item">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(U.text(image.prompt || 'AI 生成图片').slice(0, 60))}" loading="lazy" />
      <figcaption>
        <small>${escapeHtml(image.model || 'AI')} · ${escapeHtml(U.fmtDateTime(image.createdAt))}</small>
        <span class="poster-ai-actions">
          <a class="button button-ghost" href="${escapeHtml(image.url)}" target="_blank" rel="noreferrer">打开</a>
          <button class="button button-ghost" data-ai-image-remove="${index}" ${canWrite ? '' : 'disabled'}>删除</button>
        </span>
      </figcaption>
    </figure>`;
  }

  /* 海报卡片主体：没有设计器、没有正文编辑面——四段提示词装配好，按一下出图 */
  function posterCardBody() {
    const images = state().poster?.images || [];
    const ready = Boolean(window.WB.ai.imageReady);
    const canWrite = U.canOperate();
    const doc = state().materials?.poster;
    const { copy, visual } = posterSections();
    const edited = posterPromptEdited();
    const hint = !ready
      ? '未配置 YOSHUB_API_KEY，生图不可用；项目信息、海报材料与导出不受影响。'
      : edited
        ? '提示词已手改：生成时发的就是框里那一段。点「重新装配」可以丢掉手改，回到四段自动装配。'
        : !doc
        ? '还没生成《海报 / 宣传图》材料：先点卡片右上角「AI 生成」，拿到「海报文案」与「视觉设计说明」，提示词会更完整。'
        : (copy || visual)
          ? '提示词已按「项目信息表 ＋ 海报文案 ＋ 视觉设计说明 ＋ 追加要求」拼好；改上面的追加要求会即时更新。'
          : '这份材料里没找到「一、海报文案」「二、视觉设计说明」，提示词暂用材料全文。';
    return `<div class="material-body poster-ai">
      <div class="card-title"><h3>AI 生图（装配提示词）</h3><small>由 YosHub 生成并落盘到本地服务，自动登记素材库</small></div>
      <label class="poster-brief"><span>追加要求（只进提示词，不改材料正文）</span>
        <textarea data-ai-image-brief rows="2" placeholder="如「竖版 1080 × 1440，青蓝渐变，中上部留出标题空白」" ${canWrite ? '' : 'disabled'}>${escapeHtml(state().poster?.brief || '')}</textarea>
      </label>
      <div class="poster-prompt">
        <div class="poster-prompt-head">
          <p class="preview-hint">${edited ? '完整提示词（已手改：不再随四段自动更新）' : '完整提示词（四段自动装配，可直接改）'}</p>
          <button class="button button-quiet" data-ai-image-prompt-reset ${edited && canWrite ? '' : 'disabled'} title="${escapeHtml(edited ? '丢掉手改，按项目信息表 ＋ 海报文案 ＋ 视觉设计说明 ＋ 追加要求重新装配' : '当前就是四段装配的结果，不用重装')}">重新装配</button>
        </div>
        <textarea class="poster-prompt-text" data-ai-image-prompt rows="10" spellcheck="false" placeholder="这里是真正发给模型的提示词：可以删掉不想要的约束，也可以补上风格、构图与尺寸" ${canWrite ? '' : 'disabled'}>${escapeHtml(posterPromptUsed())}</textarea>
      </div>
      <div class="poster-ai-input">
        <button class="button button-primary" data-ai-image ${ready && canWrite ? '' : 'disabled'} title="${escapeHtml(ready ? '' : hint)}"><span>✦</span> 生成图片</button>
      </div>
      <p class="help-muted">${escapeHtml(hint)}</p>
      <div class="poster-ai-gallery">
        ${images.length ? images.map(imageCard).join('') : '<p class="help-muted">还没有生成过图片。</p>'}
      </div>
    </div>`;
  }

  async function runImageGen(button) {
    const current = state();
    if (!U.canOperate()) { window.WB.toast('只读访客不能生成图片'); return; }
    if (!window.WB.ai.imageReady) { window.WB.toast('未配置 YOSHUB_API_KEY，生图不可用'); return; }
    /* 提示词默认由四段装配，但允许在框里直接改：框里是什么就发什么 */
    const promptField = button.closest('.poster-ai')?.querySelector('[data-ai-image-prompt]');
    const prompt = U.text(promptField?.value);
    if (!prompt) { window.WB.toast('提示词是空的：写一句，或点「重新装配」'); promptField?.focus(); return; }
    const label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '生成中…';
    try {
      const result = await window.WB.ai.generateImage(prompt);
      current.poster ||= {};
      current.poster.images ||= [];
      current.poster.images.unshift({
        url: result.url,
        model: result.model || '',
        prompt,
        width: result.width || null,
        height: result.height || null,
        createdAt: new Date().toISOString()
      });
      store().log('image', `生成宣传图：${prompt.slice(0, 30)}`);
      window.WB.views.assets.addAsset({
        name: `AI 宣传图 ${current.poster.images.length}`,
        kind: 'image',
        url: result.url,
        mime: 'image/png',
        phase: 'prepare',
        note: prompt.slice(0, 40)
      });
      store().save();
      render();
      window.WB.toast('图片已生成并登记到素材库');
    } catch (error) {
      window.WB.toast(error.message);
      if (button.isConnected) { button.disabled = false; button.innerHTML = label; }
    }
  }


  /* ── 批量渲染 ─────────────────────────── */

  function renderPhaseSeg() {
    const current = state().ui.materialPhase || 'all';
    const counts = (phase) => OUTPUT_ITEMS.filter((item) => currentProjectSelected(item, phase)).length;
    const seg = $('#materialPhaseSeg');
    seg.innerHTML = [{ value: 'all', label: '全部' }, ...PHASES.map((p) => ({ value: p.value, label: p.label }))]
      .map((entry) => `<button data-material-phase="${entry.value}" class="${current === entry.value ? 'is-active' : ''}">${escapeHtml(entry.label)}${entry.value === 'all' ? '' : ` ${counts(entry.value)}`}</button>`)
      .join('');
  }

  const currentProjectSelected = (item, phase) => Boolean(state().project?.outputs?.[item.key]) && (!phase || item.phase === phase);

  function render() {
    const current = state();
    window.WB.inventory?.sync(current);
    renderTemplateBar();
    renderPhaseSeg();
    const selected = OUTPUT_ITEMS.filter((item) => current.project?.outputs?.[item.key]);
    const generated = selected.filter((item) => current.materials[item.key]).length;
    $('#materialSummary').textContent = current.project
      ? `已勾选 ${selected.length} 项产出，已生成 ${generated} 份；离线状态下所有编辑与导出功能可用`
      : '';
    U.gateAi($('#generateAllMaterials'), Boolean(current.project));
    const phase = current.ui.materialPhase || 'all';
    const visible = selected.filter((item) => phase === 'all' || item.phase === phase);
    if (!visible.length) {
      $('#materialList').innerHTML = selected.length
        ? '<div class="card"><div class="empty"><strong>该阶段没有已勾选的产出</strong>可切换上方阶段，或回到项目信息表勾选更多产出。</div></div>'
        : '<div class="card"><div class="empty"><strong>还没有勾选产出</strong>回到「项目信息表」，在产出配置里勾选需要的材料。</div></div>';
      return;
    }
    $('#materialList').innerHTML = PHASES
      .map((p) => {
        const items = visible.filter((item) => item.phase === p.value);
        if (!items.length) return '';
        return `<div class="material-group">
          <div class="material-group-head"><span class="phase-pill phase-${p.value}">${escapeHtml(p.label)}</span>
            <small>${escapeHtml(p.window)}</small></div>
          ${items.map((item) => materialCard(item)).join('')}
        </div>`;
      }).join('');
  }

  /* ── 参考件：解析后挂到某份材料上 ───────── */

  function removeReference(outputKey) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改动参考件'); return; }
    const reference = referenceOf(outputKey);
    if (!reference) return;
    delete state().references[outputKey];
    store().log('reference', `移除参考《${reference.name}》`);
    store().save();
    render();
    window.WB.toast(`已移除参考《${reference.name}》，后续生成回到默认章节`);
  }

  async function uploadReference(outputKey, file) {
    if (!outputKey || !file) return;
    if (!U.canOperate()) { window.WB.toast('只读访客不能上传参考件'); return; }
    window.WB.toast(`正在解析《${file.name}》…`);
    try {
      const parsed = await docxLib().readFile(file);
      const reference = { id: U.uid('ref'), createdAt: new Date().toISOString(), ...parsed };
      state().references ||= {};
      state().references[outputKey] = reference;
      store().log('reference', `上传参考《${file.name}》：${reference.sections.length} 栏目 / ${reference.fields.length} 字段`);
      store().save();
      render();
      const styleNote = reference.kit ? '，Word 导出也会照它的版式' : '';
      const fillNote = reference.package ? `，识别出 ${reference.package.entries.length} 个部件可原样套用` : '';
      if (reference.sections.length || reference.fields.length) {
        window.WB.toast(`已读取《${file.name}》：${reference.sections.length} 栏目、${reference.fields.length} 字段${styleNote}${fillNote}`);
      } else {
        window.WB.toast(`已读取《${file.name}》，但没识别出栏目或字段，生成时只当原文参考`);
      }
    } catch (error) {
      window.WB.toast(error.message || '参考件解析失败');
    }
  }

  const kindLabel = (kind) => {
    const found = (window.WB.util.RESOURCE_KINDS || []).find((item) => item.value === kind);
    return found ? found.label : kind;
  };

  /* ── 生成 ─────────────────────────────── */

  function materialInput(item, template) {
    const current = state();
    const reference = referenceOf(item.key);
    return {
      产出: item.label,
      参考样例: reference
        ? {
            名称: reference.name,
            要求: '这是用户上传的参考件。栏目、字段与填写口径必须与它一致；其中属于别的事实的值（时间、地点、人名、金额、单位）不要照抄。',
            栏目: reference.sections.map((section) => section.heading),
            字段清单: reference.fields,
            表格表头: reference.tables.map((table) => table.headers),
            原文: reference.text
          }
        : '未提供',
      模板: template
        ? { 来源: `学校模板《${template.name}》`, 章节: template.sections.map((s) => `${'　'.repeat(Math.max(0, s.level - 1))}${s.heading}`), 表格: template.tables?.map((t) => t.headers) || [] }
        : '未提供，使用内置默认章节',
      项目信息表: current.project?.basic || {},
      方案比选结论: current.options.decision || '未进行比选',
      任务分解: current.wbs.map((row) => ({ 阶段: PHASE_LABEL[row.phase] || row.phase, 任务: row.task, 负责角色: row.owner, 时间: row.due, 产出物: row.output, 状态: U.STATUS_LABEL[row.status] })),
      风险台账: current.risks.map((risk) => ({
        风险: risk.name, 等级: U.LEVEL_LABEL[window.WB.risk.levelOfRisk(risk)], 分值: window.WB.risk.scoreOf(risk),
        挂靠任务: risk.task, 触发信号: risk.trigger, 预防措施: risk.prevention, 现场响应: risk.response, 升级路径: risk.escalation, 责任人: risk.owner
      })),
      资源台账: (current.resources || []).map((item) => ({
        资源: item.name, 类型: kindLabel(item.kind), 单位: item.unit, 库存可用: item.available, 计划需求: item.assigned, 已借出: item.loaned || 0, 单价: item.unitCost || 0, 存放地点: item.location, 采购来源: item.supplier, 状态: item.condition, 责任人: item.owner, 说明: item.note
      })),
      素材库: window.WB.library.context(current.assets, 'assets'),
      知识库: window.WB.library.context(current.assets, 'knowledge'),
      资料引用规则: window.WB.library.rule,
      /* 已收到的参与者信息：写《报名表 / 签到表 / 现场记录表》时直接引用真实数字 */
      参与者信息收集: window.WB.signup ? window.WB.signup.contextFor(current.signup) : '未启用'
    };
  }

  async function generateOne(outputKey, { silent = false } = {}) {
    if (outputKey === 'materialList') { window.WB.inventory.sync(state()); store().save(); return true; }
    const current = state();
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    if (!item || !current.project) return false;
    const templateId = current.materialTemplates[outputKey];
    const template = current.templates.find((entry) => entry.id === templateId);
    const headings = chosenSections(outputKey);
    if (!headings.length) { window.WB.toast('该产出还没有可用的章节模板'); return false; }
    const data = await window.WB.ai.run(item.skill, materialInput(item, template), window.WB.ai.documentContract(headings, chosenForms(outputKey)), '/api/material');
    if (!data || !Array.isArray(data.sections)) return false;
    const sections = headings.map((heading, index) => {
      const matched = data.sections.find((section) => U.text(section.heading) === heading) || data.sections[index];
      return { heading, body: U.text(matched?.body) || '待补充' };
    });
    const previous = current.materials[outputKey];
    current.materials[outputKey] = {
      materialId: previous?.materialId || `MAT-${outputKey}`, deliveries: previous?.deliveries || [], aiDraft: true,
      title: U.text(data.title) || `${current.project.basic.name || '未命名活动'}｜${item.label}`,
      sections,
      templateId: template?.id || '',
      templateName: sectionSource(outputKey),
      source: 'ai',
      generatedAt: new Date().toISOString()
    };
    current.ui.openMaterial = outputKey;
    store().log('material', `生成《${item.label}》`);
    store().save();
    if (!silent) {
      render();
      /* 重新生成会重排行序，旧发票的挂靠位置就失效了，直接说明比留着错位更好 */
      const dropped = Object.values(previous?.invoices || {}).reduce((sum, list) => sum + list.length, 0);
      if (dropped) window.WB.toast(`已重新生成《${item.label}》${sections.length} 章；原有 ${dropped} 张发票未保留，请重新挂`);
      else window.WB.toast(`已生成《${item.label}》${sections.length} 章`);
    }
    return true;
  }

  /* ── 按参考重排（AI）：这一轮不做重新创作，只让 AI 把现有正文改写成与参考形式一致的成稿 ──
     栏目、字段、表格列照抄参考；值只能取自现有正文与项目数据，取不到写「待确认」。
     正文会被替换，所以留一份 previous 供「撤回重排」。 */
  async function reframeMaterial(outputKey) {
    const current = state();
    const item = OUTPUT_ITEMS.find((entry) => entry.key === outputKey);
    const doc = current.materials[outputKey];
    const reference = referenceOf(outputKey);
    if (!U.canOperate()) { window.WB.toast('只读访客不能重排正文'); return false; }
    if (!item || !doc) { window.WB.toast('先生成这份材料，再按参考重排'); return false; }
    if (!reference) { window.WB.toast('这份材料还没挂参考件：先上传往届样表或学校样表'); return false; }
    const headings = referenceSections(outputKey).length
      ? referenceSections(outputKey)
      : doc.sections.map((section) => section.heading);
    if (!headings.length) { window.WB.toast('参考与正文都没有可用栏目'); return false; }
    const template = current.templates.find((entry) => entry.id === current.materialTemplates[outputKey]);
    const input = {
      ...materialInput(item, template),
      任务: `按参考《${reference.name}》重排下面这份《${item.label}》`,
      现有正文: doc.sections.map((section) => ({ 栏目: section.heading, 正文: section.body })),
      输出栏目: headings
    };
    const data = await window.WB.ai.run(item.skill, input, window.WB.ai.reframeContract(headings, reference), '/api/material');
    if (!data || !Array.isArray(data.sections)) return false;
    const sections = headings.map((heading, index) => {
      const matched = data.sections.find((section) => U.text(section.heading) === heading) || data.sections[index];
      return { heading, body: U.text(matched?.body) || '待补充' };
    });
    current.materials[outputKey] = {
      ...doc,
      title: U.text(data.title) || doc.title,
      sections,
      /* 撤回用：正文被换掉前先留一份 */
      previous: { title: doc.title, sections: doc.sections, templateName: doc.templateName, source: doc.source, generatedAt: doc.generatedAt },
      reframedFrom: reference.name,
      reframedAt: new Date().toISOString(),
      source: 'ai-reframe', aiDraft: true
    };
    store().log('material', `按参考《${reference.name}》重排《${item.label}》`);
    store().save();
    render();
    window.WB.toast(`已按《${reference.name}》重排《${item.label}》：${sections.length} 栏目；不满意可「撤回重排」`);
    return true;
  }

  function undoReframe(outputKey) {
    if (!U.canOperate()) { window.WB.toast('只读访客不能改动正文'); return false; }
    const doc = state().materials[outputKey];
    if (!doc?.previous) { window.WB.toast('没有可撤回的重排稿'); return false; }
    const { previous } = doc;
    state().materials[outputKey] = {
      ...doc,
      title: previous.title,
      sections: previous.sections,
      templateName: previous.templateName,
      source: previous.source,
      generatedAt: previous.generatedAt,
      previous: null,
      reframedFrom: null
    };
    store().save();
    render();
    window.WB.toast('已回到重排前的正文');
    return true;
  }
  async function generateAll() {
    const current = state();
    if (!current.project) return;
    if (!window.WB.ai.ready) { window.WB.toast('未连接 AI，离线模式只能手动编辑已有材料'); return; }
    const targets = OUTPUT_ITEMS.filter((item) => current.project.outputs[item.key] && !current.materials[item.key] && materialDef(item.skill));
    if (!targets.length) { window.WB.toast('没有待生成的产出'); return; }
    let done = 0;
    for (const item of targets) {
      window.WB.toast(`正在生成《${item.label}》（${done + 1}/${targets.length}）…`);
      const ok = await generateOne(item.key, { silent: true });
      if (ok) done += 1;
    }
    /* 新生成的产出可能不在当前阶段筛选里，先切到「全部」，跳过去才看得见 */
    current.ui.materialPhase = 'all';
    render();
    const lastKey = [...targets].reverse().find((item) => current.materials[item.key])?.key || '';
    const message = `批量生成完成：成功 ${done}/${targets.length} 份`;
    if (done && lastKey && window.WB.toastAction) {
      window.WB.toastAction(message, '查看材料', () => {
        window.WB.gotoTarget?.({ view: 'material', openMaterial: lastKey });
      });
    } else {
      window.WB.toast(message);
    }
  }

  async function uploadTemplate(file) {
    if (!file) return;
    window.WB.toast(`正在解析《${file.name}》…`);
    try {
      const res = await fetch(`/api/template?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { window.WB.toast(data.error || `模板解析失败（HTTP ${res.status}）`); return; }
      if (!data.sections?.length) { window.WB.toast('没有识别到章节标题，请确认模板用了标题样式或「一、」这类编号'); return; }
      state().templates.push({
        id: U.uid('tpl'),
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: data.kind,
        sections: data.sections,
        tables: data.tables || [],
        createdAt: new Date().toISOString()
      });
      store().log('template', `上传模板《${file.name}》，识别 ${data.sections.length} 个章节`);
      store().save();
      render();
      window.WB.toast(`已解析《${file.name}》，识别 ${data.sections.length} 个章节`);
    } catch (error) {
      window.WB.toast(error.message || '模板上传失败');
    }
  }

  /* 按格式导出单份材料：docx / xlsx 走二进制下载，其余按 Markdown 文本下载 */
  function downloadMaterial(key, format) {
    const doc = key === 'materialList' ? window.WB.inventory.documentOf(state()) : state().materials[key];
    if (!doc) return;
    const item = OUTPUT_ITEMS.find((entry) => entry.key === key);
    const name = `${U.safeFileName(store().projectName())}-${U.safeFileName(item?.label || key)}`;
    if (format === 'docx') {
      const style = exporters().styleFor(key);
      U.downloadBytes(`${name}.docx`, window.WB.exporters.materialToDocx(doc, { style }),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (style) window.WB.toast('已导出正文：版式沿用参考件；要跟参考长得一样请点「Word（参考原表）」');
      return;
    }
    if (format === 'xlsx') {
      U.downloadBytes(`${name}.xlsx`, window.WB.exporters.materialToXlsx(doc),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return;
    }
    U.downloadText(`${name}.md`, window.WB.exporters.materialToMarkdown(doc));
  }

  function mount() {
    const panel = $('#materialPanel');
    /* 幂等：重复 mount（重进视图 / 再次 init）不重复挂监听器，否则一次拖拽或点击会触发多次 */
    if (panel.dataset.materialMounted) return;
    panel.dataset.materialMounted = '1';

    panel.addEventListener('click', async (event) => {
      const current = state();
      const publish = event.target.closest('[data-material-publish]'), version = event.target.closest('[data-delivery-download]');
      if (publish) {
        const note = window.prompt('请核对正文、参考填值及附件。保存本次实际交付快照（可填写版本说明）', '');
        if (note === null) return;
        publish.disabled = true;
        try { await publishDelivery(publish.dataset.materialPublish, note); } catch (error) { window.WB.toast(error.message); } finally { publish.disabled = !U.canOperate(); }
        return;
      }
      if (version) { try { downloadDelivery(version.dataset.deliveryDownload, version.dataset.versionId); } catch (error) { window.WB.toast(error.message); } return; }
      const generate = event.target.closest('[data-material-generate]');
      if (generate) { generateOne(generate.dataset.materialGenerate); return; }
      const goto = event.target.closest('[data-material-goto]');
      if (goto) { window.WB.switchView(goto.dataset.materialGoto); return; }
      if (event.target.closest('[data-material-struct-export]')) {
        U.downloadText(`${U.safeFileName(store().projectName())}-方案比选决策矩阵.md`, window.WB.exporters.decisionToMarkdown());
        return;
      }
      const toggle = event.target.closest('[data-material-toggle]');
      if (toggle) {
        const key = toggle.dataset.materialToggle;
        current.ui.openMaterial = current.ui.openMaterial === key ? null : key;
        store().save();
        render();
        return;
      }
      const sectionsToggle = event.target.closest('[data-material-sections-toggle]');
      if (sectionsToggle) {
        const key = sectionsToggle.dataset.materialSectionsToggle;
        if (sectionsOpen.has(key)) sectionsOpen.delete(key); else sectionsOpen.add(key);
        render();
        return;
      }
      const sectionClose = event.target.closest('[data-section-close]');
      if (sectionClose) { sectionsOpen.delete(sectionClose.dataset.sectionClose); render(); return; }
      const sectionDel = event.target.closest('[data-section-del]');
      if (sectionDel) {
        if (!U.canOperate()) { window.WB.toast('只读访客不能改章节'); return; }
        const key = sectionDel.dataset.sectionDel;
        setSections(key, sectionListOf(key).filter((_, index) => index !== Number(sectionDel.dataset.sectionIndex)));
        return;
      }
      const sectionAdd = event.target.closest('[data-section-add]');
      if (sectionAdd) {
        if (!U.canOperate()) { window.WB.toast('只读访客不能改章节'); return; }
        const key = sectionAdd.dataset.sectionAdd;
        setSections(key, [...sectionListOf(key), '']);
        const inputs = panel.querySelectorAll('[data-section-name="' + key + '"]');
        inputs[inputs.length - 1]?.focus();
        return;
      }
      const sectionReset = event.target.closest('[data-section-reset]');
      if (sectionReset) {
        if (!U.canOperate()) { window.WB.toast('只读访客不能改章节'); return; }
        const key = sectionReset.dataset.sectionReset;
        delete (state().materialSections || {})[key];
        syncSectionsToDoc(key);
        store().save();
        render();
        return;
      }
      const fillExport = event.target.closest('[data-material-fill-export]');
      if (fillExport) { fillFromReference(fillExport.dataset.materialFillExport); return; }
      const exportOne = event.target.closest('[data-material-export]');
      if (exportOne) {
        downloadMaterial(exportOne.dataset.materialExport, exportOne.dataset.format || 'md');
        return;
      }
      const modeButton = event.target.closest('[data-material-mode]');
      if (modeButton) {
        viewMode.set(modeButton.dataset.materialMode, modeButton.dataset.mode);
        render();
        return;
      }
      const invoiceAdd = event.target.closest('[data-material-invoice-add]');
      if (invoiceAdd) {
        pickInvoiceFile(invoiceAdd.dataset.invoiceOwner, invoiceAdd.dataset.materialInvoiceAdd);
        return;
      }
      const invoiceRemove = event.target.closest('[data-material-invoice-remove]');
      if (invoiceRemove) {
        removeInvoice(invoiceRemove.dataset.invoiceOwner, invoiceRemove.dataset.materialInvoiceRemove, Number(invoiceRemove.dataset.invoiceIndex));
        return;
      }
      const rowAdd = event.target.closest('[data-material-row-add]');
      if (rowAdd) {
        addRow(rowAdd.dataset.materialRowAdd, Number(rowAdd.dataset.sectionIndex), Number(rowAdd.dataset.blockIndex));
        return;
      }
      const rowRemove = event.target.closest('[data-material-row-remove]');
      if (rowRemove) {
        removeRow(rowRemove.dataset.materialRowRemove, Number(rowRemove.dataset.sectionIndex), Number(rowRemove.dataset.blockIndex), Number(rowRemove.dataset.rowIndex));
        return;
      }
      const fillButton = event.target.closest('[data-material-fill]');
      if (fillButton) { openFill(fillButton.dataset.materialFill); return; }
      const fillClose = event.target.closest('[data-fill-close]');
      if (fillClose) { closeFill(fillClose.dataset.fillClose); return; }
      const fillDownload = event.target.closest('[data-fill-download]');
      if (fillDownload) { fillFromReference(fillDownload.dataset.fillDownload); return; }
      const fillAi = event.target.closest('[data-fill-ai]');
      if (fillAi) { aiFillSlots(fillAi.dataset.fillAi); return; }
      const fillStepToggle = event.target.closest('[data-fill-step-toggle]');
      if (fillStepToggle) { toggleFillStep(fillStepToggle.dataset.fillStepToggle); return; }
      const fillStepPrev = event.target.closest('[data-fill-step-prev]');
      if (fillStepPrev) { fillStepMove(fillStepPrev.dataset.fillStepPrev, -1); render(); return; }
      const fillStepNext = event.target.closest('[data-fill-step-next]');
      if (fillStepNext) { fillStepMove(fillStepNext.dataset.fillStepNext, 1); render(); return; }
      const fillStepSkip = event.target.closest('[data-fill-step-skip]');
      if (fillStepSkip) {
        if (fillStepSeek(fillStepSkip.dataset.fillStepSkip, 1)) render();
        else window.WB.toast('这个范围里后面没有空格了');
        return;
      }
      const fillStepBlank = event.target.closest('[data-fill-step-blank]');
      if (fillStepBlank) {
        const blankKey = fillStepBlank.dataset.fillStepBlank;
        const blankCache = fillModels.get(blankKey);
        const blankList = blankCache ? fillStepSlots(blankKey, blankCache) : [];
        const blankSlot = blankList[fillStepIndex(blankKey, blankList)];
        if (!blankCache || !blankSlot) return;
        const own = fillOwnOf(blankKey);
        if (own[blankSlot.id] === '') { delete own[blankSlot.id]; window.WB.toast('已取消置空，回到原来的值'); }
        else { own[blankSlot.id] = ''; window.WB.toast('这一格会输出为空'); }
        store().save();
        render();
        return;
      }
      const fillStepAi = event.target.closest('[data-fill-step-ai]');
      if (fillStepAi) {
        const aiKey = fillStepAi.dataset.fillStepAi;
        const aiCache = fillModels.get(aiKey);
        const aiList = aiCache ? fillStepSlots(aiKey, aiCache) : [];
        const aiSlot = aiList[fillStepIndex(aiKey, aiList)];
        if (!aiSlot) return;
        aiFillOne(aiKey, aiSlot.id).then((ok) => { if (ok) fillStepMove(aiKey, 1); render(); });
        return;
      }
      const fillReset = event.target.closest('[data-fill-reset]');
      if (fillReset) { resetFill(fillReset.dataset.fillReset); return; }
      const fillScopeButton = event.target.closest('[data-fill-scope]');
      if (fillScopeButton) {
        fillScope.set(fillScopeButton.dataset.fillOwner, fillScopeButton.dataset.fillScope);
        fillStepReset(fillScopeButton.dataset.fillOwner);
        render();
        return;
      }
      const referenceAdd = event.target.closest('[data-material-reference-add]');
      if (referenceAdd) {
        if (!U.canOperate()) { window.WB.toast('只读访客不能上传参考件'); return; }
        pendingReference = referenceAdd.dataset.materialReferenceAdd;
        $('#referenceFile').click();
        return;
      }
      const referenceRemove = event.target.closest('[data-material-reference-remove]');
      if (referenceRemove) { removeReference(referenceRemove.dataset.materialReferenceRemove); return; }
      const reframe = event.target.closest('[data-material-reframe]');
      if (reframe) { reframeMaterial(reframe.dataset.materialReframe); return; }
      const reframeUndo = event.target.closest('[data-material-reframe-undo]');
      if (reframeUndo) { undoReframe(reframeUndo.dataset.materialReframeUndo); return; }
      const aiImage = event.target.closest('[data-ai-image]');
      if (aiImage) { runImageGen(aiImage); return; }
      const removeImage = event.target.closest('[data-ai-image-remove]');
      if (removeImage) {
        if (!U.canOperate()) { window.WB.toast('只读访客不能删除图片'); return; }
        const images = current.poster?.images || [];
        images.splice(Number(removeImage.dataset.aiImageRemove), 1);
        store().save();
        render();
        return;
      }
      const promptReset = event.target.closest('[data-ai-image-prompt-reset]');
      if (promptReset) {
        if (!U.canOperate()) { window.WB.toast('只读访客不能改动提示词'); return; }
        state().poster ||= {};
        delete state().poster.prompt;
        store().save();
        render();
        window.WB.toast('已按四段重新装配提示词');
        return;
      }
      const phaseButton = event.target.closest('[data-material-phase]');
      if (phaseButton) {
        current.ui.materialPhase = phaseButton.dataset.materialPhase;
        store().save();
        render();
      }
    });

    /* 改完一块就写回：不动其余正文，也不重绘，避免打断输入焦点 */
    panel.addEventListener('focusout', (event) => {
      if (!U.canOperate()) return;
      /* 提示词框：手改的内容落盘（全删掉＝没手改，下次按四段装配） */
      const promptField = event.target.closest('[data-ai-image-prompt]');
      if (promptField) {
        state().poster ||= {};
        state().poster.prompt = U.text(promptField.value) ? promptField.value : '';
        store().save();
        return;
      }
      /* 追加要求只进提示词，不写回材料正文；打字时先改内存，失焦才落盘 */
      const briefField = event.target.closest('[data-ai-image-brief]');
      if (briefField) {
        state().poster ||= {};
        state().poster.brief = briefField.value;
        store().save();
        return;
      }
      const cell = event.target.closest('td[data-col], th[data-col]');
      if (cell) { commitTable(cell.closest('table')); return; }
      const block = event.target.closest('[data-material-block]');
      if (block && block.tagName !== 'TABLE') commitBlock(block);
    });

    /* 表格里回车＝确认；换行会让一行在导出时被压成一格，所以直接拦掉 */
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const cell = event.target.closest('td[data-col], th[data-col]');
      if (!cell) return;
      event.preventDefault();
      cell.blur();
    });

    /* 拖拽上传：发票格收发票文件，材料卡片收参考件（.docx / .md / .txt）。
       「是否带文件」优先看 types，拿不到 types 的老浏览器就按 dataTransfer 是否存在来判断，
       免得拖文本进 contenteditable 被误拦。 */
    const carriesFiles = (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      return types.length ? types.includes('Files') : Boolean(event.dataTransfer);
    };
    const isReferenceFile = (file) => /\.(docx|md|markdown|txt)$/i.test(String(file?.name || ''));
    /* 拖拽是外部动作，不会像点按钮那样让正在编辑的格子失焦；先手动收一下，
       否则紧接着的重绘会把还没提交的改动冲掉 */
    const flushEdits = () => {
      const active = document.activeElement;
      const block = active && active.closest && active.closest('[data-material-block]');
      if (block) active.blur();
    };

    panel.addEventListener('dragover', (event) => {
      /* 填值面板不是拖放区：别把卡片当成收参考件的框 */
      if (event.target.closest('[data-fill-panel]')) return;
      const cell = event.target.closest('[data-material-invoice]');
      if (cell && U.canOperate()) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        cell.classList.add('is-drop');
        return;
      }
      const zone = event.target.closest('[data-material-dropzone]');
      if (!zone || !U.canOperate() || !carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      zone.classList.add('is-drop');
    });
    panel.addEventListener('dragleave', (event) => {
      const target = event.target.closest('[data-material-invoice], [data-material-dropzone]');
      if (!target) return;
      if (!event.relatedTarget || !target.contains(event.relatedTarget)) target.classList.remove('is-drop');
    });
    panel.addEventListener('drop', (event) => {
      if (event.target.closest('[data-fill-panel]')) { event.preventDefault(); return; }
      const files = Array.from(event.dataTransfer?.files || []);
      /* 非文件拖拽（选中的文字等）交回浏览器默认行为 */
      if (!files.length) return;
      const cell = event.target.closest('[data-material-invoice]');
      if (cell && U.canOperate()) {
        event.preventDefault();
        cell.classList.remove('is-drop');
        flushEdits();
        handleInvoiceFiles(cell.dataset.invoiceOwner, cell.dataset.materialInvoice, files);
        return;
      }
      const zone = event.target.closest('[data-material-dropzone]');
      /* 有文件就一定拦掉默认行为，否则拖错格式会把整个工作台顶掉 */
      event.preventDefault();
      if (!zone) return;
      zone.classList.remove('is-drop');
      if (!U.canOperate()) { window.WB.toast('只读访客不能上传参考件'); return; }
      const reference = files.find((file) => isReferenceFile(file)) || files[0];
      if (!isReferenceFile(reference)) {
        window.WB.toast('参考件支持 .docx / .md / .txt；图片请放到「素材库」');
        return;
      }
      if (files.length > 1) window.WB.toast(`一次挂一份参考，已取《${reference.name}》`);
      flushEdits();
      return uploadReference(zone.dataset.materialDropzone, reference);
    });

    panel.addEventListener('input', (event) => {
      const current = state();
      /* 提示词框：手改即锁定（只改内存不落盘，落盘走 focusout）；
         顺手把标题与「重新装配」的可用状态改掉，免得界面还写着「自动装配」 */
      const promptField = event.target.closest('[data-ai-image-prompt]');
      if (promptField) {
        current.poster ||= {};
        current.poster.prompt = promptField.value;
        const on = Boolean(U.text(promptField.value));
        const head = panel.querySelector('.poster-prompt-head .preview-hint');
        if (head) head.textContent = on ? '完整提示词（已手改：不再随四段自动更新）' : '完整提示词（四段自动装配，可直接改）';
        const reset = panel.querySelector('[data-ai-image-prompt-reset]');
        if (reset) reset.disabled = !on;
        return;
      }
      /* 追加要求：边打字边刷新提示词框，只改内存不落盘（落盘走 focusout）；
         已经手改过提示词就不动它——手改优先 */
      const briefField = event.target.closest('[data-ai-image-brief]');
      if (briefField) {
        current.poster ||= {};
        current.poster.brief = briefField.value;
        if (!U.text(current.poster.prompt)) {
          const box = panel.querySelector('[data-ai-image-prompt]');
          if (box) box.value = posterPromptText();
        }
        return;
      }
      /* 填值表：打字只改内存，不落盘不重绘，免得每敲一个字都重排整页 */
      const fillInput = event.target.closest('[data-fill-input]');
      if (fillInput) {
        setFillValue(fillInput.closest('[data-fill-panel]').dataset.fillPanel, fillInput.dataset.fillInput, fillInput.value);
        return;
      }
      /* 边改边算：在单元格里打字时就地刷新合计行；落盘仍走 focusout */
      const liveCell = event.target.closest('td[data-col]');
      if (liveCell && U.canOperate()) {
        const table = liveCell.closest('table');
        const doc = table && current.materials[table.dataset.materialBlock];
        const block = doc ? blockOf(doc, Number(table.dataset.sectionIndex), Number(table.dataset.blockIndex)) : null;
        if (block && block.type === 'table') {
          const seen = readTable(table, block);
          syncDerivedCells(table, exporters().applyTotals(seen.header, seen.rows));
        }
      }
      /* 改章节名：打字只改内存不重排，免得标题改到一半、正文因为「对不上号」被清成待补充 */
      const sectionName = event.target.closest('[data-section-name]');
      if (sectionName) {
        if (!U.canOperate()) return;
        const key = sectionName.dataset.sectionName;
        const list = sectionListOf(key);
        list[Number(sectionName.dataset.sectionIndex)] = sectionName.value;
        (state().materialSections ||= {})[key] = list;
        return;
      }
      const title = event.target.closest('[data-material-title]');
      if (title) {
        const doc = current.materials[title.dataset.materialTitle];
        if (!doc) return;
        doc.title = title.value;
        doc.source = 'user';
        store().save();
        return;
      }
      const body = event.target.closest('[data-material-body]');
      if (body) {
        const doc = current.materials[body.dataset.materialBody];
        const section = doc?.sections[Number(body.dataset.section)];
        if (!section) return;
        section.body = body.value;
        doc.source = 'user';
        store().save();
      }
    });

    panel.addEventListener('change', (event) => {
      const fillBlank = event.target.closest('[data-fill-blank]');
      if (fillBlank) {
        setFillBlank(fillBlank.closest('[data-fill-panel]').dataset.fillPanel, fillBlank.dataset.fillBlank, fillBlank.checked);
        return;
      }
      const fillChanged = event.target.closest('[data-fill-input]');
      if (fillChanged) { store().save(); return; }
      /* 失焦 / 回车才算改名落定：这时才按新标题重排正文并落盘 */
      const sectionName = event.target.closest('[data-section-name]');
      if (sectionName) {
        if (!U.canOperate()) return;
        const key = sectionName.dataset.sectionName;
        const list = sectionListOf(key);
        list[Number(sectionName.dataset.sectionIndex)] = sectionName.value;
        (state().materialSections ||= {})[key] = list;
        syncSectionsToDoc(key);
        store().save();
        render();
        return;
      }
      const select = event.target.closest('[data-material-template]');
      if (!select) return;
      const key = select.dataset.materialTemplate;
      if (select.value) state().materialTemplates[key] = select.value;
      else delete state().materialTemplates[key];
      store().save();
      render();
    });

    $('#uploadTemplate').addEventListener('click', () => $('#templateFile').click());
    $('#templateFile').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      await uploadTemplate(file);
    });
    $('#referenceFile').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      const key = pendingReference;
      pendingReference = null;
      event.target.value = '';
      await uploadReference(key, file);
    });
    $('#generateAllMaterials').addEventListener('click', generateAll);
    const packDocs = () => Object.keys(state().materials);
    $('#exportMaterials').addEventListener('click', () => {
      if (!packDocs().length) { window.WB.toast('还没有已生成的材料'); return; }
      U.downloadText(`${U.safeFileName(store().projectName())}-过程材料包.md`, window.WB.exporters.materialsPack());
    });
    $('#exportMaterialsDocx').addEventListener('click', () => {
      if (!packDocs().length) { window.WB.toast('还没有已生成的材料'); return; }
      U.downloadBytes(`${U.safeFileName(store().projectName())}-过程材料包.docx`, window.WB.exporters.materialsPackDocx(),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (Object.keys(state().references || {}).some((key) => state().references[key]?.package)) {
        window.WB.toast('材料包里是 AI 正文；要「肉眼跟参考一模一样」请逐份点「Word（参考原表）」');
      }
    });
    $('#templateBar').addEventListener('click', (event) => {
      const button = event.target.closest('[data-template-remove]');
      if (!button) return;
      const id = button.dataset.templateRemove;
      const current = state();
      current.templates = current.templates.filter((template) => template.id !== id);
      for (const key of Object.keys(current.materialTemplates)) {
        if (current.materialTemplates[key] === id) delete current.materialTemplates[key];
      }
      store().save();
      render();
    });
  }

  window.WB.views.material = { id: 'material', label: '过程材料', render, mount, publishDelivery, downloadDelivery, chosenForms, sectionListOf, setSections, syncSectionsToDoc, generateOne, generateAll, reframeMaterial, undoReframe, uploadTemplate, uploadReference, removeReference, attachInvoices, readInvoices, commitTable, commitBlock, addRow, removeRow, previewBlock, openFill, closeFill, fillPanel, fillModel, fillFromReference, aiFillSlots, aiFillOne, fillContext, normaliseFillRows, toggleFillStep, fillBasisOf, fillStepBody, fillStepMove, fillStepSeek, fillStepReset, fillStepSlots, fillStepIndex, fillStepOn, resetFill, setFillValue, setFillBlank, fillValues, posterPrompt: () => posterPromptText(), posterPromptUsed: () => posterPromptUsed(), posterPromptEdited: () => posterPromptEdited() };
}());
