// Small UI helpers: escaping, dates, toasts, dialogs, forms, tables, CSV

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function fmtDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s || '')) return s || '';
  return `${s.slice(8, 10)} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
}

export function fmtDateTime(iso, timeZone) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export const monthLabel = (ym) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export const toUtc = (s) => new Date(`${s}T00:00:00Z`);
export const addDays = (s, n) => new Date(toUtc(s).getTime() + n * 86400000).toISOString().slice(0, 10);

export function whenText(r) {
  if (r.day_type === 'Short Leave') {
    const time = r.out_time && r.return_time ? `${r.out_time}–${r.return_time}` : r.out_time ? `from ${r.out_time}` : '';
    return `${fmtDate(r.from_date)}${time ? ` · ${time}` : ''}`;
  }
  if (r.from_date !== r.to_date) return `${fmtDate(r.from_date)} → ${fmtDate(r.to_date)}`;
  return fmtDate(r.from_date) + (r.day_type === 'Half Day' ? ' · Half day' : '');
}

export const daysText = (r) => (r.day_type === 'Short Leave' ? (r.hours ? `${r.hours} h` : 'Short leave') : `${r.days} day${r.days === 1 ? '' : 's'}`);

export const statusBadge = (s) => `<span class="badge badge-${esc(String(s).toLowerCase())}">${esc(s)}</span>`;

export function toast(message, type = 'success') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); }, type === 'error' ? 6000 : 3500);
}

// ---------------------------------------------------------------- dialogs
export function openModal({ title, body, wide = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">&times;</button></div>
    <div class="modal-body">${body}</div></div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-close]').addEventListener('click', close);
  setTimeout(() => { const f = wrap.querySelector('input:not([type=hidden]), select, textarea, button.btn-primary'); if (f) f.focus(); }, 30);
  return { el: wrap.querySelector('.modal'), close };
}

// Resolves to false (cancelled) or { remark } when confirmed
export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, remark = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: `<p>${message}</p>
        ${remark ? '<label class="field"><span>Remark (optional)</span><textarea name="remark" rows="3" maxlength="500"></textarea></label>' : ''}
        <div class="modal-actions"><button class="btn" data-cancel>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button></div>`,
    });
    const done = (v) => { m.close(); resolve(v); };
    m.el.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    m.el.querySelector('[data-ok]').addEventListener('click', () => done({ remark: remark ? m.el.querySelector('textarea').value : undefined }));
  });
}

// fields: [{ name, label, type, options:[{value,label}], required, help, placeholder, full }]
export function fieldHtml(f, value) {
  const v = value ?? f.value ?? '';
  const req = f.required ? 'required' : '';
  const help = f.help ? `<small>${esc(f.help)}</small>` : '';
  if (f.type === 'checkbox') {
    return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> <span>${esc(f.label)}</span>${help}</label>`;
  }
  let input;
  if (f.type === 'select') {
    input = `<select name="${f.name}" ${req}>${(f.options || []).map((o) =>
      `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'multiselect') {
    const sel = new Set((v || []).map(String));
    input = `<div class="multi">${(f.options || []).map((o) =>
      `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(o.value)}" ${sel.has(String(o.value)) ? 'checked' : ''}> <span>${esc(o.label)}</span></label>`).join('') || '<small>Nothing to choose yet.</small>'}</div>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" rows="${f.rows || 3}" ${req} placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  } else {
    input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${req} placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}>`;
  }
  return `<label class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${help}</label>`;
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'checkbox') out[f.name] = form.elements[f.name].checked;
    else if (f.type === 'multiselect') out[f.name] = $$(`input[name="${f.name}"]:checked`, form).map((i) => i.value);
    else out[f.name] = form.elements[f.name].value.trim();
  }
  return out;
}

// onSubmit(values) may throw; the error is shown inside the dialog. Resolves with onSubmit's result or false.
export function formDialog({ title, fields, values = {}, submitText = 'Save', onSubmit, wide = false, intro = '' }) {
  return new Promise((resolve) => {
    const m = openModal({
      title, wide,
      body: `${intro}<form class="form-grid" novalidate>${fields.map((f) => fieldHtml(f, values[f.name])).join('')}
        <p class="form-error full" hidden></p>
        <div class="modal-actions full"><button type="button" class="btn" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary">${esc(submitText)}</button></div></form>`,
    });
    const form = m.el.querySelector('form');
    const errBox = form.querySelector('.form-error');
    // fields with showIf(values) only appear when it returns true (e.g. Designation only for Department heads)
    const shown = (f) => !f.showIf || f.showIf(readForm(form, fields));
    // a multiselect is many checkboxes inside one .field: hide the whole field, not one choice
    const boxOf = (f) => { const el = form.elements[f.name]; return (el && el.closest ? el : el && el[0])?.closest(f.type === 'multiselect' ? '.field' : '.field, .check'); };
    const syncShown = () => fields.filter((f) => f.showIf).forEach((f) => { const box = boxOf(f); if (box) box.hidden = !shown(f); });
    if (fields.some((f) => f.showIf)) { form.addEventListener('change', syncShown); form.addEventListener('input', syncShown); syncShown(); }
    m.el.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const missing = fields.find((f) => f.required && f.type !== 'checkbox' && shown(f) && !form.elements[f.name].value.trim());
      if (missing) { errBox.textContent = `${missing.label} is required.`; errBox.hidden = false; return; }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const values = readForm(form, fields);
        fields.filter((f) => !shown(f)).forEach((f) => { values[f.name] = f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : ''; });
        const result = await onSubmit(values);
        m.close();
        resolve(result ?? true);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.disabled = false;
      }
    });
  });
}

// ---------------------------------------------------------------- tables
// columns: [{ key, label, render(row), cls }]
export function tableHtml(columns, rows, { empty = 'Nothing to show.', selectable = false, rowAttr = () => '' } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const head = `${selectable ? '<th class="sel"><input type="checkbox" data-select-all aria-label="Select all"></th>' : ''}${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}`;
  const body = rows.map((r, i) => `<tr data-index="${i}" ${rowAttr(r)}>${selectable ? `<td class="sel"><input type="checkbox" data-select="${i}" aria-label="Select row"></td>` : ''}${columns.map((c) =>
    `<td class="${c.cls || ''}" data-label="${esc(c.label)}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Keeps "select all" and the row boxes in step; returns () => selected indexes
export function wireSelection(root, onChange = () => {}) {
  const all = $('[data-select-all]', root);
  const boxes = $$('[data-select]', root);
  const selected = () => boxes.filter((b) => b.checked).map((b) => Number(b.dataset.select));
  if (all) all.addEventListener('change', () => { boxes.forEach((b) => { b.checked = all.checked; }); onChange(selected()); });
  boxes.forEach((b) => b.addEventListener('change', () => { if (all) all.checked = boxes.every((x) => x.checked); onChange(selected()); }));
  return selected;
}

// ---------------------------------------------------------------- CSV
export function downloadCsv(filename, header, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------------------------------------------------------------- misc
export const loadingHtml = () => '<div class="loading"><span class="spinner"></span> Loading…</div>';

export function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
