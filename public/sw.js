// QueueFlow service worker — push notifications only.
// Offline caching removed: it was intercepting real-URL navigation
// (e.g. /login, /dashboard) and breaking routing. Push notifications
// don't need caching or fetch interception at all, so this version
// only listens for push/notificationclick and does nothing else.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// No 'fetch' listener at all. Every request goes straight to the network,
// exactly as if there were no service worker. This is what makes
// "Failed to convert value to Response" impossible going forward — we
// never intercept or respond to navigation requests anymore.

self.addEventListener('push', (event) => {
  let payload = { title: 'QueueFlow', body: 'Update on your queue', tag: 'queue' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Not JSON; keep default.
  }
  const { title, body, tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag ?? 'queue',
      renotify: true,
      data: payload,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    }),
  );
});