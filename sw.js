/* IR Lab service worker.

   Caching strategy, and why it's split:

   - HTML pages use NETWORK FIRST. The whole tool is one HTML file, so
     cache-first would mean every visitor keeps running whatever version they
     first saw until the service worker happens to update — the classic
     "I deployed a fix and nobody sees it" trap. Network first means an online
     visitor always gets the current build, and the cached copy exists purely
     so the app still opens with no connection.

   - Everything else (icons, fonts) uses STALE WHILE REVALIDATE. These change
     almost never, so serve them instantly from cache and quietly refresh in
     the background.

   Bump CACHE_VERSION whenever you want to force old caches to be dropped.
   You do NOT need to bump it just to deploy a new index.html — network-first
   handles that on its own. */

const CACHE_VERSION = 'irlab-v1';

// Fonts are cross-origin and opaque; caching them is what stops the app
// falling back to system fonts the moment it goes offline.
const PRECACHE = [
  '/',
  '/index.html',
  '/filters.html',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll fails the whole install if any single item 404s, which would
    // leave the app with no offline support at all. Add them individually so
    // one missing file can't take the rest down.
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  // don't touch anything else cross-origin — analytics in particular must
  // never be served from cache
  if (!sameOrigin && !isFont) return;

  // navigations and HTML: network first, cache as backup
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req) || await caches.match('/index.html');
        if (cached) return cached;
        return new Response('<h1>Offline</h1><p>Open this page once while connected to make it available offline.</p>',
          { headers: { 'Content-Type': 'text/html' }, status: 503 });
      }
    })());
    return;
  }

  // assets and fonts: serve from cache immediately, refresh behind the scenes
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(res => {
      // opaque cross-origin font responses are still worth storing
      if (res && (res.ok || res.type === 'opaque')) {
        caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
      }
      return res;
    }).catch(() => null);
    return cached || network || fetch(req);
  })());
});
