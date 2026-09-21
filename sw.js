const CACHE = 'kpractice-v14';
const DATA_CACHE = 'kpractice-data-v1';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/core.js',
  './js/persist.js',
  './js/charts.js',
  './js/journal.js',
  './js/trainer.js',
  './js/experience.js',
  './js/offline.js',
  './js/main.js',
  './vendor/lightweight-charts.standalone.production.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/catalog.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const dataCache = await caches.open(DATA_CACHE);
    const scope = new URL(self.registration.scope);
    // Preserve downloaded candles when upgrading the app shell.
    for (const key of keys.filter(k => /^kpractice-v\d+$/.test(k) && k !== CACHE)){
      const old = await caches.open(key);
      for (const req of await old.keys()){
        const url = new URL(req.url);
        if (url.pathname.startsWith(scope.pathname + 'data/') && !url.pathname.endsWith('catalog.json') && !(await dataCache.match(req))){
          const hit = await old.match(req);
          if (hit) await dataCache.put(req, hit);
        }
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isKline = url.pathname.includes('/data/') && !url.pathname.endsWith('catalog.json');

  event.respondWith((async () => {
    const cache = await caches.open(isKline ? DATA_CACHE : CACHE);
    if (isKline){
      // The download manager validates and stores explicit refreshes itself.
      if (req.headers.get('X-Kpractice-Refresh') === '1') return fetch(req);
      const hit = await cache.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      if (net.ok){
        try { await cache.put(req, net.clone()); } catch {}
      }
      return net;
    }
    // Versioned shell stays consistent, including on slow/offline connections.
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      return net;
    } catch {
      if (req.mode === 'navigate'){
        const page = await cache.match('./index.html');
        if (page) return page;
      }
      throw new Error('offline miss');
    }
  })());
});
