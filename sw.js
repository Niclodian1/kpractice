const CACHE = 'kpractice-v8';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/core.js',
  './js/persist.js',
  './js/charts.js',
  './js/journal.js',
  './js/trainer.js',
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
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
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
    const cache = await caches.open(CACHE);
    if (isKline){
      const hit = await cache.match(req);
      if (hit) return hit;
      const net = await fetch(req);
      if (net.ok) cache.put(req, net.clone());
      return net;
    }
    try {
      const net = await fetch(req);
      if (net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      const hit = await cache.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate'){
        const page = await cache.match('./index.html');
        if (page) return page;
      }
      throw new Error('offline miss');
    }
  })());
});
