import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'demo2-task-links-'));
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'server.mjs')], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DEMO2_PORT: String(port), DEMO2_HOST: '127.0.0.1', DEMO2_DATA_DIR: directory } });
let checks = 0, snapshot, roster, browser;
const check = (value, label) => { assert.ok(value, label); checks++; };
async function req(route, { method = 'GET', body, shared, staff, expected = 200 } = {}) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(shared ? { Authorization: `Bearer ${shared}` } : {}), ...(staff ? { 'X-Staff-Session': staff } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result.error)}`); checks++;
  return result;
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
  const doc = { project: { basic: { name: '任务关联验证' }, outputs: { proposal: true } }, wbs: [
    { id: 'task-a', task: '完成活动方案', owner: '策划岗位', output: '活动方案', status: 'doing' },
    { id: 'legacy', task: '旧任务', owner: '负责人文字', output: '活动方案', status: 'done', progress: 100 },
    { id: 'task-start', task: '尚未开始的演示任务', owner: '引导岗位', output: '执行说明', status: 'todo' }
  ], materials: { proposal: { title: '活动方案', source: 'ai', sections: [{ heading: '方案', body: 'V1 正文' }] } }, resources: [] };
  const created = await req('/api/shared', { method: 'POST', body: { projectId: 'task-links', doc }, expected: 201 });
  snapshot = created;
  const route = `/api/shared/${created.id}`, dutyRoute = `/api/personnel/projects/${created.id}`;
  const tokens = created.tokens;
  const register = (username, name) => req('/api/personnel/register', { method: 'POST', body: { username, name, password: 'task-links-password' } });
  const owner = await register('link-owner', '责任人张三'), first = await register('link-first', '执行人李四'), second = await register('link-second', '执行人王五');
  roster = await req('/api/personnel/projects', { method: 'POST', staff: owner.token, body: { projectId: created.id, ownerToken: tokens.organizer } });
  const people = [];
  for (const user of [first, second]) {
    const joined = await req(dutyRoute + '/enter', { method: 'POST', staff: user.token, body: { code: roster.joinCode } });
    people.push(joined.me);
    roster = await req(dutyRoute + '/people', { method: 'POST', staff: owner.token, body: { personId: joined.me.id, status: 'active' } });
  }
  const save = async (document, expected = 200, staff = owner.token) => {
    const result = await req(route, { method: 'PUT', shared: tokens.organizer, staff, expected, body: { revision: snapshot.revision, doc: document } });
    if (expected === 200) snapshot = result;
  };
  const task = () => snapshot.doc.wbs.find((row) => row.id === 'task-a');
  const action = async (kind, extra = {}, expected = 200, staff = first.token, shared = tokens.member) => {
    const result = await req(route + '/tasks/task-a/actions', { method: 'POST', shared, staff, expected, body: { revision: snapshot.revision, kind, ...extra } });
    if (expected === 200) snapshot = result;
  };
  const publish = async () => {
    snapshot = await req(route + '/materials/proposal/deliveries', { method: 'POST', shared: tokens.member, staff: first.token, body: { revision: snapshot.revision, note: '人工核对实际交付' } });
    const material = snapshot.doc.materials.proposal;
    return { materialId: material.materialId, versionId: material.deliveries.at(-1).id };
  };
  check(!task().responsiblePersonId && snapshot.doc.materials.proposal.aiDraft && snapshot.doc.wbs[1].needsVerification && !snapshot.doc.wbs[1].lifecycle.events.length, 'Legacy and AI records never invent real associations or acceptance');
  await action('submit', { evidence: '同名产出已经完成' }, 422);
  const invalidPerson = structuredClone(snapshot.doc); invalidPerson.wbs[0].responsiblePersonId = 'unregistered-person';
  await save(invalidPerson, 422);
  const assigned = structuredClone(snapshot.doc); assigned.wbs[0].responsiblePersonId = roster.me.id;
  await save(assigned);
  await action('submit', { evidence: '只有草稿', deliveries: [{ materialId: 'MAT-proposal', versionId: 'draft' }] }, 422);
  for (const deliveries of [null, [null], '活动方案', [{ materialId: 'MAT-proposal', versionId: ' ' }]]) {
    await action('submit', { evidence: '旧记录缺少实际版本', deliveries }, 422);
  }
  const blank = structuredClone(snapshot.doc);
  blank.materials.empty = { title: '只有产出名称', sections: [{ heading: '交付', body: ' \n ' }] };
  await save(blank);
  await req(route + '/materials/empty/deliveries', { method: 'POST', shared: tokens.member, staff: first.token, expected: 422, body: { revision: snapshot.revision } });
  check(snapshot.doc.materials.empty.deliveries.length === 0, 'A title and empty sections cannot create an actual delivery version');

  const plan = async (personId, start, end) => {
    roster = await req(dutyRoute + '/shifts', { method: 'POST', staff: owner.token, body: { revision: roster.revision, personId, taskId: 'task-a', start, end, title: '方案执行', resources: [] } });
    return roster.shifts.at(-1);
  };
  const firstShift = await plan(people[0].id, '2026-10-11T09:00:00+08:00', '2026-10-11T10:00:00+08:00');
  await plan(people[0].id, '2026-10-11T11:00:00+08:00', '2026-10-11T12:00:00+08:00');
  await plan(people[1].id, '2026-10-11T09:00:00+08:00', '2026-10-11T10:00:00+08:00');
  let details = await req(route + '/tasks/task-a', { shared: tokens.viewer });
  check(details.people.every((p) => !p.phone && !p.username && !p.accountId), 'Read-only task details expose service associations without copying private roster fields');
  await req(route + '/materials/proposal/deliveries', { method: 'POST', shared: tokens.viewer, staff: owner.token, expected: 403, body: { revision: snapshot.revision } });
  check(details.shifts.length === 3 && new Set(details.shifts.map((s) => s.personId)).size === 2, 'One task resolves two people and three shifts without duplicate ledgers');
  const duty = (kind, fields = {}, expected = 200) => req(dutyRoute + '/event', { method: 'POST', staff: first.token, expected, body: { shiftId: firstShift.id, kind, requestId: `duty-${kind}`, ...fields } });
  await duty('accept');
  roster = await req(dutyRoute, { staff: owner.token });
  await req(dutyRoute + '/shifts', { method: 'POST', staff: owner.token, expected: 409, body: { ...firstShift, revision: roster.revision, title: '覆盖接受记录' } });
  await duty('checkin'); await duty('done', { report: '未签退不能结束' }, 409); await duty('checkout');
  await duty('done', {}, 422); await duty('done', { report: '班次工作已完成，交付方案仍待验收。' });
  details = await req(route + '/tasks/task-a', { shared: tokens.viewer });
  const reported = details.shifts.find((s) => s.id === firstShift.id);
  check(reported.acceptance.actor === first.account.name && reported.events.length === 2 && !reported.attendance.present && reported.reports.length === 1 && reported.status === 'done', 'Task details resolve acceptance, attendance and execution report');
  snapshot = await req(route, { shared: tokens.organizer });
  check(task().status === 'doing' && !task().lifecycle.events.length, 'Ending a reported shift never submits or accepts the task');

  const ref1 = await publish();
  const v1 = structuredClone(snapshot.doc.materials.proposal.deliveries[0]);
  await action('submit', { evidence: '选择 V1 作为本次实际交付', deliveries: [ref1] });
  const renamed = structuredClone(snapshot.doc); renamed.materials.proposal.title = '改名后的活动实施方案'; renamed.materials.proposal.sections[0].body = 'V2 新正文';
  await save(renamed);
  const ref2 = await publish();
  check(ref1.materialId === ref2.materialId && ref1.versionId !== ref2.versionId && JSON.stringify(snapshot.doc.materials.proposal.deliveries[0]) === JSON.stringify(v1), 'Rename and delivery updates keep material identity and V1 immutable');
  await action('approve', { note: '核验选择的 V1' }, 200, owner.token, tokens.organizer);
  check(task().status === 'accepted' && task().lifecycle.events.at(-1).deliveries[0].versionId === ref1.versionId && task().lifecycle.events.at(-1).actor.personId === roster.me.id, 'Acceptance binds the submitted V1 and real reviewer even after V2 publication');
  const tampered = structuredClone(snapshot.doc); tampered.materials.proposal.deliveries[0].snapshot.material.sections[0].body = '篡改验收版本'; await save(tampered, 422);
  const changedPerson = structuredClone(snapshot.doc); changedPerson.wbs[0].responsiblePersonId = people[0].id; await save(changedPerson, 422);
  await action('reject', { note: '改用新版本重新核验' }, 200, owner.token, tokens.organizer);
  await action('submit', { evidence: '实际交付更新到 V2，附首版对照', deliveries: [ref2, ref1] });
  await action('approve', { note: 'V2 验收通过' }, 200, owner.token, tokens.organizer);
  check(task().lifecycle.events.filter((e) => e.kind === 'approve').map((e) => e.deliveries[0].versionId).join(',') === `${ref1.versionId},${ref2.versionId}`, 'Resubmission preserves both acceptance histories and their exact versions');
  check(task().lifecycle.events.at(-1).deliveries.length === 2, 'A submission and acceptance can bind several explicitly selected real delivery versions');
  const imported = await req('/api/shared', { method: 'POST', expected: 201, body: { projectId: 'task-links-import', doc: snapshot.doc } });
  check(imported.doc.wbs[0].status === 'doing' && imported.doc.wbs[0].needsVerification && imported.doc.materials.proposal.deliveries.every((v) => v.origin === 'imported'), 'Imported records remain history and require new actual delivery confirmation');
  if (process.argv.includes('--browser')) {
    const require = createRequire(import.meta.url);
    const playwright = require(process.env.DEMO2_PLAYWRIGHT_PATH || 'playwright');
    browser = await playwright.chromium.launch({ headless: true, ...(process.env.DEMO2_BROWSER_PATH ? { executablePath: process.env.DEMO2_BROWSER_PATH } : {}) });
    const context = await browser.newContext();
    await context.addInitScript((token) => localStorage.setItem('demo2-staff-session', token), owner.token);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept('人工确认 V3'));
    await page.goto(`${base}/?share=${created.id}#token=${tokens.organizer}`);
    await page.waitForFunction(() => WB.personnel.snapshot?.manager && WB.store.state.view === 'overview' && !document.querySelector('#loginGate').classList.contains('is-open'));
    await page.evaluate(() => WB.gotoTarget({ view: 'tasks', taskView: 'table', phase: 'all' }));
    await page.evaluate(async () => {
      document.querySelector('[data-task-responsible="task-a"]').textContent = '旧姓名';
      await WB.personnel.refresh();
    });
    check((await page.locator('[data-task-responsible="task-a"]').innerText()).includes('责任人张三'), 'Roster refresh updates task responsibility without reopening task details');
    await page.locator('[data-task-assign="task-start"]').click();
    const schedule = page.locator('[data-personnel-form="shift"]');
    await schedule.locator('[name="title"]').fill('未提交的轮班草稿');
    await schedule.locator(`[name="personIds"][value="${people[0].id}"]`).check();
    const execution = page.locator('#taskAssignmentPanel [data-task-execution="task-start"]');
    check(await execution.locator('[data-task-action="start"]').isVisible(), 'Choosing assignment task exposes its start action above the personnel form');
    await execution.locator('[data-task-action="start"]').click();
    await page.waitForFunction(() => WB.store.state.wbs.find((t) => t.id === 'task-start').status === 'doing');
    check(await execution.locator('[data-task-action="submit"]').isVisible() && await schedule.locator('[name="title"]').inputValue() === '未提交的轮班草稿' && await schedule.locator('[name="personIds"]:checked').count() === 1, 'Execution widget advances to submission while preserving the unsaved scheduling draft');
    await execution.locator('[data-task-action="submit"]').click();
    await page.locator('#taskActionForm [name="evidence"]').waitFor();
    check(await page.locator('#taskActionForm [name="delivery"]').count() === 2, 'Visible submit action opens the existing actual-version selector without changing task status');
    await page.locator('[data-task-action-close]').click();
    await page.locator('[data-task-details-open="task-a"]').click();
    await page.locator('#taskActionPanel .task-linked-shifts .staff-shift').nth(2).waitFor();
    const detailText = await page.locator('#taskActionPanel').innerText();
    check(detailText.includes('实名责任人：责任人张三') && detailText.includes('执行人李四') && detailText.includes('执行人王五') && detailText.includes('班次工作已完成') && detailText.includes('验收人：责任人张三'), 'Task detail UI centrally displays responsibility, all performers, report and reviewer');
    check(detailText.includes('材料现名：改名后的活动实施方案') && detailText.includes('已有 V2，本次仍关联 V1'), 'Renamed material and newer delivery are shown without rebinding historical acceptance');
    check(await page.locator('#taskActionPanel .task-execution-guide [data-task-action="reject"]').isVisible(), 'Task details put applicable lifecycle actions above shift records');
    await page.locator('#taskActionPanel .task-version').first().locator('summary').click();
    const download = page.waitForEvent('download');
    await page.locator('#taskActionPanel .task-version').first().locator('[data-task-version-download]').click();
    check((await download).suggestedFilename().includes('MAT-proposal-V2'), 'Accepted snapshot is downloadable from task detail');
    await page.locator('#taskActionPanel [data-task-action-close]').click();
    await page.locator('[data-row-id="legacy"] [data-task-history]').click();
    await page.locator('#taskResponsibilityForm select option').filter({ hasText: '责任人张三' }).waitFor({ state: 'attached' });
    check((await page.locator('#taskActionPanel').innerText()).includes('本任务尚无实际交付关联，待补充'), 'Legacy task detail prompts for missing actual delivery');
    await page.locator('#taskResponsibilityForm select').selectOption(roster.me.id);
    await page.locator('#taskResponsibilityForm button').click();
    await page.waitForFunction((personId) => WB.store.state.wbs.find((t) => t.id === 'legacy').responsiblePersonId === personId && document.querySelector('#sharedBar').textContent.includes('已同步'), roster.me.id);
    check(true, 'Responsibility selector saves a real roster ID through the UI');
    await page.locator('#taskActionPanel [data-task-action-close]').click();
    await page.evaluate(() => WB.gotoTarget({ view: 'material' }));
    await page.locator('[data-material-publish="proposal"]').click();
    await page.waitForFunction(() => WB.store.state.materials.proposal.deliveries.length === 3);
    check(true, 'Material UI confirms a new immutable actual delivery version');
    await page.evaluate(() => WB.gotoTarget({ view: 'tasks', taskView: 'table', phase: 'all' }));
    await page.locator('[data-row-id="legacy"] [data-task-action="submit"]').click();
    const preview = page.locator('#taskActionForm .task-version').nth(2);
    await preview.locator('summary').click();
    check((await preview.innerText()).includes('V2 新正文'), 'Actual version content is inspectable before task submission');
    const previewDownload = page.waitForEvent('download');
    await preview.locator('[data-task-version-download]').click();
    await previewDownload;
    check(await page.evaluate(() => WB.store.state.wbs.find((t) => t.id === 'legacy').status === 'doing'), 'Downloading a version preview does not submit the task form');
    const choice = page.locator('#taskActionForm [name="delivery"]').nth(2);
    await choice.check();
    await page.locator('#taskActionForm [name="evidence"]').fill('补充实际交付 V3');
    await page.evaluate(() => WB.personnel.refresh());
    check(await choice.isChecked() && await page.locator('#taskActionForm [name="evidence"]').inputValue() === '补充实际交付 V3', 'Refreshing linked personnel preserves selected version and freeform delivery explanation');
    await page.locator('#taskActionForm button[type="submit"]').click();
    await page.waitForFunction(() => WB.store.state.wbs.find((t) => t.id === 'legacy').status === 'review');
    await page.locator('[data-row-id="legacy"] [data-task-action="approve"]').click();
    await page.locator('#taskActionForm [name="note"]').fill('已核验选择的 V3');
    await page.locator('#taskActionForm button[type="submit"]').click();
    await page.waitForFunction(() => WB.store.state.wbs.find((t) => t.id === 'legacy').status === 'accepted');
    check(await page.evaluate(() => WB.taskLifecycle.replay(WB.store.state.wbs.find((t) => t.id === 'legacy')).acceptance.deliveries[0].versionId === WB.store.state.materials.proposal.deliveries[2].id), 'Submit and approve UI bind the explicitly selected V3');
    await page.locator('[data-row-id="task-a"] [data-task-history]').click();
    await page.locator('#taskActionPanel .task-linked-shifts .staff-shift').nth(2).waitFor();
    await mkdir(path.join(root, 'generated'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'generated', 'qa-task-links.png'), fullPage: true });
    const memberContext = await browser.newContext();
    await memberContext.addInitScript((token) => localStorage.setItem('demo2-staff-session', token), first.token);
    const memberPage = await memberContext.newPage();
    memberPage.on('pageerror', (error) => errors.push(error.message));
    await memberPage.goto(`${base}/?share=${created.id}#token=${tokens.member}`);
    await memberPage.waitForFunction(() => WB.personnel.snapshot?.me && WB.store.state.view === 'overview' && !document.querySelector('#loginGate').classList.contains('is-open'));
    await memberPage.evaluate(() => WB.gotoTarget({ view: 'tasks', taskView: 'table', phase: 'all' }));
    check(!(await memberPage.locator('[data-task-responsible="task-a"]').innerText()).includes('关联失效'), 'A member-only roster is not mistaken for a complete roster with a missing responsible person');
    await memberPage.locator('[data-row-id="task-a"] [data-task-history]').click();
    await memberPage.locator('#taskActionPanel .task-linked-shifts .staff-shift').nth(2).waitFor();
    check((await memberPage.locator('#taskActionPanel').innerText()).includes('实名责任人：责任人张三'), 'Ordinary member can resolve the real responsible person and all shifts from task details');
    check(await memberPage.locator('#taskActionPanel .task-execution-guide [data-task-action="approve"], #taskActionPanel .task-execution-guide [data-task-action="reject"]').count() === 0, 'Member detail shortcut does not grant organizer acceptance actions');
    const legacyContext = await browser.newContext(), legacyPage = await legacyContext.newPage();
    legacyPage.on('pageerror', (error) => errors.push(error.message));
    await legacyPage.goto(`${base}/?share=${imported.id}#token=${imported.tokens.viewer}`);
    await legacyPage.waitForFunction(() => WB.sync.role === 'viewer');
    await legacyPage.locator('.local-demo-login summary').click();
    await legacyPage.locator('#loginSubmit').click();
    await legacyPage.evaluate(() => WB.gotoTarget({ view: 'tasks', taskView: 'table', phase: 'all' }));
    await legacyPage.locator('[data-row-id="task-a"] [data-task-history]').click();
    await legacyPage.waitForFunction(() => document.querySelector('#taskActionPanel').textContent.includes('实名责任人关联失效，待补充'));
    check(!(await legacyPage.locator('#taskActionPanel').innerText()).includes('正在读取人员与班次'), 'An imported responsible ID with an empty project roster is explicitly pending, never inferred from role text');
    check(errors.length === 0, `No browser runtime errors: ${errors.join('; ')}`);
  }
  console.log(`任务与实名人员、班次、交付版本关联验证：${checks} 项通过`);
} finally {
  await browser?.close();
  if (server.exitCode === null) { const stopped = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await stopped; }
  await rm(directory, { recursive: true, force: true });
}
