// Apply for leave: one day / days in a row / separate dates, half day, short leave
import { get, post, qs } from '../api.js';
import { $, $$, addDays, esc, fmtDate, pageHead, toast, toUtc } from '../ui.js';
import { balanceCards } from '../components/balance.js';

export default async function render(view, ctx) {
  const { me, types, settings, holidays, today } = ctx.state;
  const others = me.perms['leave.apply_others'] ? (await get('/employees/options')).rows : [];
  if (!ctx.isCurrent()) return;
  if (!me.employee && !others.length) {
    view.innerHTML = `${pageHead('Request Leave')}<div class="notice">Your login is not linked to an employee record. Please ask an admin.</div>`;
    return;
  }
  const weekend = new Set(String(settings.weekend || '').split(',').filter((x) => x !== '').map(Number));
  const holidaySet = new Set(holidays.map((h) => h.date));
  const minDate = me.perms['leave.past_dates'] ? '' : today;
  const isWorking = (d) => !weekend.has(toUtc(d).getUTCDay()) && !holidaySet.has(d);
  const countWorking = (from, to) => {
    let n = 0;
    for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) if (isWorking(d)) n++;
    return n;
  };
  const dateInput = (name, value = '') => `<input type="date" name="${name}" value="${value}" ${minDate ? `min="${minDate}"` : ''}>`;

  view.innerHTML = `${pageHead('Request Leave')}
    <div class="grid-apply">
      <form class="card stack" id="apply-form" novalidate>
        ${others.length ? `<label class="field"><span>Employee</span><select name="employee_id">
          ${me.employee ? `<option value="${me.employee.id}">Myself (${esc(me.employee.name)})</option>` : ''}
          ${others.filter((e) => !me.employee || e.id !== me.employee.id).map((e) =>
            `<option value="${e.id}">${esc(e.name)} · ${esc(e.emp_no)} · ${esc(e.department || '')}</option>`).join('')}
        </select></label>` : ''}

        <label class="field"><span>Leave type *</span><select name="leave_type" required>
          <option value="">Choose…</option>${types.map((t) => `<option>${esc(t.name)}</option>`).join('')}</select></label>

        <fieldset class="field" id="mode-box"><span>How many days?</span>
          <div class="segmented">
            <label><input type="radio" name="mode" value="one" checked><span>One day</span></label>
            <label><input type="radio" name="mode" value="range"><span>Days in a row</span></label>
            <label><input type="radio" name="mode" value="dates"><span>Separate dates</span></label>
          </div></fieldset>

        <div id="one-box" class="form-grid">
          <label class="field"><span>Date *</span>${dateInput('date')}</label>
          <fieldset class="field" id="half-box" hidden><span>Full or half day?</span>
            <div class="segmented"><label><input type="radio" name="half" value="0" checked><span>Full day</span></label>
            <label><input type="radio" name="half" value="1"><span>Half day</span></label></div></fieldset>
        </div>
        <div id="short-box" class="form-grid" hidden>
          <label class="field"><span>Out time *</span><input type="time" name="out_time"></label>
          <label class="field"><span>Return time (optional)</span><input type="time" name="return_time"></label>
        </div>
        <div id="range-box" class="form-grid" hidden>
          <label class="field"><span>From *</span>${dateInput('from')}</label>
          <label class="field"><span>To *</span>${dateInput('to')}</label>
        </div>
        <div id="dates-box" hidden>
          <div class="field"><span>Dates * (up to 10)</span><div id="date-list" class="date-list">${dateInput('d')}${dateInput('d')}</div></div>
          <button type="button" class="btn btn-small" id="add-date">+ Add a date</button>
        </div>

        <label class="field"><span>Reason</span><textarea name="reason" rows="3" maxlength="1000"></textarea></label>
        <p class="summary" id="summary"></p>
        <p class="form-error" hidden></p>
        <div><button class="btn btn-primary" type="submit">Send request</button></div>
      </form>
      <section class="card" id="balance-box"><h2>Balance</h2><div class="loading">Loading…</div></section>
    </div>`;

  const form = $('#apply-form');
  const errBox = $('.form-error', form);
  const show = (id, on) => { $(id).hidden = !on; };
  const selectedType = () => types.find((t) => t.name === form.leave_type.value);
  const mode = () => form.mode.value;

  function update() {
    const t = selectedType();
    const isShort = !!(t && t.is_short);
    show('#mode-box', !isShort);
    const m = isShort ? 'one' : mode();
    show('#one-box', m === 'one');
    show('#half-box', m === 'one' && !!(t && t.allow_half));
    show('#short-box', isShort);
    show('#range-box', m === 'range');
    show('#dates-box', m === 'dates');
    if (!(t && t.allow_half)) form.querySelector('input[name=half][value="0"]').checked = true;

    let text = '';
    if (m === 'one' && form.date.value) {
      text = isWorking(form.date.value) ? (isShort ? `Short leave on ${fmtDate(form.date.value)}`
        : form.half.value === '1' ? '0.5 day (half day)' : '1 working day') : `${fmtDate(form.date.value)} is a weekend day / holiday.`;
    } else if (m === 'range' && form.from.value && form.to.value) {
      text = form.to.value < form.from.value ? '"To" is before "From".' : `${countWorking(form.from.value, form.to.value)} working day(s)`;
    } else if (m === 'dates') {
      const ds = [...new Set($$('input[name=d]', form).map((i) => i.value).filter(Boolean))];
      const off = ds.filter((d) => !isWorking(d));
      if (ds.length) text = off.length ? `${off.map(fmtDate).join(', ')}: weekend / holiday.` : `${ds.length} working day(s)`;
    }
    $('#summary').textContent = text;
  }

  async function loadBalance() {
    const box = $('#balance-box');
    const id = form.employee_id ? form.employee_id.value : me.employee.id;
    try {
      const sum = await get(`/balance${qs({ employee_id: id })}`);
      box.innerHTML = `<h2>Balance</h2>${balanceCards(sum)}`;
    } catch (err) {
      box.innerHTML = `<h2>Balance</h2><div class="empty">${esc(err.message)}</div>`;
    }
  }

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  if (form.employee_id) form.employee_id.addEventListener('change', loadBalance);
  $('#add-date').addEventListener('click', () => {
    const list = $('#date-list');
    if (list.children.length >= 10) return toast('Up to 10 dates.', 'error');
    list.insertAdjacentHTML('beforeend', dateInput('d'));
    list.lastElementChild.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const t = selectedType();
    const body = {
      employee_id: form.employee_id ? Number(form.employee_id.value) : undefined,
      leave_type: form.leave_type.value,
      mode: t && t.is_short ? 'one' : mode(),
      date: form.date.value,
      half: form.half.value === '1',
      out_time: form.out_time.value,
      return_time: form.return_time.value,
      from: form.from.value,
      to: form.to.value,
      dates: $$('input[name=d]', form).map((i) => i.value).filter(Boolean),
      reason: form.reason.value,
    };
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const res = await post('/requests', body);
      toast(`Request ${res.group_no} sent.`);
      if (res.warnings.length) toast(res.warnings.join(' '), 'error');
      ctx.go(body.employee_id && me.employee && body.employee_id !== me.employee.id ? 'requests' : 'my-leave');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      btn.disabled = false;
    }
  });

  update();
  loadBalance();
}
