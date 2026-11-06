// Notifications: phone push subscriptions, the bell list, and what the service worker shows
import { all, first, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { loadSession } from '../auth.js';
import { notify, saveSubscription, vapidKeys } from '../push.js';
import { getSettings } from '../settings.js';
import { portalEmployeeOrNull } from './portal.js';

async function publicKey(c) {
  return { publicKey: (await vapidKeys(c.env)).publicKey };
}

// admin / head app
async function subscribeUser(c) {
  try { await saveSubscription(c.env, 'user', c.me.id, await readJson(c.request)); } catch (err) { fail(400, err.message); }
  return { ok: true };
}

// employee app
async function subscribeEmployee(c) {
  const e = await portalEmployeeOrNull(c);
  if (!e) fail(401, 'Please sign in.');
  try { await saveSubscription(c.env, 'employee', e.id, await readJson(c.request)); } catch (err) { fail(400, err.message); }
  return { ok: true };
}

async function unsubscribe(c) {
  const b = await readJson(c.request);
  await run(c.env, 'DELETE FROM push_subscriptions WHERE endpoint = ?', String(b.endpoint || ''));
  return { ok: true };
}

async function list(c) {
  const rows = await all(c.env, `SELECT id, title, body, url, read_at, created_at FROM notifications
    WHERE owner_type = 'user' AND owner_id = ? ORDER BY id DESC LIMIT 40`, c.me.id);
  const unread = await first(c.env, `SELECT COUNT(*) AS n FROM notifications WHERE owner_type = 'user' AND owner_id = ? AND read_at IS NULL`, c.me.id);
  return { rows, unread: unread.n };
}

async function markRead(c) {
  const b = await readJson(c.request);
  const now = new Date().toISOString();
  if (b.all) await run(c.env, `UPDATE notifications SET read_at = ? WHERE owner_type = 'user' AND owner_id = ? AND read_at IS NULL`, now, c.me.id);
  else await run(c.env, `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE owner_type = 'user' AND owner_id = ? AND id = ?`, now, c.me.id, Number(b.id));
  return { ok: true };
}

// Deletes MY notifications in the system (each person's own only): { ids: [..] } or { all: true }
async function deleteMine(c) {
  const b = await readJson(c.request);
  if (b.all) {
    const res = await run(c.env, `DELETE FROM notifications WHERE owner_type = 'user' AND owner_id = ?`, c.me.id);
    return { deleted: res.meta.changes };
  }
  const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean).slice(0, 200);
  if (!ids.length) fail(400, 'Choose notifications to delete.');
  const res = await run(c.env, `DELETE FROM notifications WHERE owner_type = 'user' AND owner_id = ? AND id IN (${ids.map(() => '?').join(', ')})`, c.me.id, ...ids);
  return { deleted: res.meta.changes };
}

// Called by the service worker when a push arrives: the newest unread notifications of whoever is signed in
// on this phone (admin app and / or employee app). The same notification id replaces itself, so nothing shows twice.
async function pending(c) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const items = [];
  const me = await loadSession(c.env, c.request).catch(() => null);
  if (me) items.push(...await all(c.env, `SELECT id, title, body, url FROM notifications WHERE owner_type = 'user' AND owner_id = ?
    AND read_at IS NULL AND created_at >= ? ORDER BY id DESC LIMIT 5`, me.id, since));
  const emp = await portalEmployeeOrNull(c);
  if (emp) items.push(...await all(c.env, `SELECT id, title, body, url FROM notifications WHERE owner_type = 'employee' AND owner_id = ?
    AND read_at IS NULL AND created_at >= ? ORDER BY id DESC LIMIT 5`, emp.id, since));
  return { items };
}

// "Send test notification": a notification to my own phone(s) right now
async function testUser(c) {
  const settings = await getSettings(c.env);
  return { result: await notify(c.env, 'user', [c.me.id], { title: 'Test notification', body: 'Phone notifications are working.', url: '/' }, settings.app_url || c.origin) };
}

async function testEmployee(c) {
  const e = await portalEmployeeOrNull(c);
  if (!e) fail(401, 'Please sign in.');
  const settings = await getSettings(c.env);
  return { result: await notify(c.env, 'employee', [e.id], { title: 'Test notification', body: 'Notifications are working.', url: '/request/' }, settings.app_url || c.origin) };
}

// employee app bell: my notifications (newest first) + how many are unread
async function employeeList(c) {
  const e = await portalEmployeeOrNull(c);
  if (!e) fail(401, 'Please sign in.');
  const rows = await all(c.env, `SELECT id, title, body, url, read_at, created_at FROM notifications
    WHERE owner_type = 'employee' AND owner_id = ? ORDER BY id DESC LIMIT 100`, e.id);
  return { rows, unread: rows.filter((r) => !r.read_at).length };
}

// { ids: [..] } marks those as read; no ids = all
async function employeeRead(c) {
  const e = await portalEmployeeOrNull(c);
  if (!e) fail(401, 'Please sign in.');
  const b = await readJson(c.request);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 200);
  const now = new Date().toISOString();
  if (ids.length) {
    await run(c.env, `UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE owner_type = 'employee' AND owner_id = ? AND id IN (${ids.map(() => '?').join(', ')})`, now, e.id, ...ids);
  } else {
    await run(c.env, `UPDATE notifications SET read_at = ? WHERE owner_type = 'employee' AND owner_id = ? AND read_at IS NULL`, now, e.id);
  }
  return { ok: true };
}

// Deletes the employee's OWN notifications only (heads' / admins' notifications in the system are separate rows)
async function employeeDelete(c) {
  const e = await portalEmployeeOrNull(c);
  if (!e) fail(401, 'Please sign in.');
  const b = await readJson(c.request);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 200);
  if (!ids.length) fail(400, 'Choose notifications to delete.');
  const res = await run(c.env, `DELETE FROM notifications WHERE owner_type = 'employee' AND owner_id = ? AND id IN (${ids.map(() => '?').join(', ')})`, e.id, ...ids);
  return { deleted: res.meta.changes };
}

export default [
  { method: 'GET', path: '/api/portal/notifications', auth: false, handler: employeeList },
  { method: 'POST', path: '/api/portal/notifications/read', auth: false, handler: employeeRead },
  { method: 'POST', path: '/api/portal/notifications/delete', auth: false, handler: employeeDelete },
  { method: 'POST', path: '/api/push/test', allowMustChange: true, handler: testUser },
  { method: 'POST', path: '/api/portal/push/test', auth: false, handler: testEmployee },
  { method: 'GET', path: '/api/push/key', auth: false, handler: publicKey },
  { method: 'POST', path: '/api/push/subscribe', allowMustChange: true, handler: subscribeUser },
  { method: 'POST', path: '/api/portal/push/subscribe', auth: false, handler: subscribeEmployee },
  { method: 'POST', path: '/api/push/unsubscribe', auth: false, handler: unsubscribe },
  { method: 'GET', path: '/api/notifications', handler: list },
  { method: 'POST', path: '/api/notifications/read', handler: markRead },
  { method: 'POST', path: '/api/notifications/delete', handler: deleteMine },
  { method: 'GET', path: '/api/notifications/pending', auth: false, handler: pending },
];
