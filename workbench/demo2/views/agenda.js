/* 活动安排：把「活动日期」里选的每一天拆成时间段，写清几点到几点、这段时间做什么。
   数据是 basic.agenda = [{ date, start, end, title }]；活动日期（basic.days）只定「哪几天」。
   倒计时、甘特、导出用的 date/start/end 由 util.syncSchedule 从这两者投影出来。 */
window.WB = window.WB || {};
window.WB.views = window.WB.views || {};

(function () {
  const U = window.WB.util;
  const { $, $$, escapeHtml } = U;
  const store = () => window.WB.store;
  const state = () => window.WB.store.state;
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const weekLabel = (date) => {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(d.getTime()) ? '' : WEEK[d.getDay()];
  };
  const shortDate = (date) => {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[2])}月${Number(match[3])}日` : String(date || '');
  };

  /* ── 读取：DOM 顺序就是呈现顺序，逐块逐行读回来；skip 用来实现「删掉某一行」 ── */
  function readAgenda(panel, skip) {
    const out = [];
    for (const block of $$('.agenda-day', panel)) {
      const fixedDay = block.dataset.agendaDay || '';
      for (const row of $$('.agenda-row', block)) {
        if (skip && row === skip) continue;
        const pick = $('.agenda-day-pick', row);
        out.push({
          date: pick ? pick.value : fixedDay,
          start: $('.agenda-start', row)?.value || '',
          end: $('.agenda-end', row)?.value || '',
          title: ($('.agenda-title', row)?.value || '').trim()
        });
      }
    }
    return U.normaliseAgenda(out);
  }

  function commit(agenda) {
    const project = state().project;
    if (!project) return;
    project.basic ||= {};
    project.meta ||= { basic: {} };
    project.meta.basic ||= {};
    project.basic.agenda = U.normaliseAgenda(agenda);
    U.syncSchedule(project.basic);
    if (U.daysOf(project.basic).length) project.meta.basic.days = project.meta.basic.days || 'user';
    store().save();
    window.WB.renderTopbar();
    window.WB.renderPanelsMeta?.();
  }

  /* ── 渲染 ─────────────────────────────────── */
  const rowHtml = (row, orphan, days) => {
    const dayPicker = orphan
      ? `<select class="agenda-day-pick" aria-label="归属日期">
          <option value="">（未指定日期）</option>
          ${days.map((day) => `<option value="${escapeHtml(day)}" ${row.date === day ? 'selected' : ''}>${escapeHtml(shortDate(day))} ${escapeHtml(weekLabel(day))}</option>`).join('')}
          ${row.date && !days.includes(row.date) ? `<option value="${escapeHtml(row.date)}" selected>${escapeHtml(shortDate(row.date))}（不在活动日期里）</option>` : ''}
        </select>`
      : '';
    return `<div class="agenda-row">
      ${dayPicker}
      <input class="agenda-start" type="time" value="${escapeHtml(row.start || '')}" aria-label="开始时间" />
      <span class="agenda-sep">–</span>
      <input class="agenda-end" type="time" value="${escapeHtml(row.end || '')}" aria-label="结束时间" />
      <input class="agenda-title" type="text" value="${escapeHtml(row.title || '')}" placeholder="这段时间做什么（可选填）" aria-label="活动内容" />
      <button type="button" class="agenda-del" data-agenda-del title="删除这个时间段">×</button>
    </div>`;
  };

  function dayBlockHtml(day, rows, days, orphan = false) {
    const head = orphan
      ? `<div class="agenda-day-head"><strong>未归到活动日期</strong><span class="agenda-day-note">这些时间段不在已选的活动日期里，选个日期或删掉</span></div>`
      : `<div class="agenda-day-head">
          <strong>${escapeHtml(shortDate(day))}</strong>
          <span class="agenda-weekday">${escapeHtml(weekLabel(day))}</span>
          <span class="agenda-day-note">${rows.length ? `${rows.length} 个时间段` : '还没排时间段'}</span>
          <button type="button" class="agenda-add" data-agenda-add="${escapeHtml(day)}">＋ 添加时间段</button>
        </div>`;
    return `<div class="agenda-day${orphan ? ' is-orphan' : ''}" data-agenda-day="${escapeHtml(day)}">
      ${head}
      <div class="agenda-rows">${rows.map((row) => rowHtml(row, orphan, days)).join('')}</div>
    </div>`;
  }

  function summaryText() {
    const basic = state().project?.basic || {};
    const days = U.daysOf(basic);
    const agenda = U.agendaOf(basic);
    const detail = U.agendaSummary(basic);
    return `共 ${days.length} 天 · ${agenda.length} 个时间段${detail ? `　${detail}` : ''}`;
  }

  function render() {
    const panel = $('#agendaPanel');
    if (!panel) return;
    const project = state().project;
    if (!project) {
      panel.innerHTML = '<div class="empty"><strong>还没有项目</strong>先在「项目信息表」建立这次活动，再来排活动安排。</div>';
      return;
    }
    const basic = project.basic || {};
    const days = U.daysOf(basic);
    const agenda = U.agendaOf(basic);
    const head = `<div class="panel-head">
        <div>
          <h2>活动安排</h2>
          <p>把「活动日期」里选的每一天拆成时间段：几点到几点、这段时间做什么（内容可选填）。</p>
          <p class="agenda-summary" id="agendaSummary"></p>
        </div>
        <div class="panel-actions">
          <button class="button button-ghost" data-goto-view="manifest">去填活动日期</button>
          <button class="button button-ghost" id="exportAgendaMd">导出 Markdown</button>
        </div>
      </div>`;
    let body;
    if (!days.length) {
      body = `<div class="empty"><strong>还没有活动日期</strong>先去「项目信息表 → 活动基本信息」选哪天办（可多天），再回来排时间段。<br /><button class="button button-primary" data-goto-view="manifest">去填活动日期</button></div>`;
    } else {
      const orphan = agenda.filter((item) => !item.date || !days.includes(item.date));
      body = days.map((day) => dayBlockHtml(day, agenda.filter((item) => item.date === day), days)).join('');
      if (orphan.length) body += dayBlockHtml('', orphan, days, true);
      if (!agenda.length) body += '<div class="agenda-tip">每个时间段都可以只填一部分：时间留空就只按日期导出（例如「全天报到」），内容留空就只写时间。</div>';
    }
    panel.innerHTML = head + body;
    const box = $('#agendaSummary');
    if (box) box.textContent = summaryText();
  }

  function exportMarkdown() {
    const basic = state().project?.basic || {};
    const days = U.daysOf(basic);
    const agenda = U.agendaOf(basic);
    if (!days.length && !agenda.length) { window.WB.toast('还没有活动安排'); return; }
    const lines = [`# ${store().projectName()}｜活动安排`, '', `- 活动日期：${U.scheduleSummary(basic) || '待定'}`];
    if (agenda.length) {
      lines.push('', '## 时间段', '');
      for (const day of days) {
        for (const item of agenda.filter((row) => row.date === day)) {
          const span = [item.start, item.end].filter(Boolean).join('–');
          lines.push(`- ${day} ${span}${item.title ? `　${item.title}` : ''}`.trimEnd());
        }
      }
    }
    U.downloadText(`${U.safeFileName(store().projectName())}-活动安排.md`, lines.join('\n'));
  }

  function mount() {
    const panel = $('#agendaPanel');
    if (!panel || panel.dataset.mounted) return;
    panel.dataset.mounted = '1';

    const commitFromDom = () => { commit(readAgenda(panel)); render(); };

    panel.addEventListener('input', (event) => {
      if (!event.target.closest('.agenda-start, .agenda-end, .agenda-title, .agenda-day-pick')) return;
      commit(readAgenda(panel));
      const box = $('#agendaSummary');
      if (box) box.textContent = summaryText();
    });
    panel.addEventListener('change', (event) => {
      if (!event.target.closest('.agenda-start, .agenda-end, .agenda-day-pick')) return;
      commitFromDom();
    });
    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-goto-view]')) return;
      if (event.target.closest('#exportAgendaMd')) { exportMarkdown(); return; }
      const add = event.target.closest('[data-agenda-add]');
      const del = event.target.closest('[data-agenda-del]');
      if (!add && !del) return;
      if (!U.canOperate()) { window.WB.toast('只读访客不能修改活动安排'); return; }
      if (add) {
        commit(readAgenda(panel).concat([{ date: add.dataset.agendaAdd || '', start: '', end: '', title: '' }]));
        render();
        const block = panel.querySelector(`.agenda-day[data-agenda-day="${add.dataset.agendaAdd}"]`);
        block?.querySelector('.agenda-row:last-child .agenda-start')?.focus();
      } else {
        commit(readAgenda(panel, del.closest('.agenda-row')));
        render();
      }
    });
  }

  window.WB.views.agenda = { id: 'agenda', label: '活动安排', render, mount, readAgenda };
}());