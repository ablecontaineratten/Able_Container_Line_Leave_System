// Phone notifications with Web Push (no payload: the service worker fetches the text from /api/notifications/pending).
// The VAPID key pair is made automatically the first time and kept in the settings table - nothing to set up.
import { all, batch, run, stmt } from './db.js';

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = (s) => b64u(enc.encode(s));

export async function vapidKeys(env) {
  const read = async () => Object.fromEntries((await all(env,
    `SELECT key, value FROM settings WHERE key IN ('vapid_private_jwk', 'vapid_public')`)).map((r) => [r.key, r.value]));
  let m = await read();
  if (!m.vapid_private_jwk || !m.vapid_public) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
    await batch(env, [
      stmt(env, `INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_private_jwk', ?)`, privateJwk),
      stmt(env, `INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_public', ?)`, publicKey),
    ]);
    m = await read();                       // another request may have made them at the same time
  }
  return { privateJwk: JSON.parse(m.vapid_private_jwk), publicKey: m.vapid_public };
}

async function vapidHeader(keys, endpoint, subject) {
  const header = b64uText(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uText(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const { key_ops, ext, ...jwk } = keys.privateJwk;           // eslint-disable-line no-unused-vars
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

export async function saveSubscription(env, ownerType, ownerId, sub) {
  const endpoint = String((sub && sub.endpoint) || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw new Error('Not a valid push subscription.');
  const k = (sub && sub.keys) || {};
  await run(env, `INSERT INTO push_subscriptions (owner_type, owner_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint, owner_type, owner_id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ownerType, ownerId, endpoint, String(k.p256dh || ''), String(k.auth || ''));
}

// Saves the notification for each owner and wakes up their phones. Returns a short log text.
export async function notify(env, ownerType, ownerIds, { title, body = '', url = '/' }, baseUrl = '') {
  const ids = [...new Set(ownerIds.map(Number).filter(Boolean))];
  if (!ids.length) return 'no one to notify';
  await batch(env, ids.map((id) => stmt(env,
    'INSERT INTO notifications (owner_type, owner_id, title, body, url) VALUES (?, ?, ?, ?, ?)', ownerType, id, title, body, url)));
  const subs = await all(env, `SELECT id, endpoint FROM push_subscriptions WHERE owner_type = ? AND owner_id IN (${ids.map(() => '?').join(', ')})`,
    ownerType, ...ids);
  if (!subs.length) return `notification saved for ${ids.length} (no phone has notifications turned on)`;
  const keys = await vapidKeys(env);
  const subject = /^https:\/\//.test(baseUrl) ? baseUrl : 'mailto:leave-system@example.org';
  let sent = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { authorization: await vapidHeader(keys, s.endpoint, subject), ttl: '86400', urgency: 'high' },
        body: new Uint8Array(0),
      });
      if (res.status === 404 || res.status === 410) dead.push(s.id);
      else if (res.ok) sent++;
      else console.log(`push failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      console.log(`push error: ${err.message}`);
    }
  }));
  if (dead.length) await batch(env, dead.map((id) => stmt(env, 'DELETE FROM push_subscriptions WHERE id = ?', id)));
  return `phone notification sent to ${sent} device(s)`;
}
