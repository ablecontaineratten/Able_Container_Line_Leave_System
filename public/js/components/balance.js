// Leave balance cards and table
import { esc, fmtDate } from '../ui.js';

export function balanceCards(sum) {
  if (!sum) return '';
  const cards = sum.types.map((t) => {
    if (t.is_short) {
      const m = sum.shortMonth;
      if (!m) return '';
      const left = Math.max(m.limit - m.used - m.pending, 0);
      return card(t.type, `${left}`, `of ${m.limit} left in ${m.label}`, m.limit ? (m.used + m.pending) / m.limit : 0);
    }
    if (t.left === null) return card(t.type, `${t.used}`, `day(s) taken${t.pending ? ` · ${t.pending} pending` : ''}`, null);
    return card(t.type, `${t.left}`, `of ${t.allowed} left${t.pending ? ` · ${t.pending} pending` : ''}`, t.allowed ? (t.used + t.pending) / t.allowed : 0);
  }).join('');
  return `<div class="balance-total">
      <div><span class="muted">Total balance</span><strong>${esc(sum.left)}</strong><span class="muted">of ${esc(sum.pool)} days</span></div>
      <div class="muted small">Leave year from ${esc(fmtDate(sum.year.start))} · ${esc(sum.used)} approved · ${esc(sum.pending)} pending</div>
    </div>
    <div class="balance-grid">${cards}</div>`;
}

function card(title, big, sub, ratio) {
  const pct = ratio === null ? null : Math.min(Math.max(ratio, 0), 1) * 100;
  return `<div class="bal-card"><span class="bal-title">${esc(title)}</span><strong>${esc(big)}</strong><span class="muted small">${esc(sub)}</span>
    ${pct === null ? '' : `<div class="meter"><span style="width:${pct.toFixed(0)}%" class="${pct >= 100 ? 'full' : pct >= 75 ? 'high' : ''}"></span></div>`}</div>`;
}
