/* ChemiConnect service worker: lets the app open with no internet.
 * - the page and its scripts/styles are kept on the device after the first online visit,
 * - /api/ calls are never cached (stock numbers always come from the app's own offline copy, see src/offline.js).
 */
const CACHE = 'chemiconnect-shell-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'   // map library
];

self.addEventListener('install', e => {
  // each file is saved on its own, so one that cannot be fetched never blocks the others
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;                    // live data: never cached
  const sameOrigin = url.origin === self.location.origin;
  const cdn = /(^|\.)(unpkg\.com|openstreetmap\.org)$/.test(url.hostname);   // map library and map tiles
  if (!sameOrigin && !cdn) return;

  if (req.mode === 'navigate') {
    // open the latest page when online, the saved page when offline
    e.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); return res; })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  // scripts, styles, images: show the saved copy at once and refresh it quietly in the background
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(hit => {
        const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
