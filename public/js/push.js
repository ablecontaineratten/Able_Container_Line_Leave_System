// Turning phone notifications on (shared by the admin app and the employee app)

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// 'on' | 'off' | 'denied' | 'unsupported' | 'ios-install' (iPhone: add to Home Screen first)
export async function pushState() {
  if (!pushSupported()) return isIos() && !isInstalled() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

export const PUSH_HELP = {
  'ios-install': 'On iPhone: tap Share → "Add to Home Screen", open the app from the Home Screen, then turn on notifications.',
  unsupported: 'This browser cannot show notifications. Please use Chrome (Android) or Safari from the Home Screen (iPhone).',
  denied: 'Notifications are blocked. Allow them for this site in the browser settings, then try again.',
};

// Must be called from a tap (browsers only ask for permission after a user action).
// subscribePath: '/api/push/subscribe' (admin app) or '/api/portal/push/subscribe' (employee app)
export async function enablePush(subscribePath) {
  const state = await pushState();
  if (PUSH_HELP[state]) throw new Error(PUSH_HELP[state]);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(PUSH_HELP.denied);
  await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await fetch('/api/push/key').then((r) => r.json());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const res = await fetch(subscribePath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error('Could not turn on notifications. Please try again.');
}

// When notifications are already on, tell the server again (links this phone to whoever is signed in now)
export async function resyncPush(subscribePath) {
  try {
    if ((await pushState()) !== 'on') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg.pushManager.getSubscription();
    await fetch(subscribePath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
  } catch { /* ignore */ }
}

// Stop notifications on this device (removes the subscription here and on the server)
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}

// "Notification settings" card (admin app): on / off for this device + send a test
export async function notificationSettings(box, { post, toast }) {
  const state = await pushState();
  box.innerHTML = `<section class="card notif-settings"><h2>Notification settings</h2>
    <p class="muted small">Phone / computer notifications for this device. Turn them on on every device where you want them.</p>
    ${state === 'on' ? `<p class="notif-status on">🔔 Notifications are <b>on</b> on this device</p>
        <div class="btn-row"><button class="btn" id="push-test" type="button">Send test notification</button>
        <button class="btn btn-danger" id="push-off" type="button">Turn off</button></div>`
      : PUSH_HELP[state] ? `<p class="notif-status">🔕 ${PUSH_HELP[state]}</p>`
      : `<p class="notif-status">🔕 Notifications are <b>off</b> on this device</p>
        <div class="btn-row"><button class="btn btn-primary" id="push-on" type="button">Turn on notifications</button></div>`}
  </section>`;
  const redraw = () => notificationSettings(box, { post, toast });
  const on = box.querySelector('#push-on');
  if (on) on.addEventListener('click', async () => {
    on.disabled = true;
    try { await enablePush('/api/push/subscribe'); toast('Notifications are on.'); redraw(); } catch (err) { toast(err.message, 'error'); on.disabled = false; }
  });
  const test = box.querySelector('#push-test');
  if (test) test.addEventListener('click', async () => {
    try { await resyncPush('/api/push/subscribe'); const r = await post('/push/test'); toast(`Test notification: ${r.result}.`); } catch (err) { toast(err.message, 'error'); }
  });
  const off = box.querySelector('#push-off');
  if (off) off.addEventListener('click', async () => {
    off.disabled = true;
    await disablePush().catch(() => {});
    toast('Notifications are off on this device.');
    redraw();
  });
}