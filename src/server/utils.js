// Plain helpers: text, email, dates ('YYYY-MM-DD' strings, no time zone surprises)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const clean = (s) => String(s ?? '').trim();
export const lower = (s) => clean(s).toLowerCase();
export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(s));
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const nowIso = () => new Date().toISOString();

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export const toUtc = (s) => new Date(`${s}T00:00:00Z`);
export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => ymd(new Date(toUtc(s).getTime() + n * 86400000));
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(toUtc(s)) && ymd(toUtc(s)) === s;
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));

// Today's date in the company time zone
export function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return ymd(new Date());
  }
}

export function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// 2026-10-26 -> 26 Oct 2026
export function fmtDate(s) {
  if (!isDate(s)) return String(s || '');
  return `${s.slice(8, 10)} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
}

export const monthName = (s) => MONTHS[Number(String(s).slice(5, 7)) - 1];

export function hoursBetween(a, b) {
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  return round2((h2 * 60 + m2 - h1 * 60 - m1) / 60);
}

// "Nuwan" matches "Nuwan Bandara"; case, dots and extra spaces do not matter
export function sameName(a, b) {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = n(a);
  const y = n(b);
  return !!x && !!y && (x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `));
}

export function parseEmails(text) {
  return [...new Set(String(text || '').split(/[,;\s]+/).map(lower).filter(isEmail))];
}
