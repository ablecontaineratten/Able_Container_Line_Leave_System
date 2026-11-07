// Sending email (Resend) and the email / page templates
import { esc, fmtDate, isEmail } from './utils.js';

// Email is on when one of these is set in Cloudflare (first one wins):
//   GOOGLE_MAIL_URL + GOOGLE_MAIL_SECRET  -> Google Sheet / Apps Script sends with Gmail (google_email_services/)
//   BREVO_API_KEY                         -> Brevo
//   RESEND_API_KEY                        -> Resend
const googleMail = (env) => !!(env.GOOGLE_MAIL_URL && env.GOOGLE_MAIL_SECRET);
export const emailEnabled = (env) => !!(googleMail(env) || env.BREVO_API_KEY || env.RESEND_API_KEY);
export const emailServiceName = (env) => (googleMail(env) ? 'Google (Gmail)' : env.BREVO_API_KEY ? 'Brevo' : env.RESEND_API_KEY ? 'Resend' : '');

// Google Apps Script web app (google_email_services/Code.gs). Google answers the POST with a redirect to the result.
async function sendWithGoogle(env, settings, list, subject, html, replyTo) {
  const sender = parseSender(env.EMAIL_FROM || settings.email_from, `${settings.company_name} Leave`);
  try {
    const res = await fetch(env.GOOGLE_MAIL_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },          // keeps Google from asking for a preflight
      body: JSON.stringify({
        secret: env.GOOGLE_MAIL_SECRET, to: list, subject, html,
        name: sender ? sender.name : `${settings.company_name} Leave`, replyTo: isEmail(replyTo) ? replyTo : '',
      }),
      redirect: 'follow',
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON = Google error page */ }
    if (data && data.ok) return `sent to ${list.join(', ')}`;
    return `FAILED to ${list.join(', ')} (Google: ${(data && data.error) || `${res.status} ${text.slice(0, 120)}`})`;
  } catch (err) {
    return `FAILED to ${list.join(', ')} (${err.message})`;
  }
}

// "Company Leave <leave@company.com>" -> { name, email }
function parseSender(text, fallbackName) {
  const s = String(text || '').trim();
  const m = /^(.*)<\s*([^>\s]+@[^>\s]+)\s*>$/.exec(s);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || fallbackName, email: m[2] };
  return isEmail(s) ? { name: fallbackName, email: s } : null;
}

// Sends one email and writes it to email_log (for the Usage page). Returns a short text for the request notes.
export async function sendEmail(env, settings, msg) {
  const result = await deliverEmail(env, settings, msg);
  const list = [].concat(msg.to || []).map((x) => String(x).trim().toLowerCase()).filter(isEmail);
  if (list.length && env.DB) {
    const status = result.startsWith('sent') ? 'sent' : result.startsWith('FAILED') ? 'failed' : 'off';
    try {
      await env.DB.prepare('INSERT INTO email_log (to_addr, subject, status, provider, detail) VALUES (?, ?, ?, ?, ?)')
        .bind(list.join(', '), String(msg.subject || '').slice(0, 250), status, emailServiceName(env), status === 'sent' ? '' : result.slice(0, 300)).run();
    } catch (err) { console.log(`email log failed: ${err.message}`); }       // the log must never stop an email
  }
  return result;
}

async function deliverEmail(env, settings, { to, subject, html, replyTo }) {
  const list = [...new Set([].concat(to || []).map((x) => String(x).trim().toLowerCase()).filter(isEmail))];
  if (!list.length) return 'not sent (no valid email)';
  if (!emailEnabled(env)) {
    console.log(`[email not sent - email is not set up] To: ${list.join(', ')} | ${subject}`);
    return `not sent to ${list.join(', ')} (email is not set up)`;
  }
  if (googleMail(env)) return sendWithGoogle(env, settings, list, subject, html, replyTo);
  const senderText = env.EMAIL_FROM || settings.email_from;
  if (env.BREVO_API_KEY) {
    const sender = parseSender(senderText, `${settings.company_name} Leave`);
    if (!sender) return `not sent to ${list.join(', ')} (set the email sender in Settings → General)`;
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender, to: list.map((email) => ({ email })), subject, htmlContent: html,
          replyTo: isEmail(replyTo) ? { email: replyTo } : undefined,
        }),
      });
      if (res.ok) return `sent to ${list.join(', ')}`;
      return `FAILED to ${list.join(', ')} (${res.status}: ${(await res.text()).slice(0, 150)})`;
    } catch (err) {
      return `FAILED to ${list.join(', ')} (${err.message})`;
    }
  }
  const from = senderText || `${settings.company_name} Leave <onboarding@resend.dev>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: list, subject, html, reply_to: isEmail(replyTo) ? replyTo : undefined }),
    });
    if (res.ok) return `sent to ${list.join(', ')}`;
    return `FAILED to ${list.join(', ')} (${res.status}: ${(await res.text()).slice(0, 150)})`;
  } catch (err) {
    return `FAILED to ${list.join(', ')} (${err.message})`;
  }
}

export function nowText(settings) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function layout(settings, inner) {
  const color = esc(settings.brand_color || '#28398A');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a2333;max-width:660px;margin:0 auto">
    <div style="background:${color};color:#fff;padding:14px 20px;border-radius:8px 8px 0 0;border-bottom:4px solid #CF2830;font-weight:bold">${esc(settings.company_name)} &middot; Leave and Shift Management System</div>
    <div style="border:1px solid #dce1ea;border-top:0;padding:20px;border-radius:0 0 8px 8px;background:#fff">${inner}</div>
  </div>`;
}

export function button(url, label, bg) {
  return `<a href="${esc(url)}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:bold;padding:11px 26px;border-radius:6px;margin-right:8px">${esc(label)}</a>`;
}

export function infoTable(pairs) {
  const td = 'padding:7px 12px;border:1px solid #e4e8ef;vertical-align:top';
  return `<table style="border-collapse:collapse;margin:10px 0;font-size:14px">${pairs.filter(Boolean).map(([k, v]) =>
    `<tr><td style="${td};background:#f6f8fb;width:150px">${esc(k)}</td><td style="${td}">${esc(v)}</td></tr>`).join('')}</table>`;
}

// One request (one or more rows with the same group_no) as text
export function whenText(rows) {
  if (rows.length > 1) {
    const days = rows.reduce((n, r) => n + Number(r.days || 0), 0);
    return `${rows.map((r) => fmtDate(r.from_date)).join(', ')} (${days} working day${days === 1 ? '' : 's'})`;
  }
  const r = rows[0];
  if (r.day_type === 'Short Leave') {
    const time = r.out_time && r.return_time ? `${r.out_time} to ${r.return_time}` : r.out_time ? `from ${r.out_time}` : '';
    return `${fmtDate(r.from_date)} (Short Leave${time ? ` ${time}` : ''}${r.hours ? `, ${r.hours} h` : ''})`;
  }
  if (r.from_date !== r.to_date) return `${fmtDate(r.from_date)} to ${fmtDate(r.to_date)} (${r.days} working day${r.days === 1 ? '' : 's'})`;
  return `${fmtDate(r.from_date)} (${r.day_type})`;
}

export function balanceTable(sum) {
  if (!sum) return '';
  const td = 'border:1px solid #9db3d9;padding:5px 10px';
  const c = (v) => `<td style="${td};text-align:center">${esc(v)}</td>`;
  const rows = sum.types.map((x) => {
    if (x.is_short && sum.shortMonth) {
      const m = sum.shortMonth;
      return `<tr><td style="${td}">${esc(x.type)} (${esc(m.label)})</td>${c(m.used)}${c(m.pending)}${c(`${Math.max(m.limit - m.used - m.pending, 0)} of ${m.limit}`)}</tr>`;
    }
    return `<tr><td style="${td}">${esc(x.type)}</td>${c(x.used)}${c(x.pending)}${c(x.left === null ? '-' : x.left)}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;font-size:13px;background:#eef3fb">
    <tr style="background:#4472c4;color:#fff"><th style="${td}">Leave type</th><th style="${td}">Approved</th><th style="${td}">Pending</th><th style="${td}">Balance</th></tr>
    ${rows}
    <tr style="font-weight:bold"><td style="${td}">Total (${esc(sum.pool)} days / year)</td>${c(sum.used)}${c(sum.pending)}${c(sum.left)}</tr>
  </table>
  <p style="font-size:11px;color:#666;margin:4px 0 0">Balance = days per year - approved - pending (leave year ${fmtDate(sum.year.start)} onwards).</p>`;
}

// The company's paper "Leave Application Form"
export function letter(settings, types, rows, sum, warnings) {
  const r = rows[0];
  const typeLine = types.filter((t) => t.active || t.name === r.leave_type).map((t) =>
    t.name === r.leave_type ? `<span style="background:#ffff00;font-weight:bold">${esc(t.name)}</span>` : esc(t.name)).join(' / ');
  const line = (k, v) => `<tr><td style="padding:3px 16px 3px 0">${k}</td><td>: ${v}</td></tr>`;
  return `<div style="border:1px solid #bbb;padding:18px 22px;margin:12px 0;background:#fff;color:#000">
    <p style="text-align:center;font-weight:bold;text-decoration:underline;font-size:16px;margin:0 0 6px">${esc(settings.company_name)}</p>
    <p style="text-align:center;font-size:15px;margin:0 0 16px">Leave Application Form</p>
    <p>The Manager,<br>${esc(r.department || '-')}</p>
    <p>Date : ${fmtDate(String(r.submitted_at).slice(0, 10))}</p>
    <p>Dear Sir / Madam,</p>
    <p>I wish to avail myself of ${typeLine} on the undermentioned days.<br><b>${esc(whenText(rows))}</b></p>
    <table style="font-size:14px">${line('Name of Applicant', `<b>${esc(r.emp_name)}</b>`)}${line('Employee No', esc(r.emp_no))}${r.reason ? line('Reason', esc(r.reason)) : ''}</table>
    ${warnings && warnings.length ? `<p style="color:#c00;font-size:13px"><b>Auto check:</b> ${esc(warnings.join(' '))}</p>` : ''}
    ${sum ? `<p style="margin:14px 0 4px"><b>Leave Availed / Balance</b> ("Pending" includes this request)</p>${balanceTable(sum)}` : ''}
  </div>`;
}

// Full HTML page (used by the Approve / Reject email links)
export function page(settings, title, body) {
  const color = esc(settings.brand_color || '#28398A');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f3f5f9;color:#1a2333;line-height:1.5}
    .top{background:${color};color:#fff;padding:24px 16px 64px;border-bottom:5px solid #CF2830}.in{max-width:620px;margin:0 auto;font-weight:700}
    .card{max-width:620px;margin:-44px auto 32px;background:#fff;border:1px solid #dce1ea;border-radius:14px;padding:24px}
    h1{font-size:22px;margin:0 0 12px}textarea{width:100%;min-height:80px;border:1px solid #cfd6e2;border-radius:8px;padding:10px;font:inherit}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:8px;padding:12px 26px;font:inherit;font-weight:700;color:#fff;cursor:pointer}
    .ok{background:#1e7e34}.no{background:#c62828}.muted{color:#667085;font-size:13px}@media(max-width:480px){.card{margin:-44px 16px 24px}}
  </style></head><body><div class="top"><div class="in">${esc(settings.company_name)} &middot; Leave and Shift Management System</div></div>
  <main class="card"><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
