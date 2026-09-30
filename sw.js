/* VibeMon Field Engineer — service worker.
   Makes the app installable and lets the shell (HTML/CSS/JS) launch with no network at all.
   Live data (Supabase) is always network-only — this worker never caches or answers for it,
   so it can't go stale or fight with js/offline/offline-queue.js's own offline handling. */

const CACHE_VERSION = 'vibemon-shell-v1';

const NEVER_CACHE_HOSTS = ['supabase.co', 'supabase.in'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isNeverCache(url) {
  return NEVER_CACHE_HOSTS.some(h => url.hostname.endsWith(h));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes/reads to Supabase etc. go straight to network, untouched

  const url = new URL(req.url);
  if (isNeverCache(url)) return; // live data — never intercepted

  // Page navigations: try the network first (so users get the latest app on every load while
  // online), fall back to the last cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Same-origin static assets (css/js/icons) and the handful of CDN libraries the app loads:
  // stale-while-revalidate. Instant load from cache, quietly refreshed in the background — the
  // existing "?v=YYYYMMDD" query strings on every <script>/<link> already bust the cache key
  // whenever a file changes, so this needs no manual file list to maintain.
  const sameOrigin = url.origin === self.location.origin;
  const knownCdn = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'].some(h => url.hostname === h);
  if (!sameOrigin && !knownCdn) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    const networkFetch = fetch(req).then((res) => {
      // Cross-origin CDN responses are opaque (status always 0/ok=false) but are still
      // safe and useful to cache; same-origin responses are checked for a real 200 first.
      if (res && (sameOrigin ? res.ok : res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await networkFetch) || Response.error();
  })());
});
