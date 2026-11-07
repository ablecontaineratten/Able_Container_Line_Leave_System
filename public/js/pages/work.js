// Work From Home / Onsite requests (not leave): filter, approve / reject / cancel, export
import { get, qs } from '../api.js';
import { $, downloadCsv, esc, fmtDateTime, pageHead, statusBadge, tableHtml, wireSelection } from '../ui.js';
import { decideWork, workTag, workWhen } from '../components/work.js';

const STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'];

export default async function render(view, ctx) {
  const { me, departments, settings } = ctx.state;
  const q = ctx.query;
  const canDecideAny = !!(me.perms['approve.decide'] || me.perms['requests.manage']);
  // heads open this page to decide: Pending first; others see everything
  const status = q.has('status') ? q.get('status') : (canDecideAny ? 'Pending' : '');
  const filters = { status, type: q.get('type') || '', department_id: q.get('department_id') || '', month: q.get('month') || '' };
  const data = await get(`/work${qs(filters)}`);
  if (!ctx.isCurrent()) return;
  const rows = status === 'Pending' ? data.rows.sort((a, b) => (a.from_date < b.from_date ? -1 : 1)) : data.rows;

  const own = (r) => me.employee && r.employee_id === me.employee.id && !me.isSuper;
  const acts = (r) => (own(r) ? []
    : r.status === 'Pending' && data.canDecide ? ['approve', 'reject']
      : r.status === 'Approved' && data.canCancel ? ['cancel'] : []);
  const BTN = { approve: 'btn-success', reject: 'btn-danger', cancel: 'btn-danger-outline' };
  const columns = [
    { label: 'Request', render: (r) => `<b>${esc(r.request_no)}</b><div class="muted small">${esc(fmtDateTime(r.submitted_at, settings.timezone))}</div>` },
    { label: 'Employee', render: (r) => `<b>${esc(r.emp_name)}</b><div class="muted small">${esc(r.emp_no)} · ${esc(r.department || '-')}</div>` },
    { label: 'Work type', render: (r) => `${workTag(r)}${r.location ? `<div class="muted small">${esc(r.location)}</div>` : ''}` },
    { label: 'Date(s)', render: (r) => `${esc(workWhen(r))}<div class="muted small">${r.days} day${r.days === 1 ? '' : 's'}</div>` },
    { label: 'Reason', render: (r) => `<span class="small">${esc(r.reason)}</span>` },
    { label: 'Status', render: (r) => `${statusBadge(r.status)}${r.decided_by ? `<div class="muted small">${esc(r.decided_by)}</div>` : ''}${r.remark ? `<div class="muted small">“${esc(r.remark)}”</div>` : ''}` },
    { label: '', cls: 'actions', render: (r) => acts(r).map((a) => `<button class="btn btn-small ${BTN[a]}" data-act="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join(' ') },
  ];
  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));
  const sel = (id, label, options, value) => `<label class="field"><span>${label}</span><select id="${id}">${options.map(([v, t]) =>
    `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
  const selectable = data.canDecide && rows.some((r) => acts(r).includes('approve'));

  view.innerHTML = `${pageHead('WFH Request', 'Requests to work from home. <b>Not leave</b> - no leave balance is used. No request = working at the office.',
    '<button class="btn" id="export">Export CSV</button>')}
    <div class="filters card work-filters">
      ${sel('f-status', 'Status', [['', 'All'], ...STATUSES.map((s) => [s, s])], filters.status)}
      ${deptOptions.length > 1 ? sel('f-dept', 'Department', [['', 'All departments'], ...deptOptions.map((d) => [d.id, d.name])], filters.department_id) : ''}
      <label class="field"><span>Month</span><input type="month" id="f-month" value="${esc(filters.month)}"></label>
    </div>
    <div class="bulk" id="bulk" hidden><span id="bulk-count"></span>
      <button class="btn btn-small btn-success" data-bulk="approve">Approve selected</button>
      <button class="btn btn-small btn-danger" data-bulk="reject">Reject selected</button></div>
    <section class="card" id="list">${tableHtml(columns, rows, { empty: status === 'Pending' ? 'Nothing is waiting. 🎉' : 'No requests.', selectable })}</section>`;

  const refresh = () => { ctx.refreshBadge(); render(view, ctx); };
  // status is always in the link, so "All" (empty) is kept and does not fall back to Pending
  const go = () => {
    const rest = qs({ department_id: $('#f-dept') ? $('#f-dept').value : '', month: $('#f-month').value });
    ctx.go(`work?status=${encodeURIComponent($('#f-status').value)}${rest ? `&${rest.slice(1)}` : ''}`);
  };
  ['#f-status', '#f-dept', '#f-month'].forEach((s) => { const el = $(s); if (el) el.addEventListener('change', go); });

  const listEl = $('#list');
  listEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    if (await decideWork(b.dataset.act, [rows[Number(b.closest('tr').dataset.index)]], ctx)) refresh();
  }));
  if (selectable) {
    const selected = wireSelection(listEl, (idx) => { $('#bulk').hidden = !idx.length; $('#bulk-count').textContent = `${idx.length} selected`; });
    view.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', async () => {
      const chosen = selected().map((i) => rows[i]).filter((r) => acts(r).includes(b.dataset.bulk));
      if (chosen.length && await decideWork(b.dataset.bulk, chosen, ctx)) refresh();
    }));
  }
  $('#export').addEventListener('click', () => downloadCsv('wfh-requests.csv',
    ['request_no', 'emp_no', 'name', 'department', 'work_type', 'location', 'dates', 'days', 'reason', 'status', 'decided_by', 'remark', 'submitted_at'],
    rows.map((r) => [r.request_no, r.emp_no, r.emp_name, r.department, r.work_type, r.location, r.dates.split(',').join(' '), r.days, r.reason, r.status, r.decided_by, r.remark, r.submitted_at])));
}
