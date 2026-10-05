const CACHE = 'kpractice-v27';
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      const url = new URL(path, self.registration.scope).href;
      const res = await fetch(url, { cache: 'reload' });
      if (!res.ok) throw new Error('shell ' + path);
      await cache.put(path, res);
    }));
    await self.skipWaiting();
  })());
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
    const save = res => {
      if (!res || !res.ok) return res;
      const task = cache.put(req, res.clone()).catch(() => {});
      try { event.waitUntil(task); } catch {}
      return res;
    };
    if (isKline){
      if (req.headers.get('X-Kpractice-Refresh') === '1') return save(await fetch(req));
      const hit = await cache.match(req);
      if (hit) return hit;
      return save(await fetch(req));
    }
    const isNav = req.mode === 'navigate' || url.pathname.endsWith('.html') || /\/$/.test(url.pathname);
    const hit = await cache.match(req);
    if (hit && !isNav){
      event.waitUntil(fetch(req).then(save).catch(() => {}));
      return hit;
    }
    try {
      const net = await fetch(req);
      return save(net);
    } catch {
      if (hit) return hit;
      if (isNav){
        const page = await cache.match('./index.html') || await cache.match('./');
        if (page) return page;
      }
      throw new Error('offline miss');
    }
  })());
});
