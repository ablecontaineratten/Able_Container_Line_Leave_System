// Usage (Super admin): emails sent and Cloudflare usage against the free limits
import { get } from '../api.js';
import { addDays, esc, fmtDate, fmtDateTime, pageHead, tableHtml } from '../ui.js';

const num = (n) => Number(n || 0).toLocaleString('en-US');
const size = (b) => (b === null || b === undefined ? '-' : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
const dm = (d) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

// Single-series daily bar chart (last 30 days). Each bar has a tooltip; the table view is the list below the page.
function barChart(title, days, value, today, unit) {
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i);
    const row = days.find((x) => (x.day || x.date) === d);
    series.push({ d, v: row ? Number(value(row)) || 0 : 0 });
  }
  const max = Math.max(1, ...series.map((s) => s.v));
  const total = series.reduce((n, s) => n + s.v, 0);
  return `<div class="u-chart">
    <div class="u-chart-head"><h3>${esc(title)}</h3><span class="muted small">${num(total)} ${esc(unit)} in 30 days · max ${num(max)}/day</span></div>
    <div class="u-bars" role="img" aria-label="${esc(title)}">
      ${series.map((s) => `<div class="u-bar" tabindex="0" style="--h:${(s.v / max) * 100}%">
        <i></i><span class="u-tip"><b>${num(s.v)}</b> ${esc(unit)}<br>${esc(fmtDate(s.d))}</span></div>`).join('')}
    </div>
    <div class="u-axis"><span>${dm(series[0].d)}</span><span>${dm(series[15].d)}</span><span>Today</span></div>
  </div>`;
}

function meter(label, used, limit, fmt = num) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const level = pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : '';
  return `<div class="u-meter">
    <div class="u-meter-top"><span>${esc(label)}</span><b>${fmt(used)} <small>of ${fmt(limit)}</small></b></div>
    <div class="u-track"><span class="${level}" style="width:${Math.max(pct, used ? 1 : 0).toFixed(1)}%"></span></div>
    <small class="muted">${pct < 0.1 && used ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}% used${level ? (level === 'critical' ? ' · ⚠ almost full' : ' · getting high') : ''}</small>
  </div>`;
}

export default async function render(view, ctx) {
  const d = await get('/usage');
  if (!ctx.isCurrent()) return;
  const { email, database, cloudflare, limits, today } = d;
  const t = email.totals;
  const tz = ctx.state.settings.timezone;
  const cfToday = cloudflare.days && cloudflare.days.find((x) => x.date === today);

  view.innerHTML = `${pageHead('Usage', '', '<button class="btn" id="refresh">Refresh</button>')}

    <h2 class="u-h2">✉ Email</h2>
    <div class="u-tiles">
      <div class="u-tile"><span>Sent today</span><b>${num(t.today)}</b>${email.remainingToday !== null ? `<small>${num(email.remainingToday)} left today (Gmail)</small>` : ''}</div>
      <div class="u-tile"><span>Sent this month</span><b>${num(t.month)}</b></div>
      <div class="u-tile"><span>Failed (30 days)</span><b class="${t.failed30 ? 'neg' : ''}">${num(t.failed30)}</b></div>
      <div class="u-tile"><span>Email service</span><b class="u-small">${esc(email.service || 'Off')}</b><small>${email.service ? 'Connected' : 'Not connected'}</small></div>
    </div>
    <section class="card">${barChart('Emails sent per day', email.byDay, (r) => r.sent, today, 'emails')}</section>
    <section class="card">
      <div class="card-head"><h2>Latest emails</h2></div>
      ${tableHtml([
        { label: 'Time', render: (r) => `<span class="small">${esc(fmtDateTime(r.sent_at, tz))}</span>` },
        { label: 'To', render: (r) => `<span class="small">${esc(r.to_addr)}</span>` },
        { label: 'Subject', render: (r) => `<span class="small">${esc(r.subject)}</span>` },
        { label: 'Status', render: (r) => `<span class="badge ${r.status === 'sent' ? 'badge-approved' : r.status === 'failed' ? 'badge-rejected' : 'badge-cancelled'}">${r.status === 'sent' ? 'Sent' : r.status === 'failed' ? 'Failed' : 'Not sent'}</span>${r.detail ? `<div class="muted small">${esc(r.detail)}</div>` : ''}` },
      ], email.recent, { empty: 'No emails logged yet (emails are logged from now on).' })}
    </section>

    <h2 class="u-h2">☁ Cloudflare (free plan)</h2>
    <section class="card u-meters">
      ${meter('Database size', database.sizeBytes || 0, limits.storageBytes, size)}
      ${cfToday ? meter('Requests today', cfToday.requests, limits.requestsPerDay) : ''}
      ${cfToday ? meter('Database rows read today', cfToday.rowsRead, limits.rowsReadPerDay) : ''}
      ${cfToday ? meter('Database rows written today', cfToday.rowsWritten, limits.rowsWrittenPerDay) : ''}
      <div class="u-counts">${[['Leave requests', database.counts.requests], ['Employees', database.counts.employees], ['Login accounts', database.counts.accounts],
        ['Notifications', database.counts.notifications], ['Emails logged', database.counts.emails]].map(([k, v]) => `<div><b>${num(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
    </section>
    ${cloudflare.days ? `<section class="card">${barChart('Requests per day (website + API)', cloudflare.days, (r) => r.requests, today, 'requests')}</section>
      <section class="card">${barChart('Database rows read per day', cloudflare.days, (r) => r.rowsRead, today, 'rows')}</section>`
      : cloudflare.error ? `<div class="notice">Cloudflare analytics could not be read: ${esc(cloudflare.error)}</div>`
      : `<div class="notice"><b>Daily requests and database reads/writes</b> need a read-only Cloudflare token:
          in Cloudflare go to <b>My Profile → API Tokens → Create Token → Custom token</b>, permission <b>Account → Account Analytics → Read</b>,
          then add it in the Pages project as a <b>Secret</b> named <code>CF_API_TOKEN</code> and retry the deployment.</div>`}`;

  view.querySelector('#refresh').addEventListener('click', () => render(view, ctx));
}
