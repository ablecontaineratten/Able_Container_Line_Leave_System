// Login accounts: create, edit role / status, reset password, create for all employees
import { del, get, post, put } from '../api.js';
import { $, confirmDialog, esc, fmtDateTime, formDialog, openModal, pageHead, tableHtml, toast } from '../ui.js';

function showPasswords(list) {
  openModal({
    title: 'Temporary passwords', wide: true,
    body: `<p>Give these to the people (they were also emailed if email is set up). Each person chooses a new password at the first sign in.
      <b>This list is shown only once.</b></p>
      ${tableHtml([
        { label: 'Name', render: (r) => esc(r.name) },
        { label: 'Email', render: (r) => esc(r.email) },
        { label: 'Password', render: (r) => `<code>${esc(r.tempPassword)}</code>` },
        { label: 'Email', render: (r) => `<span class="small muted">${esc(r.emailed)}</span>` },
      ], list)}`,
  });
}

export default async function render(view, ctx) {
  const { me } = ctx.state;
  const canEdit = me.perms['users.edit'];
  const canDelete = me.perms['users.delete'];
  const data = await get('/users');
  if (!ctx.isCurrent()) return;
  const rows = data.rows;
  const roleOptions = Object.entries(data.roles)
    .filter(([k]) => me.isSuper || (k !== 'admin' && k !== 'super_admin'))
    .map(([value, label]) => ({ value, label }));
  const editable = (u) => me.isSuper || (u.role !== 'admin' && u.role !== 'super_admin');

  const columns = [
    { label: 'Name', render: (u) => `<b>${esc(u.name)}</b>${u.emp_no ? `<div class="muted small">${esc(u.emp_no)}</div>` : ''}` },
    { label: 'Email', render: (u) => esc(u.email) },
    { label: 'Role', render: (u) => `${esc(data.roles[u.role] || u.role)}${u.head_of.length ? `<div class="muted small">Head of ${esc(u.head_of.join(', '))}</div>` : ''}` },
    { label: 'Status', render: (u) => `<span class="badge ${u.status === 'active' ? 'badge-approved' : 'badge-rejected'}">${u.status === 'active' ? 'Active' : 'Disabled'}</span>${u.must_change ? '<div class="muted small">Must change password</div>' : ''}` },
    { label: 'Last sign in', render: (u) => `<span class="small">${esc(fmtDateTime(u.last_login, ctx.state.settings.timezone) || 'Never')}</span>` },
    canEdit || canDelete ? { label: '', cls: 'actions', render: (u) => (editable(u) ? `${canEdit ? '<button class="btn btn-small" data-edit>Edit</button> <button class="btn btn-small" data-reset>Reset password</button>' : ''}
      ${canDelete && u.id !== me.id && (u.role !== 'super_admin' || me.isSuper) ? '<button class="btn btn-small btn-danger-outline" data-del>Delete</button>' : ''}` : '') } : null,
  ].filter(Boolean);

  view.innerHTML = `${pageHead('Login accounts', '',
    canEdit ? '<button class="btn btn-primary" id="add">Add account</button>' : '')}
    <section class="card" id="list">${tableHtml(columns, rows, { empty: 'No accounts.' })}</section>`;

  const reload = () => render(view, ctx);
  const rowOf = (b) => rows[Number(b.closest('tr').dataset.index)];
  const list = $('#list');

  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const u = rowOf(b);
    const fields = [
      { name: 'name', label: 'Name', required: true },
      { name: 'role', label: 'Role', type: 'select', options: roleOptions.some((o) => o.value === u.role) ? roleOptions : [{ value: u.role, label: data.roles[u.role] }, ...roleOptions] },
      { name: 'status', label: 'Status', type: 'select', options: [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled (cannot sign in)' }] },
    ];
    if (await formDialog({ title: `Edit ${u.name}`, fields, values: u, onSubmit: (v) => put(`/users/${u.id}`, v) })) { toast('Saved.'); reload(); }
  }));
  list.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const u = rowOf(b);
    if (!await confirmDialog({ title: 'Reset password', message: `Make a new temporary password for <b>${esc(u.name)}</b>? They will be signed out.`, confirmText: 'Reset' })) return;
    try { const res = await post(`/users/${u.id}/reset-password`); showPasswords([{ ...u, ...res }]); reload(); } catch (err) { toast(err.message, 'error'); }
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const u = rowOf(b);
    if (!await confirmDialog({ title: 'Delete account', message: `Delete the login of <b>${esc(u.name)}</b>? The employee record stays.`, confirmText: 'Delete', danger: true })) return;
    try { await del(`/users/${u.id}`); toast('Deleted.'); reload(); } catch (err) { toast(err.message, 'error'); }
  }));
  if (!canEdit) return;

  $('#add').addEventListener('click', async () => {
    const fields = [
      { name: 'name', label: 'Name', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'role', label: 'Role', type: 'select', options: roleOptions },
    ];
    const res = await formDialog({ title: 'Add account', fields, values: { role: 'head' }, onSubmit: (v) => post('/users', v).then((r) => ({ ...r, ...v })) });
    if (res) { showPasswords([res]); reload(); }
  });
}
