// Sign in, sign out, first-time setup, passwords
import { all, first, run } from '../db.js';
import { cookie, fail, json, readJson } from '../http.js';
import {
  buildMe, checkPasswordRules, createSession, MAX_TRIES, publicMe, REMEMBER_TTL, SESSION_COOKIE, setPassword, sha256, verifyPassword,
} from '../auth.js';
import { getSettings, publicSettings, saveSettings } from '../settings.js';
import { getLeaveTypes } from '../leave.js';
import { layout, sendEmail } from '../email.js';
import { checkPortalPassword, createPortalSession, findPortalEmployee, portalCookie } from './portal.js';
import { clean, esc, isEmail, lower, nowIso, todayIn } from '../utils.js';

const COOKIE_DAYS = 30 * 24 * 3600;

function withSession(c, token, body) {
  const secure = c.url.protocol === 'https:';
  return json(body, 200, { 'set-cookie': cookie(SESSION_COOKIE, token, { maxAge: COOKIE_DAYS, secure }) });
}

async function setupStatus(c) {
  return { needed: !(await first(c.env, 'SELECT id FROM users LIMIT 1')) };
}

// First run only: creates the Super admin
async function setup(c) {
  if (await first(c.env, 'SELECT id FROM users LIMIT 1')) fail(403, 'Setup is already done. Please sign in.');
  const b = await readJson(c.request);
  const name = clean(b.name);
  const email = lower(b.email);
  if (!name) fail(400, 'Enter your name.');
  if (!isEmail(email)) fail(400, 'Enter a valid email.');
  checkPasswordRules(b.password);
  if (clean(b.company_name)) await saveSettings(c.env, { company_name: b.company_name });
  const res = await run(c.env, `INSERT INTO users (email, name, role, status, must_change) VALUES (?, ?, 'super_admin', 'active', 0)`, email, name);
  const userId = res.meta.last_row_id;
  await setPassword(c.env, userId, b.password, false);
  return withSession(c, await createSession(c.env, userId), { ok: true });
}

// ONE sign-in for everyone - the EMAIL decides the app:
//   email has a Login account (Super admin / Admin / Department head) -> the main system ('/')
//   email is only in Employees                                         -> the leave request app ('/request/')
async function signin(c) {
  const { env } = c;
  const b = await readJson(c.request);
  const email = lower(b.email);
  const password = String(b.password || '');
  if (!email || !password) fail(400, 'Enter your email and password.');
  const now = Date.now();
  const lockedNow = (until) => until && Date.parse(until) > now;
  const nextFail = (n) => (n + 1 >= MAX_TRIES ? { n: 0, until: new Date(now + 15 * 60000).toISOString() } : { n: n + 1, until: null });
  const secure = c.url.protocol === 'https:';

  const u = await first(env, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', email);
  if (u) {
    if (lockedNow(u.locked_until)) fail(429, 'Too many wrong passwords. Please try again in 15 minutes.');
    if (u.status !== 'active') fail(401, 'This account is disabled. Please ask an admin.');
    if (!await verifyPassword(password, u.password_hash, u.password_salt)) {
      const x = nextFail(u.failed_count);
      await run(env, 'UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?', x.n, x.until, u.id);
      fail(401, 'Wrong email or password.');
    }
    await run(env, 'UPDATE users SET failed_count = 0, locked_until = NULL, last_login = ? WHERE id = ?', nowIso(), u.id);
    // "Keep me logged in": 30 days; otherwise until the browser is closed (and at most 12 hours of not using it)
    const remember = b.remember === true || b.remember === 'on';
    const token = await createSession(env, u.id, remember ? REMEMBER_TTL : undefined);
    return json({ ok: true, target: '/' }, 200, { 'set-cookie': cookie(SESSION_COOKIE, token, { maxAge: remember ? COOKIE_DAYS : null, secure }) });
  }

  const e = await findPortalEmployee(env, email);
  if (!e) fail(401, 'Wrong email or password.');
  if (lockedNow(e.portal_locked_until)) fail(429, 'Too many wrong passwords. Please try again in 15 minutes.');
  if (e.status !== 'Active') fail(401, 'This account is not active. Please contact HR.');
  if (!await checkPortalPassword(e, password)) {
    const x = nextFail(e.portal_failed);
    await run(env, 'UPDATE employees SET portal_failed = ?, portal_locked_until = ? WHERE id = ?', x.n, x.until, e.id);
    fail(401, 'Wrong email or password.');
  }
  return json({ ok: true, target: '/request/' }, 200, { 'set-cookie': portalCookie(c, await createPortalSession(env, e.id)) });
}

async function logout(c) {
  const me = c.me;
  if (me) await run(c.env, 'DELETE FROM sessions WHERE id = ?', me.sessionId);
  return json({ ok: true }, 200, { 'set-cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure: c.url.protocol === 'https:' }) });
}

async function changePassword(c) {
  const b = await readJson(c.request);
  const u = await first(c.env, 'SELECT * FROM users WHERE id = ?', c.me.id);
  if (!await verifyPassword(String(b.current || ''), u.password_hash, u.password_salt)) fail(400, 'The current password is wrong.');
  checkPasswordRules(b.password);
  if (b.password === b.current) fail(400, 'The new password must be different.');
  await setPassword(c.env, u.id, b.password, false);
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', u.id, c.me.sessionId);
  return { ok: true };
}

// Sends a 6-digit code. Always answers OK so nobody can test which emails exist.
async function forgot(c) {
  const b = await readJson(c.request);
  const email = lower(b.email);
  const u = isEmail(email) ? await first(c.env, `SELECT id, name, email FROM users WHERE email = ? COLLATE NOCASE AND status = 'active'`, email) : null;
  if (u) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    const code = String(n).padStart(6, '0');
    await run(c.env, `INSERT INTO reset_codes (email, code_hash, expires_at, tries) VALUES (?, ?, ?, 0)
                      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0`,
      u.email, await sha256(`${u.email.toLowerCase()}:${code}`), Math.floor(Date.now() / 1000) + 15 * 60);
    const settings = await getSettings(c.env);
    c.waitUntil(sendEmail(c.env, settings, {
      to: u.email, subject: 'Your password reset code',
      html: layout(settings, `<p>Hi ${esc(u.name)},</p><p>Your password reset code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It works for 15 minutes. If you did not ask for it, ignore this email.</p>`),
    }));
  }
  return { ok: true };
}

async function reset(c) {
  const b = await readJson(c.request);
  const email = lower(b.email);
  const code = clean(b.code);
  const rec = await first(c.env, 'SELECT * FROM reset_codes WHERE email = ? COLLATE NOCASE', email);
  if (!rec || rec.expires_at < Date.now() / 1000 || rec.tries >= 5) fail(400, 'The code is wrong or has expired. Ask for a new code.');
  if (rec.code_hash !== await sha256(`${email}:${code}`)) {
    await run(c.env, 'UPDATE reset_codes SET tries = tries + 1 WHERE email = ?', email);
    fail(400, 'The code is wrong or has expired. Ask for a new code.');
  }
  checkPasswordRules(b.password);
  const u = await first(c.env, 'SELECT id FROM users WHERE email = ? COLLATE NOCASE', email);
  if (!u) fail(400, 'Account not found.');
  await setPassword(c.env, u.id, b.password, false);
  await run(c.env, 'DELETE FROM reset_codes WHERE email = ?', email);
  await run(c.env, 'DELETE FROM sessions WHERE user_id = ?', u.id);
  return { ok: true };
}

async function brand(c) {
  const s = await getSettings(c.env);
  return { company_name: s.company_name, brand_color: s.brand_color, logo_url: s.logo_url };
}

// Everything the app needs when it starts
async function bootstrap(c) {
  const settings = await getSettings(c.env);
  const today = todayIn(settings.timezone);
  const [types, departments, holidays] = await Promise.all([
    getLeaveTypes(c.env, true),
    all(c.env, 'SELECT id, name FROM departments ORDER BY name'),
    all(c.env, 'SELECT date, name FROM holidays WHERE date >= ? ORDER BY date', `${Number(today.slice(0, 4)) - 1}-01-01`),
  ]);
  return { me: publicMe(c.me), settings: publicSettings(settings), today, types, departments, holidays };
}

async function me(c) {
  const u = await first(c.env, 'SELECT * FROM users WHERE id = ?', c.me.id);
  return publicMe(await buildMe(c.env, u));
}

export default [
  { method: 'GET', path: '/api/brand', auth: false, handler: brand },
  { method: 'GET', path: '/api/setup', auth: false, handler: setupStatus },
  { method: 'POST', path: '/api/setup', auth: false, handler: setup },
  { method: 'POST', path: '/api/auth/signin', auth: false, handler: signin },
  { method: 'POST', path: '/api/auth/logout', auth: 'optional', handler: logout },
  { method: 'POST', path: '/api/auth/forgot', auth: false, handler: forgot },
  { method: 'POST', path: '/api/auth/reset', auth: false, handler: reset },
  { method: 'POST', path: '/api/auth/password', allowMustChange: true, handler: changePassword },
  { method: 'GET', path: '/api/auth/me', allowMustChange: true, handler: me },
  { method: 'GET', path: '/api/bootstrap', allowMustChange: true, handler: bootstrap },
];
