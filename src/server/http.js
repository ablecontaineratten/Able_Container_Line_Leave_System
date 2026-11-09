// HTTP helpers shared by every route

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fail(status, message) {
  throw new HttpError(status, message);
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// JSON with several Set-Cookie headers (a headers object can only hold one)
export function withCookies(body, cookies) {
  const res = json(body);
  for (const k of cookies) res.headers.append('set-cookie', k);
  return res;
}

export function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    fail(400, 'The request body is not valid JSON.');
  }
}

export function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

export function cookie(name, value, { maxAge, secure }) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    maxAge === null ? '' : `Max-Age=${maxAge}`, // null = until the browser is closed
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

// Blocks form / fetch posts that come from another website
export function checkOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' && new URL(origin).host !== url.host) fail(403, 'Request from another site was blocked.');
}
