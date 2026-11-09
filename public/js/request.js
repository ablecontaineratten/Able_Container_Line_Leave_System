// Employee portal (/request) - mobile-app style.
// Sign in (email + password) → Home (leave list + Apply Leave) · Balance · Profile.
import { $, $$, addDays, daysText, esc, fmtDate, fmtDateTime, toUtc, whenText } from './ui.js';
import { enablePush, PUSH_HELP, pushState, registerWorker, resyncPush } from './push.js';
import { modeSwitchHtml, storedMode, wireModeSwitch } from './mode.js';

const root = $('#root');
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-x`);
let requestId = newId();          // same id for retries of one request, so it is never saved twice
const state = { company_name: '', today: '', employee: null, data: null, filter: 'all' };

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  home: svg('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  balance: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
  cross: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  ban: svg('<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>'),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  note: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  bell: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
};
// Work From Home / Onsite requests (a way of working, not leave)
const WORK = {
  'Work From Home': { key: 'wfh', icon: ICON.home, short: 'Work From Home', help: 'Work from home on some days (not leave)' },
};
WORK.Onsite = { key: 'onsite', icon: ICON.pin, short: 'Onsite' };   // only for old records; not offered any more
const NEW_CHOICES = ['Work From Home'];                              // no request = working at the office
// "06 Nov 2026", "06 Nov 2026 → 09 Nov 2026" (days in a row) or "06 Nov 2026, 10 Nov 2026" (separate dates)
const workWhen = (w) => {
  const list = String(w.dates || '').split(',').filter(Boolean);
  if (w.mode === 'range' && w.from_date !== w.to_date) return `${fmtDate(w.from_date)} → ${fmtDate(w.to_date)}`;
  return list.length > 1 ? list.map(fmtDate).join(', ') : fmtDate(w.from_date);
};
const STATUS_ICON = { Pending: ICON.clock, Approved: ICON.check, Rejected: ICON.cross, Cancelled: ICON.ban };

async function api(path, body) {
  const res = await fetch(`/api${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== '/portal/login' && path !== '/auth/signin') { showLogin('Your session ended. Please sign in again.'); throw new Error('SIGNED_OUT'); }
  if (!res.ok) throw new Error((data && data.error) || `Something went wrong (${res.status}). Please try again.`);
  return data;
}

const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (e, cls = '') => (e.photo
  ? `<div class="app-avatar has-photo ${cls}"><img src="${esc(e.photo)}" alt=""></div>`
  : `<div class="app-avatar ${cls}">${esc(initials(e.name))}</div>`);

// Center-crops and shrinks the chosen picture to a 256 px JPEG (small enough to keep in the database)
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This picture could not be opened. Please choose another one.')); };
    img.src = url;
  });
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const pill = (s) => `<span class="pill s-${s.toLowerCase()}">${esc(s)}</span>`;
const errorBox = (el, msg) => { el.hidden = true; void el.offsetWidth; el.textContent = msg; el.hidden = false; };
function busy(btn, on, label) {
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="spinner"></span><span>${esc(label)}</span>` : `<span>${esc(label)}</span>`;
}

// ---------------------------------------------------------------- app shell
function setMode(mode) {
  document.body.classList.toggle('app-mode', mode === 'app');
  document.body.classList.toggle('rq-login-page', mode === 'login');
}

function shell(content, { nav = '', fab = false } = {}) {
  setMode('app');
  // Employee ⇄ Admin switch: only for an employee who is also a Department head / Admin
  const modeBar = nav && state.admin ? `<div class="mode-bar">${modeSwitchHtml('emp', state.admin.pending)}</div>` : '';
  root.innerHTML = `<div class="app">${modeBar}${content}</div>
    ${fab ? `<button class="fab" id="fab" type="button">${ICON.plus}<span>New Request</span></button>` : ''}
    ${nav ? `<nav class="tabbar">
      <button type="button" data-nav="home" class="${nav === 'home' ? 'on' : ''}">${ICON.home}<span>Home</span></button>
      <button type="button" data-nav="balance" class="${nav === 'balance' ? 'on' : ''}">${ICON.balance}<span>Balance</span></button>
      <button type="button" data-nav="profile" class="${nav === 'profile' ? 'on' : ''}">${ICON.user}<span>Profile</span></button>
    </nav>` : ''}`;
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => ({ home: showHome, balance: showBalance, profile: showProfile })[b.dataset.nav]()));
  const fabBtn = $('#fab');
  if (fabBtn) fabBtn.addEventListener('click', openNewRequest);
  // the system ('/') opens with the same sign-in (or asks to sign in if that session ended)
  if (modeBar) wireModeSwitch(root, 'emp', () => { location.href = '/'; });
  window.scrollTo(0, 0);
}

const topBar = (title) => `<header class="app-top"><button class="app-back" id="back" type="button" aria-label="Back">${ICON.back}</button><h1>${esc(title)}</h1></header>`;

async function loadData() {
  state.data = await api('/portal/summary');
  state.employee = { ...state.employee, ...state.data.employee };
  return state.data;
}

// ---------------------------------------------------------------- sign in
function showLogin(notice = '') {
  setMode('login');
  root.innerHTML = `<div class="rq-login">
      <img class="trial-stamp rq-login-trial" src="/img/trial-stamp.svg" alt="Trial version">
      <div class="rq-login-brand">
        <div class="rq-login-logo"><img src="/img/logo-full.png" alt="${esc(state.company_name)} logo"></div>
        <div class="rq-login-company">${esc(state.company_name)}</div>
        <div class="rq-login-portal">Leave and Shift Management System</div>
      </div>
      <form class="rq-login-form" id="login-form" novalidate>
        <h1>Sign in</h1>
        ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
        <label class="field"><span>Email</span>
          <input type="email" name="email" autocomplete="username" inputmode="email" placeholder="name@company.com" required></label>
        <label class="field"><span>Password</span>
          <span class="rq-pw"><input type="password" name="password" autocomplete="current-password" placeholder="Your password" required>
          <button type="button" class="rq-eye" aria-label="Show password">👁</button></span></label>
        <p class="form-error" hidden></p>
        <button class="rq-submit" type="submit"><span class="label">Sign in</span><span class="arrow">→</span></button>
        <p class="rq-note">Forgot your password? Please ask HR.</p>
      </form>
    </div>`;
  const form = $('#login-form');
  const last = lastEmail();
  if (last) { form.email.value = last; form.password.focus(); } else form.email.focus();
  $('.rq-eye', form).addEventListener('click', () => { form.password.type = form.password.type === 'password' ? 'text' : 'password'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('.rq-submit', form);
    if (!form.email.value.trim() || !form.password.value) return errorBox($('.form-error', form), 'Enter your email and password.');
    btn.disabled = true;
    try {
      // one sign-in for everyone: heads / admins go to the system, employees stay here
      const res = await api('/auth/signin', { email: form.email.value.trim(), password: form.password.value });
      remember(form.email.value.trim().toLowerCase());
      // a head / admin who is also an employee opens in the mode used last time (first time: Admin)
      if (res.target === '/' && !(res.both && storedMode() === 'emp')) { location.href = '/'; return; }
      await start();
    } catch (err) {
      errorBox($('.form-error', form), err.message);
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- home: leave list
async function showHome() {
  const e = state.employee;
  shell(`<div class="app-hello">
      ${avatar(e)}
      <div><small>${greeting()}</small><b>${esc(e.name)}</b></div>
      <img class="trial-stamp" src="/img/trial-stamp.svg" alt="Trial version">
      <button class="app-bell" id="bell" type="button" aria-label="Notifications">${ICON.bell}<em id="bell-count" hidden></em></button>
    </div>
    <div id="home-body"><div class="app-loading"><span class="spinner"></span></div></div>`, { nav: 'home', fab: true });
  $('#bell').addEventListener('click', openNotifications);
  bellCount();
  let d;
  try { d = await loadData(); } catch (err) { if (err.message !== 'SIGNED_OUT') $('#home-body').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  // leave + Work From Home + late arrival messages together, newest date first
  const items = [...d.requests.map((r) => ({ ...r, kind: 'leave' })), ...(d.work || []).map((w) => ({ ...w, kind: 'work' })),
    ...(d.late || []).map((l) => ({ ...l, kind: 'late', from_date: l.date, submitted_at: l.created_at, status: 'Informed' }))]
    .sort((a, b) => (a.from_date === b.from_date ? String(b.submitted_at).localeCompare(String(a.submitted_at)) : a.from_date < b.from_date ? 1 : -1));
  drawList(items);
}

// "New Request": Leave, or Work From Home / Onsite
function openNewRequest() {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-back';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="New request">
      <div class="sheet-grip"></div>
      <h2 class="new-title">New request</h2>
      <div class="new-choices">
        <button type="button" class="new-choice leave" data-new="leave"><span class="nc-icon">${ICON.cal}</span>
          <span><b>Leave</b><small>Annual, casual, half day or short leave</small></span></button>
        ${NEW_CHOICES.map((type) => [type, WORK[type]]).map(([type, w]) => `<button type="button" class="new-choice ${w.key}" data-new="${esc(type)}"><span class="nc-icon">${w.icon}</span>
          <span><b>${esc(w.short)}</b><small>${esc(w.help)}</small></span></button>`).join('')}
        <button type="button" class="new-choice late" data-new="late"><span class="nc-icon">${ICON.clock}</span>
          <span><b>Late Arrival</b><small>Tell your head you will be late today (no approval)</small></span></button>
      </div>
      <button class="btn-wide" id="close-new" type="button">Cancel</button>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); };
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
  $('#close-new', wrap).addEventListener('click', close);
  $$('[data-new]', wrap).forEach((b) => b.addEventListener('click', () => {
    wrap.remove();
    if (b.dataset.new === 'leave') showApply(); else if (b.dataset.new === 'late') showLate(); else showWork(b.dataset.new);
  }));
}

// ---------------------------------------------------------------- notifications bell
async function bellCount() {
  try {
    const d = await api('/portal/notifications');
    const em = $('#bell-count');
    if (em) { em.textContent = d.unread > 9 ? '9+' : d.unread; em.hidden = !d.unread; }
  } catch { /* ignore */ }
}

// Popup: the latest 5, "See more" shows all
async function openNotifications() {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-back';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Notifications">
      <div class="sheet-grip"></div>
      <div class="sheet-head"><span class="lc-icon s-approved">${ICON.bell}</span><div><b>Notifications</b></div></div>
      <div id="note-body"><div class="app-loading"><span class="spinner"></span></div></div>
      <button class="btn-wide" id="close-notes" type="button">Close</button>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); bellCount(); };
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
  $('#close-notes', wrap).addEventListener('click', close);
  let rows = [];
  try { rows = (await api('/portal/notifications')).rows; } catch (err) { if (err.message === 'SIGNED_OUT') { wrap.remove(); return; } }

  // press and hold a notification -> select mode (tick several) -> Mark read / Delete
  let showAll = false;
  let selecting = false;
  const picked = new Set();
  const body = $('#note-body', wrap);

  const draw = () => {
    const list = showAll ? rows : rows.slice(0, 5);
    const unread = rows.some((n) => !n.read_at);
    const bar = selecting
      ? `<div class="note-bar sel"><b>${picked.size} selected</b>
          <button type="button" class="link" data-do="all">${picked.size === list.length ? 'None' : 'Select all'}</button>
          <span class="spacer"></span>
          <button type="button" class="note-act" data-do="read" ${picked.size ? '' : 'disabled'}>Mark read</button>
          <button type="button" class="note-act danger" data-do="delete" ${picked.size ? '' : 'disabled'}>Delete</button>
          <button type="button" class="note-act" data-do="cancel">Cancel</button></div>`
      : (rows.length ? `<div class="note-bar"><small class="muted">Press and hold to select</small><span class="spacer"></span>
          ${unread ? '<button type="button" class="note-act" data-do="readall">Mark all as read</button>' : ''}</div>` : '');
    body.innerHTML = rows.length ? `${bar}<ul class="note-items ${selecting ? 'selecting' : ''}">${list.map((n) => `
        <li class="${n.read_at ? '' : 'unread'} ${picked.has(n.id) ? 'picked' : ''}" data-id="${n.id}">
          ${selecting ? `<span class="note-check">${picked.has(n.id) ? '✓' : ''}</span>` : ''}
          <div><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(fmtDateTime(n.created_at, state.timezone))}</small></div></li>`).join('')}</ul>
      ${!showAll && rows.length > 5 ? `<button class="btn-wide" id="see-more" type="button">See more (${rows.length - 5})</button>` : ''}`
      : `<div class="app-empty">${ICON.bell}<b>No notifications</b></div>`;
    const more = $('#see-more', wrap);
    if (more) more.addEventListener('click', () => { showAll = true; draw(); });
    wireItems(list);
  };

  const wireItems = (list) => {
    $$('.note-items li', body).forEach((li) => {
      const id = Number(li.dataset.id);
      let timer = null;
      let held = false;
      const start = () => { held = false; timer = setTimeout(() => { held = true; selecting = true; picked.add(id); if (navigator.vibrate) navigator.vibrate(30); draw(); }, 500); };
      const stop = () => clearTimeout(timer);
      li.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) => li.addEventListener(ev, (e) => {
        if (ev === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 4) return;   // tiny finger wobble is fine
        stop();
      }));
      li.addEventListener('contextmenu', (e) => e.preventDefault());               // no long-press menu on phones
      li.addEventListener('click', () => {
        if (held || !selecting) return;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        draw();
      });
    });
    $$('[data-do]', body).forEach((btn) => btn.addEventListener('click', async () => {
      const act = btn.dataset.do;
      if (act === 'cancel') { selecting = false; picked.clear(); return draw(); }
      if (act === 'all') { if (picked.size === list.length) picked.clear(); else list.forEach((n) => picked.add(n.id)); return draw(); }
      const ids = [...picked];
      btn.disabled = true;
      try {
        if (act === 'readall') {
          await api('/portal/notifications/read', {});
          rows.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); });
        } else if (act === 'read') {
          await api('/portal/notifications/read', { ids });
          rows.forEach((n) => { if (picked.has(n.id)) n.read_at = n.read_at || new Date().toISOString(); });
        } else if (act === 'delete') {
          if (!window.confirm(`Delete ${ids.length} notification${ids.length === 1 ? '' : 's'}?`)) { btn.disabled = false; return; }
          await api('/portal/notifications/delete', { ids });
          rows = rows.filter((n) => !picked.has(n.id));
        }
        selecting = false;
        picked.clear();
        draw();
        bellCount();
      } catch (err) { if (err.message !== 'SIGNED_OUT') { alert(err.message); btn.disabled = false; } }
    }));
  };
  draw();
}

function drawList(requests) {
  const body = $('#home-body');
  if (!body) return;
  const pending = requests.filter((r) => r.status === 'Pending').length;
  const tabs = [['all', 'All', ICON.list], ['Pending', 'Pending', ICON.clock], ['Approved', 'Approved', ICON.check]];
  const rows = state.filter === 'all' ? requests : requests.filter((r) => r.status === state.filter);
  // every card says clearly what it is: LEAVE or WFH
  const kindTag = (r) => (r.kind === 'work' ? '<span class="kind-tag work">WFH</span>'
    : r.kind === 'late' ? '<span class="kind-tag late">LATE</span>' : '<span class="kind-tag leave">LEAVE</span>');
  body.innerHTML = `<div class="seg">${tabs.map(([k, label, icon]) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'on' : ''}">
      ${icon}<span>${label}</span>${k === 'Pending' && pending ? `<em>${pending}</em>` : ''}</button>`).join('')}</div>    <div class="leave-list">${rows.length ? rows.map((r, i) => (r.kind === 'late' ? `
      <button class="leave-card late-card" type="button" data-i="${requests.indexOf(r)}" style="--i:${Math.min(i, 8)}">
        <span class="lc-icon wk-late">${ICON.clock}</span>
        <span class="lc-main">${kindTag(r)}<b>Late arrival</b><span class="lc-date">${ICON.cal}${esc(fmtDate(r.date))} · ${esc(fmtDateTime(r.created_at, state.timezone).split(', ').pop())}</span></span>
        ${pill(r.status)}
        <span class="lc-note">${ICON.note}<span>${esc(r.message)}</span></span>
      </button>` : r.kind === 'work' ? `
      <button class="leave-card work-card ${WORK[r.work_type].key}" type="button" data-i="${requests.indexOf(r)}" style="--i:${Math.min(i, 8)}">
        <span class="lc-icon wk-${WORK[r.work_type].key}">${WORK[r.work_type].icon}</span>
        <span class="lc-main">${kindTag(r)}<b>${esc(r.work_type)}${r.location ? ` <small>· ${esc(r.location)}</small>` : ''}</b><span class="lc-date">${ICON.cal}${esc(workWhen(r))}</span></span>
        ${pill(r.status)}
        ${r.reason ? `<span class="lc-note">${ICON.note}<span>${esc(r.reason)}</span></span>` : ''}
      </button>` : `
      <button class="leave-card" type="button" data-i="${requests.indexOf(r)}" style="--i:${Math.min(i, 8)}">
        <span class="lc-icon s-${r.status.toLowerCase()}">${STATUS_ICON[r.status] || ICON.clock}</span>
        <span class="lc-main">${kindTag(r)}<b>${esc(r.leave_type)}</b><span class="lc-date">${ICON.cal}${esc(whenText(r))}</span></span>
        ${pill(r.status)}
        ${r.reason ? `<span class="lc-note">${ICON.note}<span>${esc(r.reason)}</span></span>` : ''}
      </button>`)).join('') : `<div class="app-empty">${ICON.cal}<b>No requests</b></div>`}
    </div>`;
  $$('[data-filter]', body).forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; drawList(requests); }));
  $$('.leave-card', body).forEach((c) => c.addEventListener('click', () => openSheet(requests[Number(c.dataset.i)])));
}

// Bottom sheet with the details of one request (+ Withdraw when pending)
function openSheet(r) {
  const row = (k, v) => (v ? `<div class="sheet-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '');
  if (r.kind === 'late') {               // late arrival: just the message (inform only)
    const w = document.createElement('div');
    w.className = 'sheet-back';
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
      <div class="sheet-head"><span class="lc-icon wk-late">${ICON.clock}</span><div><b>Late arrival</b><small>Informed - no approval needed</small></div>${pill(r.status)}</div>
      ${row('Date', fmtDate(r.date))}${row('Sent', fmtDateTime(r.created_at, state.timezone))}${row('Message', r.message)}
      <button class="btn-wide" id="close-sheet" type="button">Close</button></div>`;
    document.body.appendChild(w);
    requestAnimationFrame(() => w.classList.add('open'));
    const shut = () => { w.classList.remove('open'); setTimeout(() => w.remove(), 250); };
    w.addEventListener('click', (ev) => { if (ev.target === w) shut(); });
    $('#close-sheet', w).addEventListener('click', shut);
    return;
  }
  const work = r.kind === 'work';
  const wrap = document.createElement('div');
  wrap.className = 'sheet-back';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      <div class="sheet-head">${work ? `<span class="lc-icon wk-${WORK[r.work_type].key}">${WORK[r.work_type].icon}</span>`
        : `<span class="lc-icon s-${r.status.toLowerCase()}">${STATUS_ICON[r.status] || ICON.clock}</span>`}
        <div><b>${esc(work ? r.work_type : r.leave_type)}</b><small>${esc(r.request_no)}</small></div>${pill(r.status)}</div>
      ${work ? `${row('Location', r.location)}${row('Date(s)', workWhen(r))}${row('Days', `${r.days} day${r.days === 1 ? '' : 's'}`)}${row('Type', 'Not leave - no balance used')}`
        : `${row('Date(s)', whenText(r))}${row('Days', daysText(r))}`}${row('Reason', r.reason)}
      ${row('Requested', fmtDateTime(r.submitted_at, state.timezone))}
      ${row('Decided by', r.decided_by)}${row('Decided', r.decided_at ? fmtDateTime(r.decided_at, state.timezone) : '')}${row('Remark', r.remark)}
      <p class="form-error" hidden></p>
      ${r.status === 'Pending' ? '<button class="btn-wide danger" id="withdraw" type="button">Withdraw request</button>' : ''}
      <button class="btn-wide" id="close-sheet" type="button">Close</button>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => { wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 250); };
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
  $('#close-sheet', wrap).addEventListener('click', close);
  const w = $('#withdraw', wrap);
  if (w) w.addEventListener('click', async () => {
    w.disabled = true;
    try { await api(work ? '/portal/work/withdraw' : '/portal/withdraw', { id: r.id }); close(); showHome(); } catch (err) {
      if (err.message !== 'SIGNED_OUT') { errorBox($('.form-error', wrap), err.message); w.disabled = false; }
    }
  });
}

// ---------------------------------------------------------------- balance
// Only Annual, Casual, Half Day and Short Leave. Tap one -> the dates taken.
async function showBalance() {
  shell(`<h1 class="app-title pad-top">Balance</h1><div id="bal-body"><div class="app-loading"><span class="spinner"></span></div></div>`, { nav: 'balance', fab: true });
  let d;
  try { d = await loadData(); } catch (err) { if (err.message !== 'SIGNED_OUT') $('#bal-body').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  const b = d.balance;
  const find = (re) => b.types.find((t) => re.test(t.type) && !t.is_short);
  const pct = (used, all) => (all ? Math.min(100, Math.round((used / all) * 100)) : 0);
  const items = [];
  const annual = find(/annual/i);
  if (annual) items.push({ key: 'annual', title: annual.type, big: annual.left ?? annual.used, sub: annual.left === null ? 'taken' : `/ ${annual.allowed}`, pct: annual.allowed ? pct(annual.used + annual.pending, annual.allowed) : null });
  const casual = find(/casual/i);
  if (casual) items.push({ key: 'casual', title: casual.type, big: casual.left ?? casual.used, sub: casual.left === null ? 'taken' : `/ ${casual.allowed}`, pct: casual.allowed ? pct(casual.used + casual.pending, casual.allowed) : null });
  items.push({ key: 'half', title: 'Half Day', big: d.taken.half.length, sub: 'taken', pct: null });
  const m = b.shortMonth;
  if (m) items.push({ key: 'short', title: 'Short Leave', big: Math.max(m.limit - m.used - m.pending, 0), sub: `/ ${m.limit}`, pct: pct(m.used + m.pending, m.limit) });

  // Work From Home (not leave): left in this week / month / year when there is a WFH limit, else days this month
  const lim = d.wfh_limit || {};
  const today = d.today;
  const periodOf = (x) => (lim.period === 'year' ? (x.slice(5) >= (lim.year_start || '01-01') ? x.slice(0, 4) : String(Number(x.slice(0, 4)) - 1))
    : lim.period === 'week' ? addDays(x, -((toUtc(x).getUTCDay() + 6) % 7)) : x.slice(0, 7));
  const wfhDays = (statuses) => (d.work || []).filter((w) => w.work_type === 'Work From Home' && statuses.includes(w.status)).flatMap((w) => w.dates.split(','));
  const yearStart = b.year.start;
  const yearEnd = b.year.end;
  d.taken.wfh = [...new Set(wfhDays(['Approved']).filter((x) => x >= yearStart && x < yearEnd))].sort().reverse();
  const nowKey = periodOf(today);
  const PER = { week: 'this week', month: 'this month', year: 'this year' };
  if (lim.period && lim.days) {
    const used = wfhDays(['Approved', 'Pending']).filter((x) => periodOf(x) === nowKey).length;
    items.push({ key: 'wfh', title: `Work From Home (${PER[lim.period]})`, big: Math.max(lim.days - used, 0), sub: `/ ${lim.days}`, pct: pct(used, lim.days) });
  } else if (lim.period) {               // a period but no limit: just the approved days in it
    items.push({ key: 'wfh', title: 'Work From Home', big: wfhDays(['Approved']).filter((x) => periodOf(x) === nowKey).length, sub: PER[lim.period], pct: null });
  } else {
    items.push({ key: 'wfh', title: 'Work From Home', big: wfhDays(['Approved']).filter((x) => x.slice(0, 7) === today.slice(0, 7)).length, sub: 'this month', pct: null });
  }
  // Late arrivals (inform only): days this month; tap = every late day this year
  const lateDays = [...new Set((d.late || []).map((l) => l.date))];
  d.taken.late = lateDays.filter((x) => x >= yearStart && x < yearEnd).sort().reverse();
  items.push({ key: 'late', title: 'Late Arrivals', big: lateDays.filter((x) => x.slice(0, 7) === today.slice(0, 7)).length, sub: 'this month', pct: null });

  $('#bal-body').innerHTML = `<div class="bal-list">${items.map((it, i) => `
      <button class="bal-item" type="button" data-key="${it.key}" data-title="${esc(it.title)}" style="--i:${i}">
        <span class="bal-row"><b>${esc(it.title)}</b><span><strong>${esc(it.big)}</strong> ${esc(it.sub)}</span><i>›</i></span>
        ${it.pct === null ? '' : `<span class="meter"><span style="width:${it.pct}%" class="${it.pct >= 100 ? 'full' : it.pct >= 75 ? 'high' : ''}"></span></span>`}
      </button>`).join('')}</div>`;
  const LIST_TITLE = { wfh: 'Work From Home days (this year)', late: 'Late arrival days (this year)' };
  $$('.bal-item').forEach((btn) => btn.addEventListener('click', () => showTaken(LIST_TITLE[btn.dataset.key] || btn.dataset.title, d.taken[btn.dataset.key] || [])));
}

// The dates taken for one balance item, as dd/mm/yyyy
function showTaken(title, dates) {
  const dmy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  shell(`${topBar(title)}
    ${dates.length ? `<ol class="date-rows">${dates.map((d, i) => `<li style="--i:${Math.min(i, 10)}"><span>${i + 1}</span><b>${dmy(d)}</b></li>`).join('')}</ol>`
      : `<div class="app-empty">${ICON.cal}<b>No dates</b></div>`}`, { nav: 'balance' });
  $('#back').addEventListener('click', showBalance);
}

// ---------------------------------------------------------------- profile
function showProfile() {
  const e = state.employee;
  const row = (k, v) => `<div class="sheet-row"><span>${esc(k)}</span><b>${esc(v || '-')}</b></div>`;
  shell(`<div class="profile-head">
      <label class="photo-pick" aria-label="Change profile photo">
        ${avatar(e, 'big')}
        <input type="file" id="photo-file" accept="image/*" hidden></label>
      <small class="photo-hint">${e.photo ? 'Tap the picture to change it' : 'Tap the picture to add your photo'}</small>
      ${e.photo ? '<button class="link-btn photo-remove" id="photo-remove" type="button">Remove photo</button>' : ''}
      <b>${esc(e.name)}</b><span>${esc(e.emp_no)}${e.department ? ` · ${esc(e.department)}` : ''}</span>
    </div>
    <div class="app-box">${row('Email', e.email)}${row('Employee number', e.emp_no)}${row('Department', e.department)}</div>
    <div id="notif-box"></div>
    <h2 class="app-h2">${ICON.lock} Change password</h2>
    ${e.using_default ? '<p class="notice">You are still using the default password. Please choose your own.</p>' : ''}
    <form class="app-box form" id="pw-form" novalidate>
      <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>New password</span><input type="password" name="password" autocomplete="new-password" required><small>At least 8 characters, letters and numbers.</small></label>
      <label class="field"><span>New password again</span><input type="password" name="again" autocomplete="new-password" required></label>
      <p class="form-error" hidden></p>
      <p class="rq-ok" hidden>✓ Your password was changed.</p>
      <button class="btn-wide primary" type="submit"><span>Change password</span></button>
    </form>
    <button class="btn-wide danger" id="sign-out" type="button">${ICON.out}<span>Sign out</span></button>`, { nav: 'profile' });
  $('#sign-out').addEventListener('click', async () => { await api('/portal/logout', {}).catch(() => {}); state.employee = null; showLogin(); });
  drawNotifBox();
  const savePhoto = async (photo) => {
    try {
      const r = await api('/portal/photo', { photo });
      state.employee.photo = r.photo;
      showProfile();
    } catch (ex) { if (ex.message !== 'SIGNED_OUT') alert(ex.message); }
  };
  $('#photo-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $('.photo-pick').classList.add('busy');
    try { await savePhoto(await shrinkPhoto(file)); } catch (ex) { alert(ex.message); $('.photo-pick').classList.remove('busy'); }
  });
  const remove = $('#photo-remove');
  if (remove) remove.addEventListener('click', () => { if (confirm('Remove your profile photo?')) savePhoto(''); });
  const form = $('#pw-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('.form-error', form);
    const ok = $('.rq-ok', form);
    ok.hidden = true;
    if (!form.current.value || !form.password.value) return errorBox(err, 'Fill in your current and new password.');
    if (form.password.value !== form.again.value) return errorBox(err, 'The two new passwords are not the same.');
    const btn = $('button[type=submit]', form);
    busy(btn, true, 'Saving…');
    try {
      await api('/portal/password', { current: form.current.value, password: form.password.value });
      state.employee.using_default = false;
      err.hidden = true;
      form.reset();
      ok.hidden = false;
      const warn = $('.app > .notice');
      if (warn) warn.remove();
    } catch (ex) { if (ex.message !== 'SIGNED_OUT') errorBox(err, ex.message); }
    busy(btn, false, 'Change password');
  });
}

// Profile: phone notifications (leave approved / not approved)
async function drawNotifBox() {
  const box = $('#notif-box');
  if (!box) return;
  const st = await pushState();
  box.innerHTML = `<h2 class="app-h2">${ICON.bell} Notifications</h2>
    <div class="app-box notif-row">
      ${st === 'on' ? '<span class="notif-on">On</span><button class="btn-wide" id="notif-test" type="button"><span>Send test notification</span></button>'
        : PUSH_HELP[st] ? `<small>${esc(PUSH_HELP[st])}</small>`
        : '<button class="btn-wide primary" id="notif-on" type="button"><span>Turn on</span></button>'}
    </div>`;
  const test = $('#notif-test');
  if (test) test.addEventListener('click', async () => {
    busy(test, true, 'Sending…');
    try {
      await resyncPush('/api/portal/push/subscribe');                  // make sure THIS phone is linked to me
      const r = await api('/portal/push/test', {});
      box.querySelector('.notif-row').insertAdjacentHTML('beforeend', `<p class="rq-ok">${esc(r.result)}. It should appear in a few seconds.</p>`);
    } catch (err) {
      if (err.message !== 'SIGNED_OUT') box.querySelector('.notif-row').insertAdjacentHTML('beforeend', `<p class="form-error">${esc(err.message)}</p>`);
    }
    busy(test, false, 'Send test notification');
  });
  const btn = $('#notif-on');
  if (btn) btn.addEventListener('click', async () => {
    busy(btn, true, 'Turning on…');
    try { await enablePush('/api/portal/push/subscribe'); drawNotifBox(); } catch (err) { box.querySelector('.notif-row').insertAdjacentHTML('beforeend', `<p class="form-error">${esc(err.message)}</p>`); busy(btn, false, 'Turn on'); }
  });
}

// ---------------------------------------------------------------- apply leave
const step = (i, title, inner) => `<section class="rq-step" style="--i:${i}" data-step="${i}">
  <div class="rq-num">${i}</div><div><h2>${esc(title)}</h2><div class="rq-fields">${inner}</div></div></section>`;

async function showApply() {
  shell(`${topBar('Apply Leave')}<div id="apply-body"><div class="app-loading"><span class="spinner"></span></div></div>`);
  $('#back').addEventListener('click', showHome);
  let o;
  try { o = await api('/portal/options'); } catch (err) { if (err.message !== 'SIGNED_OUT') $('#apply-body').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  state.employee = { ...state.employee, ...o.employee };
  const emp = state.employee;
  const weekend = new Set(String(o.weekend || '').split(',').filter((x) => x !== '').map(Number));
  const holidays = new Set(o.holidays);
  const isWorking = (d) => !weekend.has(toUtc(d).getUTCDay()) && !holidays.has(d);
  const countWorking = (from, to) => { let n = 0; for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) if (isWorking(d)) n++; return n; };
  const dateInput = (name) => `<input type="date" name="${name}" min="${o.today}" aria-label="Date">`;

  $('#apply-body').innerHTML = `<form class="app-box form apply" id="req-form" novalidate>
      ${emp.email_hint ? '' : `<label class="field"><span>Your email *</span><input type="email" name="email" placeholder="name@gmail.com" autocomplete="email" required></label>`}
      ${step(1, 'Leave type', `<label class="field"><span>Type of leave *</span><select name="leave_type" required>
          <option value="">Choose…</option>${o.types.map((t) => `<option>${esc(t.name)}</option>`).join('')}</select></label>`)}
      ${step(2, 'Date(s)', `
        <fieldset class="field" id="mode-box"><span>How many days?</span>
          <div class="segmented">
            <label><input type="radio" name="mode" value="one" checked><span>One day</span></label>
            <label><input type="radio" name="mode" value="range"><span>Days in a row</span></label>
            <label><input type="radio" name="mode" value="dates"><span>Separate dates</span></label>
          </div></fieldset>
        <div id="one-box" class="form-grid">
          <label class="field"><span>Date *</span>${dateInput('date')}</label>
          <fieldset class="field" id="half-box" hidden><span>Full or half day?</span>
            <div class="segmented"><label><input type="radio" name="half" value="0" checked><span>Full day</span></label>
            <label><input type="radio" name="half" value="1"><span>Half day</span></label></div></fieldset>
        </div>
        <div id="short-box" class="form-grid" hidden>
          <label class="field"><span>Out time</span><input type="time" name="out_time"></label>
          <label class="field"><span>Return time <small>(optional)</small></span><input type="time" name="return_time"></label>
        </div>
        <div id="range-box" class="form-grid" hidden>
          <label class="field"><span>From *</span>${dateInput('from')}</label>
          <label class="field"><span>To *</span>${dateInput('to')}</label>
        </div>
        <div id="dates-box" hidden>
          <div class="field"><span>Dates * (up to 10)</span><div id="date-list" class="date-list">${dateInput('d')}${dateInput('d')}</div></div>
          <button type="button" class="btn btn-small" id="add-date" style="margin-top:8px">+ Add a date</button>
        </div>
        <p class="summary" id="summary"></p>`)}
      ${step(3, 'Reason', `<label class="field"><span>Reason <small>(optional)</small></span><textarea name="reason" rows="3" maxlength="1000"></textarea></label>`)}
      <p class="form-error" hidden></p>
      <button class="btn-wide primary" type="submit"><span>Submit</span></button>
    </form>`;

  const form = $('#req-form');
  const errBox = $('.form-error', form);
  const typeOf = () => o.types.find((t) => t.name === form.leave_type.value);
  const mark = (n, on) => { const s = $(`[data-step="${n}"]`, form); if (s) s.classList.toggle('done', !!on); };
  function update() {
    const t = typeOf();
    const isShort = !!(t && t.is_short);
    const m = isShort ? 'one' : form.mode.value;
    $('#mode-box').hidden = isShort;
    $('#one-box').hidden = m !== 'one';
    $('#half-box').hidden = !(m === 'one' && t && t.allow_half);
    $('#short-box').hidden = !isShort;
    $('#range-box').hidden = m !== 'range';
    $('#dates-box').hidden = m !== 'dates';
    if (!(t && t.allow_half)) form.querySelector('input[name=half][value="0"]').checked = true;
    let text = '';
    let datesOk = false;
    if (m === 'one' && form.date.value) {
      datesOk = isWorking(form.date.value);
      text = !datesOk ? `⚠ ${fmtDate(form.date.value)} is a weekend day / holiday.`
        : isShort ? `⏱ Short leave on ${fmtDate(form.date.value)}` : form.half.value === '1' ? `◐ Half day (0.5) on ${fmtDate(form.date.value)}` : `✓ 1 working day · ${fmtDate(form.date.value)}`;
    } else if (m === 'range' && form.from.value && form.to.value) {
      const n = form.to.value < form.from.value ? -1 : countWorking(form.from.value, form.to.value);
      datesOk = n > 0;
      text = n < 0 ? '⚠ "To" is before "From".' : `✓ ${n} working day(s) · ${fmtDate(form.from.value)} → ${fmtDate(form.to.value)}`;
    } else if (m === 'dates') {
      const ds = [...new Set($$('input[name=d]', form).map((i) => i.value).filter(Boolean))];
      const off = ds.filter((d) => !isWorking(d));
      datesOk = ds.length > 0 && !off.length;
      if (ds.length) text = off.length ? `⚠ ${off.map(fmtDate).join(', ')}: weekend / holiday.` : `✓ ${ds.length} working day(s)`;
    }
    $('#summary').textContent = text;
    mark(1, !!t);
    mark(2, datesOk);
    mark(3, !!form.reason.value.trim());
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  $('#add-date').addEventListener('click', () => {
    const list = $('#date-list');
    if (list.children.length < 10) { list.insertAdjacentHTML('beforeend', dateInput('d')); list.lastElementChild.focus(); }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = typeOf();
    const body = {
      request_id: requestId, email: form.email ? form.email.value.trim() : '',
      leave_type: form.leave_type.value, mode: t && t.is_short ? 'one' : form.mode.value,
      date: form.date.value, half: form.half.value === '1', out_time: form.out_time.value, return_time: form.return_time.value,
      from: form.from.value, to: form.to.value, dates: $$('input[name=d]', form).map((i) => i.value).filter(Boolean),
      reason: form.reason.value,
    };
    const missing = !emp.email_hint && !body.email ? 'Please type your email.' : !body.leave_type ? 'Choose the leave type.' : '';
    if (missing) { errorBox(errBox, missing); errBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const btn = $('button[type=submit]', form);
    busy(btn, true, 'Sending…');
    try {
      const res = await api('/portal/request', body);
      showDone(res);
    } catch (err) {
      if (err.message === 'SIGNED_OUT') return;
      errorBox(errBox, err.message);
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      busy(btn, false, 'Submit');
    }
  });
  update();
}

// ---------------------------------------------------------------- Work From Home / Onsite request (not leave)
async function showWork(type = 'Work From Home') {
  shell(`${topBar('Work From Home')}<div id="apply-body"><div class="app-loading"><span class="spinner"></span></div></div>`);
  $('#back').addEventListener('click', showHome);
  let o;
  try { o = await api('/portal/options'); } catch (err) { if (err.message !== 'SIGNED_OUT') $('#apply-body').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  const weekend = new Set(String(o.weekend || '').split(',').filter((x) => x !== '').map(Number));
  const holidays = new Set(o.holidays);
  const isWorking = (d) => !weekend.has(toUtc(d).getUTCDay()) && !holidays.has(d);
  const countWorking = (from, to) => { let n = 0; for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) if (isWorking(d)) n++; return n; };
  const dateInput = (name) => `<input type="date" name="${name}" min="${o.today}" aria-label="Date">`;

  $('#apply-body').innerHTML = `<form class="app-box form apply" id="work-form" novalidate>
      <p class="work-note">This is <b>not leave</b>. No leave balance is used. Your department head approves it.
        Without an approved request you work at the office.</p>
      <input type="hidden" name="work_type" value="Work From Home"><input type="hidden" name="location" value="">
      ${step(1, 'Date(s)', `
        <fieldset class="field"><span>How many days?</span>
          <div class="segmented">
            <label><input type="radio" name="mode" value="one" checked><span>One day</span></label>
            <label><input type="radio" name="mode" value="range"><span>Days in a row</span></label>
            <label><input type="radio" name="mode" value="dates"><span>Separate dates</span></label>
          </div></fieldset>
        <div id="one-box" class="form-grid"><label class="field"><span>Date *</span>${dateInput('date')}</label></div>
        <div id="range-box" class="form-grid" hidden>
          <label class="field"><span>From *</span>${dateInput('from')}</label>
          <label class="field"><span>To *</span>${dateInput('to')}</label>
        </div>
        <div id="dates-box" hidden>
          <div class="field"><span>Dates * (up to 10)</span><div id="date-list" class="date-list">${dateInput('d')}${dateInput('d')}</div></div>
          <button type="button" class="btn btn-small" id="add-date" style="margin-top:8px">+ Add a date</button>
        </div>
        <p class="summary" id="summary"></p>`)}
      ${step(2, 'Reason', `<label class="field"><span>Reason <small>(optional)</small></span><textarea name="reason" rows="3" maxlength="1000"></textarea></label>`)}
      <p class="form-error" hidden></p>
      <button class="btn-wide primary" type="submit"><span>Submit</span></button>
    </form>`;

  const form = $('#work-form');
  const errBox = $('.form-error', form);
  const mark = (n, on) => { const s = $(`[data-step="${n}"]`, form); if (s) s.classList.toggle('done', !!on); };
  function update() {
    const m = form.mode.value;
    $('#one-box').hidden = m !== 'one';
    $('#range-box').hidden = m !== 'range';
    $('#dates-box').hidden = m !== 'dates';
    let text = '';
    let datesOk = false;
    if (m === 'one' && form.date.value) {
      datesOk = isWorking(form.date.value);
      text = datesOk ? `✓ 1 working day · ${fmtDate(form.date.value)}` : `⚠ ${fmtDate(form.date.value)} is a weekend day / holiday.`;
    } else if (m === 'range' && form.from.value && form.to.value) {
      const n = form.to.value < form.from.value ? -1 : countWorking(form.from.value, form.to.value);
      datesOk = n > 0;
      text = n < 0 ? '⚠ "To" is before "From".' : n ? `✓ ${n} working day(s) · ${fmtDate(form.from.value)} → ${fmtDate(form.to.value)}` : '⚠ No working days in these dates.';
    } else if (m === 'dates') {
      const ds = [...new Set($$('input[name=d]', form).map((i) => i.value).filter(Boolean))];
      const off = ds.filter((d) => !isWorking(d));
      datesOk = ds.length > 0 && !off.length;
      if (ds.length) text = off.length ? `⚠ ${off.map(fmtDate).join(', ')}: weekend / holiday.` : `✓ ${ds.length} working day(s)`;
    }
    $('#summary').textContent = text;
    mark(1, datesOk);
    mark(2, !!form.reason.value.trim());
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  $('#add-date').addEventListener('click', () => {
    const list = $('#date-list');
    if (list.children.length < 10) { list.insertAdjacentHTML('beforeend', dateInput('d')); list.lastElementChild.focus(); }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = {
      request_id: requestId, work_type: form.work_type.value, location: form.work_type.value === 'Onsite' ? form.location.value.trim() : '',
      mode: form.mode.value, date: form.date.value, from: form.from.value, to: form.to.value,
      dates: $$('input[name=d]', form).map((i) => i.value).filter(Boolean), reason: form.reason.value,
    };
    const btn = $('button[type=submit]', form);
    busy(btn, true, 'Sending…');
    try {
      showDone(await api('/portal/work', body));
    } catch (err) {
      if (err.message === 'SIGNED_OUT') return;
      errorBox(errBox, err.message);
      errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      busy(btn, false, 'Submit');
    }
  });
  update();
}

// ---------------------------------------------------------------- Late arrival (inform only: today + a message)
function showLate() {
  shell(`${topBar('Late Arrival')}
    <form class="app-box form apply" id="late-form" novalidate>
      <p class="work-note">This only <b>informs</b> your department head. No approval is needed and no leave is used.</p>
      <label class="field"><span>Date</span><input type="text" value="${esc(fmtDate(state.today))} (today)" readonly></label>
      <label class="field"><span>Message *</span><textarea name="message" rows="4" maxlength="500" required
        placeholder="e.g. Heavy traffic - I will reach the office around 10:00"></textarea></label>
      <p class="form-error" hidden></p>
      <button class="btn-wide primary" type="submit"><span>Send</span></button>
    </form>`);
  $('#back').addEventListener('click', showHome);
  const form = $('#late-form');
  const errBox = $('.form-error', form);
  form.message.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const message = form.message.value.trim();
    if (!message) { errorBox(errBox, 'Please write a short message.'); return; }
    const btn = $('button[type=submit]', form);
    busy(btn, true, 'Sending…');
    try {
      showDone(await api('/portal/late', { request_id: requestId, message }));
    } catch (err) {
      if (err.message === 'SIGNED_OUT') return;
      errorBox(errBox, err.message);
      busy(btn, false, 'Send');
    }
  });
}

function showDone(res) {
  shell(`<div class="rq-done">
      <div class="rq-check" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="45"/><path d="M30 52 l14 14 l27 -30"/></svg></div>
      <h2>Request sent</h2>
      <div class="rq-ref">${esc(res.group_no)}</div>
      ${res.warnings && res.warnings.length ? `<p class="notice">${esc(res.warnings.join(' '))}</p>` : ''}
      <button class="btn-wide primary" id="to-home" type="button"><span>Done</span></button>
    </div>`);
  requestId = newId();
  state.filter = 'all';
  $('#to-home').addEventListener('click', showHome);
}

// ---------------------------------------------------------------- helpers
const KEY = 'lms_last_email';       // this device remembers the last email used to sign in
function remember(email) { try { localStorage.setItem(KEY, email); } catch { /* private mode */ } }
function lastEmail() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }

function footer() {
  if ($('.rq-foot')) return;
  const f = document.createElement('footer');
  f.className = 'rq-foot';
  f.textContent = `© ${state.today.slice(0, 4)} ${state.company_name} · Leave and Shift Management System`;
  document.querySelector('.rq-wrap').after(f);
}

async function start() {
  try {
    Object.assign(state, await fetch('/api/portal/brand').then((r) => r.json()));
    document.title = 'Leave and Shift Management System';
    footer();
    const res = await fetch('/api/portal/me');
    if (res.status === 401) return showLogin();
    const me = await res.json();
    if (!res.ok) throw new Error(me.error || 'Could not load the portal.');
    state.employee = me.employee;
    state.admin = me.admin || null;           // also a head / admin: { signedIn, pending }
    registerWorker();
    resyncPush('/api/portal/push/subscribe');
    showHome();
  } catch (err) {
    root.innerHTML = `<div class="rq-body"><h1 style="margin-top:24px">Leave portal</h1><p class="form-error">${esc(err.message)}</p></div>`;
  }
}

start();
