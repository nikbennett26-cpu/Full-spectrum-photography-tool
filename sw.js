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

const CACHE_VERSION = 'irlab-v7';   // bumped so the new manifest is re-fetched rather than served stale
// transient hand-off storage for Web Share Target, deliberately not versioned
const SHARE_CACHE = 'irlab-share';
const SHARE_KEY = '/__shared-image';

// Fonts are cross-origin and opaque; caching them is what stops the app
// falling back to system fonts the moment it goes offline.
const PRECACHE = [
  '/',
  '/index.html',
  '/filters.html',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/og-card.png',
  '/manifest.json'
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
    // SHARE_CACHE is transient hand-off storage, not a version of the app —
    // sweeping it here would delete a file mid-share
    await Promise.all(keys.filter(k => k !== CACHE_VERSION && k !== SHARE_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  /* Web Share Target.

     Android posts the shared file here as multipart form data. There is no
     such path on the server — the worker is the endpoint, which is why this
     has to be handled before the GET-only guard below.

     The response has to be an immediate redirect: the share sheet is waiting,
     and reading the file body can take a moment for a large image. So the
     redirect goes out straight away and the file is stashed in a cache under
     waitUntil, with the page polling briefly for it on the other side. */
  if (req.method === 'POST' && new URL(req.url).pathname === '/share-target') {
    event.respondWith(Response.redirect('/?shared=1', 303));
    event.waitUntil((async () => {
      try {
        const form = await req.formData();
        const file = form.get('image');
        if (!file) return;
        const cache = await caches.open(SHARE_CACHE);
        await cache.put(SHARE_KEY, new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            // the filename carries the extension, which is what tells the app
            // whether to go down the RAW path
            'X-Filename': encodeURIComponent(file.name || 'shared.jpg')
          }
        }));
      } catch (e) { /* nothing useful to do here; the page shows a message */ }
    })());
    return;
  }

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
        /* Only a genuinely OK response is worth keeping. Without this check a
           404 page counts as a successful fetch — it resolves, it doesn't
           throw — so a moment when a file is missing or half-uploaded gets
           written into the cache and then served happily forever, including
           offline. Falling back to the cached good copy on a bad status also
           means a broken deploy doesn't take the installed app down. */
        if (!fresh || !fresh.ok) {
          const backup = await caches.match(req) || await caches.match('/index.html');
          if (backup) return backup;
          return fresh;
        }
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

  /* The manifest is network-first for the same reason HTML is: it declares
     the share target, and a stale copy means Android keeps offering the old
     set of capabilities long after a deploy. It is one small file, so the
     cost of checking is negligible. */
  if (sameOrigin && url.pathname === '/manifest.json') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, fresh.clone());
          return fresh;
        }
        return (await caches.match(req)) || fresh;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // assets and fonts: serve from cache immediately, refresh behind the scenes
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      /* Stale while revalidate, properly: the refresh runs in the
         background and is never awaited by the response the page actually
         gets, but its own failure must not leak out as an unhandled
         rejection \u2014 hence the .catch here rather than relying on one
         further up the chain. Cloned the instant the response arrives,
         before anything else has a chance to read it. */
      fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          caches.open(CACHE_VERSION).then(c => c.put(req, res.clone()));
        }
      }).catch(() => {});
      return cached;
    }
    /* Nothing cached yet \u2014 the first time this exact file has ever been
       requested. This used to be `return cached || network || fetch(req)`,
       where `network` was a Promise object: a Promise is always truthy, so
       that `||` chain returned the pending promise itself the moment
       `cached` was falsy and never reached the `fetch(req)` fallback at
       all. A brand-new resource this app has never fetched before \u2014
       exactly what every AMaZE .wasm/.mjs file is on its first load \u2014 hits
       this exact path. Awaited directly here instead, with the clone
       happening synchronously on arrival rather than inside a detached
       .then() where something else downstream could touch the body first. */
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (e) {
      return fetch(req);   // last resort, uncached
    }
  })());
});
