// Home = dashboard: latest notifications, pending requests, latest 5 approved requests
import { get, post } from '../api.js';
import { esc, fmtDate, fmtDateTime, tableHtml, toast } from '../ui.js';
import { enablePush, PUSH_HELP, pushState } from '../push.js';
import { requestColumns, runAction, wireOpen } from '../components/requests.js';

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
      ${d.workPendingCount ? `<a class="dash-stat warn" href="#/work?status=Pending"><b>${d.workPendingCount}</b><span>WFH requests waiting</span></a>` : ''}
      ${d.workToday ? `<a class="dash-stat wfh" href="#/calendar" title="${esc(d.workToday.filter((w) => w.work_type !== 'Onsite').map((w) => w.emp_name).join(', '))}">
        <b>${d.workToday.filter((w) => w.work_type !== 'Onsite').length}</b><span>🏠 Work from home today</span></a>` : ''}
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
    </section>`;

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
