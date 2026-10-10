#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
async function request(url, { method = 'GET', body, token, remote = false, project, ip = '203.0.113.1' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (project) headers['X-Project-Id'] = project;
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
  check((await request(`/api/shared/${id}`, { remote: true })).status === 403, 'Anonymous cannot read a project');
  const member = await request(`/api/shared/${id}`, { token: tokens.member, remote: true });
  check(member.data.role === 'member' && member.data.doc.project.basic.name === doc.project.basic.name, 'Independent member receives same project');
  check(!member.data.tokens && !member.data.owner, 'Read response contains no owner credentials');
  check((await request('/api/shared/other', { token: tokens.member, project: id, remote: true })).status === 403, 'Project header cannot override requested project identity');
  check((await request(`/api/shared/${id}`, { method: 'PUT', token: tokens.viewer, remote: true, body: { revision: 1, doc } })).status === 403, 'Viewer cannot write');
  const updates = await Promise.all(['甲', '乙'].map((name) => request(`/api/shared/${id}`, { method: 'PUT', remote: true, token: tokens.member, body: { revision: 1, doc: { ...doc, project: { ...doc.project, basic: { ...doc.project.basic, name } } } } })));
  check(updates.filter((r) => r.status === 200).length === 1 && updates.filter((r) => r.status === 409).length === 1, 'Concurrent writes: one succeeds and one preserves a conflict');
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
  check((await request(`/api/shared/${id}`, { token: tokens.organizer })).data.revision === 2, 'Shared data persists across server restart');
  check((await request(`/api/signup/queue?project=${id}`)).data.total >= 220, 'Attendance persists across restart');
  console.log(`多人共享与签到签退集成测试：${checks} 项通过`);
} finally {
  await stop();
  await rm(dataDir, { recursive: true, force: true });
}
