// Leave rules: working days, leave year, balances, new requests and decisions
import { all, batch, first, marks, run, stmt } from './db.js';
import { fail } from './http.js';
import { getSettings, weekendSet } from './settings.js';
import { can, inScope } from './permissions.js';
import { randomHex } from './auth.js';
import { button, emailEnabled, infoTable, layout, letter, nowText, sendEmail, whenText } from './email.js';
import { notify } from './push.js';
import { addDays, clean, esc, fmtDate, hoursBetween, isDate, isEmail, isTime, monthName, nowIso, parseEmails, round2, todayIn, toUtc } from './utils.js';

export const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];

export const getLeaveTypes = (env, activeOnly = false) =>
  all(env, `SELECT * FROM leave_types ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name`);

export async function getHolidaySet(env) {
  return new Set((await all(env, 'SELECT date FROM holidays')).map((r) => r.date));
}

// Working days between two dates (both included), without weekend days and holidays
export function workingDates(from, to, weekend, holidays) {
  const out = [];
  for (let d = from, guard = 0; d <= to && guard < 400; d = addDays(d, 1), guard++) {
    if (!weekend.has(toUtc(d).getUTCDay()) && !holidays.has(d)) out.push(d);
  }
  return out;
}

// The leave year that contains this date. end is NOT included.
export function leaveYear(date, yearStart) {
  const [m, d] = (/^\d{2}-\d{2}$/.test(yearStart) ? yearStart : '01-01').split('-');
  const y = Number(date.slice(0, 4));
  let start = `${y}-${m}-${d}`;
  if (date < start) start = `${y - 1}-${m}-${d}`;
  return { start, end: `${Number(start.slice(0, 4)) + 1}-${m}-${d}` };
}

export function shortLimit(settings, types) {
  const n = parseInt(settings.short_per_month, 10);
  if (n > 0) return n;
  const t = types.find((x) => x.is_short);
  return t && t.days_per_year > 0 ? Math.floor(t.days_per_year) : 0;
}

// rows = Approved / Pending requests of ONE employee in ONE leave year
export function computeSummary(types, settings, rows, year) {
  const byName = new Map(types.map((t) => [t.name.toLowerCase(), { t, used: 0, pending: 0 }]));
  for (const r of rows) {
    const b = byName.get(String(r.leave_type).toLowerCase());
    if (!b) continue;
    const n = b.t.is_short ? 1 : Number(r.days) || 0;
    if (r.status === 'Approved') b.used += n;
    else if (r.status === 'Pending') b.pending += n;
  }
  const list = [...byName.values()].filter((b) => b.t.active || b.used || b.pending).map(({ t, used, pending }) => ({
    type: t.name,
    allowed: t.days_per_year,
    used: round2(used),
    pending: round2(pending),
    left: t.days_per_year === null || t.is_short ? null : round2(t.days_per_year - used - pending),
    in_pool: !!t.counts_in_pool && !t.is_short,
    is_short: !!t.is_short,
  }));
  const poolSetting = Number(settings.pool_days);
  const pool = poolSetting > 0 ? poolSetting : round2(list.filter((x) => x.in_pool).reduce((n, x) => n + (x.allowed || 0), 0));
  const used = round2(list.filter((x) => x.in_pool).reduce((n, x) => n + x.used, 0));
  const pending = round2(list.filter((x) => x.in_pool).reduce((n, x) => n + x.pending, 0));
  return { year, types: list, pool, used, pending, left: round2(pool - used - pending), shortMonth: null };
}

export async function balanceSummary(env, employeeId, onDate, ctx = {}) {
  const settings = ctx.settings || await getSettings(env);
  const types = ctx.types || await getLeaveTypes(env);
  const year = leaveYear(onDate, settings.year_start);
  const rows = await all(env,
    `SELECT leave_type, days, status FROM leave_requests
     WHERE employee_id = ? AND status IN ('Approved', 'Pending') AND from_date >= ? AND from_date < ?`,
    employeeId, year.start, year.end);
  const sum = computeSummary(types, settings, rows, year);
  const shortType = types.find((t) => t.is_short);
  const limit = shortLimit(settings, types);
  if (shortType && limit) {
    const month = onDate.slice(0, 7);
    const m = await first(env,
      `SELECT COALESCE(SUM(status = 'Approved'), 0) AS used, COALESCE(SUM(status = 'Pending'), 0) AS pending FROM leave_requests
       WHERE employee_id = ? AND leave_type = ? COLLATE NOCASE AND substr(from_date, 1, 7) = ? AND status IN ('Approved', 'Pending')`,
      employeeId, shortType.name, month);
    sum.shortMonth = { month, label: `${monthName(onDate)} ${onDate.slice(0, 4)}`, used: m.used, pending: m.pending, limit };
  }
  return sum;
}

// Can these days be taken? Counts APPROVED + PENDING in the same leave year (short leave: same month).
async function balanceCheck(env, employeeId, type, days, onDate, ctx) {
  const sum = await balanceSummary(env, employeeId, onDate, ctx);
  if (type.is_short) {
    const m = sum.shortMonth;
    if (m && m.used + m.pending >= m.limit) {
      return { ok: false, msg: `Short leave limit reached for ${m.label}: ${m.used + m.pending} of ${m.limit} already used or pending.` };
    }
    return { ok: true };
  }
  if (type.days_per_year === null || !(days > 0)) return { ok: true };
  const row = sum.types.find((x) => x.type.toLowerCase() === type.name.toLowerCase());
  if (row && row.left !== null && row.left < days) {
    return { ok: false, msg: `Not enough ${type.name} balance: ${Math.max(row.left, 0)} day(s) left, asked for ${days}.` };
  }
  if (row && row.in_pool && sum.left < days) {
    return { ok: false, msg: `Not enough total leave balance: ${Math.max(sum.left, 0)} of ${sum.pool} day(s) left, asked for ${days}.` };
  }
  return { ok: true };
}

// R26Oct001, R26Oct002 ... (month of the first leave date)
export async function nextGroupNo(env, date) {
  const key = `R${date.slice(2, 4)}${monthName(date)}`;
  const row = await first(env,
    'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value', key);
  let n = row.value;
  if (n === 1) {          // first number this month: continue after imported requests, if any
    const ex = await first(env, `SELECT MAX(CAST(substr(group_no, ?, 3) AS INTEGER)) AS m FROM leave_requests WHERE group_no LIKE ?`,
      key.length + 1, `${key}%`);
    if (ex && ex.m) {
      n = ex.m + 1;
      await run(env, 'UPDATE counters SET value = ? WHERE key = ?', n, key);
    }
  }
  return key + String(n).padStart(3, '0');
}

// When no head can take a request: the Super admin(s). Admins do NOT get request emails -
// they only get the copy of Approved emails (Settings → "Copy of Approved emails"). Admins only if there is no Super admin.
export async function fallbackApprovers(env, keep = () => true) {
  const supers = (await all(env, `SELECT id, name, email FROM users WHERE role = 'super_admin' AND status = 'active'`)).filter(keep);
  if (supers.length) return supers;
  return (await all(env, `SELECT id, name, email FROM users WHERE role = 'admin' AND status = 'active'`)).filter(keep);
}

// Who gets the request notification: every head of the department, else the Super admin(s)
export async function approversFor(env, departmentId) {
  const list = departmentId ? await all(env,
    `SELECT u.id, u.name, u.email FROM department_heads h JOIN users u ON u.id = h.user_id
     WHERE h.department_id = ? AND u.status = 'active'`, departmentId) : [];
  return list.length ? list : fallbackApprovers(env);
}

async function appendNotes(env, groupNo, text) {
  if (!text) return;
  await run(env, `UPDATE leave_requests SET notes = CASE WHEN notes = '' THEN ? ELSE notes || ' | ' || ? END WHERE group_no = ?`, text, text, groupNo);
}

// ---------------------------------------------------------------- new request
export async function createRequest(c, input) {
  const { env, me } = c;
  const [settings, types, holidays] = await Promise.all([getSettings(env), getLeaveTypes(env, true), getHolidaySet(env)]);
  const today = todayIn(settings.timezone);

  let employee = me.employee;
  const otherId = Number(input.employee_id) || 0;
  if (otherId && (!employee || otherId !== employee.id)) {
    if (!can(me, 'leave.apply_others')) fail(403, 'You can only apply for your own leave.');
    employee = await first(env, 'SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?', otherId);
    if (!employee) fail(404, 'Employee not found.');
    if (!inScope(me, employee.department_id)) fail(403, 'This employee is not in your department(s).');
  }
  if (!employee) fail(400, 'Your login is not linked to an employee record (the same email must be in Employees). Please ask an admin.');
  if (employee.status !== 'Active') fail(400, 'This employee is marked Inactive.');
  const self = me.employee && employee.id === me.employee.id;

  const type = types.find((t) => t.name.toLowerCase() === clean(input.leave_type).toLowerCase());
  if (!type) fail(400, 'Choose a leave type.');
  const reason = clean(input.reason).slice(0, 1000);
  const warnings = [];

  // ---- the date(s): one day / days in a row / separate dates
  const mode = type.is_short ? 'one' : ['one', 'range', 'dates'].includes(input.mode) ? input.mode : 'one';
  let dates = [];
  let from;
  let to;
  let half = false;
  let outTime = '';
  let returnTime = '';
  let hours = null;
  if (mode === 'dates') {
    dates = [...new Set((Array.isArray(input.dates) ? input.dates : []).map(clean).filter(Boolean))].sort();
    if (dates.some((d) => !isDate(d))) fail(400, 'One of the dates is not valid.');
    if (!dates.length) fail(400, 'Choose at least one date.');
    if (dates.length > 10) fail(400, 'Choose at most 10 separate dates.');
    from = dates[0];
    to = dates[dates.length - 1];
    if (dates.length === 1) dates = [];
  } else if (mode === 'range') {
    from = clean(input.from);
    to = clean(input.to);
    if (!isDate(from) || !isDate(to)) fail(400, 'Choose the From and To dates.');
    if (to < from) fail(400, 'The "To" date is before the "From" date.');
    if (addDays(from, 366) < to) fail(400, 'One request can be at most one year long.');
  } else {
    from = to = clean(input.date);
    if (!isDate(from)) fail(400, 'Choose the leave date.');
    if (type.is_short) {
      outTime = clean(input.out_time).slice(0, 5);
      returnTime = clean(input.return_time).slice(0, 5);
      const noTimes = !outTime && !returnTime && input.times_optional;      // the Google Form has optional times
      if (!noTimes) {
        // out time is needed; the return time is optional (the employee may not know it yet)
        if (!isTime(outTime)) fail(400, 'Enter the out time.');
        if (returnTime && !isTime(returnTime)) fail(400, 'The return time is not valid.');
        if (returnTime && returnTime <= outTime) fail(400, 'The return time must be after the out time.');
        if (returnTime) hours = hoursBetween(outTime, returnTime);
      }
    } else if (input.half) {
      if (!type.allow_half) fail(400, `${type.name} cannot be taken as a half day.`);
      half = true;
    }
  }
  if ((dates.length ? dates : [from]).some((d) => d < today) && !can(me, 'leave.past_dates')) {
    fail(400, 'Dates before today are not allowed. Please ask an admin to enter this leave.');
  }

  const weekend = weekendSet(settings);
  let days;
  if (dates.length) {
    const off = dates.filter((d) => !workingDates(d, d, weekend, holidays).length);
    if (off.length) fail(400, `${off.map(fmtDate).join(', ')} ${off.length === 1 ? 'is a weekend day / holiday' : 'are weekend days / holidays'}.`);
    days = dates.length;
  } else {
    const n = workingDates(from, to, weekend, holidays).length;
    if (!n) fail(400, 'There are no working days in these dates (weekend / holiday).');
    days = type.is_short ? 0 : half ? 0.5 : n;
  }

  // ---- the same days asked for twice (short leave may share a day; two half days make one full day)
  if (!type.is_short) {
    for (const [f, t] of dates.length ? dates.map((d) => [d, d]) : [[from, to]]) {
      const rows = await all(env,
        `SELECT request_no, status, day_type FROM leave_requests WHERE employee_id = ? AND status IN ('Pending', 'Approved')
         AND day_type <> 'Short Leave' AND from_date <= ? AND to_date >= ?`, employee.id, t, f);
      const ov = half && rows.length === 1 && rows[0].day_type === 'Half Day' ? null : rows[0];
      if (ov) fail(400, `${self ? 'You already have' : 'This employee already has'} request ${ov.request_no} (${ov.status}) on ${f === t ? fmtDate(f) : 'these dates'}.`);
    }
  }

  // ---- balance
  const check = await balanceCheck(env, employee.id, type, days, from, { settings, types });
  if (!check.ok) {
    if (settings.no_balance !== 'warn') fail(400, check.msg);
    warnings.push(check.msg);
  }

  // ---- save (separate dates: one row per date, R26Oct001-1, R26Oct001-2 ...)
  const groupNo = await nextGroupNo(env, from);
  const token = randomHex(24);
  const now = nowIso();
  const dayType = type.is_short ? 'Short Leave' : half ? 'Half Day' : 'Full Day';
  const allChecks = [...(input.checks || []), ...warnings];
  const notes = [input.note || '', allChecks.length ? `CHECK: ${allChecks.join(' ')}` : '', self ? '' : `Entered by ${me.name}`].filter(Boolean).join(' | ');
  // emails go to the address the request came from (Google Form), else the Employees record
  const contactEmail = isEmail(input.contact_email) ? clean(input.contact_email).toLowerCase() : (employee.email || '');
  const rows = dates.length
    ? dates.map((d, i) => ({ request_no: `${groupNo}-${i + 1}`, from_date: d, to_date: d, days: 1 }))
    : [{ request_no: groupNo, from_date: from, to_date: to, days }];
  await batch(env, rows.map((r) => stmt(env,
    `INSERT INTO leave_requests (request_no, group_no, employee_id, emp_no, emp_name, emp_email, department_id, department,
       leave_type, from_date, to_date, day_type, out_time, return_time, days, hours, reason, status, notes, token, submitted_by, submitted_at, form_response_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?)`,
    r.request_no, groupNo, employee.id, employee.emp_no, employee.name, contactEmail, employee.department_id, employee.department || '',
    type.name, r.from_date, r.to_date, dayType, outTime, returnTime, r.days, hours, reason, notes, token, me.id, now, clean(input.form_response_id))));

  const saved = await all(env, 'SELECT * FROM leave_requests WHERE group_no = ? ORDER BY from_date', groupNo);
  c.waitUntil(notifyNewRequest(env, c.origin, settings, types, saved, allChecks).catch((err) => console.error('New request email failed:', err)));
  return { group_no: groupNo, days, warnings };
}

async function notifyNewRequest(env, origin, settings, types, rows, warnings) {
  const r = rows[0];
  const baseUrl = settings.app_url || origin;
  // a head never approves their own leave: the other heads get it; if there are none, the Super admin(s) do
  const notSelf = (a) => String(a.email).toLowerCase() !== String(r.emp_email).toLowerCase();
  let approvers = (await approversFor(env, r.department_id)).filter(notSelf);
  if (!approvers.length) approvers = await fallbackApprovers(env, notSelf);
  const when = whenText(rows);
  const paper = letter(settings, types, rows, null, warnings);          // emails show no balance table
  const log = [];

  // phone notification to every head (the main way heads hear about requests)
  log.push(`Heads: ${await notify(env, 'user', approvers.map((a) => a.id), {
    title: 'New leave request', body: `${r.emp_name} · ${r.leave_type} · ${when}`, url: '/#/approvals',
  }, baseUrl)}`);

  for (const ap of approvers.filter((a) => isEmail(a.email) && emailEnabled(env))) {
    const link = (a) => `${baseUrl}/api/email/decide?g=${encodeURIComponent(r.group_no)}&t=${r.token}&a=${a}&w=${encodeURIComponent(ap.email)}`;
    const others = approvers.filter((x) => x.email !== ap.email).map((x) => x.name);
    const inner = `<p>Dear ${esc(ap.name)}, a new leave request (<b>${esc(r.group_no)}</b>) for <b>${esc(r.department || '-')}</b> needs your decision.</p>
      ${others.length ? `<p style="font-size:12px;color:#666">Also sent to: ${esc(others.join(', '))}. The first decision counts.</p>` : ''}
      ${paper}
      <p style="margin:18px 0">${button(link('approve'), 'Approve', '#1e7e34')}${button(link('reject'), 'Reject', '#c62828')}</p>
      <p style="font-size:12px;color:#666">Or decide in the app: <a href="${esc(baseUrl)}/#/approvals">${esc(baseUrl)}</a></p>`;
    log.push(`Approver email ${await sendEmail(env, settings, {
      to: ap.email, subject: `[Leave request] ${r.emp_name} - ${r.leave_type} - ${when}`, html: layout(settings, inner), replyTo: r.emp_email,
    })}`);
  }
  if (!approvers.length) log.push('No approver: the department has no head and there is no admin.');

  if (isEmail(r.emp_email) && emailEnabled(env)) {
    const inner = `<p>Hi ${esc(r.emp_name)}, your leave request <b>${esc(r.group_no)}</b> was received${approvers.length ? ` and sent to ${esc(approvers.map((a) => a.name).join(' / '))}` : ''}. Your copy:</p>
      ${paper}<p>You will get another email when it is approved or not approved.</p>`;
    log.push(`Employee email ${await sendEmail(env, settings, { to: r.emp_email, subject: `Leave request received - ${r.group_no}`, html: layout(settings, inner) })}`);
  }
  await appendNotes(env, r.group_no, log.join(' | '));
}

// ---------------------------------------------------------------- decisions
// actor = { me, name } for a signed-in person, or { system: true, name } for the email buttons
function blockReason(actor, row, status) {
  if (row.status === status) return `Already ${status}.`;
  if (actor.system) return row.status === 'Pending' && (status === 'Approved' || status === 'Rejected') ? '' : 'Already decided.';
  const me = actor.me;
  const own = me.employee && row.employee_id === me.employee.id;
  if (own && !me.isSuper) return row.status === 'Pending' && status === 'Cancelled' ? '' : 'You cannot decide your own leave.';
  if (!me.isSuper && !inScope(me, row.department_id)) return 'Not in your department(s).';
  const manage = can(me, 'requests.manage');
  if (row.status === 'Rejected' && /^System/.test(row.decided_by)) return manage ? '' : 'Stopped by the system - only an admin can change it.';
  if (row.status === 'Pending' && (status === 'Approved' || status === 'Rejected')) return manage || can(me, 'approve.decide') ? '' : 'You cannot approve or reject requests.';
  if (row.status === 'Approved' && status === 'Cancelled') return manage || can(me, 'requests.cancel') ? '' : 'You cannot cancel approved leave.';
  return manage ? '' : `Changing ${row.status} to ${status} is not allowed.`;
}

export async function decideRequests(c, actor, ids, status, remark) {
  const { env } = c;
  if (!STATUSES.includes(status)) fail(400, 'Unknown status.');
  ids = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => n > 0))].slice(0, 500);
  if (!ids.length) fail(400, 'Choose at least one request.');
  const newRemark = remark === undefined || remark === null ? null : clean(remark).slice(0, 500);

  const rows = await all(env, `SELECT * FROM leave_requests WHERE id IN (${marks(ids)})`, ...ids);
  const now = nowIso();
  const skipped = [];
  const done = [];
  const statements = [];
  for (const row of rows) {
    const why = blockReason(actor, row, status);
    if (why) {
      skipped.push({ request_no: row.request_no, reason: why });
      continue;
    }
    const withdrawn = !actor.system && actor.me.employee && row.employee_id === actor.me.employee.id && row.status === 'Pending' && status === 'Cancelled';
    const note = withdrawn ? 'Withdrawn by the employee'
      : row.status === 'Approved' ? `Was Approved by ${row.decided_by || '-'}${row.decided_at ? ` on ${row.decided_at.slice(0, 10)}` : ''}` : '';
    const by = status === 'Pending' ? '' : actor.name;
    statements.push(stmt(env,
      `UPDATE leave_requests SET status = ?, remark = ?, decided_by = ?, decided_at = ?,
         notes = CASE WHEN ? = '' THEN notes WHEN notes = '' THEN ? ELSE notes || ' | ' || ? END
       WHERE id = ? AND status = ?`,
      status, newRemark ?? row.remark, by, status === 'Pending' ? null : now, note, note, note, row.id, row.status));
    done.push({ ...row, old: row.status, withdrawn, status, remark: newRemark ?? row.remark, decided_by: by, decided_at: now });
  }
  await batch(env, statements);

  // email the employee when a pending request is decided, or approved leave is cancelled
  const groups = new Map();
  for (const r of done) {
    const mail = (r.old === 'Pending' && status !== 'Pending' && !r.withdrawn) || (r.old === 'Approved' && status === 'Cancelled');
    if (!mail) continue;
    if (!groups.has(r.group_no)) groups.set(r.group_no, []);
    groups.get(r.group_no).push(r);
  }
  if (groups.size) {
    c.waitUntil((async () => {
      const settings = await getSettings(env);
      const types = await getLeaveTypes(env);
      for (const list of groups.values()) {
        list.sort((a, b) => (a.from_date < b.from_date ? -1 : 1));
        await notifyDecision(env, settings, types, list, status).catch((err) => console.error('Decision email failed:', err));
      }
    })());
  }
  return { updated: done.length, skipped };
}

async function notifyDecision(env, settings, types, rows, status) {
  const r = rows[0];
  const word = { Approved: 'APPROVED', Rejected: 'NOT APPROVED', Cancelled: 'CANCELLED' }[status];
  const color = { Approved: '#006100', Rejected: '#9c0006', Cancelled: '#595959' }[status];
  const when = whenText(rows);
  const log = [];
  if (r.employee_id) {
    log.push(`Employee: ${await notify(env, 'employee', [r.employee_id], {
      title: `Leave ${word === 'NOT APPROVED' ? 'not approved' : status.toLowerCase()}`, body: `${r.leave_type} · ${when}`, url: '/request/',
    }, settings.app_url)}`);
  }
  if (!emailEnabled(env)) {                 // email is off: the phone notification is enough
    await appendNotes(env, r.group_no, log.join(' | '));
    return;
  }
  const details = infoTable([
    ['Request', r.group_no], ['Leave type', r.leave_type], ['When', when],
    r.remark ? ['Remark', r.remark] : null,
    [`${status === 'Rejected' ? 'Not approved' : status} by`, r.decided_by], ['Date', nowText(settings)],
  ]);
  if (isEmail(r.emp_email)) {
    const inner = `<p>Dear ${esc(r.emp_name)},</p>
      <p style="font-size:16px">Your leave request has been <b style="color:${color}">${word}</b>.</p>
      ${status === 'Cancelled' ? '<p>This leave was not taken, so these days are <b>not counted</b>.</p>' : ''}
      ${details}`;
    log.push(`${status} email ${await sendEmail(env, settings, { to: r.emp_email, subject: `Your leave request ${r.group_no} was ${word}`, html: layout(settings, inner) })}`);
  } else {
    log.push(`${status}: employee not emailed (no valid email).`);
  }
  const copies = parseEmails(settings.copy_emails).filter((m) => m !== String(r.emp_email).toLowerCase());
  if (copies.length && status === 'Approved') {          // copies are for Approved leave only
    const inner = `<p>Leave of <b>${esc(r.emp_name)}</b> (${esc(r.emp_no)}, ${esc(r.department || '-')}) was <b style="color:${color}">${word}</b>.</p>${details}`;
    log.push(`Copy ${await sendEmail(env, settings, { to: copies, subject: `Leave ${word.toLowerCase()} - ${r.emp_name} - ${r.group_no}`, html: layout(settings, inner) })}`);
  }
  await appendNotes(env, r.group_no, log.join(' | '));
}
