// Settings: General, Leave types, Holidays (tabs)
import { del, get, post, put } from '../api.js';
import { notificationSettings } from '../push.js';
import { $, $$, confirmDialog, esc, fieldHtml, fmtDate, formDialog, pageHead, parseCsv, readForm, tableHtml, toast } from '../ui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function render(view, ctx) {
  const tab = ctx.query.get('tab') || 'general';
  const canEdit = ctx.state.me.perms['settings.edit'];
  view.innerHTML = `${pageHead('Settings')}
    <div class="tabs" role="tablist">
      ${[['general', 'General'], ['types', 'Leave types'], ['holidays', 'Holidays'], ['notifications', 'Notifications']].map(([k, l]) =>
        `<a role="tab" href="#/settings?tab=${k}" class="${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${l}</a>`).join('')}
    </div><div id="tab-body" class="loading">Loading…</div>`;
  const body = $('#tab-body');
  if (tab === 'types') await typesTab(body, ctx, canEdit);
  else if (tab === 'holidays') await holidaysTab(body, ctx, canEdit);
  else if (tab === 'notifications') await notificationSettings(body, { post, toast });
  else await generalTab(body, ctx, canEdit);
  body.classList.remove('loading');
}

async function generalTab(body, ctx, canEdit) {
  const s = await get('/settings');
  if (!ctx.isCurrent()) return;
  const weekend = new Set(String(s.weekend).split(',').filter(Boolean));
  const fields = [
    { name: 'company_name', label: 'Company name', required: true },
    { name: 'timezone', label: 'Time zone', help: 'Example: Asia/Colombo. Decides what "today" is.' },
    { name: 'year_start', label: 'Leave year starts (MM-DD)', help: '01-01 = calendar year. Balances start again on this day.' },
    { name: 'pool_days', label: 'Total leave days per year', type: 'number', min: 0, help: 'Empty = add up the leave types that "count in total".' },
    { name: 'no_balance', label: 'When there is not enough balance', type: 'select', options: [
      { value: 'reject', label: 'Stop the request (employee sees why)' }, { value: 'warn', label: 'Send it with a warning to the head' }] },
    { name: 'short_per_month', label: 'Short leaves per month', type: 'number', min: 0, help: 'Starts again from 0 every month. Empty = use the Short Leave type days.' },
    { name: 'copy_emails', label: 'Copy of Approved emails', full: true, help: 'Emails, comma separated (for example HR). They get a copy of every APPROVED leave only - not the request emails.' },
    { name: 'form_url', label: 'Google Form link (employees request leave here)', full: true, help: 'Shown in the "request NOT sent" email so the employee can fill the form again.' },
    { name: 'app_url', label: 'App address (for email links)', full: true, help: 'Example: https://leave.yourcompany.com - empty = the address the app was opened from.' },
    { name: 'email_from', label: 'Email sender', full: true, help: 'Example: Leave System <leave@yourcompany.com>. The EMAIL_FROM variable in Cloudflare wins over this.' },
    { name: 'brand_color', label: 'Main color', type: 'color' },
    { name: 'logo_url', label: 'Logo image link (https://)', full: true },
  ];
  const requestLink = `${s.app_url || location.origin}/request`;
  body.innerHTML = `<div class="notice notice-action">Leave request app for employees:
      <a href="${esc(requestLink)}" target="_blank" rel="noopener"><b>${esc(requestLink)}</b></a></div>
    <div class="card email-status">
      ${s.email_service ? `<span><b>✉ Email is on</b> (${esc(s.email_service)}) · sender: ${esc(s.email_from || '-')}</span>`
        : '<span><b>✉ Email is off.</b> Connect the Google email service (google_email_services/GUIDE.md) or Brevo (GUIDE.md part 6).</span>'}
      ${canEdit ? '<button class="btn btn-small" id="test-email" type="button">Send test email</button>' : ''}
    </div>
    <form class="card form-grid" id="general">
      ${fields.map((f) => fieldHtml(f, s[f.name])).join('')}
      <fieldset class="field full"><span>Weekend days (not counted as leave)</span>
        <div class="multi">${DAYS.map((d, i) => `<label class="check"><input type="checkbox" name="weekend" value="${i}" ${weekend.has(String(i)) ? 'checked' : ''}> <span>${d}</span></label>`).join('')}</div></fieldset>
      <p class="form-error full" hidden></p>
      ${canEdit ? '<div class="full"><button class="btn btn-primary" type="submit">Save settings</button></div>' : ''}
    </form>`;
  const form = $('#general');
  if (!canEdit) { $$('input, select, textarea', form).forEach((el) => { el.disabled = true; }); return; }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.hidden = true;
    const v = readForm(form, fields);
    v.weekend = $$('input[name=weekend]:checked', form).map((i) => i.value).join(',');
    try {
      await put('/settings', v);
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

async function typesTab(body, ctx, canEdit) {
  const data = await get('/leave-types');
  if (!ctx.isCurrent()) return;
  const rows = data.rows;
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
  body.innerHTML = `<section class="card">
    <div class="card-head"><p class="muted">Half days count as 0.5 of the chosen type. Short leave is counted per month.</p>
      ${canEdit ? '<button class="btn btn-primary" id="add">Add leave type</button>' : ''}</div>
    ${tableHtml(columns, rows, { empty: 'No leave types.' })}</section>`;

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

async function holidaysTab(body, ctx, canEdit) {
  const data = await get('/holidays');
  if (!ctx.isCurrent()) return;
  const year = ctx.query.get('year') || ctx.state.today.slice(0, 4);
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
    <div class="card-head"><select id="year" aria-label="Year">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      ${canEdit ? '<span><button class="btn" id="paste">Paste list</button> <button class="btn btn-primary" id="add">Add holiday</button></span>' : ''}</div>
    <p class="muted small">Holidays are not counted as leave days. ${rows.length} holiday(s) in ${year}.</p>
    ${tableHtml(columns, rows, { empty: 'No holidays for this year yet.' })}</section>`;

  const done = async (msg) => { toast(msg); await ctx.reload(); };
  $('#year', body).addEventListener('change', (e) => ctx.go(`settings?tab=holidays&year=${e.target.value}`));
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
