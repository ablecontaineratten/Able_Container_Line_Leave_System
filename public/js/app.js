// App start, sign-in state, navigation and the page router (#/page)
import { get, post, setUnauthorizedHandler } from './api.js';
import { $, $$, esc, loadingHtml, toast } from './ui.js';
import { renderForceChange, renderLogin, renderSetup } from './pages/auth.js';
import { registerWorker, resyncPush } from './push.js';
import { setTimeZone } from './components/requests.js';
import { PHONE, canDecide, greeting, renderLite, setView, wantsLite } from './lite.js';
import home from './pages/home.js';
import myLeave from './pages/my-leave.js';
import apply from './pages/apply.js';
import approvals from './pages/approvals.js';
import requests from './pages/requests.js';
import calendar from './pages/calendar.js';
import team from './pages/team.js';
import summary from './pages/summary.js';
import reports from './pages/reports.js';
import employees from './pages/employees.js';
import departments from './pages/departments.js';
import users from './pages/users.js';
import settings from './pages/settings.js';
import access from './pages/access.js';
import usage from './pages/usage.js';
import profile from './pages/profile.js';

const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  check: 'M20 6L9 17l-5-5',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z',
  calendar: 'M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10h18M8 3v4M16 3v4',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  id: 'M3 5h18v14H3zM7 15c.5-1.5 1.7-2 3-2s2.5.5 3 2M10 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15 9h3M15 13h3',
  building: 'M4 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M16 9h3a1 1 0 0 1 1 1v11M8 7h4M8 11h4M8 15h4M2 21h20',
  key: 'M15 7a4 4 0 1 1-3.9 5H9v2H7v2H4v-3l5.1-5.1A4 4 0 0 1 15 7z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  more: 'M4 6h16M4 12h16M4 18h10',
};
// phone screens: bottom tabs (first 4 of these the person can open) + "More" for the full menu
const PHONE_TABS = [['home', 'Home'], ['approvals', 'Approvals'], ['my-leave', 'My Leave'], ['calendar', 'Calendar'], ['requests', 'Requests'], ['summary', 'Chart']];
export const icon = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;

const ROUTES = [
  { path: 'home', label: 'Home', icon: 'home', page: home },
  // only for people whose login email is also in Employees (for example a head who takes leave too)
  { path: 'my-leave', label: 'My Leave', icon: 'list', page: myLeave, perm: 'mine.view', employee: true },
  { path: 'apply', label: 'Request Leave', icon: 'plus', page: apply, perm: 'leave.apply', employee: true },
  { path: 'approvals', label: 'Approvals', icon: 'check', page: approvals, perm: ['approve.decide', 'requests.manage'], badge: true },
  { path: 'requests', label: 'All requests', icon: 'inbox', page: requests, perm: 'requests.view' },
  { path: 'calendar', label: 'Calendar', icon: 'calendar', page: calendar, perm: 'calendar.view' },
  { path: 'team', label: 'Leave Summary', icon: 'users', page: team, perm: 'team.view' },
  { path: 'summary', label: 'Leave Chart', icon: 'grid', page: summary, perm: 'summary.view' },
  { path: 'reports', label: 'Reports', icon: 'chart', page: reports, perm: 'reports.view' },
  { path: 'employees', label: 'Employees', icon: 'id', page: employees, perm: 'employees.view', group: 'Admin' },
  { path: 'departments', label: 'Departments', icon: 'building', page: departments, perm: 'departments.view', group: 'Admin' },
  { path: 'users', label: 'Login accounts', icon: 'key', page: users, perm: 'users.view', group: 'Admin' },
  { path: 'settings', label: 'Settings', icon: 'gear', page: settings, perm: 'settings.view', group: 'Admin' },
  { path: 'access', label: 'Access control', icon: 'shield', page: access, perm: 'access.edit', group: 'Admin' },
  { path: 'usage', label: 'Usage', icon: 'chart', page: usage, perm: 'access.edit', group: 'Admin' },
  { path: 'profile', label: 'My account', icon: 'user', page: profile, hidden: true },
];

const state = { me: null, settings: null, types: [], departments: [], holidays: [], today: '' };
const root = $('#root');

const allowed = (r) => (!r.employee || !!state.me.employee) && (!r.perm || [].concat(r.perm).some((k) => state.me.perms[k]));
export const can = (key) => !!(state.me && state.me.perms[key]);

function applyBrand(b) {
  if (!b) return;
  if (/^#[0-9a-f]{6}$/i.test(b.brand_color || '')) document.documentElement.style.setProperty('--brand', b.brand_color);
  if (b.company_name) document.title = `${b.company_name} · Leave System`;
  state.brand = b;
}

async function loadBootstrap() {
  const data = await get('/bootstrap');
  Object.assign(state, data);
  setTimeZone(data.settings.timezone);
  applyBrand(data.settings);
}

const ctx = {
  state,
  go: (path) => { location.hash = `#/${path}`; },
  reload: async () => { await loadBootstrap(); renderShell(); route(); },
  refreshBadge,
};

async function refreshBadge() {
  const els = $$('.js-badge');
  if (!els.length) return;
  try {
    const d = await get('/dashboard');
    els.forEach((el) => { el.textContent = d.pendingCount || ''; el.hidden = !d.pendingCount; });
  } catch { /* ignore */ }
}

const bellHtml = () => `<img class="trial-stamp" src="/img/trial-stamp.svg" alt="Trial version"><div class="bell-wrap">
    <button class="icon-btn bell-btn" id="bell-btn" aria-label="Notifications" aria-haspopup="true">${icon('bell')}<em id="bell-count" hidden></em></button>
    <div class="dropdown bell-panel" id="bell-panel" hidden></div>
  </div>`;

// account menu + bell (the same in the full system and the phone app)
function wireHeader() {
  const dd = $('#user-dd');
  const bellPanel = $('#bell-panel');
  $('#user-btn').addEventListener('click', (e) => { e.stopPropagation(); bellPanel.hidden = true; dd.hidden = !dd.hidden; });
  $('#bell-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    dd.hidden = true;
    bellPanel.hidden = !bellPanel.hidden;
    if (!bellPanel.hidden) loadBell(true);
  });
  bellPanel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { dd.hidden = true; bellPanel.hidden = true; });
  $('#logout-btn').addEventListener('click', async () => { await post('/auth/logout').catch(() => {}); location.hash = ''; location.reload(); });
}

function renderShell() {
  const b = state.brand || {};
  const me = state.me;
  const items = ROUTES.filter((r) => !r.hidden && allowed(r));
  let group = '';
  const nav = items.map((r) => {
    const head = r.group && r.group !== group ? `<div class="nav-group">${esc(r.group)}</div>` : '';
    group = r.group || group;
    return `${head}<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${esc(r.label)}</span>${r.badge ? '<em class="nav-badge js-badge" hidden></em>' : ''}</a>`;
  }).join('');
  const tabs = PHONE_TABS.map(([p, label]) => [items.find((r) => r.path === p), label]).filter(([r]) => r).slice(0, 4)
    .map(([r, label]) => `<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${esc(label)}</span>${r.badge ? '<em class="js-badge" hidden></em>' : ''}</a>`).join('');
  const canApply = items.some((r) => r.path === 'apply');
  const initials = me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><img src="${esc(b.logo_url || '/img/logo-ship.png')}" alt="">
          <div><strong>Leave System</strong><small>${esc(b.company_name || '')}</small></div></div>
        <nav class="nav">${nav}</nav>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">${icon('menu')}</button>
          <div class="spacer"></div>
          ${bellHtml()}
          <div class="user-menu">
            <button class="user-btn" id="user-btn" aria-haspopup="true"><span class="avatar">${esc(initials)}</span>
              <span class="user-text"><small class="m-greet">${greeting()}</small><b>${esc(me.name)}</b><small class="role">${esc(me.roleLabel)}</small></span></button>
            <div class="dropdown" id="user-dd" hidden>
              <a href="#/profile">${icon('user')} My account</a>
              <a href="${me.perms['settings.view'] ? '#/settings?tab=notifications' : '#/profile'}">${icon('bell')} Notification settings</a>
              ${canDecide(me) ? `<button id="lite-back" class="m-only">${icon('check')} Simple phone view</button>` : ''}
              <button id="logout-btn">${icon('logout')} Sign out</button>
            </div>
          </div>
        </header>
        <main id="view" class="view" tabindex="-1"></main>
      </div>
      ${canApply ? `<a class="m-fab" id="m-fab" href="#/apply">${icon('plus')}<span>Request Leave</span></a>` : ''}
      <nav class="m-tabs" style="--n:${(tabs.match(/<a /g) || []).length + 1}">${tabs}
        <button type="button" id="m-more">${icon('more')}<span>More</span></button></nav>
      <div class="scrim" id="scrim"></div>
    </div>`;
  wireHeader();
  const liteBack = $('#lite-back');
  if (liteBack) liteBack.addEventListener('click', () => { setView(null); location.reload(); });
  const toggle = (open) => document.body.classList.toggle('nav-open', open);
  $('#menu-btn').addEventListener('click', () => toggle(!document.body.classList.contains('nav-open')));
  $('#m-more').addEventListener('click', () => toggle(!document.body.classList.contains('nav-open')));
  $('#scrim').addEventListener('click', () => toggle(false));
  refreshBadge();
}

// ---------------------------------------------------------------- notifications (bell + phone)
const timeAgo = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
};

async function loadBell(drawPanel = false) {
  let data;
  try { data = await get('/notifications'); } catch { return; }
  const count = $('#bell-count');
  if (count) { count.textContent = data.unread > 9 ? '9+' : data.unread; count.hidden = !data.unread; }
  const panel = $('#bell-panel');
  if (!drawPanel || !panel || panel.hidden) return;
  panel.innerHTML = `<div class="bell-head"><b>Notifications</b><span>${data.unread ? '<button class="link" id="read-all">Mark all read</button>' : ''}<button class="bell-del" id="del-picked" title="Delete selected" aria-label="Delete selected notifications" hidden>${TRASH_ICON}</button></span></div>
    <div class="bell-list">${data.rows.length ? data.rows.map((n) => `
      <div class="bell-row"><input type="checkbox" class="bell-check" value="${n.id}" aria-label="Select notification">
        <button class="bell-item ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-url="${esc(n.url)}">
        <b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(timeAgo(n.created_at))}</small></button></div>`).join('')
      : '<p class="muted small" style="padding:10px">No notifications yet.</p>'}</div>`;
  const all = $('#read-all', panel);
  if (all) all.addEventListener('click', async () => { await post('/notifications/read', { all: true }).catch(() => {}); loadBell(true); });
  // tick boxes: the small red delete icon shows once at least one is ticked
  const delPicked = $('#del-picked', panel);
  const picked = () => [...panel.querySelectorAll('.bell-check:checked')].map((x) => Number(x.value));
  panel.querySelectorAll('.bell-check').forEach((x) => x.addEventListener('change', () => { delPicked.hidden = !picked().length; }));
  delPicked.addEventListener('click', async () => {
    await post('/notifications/delete', { ids: picked() }).catch((err) => toast(err.message, 'error'));
    loadBell(true);
  });
  panel.querySelectorAll('.bell-item').forEach((b) => b.addEventListener('click', async () => {
    await post('/notifications/read', { id: Number(b.dataset.id) }).catch(() => {});
    panel.hidden = true;
    const url = b.dataset.url || '/';
    if (url.startsWith('/#')) location.hash = url.slice(1); else location.href = url;
    loadBell();
  }));
}

const TRASH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';

let routeToken = 0;
async function route() {
  const view = $('#view');
  if (!view) return;
  const [path, queryString] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  document.body.classList.remove('nav-open');
  $$('.nav a, .m-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.path === r.path));
  const tabbed = $$('.m-tabs a').some((a) => a.dataset.path === r.path);
  const more = $('#m-more');
  if (more) more.classList.toggle('active', !tabbed);
  const fab = $('#m-fab');
  if (fab) fab.hidden = r.path !== 'home' && r.path !== 'my-leave';
  if (!allowed(r)) { view.innerHTML = '<div class="empty">You do not have access to this page.</div>'; return; }
  const token = ++routeToken;
  view.innerHTML = loadingHtml();
  try {
    await r.page(view, { ...ctx, query: new URLSearchParams(queryString || ''), isCurrent: () => token === routeToken });
  } catch (err) {
    if (token === routeToken) view.innerHTML = `<div class="empty error">${esc(err.message)}</div>`;
  }
  if (token === routeToken && !view.contains(document.activeElement)) view.focus({ preventScroll: true });
}

async function start() {
  setUnauthorizedHandler(() => {});
  applyBrand(await get('/brand').catch(() => null));
  try {
    const setup = await get('/setup');
    if (setup.needed) { renderSetup(root, state.brand, () => start()); return; }
    await loadBootstrap();
  } catch (err) {
    if (err.status === 401) { renderLogin(root, state.brand, () => start()); return; }
    root.innerHTML = `<div class="center-page"><div class="card auth-card"><h1>Cannot start</h1><p class="error">${esc(err.message)}</p></div></div>`;
    return;
  }
  if (state.me.mustChange) { renderForceChange(root, state.brand, () => start()); return; }
  // signed in: a 401 from now on means the session ended
  setUnauthorizedHandler(() => { toast('Your session ended. Please sign in again.', 'error'); setTimeout(() => location.reload(), 1200); });
  // heads on a phone get the small approve / reject app; turning the screen into a bigger one swaps back
  const lite = wantsLite(state.me);
  PHONE.addEventListener('change', () => { if (wantsLite(state.me) !== lite) location.reload(); });
  registerWorker();
  resyncPush('/api/push/subscribe');
  if (lite) {
    renderLite(root, ctx, { bell: bellHtml() });
    wireHeader();
    loadBell();
    setInterval(loadBell, 60000);
    return;
  }
  renderShell();
  loadBell();
  setInterval(() => { loadBell(); refreshBadge(); }, 60000);
  window.onhashchange = route;
  route();
}

start();
