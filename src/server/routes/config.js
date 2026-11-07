// Settings, leave types, holidays and access control
import { all, first, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { getAccess, PERMS, ROLE_LABELS, ROLES, saveAccess } from '../permissions.js';
import { getSettings, saveSettings } from '../settings.js';
import { clean, esc, isDate } from '../utils.js';
import { emailServiceName, layout, sendEmail } from '../email.js';

const emailService = (env) => emailServiceName(env);

async function getAllSettings(c) {
  return { ...(await getSettings(c.env)), email_service: emailService(c.env) };
}

// Sends a test email to the person signed in, to check the email setup
async function testEmail(c) {
  if (!emailService(c.env)) fail(400, 'Email is not connected yet. Set up google_email_services (GOOGLE_MAIL_URL + GOOGLE_MAIL_SECRET) or Brevo - see GUIDE.md part 6.');
  const settings = await getSettings(c.env);
  const result = await sendEmail(c.env, settings, {
    to: c.me.email, subject: `Test email - ${settings.company_name} Leave and Shift Management System`,
    html: layout(settings, `<p>Hi ${esc(c.me.name)},</p><p>Email is working. Leave requests and decisions will now be emailed.</p>`),
  });
  if (!result.startsWith('sent')) fail(400, `The test email was ${result}`);
  return { ok: true, result };
}

async function putSettings(c) {
  const b = await readJson(c.request);
  // WFH limits: only a Super admin decides them
  if (('wfh_limit_period' in b || 'wfh_limit_days' in b) && !c.me.isSuper) fail(403, 'Only a Super admin can change the WFH settings.');
  return saveSettings(c.env, b);
}

// ---------------------------------------------------------------- leave types
const listTypes = async (c) => ({ rows: await all(c.env, 'SELECT * FROM leave_types ORDER BY sort_order, name') });

function typeInput(b) {
  const v = {
    name: clean(b.name),
    days_per_year: b.days_per_year === '' || b.days_per_year === null || b.days_per_year === undefined ? null : Number(b.days_per_year),
    counts_in_pool: b.counts_in_pool ? 1 : 0,
    allow_half: b.allow_half ? 1 : 0,
    is_short: b.is_short ? 1 : 0,
    sort_order: Number(b.sort_order) || 0,
    active: b.active === false || b.active === 0 ? 0 : 1,
  };
  if (!v.name || v.name.length > 60) fail(400, 'Leave type name is required.');
  if (v.days_per_year !== null && !(v.days_per_year >= 0 && v.days_per_year <= 366)) fail(400, 'Days per year must be a number (or empty for no limit).');
  if (v.is_short) { v.allow_half = 0; v.counts_in_pool = 0; }
  return v;
}

async function onlyOneShort(env, v, id = 0) {
  if (v.is_short && await first(env, 'SELECT id FROM leave_types WHERE is_short = 1 AND id <> ?', id)) fail(400, 'Only one leave type can be the short leave.');
}

async function createType(c) {
  const v = typeInput(await readJson(c.request));
  await onlyOneShort(c.env, v);
  if (await first(c.env, 'SELECT id FROM leave_types WHERE name = ? COLLATE NOCASE', v.name)) fail(400, 'This leave type already exists.');
  const res = await run(c.env, `INSERT INTO leave_types (name, days_per_year, counts_in_pool, allow_half, is_short, sort_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, v.name, v.days_per_year, v.counts_in_pool, v.allow_half, v.is_short, v.sort_order, v.active);
  return { id: res.meta.last_row_id };
}

async function updateType(c) {
  const id = Number(c.params.id);
  const old = await first(c.env, 'SELECT * FROM leave_types WHERE id = ?', id);
  if (!old) fail(404, 'Leave type not found.');
  const v = typeInput(await readJson(c.request));
  await onlyOneShort(c.env, v, id);
  if (await first(c.env, 'SELECT id FROM leave_types WHERE name = ? COLLATE NOCASE AND id <> ?', v.name, id)) fail(400, 'Another leave type has this name.');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE leave_types SET name = ?, days_per_year = ?, counts_in_pool = ?, allow_half = ?, is_short = ?, sort_order = ?, active = ? WHERE id = ?`)
      .bind(v.name, v.days_per_year, v.counts_in_pool, v.allow_half, v.is_short, v.sort_order, v.active, id),
    c.env.DB.prepare('UPDATE leave_requests SET leave_type = ? WHERE leave_type = ? COLLATE NOCASE').bind(v.name, old.name),
  ]);
  return { ok: true };
}

async function deleteType(c) {
  const id = Number(c.params.id);
  const t = await first(c.env, 'SELECT name FROM leave_types WHERE id = ?', id);
  if (!t) fail(404, 'Leave type not found.');
  const used = await first(c.env, 'SELECT COUNT(*) AS n FROM leave_requests WHERE leave_type = ? COLLATE NOCASE', t.name);
  if (used.n) fail(400, `${used.n} request(s) use this leave type. Untick "Active" instead of deleting it.`);
  await run(c.env, 'DELETE FROM leave_types WHERE id = ?', id);
  return { ok: true };
}

// ---------------------------------------------------------------- holidays
const listHolidays = async (c) => ({ rows: await all(c.env, 'SELECT * FROM holidays ORDER BY date DESC') });

function holidayInput(b) {
  const v = { date: clean(b.date), name: clean(b.name).slice(0, 100) };
  if (!isDate(v.date)) fail(400, 'Choose the holiday date.');
  return v;
}

async function createHoliday(c) {
  const v = holidayInput(await readJson(c.request));
  if (await first(c.env, 'SELECT id FROM holidays WHERE date = ?', v.date)) fail(400, 'This date is already a holiday.');
  const res = await run(c.env, 'INSERT INTO holidays (date, name) VALUES (?, ?)', v.date, v.name);
  return { id: res.meta.last_row_id };
}

async function updateHoliday(c) {
  const id = Number(c.params.id);
  const v = holidayInput(await readJson(c.request));
  if (await first(c.env, 'SELECT id FROM holidays WHERE date = ? AND id <> ?', v.date, id)) fail(400, 'This date is already a holiday.');
  await run(c.env, 'UPDATE holidays SET date = ?, name = ? WHERE id = ?', v.date, v.name, id);
  return { ok: true };
}

async function deleteHoliday(c) {
  await run(c.env, 'DELETE FROM holidays WHERE id = ?', Number(c.params.id));
  return { ok: true };
}

// ---------------------------------------------------------------- access control (Super admin only)
async function getAccessMatrix(c) {
  return { perms: PERMS.map(({ key, group, label }) => ({ key, group, label })), roles: ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] })), matrix: await getAccess(c.env) };
}

async function putAccess(c) {
  const b = await readJson(c.request);
  return { matrix: await saveAccess(c.env, b.matrix) };
}

export default [
  { method: 'GET', path: '/api/settings', perm: 'settings.view', handler: getAllSettings },
  { method: 'PUT', path: '/api/settings', perm: 'settings.edit', handler: putSettings },
  { method: 'POST', path: '/api/settings/test-email', perm: 'settings.edit', handler: testEmail },

  { method: 'GET', path: '/api/leave-types', perm: 'settings.view', handler: listTypes },
  { method: 'POST', path: '/api/leave-types', perm: 'settings.edit', handler: createType },
  { method: 'PUT', path: '/api/leave-types/:id', perm: 'settings.edit', handler: updateType },
  { method: 'DELETE', path: '/api/leave-types/:id', perm: 'settings.edit', handler: deleteType },

  { method: 'GET', path: '/api/holidays', perm: 'settings.view', handler: listHolidays },
  { method: 'POST', path: '/api/holidays', perm: 'settings.edit', handler: createHoliday },
  { method: 'PUT', path: '/api/holidays/:id', perm: 'settings.edit', handler: updateHoliday },
  { method: 'DELETE', path: '/api/holidays/:id', perm: 'settings.edit', handler: deleteHoliday },

  { method: 'GET', path: '/api/access', perm: 'access.edit', handler: getAccessMatrix },
  { method: 'PUT', path: '/api/access', perm: 'access.edit', handler: putAccess },
];
