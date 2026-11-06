// Work From Home / Onsite requests (not leave): shared bits for the admin page, the phone view and the calendar
import { post } from '../api.js';
import { confirmDialog, esc, fmtDate, toast } from '../ui.js';

export const WORK_TYPES = ['Work From Home', 'Onsite'];
export const workKey = (type) => (type === 'Onsite' ? 'onsite' : 'wfh');
export const workEmoji = (type) => (type === 'Onsite' ? '📍' : '🏠');
export const workLabel = (r) => `${r.work_type}${r.location ? ` · ${r.location}` : ''}`;

// "06 Nov 2026", "06 Nov 2026 → 09 Nov 2026" (days in a row) or "06 Nov 2026, 10 Nov 2026" (separate dates)
export function workWhen(r) {
  const list = String(r.dates || '').split(',').filter(Boolean);
  if (r.mode === 'range' && r.from_date !== r.to_date) return `${fmtDate(r.from_date)} → ${fmtDate(r.to_date)}`;
  return list.length > 1 ? list.map(fmtDate).join(', ') : fmtDate(r.from_date);
}

export const workTag = (r) => `<span class="work-tag ${workKey(r.work_type)}">${workEmoji(r.work_type)} ${esc(r.work_type)}</span>`;

const ACTIONS = {
  approve: { label: 'Approve', status: 'Approved', remark: true },
  reject: { label: 'Reject', status: 'Rejected', remark: true, danger: true },
  cancel: { label: 'Cancel', status: 'Cancelled', remark: true, danger: true },
};

// Approve / Reject / Cancel one or many; true when something changed
export async function decideWork(action, rows, ctx) {
  const a = ACTIONS[action];
  const what = rows.length === 1 ? `${rows[0].work_type} request ${rows[0].request_no} (${rows[0].emp_name})` : `${rows.length} requests`;
  const ok = await confirmDialog({ title: `${a.label} request`, message: `${a.label} ${esc(what)}?`, confirmText: a.label, danger: !!a.danger, remark: a.remark });
  if (!ok) return false;
  try {
    const res = await post('/work/decide', { ids: rows.map((r) => r.id), status: a.status, remark: ok.remark });
    if (res.updated) toast(`${res.updated} request${res.updated === 1 ? '' : 's'} ${a.status.toLowerCase()}.`);
    if (res.skipped.length) toast(res.skipped.map((s) => `${s.request_no}: ${s.reason}`).join(' '), 'error');
    if (ctx && ctx.refreshBadge) ctx.refreshBadge();
    return res.updated > 0;
  } catch (err) { toast(err.message, 'error'); return false; }
}
