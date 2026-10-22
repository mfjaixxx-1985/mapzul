const CACHE = 'mtm-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('tile.openstreetmap.org')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }).catch(() => caches.match(e.request))));
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});