const CACHE_NAME = 'sentry-app-v12';
const ASSETS = [
  './',
  './index.html',
  './config.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// مهم: نضيف كل ملف على حدة بدل cache.addAll حتى لو فشل تحميل ملف واحد
// (مثلاً أيقونة مفقودة)، باقي الملفات الأساسية (index/app.js) تتخزن
// بنجاح والتطبيق يفضل يفتح أوفلاين. addAll القديمة كانت تفشل بالكامل
// لو أي ملف واحد مش موجود = صفر تخزين أوفلاين.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        ASSETS.map((url) =>
          fetch(url)
            .then((res) => { if (res.ok) return cache.put(url, res); })
            .catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // سيب أي طلبات غير GET تعدي عادي
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return fetch(e.request).then((res) => {
        // نخزن الردود الناجحة، وكذلك الردود "opaque" (مكتبات من CDN خارجي
        // زي مكتبة Excel) عشان تشتغل أوفلاين بعد أول استخدام لها بالنت
        if (res.ok || res.type === 'opaque') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return res;
      }).catch(() => cached || Promise.reject('offline-no-cache'));
    })
  );
});
