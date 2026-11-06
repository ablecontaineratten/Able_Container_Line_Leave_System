// Service worker: shows phone notifications for the Leave System.
// A push has no text in it; the worker asks the server what to show (only the signed-in person's notifications).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let items = [];
    try {
      const res = await fetch('/api/notifications/pending', { credentials: 'include', cache: 'no-store' });
      if (res.ok) items = (await res.json()).items || [];
    } catch { /* offline: show the general message */ }
    if (!items.length) items = [{ id: 0, title: 'Leave System', body: 'You have a new notification.', url: '/' }];
    await Promise.all(items.map((n) => self.registration.showNotification(n.title, {
      body: n.body,
      icon: '/img/icon-192.png',
      tag: `lms-${n.id}`,               // the same notification replaces itself instead of showing twice
      data: { url: n.url || '/' },
    })));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = url.split('#')[0];
    for (const w of wins) {
      if (w.url.split('#')[0] === page && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) await w.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
