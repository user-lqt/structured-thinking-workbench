/* Shared, dependency-free task rules for the browser and Node service. */
(function (root) {
  root.WB = root.WB || {};
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? '').trim();
  const scopeOf = (row) => JSON.stringify([text(row.task), text(row.output)]);
  const labels = { todo: '未开始', doing: '进行中', review: '待验收', accepted: '已验收' };
  const actionLabels = { start: '开始执行', submit: '提交验收', approve: '验收通过', reject: '退回执行', block: '标记受阻', unblock: '解除受阻' };
  const fresh = () => ({ version: 1, baseStatus: 'todo', baseBlocked: false, baseBlockReason: '', needsVerification: false, events: [] });
  function historyOf(row) {
    if (row.legacyReporting && typeof row.legacyReporting === 'object') return copy(row.legacyReporting);
    if (row.lifecycle?.version === 1 || (!Object.hasOwn(row, 'status') && !Object.hasOwn(row, 'progress'))) return null;
    return { ...(Object.hasOwn(row, 'status') ? { status: row.status } : {}), ...(Object.hasOwn(row, 'progress') ? { progress: row.progress } : {}) };
  }
  function lifecycleOf(row) {
    if (row.lifecycle?.version === 1) return { ...fresh(), ...copy(row.lifecycle), events: Array.isArray(row.lifecycle.events) ? copy(row.lifecycle.events) : [] };
    return { ...fresh(), baseStatus: ['doing', 'blocked', 'done', 'review', 'accepted'].includes(row.status) ? 'doing' : 'todo',
      baseBlocked: row.status === 'blocked', baseBlockReason: row.status === 'blocked' ? text(row.blockReason) : '',
      needsVerification: ['done', 'review', 'accepted'].includes(row.status) };
  }
  function replay(row, lifecycle = lifecycleOf(row)) {
    let status = lifecycle.baseStatus === 'doing' ? 'doing' : 'todo', blocked = Boolean(lifecycle.baseBlocked), blockReason = text(lifecycle.baseBlockReason);
    let needsVerification = Boolean(lifecycle.needsVerification), submission = null, acceptance = null, previousTime = -Infinity;
    const seen = new Set(), invalid = [];
    for (const [index, event] of lifecycle.events.entries()) {
      const time = Date.parse(event?.at), actor = event?.actor;
      let error = !event || !text(event.id) || seen.has(event.id) || event.taskId !== row.id || !Number.isFinite(time) || time < previousTime || !text(actor?.id) || !text(actor?.name) || !['organizer', 'member'].includes(actor?.role) || !['local', 'server'].includes(event.origin) ? '记录格式或身份无效' : '';
      if (!error) {
        if (event.kind === 'start') { if (status !== 'todo') error = '仅未开始任务可以开始'; else status = 'doing'; }
        else if (event.kind === 'submit') {
          if (status !== 'doing' || blocked || !text(event.evidence) || !text(event.scope)) error = '提交缺少交付依据或当前不可提交';
          else { status = 'review'; submission = event; acceptance = null; needsVerification = event.linkVersion !== 1 || !root.WB.deliveries.validRefs(event.deliveries) || !event.responsiblePersonId; }
        } else if (event.kind === 'approve' || event.kind === 'reject') {
          if (!(status === 'review' || (event.kind === 'reject' && status === 'accepted')) || blocked || actor.role !== 'organizer' || !text(event.note) || !submission || event.submissionId !== submission.id) error = '验收缺少有效提交、结论或组织者权限';
          else if (event.kind === 'approve') {
            if (submission.scope !== scopeOf(row)) error = '任务或交付要求已变更，须重新提交';
            else if (submission.linkVersion !== 1 || !root.WB.deliveries.validRefs(submission.deliveries) || !submission.responsiblePersonId || submission.responsiblePersonId !== row.responsiblePersonId || JSON.stringify(event.deliveries) !== JSON.stringify(submission.deliveries) || !actor.personId) error = '缺少实名责任人、实际交付版本或实名验收人，待补充后重新提交';
            else { status = 'accepted'; acceptance = event; needsVerification = false; }
          } else { status = 'doing'; submission = null; acceptance = null; }
        } else if (event.kind === 'block') {
          if (status === 'accepted' || !text(event.note)) error = '受阻必须记录原因且任务尚未验收';
          else { blocked = true; blockReason = text(event.note); }
        } else if (event.kind === 'unblock') {
          if (!blocked) error = '任务未受阻'; else { blocked = false; blockReason = ''; }
        } else error = '未知操作';
      }
      if (error) { invalid.push({ index, reason: error }); if (event?.kind === 'approve') needsVerification = true; }
      else { seen.add(event.id); previousTime = time; }
    }
    return { status, blocked, blockReason, needsVerification, submission, acceptance, invalid };
  }
  function normalise(row) {
    const lifecycle = lifecycleOf(row), result = replay(row, lifecycle);
    const { progress, ...rest } = row;
    return { ...rest, lifecycle, legacyReporting: historyOf(row), status: result.status, blocked: result.blocked,
      blockReason: result.blockReason, needsVerification: result.needsVerification };
  }
  function apply(row, action, context) {
    const current = normalise(row), state = replay(current);
    if (action.kind === 'submit' && (!current.responsiblePersonId || !context.actor.personId || !root.WB.deliveries.validRefs(action.deliveries))) throw Object.assign(new Error('请补充实名责任人，并选择实际交付版本；提交人须登录项目账号。'), { status: 422 });
    const event = { id: context.id, taskId: row.id, kind: action.kind, at: context.at, actor: copy(context.actor), origin: context.origin,
      note: text(action.note).slice(0, 4000), evidence: text(action.evidence).slice(0, 4000),
      ...(action.kind === 'submit' ? { scope: scopeOf(current), linkVersion: 1, responsiblePersonId: current.responsiblePersonId, deliveries: copy(action.deliveries) } : {}),
      ...(action.kind === 'approve' ? { deliveries: copy(state.submission?.deliveries || []) } : {}),
      ...(['approve', 'reject'].includes(action.kind) ? { submissionId: state.submission?.id || '' } : {}) };
    current.lifecycle.events.push(event);
    const next = replay(current), last = current.lifecycle.events.length - 1;
    const error = next.invalid.find((item) => item.index === last);
    if (error) throw Object.assign(new Error(error.reason), { status: 422 });
    return normalise(current);
  }
  function forSharedImport(row) {
    const current = normalise(row);
    if (!current.lifecycle.events.length) return current;
    // Imported claims remain available for inspection; only new server actions grant acceptance.
    return normalise({ ...current, importedLifecycle: { ...copy(current.lifecycle), ...(current.importedLifecycle ? { previousImport: copy(current.importedLifecycle) } : {}) }, lifecycle: {
      ...fresh(), baseStatus: current.status === 'todo' ? 'todo' : 'doing', baseBlocked: current.blocked,
      baseBlockReason: current.blockReason, needsVerification: true
    } });
  }
  root.WB.taskLifecycle = { labels, actionLabels, fresh, normalise, replay, apply, forSharedImport, scopeOf };
}(typeof window === 'undefined' ? globalThis : window));
