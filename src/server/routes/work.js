// Work From Home / Onsite requests: the employee asks for a way of working on some dates (NOT leave - no balance).
// Same flow as leave: the department head(s) get a phone notification + email with Approve / Reject,
// the employee gets a notification + email with the decision.
import { all, batch, first, marks, run, stmt } from '../db.js';
import { fail, html, HttpError, readJson } from '../http.js';
import { can, inScope, scopeSql } from '../permissions.js';
import { getSettings, weekendSet } from '../settings.js';
import { randomHex } from '../auth.js';
import { approversFor, fallbackApprovers, getHolidaySet, workingDates } from '../leave.js';
import { button, emailEnabled, infoTable, layout, nowText, page, sendEmail } from '../email.js';
import { notify } from '../push.js';
import { portalEmployee } from './portal.js';
import { addDays, clean, esc, fmtDate, isDate, isEmail, lower, monthName, nowIso, todayIn } from '../utils.js';

export const WORK_TYPES = ['Work From Home', 'Onsite'];
const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];
const COLUMNS = `id, request_no, employee_id, emp_no, emp_name, emp_email, department_id, department, work_type, location,
  from_date, to_date, mode, dates, days, reason, status, remark, decided_by, decided_at, submitted_at`;

// "06 Nov 2026", "06 Nov 2026 → 08 Nov 2026" (days in a row) or "06 Nov 2026, 09 Nov 2026" (separate dates)
export function workWhen(r) {
  const list = String(r.dates || '').split(',').filter(Boolean);
  if (r.mode === 'range' && r.from_date !== r.to_date) return `${fmtDate(r.from_date)} → ${fmtDate(r.to_date)}`;
  return list.length > 1 ? list.map(fmtDate).join(', ') : fmtDate(r.from_date);
}
const typeText = (r) => `${r.work_type}${r.location ? ` (${r.location})` : ''}`;

async function appendNotes(env, id, text) {
  if (!text) return;
  await run(env, `UPDATE work_requests SET notes = CASE WHEN notes = '' THEN ? ELSE notes || ' | ' || ? END WHERE id = ?`, text, text, id);
}

// W26Nov001, W26Nov002 ... (month of the first date)
async function nextWorkNo(env, date) {
  const key = `W${date.slice(2, 4)}${monthName(date)}`;
  const row = await first(env, 'INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value', key);
  return key + String(row.value).padStart(3, '0');
}

// ---------------------------------------------------------------- new request (from the employee app)
async function createWorkRequest(c, employee, input) {
  const { env } = c;
  const [settings, holidays] = await Promise.all([getSettings(env), getHolidaySet(env)]);
  const today = todayIn(settings.timezone);
  if (employee.status !== 'Active') fail(400, 'This employee is marked Inactive.');

  const workType = WORK_TYPES.find((t) => t.toLowerCase() === lower(input.work_type));
  if (!workType) fail(400, 'Choose Work From Home or Onsite.');
  const location = workType === 'Onsite' ? clean(input.location).slice(0, 120) : '';
  const reason = clean(input.reason).slice(0, 1000);

  // ---- the date(s): one day / days in a row / separate dates -> the working dates
  const weekend = weekendSet(settings);
  const mode = ['one', 'range', 'dates'].includes(input.mode) ? input.mode : 'one';
  let dates;
  if (mode === 'dates') {
    dates = [...new Set((Array.isArray(input.dates) ? input.dates : []).map(clean).filter(Boolean))].sort();
    if (dates.some((d) => !isDate(d))) fail(400, 'One of the dates is not valid.');
    if (!dates.length) fail(400, 'Choose at least one date.');
    if (dates.length > 10) fail(400, 'Choose at most 10 separate dates.');
    const off = dates.filter((d) => !workingDates(d, d, weekend, holidays).length);
    if (off.length) fail(400, `${off.map(fmtDate).join(', ')} ${off.length === 1 ? 'is a weekend day / holiday' : 'are weekend days / holidays'}.`);
  } else if (mode === 'range') {
    const from = clean(input.from);
    const to = clean(input.to);
    if (!isDate(from) || !isDate(to)) fail(400, 'Choose the From and To dates.');
    if (to < from) fail(400, 'The "To" date is before the "From" date.');
    if (addDays(from, 92) < to) fail(400, 'One request can be at most 3 months long.');
    dates = workingDates(from, to, weekend, holidays);
    if (!dates.length) fail(400, 'There are no working days in these dates (weekend / holiday).');
  } else {
    const d = clean(input.date);
    if (!isDate(d)) fail(400, 'Choose the date.');
    if (!workingDates(d, d, weekend, holidays).length) fail(400, `${fmtDate(d)} is a weekend day / holiday.`);
    dates = [d];
  }
  if (dates[0] < today) fail(400, 'Dates before today are not allowed.');

  // ---- not on a day with leave, and not twice for the same day
  const from = dates[0];
  const to = dates[dates.length - 1];
  const leave = await all(env, `SELECT request_no, status, from_date, to_date FROM leave_requests WHERE employee_id = ? AND status IN ('Pending', 'Approved')
    AND day_type = 'Full Day' AND from_date <= ? AND to_date >= ?`, employee.id, to, from);
  const onLeave = dates.find((d) => leave.some((l) => l.from_date <= d && l.to_date >= d));
  if (onLeave) {
    const l = leave.find((x) => x.from_date <= onLeave && x.to_date >= onLeave);
    fail(400, `You have leave ${l.request_no} (${l.status}) on ${fmtDate(onLeave)}.`);
  }
  const work = await all(env, `SELECT request_no, status, dates FROM work_requests WHERE employee_id = ? AND status IN ('Pending', 'Approved')
    AND from_date <= ? AND to_date >= ?`, employee.id, to, from);
  for (const w of work) {
    const same = dates.find((d) => w.dates.split(',').includes(d));
    if (same) fail(400, `You already have request ${w.request_no} (${w.status}) on ${fmtDate(same)}.`);
  }

  // ---- save
  const requestNo = await nextWorkNo(env, from);
  const contactEmail = isEmail(input.contact_email) ? lower(input.contact_email) : (employee.email || '');
  await run(env, `INSERT INTO work_requests (request_no, employee_id, emp_no, emp_name, emp_email, department_id, department, work_type, location,
      from_date, to_date, mode, dates, days, reason, status, notes, token, form_response_id, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Via employee portal', ?, ?, ?)`,
  requestNo, employee.id, employee.emp_no, employee.name, contactEmail, employee.department_id, employee.department || '', workType, location,
  from, to, dates.length === 1 ? 'one' : mode, dates.join(','), dates.length, reason, randomHex(24), clean(input.form_response_id) || null, nowIso());
  const saved = await first(env, 'SELECT * FROM work_requests WHERE request_no = ?', requestNo);
  c.waitUntil(notifyNewWork(env, c.origin, settings, saved).catch((err) => console.error('Work request email failed:', err)));
  return { request_no: requestNo, days: dates.length };
}

function details(r, extra = []) {
  return infoTable([
    ['Request', r.request_no], ['Employee', `${r.emp_name} (${r.emp_no})`], ['Department', r.department || '-'],
    ['Work type', typeText(r)], ['Date(s)', workWhen(r)], ['Days', String(r.days)], r.reason ? ['Reason', r.reason] : null, ...extra,
  ]);
}

async function notifyNewWork(env, origin, settings, r) {
  const baseUrl = settings.app_url || origin;
  const notSelf = (a) => lower(a.email) !== lower(r.emp_email);
  let approvers = (await approversFor(env, r.department_id)).filter(notSelf);
  if (!approvers.length) approvers = await fallbackApprovers(env, notSelf);
  const when = workWhen(r);
  const log = [];
  log.push(`Heads: ${await notify(env, 'user', approvers.map((a) => a.id), {
    title: `New ${r.work_type} request`, body: `${r.emp_name} · ${typeText(r)} · ${when}`, url: '/#/work',
  }, baseUrl)}`);
  for (const ap of approvers.filter((a) => isEmail(a.email) && emailEnabled(env))) {
    const link = (a) => `${baseUrl}/api/email/work-decide?n=${encodeURIComponent(r.request_no)}&t=${r.token}&a=${a}&w=${encodeURIComponent(ap.email)}`;
    const others = approvers.filter((x) => x.email !== ap.email).map((x) => x.name);
    const inner = `<p>Dear ${esc(ap.name)}, a new <b>${esc(r.work_type)}</b> request (<b>${esc(r.request_no)}</b>) for <b>${esc(r.department || '-')}</b> needs your decision.
      This is <b>not leave</b> - no leave balance is used.</p>
      ${others.length ? `<p style="font-size:12px;color:#666">Also sent to: ${esc(others.join(', '))}. The first decision counts.</p>` : ''}
      ${details(r)}
      <p style="margin:18px 0">${button(link('approve'), 'Approve', '#1e7e34')}${button(link('reject'), 'Reject', '#c62828')}</p>
      <p style="font-size:12px;color:#666">Or decide in the app: <a href="${esc(baseUrl)}/#/work">${esc(baseUrl)}</a></p>`;
    log.push(`Approver email ${await sendEmail(env, settings, {
      to: ap.email, subject: `[${r.work_type} request] ${r.emp_name} - ${when}`, html: layout(settings, inner), replyTo: r.emp_email,
    })}`);
  }
  if (!approvers.length) log.push('No approver: the department has no head and there is no admin.');
  if (isEmail(r.emp_email) && emailEnabled(env)) {
    const inner = `<p>Hi ${esc(r.emp_name)}, your <b>${esc(r.work_type)}</b> request <b>${esc(r.request_no)}</b> was received${approvers.length ? ` and sent to ${esc(approvers.map((a) => a.name).join(' / '))}` : ''}.</p>
      ${details(r)}<p>You will get another email when it is approved or not approved.</p>`;
    log.push(`Employee email ${await sendEmail(env, settings, { to: r.emp_email, subject: `${r.work_type} request received - ${r.request_no}`, html: layout(settings, inner) })}`);
  }
  await appendNotes(env, r.id, log.join(' | '));
}

// ---------------------------------------------------------------- decisions
// actor = { me, name } (signed in), { system: true, name } (email buttons) or { employee, name } (withdraw in the app)
function blockReason(actor, row, status) {
  if (row.status === status) return `Already ${status}.`;
  if (actor.system) return row.status === 'Pending' && (status === 'Approved' || status === 'Rejected') ? '' : 'Already decided.';
  if (actor.employee) return row.employee_id === actor.employee.id && row.status === 'Pending' && status === 'Cancelled' ? '' : 'Only pending requests can be withdrawn.';
  const me = actor.me;
  const own = me.employee && row.employee_id === me.employee.id;
  if (own && !me.isSuper) return 'You cannot decide your own request.';
  if (!me.isSuper && !inScope(me, row.department_id)) return 'Not in your department(s).';
  const manage = can(me, 'requests.manage');
  if (row.status === 'Pending' && (status === 'Approved' || status === 'Rejected')) return manage || can(me, 'approve.decide') ? '' : 'You cannot approve or reject requests.';
  if (row.status === 'Approved' && status === 'Cancelled') return manage || can(me, 'requests.cancel') ? '' : 'You cannot cancel approved requests.';
  return manage ? '' : `Changing ${row.status} to ${status} is not allowed.`;
}

async function decideWork(c, actor, ids, status, remark) {
  const { env } = c;
  if (!STATUSES.includes(status) || status === 'Pending') fail(400, 'Unknown status.');
  ids = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => n > 0))].slice(0, 500);
  if (!ids.length) fail(400, 'Choose at least one request.');
  const newRemark = remark === undefined || remark === null ? null : clean(remark).slice(0, 500);
  const rows = await all(env, `SELECT * FROM work_requests WHERE id IN (${marks(ids)})`, ...ids);
  const now = nowIso();
  const skipped = [];
  const done = [];
  const statements = [];
  for (const row of rows) {
    const why = blockReason(actor, row, status);
    if (why) { skipped.push({ request_no: row.request_no, reason: why }); continue; }
    const withdrawn = !!actor.employee;
    const note = withdrawn ? 'Withdrawn by the employee' : row.status === 'Approved' ? `Was Approved by ${row.decided_by || '-'}` : '';
    statements.push(stmt(env, `UPDATE work_requests SET status = ?, remark = ?, decided_by = ?, decided_at = ?,
        notes = CASE WHEN ? = '' THEN notes WHEN notes = '' THEN ? ELSE notes || ' | ' || ? END WHERE id = ? AND status = ?`,
    status, newRemark ?? row.remark, actor.name, now, note, note, note, row.id, row.status));
    done.push({ ...row, old: row.status, withdrawn, status, remark: newRemark ?? row.remark, decided_by: actor.name, decided_at: now });
  }
  await batch(env, statements);
  const tell = done.filter((r) => !r.withdrawn);
  if (tell.length) {
    c.waitUntil((async () => {
      const settings = await getSettings(env);
      for (const r of tell) await notifyWorkDecision(env, settings, r).catch((err) => console.error('Work decision email failed:', err));
    })());
  }
  return { updated: done.length, skipped };
}

async function notifyWorkDecision(env, settings, r) {
  const word = { Approved: 'APPROVED', Rejected: 'NOT APPROVED', Cancelled: 'CANCELLED' }[r.status];
  const color = { Approved: '#006100', Rejected: '#9c0006', Cancelled: '#595959' }[r.status];
  const log = [];
  if (r.employee_id) {
    log.push(`Employee: ${await notify(env, 'employee', [r.employee_id], {
      title: `${r.work_type} ${word === 'NOT APPROVED' ? 'not approved' : r.status.toLowerCase()}`, body: workWhen(r), url: '/request/',
    }, settings.app_url)}`);
  }
  if (emailEnabled(env) && isEmail(r.emp_email)) {
    const inner = `<p>Dear ${esc(r.emp_name)},</p>
      <p style="font-size:16px">Your <b>${esc(r.work_type)}</b> request has been <b style="color:${color}">${word}</b>.</p>
      ${details(r, [r.remark ? ['Remark', r.remark] : null, [`${r.status === 'Rejected' ? 'Not approved' : r.status} by`, r.decided_by], ['Date', nowText(settings)]])}`;
    log.push(`${r.status} email ${await sendEmail(env, settings, { to: r.emp_email, subject: `Your ${r.work_type} request ${r.request_no} was ${word}`, html: layout(settings, inner) })}`);
  }
  await appendNotes(env, r.id, log.join(' | '));
}

// ---------------------------------------------------------------- admin / head app
const canSee = (me) => can(me, 'requests.view') || can(me, 'approve.decide') || can(me, 'requests.manage');

async function listWork(c) {
  const { env, me, query } = c;
  if (!canSee(me)) fail(403, 'You do not have access to this page.');
  const s = scopeSql(me);
  const where = [s.sql];
  const args = [...s.args];
  const status = clean(query.get('status'));
  if (STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  const type = WORK_TYPES.find((t) => t === clean(query.get('type')));
  if (type) { where.push('work_type = ?'); args.push(type); }
  const dept = Number(query.get('department_id'));
  if (dept) { where.push('department_id = ?'); args.push(dept); }
  const month = clean(query.get('month'));
  if (/^\d{4}-\d{2}$/.test(month)) { where.push('from_date <= ? AND to_date >= ?'); args.push(`${month}-31`, `${month}-01`); }
  const rows = await all(env, `SELECT ${COLUMNS} FROM work_requests WHERE ${where.join(' AND ')} ORDER BY from_date DESC, id DESC LIMIT 1000`, ...args);
  return { rows, canDecide: can(me, 'approve.decide') || can(me, 'requests.manage'), canCancel: can(me, 'requests.cancel') || can(me, 'requests.manage') };
}

async function decideWorkRoute(c) {
  const b = await readJson(c.request);
  return decideWork(c, { me: c.me, name: c.me.name }, b.ids, clean(b.status), b.remark);
}

// Used by the dashboard, the nav badge and the calendar
export async function workPendingCount(env, me) {
  if (!(can(me, 'approve.decide') || can(me, 'requests.manage'))) return 0;
  const s = scopeSql(me);
  const row = await first(env, `SELECT COUNT(*) AS n FROM work_requests WHERE status = 'Pending' AND ${s.sql} AND (employee_id IS NULL OR employee_id <> ?)`,
    ...s.args, me.employee ? me.employee.id : 0);
  return row.n;
}

export async function workOnDay(env, me, date) {
  const s = scopeSql(me);
  const rows = await all(env, `SELECT emp_name, department, work_type, location, dates FROM work_requests
    WHERE status = 'Approved' AND from_date <= ? AND to_date >= ? AND ${s.sql} ORDER BY emp_name`, date, date, ...s.args);
  return rows.filter((r) => r.dates.split(',').includes(date)).map(({ dates, ...r }) => r);
}

export async function workInMonth(env, me, start, end, dept) {
  const s = scopeSql(me);
  const where = [`status IN ('Approved', 'Pending')`, 'from_date <= ?', 'to_date >= ?', s.sql];
  const args = [end, start, ...s.args];
  if (dept) { where.push('department_id = ?'); args.push(dept); }
  return all(env, `SELECT id, request_no, emp_name, department, work_type, location, mode, from_date, to_date, dates, status FROM work_requests WHERE ${where.join(' AND ')} ORDER BY emp_name`, ...args);
}

// ---------------------------------------------------------------- email Approve / Reject buttons
async function emailWorkDecide(c) {
  const { env, query } = c;
  const settings = await getSettings(env);
  const no = clean(query.get('n'));
  const token = clean(query.get('t'));
  const action = query.get('a') === 'reject' ? 'reject' : 'approve';
  const r = no && token ? await first(env, 'SELECT * FROM work_requests WHERE request_no = ? AND token = ?', no, token) : null;
  if (!r) return html(page(settings, 'Link not valid', '<p>This link is not valid any more. Please open the Leave System app.</p>'), 404);
  if (r.status !== 'Pending') {
    return html(page(settings, `Already ${r.status.toLowerCase()}`, `${details(r)}<p>This request was already <b>${esc(r.status)}</b>${r.decided_by ? ` by ${esc(r.decided_by)}` : ''}. Nothing was changed.</p>`));
  }
  if (c.request.method === 'GET') {
    return html(page(settings, `${action === 'approve' ? 'Approve' : 'Reject'} this ${r.work_type} request?`, `${details(r)}
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
  const approver = (await approversFor(env, r.department_id)).find((a) => lower(a.email) === lower(query.get('w')));
  const result = await decideWork(c, { system: true, name: `${approver ? approver.name : 'Email approver'} (email)` }, [r.id], status, form.get('remark'));
  if (!result.updated) return html(page(settings, 'Nothing changed', `${details(r)}<p>${esc(result.skipped.map((s) => s.reason).join(' '))}</p>`));
  return html(page(settings, status === 'Approved' ? 'Request approved' : 'Request rejected',
    `${details(r)}<p>Done. The request is now <b>${status}</b>. ${esc(r.emp_name)} gets an email automatically.</p>`));
}

// ---------------------------------------------------------------- employee app (/request)
async function portalSubmit(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  const requestId = clean(b.request_id);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) fail(400, 'Please reload the page and try again.');
  const responseId = `portal-work-${requestId}`;
  const done = await first(c.env, 'SELECT request_no FROM work_requests WHERE form_response_id = ?', responseId);
  if (done) return { ok: true, group_no: done.request_no };           // double tap: already saved
  const res = await createWorkRequest(c, e, {
    work_type: b.work_type, location: b.location, mode: b.mode, date: b.date, from: b.from, to: b.to, dates: b.dates,
    reason: b.reason, form_response_id: responseId,
  });
  return { ok: true, group_no: res.request_no, days: res.days };
}

async function portalWithdraw(c) {
  const e = await portalEmployee(c);
  const b = await readJson(c.request);
  const row = await first(c.env, 'SELECT id FROM work_requests WHERE id = ? AND employee_id = ?', Number(b.id), e.id);
  if (!row) fail(404, 'Request not found.');
  const res = await decideWork(c, { employee: e, name: e.name }, [row.id], 'Cancelled', null);
  if (!res.updated) throw new HttpError(400, res.skipped.map((s) => s.reason).join(' ') || 'Could not withdraw.');
  return { ok: true };
}

export const portalWorkRows = (env, employeeId) => all(env,
  `SELECT ${COLUMNS} FROM work_requests WHERE employee_id = ? ORDER BY from_date DESC, id DESC LIMIT 300`, employeeId);

export default [
  { method: 'GET', path: '/api/work', handler: listWork },
  { method: 'POST', path: '/api/work/decide', handler: decideWorkRoute },
  { method: 'GET', path: '/api/email/work-decide', auth: false, handler: emailWorkDecide },
  { method: 'POST', path: '/api/email/work-decide', auth: false, handler: emailWorkDecide },
  { method: 'POST', path: '/api/portal/work', auth: false, handler: portalSubmit },
  { method: 'POST', path: '/api/portal/work/withdraw', auth: false, handler: portalWithdraw },
];
