// Google Sheet backup: the system copies its data into a Google Sheet (one tab per page) and keeps it up to date.
// The system signs in to Google as a "service account" (robot). Its JSON key is the Cloudflare secret GOOGLE_SA_KEY.
// Share the Google Sheet with the robot's email as Editor, paste the link in Settings → General → First-time sync.
// After that, every change in the system refreshes the sheet automatically; "Sync now" does it by hand.
import { all, first, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { getSettings } from '../settings.js';
import { computeSummary, getLeaveTypes, leaveYear } from '../leave.js';
import { clean, nowIso, todayIn } from '../utils.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LOG_TAB = 'Sync Log';

// ---------------------------------------------------------------- the robot account
function robot(env) {
  if (!env.GOOGLE_SA_KEY) return null;
  try {
    const k = JSON.parse(env.GOOGLE_SA_KEY);
    return k.client_email && k.private_key ? k : null;
  } catch { return null; }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64 = (s) => b64url(new TextEncoder().encode(s));

let cachedToken = null;           // { token, until } - reused while this worker is alive
async function googleToken(env) {
  if (cachedToken && cachedToken.until > Date.now() + 60000) return cachedToken.token;
  const k = robot(env);
  if (!k) fail(400, 'The Google robot account is not set up (Cloudflare secret GOOGLE_SA_KEY).');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${textB64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${textB64(JSON.stringify({
    iss: k.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const der = Uint8Array.from(atob(k.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(sig)}`,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) fail(400, `Google sign-in failed: ${data.error_description || data.error || res.status}`);
  cachedToken = { token: data.access_token, until: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function sheets(env, path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method, headers: { authorization: `Bearer ${await googleToken(env)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const k = robot(env);
    if (res.status === 403 || res.status === 404) {
      fail(400, `The system cannot open this Google Sheet. Share it with ${k ? k.client_email : 'the robot email'} as Editor, then try again.`);
    }
    fail(400, `Google Sheets: ${(data.error && data.error.message) || res.status}`);
  }
  return data;
}

export const sheetIdFromLink = (link) => {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(String(link || ''));
  return m ? m[1] : (/^[a-zA-Z0-9-_]{30,}$/.test(String(link || '')) ? String(link) : '');
};

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
    'Leave Summary': [[`Leave year ${year.start} → ${year.end}`, '', '', ...balanceTypes.flatMap(() => ['', '']), '', '', '', ''],
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

// ---------------------------------------------------------------- write everything into the sheet
async function syncTo(env, sheetId, { format = false } = {}) {
  const data = await collect(env);
  const titles = [...Object.keys(data), LOG_TAB];
  let meta = await sheets(env, `${sheetId}?fields=properties.title,sheets.properties(sheetId,title)`);
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = titles.filter((t) => !have.has(t));
  if (missing.length) {
    await sheets(env, `${sheetId}:batchUpdate`, { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) });
    meta = await sheets(env, `${sheetId}?fields=properties.title,sheets.properties(sheetId,title)`);
    if (missing.includes(LOG_TAB)) {
      await sheets(env, `${sheetId}/values:batchUpdate`, { valueInputOption: 'RAW', data: [{ range: `'${LOG_TAB}'!A1`, values: [['Time', 'Type', 'Result', 'Rows']] }] });
    }
  }
  const tabs = Object.keys(data);
  await sheets(env, `${sheetId}/values:batchClear`, { ranges: tabs.map((t) => `'${t}'`) });
  await sheets(env, `${sheetId}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: tabs.map((t) => ({ range: `'${t}'!A1`, values: data[t].map((row) => row.map((v) => (v === null || v === undefined ? '' : v))) })),
  });
  if (format) {         // first time: bold blue header row, frozen
    const ids = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    await sheets(env, `${sheetId}:batchUpdate`, {
      requests: [...tabs, LOG_TAB].flatMap((t) => {
        const headerRow = t === 'Leave Summary' ? 1 : 0;
        return [
          { updateSheetProperties: { properties: { sheetId: ids.get(t), gridProperties: { frozenRowCount: headerRow + 1 } }, fields: 'gridProperties.frozenRowCount' } },
          { repeatCell: { range: { sheetId: ids.get(t), startRowIndex: headerRow, endRowIndex: headerRow + 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.157, green: 0.224, blue: 0.541 } } },
            fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
        ];
      }),
    });
  }
  return { title: meta.properties.title, rows: tabs.reduce((n, t) => n + Math.max(data[t].length - 1, 0), 0) };
}

async function log(env, sheetId, type, result, rows) {
  try {
    await sheets(env, `${sheetId}/values/${encodeURIComponent(`'${LOG_TAB}'!A1`)}:append?valueInputOption=RAW`, { values: [[nowIso(), type, result, rows ?? '']] });
  } catch { /* the log must never stop a sync */ }
}

async function runSync(env, sheetId, type) {
  try {
    const res = await syncTo(env, sheetId, { format: type === 'First-time sync' });
    await setState(env, 'backup_last_sync', nowIso());
    await setState(env, 'backup_status', `OK · ${res.rows} rows`);
    if (type !== 'Automatic') await log(env, sheetId, type, 'OK', res.rows);
    return res;
  } catch (err) {
    await setState(env, 'backup_status', `FAILED · ${err.message}`);
    await setState(env, 'backup_last_try', nowIso());
    await log(env, sheetId, type, `FAILED: ${err.message}`);
    throw err;
  }
}

// Called after every change in the system (see app.js): refresh the sheet in the background
export async function autoSync(env) {
  if (!robot(env)) return;
  const s = await state(env);
  if (!s.backup_sheet_id) return;
  await runSync(env, s.backup_sheet_id, 'Automatic').catch((err) => console.error('Backup sync failed:', err.message));
}

// ---------------------------------------------------------------- routes (Settings → General)
async function status(c) {
  const s = await state(c.env);
  const k = robot(c.env);
  return {
    ready: !!k, robot_email: k ? k.client_email : '', sheet_url: s.backup_sheet_url || '', sheet_title: s.backup_sheet_title || '',
    last_sync: s.backup_last_sync || '', status: s.backup_status || '',
  };
}

async function firstSync(c) {
  const b = await readJson(c.request);
  const url = clean(b.url);
  const id = sheetIdFromLink(url);
  if (!id) fail(400, 'Paste the link of a Google Sheet (it looks like https://docs.google.com/spreadsheets/d/…).');
  const res = await runSync(c.env, id, 'First-time sync');
  await setState(c.env, 'backup_sheet_id', id);
  await setState(c.env, 'backup_sheet_url', `https://docs.google.com/spreadsheets/d/${id}/edit`);
  await setState(c.env, 'backup_sheet_title', res.title || '');
  return { ok: true, rows: res.rows, ...(await status(c)) };
}

async function syncNow(c) {
  const s = await state(c.env);
  if (!s.backup_sheet_id) fail(400, 'No Google Sheet yet. Paste a link and press First-time sync.');
  const res = await runSync(c.env, s.backup_sheet_id, 'Manual sync');
  return { ok: true, rows: res.rows, ...(await status(c)) };
}

async function stop(c) {
  for (const k of ['backup_sheet_id', 'backup_sheet_url', 'backup_sheet_title', 'backup_status', 'backup_last_sync']) await setState(c.env, k, '');
  return { ok: true, ...(await status(c)) };
}

export default [
  { method: 'GET', path: '/api/backup', perm: 'settings.view', handler: status },
  { method: 'POST', path: '/api/backup/first-sync', perm: 'settings.edit', handler: firstSync },
  { method: 'POST', path: '/api/backup/sync', perm: 'settings.edit', handler: syncNow },
  { method: 'POST', path: '/api/backup/stop', perm: 'settings.edit', handler: stop },
];
