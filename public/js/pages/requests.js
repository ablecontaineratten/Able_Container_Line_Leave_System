// All requests: filters, details, actions, CSV export
import { get, qs } from '../api.js';
import { $, daysText, debounce, downloadCsv, esc, pageHead, tableHtml, wireSelection } from '../ui.js';
import { allowedActions, requestColumns, runAction, wireOpen } from '../components/requests.js';

let refocusSearch = false;     // keep typing in the search box after the page re-renders

export default async function render(view, ctx) {
  const { departments, types, me } = ctx.state;
  const q = ctx.query;
  const filters = {
    status: q.get('status') || '', department_id: q.get('department_id') || '', leave_type: q.get('leave_type') || '',
    from: q.get('from') || '', to: q.get('to') || '', q: q.get('q') || '',
  };

  view.innerHTML = `${pageHead('All requests', '', '<button class="btn" id="export">Export CSV</button>')}
    <form class="filters card" id="filters">
      <input type="search" name="q" placeholder="Search name, number, request…" value="${esc(filters.q)}" aria-label="Search">
      <select name="status" aria-label="Status"><option value="">All statuses</option>${['Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) =>
        `<option ${s === filters.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${me.scopeAll || me.deptIds.length > 1 ? `<select name="department_id" aria-label="Department"><option value="">All departments</option>${departments
        .filter((d) => me.scopeAll || me.deptIds.includes(d.id)).map((d) => `<option value="${d.id}" ${String(d.id) === filters.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      <select name="leave_type" aria-label="Leave type"><option value="">All leave types</option>${types.map((t) =>
        `<option ${t.name === filters.leave_type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <label class="inline">From <input type="date" name="from" value="${filters.from}"></label>
      <label class="inline">To <input type="date" name="to" value="${filters.to}"></label>
    </form>
    <div class="bulk" id="bulk" hidden><span id="bulk-count"></span><span id="bulk-actions"></span></div>
    <section class="card" id="list"><div class="loading">Loading…</div></section>`;

  const form = $('#filters');
  const apply = () => {
    const v = Object.fromEntries(new FormData(form));
    ctx.go(`requests${qs(v)}`);
  };
  form.addEventListener('change', apply);
  form.q.addEventListener('input', debounce(() => { refocusSearch = true; apply(); }, 500));
  if (refocusSearch) {
    refocusSearch = false;
    form.q.focus();
    form.q.setSelectionRange(form.q.value.length, form.q.value.length);
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });

  const data = await get(`/requests${qs({ view: 'all', ...filters })}`);
  if (!ctx.isCurrent()) return;
  const rows = data.rows;
  const listEl = $('#list');
  listEl.innerHTML = `<p class="muted small">${rows.length} request${rows.length === 1 ? '' : 's'}${rows.length >= 500 ? ' (first 500 - use the filters)' : ''}</p>
    ${tableHtml(requestColumns(), rows, { empty: 'No requests match the filters.', selectable: true })}`;
  wireOpen(listEl, rows, ctx, () => render(view, ctx));

  const LABELS = { approve: 'Approve', reject: 'Reject', cancel: 'Cancel leave', delete: 'Delete' };
  const selected = wireSelection(listEl, (idx) => {
    const chosen = idx.map((i) => rows[i]);
    const common = ['approve', 'reject', 'cancel', 'delete'].filter((a) => chosen.length && chosen.every((r) => allowedActions(r, me).includes(a)));
    $('#bulk').hidden = !chosen.length;
    $('#bulk-count').textContent = `${chosen.length} selected`;
    $('#bulk-actions').innerHTML = common.map((a) => `<button class="btn btn-small ${a === 'approve' ? 'btn-success' : 'btn-danger'}" data-bulk="${a}">${LABELS[a]}</button>`).join(' ')
      || '<span class="muted small">No action fits every selected request.</span>';
    $('#bulk-actions').querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', async () => {
      if (await runAction(b.dataset.bulk, selected().map((i) => rows[i]), ctx)) render(view, ctx);
    }));
  });

  $('#export').addEventListener('click', () => downloadCsv(`leave-requests-${ctx.state.today}.csv`,
    ['Request', 'Employee No', 'Employee', 'Department', 'Leave type', 'From', 'To', 'Day type', 'Out', 'Return', 'Days / hours', 'Reason', 'Status', 'Remark', 'Decided by', 'Decided at', 'Submitted at'],
    rows.map((r) => [r.request_no, r.emp_no, r.emp_name, r.department, r.leave_type, r.from_date, r.to_date, r.day_type, r.out_time, r.return_time,
      daysText(r), r.reason, r.status, r.remark, r.decided_by, r.decided_at || '', r.submitted_at])));
}
