/* Shared snapshots with revision checks; every edit remains a local draft. */
window.WB = window.WB || {};
(function () {
  const store = () => window.WB.store, key = 'demo2-shared-sessions';
  let sessions = {}, active = null, baseline = '', busy = false, applying = false, timer = 0, message = '', conflict = false;
  try { sessions = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* local fallback */ }
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(sessions)); } catch { window.WB.toast?.('共享凭据未能保存在本机，请保留邀请链接。'); } };
  const documentOf = () => {
    const { format, version, exportedAt, ui, ...doc } = store().exportBundle();
    if (doc.signup) doc.signup = { ...doc.signup, applied: 0, serverCursor: 0 };
    return JSON.parse(JSON.stringify(doc));
  };
  const signature = (text) => { let a = 2166136261, b = 5381; for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); } return `${text.length}:${a >>> 0}:${b >>> 0}`; };
  const serialize = () => signature(JSON.stringify(documentOf()));
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    if (!window.location?.href) return nativeFetch(input, options);
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    const session = sessions[store().state.activeId];
    if (session && url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const headers = new Headers(options.headers || (typeof input !== 'string' ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${session.token}`); headers.set('X-Project-Id', store().state.activeId);
      options = { ...options, headers };
    }
    return nativeFetch(input, options);
  };
  async function api(id, options = {}) {
    const response = await nativeFetch(`/api/shared/${encodeURIComponent(id)}`, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessions[id].token}`, 'X-Project-Id': id } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '共享服务不可用'), { status: response.status });
    return data;
  }
  function show(text) { message = text; renderBar(); }
  function renderBar() {
    let bar = document.getElementById('sharedBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'sharedBar'; document.body.prepend(bar); }
    bar.className = 'shared-bar';
    const session = sessions[store().state.activeId]; bar.hidden = !session;
    if (session) bar.innerHTML = `<span>共享项目 · ${window.WB.util.roleLabel(session.role)} · 版本 ${session.revision || 1} · ${window.WB.util.escapeHtml(message || '正在连接…')}</span><button data-shared-save>立即同步</button><button data-shared-draft>下载本机草稿</button>${conflict ? '<button data-shared-reload>载入共享最新版本</button>' : ''}<button data-shared-leave>切为本机副本</button>`;
  }
  function markBaseline(content) { baseline = content; sessions[active].baseline = content; persist(); }
  function apply(data, keepCursor = true) {
    applying = true;
    try {
      const cursor = keepCursor ? store().state.signup?.serverCursor || 0 : 0, applied = keepCursor ? store().state.signup?.applied || 0 : 0;
      store().replace(data.doc); store().state.signup.serverCursor = cursor; store().state.signup.applied = applied;
      store().state.user ||= { name: '协作成员', role: data.role }; store().state.user.role = data.role;
      Object.assign(sessions[data.id], { revision: data.revision, role: data.role });
      active = data.id; markBaseline(serialize()); conflict = false; store().save();
    } finally { applying = false; }
    show('已同步'); window.WB.renderAll?.();
  }
  async function connect(id) {
    active = id; baseline = ''; conflict = false;
    try { apply(await api(id)); } catch (error) { show(error.message); }
  }
  async function flush() {
    const id = store().state.activeId, session = sessions[id];
    if (!session || busy || conflict || active !== id || !baseline) return;
    const doc = documentOf(), content = signature(JSON.stringify(doc));
    if (content === baseline) { show('已同步'); return; }
    if (session.role === 'viewer') { show('只读共享'); return; }
    busy = true; show('正在保存…');
    try {
      const data = await api(id, { method: 'PUT', body: JSON.stringify({ revision: session.revision, doc }) });
      if (store().state.activeId !== id) return;
      session.revision = data.revision; markBaseline(content); show('已同步');
    } catch (error) { conflict = error.status === 409; show(conflict ? '保存冲突：本机草稿已保留，请下载后载入最新版本' : `同步失败：${error.message}；草稿已存本机`); }
    finally { busy = false; }
  }
  function onSave() {
    if (applying) return;
    clearTimeout(timer);
    if (sessions[store().state.activeId] && active === store().state.activeId) {
      if (baseline && serialize() !== baseline) show('本机已保存 · 等待同步');
      timer = setTimeout(flush, 650);
    }
  }
  function controls() {
    const session = sessions[store().state.activeId];
    return session ? `<button class="button button-ghost" data-shared-invite>复制协作链接</button>${session.role === 'organizer' ? '<button class="button button-ghost" data-shared-rotate>重置成员邀请</button>' : ''}` : '<button class="button button-ghost" data-shared-create data-write>开启多人共享</button>';
  }
  function invite(role = 'member') {
    const id = store().state.activeId, s = sessions[id];
    const url = new URL('/', store().state.signup?.base || location.origin);
    url.searchParams.set('share', id); url.hash = `token=${encodeURIComponent(s.tokens?.[role] || s.token)}`;
    window.prompt(`${role === 'viewer' ? '只读' : '协作'}邀请链接（手机请使用公网或局域网地址）`, url.href);
  }
  async function init() {
    if (!window.location?.href) return;
    const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.slice(1));
    const id = query.get('share'), token = hash.get('token');
    if (id && token) { sessions[id] = { ...sessions[id], token }; persist(); history.replaceState(null, '', `${location.pathname}?share=${encodeURIComponent(id)}`); }
    if (id && sessions[id]) {
      try {
        const data = await api(id);
        applying = true; if (store().state.activeId) store().save();
        const existed = store().state.projects.some((p) => p.id === id);
        if (existed && store().state.activeId !== id) store().switchProject(id);
        if (!existed) store().state.projects.unshift({ id, name: data.doc.project?.basic?.name || '共享项目' });
        store().state.activeId = id; active = id; applying = false;
        // Restore offline drafts instead of replacing them on page reload.
        if (existed && sessions[id].baseline && serialize() !== sessions[id].baseline) { baseline = sessions[id].baseline; show('已恢复本机未同步草稿'); }
        else apply(data, false);
      } catch (error) { applying = false; show(error.message); window.WB.toast?.(error.message); }
    } else if (sessions[store().state.activeId]) { active = store().state.activeId; baseline = sessions[active].baseline || serialize(); show('共享连接已恢复'); }
    document.addEventListener('click', async (event) => {
      const el = event.target.closest('[data-shared-create],[data-shared-invite],[data-shared-rotate],[data-shared-save],[data-shared-draft],[data-shared-reload],[data-shared-leave]');
      if (!el) return;
      try {
        if (el.hasAttribute('data-shared-create')) {
          if (!window.WB.util.canManage() || !store().state.project) throw new Error('请由活动组织者先建立项目再开启共享。');
          const response = await nativeFetch('/api/shared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: store().state.activeId, doc: documentOf() }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || '当前站点没有共享服务，请使用 Node 服务启动。');
          if (data.id !== store().state.activeId) throw new Error('项目已共享，请用原组织者浏览器打开。');
          sessions[data.id] = { token: data.tokens.organizer, tokens: data.tokens, role: 'organizer', revision: data.revision };
          active = data.id; markBaseline(serialize()); show('共享已开启'); window.WB.renderAll?.(); invite();
        }
        if (el.hasAttribute('data-shared-invite')) { const s = sessions[store().state.activeId]; invite(s.tokens ? (confirm('确定：复制可编辑协作链接；取消：复制只读链接。') ? 'member' : 'viewer') : (s.role === 'viewer' ? 'viewer' : 'member')); }
        if (el.hasAttribute('data-shared-rotate')) {
          if (!confirm('重置后原成员和访客链接立即失效，继续？')) return;
          sessions[store().state.activeId].tokens = (await api(store().state.activeId, { method: 'POST' })).tokens; persist(); invite();
        }
        if (el.hasAttribute('data-shared-save')) await flush();
        if (el.hasAttribute('data-shared-draft')) window.WB.util.downloadText(`${window.WB.util.safeFileName(store().projectName())}-本机草稿.json`, JSON.stringify(store().exportBundle(), null, 2), 'application/json');
        if (el.hasAttribute('data-shared-reload') && confirm('先下载本机草稿；载入最新版本会替换本机当前内容，继续？')) await connect(store().state.activeId);
        if (el.hasAttribute('data-shared-leave')) { await flush(); if (!confirm('将当前内容复制为独立的本机项目；原共享项目和邀请凭据继续保留，确定？')) return; store().duplicateProject(store().state.activeId); active = null; history.replaceState(null, '', location.pathname); renderBar(); window.WB.renderAll?.(); }
      } catch (error) { window.WB.toast?.(error.message); }
    });
    setInterval(async () => {
      const id = store().state.activeId;
      if (!sessions[id]) { renderBar(); return; }
      if (active !== id) { active = id; baseline = sessions[id].baseline || serialize(); conflict = false; }
      if (busy || conflict || !baseline) return;
      if (serialize() !== baseline) { await flush(); return; }
      if (document.activeElement?.matches('input,textarea,select,[contenteditable="true"]') || window.WB.ai.busy || window.WB.views.workflow?.busy) return;
      busy = true;
      try { const data = await api(id); if (id === store().state.activeId && data.revision !== sessions[id].revision && serialize() === baseline) apply(data); }
      catch (error) { show(`连接中断：${error.message}；本机数据保留`); }
      finally { busy = false; }
    }, 2500);
  }
  window.WB.sync = { init, onSave, controls, flush, get role() { return sessions[store().state.activeId]?.role || ''; } };
}());
