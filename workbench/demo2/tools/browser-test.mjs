#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { if (!process.env.DEMO2_PLAYWRIGHT_PATH) throw new Error('请设置 DEMO2_PLAYWRIGHT_PATH 为已安装的 playwright 目录。'); playwright = require(process.env.DEMO2_PLAYWRIGHT_PATH); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'demo2-browser-'));
const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, DEMO2_PORT: String(port), DEMO2_DATA_DIR: dataDir, DEMO2_HOST: '127.0.0.1' }, stdio: 'ignore', windowsHide: true });
let browser, checks = 0;
const errors = [];
function check(value, label) { assert.ok(value, label); checks++; }
const doc = JSON.parse(await readFile(path.join(root, 'samples/示例项目-校园科技文化节.json'), 'utf8'));
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.DEMO2_BROWSER_PATH ? { executablePath: process.env.DEMO2_BROWSER_PATH } : {}) });
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  const [owner, member, viewer] = pages;
  member.on('dialog', async (dialog) => dialog.accept());
  await owner.goto(base);
  await owner.waitForFunction(() => Boolean(window.WB?.gotoTarget));
  await owner.evaluate((doc) => { WB.store.setUser({ name: '负责人', role: 'organizer' }); WB.store.importBundle(doc); document.querySelector('#loginGate').classList.remove('is-open'); WB.gotoTarget({ view: 'projects' }); }, doc);
  let invitation = '';
  owner.on('dialog', async (dialog) => { if (dialog.type() === 'prompt') invitation = dialog.defaultValue(); await dialog.accept(); });
  await owner.locator('[data-shared-create]').click();
  await owner.waitForFunction(() => Boolean(WB.sync.role));
  for (let i = 0; i < 50 && !invitation; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  check(invitation.includes('token='), 'Owner creates an invitation from the UI');
  await member.goto(invitation);
  await member.waitForFunction(() => WB.sync.role === 'member' && WB.store.state.project);
  check(await member.evaluate(() => WB.store.projectName()) === doc.project.basic.name, 'Second browser opens shared data');
  await member.evaluate(() => { WB.store.state.project.basic.name = '多人协作修改'; WB.store.save(); });
  await member.waitForFunction(() => document.querySelector('#sharedBar').textContent.includes('已同步'));
  await owner.waitForFunction(() => WB.store.state.project.basic.name === '多人协作修改');
  check(true, 'Member edit automatically reaches owner');
  const credentials = await owner.evaluate(() => { const sessions = JSON.parse(localStorage.getItem('demo2-shared-sessions')); const id = WB.store.state.activeId; return { id, token: sessions[id].tokens.viewer }; });
  await viewer.goto(`${base}/?share=${credentials.id}#token=${credentials.token}`);
  await viewer.waitForFunction(() => WB.sync.role === 'viewer');
  check(await viewer.evaluate(() => !WB.util.canOperate()), 'Viewer role is enforced independently of local identity');
  await viewer.evaluate(() => WB.store.setUser({ name: '伪组织者', role: 'organizer' }));
  check(await viewer.evaluate(() => !WB.util.canOperate()), 'Local identity switch cannot promote a shared viewer');
  const conflicts = await Promise.all([owner, member].map((page, index) => page.evaluate(async (index) => {
    WB.store.state.project.basic.venue = `并发场地${index}`; WB.store.save(); await WB.sync.flush(); return document.querySelector('#sharedBar').innerText;
  }, index)));
  check(conflicts.filter((text) => text.includes('保存冲突')).length === 1, 'Real browser concurrent edit preserves one local draft');
  const losing = conflicts[0].includes('保存冲突') ? owner : member;
  await losing.locator('[data-shared-reload]').click();
  await losing.waitForFunction(() => !document.querySelector('#sharedBar').textContent.includes('保存冲突'));
  check(true, 'Conflict can be resolved from the UI');
  await member.route('**/api/shared/**', (route) => route.abort('failed'));
  await member.evaluate(async () => { WB.store.state.project.basic.note = '断网草稿必须保留'; WB.store.save(); await WB.sync.flush(); });
  await member.reload();
  await member.waitForFunction(() => WB.store.state.project?.basic?.note === '断网草稿必须保留');
  check(true, 'Failed sync and page reload preserve the local draft');
  await member.unroute('**/api/shared/**');
  await member.waitForFunction(() => document.querySelector('#sharedBar')?.textContent.includes('已同步'));
  await owner.waitForFunction(() => WB.store.state.project.basic.note === '断网草稿必须保留');
  check(true, 'Draft synchronizes after reconnecting');
  await owner.evaluate(() => { WB.store.state.signup.enabled = true; WB.gotoTarget({ view: 'signup' }); });
  await owner.evaluate(() => WB.views.signup.registerLink({ force: true }));
  const links = await owner.evaluate(() => ({ participant: WB.views.signup.linkFor().url, staff: WB.signup.linkFor(WB.store.state.signup, WB.store.state.signup.staffCode, WB.store.state.signup.base, { short: true }).url }));
  check(links.participant !== links.staff, 'Separate attendance links visible in real browser');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await mobileContext.newPage(); phone.on('response', async (r) => { if (r.url().includes('/api/signup/submit') && !r.ok()) console.error('提交失败', r.status(), await r.text()); }); phone.on('pageerror', (error) => errors.push(error.message));
  await phone.goto(links.participant);
  await phone.locator('#signupForm').waitFor();
  await phone.locator('[data-field="0"]').fill('测试同学');
  await phone.locator('[data-field="1"]').fill('20260001');
  const fields = await phone.evaluate(() => Array.from(document.querySelectorAll('[data-field]')).map((el) => ({ index: el.dataset.field, type: el.type, required: el.parentElement.innerText.includes('*') })));
  for (const field of fields) {
    if (field.index === '0' || field.index === '1') continue;
    const input = phone.locator(`[data-field="${field.index}"]`);
    if (field.type === 'tel') await input.fill('13800001234');
    else if (field.required) await input.fill('一班');
  }
  await phone.locator('#signupForm button[type="submit"]').click();
  await phone.getByText('已直达组织者电脑', { exact: false }).waitFor({ timeout: 10000 });
  await phone.locator('#checkin').click();
  await phone.getByText('已直达组织者电脑', { exact: false }).waitFor({ timeout: 10000 });
  check(await phone.locator('h1').innerText() === '已签到 · 当前在场', 'Phone check-in is confirmed');
  await phone.locator('#editMine').click();
  await phone.locator('[data-field="0"]').fill('修改姓名');
  await phone.locator('#signupForm button[type="submit"]').click();
  await phone.getByText('已直达组织者电脑', { exact: false }).waitFor({ timeout: 10000 });
  check(await phone.locator('h1').innerText() === '已签到 · 当前在场', 'Editing personal details preserves attendance');
  await phone.locator('#checkout').click();
  await phone.getByText('已直达组织者电脑', { exact: false }).waitFor({ timeout: 10000 });
  check(await phone.locator('h1').innerText() === '已签退', 'Phone checkout is confirmed');
  await owner.waitForFunction(() => WB.store.state.signup.records.some((r) => Object.values(r.values).includes('修改姓名') && r.checkoutAt));
  check(true, 'Organizer receives the full phone attendance lifecycle');
  await phone.reload();
  await phone.locator('#checkin').waitFor();
  check(await phone.locator('h1').innerText() === '已签退', 'Attendance remains on phone reload');
  await mkdir(path.join(root, 'generated'), { recursive: true });
  await phone.screenshot({ path: path.join(root, 'generated', 'qa-phone.png'), fullPage: true });

  const staffPhone = await mobileContext.newPage(); staffPhone.on('pageerror', (error) => errors.push(error.message));
  await staffPhone.goto(links.staff); await staffPhone.locator('#signupForm').waitFor();
  await staffPhone.locator('[data-field="0"]').fill('现场管理测试员');
  await staffPhone.locator('[data-field="1"]').fill('STAFF20260001');
  const staffFields = await staffPhone.evaluate(() => Array.from(document.querySelectorAll('[data-field]')).map((el) => ({ index: el.dataset.field, type: el.type, required: el.parentElement.innerText.includes('*') })));
  for (const field of staffFields) { if (field.index === '0' || field.index === '1') continue; const input = staffPhone.locator(`[data-field="${field.index}"]`); if (field.type === 'tel') await input.fill('13800005678'); else if (field.required) await input.fill('工作人员'); }
  await staffPhone.locator('#signupForm button[type="submit"]').click(); await staffPhone.getByText('已直达组织者电脑', { exact: false }).waitFor();
  await staffPhone.locator('#checkin').click(); await staffPhone.getByText('已直达组织者电脑', { exact: false }).waitFor();
  await owner.waitForFunction(() => WB.store.state.signup.records.some((r) => r.role === 'staff' && Object.values(r.values).includes('现场管理测试员') && r.checkinAt));
  check(true, 'Staff phone uses separate role and reaches organizer attendance');
  const staffIndex = await owner.evaluate(() => WB.store.state.signup.records.findIndex((r) => Object.values(r.values).includes('现场管理测试员')));
  const managerResponse = owner.waitForResponse((response) => response.url().includes('/api/signup/manage'));
  await owner.locator(`[data-signup-checkin="${staffIndex}"]`).click();
  check((await managerResponse).ok(), 'Manager checkout from real attendance table reaches server');
  await staffPhone.reload();
  await staffPhone.waitForFunction(() => document.querySelector('h1')?.textContent === '已签退');
  check(true, 'Phone reload reflects a manager checkout');

  await owner.evaluate(() => WB.gotoTarget({ view: 'workflow' }));
  await owner.locator('[data-flow-starter]').click();
  check(await owner.evaluate(() => WB.store.state.workflow.cards.some((c) => c.title === '参与者通知' && c.skill === 'promo-copy') && WB.store.state.workflow.cards.length >= 3 && WB.views.workflow.executionOrder().length >= 3), 'Starter workflow is executable');
  const cardId = await owner.evaluate(() => {
    const card = WB.store.state.workflow.cards.find((c) => c.skill === 'training-brief');
    card.output = { title: '现场简报', text: '## 岗位安排\n值班人员请提前到岗。', at: new Date().toISOString() }; return card.id;
  });
  await owner.evaluate((id) => WB.views.workflow.writeMaterial(id), cardId);
  check(await owner.evaluate(() => Object.values(WB.store.state.materials).some((m) => m.workflowCardId)), 'Workflow result enters process materials');
  await owner.screenshot({ path: path.join(root, 'generated', 'qa-workflow.png'), fullPage: true });
  await owner.evaluate(() => WB.gotoTarget({ view: 'assets' }));
  await owner.locator('[data-library-sample]').click();
  await owner.waitForFunction(() => WB.store.state.assets.some((a) => a.sampleKey === 'library-poster-v1'));
  check(await owner.evaluate(() => WB.library.list(WB.store.state.assets, 'knowledge').length === 4), 'Sample adds four classified knowledge records');
  await owner.locator('[data-library-sample]').click();
  check(await owner.evaluate(() => WB.store.state.assets.filter((a) => a.sampleKey).length === 7), 'Loading library sample twice creates no duplicates');
  check(await owner.locator('.asset-thumb').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), 'Sample SVG graphics load as images');
  await owner.locator('[data-library-tab="knowledge"]').click();
  check(await owner.evaluate(() => WB.library.context(WB.store.state.assets, 'knowledge').资料.length === 0), 'Teaching knowledge is not implicitly selected for AI');
  await owner.locator('[data-asset-text]').click();
  const kbIndex = await owner.evaluate(() => WB.store.state.assets.length - 1);
  const kb = owner.locator(`[data-asset="${kbIndex}"]`);
  await kb.locator('[data-asset-field="name"]').fill('课堂知识测试');
  await kb.locator('[data-asset-field="source"]').fill('小组核验的测试文件');
  await kb.locator('summary').click();
  await kb.locator('[data-asset-field="content"]').fill('来源正文：布置前先核对设备清单。');
  await kb.locator('[data-asset-field="status"]').selectOption('verified');
  await kb.locator('[data-asset-field="useForAi"]').check();
  check(await owner.evaluate(() => WB.library.context(WB.store.state.assets, 'knowledge').资料.some((a) => a.正文.includes('核对设备清单') && a.来源 === '小组核验的测试文件')), 'UI-edited, verified knowledge enters AI context with real body');
  const captured = await owner.evaluate(async () => {
    const aiRun = WB.ai.run;
    let input;
    WB.ai.run = async (_skill, data) => { input = data; return { title: '引用测试', sections: [{ heading: '正文', body: '引用结果' }] }; };
    try { await WB.views.material.generateOne('promoCopy', { silent: true }); } finally { WB.ai.run = aiRun; }
    return input;
  });
  check(captured.知识库.资料.some((a) => a.正文.includes('核对设备清单')) && captured.素材库.资料.some((a) => a.正文.includes('让创意走出纸面')), 'Material generation uses selected knowledge and actual copy text');
  let workflowRequest;
  await owner.route('**/api/material', async (route) => {
    workflowRequest = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { title: '知识引用', text: '依据课堂知识测试核对设备。' }, model: 'test' }) });
  });
  try {
    await owner.evaluate(async () => {
      const ready = WB.ai.ready; WB.ai.ready = true;
      try { const card = WB.views.workflow.addCard({ title: '知识引用测试', refs: ['knowledge', 'assets'] }); await WB.views.workflow.runCard(card.id); }
      finally { WB.ai.ready = ready; }
    });
  } finally { await owner.unroute('**/api/material'); }
  check(workflowRequest.input.引用资料.知识库.资料.some((a) => a.正文.includes('核对设备清单')), 'Workflow request contains selected knowledge body');
  await owner.evaluate(() => WB.gotoTarget({ view: 'assets' }));
  await kb.locator('summary').click();
  await kb.locator('[data-asset-field="content"]').fill('正文发生变更，需要重新核验。');
  check(await kb.locator('[data-asset-field="status"]').inputValue() === 'pending' && !(await kb.locator('[data-asset-field="useForAi"]').isChecked()), 'Editing verified knowledge withdraws its confirmation and AI selection');
  await owner.locator('#assetFile').setInputFiles({ name: '导入规范.md', mimeType: 'text/markdown', buffer: Buffer.from('# 导入资料\n这是待核验的测试正文。') });
  await owner.waitForFunction(() => WB.store.state.assets.some((a) => a.name === '导入规范'));
  check(await owner.evaluate(() => WB.store.state.assets.find((a) => a.name === '导入规范').status === 'pending'), 'Imported text starts pending and excluded from AI');
  await owner.locator('#assetFile').setInputFiles(path.join(root, 'samples/示例-学院活动策划书模板.docx'));
  await owner.waitForFunction(() => WB.store.state.assets.some((a) => a.collection === 'knowledge' && a.originalName?.endsWith('.docx')));
  check(await owner.evaluate(() => WB.store.state.assets.some((a) => a.collection === 'knowledge' && a.originalName?.endsWith('.docx') && a.content.length > 100)), 'Knowledge import extracts actual DOCX text');
  await owner.locator('[data-library-search]').fill('导入规范');
  check(await owner.locator('.library-card').count() === 1, 'Knowledge search filters by name and body');
  await owner.locator('[data-library-search]').fill('');
  await owner.screenshot({ path: path.join(root, 'generated', 'qa-library.png'), fullPage: true });
  await owner.locator('[data-library-tab="assets"]').click();
  await owner.locator('#assetFile').setInputFiles({ name: '测试附件.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.0 test attachment') });
  const fileIndex = await owner.evaluate(() => WB.store.state.assets.findIndex((a) => a.originalName === '测试附件.pdf'));
  const downloadEvent = owner.waitForEvent('download');
  await owner.locator(`[data-asset-download="${fileIndex}"]`).click();
  check((await downloadEvent).suggestedFilename() === '测试附件.pdf', 'Small attachment original is retained and downloadable');
  await member.waitForFunction(() => WB.store.state.assets.some((a) => a.name === '课堂知识测试'));
  check(true, 'Knowledge data synchronizes to another browser');
  await viewer.evaluate(() => WB.gotoTarget({ view: 'assets' }));
  await viewer.locator('[data-library-tab="knowledge"]').click();
  check(await viewer.locator('[data-asset-text]').isDisabled() && await viewer.locator('[data-library-search]').isEnabled(), 'Shared viewer can search and switch libraries, with write controls disabled');
  check(await viewer.evaluate(() => { const count = WB.store.state.assets.length; return WB.views.assets.addAsset({ name: '非法', kind: 'text' }) === false && WB.store.state.assets.length === count; }), 'Shared viewer cannot bypass library UI permissions');
  check(errors.length === 0, `No browser errors: ${errors.join('; ')}`);
  console.log(`真实浏览器测试：${checks} 项通过（独立负责人 / 成员 / 访客 / 手机会话）`);
} finally {
  await browser?.close();
  if (server.exitCode === null) { const ended = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await ended; }
  await rm(dataDir, { recursive: true, force: true });
}
