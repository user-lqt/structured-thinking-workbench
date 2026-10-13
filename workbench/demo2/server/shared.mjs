import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import '../core/task-lifecycle.js';
import '../core/deliveries.js';

const Task = globalThis.WB.taskLifecycle;
const Delivery = globalThis.WB.deliveries;
const normaliseDoc = (doc, imported = false) => Delivery.normalise({ ...doc, risks: (doc.risks || []).map((r,i)=>({...r,id:r.id || `risk-legacy-${i+1}`})), wbs: (doc.wbs || []).map((task, i) => (imported ? Task.forSharedImport : Task.normalise)({ ...task, id: task.id || `task-${i + 1}`, responsiblePersonId: String(task.responsiblePersonId || '') })) }, imported);

const token = () => randomBytes(24).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// A single Node process serializes each compare-and-write without an await in between.
export function sharedProjects(directory) {
  let links;
  mkdirSync(directory, { recursive: true });
  const fileOf = (id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id || '') ? path.join(directory, `${id}.json`) : null;
  const read = (id) => { const file = fileOf(id); if (!file || !existsSync(file)) return null; const row = JSON.parse(readFileSync(file, 'utf8')); row.doc = normaliseDoc(row.doc); return row; };
  const save = (row) => {
    const file = fileOf(row.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(row));
    renameSync(`${file}.tmp`, file);
  };
  const auth = (req, id) => {
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const row = read(id);
    if (!row) return null;
    const role = same(key, row.owner) ? 'organizer' : same(key, row.editor) ? 'member' : same(key, row.viewer) ? 'viewer' : '';
    return role ? { row, role } : null;
  };
  const publicRow = (row, role) => ({ id: row.id, revision: row.revision, updatedAt: row.updatedAt, doc: row.doc, role });
  return {
    auth,
    read,
    configureLinks(provider) { links = provider; },
    create(doc, requestedId) {
      if (read(requestedId)) return { status: 409, error: '该项目已经共享，请使用原组织者邀请链接进入。' };
      const id = fileOf(requestedId) && !read(requestedId) ? requestedId : `shared-${token().slice(0, 16)}`;
      const row = { id, revision: 1, owner: token(), editor: token(), viewer: token(), doc: normaliseDoc(doc, true), updatedAt: new Date().toISOString() };
      save(row);
      return { ...publicRow(row, 'organizer'), tokens: { organizer: row.owner, member: row.editor, viewer: row.viewer } };
    },
    get(session) { return publicRow(session.row, session.role); },
    update(session, revision, doc, req) {
      const row = read(session.row.id);
      if (session.role === 'viewer') return { status: 403, error: '只读邀请不能修改项目。' };
      if (revision !== row.revision) return { status: 409, error: '另一位成员已保存新版本。你的本机草稿已保留，请先下载草稿，再载入共享版本。', revision: row.revision };
      const proposed = normaliseDoc(doc), ids = new Set();
      const riskIds = new Set(), drillIds = new Set();
      for (const r of proposed.risks || []) { if (!r.id || riskIds.has(r.id)) return {status:422,error:'风险编号不能为空或重复。'}; riskIds.add(r.id); }
      for (const d of proposed.drills || []) { if (!d.id || drillIds.has(d.id)) return {status:422,error:'演练编号不能为空或重复。'}; drillIds.add(d.id); }
      const execution = d => JSON.stringify({title:d.title, riskId:d.riskId, mode:d.mode, trigger:d.trigger, impact:d.impact, status:d.status, startedAt:d.startedAt, finishedAt:d.finishedAt, outcome:d.outcome, decisions:d.decisions, planSnapshot:d.planSnapshot,participants:d.participants,participantIds:d.participantIds,leaderId:d.leaderId,rollback:d.rollback,escalation:d.escalation,parentId:d.parentId,steps:(d.steps||[]).map(s=>({id:s.id,text:s.text,note:s.note||'',result:s.result||'unverified',evidence:s.evidence||'',expected:s.expected,owner:s.owner,personId:s.personId,resources:s.resources,resourceId:s.resourceId}))});
      for (const previous of row.doc.drills || []) {
        if (previous.status !== 'done' || !previous.mode) continue;
        const next = proposed.drills?.find(d=>d.id===previous.id);
        if (!next || execution(next)!==execution(previous)) return {status:422,error:'已结束演练的执行记录必须保留；请发起复测。'};
      }
      const materialIds = new Set();
      for (const [key, material] of Object.entries(proposed.materials || {})) {
        if (materialIds.has(material.materialId)) return { status: 422, error: '材料编号不能重复。' };
        materialIds.add(material.materialId);
        const previous = row.doc.materials?.[key];
        if (previous && previous.materialId !== material.materialId || JSON.stringify(previous?.deliveries || []) !== JSON.stringify(material.deliveries)) return { status: 422, error: '材料编号与交付版本不能通过快照修改；请确认并保存新交付版本。' };
      }
      for (const [key, previous] of Object.entries(row.doc.materials || {})) if (previous.deliveries.length && !proposed.materials?.[key]) return { status: 422, error: '已交付材料需保留版本记录。' };
      for (const task of proposed.wbs) {
        if (ids.has(task.id)) return { status: 422, error: '任务编号不能重复。' };
        ids.add(task.id);
        const previous = row.doc.wbs.find((item) => item.id === task.id);
        if (previous ? JSON.stringify(previous.lifecycle) !== JSON.stringify(task.lifecycle) : task.lifecycle.events.length) return { status: 422, error: '任务执行和验收记录只能通过任务操作接口写入，不能修改共享快照来变更状态。' };
        if (task.responsiblePersonId !== (previous?.responsiblePersonId || '')) {
          try {
            links.actor(req, row.id, true);
            if (task.responsiblePersonId && !links.people(row.id).some((p) => p.id === task.responsiblePersonId && p.status === 'active' && !p.sample)) throw new Error('请选择本项目已确认的实名人员；示例人员只能演示执行排班。');
          } catch (error) { return { status: error.status || 422, error: error.message }; }
          if (previous && ['review', 'accepted'].includes(previous.status)) return { status: 422, error: '请先退回任务，再更换实名责任人。' };
        }
        if (previous && ['review', 'accepted'].includes(previous.status) && Task.scopeOf(previous) !== Task.scopeOf(task)) return { status: 422, error: '已提交的任务和产出要求已锁定；请先由组织者退回再修改。' };
        if (previous) {
          task.legacyReporting = previous.legacyReporting;
          if (previous.importedLifecycle) task.importedLifecycle = previous.importedLifecycle;
        } else if (JSON.stringify(task.lifecycle) !== JSON.stringify(Task.fresh())) return { status: 422, error: '新增任务必须从未开始建立，再通过操作接口开始执行。' };
      }
      row.doc = proposed;
      row.revision++;
      row.updatedAt = new Date().toISOString();
      save(row);
      return publicRow(row, session.role);
    },
    taskAction(session, revision, taskId, action, req) {
      if (session.role === 'viewer') return { status: 403, error: '只读邀请不能操作任务。' };
      if (['approve', 'reject'].includes(action.kind) && session.role !== 'organizer') return { status: 403, error: '只有项目组织者可以验收或退回任务。' };
      const row = read(session.row.id);
      if (revision !== row.revision) return { status: 409, error: '项目已有新版本，请同步最新版本后重试；任务操作尚未写入。' };
      const index = row.doc.wbs.findIndex((task) => task.id === taskId);
      if (index < 0) return { status: 404, error: '任务不存在。' };
      try {
        let actor = { id: `shared:${row.id}:${session.role}`, name: session.role === 'organizer' ? '项目组织者（共享身份）' : '项目协作成员（共享身份）', role: session.role };
        if (['submit', 'approve', 'reject'].includes(action.kind)) actor = { ...links.actor(req, row.id, ['approve', 'reject'].includes(action.kind)), role: session.role };
        if (action.kind === 'submit') {
          if (!links.people(row.id).some((p) => p.id === row.doc.wbs[index].responsiblePersonId && p.status === 'active' && !p.sample)) throw new Error('实名责任人缺失、为示例人员或已停用，请补充真实人员。');
          if (!Delivery.validRefs(action.deliveries)) throw new Error('请选择已确认的实际交付版本，材料名称或交付说明不能代替版本关联。');
          action.deliveries = action.deliveries.map((r) => ({ materialId: r.materialId, versionId: r.versionId }));
        }
        const refs = action.kind === 'submit' ? action.deliveries : action.kind === 'approve' ? Task.replay(row.doc.wbs[index]).submission?.deliveries : null;
        if (refs && (!Delivery.validRefs(refs) || refs.some((ref) => Delivery.resolve(row.doc, ref)?.version.origin !== 'server'))) throw new Error('请选择已确认的实际交付版本，草稿和导入声明不能直接验收。');
        row.doc.wbs[index] = Task.apply(row.doc.wbs[index], action, { id: randomUUID(), at: new Date().toISOString(), origin: 'server',
          actor });
      } catch (error) { return { status: error.status || 422, error: error.message }; }
      row.revision++; row.updatedAt = new Date().toISOString(); save(row);
      return publicRow(row, session.role);
    },
    publish(session, revision, key, note, req) {
      if (session.role === 'viewer') return { status: 403, error: '只读邀请不能确认交付。' };
      const row = read(session.row.id);
      if (revision !== row.revision) return { status: 409, error: '项目已有新版本，请同步后重试。' };
      try { Delivery.publish(row.doc, key, { id: randomUUID(), at: new Date().toISOString(), origin: 'server', actor: { ...links.actor(req, row.id), role: session.role } }, note); }
      catch (error) { return { status: error.status || 422, error: error.message }; }
      row.revision++; row.updatedAt = new Date().toISOString(); save(row);
      return publicRow(row, session.role);
    },
    taskDetails(session, taskId) {
      const task = read(session.row.id).doc.wbs.find((t) => t.id === taskId);
      if (!task) return { status: 404, error: '任务不存在。' };
      return { taskId, ...links.details(session.row.id, taskId) };
    },
    rotate(session) {
      if (session.role !== 'organizer') return { status: 403, error: '只有组织者可以重置邀请链接。' };
      const row = read(session.row.id);
      row.editor = token(); row.viewer = token();
      save(row);
      return { tokens: { organizer: row.owner, member: row.editor, viewer: row.viewer } };
    }
  };
}
