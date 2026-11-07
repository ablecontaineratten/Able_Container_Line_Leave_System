// API entry: matches the URL to a route, checks the session and permission, returns JSON
import { checkOrigin, HttpError, json } from './http.js';
import { loadSession } from './auth.js';
import { requirePerm } from './permissions.js';
import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import peopleRoutes from './routes/people.js';
import configRoutes from './routes/config.js';
import formRoutes from './routes/form.js';
import portalRoutes from './routes/portal.js';
import notifyRoutes from './routes/notify.js';
import summaryRoutes from './routes/summary.js';
import usageRoutes from './routes/usage.js';
import workRoutes from './routes/work.js';
import backupRoutes, { autoSync } from './routes/backup.js';
import lateRoutes from './routes/late.js';

// route options: auth (true | false | 'optional'), perm (key or list), allowMustChange
const routes = [...authRoutes, ...requestRoutes, ...peopleRoutes, ...configRoutes, ...formRoutes, ...portalRoutes, ...notifyRoutes, ...summaryRoutes, ...usageRoutes, ...workRoutes, ...backupRoutes, ...lateRoutes].map((r) => {
  const keys = [];
  const pattern = r.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { ...r, regex: new RegExp(`^${pattern}/?$`), keys };
});

// requests that change nothing worth backing up (sign in / out, notifications, photos, passwords, the backup itself)
const NO_BACKUP = /^\/api\/(backup|auth\/|push|notifications|portal\/(login|logout|password|photo|notifications|push))/;

function match(method, pathname) {
  let pathFound = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    pathFound = true;
    if (r.method !== method) continue;
    return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  throw new HttpError(pathFound ? 405 : 404, pathFound ? 'Method not allowed.' : 'Not found.');
}

export async function handleApi(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  try {
    if (!env.DB) throw new HttpError(500, 'The database is not connected (binding "DB" is missing). See GUIDE.md, step 4.');
    if (request.method !== 'GET' && request.method !== 'HEAD') checkOrigin(request, url);
    const { route, params } = match(request.method, url.pathname);
    const c = {
      env, request, url, params, query: url.searchParams, origin: url.origin, me: null,
      waitUntil: (promise) => context.waitUntil(promise),
    };
    if (route.auth !== false) {
      c.me = await loadSession(env, request);
      if (!c.me && route.auth !== 'optional') throw new HttpError(401, 'Please sign in.');
      if (c.me && c.me.mustChange && !route.allowMustChange && route.auth !== 'optional') throw new HttpError(403, 'Please change your password first.');
      if (route.perm) requirePerm(c.me, route.perm);
    }
    const out = await route.handler(c);
    // something changed (saved / decided / deleted): refresh the Google Sheet backup in the background
    if (request.method !== 'GET' && request.method !== 'HEAD' && !NO_BACKUP.test(url.pathname) && !(out instanceof Response && !out.ok)) {
      context.waitUntil(autoSync(env));
    }
    return out instanceof Response ? out : json(out ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    const hint = /no such table/i.test(String(err && err.message)) ? ' The database tables are missing - run the migrations (GUIDE.md).' : '';
    return json({ error: `Something went wrong on the server.${hint}` }, 500);
  }
}
