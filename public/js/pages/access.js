// Access control (Super admin): tick what each role may see and do
import { get, put } from '../api.js';
import { $, $$, esc, pageHead, toast } from '../ui.js';

export default async function render(view, ctx) {
  const data = await get('/access');
  if (!ctx.isCurrent()) return;
  let group = '';
  const rows = data.perms.map((p) => {
    const head = p.group !== group ? `<tr class="group-row"><th colspan="${data.roles.length + 1}">${esc(p.group)}</th></tr>` : '';
    group = p.group;
    return `${head}<tr><td>${esc(p.label)}</td>${data.roles.map((r) =>
      `<td class="num"><input type="checkbox" data-key="${esc(p.key)}" data-role="${esc(r.key)}" ${data.matrix[p.key][r.key] ? 'checked' : ''} aria-label="${esc(`${r.label}: ${p.label}`)}"></td>`).join('')}</tr>`;
  }).join('');

  view.innerHTML = `${pageHead('Access control', '',
    '<button class="btn btn-primary" id="save">Save</button>')}
    <section class="card"><div class="table-wrap"><table class="table matrix">
      <thead><tr><th>Permission</th>${data.roles.map((r) => `<th class="num">${esc(r.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="muted small">"See every department" off = a head sees only the departments they head; an employee sees only their own department in the calendar.</p>
    </section>`;

  $('#save').addEventListener('click', async () => {
    const matrix = {};
    $$('input[data-key]', view).forEach((i) => {
      matrix[i.dataset.key] = matrix[i.dataset.key] || {};
      matrix[i.dataset.key][i.dataset.role] = i.checked;
    });
    try {
      await put('/access', { matrix });
      toast('Access saved.');
    } catch (err) { toast(err.message, 'error'); }
  });
}
