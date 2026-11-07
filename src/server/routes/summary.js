// Summary grid: every employee (across) × every leave type (down), each cell = the approved leave dates.
// With "summary.edit" dates can be added or removed by hand (one, many, or for many employees at once).
import { all, batch, marks, stmt } from '../db.js';
import { fail, readJson } from '../http.js';
import { inScope, scopeSql } from '../permissions.js';
import { getSettings, weekendSet } from '../settings.js';
import { getHolidaySet, getLeaveTypes, leaveYear, nextGroupNo, workingDates } from '../leave.js';
import { randomHex } from '../auth.js';
import { clean, isDate, nowIso, todayIn } from '../utils.js';

const HALF = 'Half Day';
const WFH = 'WFH';
const LATE = 'Late';

// Which grid row a request belongs to
function rowKey(r, shortNames) {
  if (shortNames.has(String(r.leave_type).toLowerCase())) return r.leave_type;
  if (r.day_type === 'Half Day') return HALF;
  return r.leave_type;
}

async function grid(c) {
  const { env, me, query } = c;
  const settings = await getSettings(env);
  const date = isDate(query.get('date')) ? query.get('date') : todayIn(settings.timezone);
  const year = leaveYear(date, settings.year_start);
  const [types, holidays] = await Promise.all([getLeaveTypes(env), getHolidaySet(env)]);
  const s = scopeSql(me, 'e.department_id');
  const where = [`e.status = 'Active'`, s.sql];
  const args = [...s.args];
  const dept = Number(query.get('department_id'));
  if (dept) { where.push('e.department_id = ?'); args.push(dept); }
  const employees = await all(env, `SELECT e.id, e.emp_no, e.name, d.name AS department FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id WHERE ${where.join(' AND ')} ORDER BY d.name, e.emp_no`, ...args);
  const ids = employees.map((e) => e.id);
  const rows = ids.length ? await all(env, `SELECT employee_id, leave_type, day_type, from_date, to_date FROM leave_requests
    WHERE status = 'Approved' AND from_date >= ? AND from_date < ? AND employee_id IN (${marks(ids)})`, year.start, year.end, ...ids) : [];

  const shortNames = new Set(types.filter((t) => t.is_short).map((t) => t.name.toLowerCase()));
  const weekend = weekendSet(settings);
  const cells = {};
  for (const r of rows) {
    const key = rowKey(r, shortNames);
    const dates = r.from_date === r.to_date ? [r.from_date] : workingDates(r.from_date, r.to_date, weekend, holidays);
    const cell = ((cells[r.employee_id] = cells[r.employee_id] || {})[key] = cells[r.employee_id][key] || []);
    cell.push(...dates);
  }
  // WFH (not leave): approved Work From Home days in the same year
  const work = ids.length ? await all(env, `SELECT employee_id, dates FROM work_requests WHERE status = 'Approved' AND work_type = 'Work From Home'
    AND to_date >= ? AND from_date < ? AND employee_id IN (${marks(ids)})`, year.start, year.end, ...ids) : [];
  for (const w of work) {
    const cell = ((cells[w.employee_id] = cells[w.employee_id] || {})[WFH] = cells[w.employee_id][WFH] || []);
    cell.push(...w.dates.split(',').filter((d) => d >= year.start && d < year.end));
  }
  // Late arrivals (inform only): the days each employee said they would be late
  const late = ids.length ? await all(env, `SELECT employee_id, date FROM late_arrivals WHERE date >= ? AND date < ? AND employee_id IN (${marks(ids)})`,
    year.start, year.end, ...ids) : [];
  for (const l of late) ((cells[l.employee_id] = cells[l.employee_id] || {})[LATE] = cells[l.employee_id][LATE] || []).push(l.date);
  for (const e of Object.values(cells)) for (const k of Object.keys(e)) e[k] = [...new Set(e[k])].sort();

  // the chart shows only Casual, Annual, Half Day and Short Leave
  const find = (re) => types.find((t) => re.test(t.name) && !t.is_short);
  const casual = find(/casual/i);
  const annual = find(/annual/i);
  const short = types.find((t) => t.is_short);
  const halfTypes = types.filter((t) => t.active && t.allow_half && !t.is_short).map((t) => t.name);
  const label = (name) => name.replace(/\s+leave$/i, '');
  return {
    year, employees, cells, halfTypes,
    rows: [
      casual && { key: casual.name, label: label(casual.name), kind: 'full' },
      annual && { key: annual.name, label: label(annual.name), kind: 'full' },
      halfTypes.length && { key: HALF, label: 'Half Day', kind: 'half' },
      short && { key: short.name, label: label(short.name), kind: 'short' },
      { key: WFH, label: 'WFH', kind: 'wfh' },          // shown only - WFH is requested and approved in its own flow
      { key: LATE, label: 'Late', kind: 'late' },       // shown only - late arrival messages (inform only)
    ].filter(Boolean),
  };
}

// Same scope + type checks for add and remove
async function prepare(c, b) {
  const settings = await getSettings(c.env);
  const types = await getLeaveTypes(c.env);
  const key = clean(b.type);
  const isHalf = key === HALF;
  const type = isHalf ? types.find((t) => t.name.toLowerCase() === clean(b.half_type).toLowerCase() && t.allow_half)
    : types.find((t) => t.name.toLowerCase() === key.toLowerCase());
  if (!type) fail(400, isHalf ? 'Choose which leave type the half day is (for example Casual Leave).' : 'Unknown leave type.');
  const dates = [...new Set((Array.isArray(b.dates) ? b.dates : []).map(clean).filter(isDate))].sort();
  if (!dates.length) fail(400, 'Choose at least one date.');
  if (dates.length > 400) fail(400, 'Too many dates at once.');
  const ids = [...new Set((Array.isArray(b.employee_ids) ? b.employee_ids : [b.employee_id]).map(Number).filter(Boolean))];
  if (!ids.length) fail(400, 'Choose at least one employee.');
  const emps = await all(c.env, `SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id
    WHERE e.id IN (${marks(ids)})`, ...ids);
  if (emps.some((e) => !inScope(c.me, e.department_id))) fail(403, 'One of the employees is not in your department(s).');
  return { settings, types, type, isHalf, dates, emps, holidays: await getHolidaySet(c.env) };
}

// Adds approved leave dates exactly as given (any day of the week, holidays too).
// Only a date the employee already has leave on is skipped, so nothing is counted twice.
async function addDates(c) {
  const { env, me } = c;
  const p = await prepare(c, await readJson(c.request));
  const dayType = p.type.is_short ? 'Short Leave' : p.isHalf ? 'Half Day' : 'Full Day';
  const now = nowIso();
  let added = 0;
  const skipped = [];
  for (const e of p.emps) {
    const busy = await all(env, `SELECT from_date, to_date, day_type FROM leave_requests WHERE employee_id = ? AND status IN ('Pending', 'Approved')
      AND to_date >= ? AND from_date <= ?`, e.id, p.dates[0], p.dates[p.dates.length - 1]);
    const free = p.dates.filter((d) => {
      const same = busy.filter((r) => r.from_date <= d && r.to_date >= d && (p.type.is_short ? r.day_type === 'Short Leave' : r.day_type !== 'Short Leave'));
      const ok = !same.length || (p.isHalf && same.length === 1 && same[0].day_type === 'Half Day');
      if (!ok) skipped.push(`${e.name} ${d}: already has leave`);
      return ok;
    });
    if (!free.length) continue;
    const groupNo = await nextGroupNo(env, free[0]);
    const token = randomHex(24);
    await batch(env, free.map((d, i) => stmt(env,
      `INSERT INTO leave_requests (request_no, group_no, employee_id, emp_no, emp_name, emp_email, department_id, department, leave_type,
         from_date, to_date, day_type, days, status, decided_by, decided_at, notes, token, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved', ?, ?, ?, ?, ?, ?)`,
      free.length > 1 ? `${groupNo}-${i + 1}` : groupNo, groupNo, e.id, e.emp_no, e.name, e.email || '', e.department_id, e.department || '',
      p.type.name, d, d, dayType, p.type.is_short ? 0 : p.isHalf ? 0.5 : 1, `${me.name} (Summary)`, now, `Added in Summary by ${me.name}`, token, me.id, now)));
    added += free.length;
  }
  return { added, skipped };
}

// Removes dates: a one-day leave is cancelled; a longer leave is cancelled and the other days are kept as new rows
async function removeDates(c) {
  const { env, me } = c;
  const p = await prepare(c, await readJson(c.request));
  const weekend = weekendSet(p.settings);
  const shortNames = new Set(p.types.filter((t) => t.is_short).map((t) => t.name.toLowerCase()));
  const key = p.isHalf ? HALF : p.type.name;
  const now = nowIso();
  const note = `Removed in Summary by ${me.name}`;
  let removed = 0;
  for (const e of p.emps) {
    const rows = await all(env, `SELECT * FROM leave_requests WHERE employee_id = ? AND status = 'Approved' AND to_date >= ? AND from_date <= ?`,
      e.id, p.dates[0], p.dates[p.dates.length - 1]);
    for (const r of rows) {
      if (rowKey(r, shortNames).toLowerCase() !== key.toLowerCase()) continue;
      const days = r.from_date === r.to_date ? [r.from_date] : workingDates(r.from_date, r.to_date, weekend, p.holidays);
      const drop = days.filter((d) => p.dates.includes(d));
      if (!drop.length) continue;
      const keep = days.filter((d) => !p.dates.includes(d));
      const statements = [stmt(env, `UPDATE leave_requests SET status = 'Cancelled', decided_by = ?, decided_at = ?,
        notes = CASE WHEN notes = '' THEN ? ELSE notes || ' | ' || ? END WHERE id = ?`, `${me.name} (Summary)`, now, note, note, r.id)];
      keep.forEach((d, i) => statements.push(stmt(env,
        `INSERT INTO leave_requests (request_no, group_no, employee_id, emp_no, emp_name, emp_email, department_id, department, leave_type,
           from_date, to_date, day_type, days, reason, status, remark, decided_by, decided_at, notes, token, submitted_by, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Full Day', 1, ?, 'Approved', ?, ?, ?, ?, ?, ?, ?)`,
        `${r.request_no}.${i + 1}`, r.group_no, r.employee_id, r.emp_no, r.emp_name, r.emp_email, r.department_id, r.department, r.leave_type,
        d, d, r.reason, r.remark, r.decided_by, r.decided_at, `Kept when ${drop.join(', ')} was removed in Summary`, r.token, r.submitted_by, r.submitted_at)));
      await batch(env, statements);
      removed += drop.length;
    }
  }
  return { removed };
}

export default [
  { method: 'GET', path: '/api/summary', perm: 'summary.view', handler: grid },
  { method: 'POST', path: '/api/summary/add', perm: 'summary.edit', handler: addDates },
  { method: 'POST', path: '/api/summary/remove', perm: 'summary.edit', handler: removeDates },
];
