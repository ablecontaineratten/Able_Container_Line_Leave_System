// Leave Chart: employees across, Casual / Annual / Half Day / Short going down, one date per cell (27-Feb).
// With "summary.edit": click an employee's cell to add (type, pick or From-To) or remove dates; "Bulk add" for many employees.
import { get, post, qs } from '../api.js';
import { $, $$, addDays, downloadCsv, esc, fmtDate, openModal, pageHead, toast } from '../ui.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dMon = (s) => `${Number(s.slice(8, 10))}-${MON[Number(s.slice(5, 7)) - 1]}`;
const dmy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const pad = (n) => String(n).padStart(2, '0');
const valid = (y, m, d) => { const s = `${y}-${pad(m)}-${pad(d)}`; const t = new Date(`${s}T00:00:00Z`); return !isNaN(t) && t.toISOString().slice(0, 10) === s ? s : null; };

// Typed dates: "27-Feb", "6 Mar", "16/04", "16/04/2026", "2026-04-16" (comma, space or new line between).
// A date without a year gets the year that puts it inside the leave year.
function parseTyped(text, year) {
  const dates = [];
  const bad = [];
  const tokens = String(text).split(/[,;\n]+|\s{2,}/).map((t) => t.trim()).filter(Boolean)
    .flatMap((t) => (/^\d{1,2}\s+[a-z]{3,}$/i.test(t) || /^\d{1,2}\s+[a-z]{3,}\s+\d{4}$/i.test(t) ? [t] : t.split(/\s+/)));
  const withYear = (m, d, y) => {
    if (y) return valid(y, m, d);
    const y0 = Number(year.start.slice(0, 4));
    const first = valid(y0, m, d);
    if (first && first >= year.start && first < year.end) return first;
    return valid(y0 + 1, m, d);
  };
  for (const t of tokens) {
    let m;
    let s = null;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) s = valid(m[1], m[2], m[3]);
    else if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(t))) s = withYear(m[2], m[1], m[3]);
    else if ((m = /^(\d{1,2})[\s-]*([a-z]{3})[a-z]*(?:[\s-]*(\d{4}))?$/i.exec(t))) {
      const mi = MON.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
      s = mi < 0 ? null : withYear(mi + 1, m[1], m[3]);
    }
    if (s) dates.push(s); else bad.push(t);
  }
  return { dates: [...new Set(dates)].sort(), bad };
}

function rangeDates(from, to) {
  const out = [];
  for (let d = from; d && to && d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

// Add-dates block: Type / Pick / From - To. Returns () => { dates, bad }
function datePicker(root, year) {
  root.innerHTML = `<div class="segmented sg-mode">
      <label><input type="radio" name="dmode" value="type" checked><span>Type dates</span></label>
      <label><input type="radio" name="dmode" value="pick"><span>Pick dates</span></label>
      <label><input type="radio" name="dmode" value="range"><span>From - To</span></label></div>
    <div class="sg-type"><textarea name="typed" rows="3" placeholder="27-Feb, 6-Mar, 16/04, 17/04/2026"></textarea>
      <p class="sg-preview muted small"></p></div>
    <div class="sg-pick" hidden><div class="date-list"><input type="date" name="d"><input type="date" name="d"></div>
      <button type="button" class="btn btn-small sg-more">+ Date</button></div>
    <div class="sg-range form-grid" hidden><label class="field"><span>From</span><input type="date" name="from"></label>
      <label class="field"><span>To</span><input type="date" name="to"></label></div>`;
  const mode = () => $('input[name=dmode]:checked', root).value;
  $$('input[name=dmode]', root).forEach((r) => r.addEventListener('change', () => {
    $('.sg-type', root).hidden = mode() !== 'type';
    $('.sg-pick', root).hidden = mode() !== 'pick';
    $('.sg-range', root).hidden = mode() !== 'range';
  }));
  $('.sg-more', root).addEventListener('click', () => $('.date-list', root).insertAdjacentHTML('beforeend', '<input type="date" name="d">'));
  const typed = $('textarea[name=typed]', root);
  const preview = $('.sg-preview', root);
  typed.addEventListener('input', () => {
    const r = parseTyped(typed.value, year);
    preview.innerHTML = `${r.dates.length ? `✓ ${r.dates.map(dMon).join(', ')}` : ''}${r.bad.length ? ` <span class="error">· not understood: ${esc(r.bad.join(', '))}</span>` : ''}`;
  });
  return () => {
    if (mode() === 'type') return parseTyped(typed.value, year);
    if (mode() === 'range') return { dates: rangeDates($('input[name=from]', root).value, $('input[name=to]', root).value), bad: [] };
    return { dates: [...new Set($$('input[name=d]', root).map((i) => i.value).filter(Boolean))].sort(), bad: [] };
  };
}

const halfSelect = (types) => `<label class="field sg-half"><span>Half day of</span><select name="half_type">
  ${types.map((t) => `<option ${/casual/i.test(t) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;

export default async function render(view, ctx) {
  const { departments, me } = ctx.state;
  const canEdit = !!me.perms['summary.edit'];
  const dept = ctx.query.get('department_id') || '';
  const date = ctx.query.get('date') || '';
  const data = await get(`/summary${qs({ department_id: dept, date })}`);
  if (!ctx.isCurrent()) return;
  const { employees, rows, cells, year, halfTypes } = data;
  const cellDates = (e, k) => (cells[e.id] && cells[e.id][k]) || [];
  const deptOptions = departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));

  // one block per leave type; as many lines as the employee with the most dates (at least 1)
  const body = rows.map((r) => {
    const lines = Math.max(1, ...employees.map((e) => cellDates(e, r.key).length));
    return Array.from({ length: lines }, (_, i) => `<tr class="${i === 0 ? 'lc-start' : ''}">
      <th>${i === 0 ? esc(r.label) : ''}</th>
      ${employees.map((e) => {
        const d = cellDates(e, r.key)[i];
        return `<td class="${canEdit ? 'lc-edit' : ''}" data-e="${e.id}" data-k="${esc(r.key)}">${d ? dMon(d) : ''}</td>`;
      }).join('')}</tr>`).join('');
  }).join('');

  view.innerHTML = `${pageHead('Leave Chart', `${esc(fmtDate(year.start))} – ${esc(fmtDate(addDays(year.end, -1)))}`,
    `<button class="btn" id="export">Export CSV</button>${canEdit ? ' <button class="btn btn-primary" id="bulk">Bulk add</button>' : ''}`)}
    <div class="filters card">
      <a class="btn btn-small" href="#/summary${qs({ department_id: dept, date: addDays(year.start, -1) })}">‹ Previous year</a>
      <a class="btn btn-small" href="#/summary${qs({ department_id: dept, date: year.end })}">Next year ›</a>
      ${deptOptions.length > 1 ? `<select id="dept" aria-label="Department"><option value="">All departments</option>${deptOptions.map((d) =>
        `<option value="${d.id}" ${String(d.id) === dept ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
      ${canEdit ? '<span class="muted small">Click a cell to add or remove that employee\'s dates.</span>' : ''}
    </div>
    <section class="card lc-card">${employees.length ? `<div class="lc-wrap"><table class="lc">
      <thead><tr><th class="lc-corner"></th>${employees.map((e) => `<th><b>${esc(e.name)}</b><small>${esc(e.emp_no)}${e.department ? `,<br>${esc(e.department)}` : ''}</small></th>`).join('')}</tr></thead>
      <tbody>${body}</tbody></table></div>` : '<div class="empty">No employees.</div>'}</section>`;

  const reload = () => render(view, ctx);
  const sel = $('#dept', view);
  if (sel) sel.addEventListener('change', () => ctx.go(`summary${qs({ department_id: sel.value, date })}`));

  $('#export', view).addEventListener('click', () => {
    const out = [];
    rows.forEach((r) => {
      const lines = Math.max(1, ...employees.map((e) => cellDates(e, r.key).length));
      for (let i = 0; i < lines; i++) out.push([i === 0 ? r.label : '', ...employees.map((e) => { const d = cellDates(e, r.key)[i]; return d ? dMon(d) : ''; })]);
    });
    downloadCsv(`leave-chart-${year.start.slice(0, 4)}.csv`, ['', ...employees.map((e) => `${e.name} (${e.emp_no})`)], out);
  });
  if (!canEdit) return;

  // ---- one employee + one leave type: remove ticked / add typed or picked dates
  $$('.lc-edit', view).forEach((td) => td.addEventListener('click', () => {
    const emp = employees.find((e) => String(e.id) === td.dataset.e);
    const row = rows.find((r) => r.key === td.dataset.k);
    const ds = cellDates(emp, row.key);
    const m = openModal({
      title: `${emp.name} · ${row.label}`,
      body: `${ds.length ? `<div class="sg-existing">${ds.map((d) => `<label class="check"><input type="checkbox" value="${d}"> <span>${dmy(d)}</span></label>`).join('')}</div>
        <div class="modal-actions" style="margin-top:8px"><button class="btn btn-danger-outline" id="rm">Remove ticked</button></div>` : ''}
        <h3 class="sg-h3">Add dates</h3>
        ${row.kind === 'half' ? halfSelect(halfTypes) : ''}
        <div id="picker"></div>
        <p class="form-error" hidden></p>
        <div class="modal-actions"><button class="btn" data-cancel>Close</button><button class="btn btn-primary" id="add">Add</button></div>`,
    });
    const pick = datePicker($('#picker', m.el), year);
    const err = $('.form-error', m.el);
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    $('[data-cancel]', m.el).addEventListener('click', m.close);
    const half = () => { const s = $('select[name=half_type]', m.el); return s ? s.value : ''; };
    const rm = $('#rm', m.el);
    if (rm) rm.addEventListener('click', async () => {
      const dates = $$('.sg-existing input:checked', m.el).map((i) => i.value);
      if (!dates.length) return fail('Tick the dates to remove.');
      try {
        const res = await post('/summary/remove', { employee_id: emp.id, type: row.key, half_type: half() || halfTypes[0], dates });
        toast(`${res.removed} date(s) removed.`); m.close(); reload();
      } catch (ex) { fail(ex.message); }
    });
    $('#add', m.el).addEventListener('click', async () => {
      const { dates, bad } = pick();
      if (bad.length) return fail(`Not understood: ${bad.join(', ')}`);
      if (!dates.length) return fail('Type or choose the dates to add.');
      try {
        const res = await post('/summary/add', { employee_id: emp.id, type: row.key, half_type: half(), dates });
        toast(`${res.added} date(s) added.`);
        if (res.skipped.length) toast(`Skipped: ${res.skipped.slice(0, 5).join('; ')}${res.skipped.length > 5 ? '…' : ''}`, 'error');
        m.close(); reload();
      } catch (ex) { fail(ex.message); }
    });
  }));

  // ---- bulk: same dates for many employees
  $('#bulk', view).addEventListener('click', () => {
    const m = openModal({
      title: 'Bulk add leave dates', wide: true,
      body: `<div class="form-grid">
          <label class="field"><span>Leave type</span><select name="type">${rows.map((r) => `<option value="${esc(r.key)}">${esc(r.label)}</option>`).join('')}</select></label>
          <div id="half-wrap" hidden>${halfSelect(halfTypes)}</div>
        </div>
        <div class="field" style="margin-top:12px"><span>Employees <button type="button" class="link" id="all-emps">(select all)</button></span>
          <div class="multi sg-emps">${employees.map((e) => `<label class="check"><input type="checkbox" value="${e.id}"> <span>${esc(e.name)} · ${esc(e.emp_no)}</span></label>`).join('')}</div></div>
        <h3 class="sg-h3">Dates</h3><div id="picker"></div>
        <p class="form-error" hidden></p>
        <div class="modal-actions"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="go">Add to selected</button></div>`,
    });
    const pick = datePicker($('#picker', m.el), year);
    const typeSel = $('select[name=type]', m.el);
    const syncHalf = () => { $('#half-wrap', m.el).hidden = typeSel.value !== 'Half Day'; };
    typeSel.addEventListener('change', syncHalf);
    syncHalf();
    $('#all-emps', m.el).addEventListener('click', () => {
      const boxes = $$('.sg-emps input', m.el);
      const on = !boxes.every((b) => b.checked);
      boxes.forEach((b) => { b.checked = on; });
    });
    $('[data-cancel]', m.el).addEventListener('click', m.close);
    const err = $('.form-error', m.el);
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    $('#go', m.el).addEventListener('click', async () => {
      const ids = $$('.sg-emps input:checked', m.el).map((i) => Number(i.value));
      const { dates, bad } = pick();
      if (bad.length) return fail(`Not understood: ${bad.join(', ')}`);
      if (!ids.length || !dates.length) return fail('Choose employees and dates.');
      try {
        const res = await post('/summary/add', { employee_ids: ids, type: typeSel.value, half_type: $('select[name=half_type]', m.el).value, dates });
        toast(`${res.added} date(s) added.`);
        if (res.skipped.length) toast(`Skipped ${res.skipped.length}: ${res.skipped.slice(0, 4).join('; ')}${res.skipped.length > 4 ? '…' : ''}`, 'error');
        m.close(); reload();
      } catch (ex) { fail(ex.message); }
    });
  });
}
