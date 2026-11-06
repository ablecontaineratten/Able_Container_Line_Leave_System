// My leave: balance + every request of the signed-in employee
import { get, qs } from '../api.js';
import { pageHead, tableHtml } from '../ui.js';
import { balanceCards } from '../components/balance.js';
import { requestColumns, wireOpen } from '../components/requests.js';

export default async function render(view, ctx) {
  const { me } = ctx.state;
  if (!me.employee) {
    view.innerHTML = `${pageHead('My Leave')}<div class="notice">Your login is not linked to an employee record. Please ask an admin.</div>`;
    return;
  }
  const status = ctx.query.get('status') || '';
  const [sum, list] = await Promise.all([get('/balance'), get(`/requests${qs({ view: 'mine', status })}`)]);
  if (!ctx.isCurrent()) return;

  view.innerHTML = `${pageHead('My Leave', '', me.perms['leave.apply'] ? '<a class="btn btn-primary" href="#/apply">Request Leave</a>' : '')}
    <section class="card">${balanceCards(sum)}</section>
    <section class="card">
      <div class="card-head"><h2>My requests</h2>
        <select id="status-filter" aria-label="Status"><option value="">All statuses</option>
          ${['Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div id="list">${tableHtml(requestColumns({ employee: false }), list.rows, { empty: 'No requests yet.' })}</div>
    </section>`;
  view.querySelector('#status-filter').addEventListener('change', (e) => ctx.go(`my-leave${e.target.value ? `?status=${e.target.value}` : ''}`));
  wireOpen(view.querySelector('#list'), list.rows, ctx, () => render(view, ctx));
}
