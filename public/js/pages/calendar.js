// Leave calendar: who is on leave each day of the month
import { get, qs } from '../api.js';
import { addDays, esc, fmtDate, monthLabel, pageHead, toUtc } from '../ui.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function shiftMonth(ym, n) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function render(view, ctx) {
  const { departments, me, settings, today } = ctx.state;
  const month = /^\d{4}-\d{2}$/.test(ctx.query.get('month') || '') ? ctx.query.get('month') : today.slice(0, 7);
  const dept = ctx.query.get('department_id') || '';
  const data = await get(`/calendar${qs({ month, department_id: dept })}`);
  if (!ctx.isCurrent()) return;

  const weekend = new Set(String(settings.weekend || '').split(',').filter((x) => x !== '').map(Number));
  const holidays = new Map(data.holidays.map((h) => [h.date, h.name]));
  const onDay = (d) => data.rows.filter((r) => r.from_date <= d && r.to_date >= d);
  const chip = (r) => `<span class="chip chip-${r.status.toLowerCase()}" title="${esc(`${r.emp_name} · ${r.leave_type} · ${r.day_type} · ${r.status}`)}">${esc(r.emp_name)}${r.day_type === 'Half Day' ? ' ½' : r.day_type === 'Short Leave' ? ' ⏱' : ''}</span>`;

  // grid starts on Monday
  const first = data.start;
  const lead = (toUtc(first).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell empty"></div>');
  const agenda = [];
  for (let d = first; d <= data.end; d = addDays(d, 1)) {
    const dow = toUtc(d).getUTCDay();
    const list = onDay(d);
    const off = weekend.has(dow) || holidays.has(d);
    cells.push(`<div class="cal-cell ${off ? 'off' : ''} ${d === today ? 'today' : ''}">
      <div class="cal-date">${Number(d.slice(8))}${holidays.has(d) ? `<span class="hol">${esc(holidays.get(d))}</span>` : ''}</div>
      ${list.map(chip).join('')}</div>`);
    if (list.length || holidays.has(d)) {
      agenda.push(`<li><b>${esc(fmtDate(d))}</b>${holidays.has(d) ? ` <span class="muted">· ${esc(holidays.get(d))}</span>` : ''}<div>${list.map(chip).join(' ')}</div></li>`);
    }
  }

  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));
  view.innerHTML = `${pageHead('Leave Calendar')}
    <div class="card">
      <div class="cal-toolbar">
        <a class="btn btn-small" href="#/calendar${qs({ month: shiftMonth(month, -1), department_id: dept })}" aria-label="Previous month">‹</a>
        <h2>${esc(monthLabel(month))}</h2>
        <a class="btn btn-small" href="#/calendar${qs({ month: shiftMonth(month, 1), department_id: dept })}" aria-label="Next month">›</a>
        <a class="btn btn-small" href="#/calendar${qs({ department_id: dept })}">Today</a>
        <div class="spacer"></div>
        ${deptOptions.length > 1 ? `<select id="dept" aria-label="Department"><option value="">All departments</option>${deptOptions.map((d) =>
          `<option value="${d.id}" ${String(d.id) === dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="cal-grid">${DAY_NAMES.map((n) => `<div class="cal-head">${n}</div>`).join('')}${cells.join('')}</div>
      <ul class="cal-agenda">${agenda.join('') || '<li class="muted">No leave this month.</li>'}</ul>
    </div>`;
  const sel = view.querySelector('#dept');
  if (sel) sel.addEventListener('change', () => ctx.go(`calendar${qs({ month, department_id: sel.value })}`));
}
