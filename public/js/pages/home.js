// Home = dashboard: latest notifications, pending requests, latest 5 approved requests
import { get, post } from '../api.js';
import { esc, fmtDate, fmtDateTime, tableHtml, toast } from '../ui.js';
import { enablePush, PUSH_HELP, pushState } from '../push.js';
import { requestColumns, runAction, wireOpen } from '../components/requests.js';

// ---------------------------------------------------------------- birthday calendar
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const firstName = (n) => String(n).split(/\s+/)[0];

// birthdays: [{ name, department, md: 'MM-DD' }]; today: 'YYYY-MM-DD'
function birthdayCalendar(box, birthdays, today) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));                  // 1-12
  const todayMd = today.slice(5);
  const todays = birthdays.filter((b) => b.md === todayMd);

  const draw = () => {
    const mm = String(m).padStart(2, '0');
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;           // weeks start on Monday
    const inMonth = birthdays.filter((b) => b.md.slice(0, 2) === mm);
    const byDay = {};
    inMonth.forEach((b) => {
      let d = Number(b.md.slice(3));
      if (d > days) d = days;                                                     // 29 Feb in a normal year -> 28 Feb
      (byDay[d] = byDay[d] || []).push(b);
    });
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="bd-cell empty"></div>');
    for (let d = 1; d <= days; d++) {
      const list = byDay[d] || [];
      const isToday = `${y}-${mm}-${String(d).padStart(2, '0')}` === today;
      cells.push(`<div class="bd-cell ${list.length ? 'has' : ''} ${isToday ? 'today' : ''}" ${list.length ? `title="${esc(list.map((b) => b.name).join(', '))}"` : ''}>
        <span class="bd-num">${d}</span>
        ${list.length ? `<span class="bd-cake">🎂</span>${list.slice(0, 2).map((b) => `<span class="bd-name">${esc(firstName(b.name))}</span>`).join('')}${list.length > 2 ? `<span class="bd-more">+${list.length - 2}</span>` : ''}` : ''}
      </div>`);
    }
    box.innerHTML = `
      ${todays.length ? `<div class="bd-today">🎉 <span>Happy birthday <b>${esc(todays.map((b) => b.name).join(', '))}</b>!</span> 🎈</div>` : ''}
      <div class="card-head"><h2>🎂 Birthdays</h2>
        <div class="bd-nav"><button class="btn btn-small" data-m="-1" aria-label="Previous month">‹</button>
          <b>${MONTHS[m - 1]} ${y}</b><button class="btn btn-small" data-m="1" aria-label="Next month">›</button></div></div>
      <div class="bd-grid">${DOW.map((x) => `<div class="bd-head">${x}</div>`).join('')}${cells.join('')}</div>
      ${inMonth.length ? `<ul class="bd-list">${inMonth.map((b) => `<li><span class="bd-date">${Number(b.md.slice(3))} ${MONTHS[m - 1].slice(0, 3)}</span>
        <b>${esc(b.name)}</b><small>${esc(b.department || '')}</small></li>`).join('')}</ul>`
        : '<p class="muted small" style="margin:10px 0 0">No birthdays this month.</p>'}`;
    box.querySelectorAll('[data-m]').forEach((btn) => btn.addEventListener('click', () => {
      m += Number(btn.dataset.m);
      if (m < 1) { m = 12; y--; }
      if (m > 12) { m = 1; y++; }
      draw();
    }));
  };
  draw();
}

export default async function render(view, ctx) {
  const { me, settings } = ctx.state;
  const d = await get('/dashboard');
  if (!ctx.isCurrent()) return;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const pending = d.pending || [];
  const approved = d.approved || [];
  const canDecide = me.perms['approve.decide'] || me.perms['requests.manage'];
  const pendingCols = [...requestColumns({ decided: false }),
    ...(canDecide ? [{ label: '', cls: 'actions', render: (r) => (me.employee && r.employee_id === me.employee.id && !me.isSuper ? ''
      : '<button class="btn btn-small btn-success" data-act="approve">Approve</button> <button class="btn btn-small btn-danger" data-act="reject">Reject</button>') }] : [])];

  view.innerHTML = `
    <div class="page-head home-head"><div><h1>${hello}, ${esc(me.name.split(' ')[0])}</h1><p class="muted">${esc(fmtDate(d.today))}</p></div></div>
    <div id="push-hint"></div>

    <div class="dash-stats">
      <a class="dash-stat warn" href="#/approvals"><b>${pending.length}</b><span>Pending</span></a>
      <a class="dash-stat ok" href="#/requests?status=Approved"><b>${approved.length ? esc(fmtDate(String(approved[0].decided_at || '').slice(0, 10))) : '-'}</b><span>Last approval</span></a>
      <a class="dash-stat" href="#/calendar"><b>${(d.onLeaveToday || []).length}</b><span>On leave today</span></a>
    </div>

    <div class="dash-grid">
      <section class="card dash-notes">
        <div class="card-head"><h2>Latest notifications</h2>${d.notifications.some((n) => !n.read_at) ? '<button class="link" id="read-all">Mark all read</button>' : ''}<button class="bell-del" id="del-picked" title="Delete selected" aria-label="Delete selected notifications" hidden><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></div>
        ${d.notifications.length ? `<ul class="note-list">${d.notifications.map((n) => `
          <li class="${n.read_at ? '' : 'unread'}"><input type="checkbox" class="bell-check" value="${n.id}" aria-label="Select notification"><a href="${esc(n.url && n.url.startsWith('/#') ? n.url.slice(1) : '#/home')}">
            <b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(fmtDateTime(n.created_at, settings.timezone))}</small></a></li>`).join('')}</ul>`
          : '<div class="empty">No notifications yet.</div>'}
      </section>

      <section class="card dash-pending">
        <div class="card-head"><h2>Pending requests</h2><a href="#/approvals">Open Approvals</a></div>
        <div id="pending-list">${tableHtml(pendingCols, pending, { empty: 'Nothing is waiting.' })}</div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>Latest approved</h2><a href="#/requests?status=Approved">See all</a></div>
      <div id="approved-list">${tableHtml(requestColumns(), approved, { empty: 'No approved requests yet.' })}</div>
    </section>

    <section class="card bday-card" id="bday-card"></section>`;
  birthdayCalendar(view.querySelector('#bday-card'), d.birthdays || [], d.today);

  const refresh = () => { ctx.refreshBadge(); render(view, ctx); };
  const pendingEl = view.querySelector('#pending-list');
  wireOpen(pendingEl, pending, ctx, refresh);
  wireOpen(view.querySelector('#approved-list'), approved, ctx, refresh);
  pendingEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const r = pending[Number(b.closest('tr').dataset.index)];
    if (await runAction(b.dataset.act, [r], ctx)) refresh();
  }));
  const readAll = view.querySelector('#read-all');
  if (readAll) readAll.addEventListener('click', async () => { await post('/notifications/read', { all: true }).catch(() => {}); refresh(); });
  const delPicked = view.querySelector('#del-picked');
  const picked = () => [...view.querySelectorAll('.note-list .bell-check:checked')].map((x) => Number(x.value));
  view.querySelectorAll('.note-list .bell-check').forEach((x) => x.addEventListener('change', () => { delPicked.hidden = !picked().length; }));
  delPicked.addEventListener('click', async () => {
    await post('/notifications/delete', { ids: picked() }).catch((err) => toast(err.message, 'error'));
    refresh();
  });

  // heads / admins: ask once to turn on phone notifications for new leave requests
  if (canDecide) {
    const state = await pushState();
    const box = view.querySelector('#push-hint');
    if (!box || state === 'on' || state === 'unsupported') return;
    box.innerHTML = `<div class="notice push-hint"><span>🔔 Get a phone notification when an employee requests leave.</span>
      ${PUSH_HELP[state] ? `<small>${esc(PUSH_HELP[state])}</small>` : '<button class="btn btn-primary btn-small" id="push-on-home">Turn on notifications</button>'}</div>`;
    const btn = view.querySelector('#push-on-home');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await enablePush('/api/push/subscribe'); box.innerHTML = ''; toast('Phone notifications are on.'); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }
}
