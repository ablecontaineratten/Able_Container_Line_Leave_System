// Reports: approved leave in a period, per employee and leave type. Print (Save as PDF) or CSV.
import { get, qs } from '../api.js';
import { $, addDays, downloadCsv, esc, fmtDate, pageHead, tableHtml } from '../ui.js';

function periodRange(kind, today) {
  const y = today.slice(0, 4);
  const m = today.slice(0, 7);
  if (kind === 'month') return [`${m}-01`, addDays(`${addDays(`${m}-01`, 31).slice(0, 7)}-01`, -1)];
  if (kind === 'last-month') {
    const start = `${addDays(`${m}-01`, -1).slice(0, 7)}-01`;
    return [start, addDays(`${m}-01`, -1)];
  }
  if (kind === 'year') return [`${y}-01-01`, `${y}-12-31`];
  return null;
}

export default async function render(view, ctx) {
  const { departments, me, today, settings } = ctx.state;
  const q = ctx.query;
  const from = q.get('from') || `${today.slice(0, 7)}-01`;
  const to = q.get('to') || today;
  const dept = q.get('department_id') || '';
  const data = await get(`/reports${qs({ from, to, department_id: dept })}`);
  if (!ctx.isCurrent()) return;

  const isShort = (t) => data.shortTypes.includes(t.toLowerCase());
  const columns = [
    { label: 'Employee No', render: (p) => esc(p.emp_no) },
    { label: 'Name', render: (p) => `<b>${esc(p.name)}</b>` },
    { label: 'Department', render: (p) => esc(p.department || '-') },
    ...data.types.map((t) => ({ label: isShort(t) ? `${t} (times)` : t, cls: 'num', render: (p) => esc(p.byType[t] || '') })),
    { label: 'Total days', cls: 'num', render: (p) => `<b>${esc(p.total)}</b>` },
  ];
  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));
  const deptName = dept ? (departments.find((d) => String(d.id) === dept) || {}).name : 'All departments';
  const grand = data.people.reduce((n, p) => n + p.total, 0);

  view.innerHTML = `${pageHead('Leave report', '', '<button class="btn" id="print">Print / Save PDF</button> <button class="btn" id="export">Export CSV</button>')}
    <form class="filters card no-print" id="filters">
      <select name="period" aria-label="Period"><option value="">Custom dates</option><option value="month">This month</option>
        <option value="last-month">Last month</option><option value="year">This year</option></select>
      <label class="inline">From <input type="date" name="from" value="${from}"></label>
      <label class="inline">To <input type="date" name="to" value="${to}"></label>
      ${deptOptions.length > 1 ? `<select name="department_id" aria-label="Department"><option value="">All departments</option>${deptOptions.map((d) =>
        `<option value="${d.id}" ${String(d.id) === dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
    </form>
    <section class="card report">
      <div class="print-only"><h2>${esc(settings.company_name)} - Leave report</h2></div>
      <p><b>${esc(fmtDate(data.from))} – ${esc(fmtDate(data.to))}</b> · ${esc(deptName)} · Approved leave only ·
        ${data.people.length} employee(s) · ${grand} day(s)</p>
      ${tableHtml(columns, data.people, { empty: 'No approved leave in this period.' })}
      ${data.people.length ? `<p class="muted small">Totals: ${data.types.filter((t) => data.totals[t]).map((t) => `${esc(t)} ${data.totals[t]}`).join(' · ')}</p>` : ''}
    </section>`;

  const form = $('#filters');
  form.addEventListener('change', (e) => {
    if (e.target.name === 'period') {
      const r = periodRange(e.target.value, today);
      if (r) { form.from.value = r[0]; form.to.value = r[1]; }
    }
    ctx.go(`reports${qs({ from: form.from.value, to: form.to.value, department_id: form.department_id ? form.department_id.value : '' })}`);
  });
  $('#print').addEventListener('click', () => window.print());
  $('#export').addEventListener('click', () => downloadCsv(`leave-report-${data.from}-to-${data.to}.csv`,
    ['Request', 'Employee No', 'Employee', 'Department', 'Leave type', 'From', 'To', 'Day type', 'Days', 'Hours', 'Reason', 'Decided by'],
    data.rows.map((r) => [r.request_no, r.emp_no, r.emp_name, r.department, r.leave_type, r.from_date, r.to_date, r.day_type, r.days, r.hours ?? '', r.reason, r.decided_by])));
}
