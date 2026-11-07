// WFH Request: Work From Home requests waiting for a decision - approve / reject (also in bulk), export
import { get, qs } from '../api.js';
import { $, downloadCsv, esc, fmtDateTime, pageHead, statusBadge, tableHtml, wireSelection } from '../ui.js';
import { decideWork, workWhen } from '../components/work.js';


export default async function render(view, ctx) {
  const { me, settings } = ctx.state;
  // this page = the WFH requests waiting for a decision (oldest date first)
  const data = await get(`/work${qs({ status: 'Pending' })}`);
  if (!ctx.isCurrent()) return;
  const rows = data.rows.sort((a, b) => (a.from_date < b.from_date ? -1 : 1));

  const own = (r) => me.employee && r.employee_id === me.employee.id && !me.isSuper;
  const acts = (r) => (own(r) ? []
    : r.status === 'Pending' && data.canDecide ? ['approve', 'reject']
      : r.status === 'Approved' && data.canCancel ? ['cancel'] : []);
  const BTN = { approve: 'btn-success', reject: 'btn-danger', cancel: 'btn-danger-outline' };
  const columns = [
    { label: 'Request', render: (r) => `<b>${esc(r.request_no)}</b><div class="muted small">${esc(fmtDateTime(r.submitted_at, settings.timezone))}</div>` },
    { label: 'Employee', render: (r) => `<b>${esc(r.emp_name)}</b><div class="muted small">${esc(r.emp_no)} · ${esc(r.department || '-')}</div>` },
    { label: 'Date(s)', render: (r) => `${esc(workWhen(r))}<div class="muted small">${r.days} day${r.days === 1 ? '' : 's'}</div>` },
    { label: 'Reason', render: (r) => `<span class="small">${esc(r.reason)}</span>` },
    { label: 'Status', render: (r) => statusBadge(r.status) },
    { label: '', cls: 'actions', render: (r) => acts(r).map((a) => `<button class="btn btn-small ${BTN[a]}" data-act="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join(' ') },
  ];
  const selectable = data.canDecide && rows.some((r) => acts(r).includes('approve'));

  view.innerHTML = `${pageHead('WFH Request', 'Work From Home requests waiting for a decision. <b>Not leave</b> - no leave balance is used.',
    '<button class="btn" id="export">Export CSV</button>')}
    <div class="bulk" id="bulk" hidden><span id="bulk-count"></span>
      <button class="btn btn-small btn-success" data-bulk="approve">Approve selected</button>
      <button class="btn btn-small btn-danger" data-bulk="reject">Reject selected</button></div>
    <section class="card" id="list">${tableHtml(columns, rows, { empty: 'Nothing is waiting. 🎉', selectable })}</section>`;

  const refresh = () => { ctx.refreshBadge(); render(view, ctx); };

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
