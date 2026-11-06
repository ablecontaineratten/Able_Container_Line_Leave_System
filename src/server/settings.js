// Company settings (key / value table)
import { all, batch, stmt } from './db.js';
import { fail } from './http.js';
import { clean, isEmail, isTimeZone } from './utils.js';

export const SETTING_DEFAULTS = {
  company_name: 'My Company',
  timezone: 'Asia/Colombo',
  year_start: '01-01',        // MM-DD the leave year starts
  weekend: '0,6',             // 0 = Sunday ... 6 = Saturday
  pool_days: '',              // total days per year; empty = sum of the leave types that count in the total
  no_balance: 'reject',       // reject | warn
  short_per_month: '2',       // short leaves per month; empty = days_per_year of the short leave type
  copy_emails: '',            // copy of every Approved / Cancelled email
  app_url: '',                // used in email links; empty = the address the app is opened from
  email_from: '',             // sender; the EMAIL_FROM variable wins when set
  brand_color: '#28398A',
  logo_url: '',
  form_url: '',               // the Google Form employees use (shown in "request not sent" emails)
};

export async function getSettings(env) {
  const rows = await all(env, 'SELECT key, value FROM settings');
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out;
}

export function weekendSet(settings) {
  return new Set(String(settings.weekend || '').split(',').filter((x) => x !== '').map(Number));
}

export function publicSettings(s) {
  return {
    company_name: s.company_name, timezone: s.timezone, year_start: s.year_start, weekend: s.weekend,
    no_balance: s.no_balance, brand_color: s.brand_color, logo_url: s.logo_url,
  };
}

const RULES = {
  company_name: (v) => (v && v.length <= 100) || 'Company name is required (max 100 characters).',
  timezone: (v) => isTimeZone(v) || 'Time zone is not valid (example: Asia/Colombo).',
  year_start: (v) => {
    const m = /^(\d{2})-(\d{2})$/.exec(v);
    return (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 28) || 'Leave year start must be MM-DD (day 01-28).';
  },
  weekend: (v) => v === '' || /^[0-6](,[0-6])*$/.test(v) || 'Weekend days are not valid.',
  pool_days: (v) => v === '' || (Number(v) >= 0 && Number(v) <= 366) || 'Total days per year must be a number.',
  no_balance: (v) => ['reject', 'warn'].includes(v) || 'Choose reject or warn.',
  short_per_month: (v) => v === '' || (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 31) || 'Short leaves per month must be a whole number.',
  copy_emails: (v) => v.split(/[,;\s]+/).filter(Boolean).every(isEmail) || 'Copy emails: one or more valid emails, comma separated.',
  app_url: (v) => v === '' || /^https?:\/\/[^\s]+$/.test(v) || 'App URL must start with https://',
  email_from: (v) => v.length <= 200 || 'Sender is too long.',
  brand_color: (v) => /^#[0-9a-f]{6}$/i.test(v) || 'Color must look like #0B3B8C.',
  logo_url: (v) => v === '' || /^https:\/\/[^\s]+$/.test(v) || 'Logo must be an https:// image link.',
  form_url: (v) => v === '' || /^https:\/\/[^\s]+$/.test(v) || 'Form link must start with https://',
};

export async function saveSettings(env, input) {
  const updates = [];
  for (const [key, rule] of Object.entries(RULES)) {
    if (!(key in input)) continue;
    let value = clean(input[key]);
    if (key === 'app_url') value = value.replace(/\/+$/, '');
    const ok = rule(value);
    if (ok !== true) fail(400, ok);
    updates.push(stmt(env, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value));
  }
  await batch(env, updates);
  return getSettings(env);
}
