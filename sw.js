const CACHE      = 'mototracker-v1';
const PRECACHE   = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
];

/* ─── Install: cache app shell ───────────────────────────────────────────── */

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ─── Activate: remove old caches ────────────────────────────────────────── */

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ─── Fetch: cache-first for app shell, network-first for tiles ──────────── */

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Map tiles: network-first, fall back to cache
  // CartoDB tile pattern: basemaps.cartocdn.com
  if (url.hostname.endsWith('cartocdn.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell and Leaflet assets: cache-first
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached ?? fetch(e.request))
  );
});
