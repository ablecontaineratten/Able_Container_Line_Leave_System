// Google Sheet backup: the system sends its data to a Google Apps Script web app (google_backup/Code.gs)
// attached to a Google Sheet, which writes one tab per page. No Google Cloud needed.
// Settings → General → Google Sheet Backup: paste the Web app link + secret key → First-time sync.
// After that every change in the system sends the data again (automatic sync); "Sync now" does it by hand.
import { all, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { getSettings } from '../settings.js';
import { computeSummary, getLeaveTypes, leaveYear } from '../leave.js';
import { clean, nowIso, todayIn } from '../utils.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------- backup state (kept in the settings table)
async function state(env) {
  const rows = await all(env, `SELECT key, value FROM settings WHERE key LIKE 'backup_%'`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
const setState = (env, key, value) => run(env,
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value ?? '');

// ---------------------------------------------------------------- the data: one tab per page
async function collect(env) {
  const settings = await getSettings(env);
  const today = todayIn(settings.timezone);
  const year = leaveYear(today, settings.year_start);
  const [employees, departments, heads, users, leave, work, types, holidays, yearRows] = await Promise.all([
    all(env, `SELECT e.id, e.emp_no, e.name, e.email, d.name AS department, e.designation, e.etf_no, e.nic_no, e.phone, e.status, e.created_at
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id ORDER BY e.emp_no`),
    all(env, 'SELECT id, name FROM departments ORDER BY name'),
    all(env, 'SELECT h.department_id, u.name FROM department_heads h JOIN users u ON u.id = h.user_id ORDER BY u.name'),
    all(env, 'SELECT name, email, role, designation, status, last_login, created_at FROM users ORDER BY name'),
    all(env, `SELECT request_no, emp_no, emp_name, emp_email, department, leave_type, from_date, to_date, day_type, out_time, return_time, days, hours,
      reason, status, remark, decided_by, decided_at, submitted_at FROM leave_requests ORDER BY from_date DESC, id DESC`),
    all(env, `SELECT request_no, emp_no, emp_name, emp_email, department, work_type, from_date, to_date, dates, days, reason, status, remark,
      decided_by, decided_at, submitted_at FROM work_requests ORDER BY from_date DESC, id DESC`),
    getLeaveTypes(env),
    all(env, 'SELECT date, name FROM holidays ORDER BY date'),
    all(env, `SELECT employee_id, leave_type, days, status FROM leave_requests
      WHERE status IN ('Approved', 'Pending') AND from_date >= ? AND from_date < ?`, year.start, year.end),
  ]);
  const ROLE = { super_admin: 'Super admin', admin: 'Admin', head: 'Department head' };

  // Leave Summary: each active employee's balance for this leave year
  const balanceTypes = types.filter((t) => t.active && !t.is_short);
  const summary = employees.filter((e) => e.status === 'Active').map((e) => {
    const sum = computeSummary(types, settings, yearRows.filter((r) => r.employee_id === e.id), year);
    const by = new Map(sum.types.map((t) => [t.type, t]));
    return [e.emp_no, e.name, e.department || '', ...balanceTypes.flatMap((t) => {
      const b = by.get(t.name);
      return [b ? b.used : 0, b && b.left !== null ? b.left : ''];
    }), sum.pool, sum.used, sum.pending, sum.left];
  });

  const halfFrom = types.filter((t) => t.allow_half && !t.is_short).map((t) => t.name).join(' / ') || '-';
  return {
    Employees: [['Emp No', 'Name', 'Email', 'Department', 'Designation', 'ETF No', 'NIC No', 'Phone', 'Status', 'Added'],
      ...employees.map((e) => [e.emp_no, e.name, e.email, e.department || '', e.designation, e.etf_no, e.nic_no, e.phone, e.status, e.created_at])],
    Departments: [['Department', 'Heads', 'Employees'],
      ...departments.map((d) => [d.name, heads.filter((h) => h.department_id === d.id).map((h) => h.name).join(', '),
        employees.filter((e) => e.department === d.name).length])],
    'Login Accounts': [['Name', 'Email', 'Role', 'Designation', 'Status', 'Last sign in', 'Created'],
      ...users.map((u) => [u.name, u.email, ROLE[u.role] || u.role, u.designation, u.status, u.last_login || '', u.created_at])],
    'Leave Requests': [['Request', 'Emp No', 'Name', 'Email', 'Department', 'Leave type', 'From', 'To', 'Day type', 'Out time', 'Return time', 'Days', 'Hours',
      'Reason', 'Status', 'Remark', 'Decided by', 'Decided at', 'Requested at'],
    ...leave.map((r) => [r.request_no, r.emp_no, r.emp_name, r.emp_email, r.department, r.leave_type, r.from_date, r.to_date, r.day_type, r.out_time,
      r.return_time, r.days, r.hours ?? '', r.reason, r.status, r.remark, r.decided_by, r.decided_at || '', r.submitted_at])],
    'WFH Requests': [['Request', 'Emp No', 'Name', 'Email', 'Department', 'Type', 'From', 'To', 'Dates', 'Days', 'Reason', 'Status', 'Remark', 'Decided by', 'Decided at', 'Requested at'],
      ...work.map((r) => [r.request_no, r.emp_no, r.emp_name, r.emp_email, r.department, r.work_type, r.from_date, r.to_date, r.dates.split(',').join(' '),
        r.days, r.reason, r.status, r.remark, r.decided_by, r.decided_at || '', r.submitted_at])],
    'Leave Summary': [[`Leave year ${year.start} → ${year.end}`],
      ['Emp No', 'Name', 'Department', ...balanceTypes.flatMap((t) => [`${t.name} used`, `${t.name} left`]), 'Total allowed', 'Total used', 'Pending', 'Total left'],
      ...summary],
    'Leave Settings': [['Leave type', 'Days per year', 'Counts in total', 'Half day allowed', 'Short leave', 'Active'],
      ...types.map((t) => [t.name, t.days_per_year ?? 'No limit', t.counts_in_pool ? 'Yes' : '', t.allow_half ? 'Yes' : '', t.is_short ? 'Yes' : '', t.active ? 'Yes' : 'No']),
      [], ['Total leave days per year', settings.pool_days || 'Sum of the leave types'], ['Short leaves per month', settings.short_per_month || ''],
      ['Half day taken from', halfFrom]],
    Holidays: [['Date', 'Day', 'Holiday'], ...holidays.map((h) => [h.date, DAYS[new Date(`${h.date}T00:00:00Z`).getUTCDay()], h.name])],
    Settings: [['Setting', 'Value'], ['Company name', settings.company_name], ['Time zone', settings.timezone], ['Leave year starts', settings.year_start],
      ['Weekend days', String(settings.weekend).split(',').filter(Boolean).map((d) => DAYS[Number(d)]).join(', ')],
      ['When not enough balance', settings.no_balance], ['Copy of Approved emails', settings.copy_emails], ['Emp App Link', settings.form_url],
      ['System Link', settings.app_url], ['Email sender', settings.email_from]],
  };
}

// ---------------------------------------------------------------- send everything to the Google Apps Script
// Google answers the POST with a redirect to the result (same as the email service).
async function sendToSheet(env, appUrl, secret, type) {
  const tabs = await collect(env);
  let res;
  try {
    res = await fetch(appUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'content-type': 'text/plain;charset=utf-8' },        // keeps Google from asking for a preflight
      body: JSON.stringify({ secret, type, first: type === 'First-time sync', tabs, headerRows: { 'Leave Summary': 2 } }),
    });
  } catch (err) { fail(400, `Could not reach the Google Sheet app: ${err.message}`); }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* an HTML page = wrong link or not shared with "Anyone" */ }
  if (!data) fail(400, `The Google Sheet app did not answer (${res.status}). Check the link ends with /exec and "Who has access" is "Anyone".`);
  if (!data.ok) fail(400, `Google Sheet: ${data.error || 'error'}`);
  return data;           // { ok, rows, sheet, url }
}

async function runSync(env, appUrl, secret, type) {
  try {
    const res = await sendToSheet(env, appUrl, secret, type);
    await setState(env, 'backup_last_sync', nowIso());
    await setState(env, 'backup_status', `OK · ${res.rows} rows`);
    return res;
  } catch (err) {
    await setState(env, 'backup_status', `FAILED · ${err.message}`);
    throw err;
  }
}

// Called after every change in the system (see app.js): refresh the sheet in the background
export async function autoSync(env) {
  const s = await state(env);
  if (!s.backup_app_url || !s.backup_secret) return;
  await runSync(env, s.backup_app_url, s.backup_secret, 'Automatic').catch((err) => console.error('Backup sync failed:', err.message));
}

// ---------------------------------------------------------------- routes (Settings → General)
async function status(c) {
  const s = await state(c.env);
  return {
    connected: !!(s.backup_app_url && s.backup_secret), app_url: s.backup_app_url || '', has_secret: !!s.backup_secret,
    sheet_url: s.backup_sheet_url || '', sheet_title: s.backup_sheet_title || '', last_sync: s.backup_last_sync || '', status: s.backup_status || '',
  };
}

async function firstSync(c) {
  const b = await readJson(c.request);
  const appUrl = clean(b.app_url);
  const old = await state(c.env);
  const secret = clean(b.secret) || old.backup_secret || '';          // empty = keep the saved key
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(appUrl)) fail(400, 'Paste the Web app link of the Google Apps Script (it ends with /exec).');
  if (secret.length < 16) fail(400, 'Paste the secret key from the Google Apps Script (run "setup" or "showSecret").');
  const res = await runSync(c.env, appUrl, secret, 'First-time sync');
  await setState(c.env, 'backup_app_url', appUrl);
  await setState(c.env, 'backup_secret', secret);
  await setState(c.env, 'backup_sheet_url', res.url || '');
  await setState(c.env, 'backup_sheet_title', res.sheet || '');
  return { ok: true, rows: res.rows, ...(await status(c)) };
}

async function syncNow(c) {
  const s = await state(c.env);
  if (!s.backup_app_url || !s.backup_secret) fail(400, 'Not connected yet. Paste the link and key and press First-time sync.');
  const res = await runSync(c.env, s.backup_app_url, s.backup_secret, 'Manual sync');
  return { ok: true, rows: res.rows, ...(await status(c)) };
}

async function stop(c) {
  for (const k of ['backup_app_url', 'backup_secret', 'backup_sheet_url', 'backup_sheet_title', 'backup_status', 'backup_last_sync']) await setState(c.env, k, '');
  return { ok: true, ...(await status(c)) };
}

export default [
  { method: 'GET', path: '/api/backup', perm: 'settings.view', handler: status },
  { method: 'POST', path: '/api/backup/first-sync', perm: 'settings.edit', handler: firstSync },
  { method: 'POST', path: '/api/backup/sync', perm: 'settings.edit', handler: syncNow },
  { method: 'POST', path: '/api/backup/stop', perm: 'settings.edit', handler: stop },
];
