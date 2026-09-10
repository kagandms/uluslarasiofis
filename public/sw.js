const CACHE_NAME = 'ikamet-cache-v9';

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

  // Eklenti paketleri sürüm güncellendiğinde eski ZIP'in tekrar indirilmemesi
  // gerekir. Bu dosyaları her zaman ağdan al; yalnızca çevrimdışıyken son
  // başarılı indirmeyi geri ver.
  if (url.pathname.startsWith('/downloads/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // /src/ modülleri ve uygulama kodları için: Ağ Öncelikli (Network First) Stratejisi
  // Böylece kod güncellemeleri anında kullanıcının ekranına yansır, internet kesilirse önbelleğe döner.
  if (url.pathname.startsWith('/src/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Statik varlıklar için: Stale-While-Revalidate Stratejisi
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
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

      return cachedResponse || fetchPromise;
    })
  );
});
