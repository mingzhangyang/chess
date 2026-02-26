const CACHE_VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `cloud-chess-pwa-${CACHE_VERSION}`;
const APP_SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/logo.svg', '/move-self.mp3'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseClone));
          return response;
        })
        .catch(async () => {
          const cachedShell = await caches.match('/index.html');
          return cachedShell || Response.error();
        }),
    );
    return;
  }

  const shouldCache =
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'worker' ||
    request.destination === 'font' ||
    request.destination === 'audio' ||
    request.destination === 'image' ||
    url.pathname.startsWith('/assets/');

  if (!shouldCache) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => cached || Response.error());
    }),
  );
});
