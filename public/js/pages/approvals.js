// Approvals: pending requests of my department(s); approve / reject one or many
import { get, qs } from '../api.js';
import { $, esc, pageHead, tableHtml, wireSelection } from '../ui.js';
import { requestColumns, runAction, wireOpen } from '../components/requests.js';

export default async function render(view, ctx) {
  const list = await get(`/requests${qs({ view: 'pending' })}`);
  if (!ctx.isCurrent()) return;
  const rows = list.rows.sort((a, b) => (a.from_date < b.from_date ? -1 : 1));
  const columns = [...requestColumns({ decided: false }), { label: 'Reason', render: (r) => `<span class="small">${esc(r.reason)}</span>` },
    { label: '', cls: 'actions', render: () => '<button class="btn btn-small btn-success" data-act="approve">Approve</button> <button class="btn btn-small btn-danger" data-act="reject">Reject</button>' }];

  view.innerHTML = `${pageHead('Approvals')}
    <div class="bulk" id="bulk" hidden><span id="bulk-count"></span>
      <button class="btn btn-small btn-success" data-bulk="approve">Approve selected</button>
      <button class="btn btn-small btn-danger" data-bulk="reject">Reject selected</button></div>
    <section class="card" id="list">${tableHtml(columns, rows, { empty: 'Nothing is waiting. 🎉', selectable: true })}</section>`;

  const listEl = $('#list');
  const refresh = () => { ctx.refreshBadge(); render(view, ctx); };
  wireOpen(listEl, rows, ctx, refresh);
  const selected = wireSelection(listEl, (idx) => {
    $('#bulk').hidden = !idx.length;
    $('#bulk-count').textContent = `${idx.length} selected`;
  });
  listEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const r = rows[Number(b.closest('tr').dataset.index)];
    if (await runAction(b.dataset.act, [r], ctx)) refresh();
  }));
  view.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', async () => {
    const chosen = selected().map((i) => rows[i]);
    if (chosen.length && await runAction(b.dataset.bulk, chosen, ctx)) refresh();
  }));
}
