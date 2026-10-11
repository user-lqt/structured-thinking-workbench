import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';

const fail = (status, error) => { throw Object.assign(new Error(error), { status }); };
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const secret = () => randomBytes(24).toString('base64url');
const hash = (v) => createHash('sha256').update(v).digest('hex');
const instant = (value) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const overlap = (a, b) => instant(a.start) < instant(b.end) && instant(b.start) < instant(a.end);
const publicAccount = (a) => ({ id: a.id, username: a.username, name: a.name, profile: a.profile || profileOf({ name: a.name }), workspace: a.workspace || 'organizer' });
const profileOf = (raw) => ({ name: str(raw.name, 60), phone: str(raw.phone, 30), department: str(raw.department), skills: str(raw.skills, 500), availability: str(raw.availability, 500) });
export function attendance(shift, now = Date.now()) {
  let start = null, completedMs = 0;
  for (const event of shift.events || []) {
    if (event.kind === 'checkin' && start === null) start = Date.parse(event.at);
    if (event.kind === 'checkout' && start !== null) { completedMs += Math.max(0, Date.parse(event.at) - start); start = null; }
  }
  return { present: start !== null, completedMs, liveMs: start === null ? 0 : Math.max(0, now - start) };
}

// Authoritative account and duty records; shared document PUT never overwrites these files.
export function personnelService(directory, shared) {
  mkdirSync(directory, { recursive: true });
  const accountFile = path.join(directory, 'accounts.json');
  const readAccounts = () => existsSync(accountFile) ? JSON.parse(readFileSync(accountFile, 'utf8')) : { accounts: [], sessions: {} };
  const write = (file, data) => { writeFileSync(`${file}.tmp`, JSON.stringify(data)); renameSync(`${file}.tmp`, file); };
  const fileOf = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id || '') ? path.join(directory, `project-${id}.json`) : null;
  const read = (id) => { const f = fileOf(id); return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const allProjects = () => readdirSync(directory).filter((f) => /^project-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(directory, f), 'utf8')));
  const save = (row) => { row.revision++; row.updatedAt = new Date().toISOString(); write(fileOf(row.id), row); };
  function accountProfile(account, profile) {
    const db = readAccounts(), stored = db.accounts.find((a) => a.id === account.id);
    Object.assign(stored, { name: profile.name, profile }); Object.assign(account, { name: profile.name, profile }); write(accountFile, db);
  }
  function syncProfile(row, account) {
    const me = memberOf(row, account);
    if (me && account.profile && Object.keys(account.profile).some((key) => me[key] !== account.profile[key])) {
      Object.assign(me, account.profile); audit(row, account, 'profile', '打开项目时同步本人账号资料'); save(row);
    }
  }
  const limits = new Map();
  function limit(key, max = 12) {
    const now = Date.now(), entry = limits.get(key);
    if (entry && now - entry.at < 60000 && entry.count >= max) fail(429, '尝试过于频繁，请稍后重试。');
    if (!entry || now - entry.at >= 60000) limits.set(key, { at: now, count: 1 }); else entry.count++;
    if (limits.size > 5000) for (const [k, v] of limits) if (now - v.at > 60000) limits.delete(k);
  }
  function authenticate(req) {
    const token = str(req.headers['x-staff-session'], 150);
    const db = readAccounts(), session = db.sessions[hash(token)];
    const account = session && session.expires > Date.now() ? db.accounts.find((a) => a.id === session.id) : null;
    if (!account) fail(401, '请登录服务人员账号。');
    return account;
  }
  const memberOf = (row, account) => row.people.find((p) => p.accountId === account.id);
  const managerOf = (row, account) => { const p = memberOf(row, account); return p?.status === 'active' && ['organizer', 'manager'].includes(p.role); };
  const requireManager = (row, account) => { if (!managerOf(row, account)) fail(403, '只有本项目已授权的负责人可以管理人员和排班。'); };
  function audit(row, account, action, detail) { row.log.unshift({ at: new Date().toISOString(), actorId: account.id, actor: account.name, action, detail }); row.log = row.log.slice(0, 1000); }
  function catalogue(account) {
    return allProjects()
      .filter((row) => row.open || memberOf(row, account)).map((row) => ({ id: row.id, name: shared.read(row.id)?.doc?.project?.basic?.name || row.name, open: row.open, membership: memberOf(row, account)?.status || '', role: memberOf(row, account)?.role || '' }));
  }
  function view(row, account) {
    const manager = managerOf(row, account), me = memberOf(row, account);
    if (!me) fail(403, '请先申请加入项目。');
    const doc = shared.read(row.id)?.doc || {};
    const shifts = (manager ? row.shifts : row.shifts.filter((s) => s.personId === me.id)).map((s) => {
      const task = doc.wbs?.find((t) => t.id === s.taskId);
      return { ...s, attendance: attendance(s), taskName: task?.task || s.taskName,
        taskState: task ? { status: task.status, blocked: task.blocked, blockReason: task.blockReason, needsVerification: task.needsVerification } : null };
    });
    return { id: row.id, name: doc.project?.basic?.name || row.name, revision: row.revision, me, manager, open: row.open,
      people: manager ? row.people : [me], shifts,
      ...(manager ? { joinCode: row.joinCode, tasks: (doc.wbs || []).map((t) => ({ id: t.id, name: t.task, phase: t.phase, owner: t.owner, status: t.status })), resources: doc.resources || [], log: row.log } : {}) };
  }
  // Build against existing and staged reservations; save only after the whole group passes.
  function buildShift(row, body, existing, planned, doc, crossProjects) {
    const person = row.people.find((p) => p.id === body.personId);
    if (person?.status !== 'active') fail(422, '请选择已确认的服务人员。');
    const start = instant(body.start), end = instant(body.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 24 * 3600000) fail(422, '班次须包含时区，结束晚于开始，单班不超过 24 小时。');
    const task = (doc.wbs || []).find((t) => t.id === body.taskId);
    if (!task) fail(422, '请关联全周期任务中的一项有效任务。');
    const next = { id: existing?.id || randomUUID(), personId: person.id, taskId: task.id, taskName: task.task,
      title: str(body.title) || task.task, location: str(body.location), instructions: str(body.instructions, 2000), start: new Date(start).toISOString(), end: new Date(end).toISOString(), requiredSkills: str(body.requiredSkills), resources: [], status: 'assigned', events: [], requests: [] };
    const other = planned.filter((s) => s.id !== next.id && s.status !== 'cancelled');
    if (other.some((s) => s.personId === next.personId && overlap(next, s))) fail(409, '该人员在此时间已有班次，请调整排班。');
    if (crossProjects.some((p) => p.id !== row.id && p.shifts.some((s) => s.status !== 'cancelled' && p.people.find((m) => m.id === s.personId)?.accountId === person.accountId && overlap(next, s)))) fail(409, '该人员在另一个项目已有同时段班次。');
    const seen = new Set();
    for (const item of Array.isArray(body.resources) ? body.resources : []) {
      const resource = (doc.resources || []).find((r) => r.id === item.id), quantity = Number(item.quantity);
      if (!resource || resource.kind === 'staff' || !Number.isFinite(quantity) || quantity <= 0 || seen.has(item.id)) fail(422, '资源或数量无效，请从资源台账选择。');
      if (['维修中', '报废'].includes(resource.condition)) fail(422, `「${resource.name}」当前不可用。`);
      seen.add(item.id); const capacity = Math.max(0, Number(resource.available) - Number(resource.loaned || 0));
      // Check peak concurrent reservation, rather than summing sequential shifts.
      const marks = [{ at: start, delta: quantity }, { at: end, delta: -quantity }];
      for (const s of other.filter((s) => overlap(next, s))) for (const r of s.resources || []) if (r.id === item.id) { marks.push({ at: Math.max(start, instant(s.start)), delta: r.quantity }, { at: Math.min(end, instant(s.end)), delta: -r.quantity }); }
      marks.sort((a, b) => a.at - b.at || a.delta - b.delta); let reserved = 0;
      for (const mark of marks) { reserved += mark.delta; if (reserved > capacity) fail(409, `「${resource.name}」同一时段超出可用资源，请调整数量或时间。`); }
      next.resources.push({ id: resource.id, name: resource.name, unit: resource.unit, quantity });
    }
    if (next.requiredSkills && !next.requiredSkills.split(/[、,，\s]+/).filter(Boolean).every((skill) => String(person.skills || '').toLowerCase().includes(skill.toLowerCase()))) fail(422, '该人员登记的技能不满足要求，请调整人员或技能要求。');
    return next;
  }
  async function handle(req, url, body, ip) {
    const route = url.pathname.slice('/api/personnel'.length);
    const method = req.method;
    const projectId = route.match(/^\/projects\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || str(body.projectId, 64);
    if (method === 'POST' && projectId && shared.auth(req, projectId)?.role === 'viewer') fail(403, '只读邀请不能修改人员、班次或示例数据。');
    if (route === '/register' || route === '/login') {
      if (method !== 'POST') fail(405, '仅支持 POST。');
      limit(`${ip}:auth:${str(body.username).toLowerCase()}`);
      limit(`${ip}:auth`, 300);
      const username = str(body.username, 60).toLowerCase(), password = String(body.password || '');
      if (!/^[a-z0-9_.-]{3,60}$/.test(username) || password.length < 8 || password.length > 128) fail(422, '账号使用 3–60 位字母、数字或 _.-；密码为 8–128 位。');
      const db = readAccounts(); let account = db.accounts.find((a) => a.username === username);
      if (route === '/register') {
        if (account) fail(409, '账号已存在，请直接登录。');
        if (!str(body.name, 60)) fail(422, '请填写姓名。');
        const salt = secret(); account = { id: randomUUID(), username, name: str(body.name, 60), profile: profileOf({ ...body, ...body.profile, name: body.profile?.name || body.name }), workspace: body.workspace === 'volunteer' ? 'volunteer' : 'organizer', salt, password: scryptSync(password, salt, 64).toString('hex') }; db.accounts.push(account);
      } else if (!account || !timingSafeEqual(scryptSync(password, account.salt, 64), Buffer.from(account.password, 'hex'))) fail(401, '账号或密码错误。');
      const token = secret();
      for (const [key, session] of Object.entries(db.sessions)) if (session.expires <= Date.now()) delete db.sessions[key];
      db.sessions[hash(token)] = { id: account.id, expires: Date.now() + 7 * 86400000 };
      write(accountFile, db); return { token, account: publicAccount(account) };
    }
    const account = authenticate(req);
    if (route === '/me' && method === 'GET') return { account: publicAccount(account), projects: catalogue(account) };
    if (route === '/profile' && method === 'POST') {
      const profile = profileOf(body.profile || {}); if (!profile.name) fail(422, '请填写姓名。');
      accountProfile(account, profile); return { account: publicAccount(account), projects: catalogue(account) };
    }
    if (route === '/logout' && method === 'POST') { const db = readAccounts(); delete db.sessions[hash(str(req.headers['x-staff-session'], 150))]; write(accountFile, db); return { ok: true }; }
    if (route === '/projects' && method === 'POST') {
      const id = str(body.projectId, 64);
      const auth = shared.auth({ headers: { authorization: `Bearer ${str(body.ownerToken, 150)}` } }, id);
      if (auth?.role !== 'organizer') fail(403, '需要原项目组织者的共享凭据开通人员管理。');
      let row = read(id);
      if (row && !managerOf(row, account)) fail(403, '人员管理已由其他账号开通，请由项目负责人授权。');
      if (!row) {
        const profile = profileOf({ ...account.profile, ...body.profile, name: body.profile?.name || account.name });
        if (body.profile) accountProfile(account, profile);
        row = { id, name: auth.row.doc?.project?.basic?.name || '活动项目', ownerId: account.id, revision: 0, open: true, joinCode: randomBytes(6).toString('hex'), people: [{ id: randomUUID(), accountId: account.id, username: account.username, ...profile, role: 'organizer', status: 'active', joinedAt: new Date().toISOString() }], shifts: [], log: [] };
        audit(row, account, 'publish', '开通项目人员管理并登记负责人'); save(row);
      }
      syncProfile(row, account);
      return view(row, account);
    }
    const match = route.match(/^\/projects\/([A-Za-z0-9_-]+)(?:\/(enter|join|profile|people|shifts|event|settings|samples))?$/);
    if (!match) fail(404, '人员管理路径不存在。');
    const row = read(match[1]); if (!row) fail(404, '项目尚未开通人员管理。');
    const action = match[2];
    if (!action && method === 'GET') return view(row, account);
    if (method !== 'POST') fail(405, '仅支持 POST。');
    if (action === 'join' || action === 'enter') {
      if (memberOf(row, account)) { if (action === 'enter') syncProfile(row, account); return view(row, account); }
      limit(`${ip}:join:${account.id}`);
      let invited = false;
      if (action === 'enter' && body.accessToken) invited = Boolean(shared.auth({ headers: { authorization: `Bearer ${str(body.accessToken, 150)}` } }, row.id));
      if (!row.open || (!invited && str(body.code).toLowerCase() !== row.joinCode)) fail(403, '首次打开需要有效加入码或项目邀请；项目关闭时不能新增人员。');
      const profile = profileOf(action === 'enter' ? account.profile || { name: account.name } : { ...account.profile, ...body.profile }); if (!profile.name) fail(422, '请填写姓名。');
      row.people.push({ id: randomUUID(), accountId: account.id, username: account.username, ...profile, role: 'volunteer', status: 'pending', joinedAt: new Date().toISOString() });
      audit(row, account, 'join', '申请加入项目'); save(row); return view(row, account);
    }
    const me = memberOf(row, account); if (!me) fail(403, '尚未加入项目。');
    if (action === 'profile') {
      const profile = profileOf(body.profile || {}); if (!profile.name) fail(422, '请填写姓名。');
      accountProfile(account, profile); Object.assign(me, profile); audit(row, account, 'profile', '更新本人服务资料'); save(row); return view(row, account);
    }
    if (action === 'event') {
      const shift = row.shifts.find((s) => s.id === body.shiftId); if (!shift) fail(404, '班次不存在。');
      if (shift.personId !== me.id && !managerOf(row, account)) fail(403, '只能操作自己的班次。');
      const person = row.people.find((p) => p.id === shift.personId), present = attendance(shift).present;
      if (['checkin', 'accept'].includes(body.kind) && person?.status !== 'active') fail(403, '服务资格尚未确认或已停用。');
      const requestId = str(body.requestId, 100); if (!requestId) fail(422, '缺少操作编号。');
      if (shift.requests?.some((r) => r.id === requestId && r.actorId === account.id)) return view(row, account);
      if (!['accept', 'done', 'checkin', 'checkout'].includes(body.kind)) fail(422, '未知班次动作。');
      if (body.kind === 'accept') { if (shift.status === 'cancelled' || shift.status === 'done') fail(409, '班次已经结束。'); shift.status = 'accepted'; shift.acceptance ||= { at: new Date().toISOString(), actorId: account.id, actor: account.name, by: person?.sample ? '示例演示（管理者操作）' : shift.personId === me.id ? '本人' : '管理者代接受' }; }
      if (body.kind === 'done') {
        if (present || shift.status === 'cancelled' || shift.status === 'done' && shift.reports?.length) fail(409, '请先签退，已报告或取消的班次不能重复结束。');
        if (!str(body.report, 4000)) fail(422, '请填写班次执行报告：完成事项、交接与遗留问题。');
        shift.reports ||= [];
        shift.reports.push({ id: randomUUID(), at: new Date().toISOString(), actorId: account.id, actor: account.name, text: str(body.report, 4000), ...(person?.sample ? { sample: true } : {}) });
        shift.status = 'done';
      }
      if (body.kind === 'checkin') {
        if (shift.status === 'cancelled' || shift.status === 'done') fail(409, '班次已经结束。');
        if (present) return view(row, account);
        if (row.shifts.some((s) => s.personId === shift.personId && attendance(s).present)) fail(409, '已有另一个班次在场，请先签退。');
        if (allProjects().some((p) => p.id !== row.id && p.shifts.some((s) => p.people.find((m) => m.id === s.personId)?.accountId === person.accountId && attendance(s).present))) fail(409, '该人员在另一个项目仍未签退。');
      }
      if (body.kind === 'checkout' && !present) fail(409, '尚未签到或已经签退。');
      if (['checkin', 'checkout'].includes(body.kind)) shift.events.push({ kind: body.kind, at: new Date().toISOString(), actorId: account.id, actor: account.name, by: person?.sample ? '示例演示（管理者操作）' : shift.personId === me.id ? '本人' : '管理者代打卡' });
      shift.requests ||= []; shift.requests.push({ id: requestId, actorId: account.id });
      audit(row, account, body.kind, `${person?.name || ''} · ${shift.title}`); save(row); return view(row, account);
    }
    requireManager(row, account);
    if (action === 'samples') {
      if (body.revision !== row.revision) fail(409, '人员安排已改变，请刷新后重新提交。');
      if (body.mode === 'remove-unused') {
        const used = new Set([...row.shifts.map((s) => s.personId), ...(shared.read(row.id)?.doc.wbs || []).map((t) => t.responsiblePersonId)]);
        const before = row.people.length;
        row.people = row.people.filter((p) => !p.sample || used.has(p.id));
        if (row.people.length !== before) { audit(row, account, 'samples', `移除 ${before - row.people.length} 名未排班示例人员，保留已有安排与记录`); save(row); }
        return view(row, account);
      }
      if (body.mode && body.mode !== 'load') fail(422, '示例人员操作无效。');
      const examples = [
        ['林晨', '协调组', '协调 引导 排班'], ['陈雨', '签到组', '签到 引导 信息录入'],
        ['王可', '宣传组', '宣传 引导 文案'], ['李言', '影像组', '摄影 引导 视频'],
        ['周宁', '后勤组', '物资 引导 搬运'], ['赵晴', '接待组', '接待 引导 沟通'],
        ['孙悦', '主持组', '主持 引导 控场'], ['吴辰', '技术组', '设备 引导 音响'],
        ['郑禾', '财务组', '预算 引导 票据'], ['许安', '保障组', '应急 引导 秩序维护']
      ];
      let added = 0;
      for (const [index, [name, department, skills]] of examples.entries()) {
        const sampleKey = `staff-example-${index + 1}`;
        if (row.people.some((p) => p.sample && p.sampleKey === sampleKey)) continue;
        row.people.push({ id: randomUUID(), accountId: `sample:${row.id}:${sampleKey}`, username: `demo-${String(index + 1).padStart(2, '0')}`, name: `${name}（示例）`, phone: '', department: `示例·${department}`, skills, availability: '活动当天 08:00–20:00（示例，排班前核对）', role: 'volunteer', status: 'active', sample: true, sampleKey, joinedAt: new Date().toISOString() });
        added++;
      }
      if (added) { audit(row, account, 'samples', `载入 ${added} 名示例服务人员（用于演示排班与模拟考勤，无登录账号）`); save(row); }
      return view(row, account);
    }
    if (action === 'settings') {
      if (typeof body.open === 'boolean') row.open = body.open;
      if (body.rotate) row.joinCode = randomBytes(6).toString('hex');
      audit(row, account, 'settings', '更新加入设置'); save(row); return view(row, account);
    }
    if (action === 'people') {
      const person = row.people.find((p) => p.id === body.personId); if (!person) fail(404, '人员不存在。');
      if (person.accountId === row.ownerId) fail(409, '项目负责人身份不能移除。');
      if (body.role && me.accountId !== row.ownerId) fail(403, '只有项目原负责人可以授权管理者。');
      if (person.sample && body.role === 'manager') fail(422, '示例人员用于演示排班，不能获得管理权限。');
      if (body.role && !['manager', 'volunteer'].includes(body.role)) fail(422, '身份无效。');
      if (body.status && !['active', 'inactive'].includes(body.status)) fail(422, '人员状态无效。');
      if (body.role) person.role = body.role;
      if (body.status) person.status = body.status;
      audit(row, account, 'people', `调整 ${person.name} 的资格或身份`); save(row); return view(row, account);
    }
    if (action === 'shifts') {
      if (body.revision !== row.revision) fail(409, '人员安排已改变，请刷新后重新提交。');
      const existing = body.id && row.shifts.find((s) => s.id === body.id);
      if (body.id && !existing) fail(404, '班次不存在。');
      if (body.cancel) { if (!existing || attendance(existing).present) fail(409, '请先签退再取消班次。'); existing.status = 'cancelled'; audit(row, account, 'cancel', existing.title); save(row); return view(row, account); }
      if (existing?.events.length || existing?.acceptance || existing?.reports?.length) fail(409, '已有打卡流水的班次不可改写，请保留记录并另建班次。');
      const ids = body.personIds === undefined ? [body.personId] : body.personIds;
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail(422, '请选择 1–100 名服务人员，同一人员不能重复选择。');
      if (existing && ids.length !== 1) fail(422, '已有班次只能单独修改，多人安排请新建班次。');
      const doc = shared.read(row.id)?.doc || {}, crossProjects = allProjects();
      const staged = [];
      for (const personId of ids) {
        try { staged.push(buildShift(row, { ...body, personId }, existing, [...row.shifts, ...staged], doc, crossProjects)); }
        catch (error) { if (ids.length > 1) error.message = `${row.people.find((p) => p.id === personId)?.name || '所选人员'}：${error.message}本次多人安排尚未保存。`; throw error; }
      }
      if (existing) Object.assign(existing, staged[0]); else row.shifts.push(...staged);
      audit(row, account, 'shift', `安排 ${ids.length} 人 · ${staged[0].title} · ${ids.map((id) => row.people.find((p) => p.id === id).name).join('、')}`); save(row); return view(row, account);
    }
    fail(404, '未知操作。');
  }
  const people = (id) => (read(id)?.people || []).map(({ id, name, role, status, sample }) => ({ id, name, role, status, ...(sample ? { sample: true } : {}) }));
  function actor(req, id, manage = false) {
    const account = authenticate(req), row = read(id), me = row && memberOf(row, account);
    if (!me || me.status !== 'active') fail(403, '请先加入项目并由负责人确认资格。');
    if (manage) requireManager(row, account);
    return { id: account.id, personId: me.id, name: me.name };
  }
  function details(id, taskId) {
    const row = read(id);
    return { people: people(id), shifts: (row?.shifts || []).filter((s) => s.taskId === taskId).map((s) => ({ ...s, attendance: attendance(s) })), personnelRevision: row?.revision || 0 };
  }
  return { handle, people, actor, details };
}
