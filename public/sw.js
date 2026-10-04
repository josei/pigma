/*
 * Pigma service worker.
 *
 * Caching strategy, and why:
 *
 * - Navigations are network-first. The HTML shell is what decides which hashed
 *   asset bundle a deploy uses, so while online we always try the network and
 *   only fall back to the cached shell when the network is unavailable. That
 *   way a deployed update is picked up on the next load instead of being
 *   pinned to a stale build, while a deep link still boots offline.
 * - Every other same-origin GET (JS/CSS/images/fonts/manifest) is
 *   stale-while-revalidate: the cached copy is served immediately for speed,
 *   and a background fetch refreshes it for next time.
 * - Only same-origin GETs are touched. Non-GET (mutations, uploads), cross
 *   origin requests (fonts.googleapis.com) and browser-extension requests pass
 *   straight through to the network and are never cached.
 */

const CACHE_VERSION = 'pigma-v1';
const SHELL_URL = '/index.html';

// Always fetched at install so the app boots on a first visit, before the
// worker controls the page and can populate the cache through `fetch`.
const PRECACHE_URLS = ['/', SHELL_URL, '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  // Activate this worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
      // The shell's hashed JS/CSS loads before the worker takes control, so
      // cache whatever it references now; otherwise an offline reload would
      // get the HTML back but no bundle to run.
      try {
        const shell = await cache.match(SHELL_URL);
        if (!shell) return;
        const refs = [...(await shell.text()).matchAll(/(?:src|href)="(\/[^"#?]+)"/g)];
        const extra = [...new Set(refs.map((match) => match[1]))].filter(
          (url) => !PRECACHE_URLS.includes(url),
        );
        await Promise.allSettled(extra.map((url) => cache.add(url)));
      } catch {
        // Precache is best-effort; the runtime strategies still fill the cache.
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches left behind by earlier versions so stale bundles cannot
      // be served after an update.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch non-GET, cross-origin, or extension requests: only same-origin
  // GETs are safe to replay from cache.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.protocol === 'chrome-extension:') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/** Network-first for page loads; fall back to the cached shell when offline. */
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    // `ignoreVary`: the dev/preview server sends `Vary: Origin`, and the
    // `crossorigin` script/style requests carry an Origin header that the
    // precached (Origin-less) responses would otherwise fail to match.
    const cached = await cache.match(SHELL_URL, { ignoreVary: true });
    if (cached) return cached;
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Serve the cached copy immediately, refresh it in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreVary: true });

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || network;
}
