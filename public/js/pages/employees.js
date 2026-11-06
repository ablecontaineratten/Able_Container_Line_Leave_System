// Employees: list, add, edit, delete, import from CSV
import { del, get, post, put } from '../api.js';
import { $, confirmDialog, downloadCsv, esc, formDialog, openModal, pageHead, parseCsv, tableHtml, toast } from '../ui.js';

const DEFAULT_PASSWORD = 'user@123';     // same as DEFAULT_PASSWORD in src/server/routes/portal.js
const NEW_DESIGNATION = '__new__';       // the "<Add New>" choice in the Designation list

// Small round photo (chosen by the employee in the app), or coloured initials
function empAvatar(e) {
  if (e.photo_at) return `<img class="emp-avatar" src="/api/employees/${e.id}/photo?v=${encodeURIComponent(e.photo_at)}" alt="" loading="lazy">`;
  const hue = ([...String(e.name)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % 12) * 30;
  const ini = String(e.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="emp-avatar" style="--h:${hue}" aria-hidden="true">${esc(ini)}</span>`;
}

export default async function render(view, ctx) {
  const { me } = ctx.state;
  const canEdit = me.perms['employees.edit'];
  const canDelete = me.perms['employees.delete'];
  const data = await get('/employees');
  if (!ctx.isCurrent()) return;
  const departments = ctx.state.departments.filter((d) => me.scopeAll || me.deptIds.includes(d.id));
  let rows = data.rows;

  const fields = [
    { name: 'emp_no', label: 'Employee number', required: true, placeholder: 'EMP005' },
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', help: 'Needed to sign in and to get emails.' },
    { name: 'department_id', label: 'Department', type: 'select', required: true, options: [{ value: '', label: 'Choose…' }, ...departments.map((d) => ({ value: d.id, label: d.name }))] },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }] },
    // Designation: tick the box, then pick one from the list, or "<Add New>" and type it (saved with the employee)
    { name: 'has_designation', label: 'Has a designation', type: 'checkbox', full: true },
    { name: 'designation_pick', label: 'Designation', type: 'select', showIf: (v) => v.has_designation,
      options: [{ value: NEW_DESIGNATION, label: '<Add New>' }, ...(data.designations || []).map((d) => ({ value: d, label: d }))] },
    { name: 'designation_new', label: 'New designation', required: true, placeholder: 'Type the new designation',
      showIf: (v) => v.has_designation && v.designation_pick === NEW_DESIGNATION },
  ];
  // form values <-> the one "designation" the server keeps
  const formValues = (e) => {
    const known = (data.designations || []).some((d) => d.toLowerCase() === String(e.designation || '').toLowerCase());
    return { ...e, has_designation: !!e.designation,
      designation_pick: e.designation && known ? (data.designations.find((d) => d.toLowerCase() === e.designation.toLowerCase())) : NEW_DESIGNATION,
      designation_new: e.designation && !known ? e.designation : '' };
  };
  const toServer = (v) => {
    const { has_designation: has, designation_pick: pick, designation_new: typed, ...rest } = v;
    return { ...rest, designation: has ? (pick === NEW_DESIGNATION ? typed : pick) : '' };
  };
  const columns = [
    { label: 'No', render: (e) => `<b>${esc(e.emp_no)}</b>` },
    { label: 'Name', render: (e) => `<span class="emp-cell">${empAvatar(e)}<span>${esc(e.name)}${e.designation ? `<div class="muted small">${esc(e.designation)}</div>` : ''}</span></span>` },
    { label: 'Email', render: (e) => esc(e.email) },
    { label: 'Department', render: (e) => esc(e.department || '-') },
    { label: 'Status', render: (e) => `<span class="badge ${e.status === 'Active' ? 'badge-approved' : 'badge-cancelled'}">${esc(e.status)}</span>` },
    { label: 'Portal', render: (e) => (!e.email ? '<span class="muted small">No email - cannot sign in</span>'
      : e.own_password ? '<span class="badge badge-approved">Own password</span>' : `<span class="badge badge-pending">Default (${DEFAULT_PASSWORD})</span>`) },
    canEdit || canDelete ? { label: '', cls: 'actions', render: (e) => `${canEdit ? `<button class="btn btn-small" data-edit>Edit</button>${e.own_password ? ' <button class="btn btn-small" data-portal>Reset portal password</button>' : ''}` : ''} ${canDelete ? '<button class="btn btn-small btn-danger-outline" data-del>Delete</button>' : ''}` } : null,
  ].filter(Boolean);

  view.innerHTML = `${pageHead('Employees', '', `<button class="btn" id="export">Export CSV</button>
      ${canEdit ? '<button class="btn" id="import">Import CSV</button> <button class="btn btn-primary" id="add">Add employee</button>' : ''}`)}
    <div class="notice notice-action">Employee leave portal: <a href="${location.origin}/request" target="_blank" rel="noopener"><b>${location.origin}/request</b></a>
      · Username = the employee's <b>email</b> · First password = <b>${DEFAULT_PASSWORD}</b> (they can change it in the portal's Settings ⚙)</div>
    <div class="filters card"><input type="search" id="search" placeholder="Search number, name, email, department…" aria-label="Search"></div>
    <section class="card" id="list"></section>`;

  const reload = () => render(view, ctx);
  const draw = (list) => {
    const el = $('#list');
    el.innerHTML = tableHtml(columns, list, { empty: 'No employees yet.' });
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const e = list[Number(b.closest('tr').dataset.index)];
      if (await formDialog({ title: `Edit ${e.name}`, fields, values: formValues(e), onSubmit: (v) => put(`/employees/${e.id}`, toServer(v)) })) { toast('Saved.'); reload(); }
    }));
    el.querySelectorAll('[data-portal]').forEach((b) => b.addEventListener('click', async () => {
      const e = list[Number(b.closest('tr').dataset.index)];
      if (!await confirmDialog({ title: 'Reset portal password',
        message: `Reset the portal password of <b>${esc(e.name)}</b> to the default <b>${DEFAULT_PASSWORD}</b>? They will be signed out.`, confirmText: 'Reset' })) return;
      try { await post(`/employees/${e.id}/portal-reset`); toast(`${e.name} can sign in again with ${DEFAULT_PASSWORD}.`); reload(); } catch (err) { toast(err.message, 'error'); }
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const e = list[Number(b.closest('tr').dataset.index)];
      if (!await confirmDialog({ title: 'Delete employee', message: `Delete <b>${esc(e.name)}</b>? Old requests keep the name and number.`, confirmText: 'Delete', danger: true })) return;
      try { await del(`/employees/${e.id}`); toast('Deleted.'); reload(); } catch (err) { toast(err.message, 'error'); }
    }));
  };
  draw(rows);

  $('#search').addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    draw(t ? rows.filter((r) => [r.emp_no, r.name, r.email, r.department, r.designation].join(' ').toLowerCase().includes(t)) : rows);
  });
  $('#export').addEventListener('click', () => downloadCsv('employees.csv', ['emp_no', 'name', 'email', 'department', 'status', 'designation'],
    rows.map((e) => [e.emp_no, e.name, e.email, e.department, e.status, e.designation])));
  if (!canEdit) return;

  $('#add').addEventListener('click', async () => {
    if (!departments.length) return toast('Add a department first (Departments page).', 'error');
    if (await formDialog({ title: 'Add employee', fields, values: { status: 'Active', designation_pick: NEW_DESIGNATION }, onSubmit: (v) => post('/employees', toServer(v)) })) { toast('Employee added.'); reload(); }
  });

  $('#import').addEventListener('click', () => {
    const m = openModal({
      title: 'Import employees', wide: true,
      body: `<p>Paste CSV (or choose a file) with these columns. The first row may be a header. Existing employee numbers are <b>updated</b>.</p>
        <pre class="code">emp_no,name,email,department,status
EMP005,John Silva,john@company.com,IT,Active</pre>
        <input type="file" accept=".csv,text/csv" id="csv-file">
        <textarea id="csv-text" rows="8" placeholder="Paste here…"></textarea>
        <p class="form-error" hidden></p>
        <div class="modal-actions"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" id="do-import">Import</button></div>`,
    });
    const text = $('#csv-text', m.el);
    $('[data-cancel]', m.el).addEventListener('click', m.close);
    $('#csv-file', m.el).addEventListener('change', async (e) => { if (e.target.files[0]) text.value = await e.target.files[0].text(); });
    $('#do-import', m.el).addEventListener('click', async () => {
      const err = $('.form-error', m.el);
      let lines = parseCsv(text.value);
      if (lines.length && /emp/i.test(lines[0][0] || '') && /name/i.test(lines[0][1] || '')) lines = lines.slice(1);
      const body = lines.map((l) => ({ emp_no: l[0], name: l[1], email: l[2], department: l[3], status: l[4] }));
      if (!body.length) { err.textContent = 'Nothing to import.'; err.hidden = false; return; }
      try {
        const res = await post('/employees/import', { rows: body });
        m.close();
        toast(`${res.added} added, ${res.updated} updated.`);
        if (res.errors.length) openModal({ title: 'Some rows were skipped', body: `<ul>${res.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` });
        await ctx.reload();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  });
}
