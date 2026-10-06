// Offline cache: the app works with no internet once installed (fonts fall back to system faces).
const CACHE = 'vortex-v1';
const FILES = ['./', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg',
  './js/app.js', './js/ble.js', './js/board.js', './js/fx.js', './js/games.js', './js/segments.js', './js/store.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Network first so edits show up immediately; cache when offline.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && new URL(e.request.url).origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
