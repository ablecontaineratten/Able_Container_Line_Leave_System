// Phone app for heads (same link as the full system): just the leave requests, with Approve / Reject
import { get, post } from './api.js';
import { $, $$, daysText, esc, fmtDateTime, openModal, toast, whenText } from './ui.js';
import { allowedActions, runAction } from './components/requests.js';
import { decideWork, workTag, workWhen } from './components/work.js';
import { enablePush, notificationSettings, pushState, PUSH_HELP } from './push.js';

export const PHONE = window.matchMedia('(max-width: 760px)');

// "full" = this phone shows the full system (chosen from the menu); remembered on this device
const VIEW_KEY = 'lms_view';
const storedView = () => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } };
export function setView(v) {
  try { if (v) localStorage.setItem(VIEW_KEY, v); else localStorage.removeItem(VIEW_KEY); } catch { /* private mode */ }
}
export const canDecide = (me) => !!(me.perms['approve.decide'] || me.perms['requests.manage']);
export const wantsLite = (me) => PHONE.matches && canDecide(me) && storedView() !== 'full';
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

const svg = (d, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  cal: 'M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10h18M8 3v4M16 3v4',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  plus: 'M12 5v14M5 12h14',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const hue = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 12 * 30;

export function renderLite(root, ctx, { bell, modeSwitch = '' }) {
  const { me, settings } = ctx.state;
  const tz = settings.timezone;
  const canApply = !!(me.employee && me.perms['leave.apply']);
  let tab = 'pending';
  let rows = [];

  root.innerHTML = `
    <div class="lite">
      <header class="lite-top">
        <div class="user-menu">
          <button class="user-btn" id="user-btn" aria-haspopup="true"><span class="avatar">${esc(initials(me.name))}</span>
            <span class="user-text"><small class="m-greet">${greeting()}</small><b>${esc(me.name)}</b></span></button>
          <div class="dropdown" id="user-dd" hidden>
            <button id="lite-notif">${svg(I.bell)} Notification settings</button>
            ${canApply ? `<button id="lite-apply">${svg(I.plus)} Request my leave</button>` : ''}
            <button id="lite-full">${svg(I.grid)} Open full system</button>
            <button id="logout-btn">${svg(I.out)} Sign out</button>
          </div>
        </div>
        <div class="spacer"></div>
        ${bell}
        ${modeSwitch}
      </header>
      <h1 class="lite-title">Requests</h1>
      <div id="lite-push"></div>
      <div class="lite-seg" role="tablist">
        <button data-tab="pending" class="on">${svg(I.clock)} Waiting <em id="lite-count" hidden></em></button>
        <button data-tab="done">${svg(I.check)} Done</button>
      </div>
      <div id="lite-list" class="lite-list"></div>
    </div>`;

  const listEl = $('#lite-list');

  // Work From Home / Onsite request (not leave)
  function workCard(r, i) {
    const decided = r.status !== 'Pending';
    const mine = me.employee && r.employee_id === me.employee.id && !me.isSuper;
    return `<article class="lr-card lr-work ${r.work_type === 'Onsite' ? 'onsite' : 'wfh'}" style="--i:${i}">
      <div class="lr-head">
        <span class="lr-av" style="--h:${hue(r.emp_name)}">${esc(initials(r.emp_name))}</span>
        <div class="lr-who"><b>${esc(r.emp_name)}</b><small>${esc(r.department || '-')} · ${esc(r.emp_no || '')}</small></div>
        ${decided ? `<span class="pill s-${esc(r.status.toLowerCase())}">${esc(r.status)}</span>` : `<span class="lr-days">${r.days} day${r.days === 1 ? '' : 's'}</span>`}
      </div>
      <div class="lr-type"><b>${workTag(r)}${r.location ? ` <small>${esc(r.location)}</small>` : ''}</b><span>${svg(I.cal)}${esc(workWhen(r))}</span></div>
      ${r.reason ? `<p class="lr-note">${svg(I.note)}<span>${esc(r.reason)}</span></p>` : ''}
      ${decided
    ? `<div class="lr-meta">${esc(r.status)} by ${esc(r.decided_by || '-')} · ${esc(fmtDateTime(r.decided_at, tz))}${r.remark ? `<br>“${esc(r.remark)}”` : ''}</div>`
    : `<div class="lr-meta">Not leave · requested ${esc(fmtDateTime(r.submitted_at, tz))}</div>`}
      ${!decided && !mine ? `<div class="lr-act">
        <button class="lr-btn no" data-act="reject" data-i="${i}">${svg(I.x)} Reject</button>
        <button class="lr-btn yes" data-act="approve" data-i="${i}">${svg(I.check)} Approve</button></div>` : ''}
    </article>`;
  }

  function card(r, i) {
    if (r.kind === 'work') return workCard(r, i);
    const acts = allowedActions(r, me).filter((a) => a === 'approve' || a === 'reject');
    const decided = r.status !== 'Pending';
    return `<article class="lr-card" style="--i:${i}">
      <div class="lr-head">
        <span class="lr-av" style="--h:${hue(r.emp_name)}">${esc(initials(r.emp_name))}</span>
        <div class="lr-who"><b>${esc(r.emp_name)}</b><small>${esc(r.department || '-')} · ${esc(r.emp_no || '')}</small></div>
        ${decided ? `<span class="pill s-${esc(r.status.toLowerCase())}">${esc(r.status)}</span>` : `<span class="lr-days">${esc(daysText(r))}</span>`}
      </div>
      <div class="lr-type"><b>${esc(r.leave_type)}</b><span>${svg(I.cal)}${esc(whenText(r))}</span></div>
      ${r.reason ? `<p class="lr-note">${svg(I.note)}<span>${esc(r.reason)}</span></p>` : ''}
      ${decided
    ? `<div class="lr-meta">${esc(r.status)} by ${esc(r.decided_by || '-')} · ${esc(fmtDateTime(r.decided_at, tz))}${r.remark ? `<br>“${esc(r.remark)}”` : ''}</div>`
    : `<div class="lr-meta">Requested ${esc(fmtDateTime(r.submitted_at, tz))}</div>`}
      ${acts.length ? `<div class="lr-act">
        ${acts.includes('reject') ? `<button class="lr-btn no" data-act="reject" data-i="${i}">${svg(I.x)} Reject</button>` : ''}
        ${acts.includes('approve') ? `<button class="lr-btn yes" data-act="approve" data-i="${i}">${svg(I.check)} Approve</button>` : ''}</div>` : ''}
    </article>`;
  }

  async function load() {
    if (!listEl.children.length) listEl.innerHTML = '<div class="app-loading"><span class="spinner"></span></div>';
    try {
      // leave + Work From Home / Onsite
      const [pending, done, workPending, workAll] = await Promise.all([
        get('/requests?view=pending'), tab === 'done' ? get('/requests?view=decided') : null,
        get('/work?status=Pending'), tab === 'done' ? get('/work') : null,
      ]);
      const asWork = (list) => list.map((w) => ({ ...w, kind: 'work' }));
      const waiting = [...pending.rows, ...asWork(workPending.rows)];
      const count = $('#lite-count');
      count.textContent = waiting.length;
      count.hidden = !waiting.length;
      rows = tab === 'pending' ? waiting.sort((a, b) => (a.from_date < b.from_date ? -1 : 1))
        : [...done.rows, ...asWork(workAll.rows.filter((w) => w.status !== 'Pending'))]
          .sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')));
    } catch (err) {
      listEl.innerHTML = `<div class="app-empty"><b>Could not load</b><span>${esc(err.message)}</span></div>`;
      return;
    }
    listEl.innerHTML = rows.length ? rows.map(card).join('')
      : `<div class="app-empty">${svg(tab === 'pending' ? I.check : I.clock)}<b>${tab === 'pending' ? 'Nothing is waiting 🎉' : 'No decisions yet'}</b>
          <span>${tab === 'pending' ? 'New leave requests from your department will show here.' : 'Requests you approve or reject will show here.'}</span></div>`;
    $$('[data-act]', listEl).forEach((b) => b.addEventListener('click', async () => {
      const r = rows[Number(b.dataset.i)];
      if (await (r.kind === 'work' ? decideWork(b.dataset.act, [r], ctx) : runAction(b.dataset.act, [r], ctx))) load();
    }));
  }

  $$('.lite-seg button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('.lite-seg button').forEach((x) => x.classList.toggle('on', x === b));
    listEl.innerHTML = '';
    load();
  }));
  $('#lite-notif').addEventListener('click', () => {
    const m = openModal({ title: 'Notification settings', body: '<div id="lite-ns"></div>' });
    notificationSettings(m.el.querySelector('#lite-ns'), { post, toast });
  });
  $('#lite-full').addEventListener('click', () => { setView('full'); location.hash = '#/home'; location.reload(); });
  if (canApply) $('#lite-apply').addEventListener('click', () => { setView('full'); location.hash = '#/apply'; location.reload(); });

  // a notification tapped in the bell, coming back to the app, every minute: show the latest list
  window.onhashchange = load;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(load, 60000);
  load();
  pushHint();

  async function pushHint() {
    const state = await pushState();
    const box = $('#lite-push');
    if (state === 'on' || state === 'unsupported') return;
    box.innerHTML = `<div class="notice push-hint"><span>🔔 Get a phone notification when someone requests leave.</span>
      ${PUSH_HELP[state] ? `<small>${esc(PUSH_HELP[state])}</small>` : '<button class="btn btn-primary btn-small" id="lite-push-on">Turn on notifications</button>'}</div>`;
    const btn = $('#lite-push-on');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await enablePush('/api/push/subscribe'); box.innerHTML = ''; toast('Phone notifications are on.'); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }
}
