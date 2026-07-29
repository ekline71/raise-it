self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch{}

  const title = data.title || 'The Hoist-O-Meter';
  const body = data.body || '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for(const client of clients){
        if('focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
