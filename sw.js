// الصفحات بتتجاب من النت لو متاح (عشان التحديثات توصل) وإلا من الكاش
const CACHE_NAME = 'ali-farag-app-v2';
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('ali-farag-app-') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // طلبات السيرفر (المزامنة والمساعد الذكي) والتطبيق اللي له كاش خاص بيه تعدي مباشرة
  if (url.pathname.startsWith('/api/') || url.pathname === '/ai' || url.pathname.startsWith('/grades/')) return;

  event.respondWith(
    fetch(req).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      }
      return response;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
