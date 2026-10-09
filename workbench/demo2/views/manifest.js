/* 项目信息表：事实区（可编辑）+ 产出配置（按阶段分组勾选）。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, BASIC_FIELDS, PHASES, PHASE_LABEL, OUTPUT_ITEMS, sourceBadge, paintBadge } = U;

  function inputType(type) {
    if (type === 'date') return 'date';
    if (type === 'time') return 'time';
    if (type === 'number') return 'number';
    return 'text';
  }

  /* 生成表单控件，向导与信息表共用 */
  function fieldControl(field, attrs = '') {
    const required = field.required ? ' required' : '';
    if (field.type === 'enum') {
      const options = ['<option value="">请选择</option>']
        .concat(field.options.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`))
        .join('');
      return `<select ${attrs}${required}>${options}</select>`;
    }
    if (field.type === 'textarea') {
      return `<textarea ${attrs} rows="3" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>`;
    }
    return `<input type="${inputType(field.type)}" ${attrs} placeholder="${escapeHtml(field.placeholder || '')}"${required} />`;
  }

  window.WB.fieldControl = fieldControl;

  function renderBasic(state) {
    const project = state.project;
    const basic = project?.basic || {};
    const meta = project?.meta?.basic || {};
    const rows = BASIC_FIELDS.map((field) => `<div class="kv-row">
      <div class="kv-label">${escapeHtml(field.label)}${field.required ? '<span class="req">*</span>' : ''}</div>
      <div class="kv-value">${fieldControl(field, `data-basic="${field.key}"`)}</div>
      <div class="kv-meta" id="badge-basic-${field.key}">${sourceBadge(meta[field.key] || (basic[field.key] ? 'user' : ''))}</div>
    </div>`).join('');
    $('#basicSection').innerHTML = `<div class="card-title"><h3>一、活动基本信息</h3><small>手改过的字段会标记为「用户填写」，AI 不会覆盖</small></div>${rows}`;
    for (const field of BASIC_FIELDS) {
      const el = $(`[data-basic="${field.key}"]`);
      if (el && basic[field.key] != null) el.value = basic[field.key];
    }
  }

  const KIND_LABEL = { document: '文档', table: '表格', graphic: '图形', structure: '结构化表' };

  function renderOutputs(state) {
    const project = state.project;
    const groups = PHASES.map((phase) => {
      const items = OUTPUT_ITEMS.filter((item) => item.phase === phase.value);
      const cards = items.map((item) => {
        const on = Boolean(project?.outputs?.[item.key]);
        const source = project?.meta?.outputs?.[item.key];
        const ready = window.WB.ai.isReady(item.skill);
        return `<label class="output-item ${on ? 'is-on' : ''}" data-output-item="${item.key}">
          <input type="checkbox" data-output="${item.key}" ${on ? 'checked' : ''} />
          <span class="output-text">
            <span class="output-label">${escapeHtml(item.label)}${item.core ? '<i class="core-mark" title="核心产出">核心</i>' : ''}${item.custom ? '<i class="custom-mark" title="自定义技能包，存在本机浏览器">自定</i>' : ''}</span>
            <span class="output-skill ${ready ? 'is-ready' : ''}">${escapeHtml(KIND_LABEL[item.kind] || '')} · ${escapeHtml(item.skill)}</span>
          </span>
          <span id="badge-output-${item.key}">${on ? sourceBadge(source || 'user') : ''}</span>
        </label>`;
      }).join('');
      const done = items.filter((item) => state.materials?.[item.key]).length;
      return `<div class="output-group">
        <div class="output-group-title">${escapeHtml(phase.label)}
          <span class="output-group-meta">已勾选 ${items.filter((i) => project?.outputs?.[i.key]).length}/${items.length} · 已生成 ${done}</span>
        </div>
        <div class="output-grid">${cards}</div>
      </div>`;
    }).join('');
    const orphans = window.WB.catalog ? window.WB.catalog.orphanOutputs(project?.outputs) : [];
    const orphanNote = orphans.length
      ? `<div class="output-orphan">这个项目引用了 ${orphans.length} 个本机没有的技能（${escapeHtml(orphans.join('、'))}）：导入对应技能包即可恢复，或取消勾选。</div>`
      : '';
    $('#outputSection').innerHTML = `
      <div class="card-title"><h3>二、产出配置</h3><small>勾选决定后续阶段生成哪些任务与材料；也可以用「＋ 自定义产出」导入技能包自己加</small></div>
      <div class="output-toolbar">
        <button class="button button-ghost" data-output-preset="all">全选</button>
        <button class="button button-ghost" data-output-preset="core">仅核心产出</button>
        <button class="button button-ghost" data-output-preset="none">清空</button>
        <button class="button button-ghost" data-skill-import>＋ 自定义产出</button>
      </div>
      ${orphanNote}
      ${groups}`;
  }

  /* ── 自定义技能包：粘贴 → 识别 → 加入产出配置 ──
     技能包用与 skills/<id>/SKILL.md 同一套 frontmatter 约定；识别通过后写进本机技能库，
     产出配置、过程材料与导出立刻按它工作（AI 生成时技能包正文随调用一起交给服务端）。 */

  const skillDom = (id) => document.getElementById(id);

  /* 页头那行小字：说明「固定技能包 + 可组装」的家底 */
  function renderSkillSummary() {
    const el = document.getElementById('skillSummary');
    if (!el || !window.WB.catalog) return;
    const custom = window.WB.catalog.count();
    el.textContent = `技能库：内置 ${window.WB.catalog.builtinCount()} 个固定技能包 · 自定义 ${custom} 个 · 产出配置可在下方自由组装`;
  }

  function skillPreview() {
    const box = skillDom('skillImportPreview');
    if (!box) return null;
    const add = skillDom('skillImportAdd');
    const source = skillDom('skillImportText')?.value || '';
    if (!U.text(source)) {
      box.innerHTML = '<div class="empty"><strong>还没有内容</strong>粘贴技能包后这里显示识别结果；不确定格式就点「填入示例」。</div>';
      if (add) add.disabled = true;
      return null;
    }
    const parsed = window.WB.catalog.parse(source);
    if (!parsed.ok) {
      box.innerHTML = `<div class="skill-preview is-bad"><strong>识别不通过</strong>
        <ul>${parsed.errors.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
      if (add) add.disabled = true;
      return null;
    }
    const skill = parsed.skill;
    box.innerHTML = `<div class="skill-preview is-ok">
      <strong>识别通过</strong>
      <div class="skill-preview-row"><span>产出</span><b>${escapeHtml(skill.title)}</b></div>
      <div class="skill-preview-row"><span>技能 id</span><b>${escapeHtml(skill.id)}</b></div>
      <div class="skill-preview-row"><span>阶段</span><b>${escapeHtml(PHASE_LABEL[skill.phase] || skill.phase)}</b></div>
      <div class="skill-preview-row"><span>类型</span><b>${escapeHtml(KIND_LABEL[skill.kind] || skill.kind)} · 主交付 ${escapeHtml(skill.deliverable)}</b></div>
      <div class="skill-preview-sections">${skill.sections.map((heading) => `<span>${escapeHtml(heading)}</span>`).join('')}</div>
    </div>`;
    if (add) add.disabled = false;
    return skill;
  }

  function skillRender() {
    const list = skillDom('skillImportList');
    if (!list) return;
    const catalog = window.WB.catalog;
    const custom = catalog.list();
    list.innerHTML = `<div class="skill-list-title">本机技能库
        <span>内置 ${catalog.builtinCount()} 个固定技能包 · 自定义 ${custom.length} 个</span></div>`
      + (custom.length
        ? custom.map((skill) => `<div class="skill-chip">
            <b>${escapeHtml(skill.title)}</b>
            <small>${escapeHtml(PHASE_LABEL[skill.phase] || skill.phase)} · ${escapeHtml(KIND_LABEL[skill.kind] || skill.kind)} · ${skill.sections.length} 章 · ${escapeHtml(skill.id)}</small>
            <button type="button" data-skill-remove="${escapeHtml(skill.id)}" title="从技能库移除">×</button>
          </div>`).join('')
        : '<div class="skill-chip is-empty"><small>还没有自定义技能包。粘贴一份试试——点下面的「填入示例」能看格式。</small></div>');
    skillPreview();
  }

  function skillOpen() {
    skillDom('skillImport')?.classList.add('is-open');
    skillRender();
    skillDom('skillImportText')?.focus?.();
  }

  function skillClose() {
    skillDom('skillImport')?.classList.remove('is-open');
  }

  function skillAdd() {
    const textarea = skillDom('skillImportText');
    const skill = skillPreview();
    if (!skill) return;
    const result = window.WB.catalog.add(textarea?.value || '');
    if (!result.ok) { skillRender(); return; }
    /* 加入即勾选：这个项目的产出配置立刻多一项 */
    const project = window.WB.store.state?.project;
    if (project) {
      project.outputs[result.skill.key] = true;
      project.meta.outputs[result.skill.key] = 'user';
      window.WB.store.save();
      window.WB.renderTopbar?.();
    }
    if (textarea) textarea.value = '';
    skillRender();
    window.WB.views.manifest.render();
    window.WB.renderPanelsMeta?.();
    window.WB.toast?.(`已加入产出配置：${result.skill.title}${result.updated ? '（已更新）' : ''}`);
  }

  function skillRemove(id) {
    const skill = window.WB.catalog.find(id);
    if (!skill) return;
    if (!window.confirm(`从技能库移除「${skill.title}」？\n已生成的这份材料会留在项目里，只是界面不再显示它。`)) return;
    window.WB.catalog.remove(id);
    skillRender();
    window.WB.views.manifest.render();
    window.WB.renderPanelsMeta?.();
    window.WB.toast?.(`已移除技能包：${skill.title}`);
  }

  function skillExport() {
    const text = window.WB.catalog.exportText();
    if (!text) { window.WB.toast?.('技能库是空的，先加入一个技能包吧'); return; }
    U.downloadText('自定义技能包.md', text, 'text/markdown;charset=utf-8');
  }

  function renderNotes(state) {
    const notes = state.project?.notes;
    const box = $('#manifestNotes');
    if (!Array.isArray(notes) || !notes.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card">
      <div class="card-title"><h3>AI 补充说明</h3><small>仅供参考，请自行核实</small></div>
      <ul class="note-list">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
    </div>`;
  }

  /* ── 问答式补全：一步步提问 → 确认 → 写回空字段 ── */

  const IV = () => window.WB.interview;
  const session = { stage: 'closed', index: 0, questions: [], rows: [], choices: {}, busy: false, guides: {}, samplesFor: null, skippedVague: 0 };
  const ivDom = (id) => document.getElementById(id);

  /* 让「生成并填入」在等待期间有明确反馈：AI 整理成稿最久等这么久，超时先用本地成稿 */
  const AI_POLISH_TIMEOUT = 40000;

  function withTimeout(promise, ms, fallback = null) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then(
        (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
        () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } }
      );
    });
  }

  /* 任何问答动作出错都要看得见，而不是静默失败 */
  function safeRun(action) {
    try {
      const result = action();
      if (result && typeof result.catch === 'function') {
        result.catch((error) => window.WB.toast(`问答式补全出错：${error?.message || error}`));
      }
    } catch (error) {
      window.WB.toast(`问答式补全出错：${error?.message || error}`);
    }
  }

  function interviewBusy(on, message = '') {
    const apply = ivDom('interviewApply');
    if (apply) {
      apply.disabled = on;
      apply.textContent = on ? '生成中…' : (session.stage === 'confirming' ? '确认填入' : '生成并填入');
    }
    const hint = ivDom('interviewHint');
    if (hint && message) hint.textContent = message;
  }

  function interviewSyncInput() {
    if (session.stage !== 'asking') return;
    const input = ivDom('interviewInput');
    const id = input?.dataset?.interviewInput;
    if (!input || !id) return;
    IV().draftOf(window.WB.store.state).answers[id] = input.value;
  }

  function interviewOpen() {
    const state = window.WB.store.state;
    if (!state.project) { window.WB.toast('先建立项目信息表，再回答问题'); return; }
    if (!U.canOperate()) { window.WB.toast('只读访客不能使用问答式补全'); return; }
    const draft = IV().draftOf(state);
    session.questions = IV().plan(state);
    session.rows = [];
    session.choices = {};
    session.stage = session.questions.length ? 'asking' : 'done';
    session.index = Math.min(Math.max(0, draft.index), Math.max(0, session.questions.length - 1));
    ivDom('interview')?.classList.add('is-open');
    interviewRender();
    setTimeout(() => ivDom('interviewInput')?.focus(), 60);
  }

  function interviewClose() {
    interviewSyncInput();
    window.WB.store.save();
    ivDom('interview')?.classList.remove('is-open');
    session.stage = 'closed';
  }

  function interviewDot(item, index, draft) {
    const done = U.text(draft.answers[item.id]) ? ' is-done' : '';
    const active = index === session.index ? ' is-active' : '';
    const ai = item.ai ? ' is-ai' : '';
    return `<button type="button" class="iv-dot${done}${active}${ai}" data-interview-jump="${index}" title="${escapeHtml(item.ask)}">${index + 1}</button>`;
  }

  function interviewConfirmHtml() {
    const rows = session.rows;
    const filled = rows.filter((row) => row.filled).length;
    return `<div class="iv-progress">
        <span class="iv-count">拟填 ${rows.length} 项</span>
        <span class="iv-answered">${filled ? `${filled} 项已有内容，勾选后整段替换` : '全部写入空白字段'}</span>
      </div>
      <div class="iv-confirm-tools">
        <button type="button" class="iv-link" data-interview-choiceall="1">全部勾选</button>
        <button type="button" class="iv-link" data-interview-choiceall="0">全部取消</button>
      </div>
      <div class="iv-rows">${rows.map((row) => {
        const on = session.choices[row.key] ? ' checked' : '';
        const source = row.source === 'ai' ? '<i class="iv-tag is-ai">AI 成稿</i>' : '';
        const note = row.filled
          ? '<span class="iv-row-note">勾选后用它替换掉现在这段；生成时已读过原内容，不会丢信息</span>'
          : '<span class="iv-row-note">当前为空，勾选后直接填入</span>';
        const before = row.filled ? `<span class="iv-row-before">现在：${escapeHtml(row.current)}</span>` : '';
        return `<label class="iv-row${row.filled ? ' is-filled' : ''}">
          <input type="checkbox" data-interview-choice="${row.key}"${on} />
          <span class="iv-row-body">
            <span class="iv-row-head"><b>${escapeHtml(row.label)}</b>${source}</span>
            ${before}
            <span class="iv-row-proposed">${escapeHtml(row.proposed)}</span>
            ${note}
          </span>
        </label>`;
      }).join('')}</div>`;
  }

  /* 参考块：常见做法（点一下就填）+ 示例答案（整段采用）+ AI 再给两版 */
  function interviewGuideHtml(state, question, draft) {
    const guide = session.guides[question.id] || IV().guideFor(state, question);
    if (!guide) return '';
    session.guides[question.id] = guide;
    const current = U.text(draft.answers[question.id]);
    const picked = IV().chipsIn(question.key, current);
    const vague = IV().isVague(current);
    const open = session.samplesFor === question.id || (vague && guide.samples.length > 0);
    const chips = guide.chips.map((chip) => {
      const on = picked.includes(chip.value) ? ' is-on' : '';
      return `<button type="button" class="iv-chip${on}" data-interview-chip="${escapeHtml(chip.value)}">${escapeHtml(chip.label)}</button>`;
    }).join('');
    const samples = guide.samples.map((sample, i) => `<div class="iv-sample">
        <p>${escapeHtml(sample)}</p>
        <button type="button" class="iv-use" data-interview-sample="${i}">用这一版</button>
      </div>`).join('');
    return `<div class="iv-guide">
        <div class="iv-guide-head">
          <span class="iv-guide-title">${guide.fromAi ? '✦ AI 给的参考' : '常见做法'}<i>点一下就填</i></span>
          <span class="iv-guide-tools">
            ${guide.samples.length ? `<button type="button" class="iv-link" data-interview-withsamples>${open ? '收起示例' : `看 ${guide.samples.length} 版示例`}</button>` : ''}
            <button type="button" class="iv-link" data-interview-aidraft>✦ AI 再给两版</button>
          </span>
        </div>
        ${chips ? `<div class="iv-chips">${chips}</div>` : ''}
        ${open && samples ? `<div class="iv-samples">${samples}</div>` : ''}
        ${guide.note ? `<div class="iv-guide-note">${escapeHtml(guide.note)}</div>` : ''}
      </div>`;
  }

  /* 点常见做法：单选字段直接替换，三个文本区拼进去 / 再点一下取消 */
  function interviewUseChip(value) {
    const state = window.WB.store.state;
    const question = session.questions[session.index];
    if (!question) return;
    const guide = session.guides[question.id] || IV().guideFor(state, question);
    const chip = guide?.chips.find((item) => item.value === value) || { label: value, value };
    const input = ivDom('interviewInput');
    const draft = IV().draftOf(state);
    const next = IV().toggleChip(question.key, input ? input.value : draft.answers[question.id], chip);
    draft.answers[question.id] = next;
    if (input) input.value = next;
    window.WB.store.save();
    interviewRender();
  }

  /* 用一整版示例 */
  function interviewUseSample(index) {
    const state = window.WB.store.state;
    const question = session.questions[session.index];
    const sample = session.guides[question?.id]?.samples?.[index];
    if (!question || !sample) return;
    IV().draftOf(state).answers[question.id] = sample;
    window.WB.store.save();
    interviewRender();
    window.WB.toast('已填入这一版，可以继续改');
  }

  /* 让 AI 就当前这题再拟两版参考 */
  async function interviewAiDraft() {
    const state = window.WB.store.state;
    if (session.busy) { window.WB.toast('上一步还在处理，请稍等再点'); return; }
    if (!U.canOperate()) { window.WB.toast('只读访客不能使用问答式补全'); return; }
    if (!window.WB.ai.ready) { window.WB.toast(U.AI_OFFLINE_HINT); return; }
    const question = session.questions[session.index];
    if (!question) return;
    const draft = IV().draftOf(state);
    session.busy = true;
    interviewBusy(true, 'AI 正在拟这一题的参考版本…');
    let options = null;
    let draftError = '';
    try {
      options = await withTimeout(IV().draftAi(state, question, draft.answers), AI_POLISH_TIMEOUT);
    } catch (error) {
      draftError = error?.message || 'AI 拟稿失败';
    } finally {
      session.busy = false;
      interviewBusy(false);
    }
    if (draftError) { window.WB.toast(draftError); return; }
    if (!options?.length) { window.WB.toast('AI 这次没给出可用的参考，先用上面的常见做法'); return; }
    session.guides[question.id] = IV().withAiOptions(session.guides[question.id] || IV().guideFor(state, question), options);
    session.samplesFor = question.id;
    interviewRender();
    window.WB.toast(`AI 给了 ${options.length} 版，点「用这一版」就行`);
  }

  function interviewRender() {
    const body = ivDom('interviewBody');
    if (!body || session.stage === 'closed') return;
    const state = window.WB.store.state;
    const draft = IV().draftOf(state);
    const total = session.questions.length;
    const hint = ivDom('interviewHint');
    const prev = ivDom('interviewPrev');
    const next = ivDom('interviewNext');
    const apply = ivDom('interviewApply');
    const aiAsk = ivDom('interviewAiAsk');
    if (aiAsk) {
      aiAsk.disabled = !window.WB.ai.ready || session.stage !== 'asking';
      aiAsk.title = window.WB.ai.ready ? '' : U.AI_OFFLINE_HINT;
    }

    if (session.stage === 'done') {
      body.innerHTML = '<div class="empty"><strong>信息表已经填满了</strong>没有需要追问的字段。想改哪一项，直接在信息表里编辑即可。</div>';
      if (hint) hint.textContent = '';
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      if (apply) apply.disabled = true;
      return;
    }

    if (apply) {
      apply.disabled = false;
      apply.textContent = session.stage === 'confirming' ? '确认填入' : '生成并填入';
    }

    if (session.stage === 'confirming') {
      body.innerHTML = interviewConfirmHtml();
      if (hint) hint.textContent = '勾选要写入的字段；已有内容的字段勾选后整段替换（生成时已读过原内容）';
      if (prev) prev.disabled = false;
      if (next) next.disabled = true;
      return;
    }

    const index = Math.min(session.index, total - 1);
    session.index = index;
    const question = session.questions[index];
    const answered = session.questions.filter((item) => U.text(draft.answers[item.id])).length;
    body.innerHTML = `<div class="iv-progress">
        <span class="iv-count" id="interviewCount">第 ${index + 1} / ${total} 问</span>
        <span class="iv-answered" id="interviewAnswered">已答 ${answered} / ${total}</span>
      </div>
      <div class="iv-dots" id="interviewDots">${session.questions.map((item, i) => interviewDot(item, i, draft)).join('')}</div>
      <div class="iv-card">
        <div class="iv-label">${escapeHtml(question.label)}
          ${question.filled ? '<i class="iv-tag">已有内容 · 替换</i>' : '<i class="iv-tag is-new">空字段 · 填入</i>'}
          ${question.style ? `<i class="iv-tag is-style">${escapeHtml(question.style)}</i>` : ''}
          ${question.ai ? '<i class="iv-tag is-ai">AI 追问</i>' : ''}</div>
        <div class="iv-ask">${escapeHtml(question.ask)}</div>
        ${question.why ? `<div class="iv-why"><span>缺这一项会怎样</span>${escapeHtml(question.why)}</div>` : ''}
        ${fieldControl({ type: question.type, options: question.options, placeholder: question.placeholder }, `data-interview-input="${question.id}" id="interviewInput"`)}
        ${question.hint ? `<div class="iv-hint">${escapeHtml(question.hint)}</div>` : ''}
        ${interviewGuideHtml(state, question, draft)}
        ${question.filled ? `<div class="iv-existing">目前写的是：${escapeHtml(U.text(state.project.basic[question.key]))}</div>` : ''}
      </div>`;
    const input = ivDom('interviewInput');
    if (input) input.value = draft.answers[question.id] || '';
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index === total - 1;
    if (hint) hint.textContent = `${answered} / ${total} 已答；只写进空白字段，已有内容要先勾选才会被整段替换`;
  }

  /* 只刷新进度与圆点，不动输入框，避免打字时丢焦点 */
  function interviewRefresh() {
    const draft = IV().draftOf(window.WB.store.state);
    const total = session.questions.length;
    if (!total || session.stage !== 'asking') return;
    const answered = session.questions.filter((item) => U.text(draft.answers[item.id])).length;
    const count = ivDom('interviewCount');
    if (count) count.textContent = `第 ${session.index + 1} / ${total} 问`;
    const stat = ivDom('interviewAnswered');
    if (stat) stat.textContent = `已答 ${answered} / ${total}`;
    const dots = ivDom('interviewDots');
    if (dots) dots.innerHTML = session.questions.map((item, i) => interviewDot(item, i, draft)).join('');
  }

  function interviewGo(index) {
    interviewSyncInput();
    /* 从确认清单点「上一题」时要回到问答，而不是再渲染一遍清单 */
    if (session.stage === 'confirming') session.stage = 'asking';
    const total = session.questions.length;
    if (!total) return;
    session.index = Math.min(Math.max(0, index), total - 1);
    IV().draftOf(window.WB.store.state).index = session.index;
    window.WB.store.save();
    interviewRender();
    ivDom('interviewInput')?.focus();
  }

  async function interviewCompose() {
    const state = window.WB.store.state;
    if (session.busy) { window.WB.toast('上一步还在处理，请稍等再点'); return; }
    if (!U.canOperate()) { window.WB.toast('只读访客不能使用问答式补全'); return; }
    interviewSyncInput();
    const draft = IV().draftOf(state);
    session.skippedVague = IV().vagueAnswers(session.questions, draft.answers).length;
    let rows = IV().composeDraft(state, session.questions, draft.answers);
    if (!rows.length) {
      window.WB.toast(session.skippedVague
        ? `有 ${session.skippedVague} 题写的是「你帮我想」这类，机器猜不出你的活动：点上面的常见做法，或按「✦ AI 再给两版」`
        : '还没有回答任何问题：先在任意一题里写点内容');
      return;
    }
    session.busy = true;
    interviewBusy(true, window.WB.ai.ready
      ? `AI 正在把回答整理成稿…（最多等 ${Math.round(AI_POLISH_TIMEOUT / 1000)} 秒，超时先用本地成稿）`
      : '正在整理成稿…');
    let polishError = '';
    try {
      if (window.WB.ai.ready) {
        const polished = await withTimeout(IV().composeAi(state, rows), AI_POLISH_TIMEOUT);
        if (polished) rows = polished;
      }
    } catch (error) {
      polishError = error?.message || 'AI 整理失败';
    } finally {
      session.busy = false;
      interviewBusy(false);
    }
    if (polishError) window.WB.toast(`${polishError}，已改用本地成稿`);
    session.rows = rows;
    /* 空字段默认写入；已有内容的字段由 AI 重写过（它看过原文），默认也勾上，用户可随时取消 */
    session.choices = Object.fromEntries(rows.map((row) => [row.key, !row.filled || row.source === 'ai']));
    /* 全是空字段时没有取舍要确认，直接写入——这才是「问够之后自动填表」 */
    if (!rows.some((row) => row.filled)) {
      interviewCommit(state, IV().apply(state, rows, session.choices));
      return;
    }
    session.stage = 'confirming';
    interviewRender();
  }

  function interviewConfirm() {
    const state = window.WB.store.state;
    if (!U.canOperate()) { window.WB.toast('只读访客不能使用问答式补全'); return; }
    interviewCommit(state, IV().apply(state, session.rows, session.choices));
  }

  function interviewCommit(state, result) {
    window.WB.store.log('project', `问答式补全写入 ${result.applied.length} 个字段${result.replaced.length ? `、替换 ${result.replaced.length} 个` : ''}`);
    window.WB.store.save();
    IV().resetDraft(state);
    interviewClose();
    window.WB.renderAll();
    const written = result.applied.length + result.replaced.length;
    if (!written) { window.WB.toast('没有写入任何字段（都勾掉了）'); return; }
    const parts = [`已填入 ${result.applied.length} 个字段`];
    if (result.replaced.length) parts.push(`替换 ${result.replaced.length} 个`);
    if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 个`);
    if (session.skippedVague) parts.push(`${session.skippedVague} 题模糊回答未采用`);
    window.WB.toast(parts.join('，'));
  }

  async function interviewAskAi() {
    const state = window.WB.store.state;
    if (session.busy) { window.WB.toast('上一步还在处理，请稍等再点'); return; }
    if (!U.canOperate()) { window.WB.toast('只读访客不能使用问答式补全'); return; }
    if (session.stage !== 'asking') { window.WB.toast('先回到问答再让 AI 追问'); return; }
    if (!window.WB.ai.ready) { window.WB.toast(U.AI_OFFLINE_HINT); return; }
    const draft = IV().draftOf(state);
    session.busy = true;
    interviewBusy(true, 'AI 正在想更贴题的追问…');
    let extra = null;
    let askError = '';
    try {
      extra = await withTimeout(IV().askAi(state, session.questions, draft.answers), AI_POLISH_TIMEOUT);
    } catch (error) {
      askError = error?.message || 'AI 追问失败';
    } finally {
      session.busy = false;
      interviewBusy(false);
    }
    if (askError) { window.WB.toast(askError); return; }
    if (!extra) return;
    if (!extra.length) { window.WB.toast('AI 没有给出新的追问'); return; }
    session.questions = session.questions.concat(extra);
    draft.aiAsked = true;
    window.WB.store.save();
    interviewRender();
    window.WB.toast(`AI 追加了 ${extra.length} 个追问`);
  }

  function interviewStep(delta) {
    interviewGo(session.index + delta);
  }

  function render() {
    const state = window.WB.store.state;
    const has = Boolean(state.project);
    for (const id of ['aiFillManifest', 'generateMaterials', 'exportManifestJson', 'exportManifestMd']) {
      const el = document.getElementById(id);
      if (el) el.disabled = !has;
    }
    U.gateRole(document.getElementById('interviewStart'), has);
    U.gateAi(document.getElementById('aiFillManifest'), has);
    U.gateAi(document.getElementById('generateMaterials'), has);
    renderSkillSummary();
    if (!has) {
      $('#basicSection').innerHTML = '<div class="empty"><strong>还没有项目信息表</strong>点击右上角「重新填写」开始。</div>';
      $('#outputSection').innerHTML = '';
      $('#manifestNotes').innerHTML = '';
      return;
    }
    renderBasic(state);
    renderOutputs(state);
    renderNotes(state);
    const selected = OUTPUT_ITEMS.filter((item) => state.project.outputs[item.key]).length;
    $('#manifestTitle').textContent = state.project.basic.name || '项目信息表';
    $('#manifestSubtitle').textContent = `事实区由你确认；已勾选 ${selected} 项产出。AI 补全只填空白，不覆盖手改内容。`;
  }

  function setOutput(state, keys, value) {
    for (const item of OUTPUT_ITEMS) {
      if (!keys.includes(item.key)) continue;
      state.project.outputs[item.key] = value;
      state.project.meta.outputs[item.key] = 'user';
    }
  }

  function mount() {
    const panel = $('#manifestPanel');
    if (panel.dataset.mounted) return;
    panel.dataset.mounted = '1';
    const state = () => window.WB.store.state;

    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-basic]');
      if (!el || !state().project) return;
      const key = el.dataset.basic;
      const field = BASIC_FIELDS.find((f) => f.key === key);
      const raw = el.value;
      const asNumber = field?.type === 'number' && raw !== '' ? Number(raw) : null;
      state().project.basic[key] = Number.isFinite(asNumber) ? asNumber : raw;
      state().project.meta.basic[key] = 'user';
      window.WB.store.save();
      paintBadge(`badge-basic-${key}`, 'user');
      window.WB.renderTopbar();
      /* 名称 / 日期会影响总览倒计时与任务甘特，但那些面板在切过去时才重绘，
         这里不再整页重绘——否则会把正在输入的字段一起重建，输入焦点会丢。 */
    });

    panel.addEventListener('change', (event) => {
      const el = event.target.closest('[data-output]');
      if (!el || !state().project) return;
      const key = el.dataset.output;
      state().project.outputs[key] = el.checked;
      state().project.meta.outputs[key] = 'user';
      el.closest('.output-item')?.classList.toggle('is-on', el.checked);
      paintBadge(`badge-output-${key}`, el.checked ? 'user' : '');
      window.WB.store.save();
      window.WB.renderTopbar();
      window.WB.views.manifest.render();
      window.WB.renderPanelsMeta?.();
    });

    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-skill-import]')) { skillOpen(); return; }
      const preset = event.target.closest('[data-output-preset]');
      if (!preset || !state().project) return;
      const mode = preset.dataset.outputPreset;
      const keys = OUTPUT_ITEMS.filter((item) => (mode === 'core' ? item.core : true)).map((item) => item.key);
      const allKeys = OUTPUT_ITEMS.map((item) => item.key);
      /* 「仅核心产出」必须先清空再勾核心，否则只会往已有选择里追加。 */
      if (mode === 'none') setOutput(state(), allKeys, false);
      else if (mode === 'core') { setOutput(state(), allKeys, false); setOutput(state(), keys, true); }
      else setOutput(state(), keys, true);
      window.WB.store.save();
      window.WB.views.manifest.render();
      window.WB.renderPanelsMeta?.();
    });

    /* ── 自定义技能包的弹窗（事件委托在弹窗根节点上，只绑一次）── */
    const skillBox = document.getElementById('skillImport');
    if (skillBox) {
      skillBox.addEventListener('input', (event) => {
        if (event.target.closest('#skillImportText')) skillPreview();
      });
      skillBox.addEventListener('click', (event) => {
        if (event.target.closest('.close-skill-import') || event.target.closest('#skillImportClose')) { skillClose(); return; }
        if (event.target.closest('#skillImportSample')) {
          const box = skillDom('skillImportText');
          if (box) box.value = window.WB.catalog.template();
          skillPreview();
          return;
        }
        if (event.target.closest('#skillImportExport')) { skillExport(); return; }
        if (event.target.closest('#skillImportAdd')) { skillAdd(); return; }
        const remove = event.target.closest('[data-skill-remove]');
        if (remove) skillRemove(remove.dataset.skillRemove);
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.getElementById('skillImport')?.classList.contains('is-open')) skillClose();
    });

    /* ── 问答式补全的交互（事件委托在弹窗根节点上，只绑一次）── */
    document.getElementById('interviewStart')?.addEventListener('click', interviewOpen);
    const box = document.getElementById('interview');
    if (box) {
      box.addEventListener('input', (event) => {
        const el = event.target.closest('[data-interview-input]');
        if (!el) return;
        const draft = IV().draftOf(window.WB.store.state);
        draft.answers[el.dataset.interviewInput] = el.value;
        window.WB.store.save();
        interviewRefresh();
      });
      box.addEventListener('change', (event) => {
        const el = event.target.closest('[data-interview-choice]');
        if (!el) return;
        session.choices[el.dataset.interviewChoice] = el.checked;
      });
      box.addEventListener('click', (event) => {
        const jump = event.target.closest('[data-interview-jump]');
        if (jump) { interviewGo(Number(jump.dataset.interviewJump) || 0); return; }
        if (event.target.closest('#interviewPrev')) { interviewStep(-1); return; }
        if (event.target.closest('#interviewNext')) { interviewStep(1); return; }
        if (event.target.closest('#interviewApply')) {
          safeRun(() => (session.stage === 'confirming' ? interviewConfirm() : interviewCompose()));
          return;
        }
        const choiceAll = event.target.closest('[data-interview-choiceall]');
        if (choiceAll) {
          const on = choiceAll.dataset.interviewChoiceall === '1';
          for (const key of Object.keys(session.choices)) session.choices[key] = on;
          interviewRender();
          return;
        }
        const chip = event.target.closest('[data-interview-chip]');
        if (chip) { safeRun(() => interviewUseChip(chip.dataset.interviewChip)); return; }
        const sample = event.target.closest('[data-interview-sample]');
        if (sample) { safeRun(() => interviewUseSample(Number(sample.dataset.interviewSample) || 0)); return; }
        if (event.target.closest('[data-interview-withsamples]')) {
          const current = session.questions[session.index]?.id;
          session.samplesFor = session.samplesFor === current ? null : current;
          interviewRender();
          return;
        }
        if (event.target.closest('[data-interview-aidraft]')) { safeRun(interviewAiDraft); return; }
        if (event.target.closest('#interviewAiAsk')) { safeRun(interviewAskAi); return; }
        if (event.target.closest('.close-interview')) { safeRun(interviewClose); }
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.getElementById('interview')?.classList.contains('is-open')) interviewClose();
    });
  }

  window.WB.views.manifest = {
    id: 'manifest', label: '项目信息表', render, mount, fieldControl,
    openInterview: interviewOpen,
    withTimeout,
    AI_POLISH_TIMEOUT,
    closeInterview: interviewClose,
    interview: {
      open: interviewOpen,
      close: interviewClose,
      render: interviewRender,
      html: () => ivDom('interviewBody')?.innerHTML || '',
      session,
      step: interviewStep,
      go: interviewGo,
      compose: interviewCompose,
      confirm: interviewConfirm,
      ask: interviewAskAi,
      aiDraft: interviewAiDraft,
      refresh: interviewRefresh
    }
  };
}());
