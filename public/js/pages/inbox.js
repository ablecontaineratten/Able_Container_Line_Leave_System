// Requests (phone): the leave and Work From Home requests waiting for this person, with Approve / Reject.
// Tabs: Waiting · Done. The phone tab "Requests" of a head / admin (also the only screen of a head / admin
// who is not an employee on a phone).
import { get } from '../api.js';
import { $, $$, daysText, esc, fmtDateTime, whenText } from '../ui.js';
import { allowedActions, runAction } from '../components/requests.js';
import { decideWork, workTag, workWhen } from '../components/work.js';
import { enablePush, pushState, PUSH_HELP } from '../push.js';
import { toast } from '../ui.js';

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const I = {
  cal: 'M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10h18M8 3v4M16 3v4',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
};
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const hue = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 12 * 30;

let tab = 'pending';                       // remembered while the app is open

export default async function render(view, ctx) {
  const { me, settings } = ctx.state;
  const tz = settings.timezone;
  let rows = [];

  view.innerHTML = `<div class="lite">
      <h1 class="lite-title">Requests</h1>
      <div id="lite-push"></div>
      <div class="lite-seg" role="tablist">
        <button data-tab="pending" class="${tab === 'pending' ? 'on' : ''}">${svg(I.clock)} Waiting <em id="lite-count" hidden></em></button>
        <button data-tab="done" class="${tab === 'done' ? 'on' : ''}">${svg(I.check)} Done</button>
      </div>
      <div id="lite-list" class="lite-list"></div>
    </div>`;
  const listEl = $('#lite-list', view);

  const head = (r, right) => `<div class="lr-head">
      <span class="lr-av" style="--h:${hue(r.emp_name)}">${esc(initials(r.emp_name))}</span>
      <div class="lr-who"><b>${esc(r.emp_name)}</b><small>${esc(r.department || '-')} · ${esc(r.emp_no || '')}</small></div>${right}</div>`;
  const meta = (r, waitingText) => (r.status !== 'Pending'
    ? `<div class="lr-meta">${esc(r.status)} by ${esc(r.decided_by || '-')} · ${esc(fmtDateTime(r.decided_at, tz))}${r.remark ? `<br>“${esc(r.remark)}”` : ''}</div>`
    : `<div class="lr-meta">${waitingText} ${esc(fmtDateTime(r.submitted_at, tz))}</div>`);
  const buttons = (acts, i) => (acts.length ? `<div class="lr-act">
      ${acts.includes('reject') ? `<button class="lr-btn no" data-act="reject" data-i="${i}">${svg(I.x)} Reject</button>` : ''}
      ${acts.includes('approve') ? `<button class="lr-btn yes" data-act="approve" data-i="${i}">${svg(I.check)} Approve</button>` : ''}</div>` : '');
  const status = (r) => `<span class="pill s-${esc(r.status.toLowerCase())}">${esc(r.status)}</span>`;

  // Work From Home request (not leave)
  function workCard(r, i) {
    const decided = r.status !== 'Pending';
    const mine = me.employee && r.employee_id === me.employee.id && !me.isSuper;      // never your own
    return `<article class="lr-card lr-work ${r.work_type === 'Onsite' ? 'onsite' : 'wfh'}" style="--i:${i}">
      ${head(r, decided ? status(r) : `<span class="lr-days">${r.days} day${r.days === 1 ? '' : 's'}</span>`)}
      <div class="lr-type"><b>${workTag(r)}${r.location ? ` <small>${esc(r.location)}</small>` : ''}</b><span>${svg(I.cal)}${esc(workWhen(r))}</span></div>
      ${r.reason ? `<p class="lr-note">${svg(I.note)}<span>${esc(r.reason)}</span></p>` : ''}
      ${meta(r, 'Not leave · requested')}
      ${buttons(!decided && !mine ? ['reject', 'approve'] : [], i)}
    </article>`;
  }

  function card(r, i) {
    if (r.kind === 'work') return workCard(r, i);
    const decided = r.status !== 'Pending';
    return `<article class="lr-card" style="--i:${i}">
      ${head(r, decided ? status(r) : `<span class="lr-days">${esc(daysText(r))}</span>`)}
      <div class="lr-type"><b>${esc(r.leave_type)}</b><span>${svg(I.cal)}${esc(whenText(r))}</span></div>
      ${r.reason ? `<p class="lr-note">${svg(I.note)}<span>${esc(r.reason)}</span></p>` : ''}
      ${meta(r, 'Requested')}
      ${buttons(allowedActions(r, me).filter((a) => a === 'approve' || a === 'reject'), i)}
    </article>`;
  }

  async function load() {
    if (!listEl.children.length) listEl.innerHTML = '<div class="app-loading"><span class="spinner"></span></div>';
    try {
      // leave + Work From Home
      const [pending, done, workPending, workAll] = await Promise.all([
        get('/requests?view=pending'), tab === 'done' ? get('/requests?view=decided') : null,
        get('/work?status=Pending'), tab === 'done' ? get('/work') : null,
      ]);
      if (!ctx.isCurrent()) return;
      const asWork = (list) => list.map((w) => ({ ...w, kind: 'work' }));
      const waiting = [...pending.rows, ...asWork(workPending.rows)];
      const count = $('#lite-count', view);
      count.textContent = waiting.length;
      count.hidden = !waiting.length;
      rows = tab === 'pending' ? waiting.sort((a, b) => (a.from_date < b.from_date ? -1 : 1))
        : [...done.rows, ...asWork(workAll.rows.filter((w) => w.status !== 'Pending'))]
          .sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')));
    } catch (err) {
      if (ctx.isCurrent()) listEl.innerHTML = `<div class="app-empty"><b>Could not load</b><span>${esc(err.message)}</span></div>`;
      return;
    }
    listEl.innerHTML = rows.length ? rows.map(card).join('')
      : `<div class="app-empty">${svg(tab === 'pending' ? I.check : I.clock)}<b>${tab === 'pending' ? 'Nothing is waiting 🎉' : 'No decisions yet'}</b>
          <span>${tab === 'pending' ? 'New leave and WFH requests for you to decide will show here.' : 'Requests you approve or reject will show here.'}</span></div>`;
    $$('[data-act]', listEl).forEach((b) => b.addEventListener('click', async () => {
      const r = rows[Number(b.dataset.i)];
      if (await (r.kind === 'work' ? decideWork(b.dataset.act, [r], ctx) : runAction(b.dataset.act, [r], ctx))) { load(); ctx.refreshBadge(); }
    }));
  }

  $$('.lite-seg button', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('.lite-seg button', view).forEach((x) => x.classList.toggle('on', x === b));
    listEl.innerHTML = '';
    load();
  }));

  // coming back to the app and every minute (while this page is open): the latest list
  const refresh = () => { if (ctx.isCurrent()) load(); };
  const timer = setInterval(() => { if (!ctx.isCurrent()) clearInterval(timer); else load(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }, { once: true });
  await load();
  pushHint();

  async function pushHint() {
    const state = await pushState();
    const box = $('#lite-push', view);
    if (!box || state === 'on' || state === 'unsupported') return;
    box.innerHTML = `<div class="notice push-hint"><span>🔔 Get a phone notification when someone requests leave.</span>
      ${PUSH_HELP[state] ? `<small>${esc(PUSH_HELP[state])}</small>` : '<button class="btn btn-primary btn-small" id="lite-push-on">Turn on notifications</button>'}</div>`;
    const btn = $('#lite-push-on', view);
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await enablePush('/api/push/subscribe'); box.innerHTML = ''; toast('Phone notifications are on.'); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }
}
