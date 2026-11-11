// يشتغل من غير نت: الصفحة بتتجاب من النت لو متاح (عشان التحديثات) وإلا من الكاش
const CACHE = 'ali-grades-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './firebase-config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('ali-grades-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // الكاش للتطبيق نفسه والخطوط ومكتبة Firebase بس؛ طلبات السيرفر (Firestore/Auth) تعدي مباشرة
  const cacheable = url.origin === self.location.origin ||
    /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) ||
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
  if (!cacheable) return;

  // ملفات التطبيق: من النت الأول (عشان التحديثات) ولو مفيش نت من الكاش
  if (url.origin === self.location.origin) {
    const key = req.mode === 'navigate' ? './index.html' : req;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
        return res;
      }).catch(() => caches.match(key))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
