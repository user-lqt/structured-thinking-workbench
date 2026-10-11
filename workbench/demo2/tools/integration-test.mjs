#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'demo2-integration-'));
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const context = { window: {}, TextEncoder, TextDecoder };
vm.runInNewContext(await readFile(path.join(root, 'core/signup.js'), 'utf8'), context);
const S = context.window.WB.signup;
let server, checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
async function start() {
  server = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, DEMO2_PORT: String(port), DEMO2_HOST: '127.0.0.1', DEMO2_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  server.stderr.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* starting */ }
    if (server.exitCode !== null) throw new Error(output || 'Server exited');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Server failed to start');
}
async function stop() { if (server && server.exitCode === null) { const done = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await done; } }
async function request(url, { method = 'GET', body, token, remote = false, project, ip = '203.0.113.1', staff = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (project) headers['X-Project-Id'] = project;
  if (staff) headers['X-Staff-Session'] = staff;
  if (remote) headers['X-Forwarded-For'] = ip;
  const response = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
try {
  await start();
  const doc = JSON.parse(await readFile(path.join(root, 'samples/示例项目-校园科技文化节.json'), 'utf8'));
  const created = await request('/api/shared', { method: 'POST', body: { projectId: 'proj-test', doc } });
  check(created.status === 201, 'Create shared project');
  const id = created.data.id, tokens = created.data.tokens;
  check(created.data.doc.wbs.filter((row) => row.needsVerification).length === doc.wbs.filter((row) => row.status === 'done').length && created.data.doc.wbs.every((row) => row.status !== 'accepted' && !Object.hasOwn(row, 'progress')), 'Legacy completion migrates without inventing acceptance');
  // Simulate an on-disk snapshot created before lifecycle records existed.
  const savedFile = path.join(dataDir, 'shared', `${id}.json`);
  const oldFile = JSON.parse(await readFile(savedFile, 'utf8')); oldFile.doc.wbs = doc.wbs;
  await writeFile(savedFile, JSON.stringify(oldFile));
  check((await request(`/api/shared/${id}`, { remote: true })).status === 403, 'Anonymous cannot read a project');
  const member = await request(`/api/shared/${id}`, { token: tokens.member, remote: true });
  check(member.data.role === 'member' && member.data.doc.project.basic.name === doc.project.basic.name, 'Independent member receives same project');
  check(member.data.doc.wbs[0].needsVerification && member.data.doc.wbs[0].legacyReporting.progress === 100 && !member.data.doc.wbs[0].lifecycle.events.length, 'Existing server archive migrates on read with history intact');
  check(!member.data.tokens && !member.data.owner, 'Read response contains no owner credentials');
  check((await request('/api/shared/other', { token: tokens.member, project: id, remote: true })).status === 403, 'Project header cannot override requested project identity');
  check((await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.viewer, remote: true, body: { revision: 1, doc } })).status === 403, 'Viewer cannot write');
  const updates = await Promise.all(['甲', '乙'].map((name) => request(`/api/shared/${id}`, { method: 'PUT', remote: true, token: tokens.member, body: { revision: 1, doc: { ...doc, project: { ...doc.project, basic: { ...doc.project.basic, name } } } } })));
  check(updates.filter((r) => r.status === 200).length === 1 && updates.filter((r) => r.status === 409).length === 1, 'Concurrent writes: one succeeds and one preserves a conflict');
  let snapshot = (await request(`/api/shared/${id}`, { token: tokens.organizer })).data;
  const taskId = doc.wbs.find((row) => row.status === 'todo').id;
  const route = `/api/shared/${id}/tasks/${encodeURIComponent(taskId)}/actions`;
  const action = async (kind, fields = {}, token = tokens.member, expected = 200) => {
    const result = await request(route, { method: 'POST', token, staff: staffFor(token), remote: true, body: { revision: snapshot.revision, kind, ...(kind === 'submit' ? { deliveries: [selectedRef] } : {}), ...fields } });
    check(result.status === expected, `Task action ${kind}: expected ${expected}, got ${result.status}`);
    if (result.status === 200) snapshot = result.data;
    return result;
  };
  const task = () => snapshot.doc.wbs.find((row) => row.id === taskId);
  const register = async (username, name) => (await request('/api/personnel/register', { method: 'POST', body: { username, name, password: 'test-password-01' } })).data;
  const realOwner = await register('task-owner', '实名验收负责人'), realMember = await register('task-member', '实名执行人员');
  const roster = (await request('/api/personnel/projects', { method: 'POST', staff: realOwner.token, body: { projectId: id, ownerToken: tokens.organizer } })).data;
  const joined = (await request(`/api/personnel/projects/${id}/enter`, { method: 'POST', staff: realMember.token, body: { code: roster.joinCode } })).data;
  await request(`/api/personnel/projects/${id}/people`, { method: 'POST', staff: realOwner.token, body: { personId: joined.me.id, status: 'active' } });
  const staffFor = (token) => token === tokens.organizer ? realOwner.token : realMember.token;
  snapshot.doc.wbs.find((r) => r.id === taskId).responsiblePersonId = roster.me.id;
  snapshot.doc.materials.proposal = { title: '实际交付方案', source: 'ai', sections: [{ heading: '安排', body: '实际服务安排 V1' }] };
  const saveDoc = async (doc = snapshot.doc, staff = realOwner.token, expected = 200) => {
    const r = await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.organizer, staff, body: { revision: snapshot.revision, doc } });
    check(r.status === expected, `Task-linked snapshot: ${r.status} expected ${expected}`); if (r.status === 200) snapshot = r.data; return r;
  };
  await saveDoc();
  const publishVersion = async () => {
    const r = await request(`/api/shared/${id}/materials/proposal/deliveries`, { method: 'POST', token: tokens.member, staff: realMember.token, remote: true, body: { revision: snapshot.revision, note: '实际交付确认' } });
    check(r.status === 200, 'Named member confirms actual immutable version'); snapshot = r.data;
    const m = snapshot.doc.materials.proposal; return { materialId: m.materialId, versionId: m.deliveries.at(-1).id };
  };
  let selectedRef = await publishVersion();

  await action('start', {}, tokens.viewer, 403);
  await action('approve', { note: '越权' }, tokens.member, 403);
  await action('submit', { evidence: '未开始任务' }, tokens.member, 422);
  await action('start');
  check(task().status === 'doing' && task().lifecycle.events[0].origin === 'server', 'Start creates a server execution record');
  await action('block', {}, tokens.member, 422);
  await action('block', { note: '等待设备' });
  check(task().status === 'doing' && task().blocked && task().blockReason === '等待设备', 'Blocking retains lifecycle and reason');
  await action('submit', { evidence: '文件地址' }, tokens.member, 422);
  await action('unblock');
  await action('submit', { evidence: ' ' }, tokens.member, 422);
  await action('submit', { evidence: '只有名字没有关联', deliveries: [] }, tokens.member, 422);
  await action('submit', { evidence: '虚构版本', deliveries: [{ materialId: selectedRef.materialId, versionId: 'nonexistent' }] }, tokens.member, 422);
  await action('submit', { evidence: '资料库/方案v1.pdf' });
  const submittedRef = structuredClone(selectedRef);
  const originalTitle = snapshot.doc.materials.proposal.title;
  snapshot.doc.materials.proposal.title = '材料已改名'; snapshot.doc.materials.proposal.sections[0].body = '更新后的实际安排 V2';
  await saveDoc(); selectedRef = await publishVersion();
  check(snapshot.doc.materials.proposal.materialId === submittedRef.materialId && snapshot.doc.materials.proposal.deliveries[0].snapshot.material.title === originalTitle, 'Rename and new delivery preserve material identity and submitted snapshot');
  check(JSON.stringify(task().lifecycle.events.at(-1).deliveries) === JSON.stringify([submittedRef]), 'Publishing new delivery does not silently switch task submission version');
  const forgedVersion = structuredClone(snapshot.doc); forgedVersion.materials.proposal.deliveries[0].snapshot.material.title = '篡改快照';
  await saveDoc(forgedVersion, realOwner.token, 422);
  const forgedPerson = structuredClone(snapshot.doc); forgedPerson.wbs.find((r) => r.id === taskId).responsiblePersonId = joined.me.id;
  await saveDoc(forgedPerson, realMember.token, 403);

  await action('approve', { note: '越权' }, tokens.member, 403);
  await action('reject', { note: '越权' }, tokens.member, 403);
  await action('approve', {}, tokens.organizer, 422);
  const changedScope = structuredClone(snapshot.doc); changedScope.wbs.find((row) => row.id === taskId).output = '偷换交付标准';
  check((await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.member, body: { revision: snapshot.revision, doc: changedScope } })).status === 422, 'Submitted scope cannot change before return');
  await action('approve', { note: '核对提交时的首版交付，后续新版另行提交' }, tokens.organizer);
  check(JSON.stringify(task().lifecycle.events.at(-1).deliveries) === JSON.stringify([submittedRef]), 'Acceptance stays bound to submitted version even after newer delivery exists');
  await action('reject', { note: '补充附件' }, tokens.organizer);
  check(task().status === 'doing' && !Object.hasOwn(task(), 'progress'), 'Return produces execution state without synthetic percentage');
  await action('submit', { evidence: '资料库/方案v2.pdf与预算附件' });
  const priorRevision = snapshot.revision;
  await action('approve', { note: '已核验方案及附件', actor: { id: 'fake', name: 'fake', role: 'member' }, at: '2000-01-01' }, tokens.organizer);
  const acceptedRow = task(), acceptance = acceptedRow.lifecycle.events.at(-1);
  check(JSON.stringify(acceptedRow.lifecycle.events.at(-1).deliveries) === JSON.stringify([selectedRef]) && acceptedRow.lifecycle.events.at(-1).actor.personId === roster.me.id, 'Acceptance binds named reviewer and selected actual version');
  check(acceptedRow.status === 'accepted' && acceptance.actor.role === 'organizer' && acceptance.actor.name !== 'fake' && acceptance.at !== '2000-01-01', 'Server stamps acceptance identity/time and ignores client claims');
  check((await request(route, { method: 'POST', token: tokens.organizer, staff: realOwner.token, body: { revision: priorRevision, kind: 'reject', note: '过期操作' } })).status === 409, 'Stale task actions cannot overwrite newer acceptance');
  const forged = structuredClone(snapshot.doc);
  forged.wbs.find((row) => row.id === taskId).lifecycle.events.at(-1).note = '修改验收记录';
  check((await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.organizer, body: { revision: snapshot.revision, doc: forged } })).status === 422, 'Snapshot PUT cannot tamper with server acceptance records');
  const fakeNew = structuredClone(snapshot.doc); fakeNew.wbs.push({ ...acceptedRow, id: 'forged-new' });
  check((await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.member, body: { revision: snapshot.revision, doc: fakeNew } })).status === 422, 'New tasks cannot inject lifecycle records through snapshot PUT');
  const fakeBase = structuredClone(snapshot.doc); fakeBase.wbs.push({ id: 'forged-base', task: '跳过开始', lifecycle: { ...acceptedRow.lifecycle, baseStatus: 'doing', events: [] } });
  check((await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.member, body: { revision: snapshot.revision, doc: fakeBase } })).status === 422, 'New tasks must begin unstarted');
  await action('reject', { note: '重新核验' }, tokens.organizer);
  check(task().status === 'doing', 'Organizer can return a previously accepted task');
  await action('submit', { evidence: '方案v3.pdf' });
  await action('approve', { note: '重新核验通过' }, tokens.organizer);
  const imported = await request('/api/shared', { method: 'POST', body: { projectId: 'proj-imported', doc: snapshot.doc } });
  const importedTask = imported.data.doc.wbs.find((row) => row.id === taskId);
  check(imported.status === 201 && importedTask.needsVerification && importedTask.status === 'doing' && importedTask.lifecycle.events.length === 0 && importedTask.importedLifecycle.events.at(-1).kind === 'approve', 'Imported acceptance remains history and requires new server review');
  check((await request('/api/material', { method: 'POST', remote: true, token: tokens.viewer, project: id, body: {} })).status === 403, 'Viewer cannot call AI write API');
  for (const route of ['/server.mjs', '/server/shared.mjs', '/generated/shared/proj-test.json', '/.env', '/api/signup/queue?project=proj-test']) check((await request(route, { remote: true })).status === 403, `Private route blocked: ${route}`);
  check((await request('/', { remote: true })).status === 200, 'Remote browser can load public workbench shell');
  const signup = S.fresh({ enabled: true, preset: 'checkin' });
  const schema = S.packSchema(signup), h = S.fingerprint(signup);
  const participant = await request('/api/signup/link', { method: 'POST', body: { projectId: id, schema } });
  const staff = await request('/api/signup/link', { method: 'POST', body: { projectId: id, schema, role: 'staff' } });
  const p = participant.data.code, sp = staff.data.code;
  check(p && sp && p !== sp, 'Staff and participants have different codes');
  check((await request(`/api/signup/form?p=${sp}`, { remote: true })).data.role === 'staff', 'Staff role comes from server');
  check((await request('/api/signup/submit', { method: 'POST', remote: true, body: { p: 'unknown', receipt: 'R1|s|bad|1|x' } })).status === 404, 'Unknown projects rejected');
  check((await request('/api/signup/submit', { method: 'POST', remote: true, body: { p, receipt: 'R1|garbage|bad|1|x' } })).status === 400, 'Malformed events rejected');
  const codes = Array.from({ length: 215 }, (_, i) => S.packReceipt({ kind: 'submit', id: `person-${i}`, at: Date.now(), h, values: [`同学${i}`, `2026${i}`, '', '自行到场'] }));
  const submissions = await Promise.all(codes.map((receipt) => request('/api/signup/submit', { method: 'POST', remote: true, ip: '198.51.100.8', body: { p, receipt } })));
  check(submissions.every((r) => r.status === 200), '215 remote submissions from the same campus NAT accepted');
  const repeated = await request('/api/signup/submit', { method: 'POST', remote: true, body: { p, receipt: codes[0] } });
  check(repeated.data.duplicate && repeated.data.total === 215, 'Retry is idempotent');
  const first = await request(`/api/signup/queue?project=${id}&since=0`);
  check(first.data.records.length === 200 && first.data.next === 200 && first.data.total === 215, 'First page does not skip remaining records');
  const second = await request(`/api/signup/queue?project=${id}&since=${first.data.next}`);
  check(second.data.records.length === 15 && second.data.next === 215, 'Second page contains all remaining submissions');
  const remoteQueue = await request(`/api/signup/queue?project=${id}`, { token: tokens.member, project: id, remote: true });
  check(remoteQueue.status === 200, 'Invited member can read attendance');
  check((await request('/api/signup/queue?project=other', { token: tokens.member, project: id, remote: true })).status === 403, 'Member cannot read another project');
  const event = (kind, person = 'person-0') => S.packReceipt({ kind, id: person, at: Date.now(), h });
  check((await request('/api/signup/submit', { method: 'POST', body: { p, receipt: event('checkout') } })).status === 409, 'Checkout without check-in rejected');
  const checkin = await request('/api/signup/submit', { method: 'POST', body: { p, receipt: event('checkin') } });
  check(checkin.status === 200, 'Participant check-in');
  check((await request('/api/signup/submit', { method: 'POST', body: { p, receipt: event('checkout') } })).status === 200, 'Participant checkout');
  const staffReceipt = S.packReceipt({ kind: 'submit', id: 'staff-1', at: Date.now(), h, values: ['工作人员', 'staff001', '', '工作人员'] });
  await request('/api/signup/submit', { method: 'POST', body: { p: sp, receipt: staffReceipt } });
  check((await request('/api/signup/submit', { method: 'POST', body: { p, receipt: event('checkin', 'staff-1') } })).status === 403, 'Participant channel cannot sign staff attendance');
  const queue = await request(`/api/signup/queue?project=${id}&since=215`);
  const folded = S.fresh({ fields: S.unpackSchema(schema).fields });
  S.mergeEvents(folded, [...first.data.records, ...second.data.records, ...queue.data.records]);
  check(S.stats(folded).total === 216 && S.stats(folded).staff === 1 && S.stats(folded).checkouts === 1, 'Server events fold into correct role and attendance counts');
  const manual = await request('/api/signup/manage', { method: 'POST', body: { projectId: id, schema, record: { id: 'staff-manual', at: Date.now(), role: 'staff' }, values: ['值班老师', 'staff002', '', '工作人员'], kind: 'checkin', by: '现场负责人' } });
  check(manual.status === 200, 'Manager can sign a manually registered staff member');
  const rateReceipt = S.packReceipt({ kind: 'submit', id: 'rate-test', at: Date.now(), h, values: ['限流测试', 'rate001', '', '自行到场'] });
  const rateAttempts = await Promise.all(Array.from({ length: 42 }, () => request('/api/signup/submit', { method: 'POST', remote: true, ip: '192.0.2.1', body: { p, receipt: rateReceipt } })));
  check(rateAttempts.some((result) => result.status === 429), 'Repeated submission of the same record remains rate-limited');
  await request('/api/signup/link', { method: 'POST', body: { projectId: id, schema, enabled: false } });
  check((await request(`/api/signup/form?p=${p}`, { remote: true })).status === 410, 'Closed form cannot be loaded');
  check((await request('/api/signup/submit', { method: 'POST', body: { p, receipt: codes[0] } })).status === 410, 'Closed form cannot receive submissions');
  const rotated = await request(`/api/shared/${id}`, { method: 'POST', token: tokens.organizer });
  check(rotated.status === 200 && (await request(`/api/shared/${id}`, { token: tokens.member, remote: true })).status === 403, 'Owner can revoke old invitations');
  await stop(); await start();
  const restored = (await request(`/api/shared/${id}`, { token: tokens.organizer })).data;
  check(restored.revision === snapshot.revision, 'Shared data persists across server restart');
  check(restored.doc.wbs.find((row) => row.id === taskId).status === 'accepted' && restored.doc.wbs.find((row) => row.id === taskId).lifecycle.events.at(-1).note === '重新核验通过', 'Accepted task and conclusion survive server restart and attendance operations');
  check((await request(`/api/signup/queue?project=${id}`)).data.total >= 220, 'Attendance persists across restart');
  console.log(`多人共享与签到签退集成测试：${checks} 项通过`);
} finally {
  await stop();
  await rm(dataDir, { recursive: true, force: true });
}
