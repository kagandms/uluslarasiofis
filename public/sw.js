const CACHE_NAME = 'ikamet-cache-v5';

const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icon.png',
  '/header_logo.jpg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // HTML, API veya POST isteklerini asla önbellekten verme (Her zaman doğrudan ağa git)
  if (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  // Geri kalan her şey için: Stale-While-Revalidate Stratejisi
  // (Önce hızlıca önbellekten ver, arka planda ağdan en yenisini indirip önbelleği güncelle)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Geçerli bir cevap geldiyse önbelleği güncelle
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // İnternet yoksa sessiz kal, cachedResponse dönecektir.
      });

      // Önbellekte varsa hemen onu dön, yoksa ağ isteğini bekle
      return cachedResponse || fetchPromise;
    })
  );
});
