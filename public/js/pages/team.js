// Leave Summary: approved leave TAKEN per employee - Annual, Casual, Short and Total.
// The header numbers (/14-Year, /7-Year, /2-Month, /21-Year) come from Settings → Leave types.
import { get, qs } from '../api.js';
import { downloadCsv, esc, pageHead, tableHtml } from '../ui.js';

const shortName = (name) => String(name).replace(/\s+leave$/i, '');

export default async function render(view, ctx) {
  const { departments, me } = ctx.state;
  const dept = ctx.query.get('department_id') || '';
  const data = await get(`/team${qs({ department_id: dept })}`);
  if (!ctx.isCurrent()) return;
  const { annual, casual, short, pool } = data.columns;

  // approved days taken this leave year for one leave type
  const taken = (e, col) => {
    if (!col) return 0;
    const t = e.summary.types.find((x) => x.type === col.name);
    return t ? t.used : 0;
  };
  const over = (v, limit) => limit !== null && limit !== undefined && v > limit;
  const num = (v, limit) => `<b class="${over(v, limit) ? 'neg' : ''}">${esc(v)}</b>`;
  const head = (col) => `${shortName(col.name)}${col.allowed !== null && col.allowed !== undefined ? ` (/${col.allowed}-Year)` : ''}`;

  // Half days are not shown here (still counted in Annual / Casual and kept in the database).
  const columns = [
    { label: 'Employee', render: (e) => `<b>${esc(e.name)}</b>` },
    annual ? { label: head(annual), cls: 'num', value: (e) => taken(e, annual), render: (e) => num(taken(e, annual), annual.allowed) } : null,
    casual ? { label: head(casual), cls: 'num', value: (e) => taken(e, casual), render: (e) => num(taken(e, casual), casual.allowed) } : null,
    { label: `${shortName(short.name)}${short.limit ? ` (/${short.limit}-Month)` : ''}`, cls: 'num', value: (e) => e.shortUsed, render: (e) => num(e.shortUsed, short.limit || null) },
    { label: `Total (/${pool}-Year)`, cls: 'num', value: (e) => e.summary.used, render: (e) => num(e.summary.used, pool) },
  ].filter(Boolean);
  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));

  view.innerHTML = `${pageHead('Leave Summary', '', '<button class="btn" id="export">Export CSV</button>')}
    ${deptOptions.length > 1 ? `<div class="filters card"><select id="dept" aria-label="Department"><option value="">All departments</option>${deptOptions.map((d) =>
      `<option value="${d.id}" ${String(d.id) === dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>` : ''}
    <section class="card">${tableHtml(columns, data.employees, { empty: 'No employees.' })}</section>`;

  const sel = view.querySelector('#dept');
  if (sel) sel.addEventListener('change', () => ctx.go(`team${qs({ department_id: sel.value })}`));
  view.querySelector('#export').addEventListener('click', () => downloadCsv(`leave-summary-${ctx.state.today}.csv`,
    columns.map((c) => c.label),
    data.employees.map((e) => [e.name, ...columns.slice(1).map((c) => c.value(e))])));
}
