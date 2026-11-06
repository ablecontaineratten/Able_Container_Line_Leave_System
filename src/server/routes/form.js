// Google Form bridge: the employees' existing Google Form sends each answer here (google-form/Bridge.gs).
// Protected by the FORM_SECRET secret, sent in the "x-form-secret" header.
import { all, first } from '../db.js';
import { fail, HttpError, readJson } from '../http.js';
import { getSettings } from '../settings.js';
import { createRequest, getLeaveTypes } from '../leave.js';
import { infoTable, layout, sendEmail } from '../email.js';
import { clean, esc, isEmail, lower, sameName } from '../utils.js';

function checkSecret(c) {
  const expected = c.env.FORM_SECRET || '';
  if (expected.length < 16) fail(503, 'The Google Form link is not set up (FORM_SECRET is missing). See GUIDE.md part 6A.');
  const given = c.request.headers.get('x-form-secret') || '';
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  if (diff !== 0) fail(401, 'Wrong form secret.');
}

// Lists for the form's dropdowns
async function options(c) {
  checkSecret(c);
  const [employees, types, settings] = await Promise.all([
    all(c.env, `SELECT emp_no, name FROM employees WHERE status = 'Active' ORDER BY emp_no`),
    getLeaveTypes(c.env, true),
    getSettings(c.env),
  ]);
  return {
    company_name: settings.company_name,
    employees,
    types: types.map((t) => ({ name: t.name, is_short: !!t.is_short, allow_half: !!t.allow_half })),
  };
}

const EMPLOYEE_SQL = `SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id`;

// Number + name from the form -> employee. Same matching as the old system:
// exact number, else the same digits (029 = 29) with a matching name.
async function findEmployee(env, empNo, empName, email) {
  const no = clean(empNo).replace(/\s+/g, '');
  if (no) {
    const exact = await first(env, `${EMPLOYEE_SQL} WHERE e.emp_no = ? COLLATE NOCASE`, no);
    if (exact) return exact;
    const digits = /(\d+)$/.exec(no);
    if (digits) {
      const same = (await all(env, `${EMPLOYEE_SQL} WHERE e.status = 'Active'`))
        .filter((e) => { const m = /(\d+)$/.exec(e.emp_no); return m && Number(m[1]) === Number(digits[1]); });
      const named = empName ? same.filter((e) => sameName(empName, e.name)) : same;
      if (named.length === 1) return named[0];
    }
  }
  if (isEmail(email)) return first(env, `${EMPLOYEE_SQL} WHERE e.email <> '' AND e.email = ? COLLATE NOCASE`, email);
  return null;
}

// Red "your request was NOT sent" email (like the old system)
async function alertEmployee(c, settings, to, reason, b) {
  if (!to.length) return 'no email to alert';
  const when = b.mode === 'dates' ? (b.dates || []).join(', ') : b.mode === 'range' ? `${b.from} to ${b.to}` : b.date;
  const inner = `<div style="background:#fdecea;border:2px solid #c62828;padding:14px 18px;border-radius:6px">
      <p style="color:#c62828;font-size:18px;margin:0 0 8px"><b>&#9888; Your leave request was NOT sent</b></p>
      <p style="margin:0">${esc(reason)}</p></div>
    ${infoTable([['Employee', `${b.emp_no || ''} ${b.emp_name || ''}`.trim()], ['Leave type', b.leave_type], ['Date(s)', when || '-']])}
    <p>Please check and <b>fill in the leave form again</b>.</p>
    ${settings.form_url ? `<p><a href="${esc(settings.form_url)}">Open the leave form</a></p>` : ''}
    <p style="font-size:12px;color:#666">Nothing was sent to your department head and no leave was counted.</p>`;
  return sendEmail(c.env, settings, { to, subject: '⚠ Leave request NOT sent', html: layout(settings, inner) });
}

async function submit(c) {
  checkSecret(c);
  const b = await readJson(c.request);
  const responseId = clean(b.response_id);
  if (!responseId) fail(400, 'response_id is required.');
  const done = await first(c.env, 'SELECT group_no FROM leave_requests WHERE form_response_id = ? LIMIT 1', responseId);
  if (done) return { ok: true, duplicate: true, group_no: done.group_no };
  const settings = await getSettings(c.env);
  const out = await processRequest(c, b, responseId, 'Via Google Form');
  if (out.ok) return out;
  const to = isEmail(b.email) ? [lower(b.email)] : out.emp && isEmail(out.emp.email) ? [out.emp.email] : [];
  const emailed = await alertEmployee(c, settings, to, out.error, b);
  console.log(`Google Form request stopped (${responseId}): ${out.error} | alert ${emailed}`);
  return { ok: false, error: out.error, alert: emailed };
}

// Shared by the Google Form and the public request page: finds the employee, checks, saves.
// Returns { ok: true, group_no, warnings } or { ok: false, error, emp }.
async function processRequest(c, b, responseId, note) {
  const email = lower(b.email);
  const emp = await findEmployee(c.env, b.emp_no, b.emp_name, email);
  const checks = [];
  let stop = '';
  if (!emp) stop = `Employee number "${clean(b.emp_no)}" was not found. Please choose your own number and name.`;
  else {
    // number and name must be the SAME person (the old "two lists" rule)
    if (clean(b.emp_name) && !sameName(b.emp_name, emp.name)) {
      stop = `The employee number and name do not match: ${emp.emp_no} belongs to ${emp.name}, but the name chosen is ${clean(b.emp_name)}.`;
    }
    if (emp.status !== 'Active') stop = stop || 'This employee is marked Inactive. Please contact the admin.';
    if (isEmail(email) && emp.email && emp.email.toLowerCase() !== email) checks.push(`Form sent from ${email}, but the Employees record has ${emp.email}.`);
  }

  if (!stop) {
    // the form acts like the employee applying for themselves (no past dates, normal checks)
    const actor = { id: null, name: 'Leave form', email: '', isSuper: false, perms: { 'leave.apply': true }, scopeAll: false, deptIds: [], employee: emp };
    try {
      const res = await createRequest({ ...c, me: actor }, {
        leave_type: b.leave_type, mode: b.mode, date: b.date, half: !!b.half, from: b.from, to: b.to, dates: b.dates,
        out_time: b.out_time, return_time: b.return_time, reason: b.reason,
        times_optional: true, contact_email: email, note, checks, form_response_id: responseId,
      });
      return { ok: true, group_no: res.group_no, warnings: res.warnings, emp };
    } catch (err) {
      if (!(err instanceof HttpError) || err.status >= 500) throw err;
      stop = err.message;
    }
  }
  return { ok: false, error: stop, emp };
}

export default [
  { method: 'GET', path: '/api/form/options', auth: false, handler: options },
  { method: 'POST', path: '/api/form/submit', auth: false, handler: submit },
];
