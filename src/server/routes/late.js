// Late arrival: the employee informs (from the employee app) that they will come late today.
// Inform only - no approval. The department head(s) get a phone notification + email; the system keeps the message.
import { all, first, run } from '../db.js';
import { fail, readJson } from '../http.js';
import { can, scopeSql } from '../permissions.js';
import { getSettings } from '../settings.js';
import { approversFor, fallbackApprovers } from '../leave.js';
import { emailEnabled, infoTable, layout, sendEmail } from '../email.js';
import { notify } from '../push.js';
import { portalEmployee } from './portal.js';
import { clean, esc, fmtDate, isDate, isEmail, lower, nowIso, todayIn } from '../utils.js';

// ---------------------------------------------------------------- employee app
async function portalLate(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  const requestId = clean(b.request_id);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) fail(400, 'Please reload the page and try again.');
  const responseId = `portal-late-${requestId}`;
  const done = await first(c.env, 'SELECT id FROM late_arrivals WHERE form_response_id = ?', responseId);
  if (done) return { ok: true, group_no: 'Late arrival' };           // double tap: already saved
  const message = clean(b.message).slice(0, 500);
  if (!message) fail(400, 'Please write a short message (why you are late / when you will arrive).');
  const settings = await getSettings(c.env);
  const date = todayIn(settings.timezone);
  const now = nowIso();
  const res = await run(c.env, `INSERT INTO late_arrivals (employee_id, emp_no, emp_name, department_id, department, date, message, form_response_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, e.id, e.emp_no, e.name, e.department_id, e.department || '', date, message, responseId, now);
  c.waitUntil(tellHeads(c.env, c.origin, settings, { emp_name: e.name, emp_no: e.emp_no, emp_email: e.email, department_id: e.department_id, department: e.department || '', date, message })
    .catch((err) => console.error('Late arrival notice failed:', err)));
  return { ok: true, id: res.meta.last_row_id, group_no: `Late arrival · ${fmtDate(date)}` };
}

async function tellHeads(env, origin, settings, r) {
  const baseUrl = settings.app_url || origin;
  const notSelf = (a) => lower(a.email) !== lower(r.emp_email);
  let heads = (await approversFor(env, r.department_id)).filter(notSelf);
  if (!heads.length) heads = await fallbackApprovers(env, notSelf);
  await notify(env, 'user', heads.map((h) => h.id), { title: `Late arrival: ${r.emp_name}`, body: r.message, url: '/#/late' }, baseUrl);
  if (!emailEnabled(env)) return;
  for (const h of heads.filter((x) => isEmail(x.email))) {
    await sendEmail(env, settings, {
      to: h.email, subject: `[Late arrival] ${r.emp_name} - ${fmtDate(r.date)}`, replyTo: r.emp_email,
      html: layout(settings, `<p>Dear ${esc(h.name)}, <b>${esc(r.emp_name)}</b> informed that they will be <b>late today</b>. No action is needed.</p>
        ${infoTable([['Employee', `${r.emp_name} (${r.emp_no})`], ['Department', r.department || '-'], ['Date', fmtDate(r.date)], ['Message', r.message]])}
        <p style="font-size:12px;color:#666">All late messages: <a href="${esc(baseUrl)}/#/late">${esc(baseUrl)}</a></p>`),
    });
  }
}

export const portalLateRows = (env, employeeId) => all(env,
  'SELECT id, date, message, created_at FROM late_arrivals WHERE employee_id = ? ORDER BY date DESC, id DESC LIMIT 200', employeeId);

// ---------------------------------------------------------------- admin / head app: Late reasons page
async function listLate(c) {
  const { env, me, query } = c;
  if (!(can(me, 'requests.view') || can(me, 'approve.decide') || can(me, 'requests.manage'))) fail(403, 'You do not have access to this page.');
  const s = scopeSql(me);
  const where = [s.sql];
  const args = [...s.args];
  const from = clean(query.get('from'));
  const to = clean(query.get('to'));
  if (isDate(from)) { where.push('date >= ?'); args.push(from); }
  if (isDate(to)) { where.push('date <= ?'); args.push(to); }
  const dept = Number(query.get('department_id'));
  if (dept) { where.push('department_id = ?'); args.push(dept); }
  const q = clean(query.get('q'));
  if (q) { where.push('(emp_name LIKE ? OR emp_no LIKE ? OR message LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = await all(env, `SELECT id, employee_id, emp_no, emp_name, department, date, message, created_at FROM late_arrivals
    WHERE ${where.join(' AND ')} ORDER BY date DESC, created_at DESC LIMIT 2000`, ...args);
  return { rows };
}

export default [
  { method: 'POST', path: '/api/portal/late', auth: false, handler: portalLate },
  { method: 'GET', path: '/api/late', handler: listLate },
];
