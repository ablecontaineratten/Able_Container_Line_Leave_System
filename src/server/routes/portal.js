// Employee portal (/request): email + password. Separate from the admin / head app.
// Every employee starts with the default password (DEFAULT_PASSWORD) until they change it in Settings.
// Employees see their own balance and requests, and send leave requests.
import { all, first, run } from '../db.js';
import { cookie, fail, getCookie, HttpError, readJson, withCookies } from '../http.js';
import {
  checkPasswordRules, cookieSessionId, hashPassword, loadSession, randomHex, SESSION_COOKIE, sha256, syncPasswordToUser, verifyPassword,
} from '../auth.js';
import { scopeSql } from '../permissions.js';
import { getSettings, weekendSet } from '../settings.js';
import { balanceSummary, createRequest, decideRequests, getHolidaySet, getLeaveTypes, workingDates } from '../leave.js';
import { clean, isEmail, lower, nowIso, todayIn } from '../utils.js';
import { portalWorkRows, workPendingCount } from './work.js';
import { portalLateRows } from './late.js';

export const DEFAULT_PASSWORD = 'user@123';
export const PORTAL_COOKIE = 'lms_emp';
const COOKIE = PORTAL_COOKIE;
const TTL = 12 * 60 * 60;                 // 12 hours, extended while used
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- used by the one sign-in for everyone (routes/auth.js → /api/auth/signin)
export const findPortalEmployee = (env, email) => (isEmail(email)
  ? first(env, `SELECT * FROM employees WHERE email <> '' AND email = ? COLLATE NOCASE`, email) : Promise.resolve(null));

export async function createPortalSession(env, employeeId) {
  const token = randomHex(32);
  const now = nowSec();
  await run(env, 'DELETE FROM employee_sessions WHERE expires_at < ?', now);
  await run(env, 'INSERT INTO employee_sessions (id, employee_id, expires_at, created_at) VALUES (?, ?, ?, ?)', await sha256(token), employeeId, now + TTL, now);
  await run(env, 'UPDATE employees SET portal_failed = 0, portal_locked_until = NULL, portal_last_login = ? WHERE id = ?', nowIso(), employeeId);
  return token;
}

export const portalCookie = (c, token) => cookie(COOKIE, token, { maxAge: token ? 30 * 24 * 3600 : 0, secure: c.url.protocol === 'https:' });

// No own password yet (portal_hash empty) = the default password works
export const checkPortalPassword = (e, password) => (e.portal_hash
  ? verifyPassword(password, e.portal_hash, e.portal_salt)
  : Promise.resolve(password === DEFAULT_PASSWORD));

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '';
  return `${user.slice(0, Math.min(2, user.length))}${'*'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
}

// The signed-in employee, or 401
export async function portalEmployee(c) {
  const token = getCookie(c.request, COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Please sign in.');
  const id = await sha256(token);
  const e = await first(c.env, `SELECT s.expires_at AS session_expires, e.*, d.name AS department FROM employee_sessions s
    JOIN employees e ON e.id = s.employee_id LEFT JOIN departments d ON d.id = e.department_id WHERE s.id = ?`, id);
  const now = nowSec();
  if (!e || e.session_expires < now || e.status !== 'Active' || !isEmail(e.email)) {
    if (e) await run(c.env, 'DELETE FROM employee_sessions WHERE id = ?', id);
    fail(401, 'Please sign in.');
  }
  if (e.session_expires - now < TTL / 2) await run(c.env, 'UPDATE employee_sessions SET expires_at = ? WHERE id = ?', now + TTL, id);
  e.sessionId = id;
  return e;
}

export async function portalEmployeeOrNull(c) {
  try { return await portalEmployee(c); } catch { return null; }
}

const publicEmployee = (e) => ({
  id: e.id, emp_no: e.emp_no, name: e.name, department: e.department || '', email: e.email,
  email_hint: isEmail(e.email) ? maskEmail(e.email) : '', using_default: !e.portal_hash,
  photo: e.photo ? `/api/portal/photo?v=${encodeURIComponent(e.photo_at || '')}` : '',
});

// Profile photo: a data URL of a small JPEG / PNG / WebP (resized in the app before upload)
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO = 300 * 1024;

export function photoResponse(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) fail(404, 'No photo.');
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  // the URL carries ?v=<time saved>, so the photo can be cached
  return new Response(bytes, { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=31536000' } });
}

async function savePhoto(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  const data = String(b.photo || '');
  if (data && (!PHOTO_RE.test(data) || data.length > MAX_PHOTO)) fail(400, 'Please choose a smaller photo (JPEG or PNG).');
  const at = data ? new Date().toISOString() : null;
  await run(c.env, 'UPDATE employees SET photo = ?, photo_at = ? WHERE id = ?', data, at, e.id);
  return { photo: data ? `/api/portal/photo?v=${encodeURIComponent(at)}` : '' };
}

async function myPhoto(c) {
  return photoResponse((await portalEmployee(c)).photo);
}

async function brand(c) {
  const s = await getSettings(c.env);
  return { company_name: s.company_name, today: todayIn(s.timezone), timezone: s.timezone };
}

// Signs out of BOTH the leave app and the system (a head / admin is one person with one sign-in)
export async function signOutBoth(c) {
  const [adminId, empId] = await Promise.all([cookieSessionId(c.request, SESSION_COOKIE), cookieSessionId(c.request, COOKIE)]);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(adminId),
    c.env.DB.prepare('DELETE FROM employee_sessions WHERE id = ?').bind(empId),
  ]);
  return withCookies({ ok: true }, [cookie(SESSION_COOKIE, '', { maxAge: 0, secure: c.url.protocol === 'https:' }), portalCookie(c, '')]);
}

const logout = (c) => signOutBoth(c);

// Employee ⇄ Admin switch: null for a plain employee; else whether the system session of the same person is
// open, and how many leave / Work From Home requests wait for them (the badge on "Admin")
async function adminInfo(c, e) {
  const u = await first(c.env, `SELECT id FROM users WHERE employee_id = ? AND status = 'active'`, e.id);
  if (!u) return null;
  const me = await loadSession(c.env, c.request).catch(() => null);
  if (!me || me.id !== u.id || me.mustChange) return { signedIn: false, pending: 0 };
  let pending = await workPendingCount(c.env, me);
  if (me.perms['approve.decide'] || me.perms['requests.manage']) {
    const s = scopeSql(me);
    const row = await first(c.env, `SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'Pending' AND ${s.sql} AND (employee_id IS NULL OR employee_id <> ?)`,
      ...s.args, e.id);
    pending += row.n;
  }
  return { signedIn: true, pending };
}

async function me(c) {
  const e = await portalEmployee(c);
  return { employee: publicEmployee(e), admin: await adminInfo(c, e), ...(await brand(c)) };
}

async function changePassword(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  if (!await checkPortalPassword(e, String(b.current || ''))) fail(400, 'The current password is wrong.');
  checkPasswordRules(b.password);
  if (b.password === b.current) fail(400, 'The new password must be different.');
  if (b.password === DEFAULT_PASSWORD) fail(400, 'Please choose a password different from the default one.');
  const { hash, salt } = await hashPassword(b.password);
  await run(c.env, 'UPDATE employees SET portal_hash = ?, portal_salt = ?, portal_must_change = 0 WHERE id = ?', hash, salt, e.id);
  await syncPasswordToUser(c.env, e.id, hash, salt);           // one password: the system login changes too
  const adminId = await cookieSessionId(c.request, SESSION_COOKIE);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM employee_sessions WHERE employee_id = ? AND id <> ?').bind(e.id, e.sessionId),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id = ?) AND id <> ?').bind(e.id, adminId),
  ]);
  return { ok: true };
}

// Balance + every request of this employee
async function summary(c) {
  const e = await portalEmployee(c);
  const settings = await getSettings(c.env);
  const today = todayIn(settings.timezone);
  const [balance, requests, types, holidays, work, late] = await Promise.all([
    balanceSummary(c.env, e.id, today, { settings }),
    all(c.env, `SELECT id, request_no, group_no, leave_type, from_date, to_date, day_type, out_time, return_time, days, hours, reason,
      status, remark, decided_by, decided_at, submitted_at FROM leave_requests WHERE employee_id = ? ORDER BY from_date DESC, id DESC LIMIT 300`, e.id),
    getLeaveTypes(c.env),
    getHolidaySet(c.env),
    portalWorkRows(c.env, e.id),                 // Work From Home requests (not leave)
    portalLateRows(c.env, e.id),                 // late arrival messages (inform only)
  ]);
  const wfh_limit = { period: settings.wfh_limit_period || '', days: Number(settings.wfh_limit_days) || 0, year_start: settings.year_start };
  return { employee: publicEmployee(e), today, balance, requests, work, late, wfh_limit, taken: takenDates(requests, types, settings, holidays, balance.year) };
}

// Approved leave days of this leave year, one date per working day, newest first:
// annual / casual = full days of that type, half = every half day, short = short leaves
function takenDates(requests, types, settings, holidays, year) {
  const weekend = weekendSet(settings);
  const isShort = new Set(types.filter((t) => t.is_short).map((t) => t.name.toLowerCase()));
  const out = { annual: [], casual: [], half: [], short: [] };
  for (const r of requests) {
    if (r.status !== 'Approved' || r.from_date < year.start || r.from_date >= year.end) continue;
    const type = String(r.leave_type).toLowerCase();
    const key = isShort.has(type) ? 'short' : r.day_type === 'Half Day' ? 'half'
      : /annual/.test(type) ? 'annual' : /casual/.test(type) ? 'casual' : '';
    if (!key) continue;
    const dates = r.from_date === r.to_date ? [r.from_date] : workingDates(r.from_date, r.to_date, weekend, holidays);
    out[key].push(...dates);
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])].sort().reverse();
  return out;
}

// What the request form needs
async function formOptions(c) {
  const e = await portalEmployee(c);
  const settings = await getSettings(c.env);
  const today = todayIn(settings.timezone);
  const [types, holidays] = await Promise.all([
    getLeaveTypes(c.env, true),
    all(c.env, 'SELECT date FROM holidays WHERE date >= ?', today),
  ]);
  return {
    employee: publicEmployee(e), company_name: settings.company_name, today, weekend: settings.weekend,
    holidays: holidays.map((h) => h.date),
    types: types.map((t) => ({ name: t.name, is_short: !!t.is_short, allow_half: !!t.allow_half })),
  };
}

async function submit(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  const requestId = clean(b.request_id);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) fail(400, 'Please reload the page and try again.');
  const responseId = `portal-${requestId}`;
  const done = await first(c.env, 'SELECT group_no FROM leave_requests WHERE form_response_id = ? LIMIT 1', responseId);
  if (done) return { ok: true, group_no: done.group_no };           // double click: already saved

  const email = lower(b.email);
  if (email && !isEmail(email)) fail(400, 'The email is not valid.');
  if (!isEmail(e.email) && !email) fail(400, 'First time: please type your email. It will be remembered for next time.');

  const actor = { id: null, name: e.name, email: '', isSuper: false, perms: { 'leave.apply': true }, scopeAll: false, deptIds: [], employee: e };
  const res = await createRequest({ ...c, me: actor }, {
    leave_type: b.leave_type, mode: b.mode, date: b.date, half: !!b.half, from: b.from, to: b.to, dates: b.dates,
    out_time: b.out_time, return_time: b.return_time, reason: b.reason,
    times_optional: true, contact_email: email, note: 'Via employee portal', form_response_id: responseId,
  });
  let emailSaved = false;
  if (email && !isEmail(e.email) && !await first(c.env, 'SELECT id FROM employees WHERE email = ? COLLATE NOCASE AND id <> ?', email, e.id)) {
    await run(c.env, `UPDATE employees SET email = ? WHERE id = ? AND email = ''`, email, e.id);
    emailSaved = true;
  }
  return { ok: true, group_no: res.group_no, warnings: res.warnings, email_saved: emailSaved };
}

// The employee withdraws their own PENDING request
async function withdraw(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  const row = await first(c.env, 'SELECT id, group_no FROM leave_requests WHERE id = ? AND employee_id = ?', Number(b.id), e.id);
  if (!row) fail(404, 'Request not found.');
  const ids = (await all(c.env, `SELECT id FROM leave_requests WHERE group_no = ? AND employee_id = ? AND status = 'Pending'`, row.group_no, e.id)).map((r) => r.id);
  if (!ids.length) fail(400, 'Only pending requests can be withdrawn.');
  const actor = { me: { id: null, name: e.name, isSuper: false, perms: {}, scopeAll: false, deptIds: [], employee: e }, name: e.name };
  const res = await decideRequests(c, actor, ids, 'Cancelled', null);
  if (!res.updated) throw new HttpError(400, res.skipped.map((s) => s.reason).join(' ') || 'Could not withdraw.');
  return { ok: true, withdrawn: res.updated };
}

export default [
  { method: 'GET', path: '/api/portal/brand', auth: false, handler: brand },
  { method: 'POST', path: '/api/portal/logout', auth: false, handler: logout },
  { method: 'GET', path: '/api/portal/me', auth: false, handler: me },
  { method: 'POST', path: '/api/portal/password', auth: false, handler: changePassword },
  { method: 'POST', path: '/api/portal/photo', auth: false, handler: savePhoto },
  { method: 'GET', path: '/api/portal/photo', auth: false, handler: myPhoto },
  { method: 'GET', path: '/api/portal/summary', auth: false, handler: summary },
  { method: 'GET', path: '/api/portal/options', auth: false, handler: formOptions },
  { method: 'POST', path: '/api/portal/request', auth: false, handler: submit },
  { method: 'POST', path: '/api/portal/withdraw', auth: false, handler: withdraw },
];
