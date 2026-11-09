// Passwords, sessions and "who is signed in"
import { first, run } from './db.js';
import { fail, getCookie } from './http.js';
import { accessFromRows, permsFor, ROLE_LABELS } from './permissions.js';

const PBKDF2_ITERATIONS = 100000;            // the highest Cloudflare Workers allow
export const SESSION_COOKIE = 'lms_session';
export const SESSION_TTL = 12 * 60 * 60;     // 12 hours, extended while the app is used
export const MAX_TRIES = 5;                  // wrong passwords before a 15 minute stop

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

export const randomHex = (bytes = 32) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256 = async (text) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const nowSec = () => Math.floor(Date.now() / 1000);

export async function hashPassword(password, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt };
}

export async function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const test = (await hashPassword(password, salt)).hash;
  let diff = test.length ^ hash.length;
  for (let i = 0; i < test.length; i++) diff |= test.charCodeAt(i) ^ (hash.charCodeAt(i) || 0);
  return diff === 0;
}

export function checkPasswordRules(pw) {
  pw = String(pw || '');
  if (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) {
    fail(400, 'Password must be at least 8 characters and contain letters and numbers.');
  }
}

export function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const letters = [...bytes.slice(0, 7)].map((b) => chars[b % chars.length]).join('');
  const digits = [...bytes.slice(7)].map((b) => String(b % 10)).join('');
  return letters + digits;
}

// One person, one password: a login account linked to an employee (users.employee_id) and that
// employee's leave app always share the same password hash
export async function setPassword(env, userId, password, mustChange) {
  const { hash, salt } = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change = ?, failed_count = 0, locked_until = NULL WHERE id = ?')
      .bind(hash, salt, mustChange ? 1 : 0, userId),
    env.DB.prepare(`UPDATE employees SET portal_hash = ?, portal_salt = ?, portal_failed = 0, portal_locked_until = NULL
      WHERE id = (SELECT employee_id FROM users WHERE id = ?)`).bind(hash, salt, userId),
  ]);
}

// The leave app changed the password: the linked login account gets the same one
export function syncPasswordToUser(env, employeeId, hash, salt) {
  return run(env, `UPDATE users SET password_hash = ?, password_salt = ?, must_change = 0, failed_count = 0, locked_until = NULL
    WHERE employee_id = ?`, hash, salt, employeeId);
}

// The session id (hash of the cookie token) of a cookie, or ''
export async function cookieSessionId(request, name) {
  const token = getCookie(request, name);
  return /^[a-f0-9]{64}$/.test(token) ? sha256(token) : '';
}

export const REMEMBER_TTL = 30 * 24 * 60 * 60; // "Keep me logged in"

export async function createSession(env, userId, ttl = SESSION_TTL) {
  const token = randomHex(32);
  const now = nowSec();
  await run(env, 'DELETE FROM sessions WHERE expires_at < ?', now);
  await run(env, 'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', await sha256(token), userId, now + ttl, now);
  return token;
}

export async function loadSession(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const id = await sha256(token);
  const now = nowSec();
  const row = await first(env, `SELECT s.expires_at AS session_expires, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, id);
  if (!row || row.session_expires < now || row.status !== 'active') {
    if (row) await run(env, 'DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  if (row.session_expires - now < SESSION_TTL / 2) await run(env, 'UPDATE sessions SET expires_at = ? WHERE id = ?', now + SESSION_TTL, id);
  const me = await buildMe(env, row);
  me.sessionId = id;
  return me;
}

// Everything the server needs to know about the signed-in person (3 queries in one round trip).
// The employee record is the linked one (users.employee_id), else the one with the same email.
export async function buildMe(env, u) {
  const [acc, heads, emp] = await env.DB.batch([
    env.DB.prepare('SELECT perm_key, role, allowed FROM permissions'),
    env.DB.prepare('SELECT h.department_id, d.name FROM department_heads h JOIN departments d ON d.id = h.department_id WHERE h.user_id = ?').bind(u.id),
    env.DB.prepare(`SELECT e.id, e.emp_no, e.name, e.email, e.department_id, e.status, d.name AS department
                    FROM employees e LEFT JOIN departments d ON d.id = e.department_id
                    WHERE e.id = ? OR (? = 0 AND e.email <> '' AND e.email = ? COLLATE NOCASE) LIMIT 1`).bind(u.employee_id || 0, u.employee_id || 0, u.email),
  ]);
  const perms = permsFor(u.role, accessFromRows(acc.results));
  const employee = emp.results[0] && emp.results[0].status === 'Active' ? emp.results[0] : null;
  const isSuper = u.role === 'super_admin';
  const headOf = heads.results.map((h) => ({ id: h.department_id, name: h.name }));
  let deptIds = headOf.map((h) => h.id);
  if (!deptIds.length && employee && employee.department_id) deptIds = [employee.department_id];
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, roleLabel: ROLE_LABELS[u.role] || u.role,
    isSuper, mustChange: !!u.must_change, perms, scopeAll: isSuper || perms['scope.all'],
    deptIds, headOf, employee,
  };
}

export function publicMe(me) {
  return {
    id: me.id, email: me.email, name: me.name, role: me.role, roleLabel: me.roleLabel, isSuper: me.isSuper,
    mustChange: me.mustChange, perms: me.perms, scopeAll: me.scopeAll, deptIds: me.deptIds, headOf: me.headOf,
    employee: me.employee,
  };
}
