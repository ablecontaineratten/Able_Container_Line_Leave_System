// Leave calendar: who is on leave each day of the month
import { get, post, put, qs } from '../api.js';
import { addDays, confirmDialog, esc, fmtDate, monthLabel, pageHead, toast, toUtc } from '../ui.js';
import { DAYS, holidaysSection } from './settings.js';
import { workEmoji, workKey } from '../components/work.js';

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
  // Edit mode (Edit button): a ✕ on each date that can be deleted
  const editing = ctx.query.get('edit') === '1';
  const canEditWork = !!(me.perms['approve.decide'] || me.perms['requests.manage']);
  const canEditLeave = !!me.perms['summary.edit'];
  const x = (attrs) => (editing ? `<button type="button" class="chip-x" title="Delete this date" aria-label="Delete this date" ${attrs}>✕</button>` : '');
  const leaveChip = (r, d) => `<span class="chip chip-${r.status.toLowerCase()}" title="${esc(`${r.emp_name} · ${r.leave_type} · ${r.day_type} · ${r.status}`)}">${esc(r.emp_name)}${r.day_type === 'Half Day' ? ' ½' : r.day_type === 'Short Leave' ? ' ⏱' : ''}${
    canEditLeave && r.status === 'Approved' ? x(`data-kind="leave" data-emp="${r.employee_id}" data-date="${d}" data-type="${esc(r.day_type === 'Half Day' ? 'Half Day' : r.leave_type)}" data-half="${esc(r.leave_type)}" data-name="${esc(r.emp_name)}" data-what="${esc(r.leave_type)}"`) : ''}</span>`;
  // Work From Home: shown on the day, but it is not leave
  const work = (data.work || []).map((w) => ({ ...w, days: new Set(w.dates.split(',')), kind: 'work' }));
  const workChip = (w, d) => `<span class="chip chip-work ${workKey(w.work_type)} ${w.status === 'Pending' ? 'chip-pending' : ''}" title="${esc(`${w.emp_name} · ${w.work_type}${w.location ? ` (${w.location})` : ''} · ${w.status} · not leave`)}">${workEmoji(w.work_type)} ${esc(w.emp_name)}${
    canEditWork ? x(`data-kind="work" data-id="${w.id}" data-date="${d}" data-name="${esc(w.emp_name)}" data-what="WFH"`) : ''}</span>`;
  const chip = (r, d) => (r.kind === 'work' ? workChip(r, d) : leaveChip(r, d));
  const onDayAll = (d) => [...onDay(d), ...work.filter((w) => w.days.has(d))];

  // grid starts on Monday
  const first = data.start;
  const lead = (toUtc(first).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell empty"></div>');
  const agenda = [];
  for (let d = first; d <= data.end; d = addDays(d, 1)) {
    const dow = toUtc(d).getUTCDay();
    const list = onDayAll(d);
    const off = weekend.has(dow) || holidays.has(d);
    cells.push(`<div class="cal-cell ${off ? 'off' : ''} ${d === today ? 'today' : ''}">
      <div class="cal-date">${Number(d.slice(8))}${holidays.has(d) ? `<span class="hol">${esc(holidays.get(d))}</span>` : ''}</div>
      ${list.map((r) => chip(r, d)).join('')}</div>`);
    if (list.length || holidays.has(d)) {
      agenda.push(`<li><b>${esc(fmtDate(d))}</b>${holidays.has(d) ? ` <span class="muted">· ${esc(holidays.get(d))}</span>` : ''}<div>${list.map((r) => chip(r, d)).join(' ')}</div></li>`);
    }
  }

  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));
  // Weekend days (not counted as leave) - changed here by people who can edit settings
  const canEditSettings = !!me.perms['settings.edit'];
  const showHolidays = !!(me.perms['settings.view'] || canEditSettings);
  view.innerHTML = `${pageHead('Leave Calendar')}
    <form class="card weekend-card" id="weekend-form">
      <span class="weekend-title">Weekend days <small class="muted">(not counted as leave)</small></span>
      <div class="weekend-days">${DAYS.map((d, i) => `<label class="day-chip"><input type="checkbox" name="weekend" value="${i}" ${weekend.has(i) ? 'checked' : ''} ${canEditSettings ? '' : 'disabled'}><span>${d.slice(0, 3)}</span></label>`).join('')}</div>
      ${canEditSettings ? '<button class="btn btn-primary btn-small" type="submit" id="weekend-save" hidden>Save</button>' : ''}
    </form>
    <div class="card">
      <div class="cal-toolbar">
        <a class="btn btn-small" href="#/calendar${qs({ month: shiftMonth(month, -1), department_id: dept })}" aria-label="Previous month">‹</a>
        <h2>${esc(monthLabel(month))}</h2>
        <a class="btn btn-small" href="#/calendar${qs({ month: shiftMonth(month, 1), department_id: dept })}" aria-label="Next month">›</a>
        <a class="btn btn-small" href="#/calendar${qs({ department_id: dept })}">Today</a>
        <div class="spacer"></div>
        ${canEditWork || canEditLeave ? `<a class="btn btn-small ${editing ? 'btn-primary' : ''}" id="cal-edit" href="#/calendar${qs({ month, department_id: dept, edit: editing ? '' : '1' })}">${editing ? '✓ Done' : '✎ Edit'}</a>` : ''}
        ${deptOptions.length > 1 ? `<select id="dept" aria-label="Department"><option value="">All departments</option>${deptOptions.map((d) =>
          `<option value="${d.id}" ${String(d.id) === dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${editing ? '<p class="notice cal-edit-note">Edit mode: click ✕ on a date to delete it. Approved leave and WFH dates can be deleted. Click <b>✓ Done</b> when finished.</p>' : ''}
      <div class="cal-grid">${DAY_NAMES.map((n) => `<div class="cal-head">${n}</div>`).join('')}${cells.join('')}</div>
      <p class="cal-legend muted small">🏠 = Work From Home (shown for information, <b>not leave</b>). Striped = waiting for approval.</p>
      <ul class="cal-agenda">${agenda.join('') || '<li class="muted">No leave this month.</li>'}</ul>
    </div>
    ${showHolidays ? '<div id="holidays"></div>' : ''}`;
  const sel = view.querySelector('#dept');
  if (sel) sel.addEventListener('change', () => ctx.go(`calendar${qs({ month, department_id: sel.value, edit: editing ? '1' : '' })}`));

  // Edit mode: delete one date (WFH: from the WFH request; leave: the same as removing it in the Chart)
  view.querySelectorAll('.chip-x').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const k = b.dataset;
    if (!await confirmDialog({ title: 'Delete date', message: `Delete <b>${esc(k.what)}</b> of <b>${esc(k.name)}</b> on <b>${esc(fmtDate(k.date))}</b>?`, confirmText: 'Delete', danger: true })) return;
    try {
      if (k.kind === 'work') await post('/work/remove-date', { id: Number(k.id), date: k.date });
      else await post('/summary/remove', { employee_id: Number(k.emp), type: k.type, half_type: k.half, dates: [k.date] });
      toast('Date deleted.');
      ctx.refreshBadge && ctx.refreshBadge();
      render(view, ctx);
    } catch (err) { toast(err.message, 'error'); }
  }));

  const wf = view.querySelector('#weekend-form');
  if (canEditSettings) {
    const save = view.querySelector('#weekend-save');
    wf.addEventListener('change', () => { save.hidden = false; });
    wf.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await put('/settings', { weekend: [...wf.querySelectorAll('input[name=weekend]:checked')].map((i) => i.value).join(',') });
        toast('Weekend days saved.');
        await ctx.reload();
      } catch (err) { toast(err.message, 'error'); save.disabled = false; }
    });
  }
  if (showHolidays) {
    await holidaysSection(view.querySelector('#holidays'), ctx, canEditSettings,
      (y) => ctx.go(`calendar${qs({ month: `${y}-${month.slice(5)}`, department_id: dept })}`));
  }
}
