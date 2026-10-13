/* 突发变更演练：按风险类别选择场景，逐步推演处置动作，并把结论回写到风险与变更记录。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, escapeHtml, PHASE_LABEL, RISK_CATEGORY, LEVEL_LABEL, LEVEL_CLASS, RESOURCE_KIND, fmtDateTime, canOperate } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;

  /* 场景类别 → 需要检查备用能力的资源类型 */
  const CATEGORY_RESOURCE = {
    safety: ['staff', 'equipment'],
    health: ['staff', 'material'],
    venue: ['venue', 'equipment'],
    tech: ['equipment'],
    program: ['staff'],
    weather: ['venue', 'material'],
    finance: ['fund'],
    compliance: ['staff'],
    publicity: ['staff'],
    participation: ['venue', 'material']
  };

  const catLabel = (value) => RISK_CATEGORY[value] || value || '未分类';

  function stat(label, value, unit, tone = '') {
    return `<div class="stat ${tone ? `stat-${tone}` : ''}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong>
    </div>`;
  }

  function renderStats(current) {
    const coverage = window.WB.drills.coverage();
    const running = current.drills.filter((item) => item.status !== 'done').length;
    const done = current.drills.filter((item) => item.status === 'done').length;
    $('#drillsStats').innerHTML = `<div class="wbs-summary">
      ${stat('演练场景库', window.WB.drills.SCENARIOS.length, '个')}
      ${stat('风险类别覆盖', coverage.missing.length ? `${10 - coverage.missing.length}/10` : '10/10', '', coverage.ok ? '' : 'danger')}
      ${stat('准备 / 进行中', running, '场')}
      ${stat('已结束演练', done, '场')}
    </div>`;
  }

  function renderToolbar() {
    const canWrite = canOperate();
    $('#drillsToolbar').innerHTML = `
      <span class="asset-filter">
        <select data-drill-filter="category">
          <option value="">全部风险类别</option>
          ${Object.entries(RISK_CATEGORY).map(([value, label]) => `<option value="${value}" ${state().ui.drillCategory === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </span>
      <div class="panel-actions">
        <button class="button button-ghost" data-drill-export ${state().drills.length ? '' : 'disabled'}>导出演练记录</button>
        <button class="button button-primary" data-drill-custom ${canWrite ? '' : 'disabled'}>自定义演练</button>
      </div>`;
  }

  /* ── 备用能力检查：演练前先看资源还有没有余量 ── */
  function capability(scenario) {
    const kinds = (CATEGORY_RESOURCE[scenario.category] || []).filter(k=>k!=='staff');
    const rows = state().resources.filter((item) => kinds.includes(item.kind));
    if (!rows.length) return { rows: [], spare: null, kinds };
    const spare = rows.filter((item) => Number(item.available) - Number(item.assigned) > 0).length;
    return { rows, spare, kinds };
  }

  function capabilityBlock(scenario) {
    const { rows, spare, kinds } = capability(scenario);
    if (!kinds.length) return '<p class="check-line">本场以人员调度为主，请在人员与资源核对名册、班次和实际到场情况。</p>';
    if (!rows.length) {
      return `<div class="check-line is-warn">资源台账里还没有登记「${kinds.map((k) => RESOURCE_KIND[k] || k).join(' / ')}」类资源，无法判断执行这场变更时还有多少余量。建议先到「人员与资源」页补齐。</div>`;
    }
    const tone = spare === 0 ? 'is-warn' : 'is-ok';
    const text = spare === 0
      ? `相关资源全部排满，突发变更时没有额外余量，需要提前约定「谁让出资源」`
      : `相关资源中有 ${spare} 项仍有余量，可作为变更时的缓冲`;
    return `<div class="check-line ${tone}">${escapeHtml(text)}</div>
      <ul class="drill-res-list">${rows.map((item) => {
        const gap = Number(item.available) - Number(item.assigned);
        return `<li><span class="chip chip-${gap > 0 ? 'ok' : 'over'}">${escapeHtml(RESOURCE_KIND[item.kind] || item.kind)}</span>
          ${escapeHtml(item.name || '未命名资源')}：可用 ${Number(item.available)} / 已安排 ${Number(item.assigned)}
          ${gap > 0 ? '' : '<b class="warn">无余量</b>'}</li>`;
      }).join('')}</ul>`;
  }

  /* ── 场景库 ───────────────────────────── */

  function scenarioCard(scenario) {
    const canWrite = canOperate();
    const steps = scenario.steps.length;
    return `<article class="drill-card" data-scenario="${scenario.id}">
      <div class="drill-card-head">
        <span class="phase-pill phase-${scenario.phase}">${escapeHtml(PHASE_LABEL[scenario.phase] || scenario.phase)}</span>
        <span class="risk-level ${LEVEL_CLASS[scenario.severity] || ''}">${escapeHtml(LEVEL_LABEL[scenario.severity] || scenario.severity)}</span>
        <span class="chip">${escapeHtml(catLabel(scenario.category))}</span>
      </div>
      <h3>${escapeHtml(scenario.title)}</h3>
      <p class="drill-trigger"><b>触发</b>${escapeHtml(scenario.trigger)}</p>
      <p class="drill-impact"><b>影响</b>${escapeHtml(scenario.impact)}</p>
      <div class="drill-card-foot">
        <small>${steps} 步处置 · 升级至 ${escapeHtml(scenario.escalateTo[0] || '总协调')}</small>
        <button class="button button-primary" data-drill-start="${scenario.id}" ${canWrite ? '' : 'disabled'}>使用模板并编辑</button>
      </div>
    </article>`;
  }

  function renderScenarios(current) {
    const category = current.ui.drillCategory || '';
    const list = window.WB.drills.SCENARIOS.filter((item) => !category || item.category === category);
    $('#drillScenarios').innerHTML = list.length
      ? `<div class="drill-grid">${list.map(scenarioCard).join('')}</div>`
      : '<div class="card"><div class="empty">该类别下暂无预置场景。</div></div>';
  }

  /* ── 演练运行台 ───────────────────────── */

  function currentDrill() {
    const current = state();
    if (!current.ui.drillId) return null;
    return current.drills.find((item) => item.id === current.ui.drillId) || null;
  }

  const results = { unverified: '未验证', pass: '通过', issue: '发现问题', na: '不适用' };
  const planKeys = { trigger: '触发信号', prevention: '预防措施', response: '响应措施', escalation: '升级路径', owner: '责任人' };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const roster = () => window.WB.personnel?.snapshot?.id === state().activeId ? window.WB.personnel.snapshot.people.filter(p => p.status === 'active' && !p.sample) : [];
  const personOptions = (id) => `<option value="">待指定实名人员</option>${id && !roster().some(p => p.id === id) ? `<option selected value="${escapeHtml(id)}">${escapeHtml(id)}（名册待核实）</option>` : ''}` + roster().map(p => `<option value="${escapeHtml(p.id)}" ${p.id === id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  const field = (key, label, value, lock = '') => `<label><span>${label}</span><textarea data-drill-field="${key}" ${lock}>${escapeHtml(value || '')}</textarea></label>`;
  function runnerBlock(d) {
    const lock = !canOperate() || d.status === 'done' ? 'disabled' : '';
    const draftLock = lock || (d.status !== 'draft' ? 'disabled' : '');
    const linked = state().risks.find(r => r.id === d.riskId);
    const stepFields = (step, key, label) => `<label>${label}<input data-step-id="${escapeHtml(step.id)}" data-step-field="${key}" value="${escapeHtml(step[key] || '')}" ${key === 'text' || key === 'owner' || key === 'resources' || key === 'expected' ? draftLock : lock}></label>`;
    return `<div class="card drill-runner"><h3>${escapeHtml(d.title)} · ${{draft:'演练准备',running:'演练进行中',done:'已结束'}[d.status]}</h3>
      <p>关联风险：${escapeHtml(linked?.name || d.riskName || '未关联')} · ${escapeHtml(d.riskId || '独立场景')} ${d.riskId && !linked ? '（原风险已删除，保留历史）' : ''}</p>
      <p>桌面推演验证方案逻辑；现场实测记录实际证据。结束演练不会自动验收任务或判定风险已消除。</p>
      ${d.parentId ? `<p>复测来源：${escapeHtml(d.parentId)} <button class="button button-ghost" data-drill-open="${escapeHtml(d.parentId)}">查看前次记录</button></p>` : ''}
      <div class="drill-fields"><label>关联风险<select data-drill-link-risk ${draftLock}><option value="">独立自定义场景</option>${d.riskId && !linked ? `<option value="${escapeHtml(d.riskId)}" selected>原风险已删除</option>` : ''}${state().risks.map(r=>`<option value="${escapeHtml(r.id)}" ${r.id===d.riskId?'selected':''}>${escapeHtml(r.name)}</option>`).join('')}</select></label>
      <label>类别<select data-drill-field="category" ${draftLock}>${Object.entries(RISK_CATEGORY).map(([k,v])=>`<option value="${k}" ${k===d.category?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>
      <label>阶段<select data-drill-field="phase" ${draftLock}>${Object.entries(PHASE_LABEL).map(([k,v])=>`<option value="${k}" ${k===d.phase?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>${field('title','场景名称',d.title,draftLock)}${field('trigger','触发情境',d.trigger,draftLock)}${field('impact','影响范围',d.impact,draftLock)}
      <label>演练方式<select data-drill-field="mode" ${draftLock}><option value="">请选择（旧记录未注明）</option><option value="tabletop" ${d.mode==='tabletop'?'selected':''}>桌面推演</option><option value="field" ${d.mode==='field'?'selected':''}>现场实测</option></select></label>
      <label>主持人<select data-drill-field="leaderId" ${draftLock}>${personOptions(d.leaderId)}</select></label>
      ${roster().length ? `<fieldset><legend>参与人员（复用项目名册）</legend>${roster().map(p=>`<label><input type="checkbox" data-drill-participant="${escapeHtml(p.id)}" ${(d.participantIds||[]).includes(p.id)?'checked':''} ${draftLock}>${escapeHtml(p.name)}</label>`).join('')}</fieldset>` : '<p>实名名册未载入：请先登录服务账号并打开项目，或到人员与资源刷新。</p>'}
      ${field('participants','参与人员与分工（名册未载入时可注明姓名）',d.participants,draftLock)}${field('rollback','中止 / 回退条件',d.rollback,draftLock)}${field('escalation','升级联络路径',d.escalation,draftLock)}</div>
      ${d.followUp?.length ? `<p>模板 / 历史改进建议：${escapeHtml(d.followUp.join('；'))}</p>` : ''}
      ${capabilityBlock(d)}
      <ol class="drill-steps">${d.steps.map((s,i)=>`<li class="drill-step"><b class="drill-step-text">${i+1}. ${escapeHtml(s.text || '待填写步骤')}</b><div class="drill-fields">
      ${stepFields(s,'text','处置动作')}${stepFields(s,'owner','责任岗位 / 人员')}${stepFields(s,'resources','资源需求补充')}<label>关联资源<select data-step-id="${escapeHtml(s.id)}" data-step-field="resourceId" ${draftLock}><option value="">未关联具体资源</option>${s.resourceId && !state().resources.some(r=>r.id===s.resourceId)?`<option selected value="${escapeHtml(s.resourceId)}">资源已删除（${escapeHtml(s.resourceId)}）</option>`:''}${state().resources.map(r=>`<option value="${escapeHtml(r.id)}" ${s.resourceId===r.id?'selected':''}>${escapeHtml(r.name)}</option>`).join('')}</select></label>${stepFields(s,'expected','通过标准 / 时限')}
      <label>实名执行人<select data-step-id="${escapeHtml(s.id)}" data-step-field="personId" ${draftLock}>${personOptions(s.personId)}</select></label>
      <label>验证结果<select data-step-id="${escapeHtml(s.id)}" data-step-field="result" ${d.status !== 'running' ? 'disabled' : lock}>${Object.entries(results).map(([v,t])=>`<option value="${v}" ${(s.result||'unverified')===v?'selected':''}>${t}</option>`).join('')}</select></label>
      ${stepFields(s,'note','观察 / 问题原因 / 不适用说明')}${stepFields(s,'evidence','证据编号 / 材料版本 / 实测记录')}
      ${s.legacyDone ? '<small>旧版曾勾选完成，验证结论待核实。</small>' : ''}
      </div>${d.status==='draft'?`<button data-step-up="${escapeHtml(s.id)}" class="button button-ghost" ${i===0?'disabled':''}>上移</button><button data-step-remove="${escapeHtml(s.id)}" class="button button-ghost">删除步骤</button>`:''}</li>`).join('')}</ol>
      ${d.status==='draft'?'<button class="button button-ghost" data-step-add>添加步骤</button>':''}
      <div class="drill-fields">${field('decisions','关键决策',d.decisions,lock)}${field('outcome','复盘结论（未验证项与后续行动）',d.outcome,lock)}</div>
      ${d.knowledgeReferences ? `<details><summary>本次 AI 参考知识（${escapeHtml(d.knowledgeReferences.方式)}）</summary>${d.knowledgeReferences.资料.map(r=>`<p>${escapeHtml(r.名称)} · ${escapeHtml(r.章节)} · ${escapeHtml(r.来源)}</p>`).join('') || '未引用知识资料'}</details>` : ''}
      ${d.aiDraft ? `<div class="card"><h4>AI 建议草稿（尚未采用）</h4><pre style="white-space:pre-wrap">${escapeHtml(d.aiDraft.steps.map(s=>s.text).join('\n'))}</pre><button class="button button-ghost" data-ai-adopt ${draftLock}>确认追加建议步骤</button><button class="button button-ghost" data-ai-discard ${draftLock}>丢弃草稿</button></div>` : ''}
      <div class="panel-actions">
      ${d.status==='draft'?`<button class="button button-ghost" data-drill-ai ${!canOperate() || !window.WB.ai?.ready || window.WB.ai.busy?'disabled':''}>AI 起草建议</button><button class="button button-primary" data-drill-begin>确认方案并开始</button>`:''}
      ${d.status==='running'?'<button class="button button-primary" data-drill-finish>结束并复盘</button>':''}
      ${d.status==='done'?'<button class="button button-primary" data-drill-retest>基于本场发起复测</button>':''}
      <button class="button button-ghost" data-drill-close>收起</button></div>
      ${d.status==='done'?reviewBlock(d,linked):''}</div>`;
  }
  function reviewBlock(d,risk) {
    const lock = canOperate() ? '' : 'disabled';
    const proposal = d.planProposal || d.planSnapshot || {};
    return `<hr><h3>预案修订与整改</h3><p>原预案保留在本次快照中。请核对差异，再决定是否更新风险台账。</p>
      <div class="drill-fields">${Object.entries(planKeys).map(([key,label])=>`<label><span>${label} · 演练前</span><p>${escapeHtml(d.planSnapshot?.[key] || '未填写')}</p><span>当前台账</span><p>${escapeHtml(risk?.[key] || '未填写')}</p><span>拟修订内容</span><textarea data-plan-field="${key}" ${d.planApplied || !risk ? 'disabled':lock}>${escapeHtml(proposal[key]||'')}</textarea></label>`).join('')}</div>
      <button class="button button-primary" data-plan-apply ${d.planApplied || !risk?'disabled':lock}>${d.planApplied?'已确认更新预案':'确认更新关联风险预案'}</button>
      ${!risk?'<p>未关联有效风险，不能覆盖台账；可先在风险预案页建立风险，再从风险发起演练。</p>':''}
      <h4>发现的问题 → 整改任务</h4>${d.steps.filter(s=>s.result==='issue').map(s=>{
        const t = state().wbs.find(t=>t.id===s.taskId);
        return `<div class="card"><b>${escapeHtml(s.text)}</b><p>${escapeHtml(s.note)}</p>${s.taskId ? `<p>整改任务：${escapeHtml(t?.task || '关联任务已删除')} · ${escapeHtml(({todo:'未开始',doing:'进行中',review:'待验收',accepted:'已验收'})[t?.status] || '待核实')}</p><button class="button button-ghost" data-task-goto="${escapeHtml(s.taskId)}">进入任务页</button>` : `<label>责任人<select data-finding="${escapeHtml(s.id)}" data-finding-field="ownerId" ${lock}>${personOptions(s.ownerId)}</select></label><label>截止日期<input type="date" data-finding="${escapeHtml(s.id)}" data-finding-field="due" value="${escapeHtml(s.due||'')}" ${lock}></label><label>交付要求<input data-finding="${escapeHtml(s.id)}" data-finding-field="output" value="${escapeHtml(s.output||'')}" ${lock}></label><button class="button button-ghost" data-finding-create="${escapeHtml(s.id)}" ${lock}>创建整改任务</button>`}</div>`;
      }).join('') || '<p>没有登记“发现问题”的步骤。未验证不等于通过。</p>'}`;
  }

  function renderRunner(current) {
    const drill = currentDrill();
    const box = $('#drillRunner');
    if (!drill) { box.innerHTML = ''; return; }
    box.innerHTML = runnerBlock(drill);
  }

  /* ── 历史记录 ─────────────────────────── */

  function renderHistory(current) {
    $('#drillHistory').innerHTML = `<div class="card"><h3>演练记录（含待继续）</h3>${current.drills.map(d=>`<p><b>${escapeHtml(d.title)}</b> · ${{draft:'准备中',running:'进行中',done:'已结束'}[d.status]} · 通过 ${d.steps.filter(s=>s.result==='pass').length} / ${d.steps.length} · 问题 ${d.steps.filter(s=>s.result==='issue').length} <button class="button button-ghost" data-drill-open="${escapeHtml(d.id)}">查看 / 继续</button></p>`).join('') || '<p>尚无演练</p>'}</div>`;
  }

  function render() {
    const current = state();
    renderStats(current);
    renderToolbar(current);
    renderRunner(current);
    renderScenarios(current);
    renderHistory(current);
    if (!canOperate()) $('#drillsPanel')?.querySelectorAll?.('button,input,textarea,select').forEach(el=>{if(!el.matches('[data-drill-open],[data-drill-close],[data-drill-export],[data-drill-filter],[data-task-goto]')) el.disabled=true;});
  }

  /* ── 操作 ─────────────────────────────── */

  function createDrill(scenario, risk, previous) {
    if (!canOperate()) return;
    const base = previous || scenario || {};
    const d = store().normaliseDrill({
      id: U.uid('drill'), scenarioId: scenario?.id || previous?.scenarioId || '',
      riskId: risk?.id || previous?.riskId || '', riskName: risk?.name || previous?.riskName || '',
      title: previous ? `${previous.title} · 复测` : risk?.name || scenario?.title || '自定义风险演练',
      category: risk?.category || base.category || 'safety', phase: risk?.phase || base.phase || 'execute',
      mode: previous?.mode || 'tabletop', status: 'draft', startedAt: '', createdAt: new Date().toISOString(),
      trigger: risk?.trigger || base.trigger || '', impact: base.impact || '',
      followUp: copy(base.followUp||[]), rollback: base.rollback || '', escalation: risk?.escalation || base.escalateTo?.join(' → ') || base.escalation || '',
      participantIds: previous?.participantIds || [], participants: previous?.participants || '', leaderId: previous?.leaderId || '',
      planSnapshot: copy(risk || {}), parentId: previous?.id || '',
      steps: (base.steps || (risk?.response ? [{text:risk.response}] : [{text:''}])).map(s=>({id:U.uid('step'),text:s.text,owner:s.owner||risk?.owner||'',personId:s.personId||'',resourceId:s.resourceId||'',resources:s.resources||'',expected:s.expected||'',result:'unverified',note:'',evidence:''}))
    });
    d.startedAt = '';
    state().drills.unshift(d); state().ui.drillId=d.id;
    store().log('drill',`准备演练：${d.title}`); store().save();
    window.WB.gotoTarget?.({view:'drills'}); render();
  }
  function startDrill(id) { const s=window.WB.drills.byId(id); if(s) createDrill(s); }
  function startFromRisk(id) { const r=state().risks.find(r=>r.id===id); if(r) createDrill(null,r); }
  async function aiSteps() {
    const d=currentDrill(); if(!canOperate() || d?.status!=='draft') return;
    const project=state().project, id=state().activeId, before=JSON.stringify(d);
    try {
      const references=await window.WB.library.prepare(state().assets,{场景:d.title,触发:d.trigger,演练方式:d.mode}, selection=>{if(JSON.stringify(selection,null,2).length>39000) throw new Error('知识目录过长，请减少勾选的资料');return window.WB.ai.run('change-drill',selection,'{"sectionIds":["从目录中选择相关章节编号"]}');});
      if(!canOperate() || state().activeId!==id || state().project!==project || JSON.stringify(d)!==before) return;
      const input={
        场景:{title:d.title,trigger:d.trigger,impact:d.impact,mode:d.mode},
        关联风险:state().risks.find(r=>r.id===d.riskId)||{}, 项目信息:project?.basic||{},
        可用资源:state().resources.map(r=>({id:r.id,name:r.name,available:r.available,assigned:r.assigned})),
        知识库:references,
        要求:'输出可编辑的处置建议草稿；每步说明岗位、动作、时限与核验标准。不得声称已经执行或通过验证。'
      };
      if(JSON.stringify(input,null,2).length>39000) throw new Error('本次参考资料过长，请减少知识库勾选或精简项目资源');
      const data=await window.WB.ai.run('change-drill',input,window.WB.ai.drillContract());
      if(!data || !canOperate() || state().activeId!==id || state().project!==project || !state().drills.includes(d) || JSON.stringify(d)!==before) return;
      const steps=(data.steps||[]).map(s=>({text:U.text(typeof s==='string'?s:s.text)})).filter(s=>s.text).slice(0,20);
      if(!steps.length) return window.WB.toast('AI 未返回有效步骤，请手动编辑');
      d.knowledgeReferences=references; d.aiDraft={steps,at:new Date().toISOString()}; store().save(); render();
    } catch(e) { window.WB.toast(`生成建议失败：${e.message}`); }
  }
  function finishDrill() {
    const d=currentDrill(); if(!canOperate() || d?.status!=='running') return;
    if(!U.text(d.outcome)) return window.WB.toast('请填写复盘结论，说明未验证项与后续行动');
    if(d.steps.some(s=>['issue','na'].includes(s.result) && !U.text(s.note))) return window.WB.toast('发现问题或不适用的步骤必须填写原因');
    if(d.mode==='field' && d.steps.some(s=>s.result==='pass' && !U.text(s.evidence))) return window.WB.toast('现场实测通过的步骤请填写证据或实测记录');
    if(d.steps.some(s=>s.result==='unverified') && !confirm('仍有未验证步骤，结束后会保留未验证结论。继续？')) return;
    d.status='done'; d.finishedAt=new Date().toISOString(); d.planProposal=copy(d.planSnapshot||{});
    store().log('drill',`结束演练：${d.title}；未自动验收任务或修改预案`); store().save(); render();
  }
  function applyPlan(d) {
    const r=state().risks.find(r=>r.id===d.riskId); if(!r || d.planApplied) return;
    const changed=Object.keys(planKeys).filter(k=>(d.planProposal?.[k]||'')!==(d.planSnapshot?.[k]||''));
    if(!changed.length) return window.WB.toast('尚未修改预案内容');
    if(changed.some(k=>(r[k]||'')!==(d.planSnapshot?.[k]||''))) return window.WB.toast('台账的相同字段已被修改，请发起新一轮演练或在风险页合并，避免覆盖他人修改');
    if(!confirm('确认将拟修订字段写入关联风险？评分不会改变。')) return;
    const before=copy(r); for(const k of changed) r[k]=d.planProposal[k];
    const at=new Date().toISOString(); r.planHistory ||= [];
    r.planHistory.push({drillId:d.id,at,actor:state().user?.name||'项目编辑者',before:Object.fromEntries(Object.keys(planKeys).map(k=>[k,before[k]||''])),after:Object.fromEntries(Object.keys(planKeys).map(k=>[k,r[k]||'']))});
    d.planApplied={at,fields:changed}; store().log('risk',`确认修订风险 ${r.id}：${r.name}`); store().save(); render();
  }
  function createTask(d,id) {
    const s=d.steps.find(s=>s.id===id); if(!s || s.taskId || s.result!=='issue') return;
    if(window.WB.sync?.role && !window.WB.personnel?.snapshot?.manager) return window.WB.toast('请由项目管理者登录实名账号后分配整改任务');
    const p=roster().find(p=>p.id===s.ownerId);
    if(!p || !s.due || !U.text(s.output)) return window.WB.toast('请先载入人员名册，选择实名责任人、截止日期和交付要求');
    const task=store().normaliseRow({id:U.uid('task'),task:`整改：${s.text}`,phase:d.phase,owner:s.owner||'',responsiblePersonId:p.id,due:s.due,output:s.output,drillId:d.id,findingId:s.id,lifecycle:window.WB.taskLifecycle.fresh(),source:'user'});
    state().wbs.push(task); s.taskId=task.id; store().log('drill',`演练问题创建整改任务：${task.task}`); store().save(); render();
  }
  function mount() {
    const panel=$('#drillsPanel');
    panel.addEventListener('click',e=>{
      // Native fields, labels and details must not enter the action redraw path.
      const button=e.target.closest('button');
      if(!button || button.disabled) return;
      const hit=(a)=>e.target.closest(`[${a}]`);
      if(hit('data-drill-open')) {state().ui.drillId=hit('data-drill-open').dataset.drillOpen;render();return;}
      if(hit('data-drill-close')) {state().ui.drillId=null;store().save();render();return;}
      if(hit('data-task-goto')) {window.WB.gotoTarget({view:'tasks',taskView:'table',phase:'all',row:hit('data-task-goto').dataset.taskGoto});return;}
      if(hit('data-drill-export')) {U.downloadText(`${U.safeFileName(store().projectName())}-演练记录.md`,window.WB.exporters.drillsToMarkdown());return;}
      if(!canOperate()) return;
      if(hit('data-drill-start')) return startDrill(hit('data-drill-start').dataset.drillStart);
      if(hit('data-drill-custom')) return createDrill();
      const d=currentDrill(); if(!d) return;
      if(d.status==='done') {
        if(hit('data-drill-retest')) createDrill(null,state().risks.find(r=>r.id===d.riskId),d);
        if(hit('data-plan-apply')) applyPlan(d);
        if(hit('data-finding-create')) createTask(d,hit('data-finding-create').dataset.findingCreate);
        return;
      }
      if(hit('data-drill-finish')) return finishDrill();
      if(d.status!=='draft') return;
      if(hit('data-drill-ai')) return aiSteps();
      if(hit('data-ai-adopt') && d.aiDraft) {d.steps.push(...d.aiDraft.steps.map(s=>({...s,id:U.uid('step'),result:'unverified',note:''})));delete d.aiDraft;}
      if(hit('data-ai-discard')) delete d.aiDraft;
      if(hit('data-step-add')) d.steps.push({id:U.uid('step'),text:'',result:'unverified',note:''});
      if(hit('data-step-remove')) d.steps=d.steps.filter(s=>s.id!==hit('data-step-remove').dataset.stepRemove);
      if(hit('data-step-up')) {const i=d.steps.findIndex(s=>s.id===hit('data-step-up').dataset.stepUp);if(i>0) [d.steps[i-1],d.steps[i]]=[d.steps[i],d.steps[i-1]];}
      if(hit('data-drill-begin')) {
        if(!U.text(d.title)||!U.text(d.trigger)||!d.mode||!d.steps.length||d.steps.some(s=>!U.text(s.text)||!U.text(s.expected))) return window.WB.toast('请填写场景、触发情境、演练方式，以及每一步的动作与通过标准');
        d.status='running';d.startedAt=new Date().toISOString();
      }
      store().save();render();
    });
    function edit(e) {
      const el=e.target;
      if(el.dataset.drillFilter) {state().ui.drillCategory=el.value;renderScenarios(state());return;}
      if(!canOperate()) return;
      const d=currentDrill();if(!d) return;
      if(d.status==='draft' && el.hasAttribute('data-drill-link-risk')) {
        const r=state().risks.find(r=>r.id===el.value); d.riskId=r?.id||'';d.riskName=r?.name||'';d.planSnapshot=copy(r||{});store().save();render();return;
      }
      if(d.status==='draft' && el.dataset.drillParticipant) {const ids=new Set(d.participantIds||[]);el.checked?ids.add(el.dataset.drillParticipant):ids.delete(el.dataset.drillParticipant);d.participantIds=[...ids];store().save();return;}
      if(d.status==='done') {
        if(el.dataset.planField && Object.hasOwn(planKeys,el.dataset.planField) && !d.planApplied) {d.planProposal ||= copy(d.planSnapshot||{});d.planProposal[el.dataset.planField]=el.value;}
        if(el.dataset.finding) {const s=d.steps.find(s=>s.id===el.dataset.finding);if(s && !s.taskId && ['ownerId','due','output'].includes(el.dataset.findingField)) s[el.dataset.findingField]=el.value;}
      } else {
        if(el.dataset.drillField && (d.status==='draft'||['decisions','outcome'].includes(el.dataset.drillField))) d[el.dataset.drillField]=el.value;
        if(el.dataset.stepId) {const s=d.steps.find(s=>s.id===el.dataset.stepId), k=el.dataset.stepField;if(s && (d.status==='draft'||['result','note','evidence'].includes(k))) {s[k]=el.value;s.done=s.result==='pass';}}
      }
      store().save();
    }
    panel.addEventListener('input',edit);panel.addEventListener('change',edit);
  }
  window.WB.views.drills = { id:'drills',label:'风险演练',render,mount,startDrill,startFromRisk };
}());
