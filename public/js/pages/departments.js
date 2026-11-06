// Departments and their heads (heads get the request emails and approve)
import { del, get, post, put } from '../api.js';
import { $, confirmDialog, esc, formDialog, pageHead, tableHtml, toast } from '../ui.js';

export default async function render(view, ctx) {
  const { me } = ctx.state;
  const canEdit = me.perms['departments.edit'];
  const canDelete = me.perms['departments.delete'] && me.scopeAll;
  const data = await get('/departments');
  if (!ctx.isCurrent()) return;
  const rows = data.rows;

  const fields = [
    { name: 'name', label: 'Department name', required: true, full: true },
    { name: 'head_ids', label: 'Department head(s)', type: 'multiselect', full: true,
      options: data.users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
      help: 'Tick or untick heads. Heads get the leave requests of this department only (notification + Approvals).' },
    ...(me.perms['users.edit'] ? [
      { name: 'nh_name', label: 'New head - name', placeholder: 'Optional: create a head login here' },
      { name: 'nh_email', label: 'New head - email (username)', type: 'email' },
      { name: 'nh_password', label: 'New head - password', type: 'password', full: true, help: 'At least 8 characters, letters and numbers. The head signs in with this email and password.' },
    ] : []),
  ];
  // the "New head" fields -> new_heads: [{ name, email, password }]
  const toBody = (v) => {
    const { nh_name: n, nh_email: e, nh_password: p, ...rest } = v;
    return { ...rest, new_heads: n || e ? [{ name: n, email: e, password: p }] : [] };
  };
  const columns = [
    { label: 'Department', render: (d) => `<b>${esc(d.name)}</b>` },
    { label: 'Head(s)', render: (d) => (d.heads.length ? d.heads.map((h) => `${esc(h.name)} <span class="muted small">${esc(h.email)}</span>`).join('<br>')
      : '<span class="muted small">No head - requests go to the admins</span>') },
    { label: 'Active employees', cls: 'num', render: (d) => esc(d.employees) },
    canEdit || canDelete ? { label: '', cls: 'actions', render: () => `${canEdit ? '<button class="btn btn-small" data-edit>Edit</button>' : ''} ${canDelete ? '<button class="btn btn-small btn-danger-outline" data-del>Delete</button>' : ''}` } : null,
  ].filter(Boolean);

  view.innerHTML = `${pageHead('Departments', '', canEdit && me.scopeAll ? '<button class="btn btn-primary" id="add">Add department</button>' : '')}
    <section class="card" id="list">${tableHtml(columns, rows, { empty: 'No departments yet.' })}</section>`;

  const done = async (msg) => { toast(msg); await ctx.reload(); };
  const list = $('#list');
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const d = rows[Number(b.closest('tr').dataset.index)];
    const values = { name: d.name, head_ids: d.heads.map((h) => h.id) };
    if (await formDialog({ title: `Edit ${d.name}`, fields, values, onSubmit: (v) => put(`/departments/${d.id}`, toBody(v)) })) done('Saved.');
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const d = rows[Number(b.closest('tr').dataset.index)];
    if (!await confirmDialog({ title: 'Delete department', message: `Delete <b>${esc(d.name)}</b>?`, confirmText: 'Delete', danger: true })) return;
    try { await del(`/departments/${d.id}`); done('Deleted.'); } catch (err) { toast(err.message, 'error'); }
  }));
  const add = $('#add');
  if (add) add.addEventListener('click', async () => {
    if (await formDialog({ title: 'Add department', fields, onSubmit: (v) => post('/departments', toBody(v)) })) done('Department added.');
  });
}
