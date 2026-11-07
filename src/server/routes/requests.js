// Leave requests, approvals, dashboard, calendar, team balances, reports, email buttons
import { all, batch, first, marks, stmt } from '../db.js';
import { fail, html, readJson } from '../http.js';
import { can, inScope, requirePerm, scopeSql } from '../permissions.js';
import { getSettings } from '../settings.js';
import {
  approversFor, balanceSummary, computeSummary, createRequest, decideRequests, getLeaveTypes, leaveYear, shortLimit, STATUSES,
} from '../leave.js';
import { infoTable, page, whenText } from '../email.js';
import { addDays, clean, esc, isDate, lower, todayIn } from '../utils.js';
import { workInMonth, workOnDay, workPendingCount } from './work.js';

const LIST_COLUMNS = `id, request_no, group_no, employee_id, emp_no, emp_name, department_id, department, leave_type, from_date, to_date,
  day_type, out_time, return_time, days, hours, reason, status, remark, decided_by, decided_at, submitted_at`;

async function dashboard(c) {
  const { env, me } = c;
  const settings = await getSettings(env);
  const today = todayIn(settings.timezone);
  const out = { today, balance: null, recent: [], upcoming: [], pendingCount: 0, onLeaveToday: [], workPendingCount: 0, workToday: [] };
  out.workPendingCount = await workPendingCount(env, me);        // Work From Home / Onsite waiting for a decision
  if (me.employee && can(me, 'mine.view')) {
    out.balance = await balanceSummary(env, me.employee.id, today, { settings });
    out.recent = await all(env, `SELECT ${LIST_COLUMNS} FROM leave_requests WHERE employee_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 5`, me.employee.id);
    out.upcoming = await all(env, `SELECT ${LIST_COLUMNS} FROM leave_requests WHERE employee_id = ? AND status = 'Approved' AND to_date >= ? ORDER BY from_date LIMIT 5`, me.employee.id, today);
  }
  if (can(me, 'approve.decide') || can(me, 'requests.manage')) {
    const s = scopeSql(me);
    const row = await first(env, `SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'Pending' AND ${s.sql} AND (employee_id IS NULL OR employee_id <> ?)`,
      ...s.args, me.employee ? me.employee.id : 0);
    out.pendingCount = row.n;
  }
  if (can(me, 'calendar.view')) {
    const s = scopeSql(me);
    out.onLeaveToday = await all(env, `SELECT emp_name, department, leave_type, day_type, from_date, to_date FROM leave_requests
      WHERE status = 'Approved' AND from_date <= ? AND to_date >= ? AND ${s.sql} ORDER BY emp_name`, today, today, ...s.args);
    out.workToday = await workOnDay(env, me, today);              // approved Work From Home / Onsite today
  }
  // dashboard: pending requests + the latest 5 approved (in my departments) + my latest notifications
  if (can(me, 'requests.view') || can(me, 'approve.decide') || can(me, 'requests.manage')) {
    const s = scopeSql(me);
    out.pending = await all(env, `SELECT ${LIST_COLUMNS} FROM leave_requests WHERE status = 'Pending' AND ${s.sql}
      ORDER BY submitted_at DESC, id DESC LIMIT 20`, ...s.args);
    out.approved = await all(env, `SELECT ${LIST_COLUMNS} FROM leave_requests WHERE status = 'Approved' AND ${s.sql}
      ORDER BY decided_at DESC, id DESC LIMIT 5`, ...s.args);
  }
  out.notifications = await all(env, `SELECT id, title, body, url, read_at, created_at FROM notifications
    WHERE owner_type = 'user' AND owner_id = ? ORDER BY id DESC LIMIT 5`, me.id);
  return out;
}

async function balance(c) {
  const { env, me } = c;
  const settings = await getSettings(env);
  const date = isDate(c.query.get('date')) ? c.query.get('date') : todayIn(settings.timezone);
  const id = Number(c.query.get('employee_id')) || (me.employee && me.employee.id);
  if (!id) fail(400, 'Your login is not linked to an employee record.');
  if (!me.employee || id !== me.employee.id) {
    const emp = await first(env, 'SELECT department_id FROM employees WHERE id = ?', id);
    if (!emp) fail(404, 'Employee not found.');
    requirePerm(me, ['team.view', 'leave.apply_others', 'requests.view']);
    if (!inScope(me, emp.department_id)) fail(403, 'This employee is not in your department(s).');
  } else {
    requirePerm(me, 'mine.view');
  }
  return balanceSummary(env, id, date, { settings });
}

async function create(c) {
  requirePerm(c.me, 'leave.apply');
  return createRequest(c, await readJson(c.request));
}

// view = mine | pending | decided | all
async function list(c) {
  const { env, me, query } = c;
  const view = query.get('view') || 'mine';
  const where = [];
  const args = [];
  if (view === 'decided') {
    // phone app for heads: the latest approved / rejected requests of my department(s)
    requirePerm(me, ['approve.decide', 'requests.manage']);
    const s = scopeSql(me);
    const rows = await all(env, `SELECT ${LIST_COLUMNS} FROM leave_requests
      WHERE status IN ('Approved', 'Rejected') AND decided_at IS NOT NULL AND ${s.sql} ORDER BY decided_at DESC LIMIT 30`, ...s.args);
    return { rows };
  }
  if (view === 'mine') {
    if (!me.employee) return { rows: [] };
    where.push('employee_id = ?');
    args.push(me.employee.id);
  } else {
    requirePerm(me, view === 'pending' ? ['approve.decide', 'requests.manage'] : 'requests.view');
    const s = scopeSql(me);
    where.push(s.sql);
    args.push(...s.args);
    if (view === 'pending') {
      where.push(`status = 'Pending'`);
      if (me.employee && !me.isSuper) {
        where.push('(employee_id IS NULL OR employee_id <> ?)');
        args.push(me.employee.id);
      }
    }
  }
  const status = query.get('status');
  if (status && STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  const dept = Number(query.get('department_id'));
  if (dept) { where.push('department_id = ?'); args.push(dept); }
  const type = clean(query.get('leave_type'));
  if (type) { where.push('leave_type = ? COLLATE NOCASE'); args.push(type); }
  const from = query.get('from');
  if (isDate(from)) { where.push('to_date >= ?'); args.push(from); }
  const to = query.get('to');
  if (isDate(to)) { where.push('from_date <= ?'); args.push(to); }
  const q = clean(query.get('q'));
  if (q) {
    where.push('(emp_name LIKE ? OR emp_no LIKE ? OR request_no LIKE ? OR reason LIKE ?)');
    args.push(...Array(4).fill(`%${q}%`));
  }
  const limit = Math.min(Math.max(Number(query.get('limit')) || 500, 1), 2000);
  const cols = can(me, 'requests.manage') || me.isSuper ? `${LIST_COLUMNS}, notes` : LIST_COLUMNS;
  const rows = await all(env,
    `SELECT ${cols} FROM leave_requests WHERE ${where.join(' AND ') || '1 = 1'} ORDER BY from_date DESC, id DESC LIMIT ?`, ...args, limit);
  return { rows };
}

async function decide(c) {
  const b = await readJson(c.request);
  return decideRequests(c, { me: c.me, name: c.me.name }, b.ids, clean(b.status), b.remark);
}

async function remove(c) {
  requirePerm(c.me, 'requests.delete');
  const b = await readJson(c.request);
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => n > 0))].slice(0, 500);
  if (!ids.length) fail(400, 'Choose at least one request.');
  const rows = await all(c.env, `SELECT id, department_id FROM leave_requests WHERE id IN (${marks(ids)})`, ...ids);
  const allowed = rows.filter((r) => inScope(c.me, r.department_id)).map((r) => r.id);
  await batch(c.env, allowed.map((id) => stmt(c.env, 'DELETE FROM leave_requests WHERE id = ?', id)));
  return { deleted: allowed.length, skipped: ids.length - allowed.length };
}

// month = YYYY-MM. Employees see their own department.
async function calendar(c) {
  const { env, me } = c;
  const settings = await getSettings(env);
  const month = /^\d{4}-\d{2}$/.test(c.query.get('month') || '') ? c.query.get('month') : todayIn(settings.timezone).slice(0, 7);
  const start = `${month}-01`;
  const end = addDays(addDays(start, 31).slice(0, 7) + '-01', -1);
  const s = scopeSql(me);
  const where = [`status IN ('Approved', 'Pending')`, 'from_date <= ?', 'to_date >= ?', s.sql];
  const args = [end, start, ...s.args];
  const dept = Number(c.query.get('department_id'));
  if (dept) { where.push('department_id = ?'); args.push(dept); }
  const [rows, holidays, work] = await Promise.all([
    all(env, `SELECT id, request_no, emp_name, emp_no, department, leave_type, day_type, from_date, to_date, out_time, return_time, status
              FROM leave_requests WHERE ${where.join(' AND ')} ORDER BY emp_name`, ...args),
    all(env, 'SELECT date, name FROM holidays WHERE date >= ? AND date <= ? ORDER BY date', start, end),
    workInMonth(env, me, start, end, dept),                       // Work From Home / Onsite (shown, not counted as leave)
  ]);
  return { month, start, end, rows, holidays, work };
}

// Every employee in scope with the balance of every leave type (one query for all requests)
async function team(c) {
  const { env, me } = c;
  const settings = await getSettings(env);
  const date = isDate(c.query.get('date')) ? c.query.get('date') : todayIn(settings.timezone);
  const year = leaveYear(date, settings.year_start);
  const types = await getLeaveTypes(env);
  const s = scopeSql(me, 'e.department_id');
  const where = [`e.status = 'Active'`, s.sql];
  const args = [...s.args];
  const dept = Number(c.query.get('department_id'));
  if (dept) { where.push('e.department_id = ?'); args.push(dept); }
  const employees = await all(env, `SELECT e.id, e.emp_no, e.name, d.name AS department FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id WHERE ${where.join(' AND ')} ORDER BY d.name, e.name`, ...args);
  const ids = employees.map((e) => e.id);
  const rows = ids.length ? await all(env, `SELECT employee_id, leave_type, days, status, day_type, from_date FROM leave_requests
    WHERE status IN ('Approved', 'Pending') AND from_date >= ? AND from_date < ? AND employee_id IN (${marks(ids)})`,
    year.start, year.end, ...ids) : [];
  // approved WFH days (not leave): this leave year + this month, per employee
  const wfhRows = ids.length ? await all(env, `SELECT employee_id, dates FROM work_requests WHERE status = 'Approved' AND work_type = 'Work From Home'
    AND to_date >= ? AND from_date < ? AND employee_id IN (${marks(ids)})`, year.start, year.end, ...ids) : [];
  const wfh = new Map();
  const weekStart = addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));      // this week's Monday
  const weekEnd = addDays(weekStart, 6);
  for (const w of wfhRows) {
    const days = w.dates.split(',').filter((d) => d >= year.start && d < year.end);
    const x = wfh.get(w.employee_id) || { year: 0, month: 0, week: 0 };
    x.year += days.length;
    x.month += days.filter((d) => d.slice(0, 7) === date.slice(0, 7)).length;
    x.week += w.dates.split(',').filter((d) => d >= weekStart && d <= weekEnd).length;
    wfh.set(w.employee_id, x);
  }
  // late arrival messages (inform only): this leave year + this month
  const lateRows = ids.length ? await all(env, `SELECT employee_id, date FROM late_arrivals WHERE date >= ? AND date < ? AND employee_id IN (${marks(ids)})`,
    year.start, year.end, ...ids) : [];
  const lateBy = new Map();
  for (const l of lateRows) {
    const x = lateBy.get(l.employee_id) || { year: 0, month: 0, days: new Set() };
    if (!x.days.has(l.date)) {             // several messages on one day = one late day
      x.days.add(l.date);
      x.year += 1;
      if (l.date.slice(0, 7) === date.slice(0, 7)) x.month += 1;
    }
    lateBy.set(l.employee_id, x);
  }
  const shortNames = new Set(types.filter((t) => t.is_short).map((t) => t.name.toLowerCase()));
  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push(r);
  }
  return {
    year,
    types: types.filter((t) => t.active).map((t) => t.name),
    // header totals (from Settings → Leave types) for the Leave balance page
    columns: {
      annual: pick(/annual/i), casual: pick(/casual/i),
      short: { name: (types.find((t) => t.is_short) || {}).name || 'Short Leave', limit: shortLimit(settings, types) },
      pool: computeSummary(types, settings, [], year).pool,
    },
    employees: employees.map((e) => {
      const own = byEmp.get(e.id) || [];
      const month = date.slice(0, 7);
      return {
        ...e,
        summary: computeSummary(types, settings, own, year),
        half: own.filter((r) => r.status === 'Approved' && r.day_type === 'Half Day').length,
        wfhYear: (wfh.get(e.id) || {}).year || 0,
        wfhMonth: (wfh.get(e.id) || {}).month || 0,
        wfhWeek: (wfh.get(e.id) || {}).week || 0,
        lateYear: (lateBy.get(e.id) || {}).year || 0,
        lateMonth: (lateBy.get(e.id) || {}).month || 0,
        shortUsed: own.filter((r) => r.status === 'Approved' && shortNames.has(String(r.leave_type).toLowerCase()) && String(r.from_date).slice(0, 7) === month).length,
      };
    }),
  };

  function pick(re) {
    const t = types.find((x) => re.test(x.name) && !x.is_short);
    return t ? { name: t.name, allowed: t.days_per_year } : null;
  }
}

// Approved leave in a date range, per employee and leave type
async function reports(c) {
  const { env, me, query } = c;
  const settings = await getSettings(env);
  const today = todayIn(settings.timezone);
  const from = isDate(query.get('from')) ? query.get('from') : `${today.slice(0, 7)}-01`;
  const to = isDate(query.get('to')) ? query.get('to') : today;
  if (to < from) fail(400, 'The "To" date is before the "From" date.');
  const s = scopeSql(me);
  const where = [`status = 'Approved'`, 'from_date >= ?', 'from_date <= ?', s.sql];
  const args = [from, to, ...s.args];
  const dept = Number(query.get('department_id'));
  if (dept) { where.push('department_id = ?'); args.push(dept); }
  const [types, rows] = await Promise.all([
    getLeaveTypes(env),
    all(env, `SELECT ${LIST_COLUMNS} FROM leave_requests WHERE ${where.join(' AND ')} ORDER BY department, emp_name, from_date`, ...args),
  ]);
  const shortNames = new Set(types.filter((t) => t.is_short).map((t) => t.name.toLowerCase()));
  const people = new Map();
  const totals = {};
  for (const r of rows) {
    const key = r.employee_id || r.emp_no;
    if (!people.has(key)) people.set(key, { emp_no: r.emp_no, name: r.emp_name, department: r.department, byType: {}, total: 0 });
    const p = people.get(key);
    const isShort = shortNames.has(r.leave_type.toLowerCase());
    const n = isShort ? 1 : Number(r.days) || 0;
    p.byType[r.leave_type] = (p.byType[r.leave_type] || 0) + n;
    totals[r.leave_type] = (totals[r.leave_type] || 0) + n;
    if (!isShort) p.total += n;
  }
  const typeNames = types.filter((t) => t.active || totals[t.name]).map((t) => t.name);
  return { from, to, types: typeNames, shortTypes: [...shortNames], people: [...people.values()], totals, rows };
}

// ---------------------------------------------------------------- Approve / Reject buttons in the email
// GET shows a confirm page (email scanners open links), POST makes the decision.
async function emailDecide(c) {
  const { env, query } = c;
  const settings = await getSettings(env);
  const groupNo = clean(query.get('g'));
  const token = clean(query.get('t'));
  const action = query.get('a') === 'reject' ? 'reject' : 'approve';
  const approverEmail = lower(query.get('w'));
  const rows = groupNo && token ? await all(env, 'SELECT * FROM leave_requests WHERE group_no = ? AND token = ? ORDER BY from_date', groupNo, token) : [];
  if (!rows.length) return html(page(settings, 'Link not valid', '<p>This link is not valid any more. Please open the Leave System app.</p>'), 404);

  const pending = rows.filter((r) => r.status === 'Pending');
  const r = rows[0];
  const details = infoTable([
    ['Request', r.group_no], ['Employee', `${r.emp_name} (${r.emp_no})`], ['Department', r.department || '-'],
    ['Leave type', r.leave_type], ['When', whenText(rows)], r.reason ? ['Reason', r.reason] : null,
  ]);
  if (!pending.length) {
    return html(page(settings, `Already ${r.status.toLowerCase()}`,
      `${details}<p>This request was already <b>${esc(r.status)}</b>${r.decided_by ? ` by ${esc(r.decided_by)}` : ''}. Nothing was changed.</p>`));
  }

  if (c.request.method === 'GET') {
    return html(page(settings, action === 'approve' ? 'Approve this leave?' : 'Reject this leave?', `${details}
      <form method="post">
        <label for="remark" class="muted">Remark (optional)</label>
        <textarea id="remark" name="remark" maxlength="500"></textarea>
        <div class="row">
          <button class="ok" name="action" value="approve"${action === 'approve' ? ' autofocus' : ''}>Approve</button>
          <button class="no" name="action" value="reject"${action === 'reject' ? ' autofocus' : ''}>Reject</button>
        </div>
      </form>`));
  }

  const form = await c.request.formData();
  const status = form.get('action') === 'reject' ? 'Rejected' : 'Approved';
  const approver = (await approversFor(env, r.department_id)).find((a) => a.email.toLowerCase() === approverEmail);
  const name = approver ? approver.name : 'Email approver';
  const result = await decideRequests(c, { system: true, name: `${name} (email)` }, pending.map((x) => x.id), status, form.get('remark'));
  if (!result.updated) return html(page(settings, 'Nothing changed', `${details}<p>${esc(result.skipped.map((s) => s.reason).join(' '))}</p>`));
  return html(page(settings, status === 'Approved' ? 'Leave approved' : 'Leave rejected',
    `${details}<p>Done. The request is now <b>${status}</b>. ${esc(r.emp_name)} gets an email automatically.</p>`));
}

export default [
  { method: 'GET', path: '/api/dashboard', handler: dashboard },
  { method: 'GET', path: '/api/balance', handler: balance },
  { method: 'GET', path: '/api/requests', handler: list },
  { method: 'POST', path: '/api/requests', handler: create },
  { method: 'POST', path: '/api/requests/decide', handler: decide },
  { method: 'POST', path: '/api/requests/delete', handler: remove },
  { method: 'GET', path: '/api/calendar', perm: 'calendar.view', handler: calendar },
  { method: 'GET', path: '/api/team', perm: 'team.view', handler: team },
  { method: 'GET', path: '/api/reports', perm: 'reports.view', handler: reports },
  { method: 'GET', path: '/api/email/decide', auth: false, handler: emailDecide },
  { method: 'POST', path: '/api/email/decide', auth: false, handler: emailDecide },
];
