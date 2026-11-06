// Shared pieces for leave request lists: columns, detail dialog, actions
import { post } from '../api.js';
import { confirmDialog, daysText, esc, fmtDateTime, openModal, statusBadge, toast, whenText } from '../ui.js';

const ACTIONS = {
  approve: { label: 'Approve', status: 'Approved', cls: 'btn-success', remark: true },
  reject: { label: 'Reject', status: 'Rejected', cls: 'btn-danger', remark: true },
  cancel: { label: 'Cancel leave', status: 'Cancelled', cls: 'btn-danger', remark: true },
  withdraw: { label: 'Withdraw', status: 'Cancelled', cls: 'btn-danger', remark: false },
  delete: { label: 'Delete', cls: 'btn-danger-outline' },
};

// Mirrors the server rules (the server always checks again)
export function allowedActions(r, me) {
  const p = me.perms;
  const own = me.employee && r.employee_id === me.employee.id;
  if (own && !me.isSuper) return r.status === 'Pending' ? ['withdraw'] : [];
  const manage = p['requests.manage'];
  const out = new Set();
  if (r.status === 'Pending' && (p['approve.decide'] || manage)) { out.add('approve'); out.add('reject'); }
  if (r.status === 'Approved' && (p['requests.cancel'] || manage)) out.add('cancel');
  if (manage && r.status === 'Rejected') out.add('approve');
  if (manage && r.status === 'Cancelled') out.add('approve');
  if (p['requests.delete']) out.add('delete');
  return [...out];
}

// company time zone for request / decision times (set once when the app starts)
let zone;
export const setTimeZone = (tz) => { zone = tz; };
const when = (iso) => esc(fmtDateTime(iso, zone));

export function requestColumns({ employee = true, decided = true } = {}) {
  return [
    { label: 'Request', render: (r) => `<button class="link" data-open>${esc(r.request_no)}</button><div class="muted small">${when(r.submitted_at)}</div>` },
    employee ? { label: 'Employee', render: (r) => `<b>${esc(r.emp_name)}</b><div class="muted small">${esc(r.emp_no)} · ${esc(r.department || '-')}</div>` } : null,
    { label: 'Leave type', render: (r) => esc(r.leave_type) },
    { label: 'When', render: (r) => esc(whenText(r)) },
    { label: 'Days', cls: 'num', render: (r) => esc(daysText(r)) },
    { label: 'Status', render: (r) => statusBadge(r.status) },
    decided ? { label: 'Decided', render: (r) => (r.decided_by ? `${esc(r.decided_by)}<div class="muted small">${when(r.decided_at)}</div>` : '') } : null,
  ].filter(Boolean);
}

// Runs an action on one or more requests; returns true when something changed
export async function runAction(action, rows, ctx) {
  const a = ACTIONS[action];
  const ids = rows.map((r) => r.id);
  const what = rows.length === 1 ? `request ${rows[0].request_no}` : `${rows.length} requests`;
  if (action === 'delete') {
    const ok = await confirmDialog({ title: 'Delete requests', message: `Delete ${esc(what)} for good? This cannot be undone.`, confirmText: 'Delete', danger: true });
    if (!ok) return false;
    try {
      const res = await post('/requests/delete', { ids });
      toast(`${res.deleted} deleted${res.skipped ? `, ${res.skipped} skipped` : ''}.`);
      return res.deleted > 0;
    } catch (err) { toast(err.message, 'error'); return false; }
  }
  const ok = await confirmDialog({
    title: a.label, message: `${a.label} ${esc(what)}?`, confirmText: a.label, danger: a.cls.includes('danger'), remark: a.remark,
  });
  if (!ok) return false;
  try {
    const res = await post('/requests/decide', { ids, status: a.status, remark: ok.remark });
    if (res.updated) toast(`${res.updated} request${res.updated === 1 ? '' : 's'} ${a.status.toLowerCase()}.`);
    if (res.skipped.length) toast(res.skipped.map((s) => `${s.request_no}: ${s.reason}`).join(' '), 'error');
    if (ctx.refreshBadge) ctx.refreshBadge();
    return res.updated > 0;
  } catch (err) { toast(err.message, 'error'); return false; }
}

export function showDetails(r, ctx, onChange) {
  const tz = ctx.state.settings.timezone;
  const line = (k, v) => (v || v === 0 ? `<div class="kv"><span>${esc(k)}</span><div>${v}</div></div>` : '');
  const actions = allowedActions(r, ctx.state.me);
  const m = openModal({
    title: `Request ${r.request_no}`,
    body: `<div class="details">
      ${line('Status', statusBadge(r.status))}
      ${line('Employee', `${esc(r.emp_name)} (${esc(r.emp_no)})`)}
      ${line('Department', esc(r.department || '-'))}
      ${line('Leave type', esc(r.leave_type))}
      ${line('When', esc(whenText(r)))}
      ${line('Days / hours', esc(daysText(r)))}
      ${line('Reason', esc(r.reason))}
      ${line('Remark', esc(r.remark))}
      ${line('Decided by', r.decided_by ? `${esc(r.decided_by)} · ${esc(fmtDateTime(r.decided_at, tz))}` : '')}
      ${line('Submitted', esc(fmtDateTime(r.submitted_at, tz)))}
      ${r.notes ? line('System notes', `<span class="small muted">${esc(r.notes)}</span>`) : ''}
    </div>
    ${actions.length ? `<div class="modal-actions">${actions.map((a) => `<button class="btn ${ACTIONS[a].cls}" data-action="${a}">${ACTIONS[a].label}</button>`).join('')}</div>` : ''}`,
  });
  m.el.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
    m.close();
    if (await runAction(b.dataset.action, [r], ctx) && onChange) onChange();
  }));
}

// Opens the detail dialog when the request number is clicked
export function wireOpen(root, rows, ctx, onChange) {
  root.querySelectorAll('tr[data-index] [data-open]').forEach((btn) => btn.addEventListener('click', () => {
    showDetails(rows[Number(btn.closest('tr').dataset.index)], ctx, onChange);
  }));
}
