// Usage page (Super admin): emails sent + Cloudflare usage (database size and counts; requests / reads / writes
// from Cloudflare's analytics when the CF_API_TOKEN secret is set).
import { all, first } from '../db.js';
import { emailServiceName } from '../email.js';
import { getSettings } from '../settings.js';
import { addDays, todayIn } from '../utils.js';

// Not secret: which Cloudflare account / database to read (can be overridden with variables of the same name)
const ACCOUNT_ID = '';        // set the CF_ACCOUNT_ID variable in Cloudflare
const D1_DATABASE_ID = '';    // set the CF_D1_DATABASE_ID variable in Cloudflare

// Free plan limits (Cloudflare Pages Functions / D1 free plan)
const LIMITS = { requestsPerDay: 100000, rowsReadPerDay: 5000000, rowsWrittenPerDay: 100000, storageBytes: 5 * 1024 ** 3 };

// The Google script's web app answers a GET with how many Gmail emails are left today
async function googleRemaining(env) {
  if (!env.GOOGLE_MAIL_URL) return null;
  try {
    const res = await fetch(env.GOOGLE_MAIL_URL, { redirect: 'follow' });
    const data = await res.json();
    return typeof data.remaining_today === 'number' ? data.remaining_today : null;
  } catch {
    return null;
  }
}

async function emailUsage(env, today) {
  const since = addDays(today, -29);
  const [byDay, recent, totals] = await Promise.all([
    all(env, `SELECT substr(sent_at, 1, 10) AS day, SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed
              FROM email_log WHERE sent_at >= ? GROUP BY day ORDER BY day`, since),
    all(env, 'SELECT sent_at, to_addr, subject, status, provider, detail FROM email_log ORDER BY id DESC LIMIT 25'),
    first(env, `SELECT COALESCE(SUM(status = 'sent' AND substr(sent_at, 1, 10) = ?), 0) AS today,
                       COALESCE(SUM(status = 'sent' AND substr(sent_at, 1, 7) = ?), 0) AS month,
                       COALESCE(SUM(status = 'failed' AND sent_at >= ?), 0) AS failed30,
                       COALESCE(SUM(status = 'sent'), 0) AS total FROM email_log`, today, today.slice(0, 7), since),
  ]);
  return { service: emailServiceName(env), byDay, recent, totals, remainingToday: await googleRemaining(env) };
}

async function databaseUsage(env) {
  const res = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM leave_requests) AS requests, (SELECT COUNT(*) FROM employees) AS employees,
    (SELECT COUNT(*) FROM users) AS accounts, (SELECT COUNT(*) FROM notifications) AS notifications, (SELECT COUNT(*) FROM email_log) AS emails`).all();
  return { counts: res.results[0], sizeBytes: res.meta && res.meta.size_after ? res.meta.size_after : null };
}

// Cloudflare GraphQL analytics (needs the CF_API_TOKEN secret with "Account Analytics: Read")
async function cloudflareUsage(env, today) {
  if (!env.CF_API_TOKEN) return { configured: false };
  const account = env.CF_ACCOUNT_ID || ACCOUNT_ID;
  const start = addDays(today, -29);
  const query = `query ($account: String!, $start: Date!, $end: Date!, $db: String!) {
    viewer { accounts(filter: { accountTag: $account }) {
      pages: pagesFunctionsInvocationsAdaptiveGroups(limit: 100, filter: { date_geq: $start, date_leq: $end }) {
        sum { requests errors } dimensions { date } }
      d1: d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $start, date_leq: $end, databaseId: $db }) {
        sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date } }
    } } }`;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { account, start, end: today, db: env.CF_D1_DATABASE_ID || D1_DATABASE_ID } }),
    });
    const data = await res.json();
    if (data.errors && data.errors.length) return { configured: true, error: data.errors.map((e) => e.message).join('; ').slice(0, 300) };
    const acc = data.data && data.data.viewer.accounts[0];
    if (!acc) return { configured: true, error: 'No data for this account (check CF_ACCOUNT_ID and the token).' };
    const days = {};
    const day = (d) => (days[d] = days[d] || { date: d, requests: 0, errors: 0, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 });
    (acc.pages || []).forEach((g) => { const x = day(g.dimensions.date); x.requests += g.sum.requests; x.errors += g.sum.errors; });
    (acc.d1 || []).forEach((g) => { const x = day(g.dimensions.date); x.rowsRead += g.sum.rowsRead; x.rowsWritten += g.sum.rowsWritten; x.readQueries += g.sum.readQueries; x.writeQueries += g.sum.writeQueries; });
    return { configured: true, days: Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1)) };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

async function usage(c) {
  const settings = await getSettings(c.env);
  const today = todayIn(settings.timezone);
  const [email, database, cloudflare] = await Promise.all([emailUsage(c.env, today), databaseUsage(c.env), cloudflareUsage(c.env, today)]);
  return { today, limits: LIMITS, email, database, cloudflare };
}

export default [
  { method: 'GET', path: '/api/usage', perm: 'access.edit', handler: usage },
];
