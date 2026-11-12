// يشتغل من غير نت: الصفحة بتتجاب من النت لو متاح (عشان التحديثات) وإلا من الكاش
const CACHE = 'ali-grades-v5';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

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
  // الكاش لملفات التطبيق والخطوط بس؛ طلبات سيرفر المزامنة (/api/) تعدي مباشرة
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  const cacheable = url.origin === self.location.origin || /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!cacheable) return;

  // ملفات التطبيق: بتفتح فورًا من الموبايل، والتحديث بيتحمل في الخلفية ويظهر المرة الجاية
  if (url.origin === self.location.origin) {
    const key = req.mode === 'navigate' ? './index.html' : req;
    const fresh = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    });
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(caches.match(key).then((hit) => hit || fresh));
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
