// Late reasons: every "Late arrival" message employees sent from the app (inform only - nothing to approve).
// Filters: search, department, from / to date. Shows the first 10; "Show all" opens the rest.
import { get, qs } from '../api.js';
import { $, downloadCsv, esc, fmtDate, fmtDateTime, pageHead, tableHtml } from '../ui.js';

const FIRST = 10;

export default async function render(view, ctx) {
  const { me, departments, settings } = ctx.state;
  const q = ctx.query;
  const filters = { q: q.get('q') || '', department_id: q.get('department_id') || '', from: q.get('from') || '', to: q.get('to') || '' };
  const all = q.get('all') === '1';
  const data = await get(`/late${qs(filters)}`);
  if (!ctx.isCurrent()) return;
  const rows = data.rows;
  const shown = all ? rows : rows.slice(0, FIRST);
  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));
  const columns = [
    { label: 'Date', render: (r) => `<b>${esc(fmtDate(r.date))}</b><div class="muted small">${esc(fmtDateTime(r.created_at, settings.timezone).split(', ').pop())}</div>` },
    { label: 'Employee', render: (r) => `<b>${esc(r.emp_name)}</b><div class="muted small">${esc(r.emp_no)}</div>` },
    { label: 'Department', render: (r) => esc(r.department || '-') },
    { label: 'Message', render: (r) => `<span class="late-msg">${esc(r.message)}</span>` },
  ];

  view.innerHTML = `${pageHead('Late reasons', 'Late arrival messages from employees. Inform only - nothing to approve.', '<button class="btn" id="export">Export CSV</button>')}
    <form class="filters card late-filters" id="late-filters">
      <input type="search" name="q" placeholder="Search name, number or message…" value="${esc(filters.q)}" aria-label="Search">
      ${deptOptions.length > 1 ? `<select name="department_id" aria-label="Department"><option value="">All departments</option>${deptOptions.map((d) =>
        `<option value="${d.id}" ${String(d.id) === filters.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      <label class="late-date">From <input type="date" name="from" value="${esc(filters.from)}"></label>
      <label class="late-date">To <input type="date" name="to" value="${esc(filters.to)}"></label>
      <button class="btn btn-primary btn-small" type="submit">Filter</button>
      ${filters.q || filters.department_id || filters.from || filters.to ? '<a class="btn btn-small" href="#/late">Clear</a>' : ''}
    </form>
    <section class="card">
      <p class="muted small">${rows.length} message${rows.length === 1 ? '' : 's'}${rows.length > FIRST && !all ? ` · showing the latest ${FIRST}` : ''}</p>
      ${tableHtml(columns, shown, { empty: 'No late arrival messages.' })}
      ${rows.length > FIRST ? `<div class="late-more"><button class="btn" id="toggle-all" type="button">${all ? 'Show latest 10 only' : `Show all (${rows.length})`}</button></div>` : ''}
    </section>`;

  const go = (extra = {}) => {
    const f = new FormData($('#late-filters', view));
    ctx.go(`late${qs({ q: (f.get('q') || '').trim(), department_id: f.get('department_id') || '', from: f.get('from') || '', to: f.get('to') || '', ...extra })}`);
  };
  $('#late-filters', view).addEventListener('submit', (e) => { e.preventDefault(); go(); });
  const toggle = $('#toggle-all', view);
  if (toggle) toggle.addEventListener('click', () => go(all ? {} : { all: '1' }));
  $('#export', view).addEventListener('click', () => downloadCsv(`late-reasons-${ctx.state.today}.csv`,
    ['date', 'emp_no', 'name', 'department', 'message', 'informed_at'],
    rows.map((r) => [r.date, r.emp_no, r.emp_name, r.department, r.message, r.created_at])));
}
