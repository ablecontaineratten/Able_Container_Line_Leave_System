// Settings: General, Leave Settings, Notifications (tabs). Weekend days + holidays are on the Calendar page.
import { del, get, post, put } from '../api.js';
import { notificationSettings } from '../push.js';
import { $, $$, confirmDialog, esc, fieldHtml, fmtDate, formDialog, pageHead, parseCsv, readForm, tableHtml, toast } from '../ui.js';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function render(view, ctx) {
  const tab = ctx.query.get('tab') || 'general';
  const canEdit = ctx.state.me.perms['settings.edit'];
  view.innerHTML = `${pageHead('Settings')}
    <div class="tabs" role="tablist">
      ${[['general', 'General'], ['types', 'Leave Settings'], ['wfh', 'WFH Settings'], ['notifications', 'Notifications']].map(([k, l]) =>
        `<a role="tab" href="#/settings?tab=${k}" class="${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${l}</a>`).join('')}
    </div><div id="tab-body" class="loading">Loading…</div>`;
  const body = $('#tab-body');
  if (tab === 'types') await typesTab(body, ctx, canEdit);
  else if (tab === 'wfh') await wfhTab(body, ctx);
  else if (tab === 'notifications') await notificationSettings(body, { post, toast });
  else await generalTab(body, ctx, canEdit);
  body.classList.remove('loading');
}

async function generalTab(body, ctx, canEdit) {
  const s = await get('/settings');
  if (!ctx.isCurrent()) return;
  const fields = [
    { name: 'company_name', label: 'Company name', required: true },
    { name: 'timezone', label: 'Time zone', help: 'Example: Asia/Colombo. Decides what "today" is.' },
    { name: 'year_start', label: 'Leave year starts (MM-DD)', help: '01-01 = calendar year. Balances start again on this day.' },
    { name: 'no_balance', label: 'When there is not enough balance', type: 'select', options: [
      { value: 'reject', label: 'Stop the request (employee sees why)' }, { value: 'warn', label: 'Send it with a warning to the head' }] },
    { name: 'copy_emails', label: 'Copy of Approved emails', full: true, help: 'Emails, comma separated (for example HR). They get a copy of every APPROVED leave only - not the request emails.' },
    { name: 'form_url', label: 'Emp App Link', full: true, help: 'The employee app address (where employees send leave / WFH requests). Shown in the "request NOT sent" email.' },
    { name: 'app_url', label: 'System Link', full: true, help: 'The main system address, used in email links. Empty = the address the system was opened from.' },
    { name: 'email_from', label: 'Email sender', full: true, help: 'Example: Able Leave <leave@yourcompany.com>. The EMAIL_FROM variable in Cloudflare wins over this.' },
    { name: 'brand_color', label: 'Main color', type: 'color' },
  ];
  body.innerHTML = `<div class="card email-status">
      ${s.email_service ? `<span><b>✉ Email is on</b> (${esc(s.email_service)}) · sender: ${esc(s.email_from || '-')}</span>`
        : '<span><b>✉ Email is off.</b> Connect the Google email service (google_email_services/GUIDE.md) or Brevo (GUIDE.md part 6).</span>'}
      ${canEdit ? '<button class="btn btn-small" id="test-email" type="button">Send test email</button>' : ''}
    </div>
    <section class="card backup-card" id="backup"></section>
    <form class="card form-grid" id="general">
      ${fields.map((f) => fieldHtml(f, s[f.name])).join('')}
      <p class="muted small full">Weekend days and holidays are set on the <a href="#/calendar">Calendar</a> page. Leave limits are in <a href="#/settings?tab=types">Leave Settings</a>.</p>
      <p class="form-error full" hidden></p>
      ${canEdit ? '<div class="full"><button class="btn btn-primary" type="submit">Save settings</button></div>' : ''}
    </form>`;
  await backupBox($('#backup', body), canEdit);
  const form = $('#general');
  if (!canEdit) { $$('input, select, textarea', form).forEach((el) => { el.disabled = true; }); return; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.hidden = true;
    try {
      await put('/settings', readForm(form, fields));
      toast('Settings saved.');
      await ctx.reload();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  const test = $('#test-email', body);
  if (test) test.addEventListener('click', async () => {
    test.disabled = true;
    try { const r = await post('/settings/test-email'); toast(`Test email ${r.result}.`); } catch (ex) { toast(ex.message, 'error'); }
    test.disabled = false;
  });
}

// Google Sheet Backup: paste a sheet link → First-time sync → kept up to date after every change; Sync now by hand
async function backupBox(box, canEdit) {
  let b;
  try { b = await get('/backup'); } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  const draw = () => {
    const ok = /^OK/.test(b.status);
    box.innerHTML = `<div class="card-head"><h2>📊 Google Sheet Backup</h2>
        ${b.connected ? `<span class="badge ${ok ? 'badge-approved' : 'badge-rejected'}">${ok ? 'Syncing' : 'Last sync failed'}</span>` : '<span class="badge badge-cancelled">Not connected</span>'}</div>
      ${b.connected ? `<div class="backup-status">
          <div><span class="muted small">Connected sheet</span><a href="${esc(b.sheet_url)}" target="_blank" rel="noopener"><b>${esc(b.sheet_title || 'Open the Google Sheet')}</b> ↗</a></div>
          <div><span class="muted small">Last synced</span><b>${esc(when(b.last_sync))}</b></div>
          <div><span class="muted small">Result</span><b class="${ok ? '' : 'error'}">${esc(b.status || '-')}</b></div>
        </div>` : ''}
      ${canEdit ? `<div class="backup-fields">
          <label class="field"><span>Google Sheet app link (Web app URL)</span>
            <input type="url" id="app-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(b.app_url)}"></label>
          <label class="field"><span>Secret key</span>
            <input type="password" id="app-secret" autocomplete="off" placeholder="${b.has_secret ? '•••••••• (saved - leave empty to keep)' : 'From setup in the Apps Script'}"></label>
        </div>
        <div class="backup-row"><button class="btn btn-primary" type="button" id="first-sync">First-time sync</button>
        ${b.connected ? `<button class="btn" type="button" id="sync-now">⟳ Sync now</button>
          <button class="btn btn-danger-outline" type="button" id="stop-sync">Stop syncing</button>` : ''}</div>
        ${b.connected ? `<div class="backup-schedule">
          <label class="field"><span>Automatic sync</span><select id="bk-schedule">
            ${[['change', 'After every change'], ['hourly', 'Every hour'], ['daily', 'Every day at…'], ['manual', 'Manual only (Sync now)']]
    .map(([v, l]) => `<option value="${v}" ${b.schedule === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" id="bk-time-box" ${b.schedule === 'daily' ? '' : 'hidden'}><span>Time</span><select id="bk-time">
            ${Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`).map((t) => `<option ${b.time === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <button class="btn btn-primary" type="button" id="bk-save">Save schedule</button>
        </div>` : ''}` : ''}`;
    const act = (id, label, fn) => {
      const btn = $(id, box);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = label;
        try { b = await fn(); toast(b.rows !== undefined ? `Synced: ${b.rows} rows.` : 'Done.'); } catch (err) { toast(err.message, 'error'); b = await get('/backup').catch(() => b); }
        draw();
      });
    };
    act('#first-sync', 'Syncing…', () => post('/backup/first-sync', { app_url: $('#app-url', box).value.trim(), secret: $('#app-secret', box).value.trim() }));
    act('#sync-now', 'Syncing…', () => post('/backup/sync'));
    const sch = $('#bk-schedule', box);
    if (sch) {
      sch.addEventListener('change', () => { $('#bk-time-box', box).hidden = sch.value !== 'daily'; });
      act('#bk-save', 'Saving…', () => post('/backup/schedule', { schedule: sch.value, time: $('#bk-time', box).value }));
    }
    const stopBtn = $('#stop-sync', box);
    if (stopBtn) stopBtn.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Stop syncing', message: 'Stop updating the Google Sheet? The sheet and its data stay as they are.', confirmText: 'Stop', danger: true })) return;
      try { b = await post('/backup/stop'); toast('Syncing stopped.'); } catch (err) { toast(err.message, 'error'); }
      draw();
    });
  };
  draw();
}

// WFH Settings: how many WFH days an employee may have per week / month / year (only a Super admin can change it)
async function wfhTab(body, ctx) {
  const s = await get('/settings');
  if (!ctx.isCurrent()) return;
  const canEdit = !!ctx.state.me.isSuper;
  const PERIODS = [['', 'No limit', 'Employees can ask for WFH on any number of days.'],
    ['week', 'Per week', 'A limit for each week (Monday – Sunday).'],
    ['month', 'Per month', 'A limit for each calendar month.'],
    ['year', 'Per year', 'A limit for each leave year.']];
  body.innerHTML = `<form class="card" id="wfh-form">
      <h2>WFH limit</h2>
      <p class="muted small">How many <b>Work From Home</b> days can one employee have? Approved and pending WFH days are counted.
        A request that goes over the limit is stopped and the employee sees why. The Chart and Summary group WFH days by the same period.</p>
      <div class="half-options">${PERIODS.map(([v, label, help]) => `<label class="half-option"><input type="radio" name="period" value="${v}" ${(s.wfh_limit_period || '') === v ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <span><b>${label}</b><small>${help}</small></span></label>`).join('')}</div>
      <div id="wfh-days-box">
        <label class="field wfh-days"><span>WFH days allowed <b id="wfh-per"></b></span>
          <input type="number" name="days" min="1" max="366" value="${esc(s.wfh_limit_days || '')}" ${canEdit ? '' : 'disabled'} placeholder="e.g. 2"></label>
        <label class="check wfh-nolimit"><input type="checkbox" name="nolimit" ${s.wfh_limit_period && !s.wfh_limit_days ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
          <span>No limit <small>(count and group WFH days by this period, but do not stop requests)</small></span></label>
      </div>
      <p class="form-error" hidden></p>
      ${canEdit ? '<button class="btn btn-primary" type="submit">Save</button>' : '<p class="muted small">Only a Super admin can change the WFH settings.</p>'}
    </form>`;
  const form = $('#wfh-form', body);
  const sync = () => {
    const p = $('input[name=period]:checked', form).value;
    $('#wfh-days-box', form).hidden = !p;
    $('#wfh-per', form).textContent = p ? `(per ${p})` : '';
    form.days.disabled = !canEdit || form.nolimit.checked;
  };
  form.addEventListener('change', sync);
  sync();
  if (!canEdit) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.hidden = true;
    const period = $('input[name=period]:checked', form).value;
    try {
      await put('/settings', { wfh_limit_period: period, wfh_limit_days: period && !form.nolimit.checked ? form.days.value.trim() : '' });
      toast('WFH settings saved.');
      await ctx.reload();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

// Leave Settings: yearly total + short leaves per month, then the leave types
async function typesTab(body, ctx, canEdit) {
  const [data, s] = await Promise.all([get('/leave-types'), get('/settings')]);
  if (!ctx.isCurrent()) return;
  const rows = data.rows;
  const limits = [
    { name: 'pool_days', label: 'Total leave days per year', type: 'number', min: 0, help: 'Empty = add up the leave types that "count in total".' },
    { name: 'short_per_month', label: 'Short leaves per month', type: 'number', min: 0, help: 'Starts again from 0 every month. Empty = use the Short Leave type days.' },
  ];
  const fields = [
    { name: 'name', label: 'Name', required: true },
    { name: 'days_per_year', label: 'Days per year', type: 'number', min: 0, step: '0.5', help: 'Empty = no limit (for example No Pay Leave).' },
    { name: 'sort_order', label: 'Order in lists', type: 'number' },
    { name: 'counts_in_pool', label: 'Counts in the yearly total', type: 'checkbox', full: true },
    { name: 'allow_half', label: 'Half day allowed', type: 'checkbox', full: true },
    { name: 'is_short', label: 'This is the Short Leave (hours, limit per month)', type: 'checkbox', full: true },
    { name: 'active', label: 'Active (shown in the apply form)', type: 'checkbox', full: true },
  ];
  const yes = (v) => (v ? '✔' : '');
  const columns = [
    { label: 'Name', render: (t) => `<b>${esc(t.name)}</b>${t.active ? '' : ' <span class="badge badge-cancelled">Inactive</span>'}` },
    { label: 'Days / year', cls: 'num', render: (t) => (t.days_per_year === null ? 'No limit' : esc(t.days_per_year)) },
    { label: 'In total', cls: 'num', render: (t) => yes(t.counts_in_pool) },
    { label: 'Half day', cls: 'num', render: (t) => yes(t.allow_half) },
    { label: 'Short leave', cls: 'num', render: (t) => yes(t.is_short) },
    canEdit ? { label: '', cls: 'actions', render: () => '<button class="btn btn-small" data-edit>Edit</button> <button class="btn btn-small btn-danger-outline" data-del>Delete</button>' } : null,
  ].filter(Boolean);
  // Half day: which leave a half day is taken from (sets "Half day allowed" on Annual / Casual)
  const annual = rows.find((t) => /annual/i.test(t.name) && !t.is_short);
  const casual = rows.find((t) => /casual/i.test(t.name) && !t.is_short);
  const halfNow = annual && casual && annual.allow_half && casual.allow_half ? 'both'
    : annual && annual.allow_half ? 'annual' : 'casual';
  const HALF = [
    ['casual', 'Casual Leave only', 'A half day is taken from Casual Leave (0.5 day).'],
    ['annual', 'Annual Leave only', 'A half day is taken from Annual Leave (0.5 day).'],
    ['both', 'Annual or Casual', 'The employee chooses Annual or Casual for the half day.'],
  ];
  body.innerHTML = `<form class="card form-grid" id="limits">
      ${limits.map((f) => fieldHtml(f, s[f.name])).join('')}
      <p class="form-error full" hidden></p>
      ${canEdit ? '<div class="full"><button class="btn btn-primary" type="submit">Save</button></div>' : ''}
    </form>
    ${annual && casual ? `<form class="card" id="half-form">
      <h2>Half day leave</h2>
      <p class="muted small">Which leave can an employee use for a <b>half day</b>? The employee app shows the "Half day" choice only for these leave types.</p>
      <div class="half-options">${HALF.map(([v, label, help]) => `<label class="half-option"><input type="radio" name="half" value="${v}" ${v === halfNow ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
        <span><b>${label}</b><small>${help}</small></span></label>`).join('')}</div>
      ${canEdit ? '<button class="btn btn-primary" type="submit">Save</button>' : ''}
    </form>` : ''}
    <section class="card">
    <div class="card-head"><h2>Leave types</h2><p class="muted">Half days count as 0.5 of the chosen type. Short leave is counted per month.</p>
      ${canEdit ? '<button class="btn btn-primary" id="add">Add leave type</button>' : ''}</div>
    ${tableHtml(columns, rows, { empty: 'No leave types.' })}</section>`;

  const limitsForm = $('#limits', body);
  if (!canEdit) $$('input', limitsForm).forEach((el) => { el.disabled = true; });
  else limitsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', limitsForm);
    err.hidden = true;
    try { await put('/settings', readForm(limitsForm, limits)); toast('Saved.'); await ctx.reload(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  const halfForm = $('#half-form', body);
  if (halfForm && canEdit) halfForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pick = halfForm.querySelector('input[name=half]:checked').value;
    try {
      await put(`/leave-types/${annual.id}`, { ...annual, allow_half: pick !== 'casual' });
      await put(`/leave-types/${casual.id}`, { ...casual, allow_half: pick !== 'annual' });
      toast('Half day setting saved.');
      await ctx.reload();
    } catch (err) { toast(err.message, 'error'); }
  });
  const done = async (msg) => { toast(msg); await ctx.reload(); };
  const toBody = (v) => ({ ...v, days_per_year: v.days_per_year === '' ? null : v.days_per_year });
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const t = rows[Number(b.closest('tr').dataset.index)];
    if (await formDialog({ title: `Edit ${t.name}`, fields, values: { ...t, days_per_year: t.days_per_year ?? '' }, onSubmit: (v) => put(`/leave-types/${t.id}`, toBody(v)) })) done('Saved.');
  }));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const t = rows[Number(b.closest('tr').dataset.index)];
    if (!await confirmDialog({ title: 'Delete leave type', message: `Delete <b>${esc(t.name)}</b>?`, confirmText: 'Delete', danger: true })) return;
    try { await del(`/leave-types/${t.id}`); done('Deleted.'); } catch (err) { toast(err.message, 'error'); }
  }));
  const add = $('#add', body);
  if (add) add.addEventListener('click', async () => {
    if (await formDialog({ title: 'Add leave type', fields, values: { counts_in_pool: true, active: true, sort_order: rows.length + 1 }, onSubmit: (v) => post('/leave-types', toBody(v)) })) done('Leave type added.');
  });
}

// Holidays list - shown on the Calendar page. goYear(y) opens another year.
export async function holidaysSection(body, ctx, canEdit, goYear) {
  const data = await get('/holidays');
  if (!ctx.isCurrent()) return;
  const year = ctx.query.get('year') || (ctx.query.get('month') || ctx.state.today).slice(0, 4);
  const years = [...new Set([year, ctx.state.today.slice(0, 4), ...data.rows.map((h) => h.date.slice(0, 4))])].sort().reverse();
  const rows = data.rows.filter((h) => h.date.startsWith(year)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const fields = [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Holiday name' }];
  const columns = [
    { label: 'Date', render: (h) => `<b>${esc(fmtDate(h.date))}</b>` },
    { label: 'Day', render: (h) => DAYS[new Date(`${h.date}T00:00:00Z`).getUTCDay()] },
    { label: 'Name', render: (h) => esc(h.name) },
    canEdit ? { label: '', cls: 'actions', render: () => '<button class="btn btn-small" data-edit>Edit</button> <button class="btn btn-small btn-danger-outline" data-del>Delete</button>' } : null,
  ].filter(Boolean);
  body.innerHTML = `<section class="card">
    <div class="card-head"><h2>Holidays</h2><select id="year" aria-label="Year">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <span class="spacer"></span>
      ${canEdit ? '<span><button class="btn" id="paste">Paste list</button> <button class="btn btn-primary" id="add">Add holiday</button></span>' : ''}</div>
    <p class="muted small">Holidays are not counted as leave days. ${rows.length} holiday(s) in ${year}.</p>
    ${tableHtml(columns, rows, { empty: 'No holidays for this year yet.' })}</section>`;

  const done = async (msg) => { toast(msg); await ctx.reload(); };
  $('#year', body).addEventListener('change', (e) => goYear(e.target.value));
  body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const h = rows[Number(b.closest('tr').dataset.index)];
    if (await formDialog({ title: 'Edit holiday', fields, values: h, onSubmit: (v) => put(`/holidays/${h.id}`, v) })) done('Saved.');
  }));
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const h = rows[Number(b.closest('tr').dataset.index)];
    if (!await confirmDialog({ title: 'Delete holiday', message: `Delete ${esc(fmtDate(h.date))} ${esc(h.name)}?`, confirmText: 'Delete', danger: true })) return;
    try { await del(`/holidays/${h.id}`); done('Deleted.'); } catch (err) { toast(err.message, 'error'); }
  }));
  if (!canEdit) return;
  $('#add', body).addEventListener('click', async () => {
    if (await formDialog({ title: 'Add holiday', fields, onSubmit: (v) => post('/holidays', v) })) done('Holiday added.');
  });
  $('#paste', body).addEventListener('click', async () => {
    const res = await formDialog({
      title: 'Paste holidays', submitText: 'Add all',
      intro: '<p>One holiday per line: <code>2026-01-14, Tamil Thai Pongal Day</code></p>',
      fields: [{ name: 'list', label: 'Holidays', type: 'textarea', rows: 10, full: true, required: true }],
      onSubmit: async (v) => {
        let added = 0;
        const errors = [];
        for (const line of parseCsv(v.list)) {
          try { await post('/holidays', { date: line[0].trim(), name: (line.slice(1).join(',') || '').trim() }); added++; } catch (err) { errors.push(`${line[0]}: ${err.message}`); }
        }
        return { added, errors };
      },
    });
    if (res) {
      if (res.errors.length) toast(res.errors.join(' '), 'error');
      done(`${res.added} holiday(s) added.`);
    }
  });
}
