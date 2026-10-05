/* 参与者信息收集：可选能力。管理者自定义字段 → 得到填写页链接与二维码 → 现场随时提交、实时汇总。
   同源实时同步靠 append-only 队列（localStorage）+ storage 事件；跨设备靠「回执码」或 CSV 带回来。
   数据在 state.signup 里，随项目包一起导出；关掉开关只是不显示收集入口，已收记录不丢。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const S = window.WB.signup;
  const { $, escapeHtml, fmtDateTime } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;
  const signup = () => state().signup;

  let previewOpen = false;
  let codeOpen = false;
  let pollTimer = 0;

  const save = () => {
    const current = signup();
    current.updatedAt = new Date().toISOString();
    store().save();
  };

  const projectId = () => state().activeId || 'draft';
  const fillHint = () => `带 <b>*</b> 的必填；改字段不用重发链接，但二维码里的表单定义会跟着变，所以改完最好重新扫一次。`;

  /* 填写链接：本机服务在线时用「短码模式」——二维码里只放 4 位短码，表单定义由
     server.mjs 提供，手机提交直接落盘到工作台（隧道 / 局域网都走这条路）。
     服务不在（例如纯静态托管）时退回原来的写法：把表单定义一起塞进链接。 */
  const linkOf = (current) => (current.linkCode
    ? S.linkFor(current, current.linkCode, current.base, { short: true })
    : S.linkFor(current, projectId(), current.base));

  /* ── ① 开关与预设 ─────────────────────── */

  function heroHtml(current) {
    const tally = S.stats(current);
    const status = !current.enabled
      ? '现在是关闭状态：这一页不产生任何数据。校内小活动（班级报名、社团招募、现场签到）需要收集参与者信息时再开。'
      : tally.total
        ? `已收到 ${tally.total} 份，其中 ${tally.checkins} 人已签到；${tally.dupeRecords ? `有 ${tally.dupeRecords} 条「${escapeHtml(tally.keyLabel || '')}」重复，需要核对；` : ''}表格会随现场提交自动更新。`
        : '已开启，还没有收到提交。把二维码或链接发出去，现场提交会实时出现在下面的表格里。';
    return `<div class="card signup-hero">
      <div class="signup-hero-main">
        <div class="eyebrow">可选能力 · 校内小活动常用</div>
        <h3>参与者信息收集</h3>
        <p class="signup-sub">活动当天让参与者用手机扫码自己填：<b>字段由你定</b>，提交随时进表（现场也能补登、改错），管理者可实时看到汇总。</p>
        <p class="signup-hint">${status}</p>
      </div>
      <div class="signup-hero-side">
        ${current.enabled
          ? '<button class="button button-ghost" data-signup-disable data-write>关闭收集</button>'
          : '<button class="button button-primary" data-signup-enable data-write>开启收集</button>'}
      </div>
    </div>`;
  }

  function fieldsHtml(current) {
    const preset = S.PRESETS.find((item) => item.id === current.preset);
    return `<div class="card">
      <div class="card-title"><h3>① 要收集哪些信息</h3><small>字段由你定；改完点「重新生成二维码」</small></div>
      <div class="seg-switch signup-presets">
        ${S.PRESETS.map((item) => `<button class="${current.preset === item.id ? 'is-active' : ''}" data-signup-preset="${item.id}" data-write>${escapeHtml(item.label)}</button>`).join('')}
      </div>
      <p class="signup-hint">${preset ? escapeHtml(preset.hint) : '当前是自定义字段。选一个预设会覆盖下面的字段表（已收记录不受影响）。'}</p>
      <div class="signup-table-wrap">
        <table class="signup-table">
          <thead><tr><th class="col-idx">#</th><th>字段名</th><th>类型</th><th class="col-req">必填</th><th>选项（用 / 分隔）</th><th class="col-key">去重</th><th class="col-act"></th></tr></thead>
          <tbody>${current.fields.map((field, index) => fieldRow(current, field, index)).join('')}</tbody>
        </table>
      </div>
      <div class="assets-toolbar" style="margin-top:12px">
        <button class="button button-ghost" data-signup-add data-write>＋ 添加字段</button>
        <span class="signup-hint">最多 ${S.MAX_FIELDS} 个字段。字段名与选项越短，二维码越容易装下。</span>
      </div>
    </div>`;
  }

  function fieldRow(current, field, index) {
    const isKey = field.id === current.keyField;
    return `<tr data-signup-row="${index}">
      <td class="col-idx">${index + 1}</td>
      <td><input data-signup-field="label" data-signup-at="${index}" value="${escapeHtml(field.label)}" placeholder="如：班级" data-write /></td>
      <td><select data-signup-field="type" data-signup-at="${index}" data-write>
        ${Object.entries(S.TYPE_LABEL).map(([value, label]) => `<option value="${value}" ${field.type === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></td>
      <td class="col-req"><input type="checkbox" data-signup-field="required" data-signup-at="${index}" ${field.required ? 'checked' : ''} data-write /></td>
      <td>${field.type === 'select'
        ? `<input data-signup-field="options" data-signup-at="${index}" value="${escapeHtml(field.options.join(' / '))}" placeholder="选项一 / 选项二" data-write />`
        : '<span class="signup-hint">—</span>'}</td>
      <td class="col-key"><button class="chip ${isKey ? 'chip-ok' : ''}" data-signup-key="${index}" data-write title="用这个字段判断重复报名">${isKey ? '按此去重' : '设为去重'}</button></td>
      <td class="col-act">
        <button class="quiet-icon" data-signup-move="${index}" data-signup-delta="-1" data-write title="上移">↑</button>
        <button class="quiet-icon" data-signup-move="${index}" data-signup-delta="1" data-write title="下移">↓</button>
        <button class="row-remove" data-signup-remove-field="${index}" data-write title="删除字段">×</button>
      </td>
    </tr>`;
  }

  /* ── ② 填写页与二维码 ─────────────────── */

  function channelsHtml(current) {
    const link = linkOf(current);
    const svg = link.fits ? S.qrSvg(link.url, { scale: 5 }) : null;
    const usage = `${link.bytes} / ${link.limit} 字节`;
    const direct = link.level === 'short'
      ? `<p class="signup-hint">已连上本机服务：二维码只带 4 位短码 <b>${escapeHtml(current.linkCode || '')}</b>，表单定义由电脑按码提供。手机提交后 2–3 秒自动进表，<b>不用再发回执码</b>（手机端仍会显示回执码，作为备份 / 改错用）。</p>`
      : link.withId ? '' : '<p class="signup-hint">链接里放不下项目号（表单较长）：本机「内置预览 / 另一个标签页」提交会实时进表；手机在别的设备上填写时，请让参与者把<b>回执码</b>发回来。</p>';
    const qrBlock = svg
      ? `<div class="signup-qr">${svg}</div>${direct}`
      : `<div class="signup-qr is-over"><b>二维码装不下这么多字段</b>
          <p class="signup-hint">链接需要 ${usage}（含表单定义）。要点：字段名短一点、少用「选项」列表，或改用下面的<b>表单码</b>让参与者粘贴一次。</p>
          <p class="signup-hint">已保留短链接：${escapeHtml(link.url)}</p>
        </div>`;
    return `<div class="card">
      <div class="card-title"><h3>② 填写页与二维码</h3><small>${link.fits ? `链接 ${usage}` : `需要 ${usage}`}</small></div>
      <div class="signup-grid">
        <div class="signup-channel">
          ${qrBlock}
          <div class="assets-toolbar">
            <button class="button button-ghost" data-signup-view-link data-write>复制填写链接</button>
            <button class="button button-ghost" data-signup-download-qr data-write>下载二维码 SVG</button>
            <button class="button button-ghost" data-signup-view-page>打开填写页</button>
            <button class="button ${previewOpen ? 'button-primary' : 'button-ghost'}" data-signup-view-preview>${previewOpen ? '关闭内置预览' : '内置预览'}</button>
          </div>
        </div>
        <div class="signup-channel">
          <label class="signup-label"><span>访问地址（手机扫码要用它）</span>
            <input data-signup-base value="${escapeHtml(current.base)}" placeholder="${escapeHtml(S.pageUrl('').replace(/\/signup\.html$/, ''))}" data-write />
          </label>
          <p class="signup-hint">留空就按<b>当前网址</b>生成（本地打开、静态托管、换端口都不用改；示例项目就是留空的）。要让手机扫码填写，两条路：<br /><b>公网（推荐 · cloudflared 隧道）</b>：另开一个窗口跑 <code>cloudflared tunnel --url http://127.0.0.1:4175</code>，把打印出来的 <code>https://xxx.trycloudflare.com</code> 填到这里，再点「重新生成二维码」。隧道只放行填写页 / 取表单 / 提交三条路，工作台与 AI 接口仍只允许本机；地址是公开的，演示完 Ctrl+C 关掉即可。<br /><b>局域网 / 热点</b>：<code>$env:DEMO2_HOST='0.0.0.0'; node workbench/demo2/server.mjs</code>，把启动日志里那条（形如 <code>http://192.168.1.5:4175</code>）填到这里；首次要在防火墙放行该端口（命令见 README「扫码填写怎么开」）。<br />两条路下<b>手机提交都会直接进表</b>（2–3 秒轮询一次）；服务不在（纯静态托管）时自动退回「回执码 / CSV」方式，链接改为自带表单定义。</p>
          <details ${codeOpen ? 'open' : ''} data-signup-code-box>
            <summary>表单码（跨设备用：粘贴一次即可）</summary>
            <p class="signup-hint">手机不是本机时，链接里会带上表单定义；万一二维码装不下，把下面这段发给参与者，在填写页「组织者：粘贴表单码」里粘一次即可。</p>
            <textarea class="signup-code" rows="3" readonly>${escapeHtml(link.code)}</textarea>
            <div class="assets-toolbar"><button class="button button-ghost" data-signup-view-code data-write>复制表单码</button></div>
          </details>
        </div>
      </div>
      ${previewOpen ? `<div class="signup-preview-wrap"><iframe class="signup-preview" src="${escapeHtml(link.url)}" title="填写页预览"></iframe><p class="signup-hint">这是填写页本身（不是模拟）：在这里提交，下面的汇总会立刻更新。</p></div>` : ''}
    </div>`;
  }

  /* ── ③ 实时汇总 ───────────────────────── */

  function liveHtml(current) {
    const tally = S.stats(current);
    const queued = S.readQueue(projectId()).length;
    const pending = Math.max(0, queued - (current.applied || 0));
    return `<div class="card">
      <div class="card-title"><h3>③ 实时汇总</h3><small>${pending ? `有 ${pending} 条新提交待同步` : '已同步到最新'}</small></div>
      <div class="stats-row">
        <div class="stat stat-accent"><span class="stat-label">已收到</span><span class="stat-value">${tally.total}<small>份</small></span></div>
        <div class="stat"><span class="stat-label">现场签到</span><span class="stat-value">${tally.checkins}<small>人</small></span></div>
        <div class="stat ${tally.dupeRecords ? 'stat-warn' : 'stat-muted'}"><span class="stat-label">重复${tally.keyLabel ? `（按${escapeHtml(tally.keyLabel)}）` : ''}</span><span class="stat-value">${tally.dupeRecords}<small>条</small></span></div>
        <div class="stat stat-muted"><span class="stat-label">必填完整率</span><span class="stat-value">${tally.complete}<small>%</small></span></div>
      </div>
      <div class="assets-toolbar">
        <button class="button button-primary" data-signup-sync data-write>同步最新提交</button>
        <button class="button button-ghost" data-signup-clear-queue data-write>清空同步队列（${queued}）</button>
        <button class="button button-ghost" data-signup-add-row data-write>＋ 现场补登一行</button>
        <span class="signup-hint">同一个浏览器里有人提交时会自动进来；这是兜底按钮。</span>
      </div>
    </div>`;
  }

  /* ── ④ 记录表 ─────────────────────────── */

  function recordsHtml(current) {
    const tally = S.stats(current);
    if (!current.records.length) {
      return `<div class="card"><div class="card-title"><h3>④ 参与者明细</h3><small>0 条</small></div>
        <div class="empty"><strong>还没有收到提交</strong>把二维码发出去，或者点「现场补登一行」手动登记；也可以把手机带回来的回执码 / CSV 导进来。</div>
        ${importHtml(current)}</div>`;
    }
    const dupes = S.dupeValues(current);
    const key = current.fields.find((field) => field.id === current.keyField);
    const body = current.records.map((record, index) => {
      const keyValue = key ? U.text(record.values[key.id]) : '';
      const dupe = keyValue && dupes.has(keyValue);
      return `<tr data-signup-record-row="${index}" class="${dupe ? 'is-dupe' : ''}">
        <td class="col-idx">${index + 1}</td>
        <td class="col-time">${escapeHtml(fmtDateTime(record.at))}</td>
        <td><span class="chip">${escapeHtml(S.SOURCE_LABEL[record.source] || record.source)}</span>${record.schemaChanged ? ' <span class="chip chip-over" title="提交时的表单结构和现在不一样，请核对">结构已变</span>' : ''}${dupe ? ` <span class="chip chip-over">重复 ${escapeHtml(keyValue)}</span>` : ''}</td>
        ${current.fields.map((field) => `<td>${cellHtml(current, record, index, field)}</td>`).join('')}
        <td class="col-checkin">${record.checkinAt
          ? `<button class="chip chip-ok" data-signup-checkin="${index}" data-write title="取消签到">已签到</button>`
          : `<button class="chip" data-signup-checkin="${index}" data-write title="标记为已到场">签到</button>`}</td>
        <td class="col-act"><button class="row-remove" data-signup-remove="${index}" data-write title="删除这一条">×</button></td>
      </tr>`;
    }).join('');
    return `<div class="card">
      <div class="card-title"><h3>④ 参与者明细</h3><small>${tally.total} 条 · 表格里的内容可直接改（组织者可代为修正）</small></div>
      <div class="signup-table-wrap">
        <table class="signup-table signup-records">
          <thead><tr><th class="col-idx">#</th><th class="col-time">提交时间</th><th>来源</th>${current.fields.map((field) => `<th>${escapeHtml(field.label)}${field.required ? ' <b>*</b>' : ''}</th>`).join('')}<th class="col-checkin">签到</th><th class="col-act"></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${importHtml(current)}
    </div>`;
  }

  function cellHtml(current, record, index, field) {
    const value = U.text(record.values[field.id]);
    if (field.type === 'select' && field.options.length) {
      return `<select class="signup-cell" data-signup-record="${index}" data-signup-cell="${field.id}" data-write>
        <option value="">—</option>
        ${field.options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
      </select>`;
    }
    if (field.type === 'checkbox') {
      return `<input type="checkbox" data-signup-record="${index}" data-signup-cell="${field.id}" ${value === '是' ? 'checked' : ''} data-write />`;
    }
    return `<input class="signup-cell" data-signup-record="${index}" data-signup-cell="${field.id}" value="${escapeHtml(value)}" data-write />`;
  }

  function importHtml(current) {
    return `<div class="signup-import">
      <div class="card-title"><h4>导入 / 导出</h4></div>
      <div class="signup-grid">
        <div>
          <p class="signup-hint">手机不在同一台电脑时，参与者提交后能拿到「回执码」；把它们一行一条贴进来即可（重复导入同一条不会翻倍）。也可以直接贴一份带表头的 CSV 名单。</p>
          <textarea class="signup-code" rows="3" data-signup-receipts placeholder="R1|s|… 一行一条；或贴 CSV"></textarea>
          <div class="assets-toolbar">
            <button class="button button-primary" data-signup-import data-write>导入</button>
            <button class="button button-ghost" data-signup-import-file data-write>选择文件（CSV / JSON）</button>
          </div>
        </div>
        <div>
          <p class="signup-hint">导出可用 Excel 直接打开（CSV 带 BOM），或整表贴进材料里。</p>
          <div class="assets-toolbar">
            <button class="button button-ghost" data-signup-export-csv>导出 CSV（Excel）</button>
            <button class="button button-ghost" data-signup-export-md>导出 Markdown</button>
            <button class="button button-ghost" data-signup-export-json>导出 JSON（含回执）</button>
          </div>
          <p class="signup-hint">想让 AI 写的《报名表 / 签到表》直接引用这批数据，去「过程材料」生成即可——参与者信息已经作为上下文传进去了。</p>
        </div>
      </div>
    </div>`;
  }

  function render() {
    const body = $('#signupBody');
    if (!body) return;
    const current = signup();
    if (!current) { body.innerHTML = '<div class="card"><div class="empty">该项目还没有参与者信息收集数据。</div></div>'; return; }
    /* 表单定义同步到本机存储：这样短链接（#p=…）在同一浏览器里也能打开正式表单 */
    S.storeForm(current, projectId());
    body.innerHTML = current.enabled
      ? `${heroHtml(current)}${fieldsHtml(current)}${channelsHtml(current)}${liveHtml(current)}${recordsHtml(current)}`
      : `${heroHtml(current)}${current.records.length ? recordsHtml(current) : ''}`;
    const summary = $('#signupSummary');
    if (summary) {
      summary.textContent = current.enabled
        ? `已开启 · 字段 ${current.fields.length} 个 · 已收到 ${current.records.length} 份 · 已签到 ${current.records.filter((record) => record.checkinAt).length} 人`
        : '可选能力：关闭时不产生任何数据；需要收集参与者信息时点「开启收集」。';
    }
  }

  /* ── 同步队列 ─────────────────────────── */

  function pullQueue(options = {}) {
    const current = signup();
    if (!current || !current.enabled) return null;
    const result = S.syncFromQueue(current, projectId());
    if (!result || !(result.added || result.updated || result.checkin)) return result;
    save();
    window.WB.renderPanelsMeta?.();
    if (options.render !== false) render();
    if (options.announce) {
      const parts = [];
      if (result.added) parts.push(`新提交 ${result.added} 份`);
      if (result.checkin) parts.push(`签到 ${result.checkin} 人`);
      if (result.stale) parts.push(`${result.stale} 条字段结构已变`);
      window.WB.toast(parts.length ? `已同步：${parts.join('，')}` : '已同步');
    }
    return result;
  }
  window.WB.signupPull = () => pullQueue({ announce: true, render: true });

  /* ── 手机直传：登记短码 + 按游标拉增量 ─────────
     登记：把项目号与「打包好的表单定义」交给本机服务，换一个 4 位短码。
     拉取：服务把手机提交的回执码按行存着，这里按 since 游标取新的那批，
           折进表格走的是 mergeEvents（按记录 id 幂等），重复拉不会翻倍。 */

  /* 要不要去服务端登记短码：还没登记过，或表单改过（登记过一次之后就不再重复发） */
  function needRegister(current) {
    return Boolean(current && current.enabled && (!current.linkCode || current.linkFp !== S.fingerprint(current)));
  }

  async function registerLink(options = {}) {
    const current = signup();
    if (!current || !current.enabled) return null;
    const schema = S.packSchema(current, 'full');
    const fingerprint = S.fingerprint(current);
    if (current.linkCode && current.linkFp === fingerprint && !options.force) return current.linkCode;
    try {
      const res = await fetch('/api/signup/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: projectId(), schema, fingerprint })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.code) return null;
      const changed = current.linkCode !== data.code;
      current.linkCode = data.code;
      current.linkFp = fingerprint;
      save();
      if ((changed || options.force) && options.render !== false) render();
      return data.code;
    } catch { return null; }
  }

  async function pullServer(options = {}) {
    const current = signup();
    if (!current || !current.enabled || !current.linkCode) return null;
    const since = Math.max(0, Number(current.serverCursor) || 0);
    try {
      const res = await fetch(`/api/signup/queue?project=${encodeURIComponent(projectId())}&since=${since}`);
      if (!res.ok) return null;
      const data = await res.json();
      const records = Array.isArray(data && data.records) ? data.records : [];
      const total = Number(data && data.total);
      const moved = Number.isFinite(total) && total !== since;
      if (Number.isFinite(total)) current.serverCursor = Math.max(since, total);
      if (!records.length) {
        if (moved) save();
        return null;
      }
      const result = S.mergeEvents(current, records, { source: 'link' });
      save();
      if (options.render !== false) render();
      window.WB.renderPanelsMeta?.();
      if (options.announce) window.WB.toast(`手机直传：新收 ${result.added + result.updated} 条`);
      return result;
    } catch { return null; }
  }

  function readFileText() {
    const input = $('#signupFile');
    if (input) input.click();
  }

  function importText(raw) {
    const current = signup();
    const source = U.text(raw);
    if (!source) return;
    const lines = S.parseLines(source);
    const receipts = lines.filter((line) => line.startsWith(`${S.RECEIPT_VERSION}|`));
    if (receipts.length) {
      const result = S.mergeEvents(current, receipts, { source: 'import' });
      save();
      render();
      window.WB.renderPanelsMeta?.();
      window.WB.toast(`导入回执 ${result.added + result.updated} 条${result.stale ? `，其中 ${result.stale} 条表单结构已变请核对` : ''}${result.ignored ? `，${result.ignored} 条读不出来` : ''}`);
      return;
    }
    if (/[,，\t]/.test(source)) {
      const result = S.parseCsv(current, source.replace(/，/g, ','));
      save();
      render();
      window.WB.renderPanelsMeta?.();
      window.WB.toast(result.added ? `按表头导入 ${result.added} 条` : '没读到可导入的行：请带上表头（字段名）或先核对列名');
      return;
    }
    window.WB.toast('没有认出内容：回执码以 R1| 开头，CSV 需要表头');
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const trimmed = raw.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed);
          const list = Array.isArray(data) ? data : (data.receipts || data.records || []);
          if (list.length && typeof list[0] === 'string') { importText(list.join('\n')); return; }
          const current = signup();
          let added = 0;
          for (const item of list) {
            const values = Array.isArray(item)
              ? item
              : (Array.isArray(item.values) ? item.values : current.fields.map((field) => item[field.label] ?? item[field.id] ?? ''));
            if (!values.some((value) => U.text(value))) continue;
            S.addRecord(current, values, 'import');
            added += 1;
          }
          save();
          render();
          window.WB.renderPanelsMeta?.();
          window.WB.toast(added ? `导入 ${added} 条` : '文件里没有可导入的记录');
        } catch (error) {
          window.WB.toast(`JSON 读不了：${error.message}`);
        }
        return;
      }
      importText(raw);
    };
    reader.onerror = () => window.WB.toast('文件读取失败');
    reader.readAsText(file, 'utf-8');
  }

  /* ── 事件 ─────────────────────────────── */

  function mount() {
    const panel = $('#signupPanel');
    const fileInput = $('#signupFile');
    if (!panel) return;

    panel.addEventListener('click', (event) => {
      const el = event.target.closest('[data-signup-enable],[data-signup-disable],[data-signup-preset],[data-signup-add],[data-signup-move],[data-signup-remove-field],[data-signup-key],[data-signup-view-link],[data-signup-download-qr],[data-signup-view-page],[data-signup-view-preview],[data-signup-view-code],[data-signup-sync],[data-signup-clear-queue],[data-signup-add-row],[data-signup-checkin],[data-signup-remove],[data-signup-import],[data-signup-import-file],[data-signup-export-csv],[data-signup-export-md],[data-signup-export-json]');
      if (!el) return;
      const current = signup();
      const name = U.safeFileName(store().projectName());
      const on = (attribute) => el.hasAttribute(attribute) || el.closest(`[${attribute}]`) === el;

      if (on('data-signup-enable')) {
        current.enabled = true;
        if (!current.fields.length) S.applyPreset(current, 'minimal');
        save();
        render();
        /* 立刻登记短码：本机服务在时，二维码里只带 4 位码，手机提交才认得出是哪个项目 */
        registerLink({ render: true });
        window.WB.toast('已开启参与者信息收集：把二维码或链接发出去即可');
        return;
      }
      if (on('data-signup-disable')) {
        current.enabled = false;
        save();
        render();
        window.WB.toast('已关闭收集入口，已收到的记录仍然保留');
        return;
      }
      const preset = el.dataset.signupPreset;
      if (preset) {
        if (!confirm(`换成「${S.PRESETS.find((item) => item.id === preset)?.label}」会覆盖当前字段表（已收到的记录不受影响），继续？`)) return;
        S.applyPreset(current, preset);
        save();
        render();
        return;
      }
      if (on('data-signup-add')) {
        if (!S.addField(current, { label: `字段 ${current.fields.length + 1}` })) { window.WB.toast(`最多 ${S.MAX_FIELDS} 个字段`); return; }
        save();
        render();
        return;
      }
      const move = el.dataset.signupMove;
      if (move != null && el.dataset.signupDelta) {
        if (!S.moveField(current, Number(move), Number(el.dataset.signupDelta))) return;
        save();
        render();
        return;
      }
      const removeField = el.dataset.signupRemoveField;
      if (removeField != null) {
        const field = current.fields[Number(removeField)];
        if (!field) return;
        if (!confirm(`删除字段「${field.label}」？已收到记录里这一列的值会隐藏（不删除原始数据）。`)) return;
        S.removeField(current, Number(removeField));
        save();
        render();
        return;
      }
      const key = el.dataset.signupKey;
      if (key != null) {
        const field = current.fields[Number(key)];
        if (!field) return;
        current.keyField = current.keyField === field.id ? '' : field.id;
        save();
        render();
        return;
      }
      if (on('data-signup-view-link')) {
        const link = linkOf(current);
        copy(link.url, '填写链接已复制');
        return;
      }
      if (on('data-signup-download-qr')) {
        const link = linkOf(current);
        const svg = S.qrSvg(link.url, { scale: 8, margin: 4 });
        if (!svg) { window.WB.toast('字段太多，链接超过二维码容量：请改用表单码'); return; }
        U.downloadText(`${name}-参与者填写二维码.svg`, svg, 'image/svg+xml;charset=utf-8');
        return;
      }
      if (on('data-signup-view-page')) {
        const link = linkOf(current);
        window.open(link.url, '_blank', 'noreferrer');
        return;
      }
      if (on('data-signup-view-preview')) {
        previewOpen = !previewOpen;
        render();
        return;
      }
      if (on('data-signup-view-code')) {
        const link = linkOf(current);
        copy(link.code, '表单码已复制');
        return;
      }
      if (on('data-signup-sync')) {
        pullQueue({ announce: true });
        pullServer({ announce: true });
        return;
      }
      if (on('data-signup-clear-queue')) {
        if (!confirm('清空同步队列？已折叠进表格的记录不受影响。')) return;
        S.clearQueue(projectId());
        current.applied = 0;
        save();
        render();
        window.WB.toast('同步队列已清空');
        return;
      }
      if (on('data-signup-add-row')) {
        S.addRecord(current, current.fields.map(() => ''), 'manual');
        save();
        render();
        window.WB.toast('已补登一行，直接在表格里填即可');
        return;
      }
      const checkin = el.dataset.signupCheckin;
      if (checkin != null) {
        const record = current.records[Number(checkin)];
        if (!record) return;
        S.toggleCheckin(current, record.id);
        save();
        render();
        return;
      }
      const remove = el.dataset.signupRemove;
      if (remove != null) {
        const record = current.records[Number(remove)];
        if (!record) return;
        if (!confirm('删除这一条参与者记录？')) return;
        S.removeRecord(current, record.id);
        save();
        render();
        window.WB.renderPanelsMeta?.();
        return;
      }
      if (on('data-signup-import')) {
        importText($('[data-signup-receipts]')?.value || '');
        const box = $('[data-signup-receipts]');
        if (box) box.value = '';
        return;
      }
      if (on('data-signup-import-file')) { readFileText(); return; }
      if (on('data-signup-export-csv')) {
        if (!current.records.length) { window.WB.toast('还没有记录'); return; }
        U.downloadText(`${name}-参与者信息.csv`, `\ufeff${S.toCsv(current)}`, 'text/csv;charset=utf-8');
        return;
      }
      if (on('data-signup-export-md')) {
        if (!current.records.length) { window.WB.toast('还没有记录'); return; }
        U.downloadText(`${name}-参与者信息.md`, `# ${store().projectName()} · 参与者信息\n\n${S.toMarkdown(current)}\n`);
        return;
      }
      if (on('data-signup-export-json')) {
        const payload = {
          format: 'structured-activity-workbench-signup',
          version: 1,
          exportedAt: new Date().toISOString(),
          fields: current.fields,
          keyField: current.keyField,
          receipts: current.records.map((record) => S.packReceipt({
            kind: 'submit', id: record.id, at: record.at, h: S.fingerprint(current), values: S.fieldsToValues(current, record)
          })),
          records: current.records
        };
        U.downloadText(`${name}-参与者信息.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
      }
    });

    /* 字段表：文本类即时改，类型/必填/选项改完重绘 */
    panel.addEventListener('input', (event) => {
      const el = event.target.closest('[data-signup-field]');
      const base = event.target.closest('[data-signup-base]');
      if (base) { signup().base = base.value.trim(); save(); return; }
      if (!el) return;
      const current = signup();
      const field = current.fields[Number(el.dataset.signupAt)];
      if (!field) return;
      const kind = el.dataset.signupField;
      if (kind === 'label') field.label = el.value;
      else if (kind === 'options') field.options = el.value.split(/[\/、|]/).map((item) => U.text(item)).filter(Boolean).slice(0, S.MAX_OPTIONS);
      else if (kind === 'required') field.required = el.checked;
      save();
    });

    panel.addEventListener('change', (event) => {
      const el = event.target.closest('[data-signup-field]');
      if (el && (el.dataset.signupField === 'label' || el.dataset.signupField === 'options')) {
        save();
        render();
        return;
      }
      if (el && el.dataset.signupField === 'type') {
        const current = signup();
        const field = current.fields[Number(el.dataset.signupAt)];
        if (!field) return;
        field.type = el.value;
        if (field.type !== 'select') field.options = [];
        save();
        render();
        return;
      }
      const recordCell = event.target.closest('[data-signup-record][data-signup-cell]');
      if (recordCell) {
        const current = signup();
        const record = current.records[Number(recordCell.dataset.signupRecord)];
        if (!record) return;
        record.values[recordCell.dataset.signupCell] = recordCell.type === 'checkbox' ? (recordCell.checked ? '是' : '') : recordCell.value;
        save();
        return;
      }
      const base = event.target.closest('[data-signup-base]');
      if (base) { signup().base = base.value.trim(); save(); render(); }
    });

    /* 记录表里的文本单元格直接改内容（不重绘，免得焦点丢失） */
    panel.addEventListener('input', (event) => {
      const cell = event.target.closest('[data-signup-record][data-signup-cell]');
      if (!cell) return;
      const current = signup();
      const record = current.records[Number(cell.dataset.signupRecord)];
      if (!record) return;
      record.values[cell.dataset.signupCell] = cell.type === 'checkbox' ? (cell.checked ? '是' : '') : cell.value;
      save();
    });

    if (fileInput) {
      fileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        handleFile(file);
      });
    }

    /* 同源实时同步：别的标签页/内置预览里提交，这里立刻能看到 */
    window.addEventListener('storage', (event) => {
      if (!event || !event.key || !String(event.key).startsWith(S.QUEUE_PREFIX)) return;
      pullQueue({ render: state().view === 'signup' });
    });

    /* 本机服务在线时登记短码：二维码变小、手机提交直接进表 */
    registerLink({ render: state().view === 'signup' });

    /* 兜底轮询：iframe 里的提交在个别浏览器上不派发 storage 事件；
       顺便把手机直传（隧道 / 局域网）的增量拉回来，并在表单改过之后重登记短码 */
    if (!pollTimer) {
      pollTimer = window.setInterval(() => {
        if (state().view !== 'signup' || !signup()?.enabled) return;
        pullQueue({ render: true });
        pullServer({ render: true });
        if (needRegister(signup())) registerLink({ render: true });
      }, 2500);
    }
  }

  function copy(value, message) {
    const succeed = () => window.WB.toast(message);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(succeed, () => {
        window.prompt('复制这段内容：', value);
      });
      return;
    }
    window.prompt('复制这段内容：', value);
  }

  window.WB.views.signup = {
    id: 'signup',
    label: '参与者',
    render,
    mount,
    pullQueue,
    importText,
    handleFile,
    linkFor: () => linkOf(signup()),
    pullServer,
    registerLink,
    needRegister,
    stats: () => S.stats(signup())
  };
}());