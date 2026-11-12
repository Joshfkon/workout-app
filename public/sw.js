/**
 * Service Worker for HyperTrack
 *
 * Provides offline support and caching for better performance,
 * especially important for Capacitor native app deployment.
 *
 * Cache Strategy:
 * - Critical app shell: Precached on install (offline fallback only)
 * - Content-hashed /_next/static assets: cache-first, never revalidated
 *   (the URL changes when the content does)
 * - Other static assets (images, fonts): stale-while-revalidate
 * - API responses: network-only
 * - HTML pages + RSC payloads: NETWORK-FIRST. They are per-user and
 *   per-day (the dashboard renders "today's" calories / weigh-in / workout
 *   server-side), so a cached copy is only ever an offline / dead-network
 *   fallback — never the first paint.
 */

// Bump this version on releases to invalidate old caches and trigger an update.
// v6: Purge caches poisoned with redirected responses. /dashboard 307s to
// /login for signed-out visitors; caching the followed redirect and replaying
// it for a navigation is a fetch-spec network error (Safari: "Response served
// by service worker has redirections"), which bricked the site until site data
// was cleared.
// v7: HTML/RSC is network-first everywhere (the old stale-while-revalidate
// "instant load" routes painted yesterday's dashboard as today's), and hashed
// /_next/static assets are no longer re-downloaded on every load.
const CACHE_NAME = 'hypertrack-v7';

// Critical assets to cache on install (app shell + key routes)
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/dashboard',
];

// Routes to prefetch after initial load (background caching)
const PREFETCH_ROUTES = [
  '/dashboard/workout',
  '/dashboard/nutrition',
  '/dashboard/analytics',
  '/dashboard/mesocycle',
  '/dashboard/history',
];

// How long a page request may hang before a cached copy (if any) is served
// instead. Only a dead / captive network gets here; a normal load is always
// the network response.
const PAGE_NETWORK_TIMEOUT_MS = 5000;

/**
 * A response may be cached only if it is a full 200 that did NOT arrive via a
 * redirect. Navigation requests carry redirect mode "manual", and serving a
 * `redirected` response to one is a network error per the fetch spec — the
 * page fails to render entirely. 206s are excluded because partial video
 * content must not be replayed as a whole resource.
 */
function isCacheableResponse(response) {
  return response.ok && response.status !== 206 && !response.redirected;
}

/**
 * One rejected fetch is not proof of being offline: iOS drops in-flight
 * requests on Wi-Fi<->cellular handoff and when the webview resumes from
 * background, and those recover instantly. Retry once before giving up.
 * Only GET requests reach this worker, so replaying the request is safe.
 */
function fetchWithRetry(request, retryDelayMs = 400) {
  return fetch(request).catch(() =>
    new Promise((resolve) => setTimeout(resolve, retryDelayMs)).then(() =>
      fetch(request)
    )
  );
}

/**
 * Fallback for a navigation that failed even after a retry and has nothing
 * usable in cache. Unlike a bare "you are offline" dead end, this page can
 * recover on its own: it reloads when connectivity returns or the app is
 * foregrounded again, and only claims "offline" if the device agrees.
 */
const OFFLINE_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Can't connect &mdash; HyperTrack</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0a0a0a; color: #fafafa; text-align: center; padding: 24px; box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  h1 { font-size: 1.375rem; margin: 0 0 8px; }
  p { color: #a1a1aa; margin: 0 0 24px; line-height: 1.5; max-width: 28rem; }
  button { background: #fafafa; color: #0a0a0a; border: 0; border-radius: 9999px;
    padding: 12px 28px; font-size: 1rem; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>Can't reach HyperTrack</h1>
<p id="msg">This is usually a brief connection hiccup and fixes itself in a moment.</p>
<button onclick="location.reload()">Try again</button>
</main>
<script>
  if (!navigator.onLine) {
    document.getElementById('msg').textContent =
      'You appear to be offline. This page will retry when your connection returns.';
  }
  window.addEventListener('online', function () { location.reload(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      location.reload();
    }
  });
</script>
</body>
</html>`;

function offlineFallbackResponse() {
  return new Response(OFFLINE_PAGE_HTML, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// Install event - cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Not cache.addAll: it would store redirected responses (e.g.
      // /dashboard -> /login when signed out), which then break every
      // navigation served from cache. Precache is best-effort per asset.
      return Promise.all(
        PRECACHE_ASSETS.map((asset) =>
          fetch(asset)
            .then((response) => {
              if (isCacheableResponse(response)) {
                return cache.put(asset, response);
              }
            })
            .catch(() => {})
        )
      );
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches and prefetch routes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      }),
      // Prefetch additional routes in background (low priority)
      caches.open(CACHE_NAME).then((cache) => {
        // Use requestIdleCallback pattern - don't block activation
        setTimeout(() => {
          PREFETCH_ROUTES.forEach((route) => {
            fetch(route, { priority: 'low' })
              .then((response) => {
                if (isCacheableResponse(response)) {
                  cache.put(route, response);
                }
              })
              .catch(() => {}); // Ignore errors for prefetch
          });
        }, 2000); // Delay prefetch to not compete with initial load
      }),
    ])
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip API routes - always go to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Offline', message: 'Network unavailable' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // For video files - network-only, no caching (they use range requests with 206 status)
  // Must be checked BEFORE the static assets handler
  if (url.pathname.match(/\.(mp4|webm|mov|avi|mkv)$/)) {
    event.respondWith(fetch(request));
    return;
  }

  // Content-hashed build assets are immutable: the URL changes whenever the
  // bytes do, so a cache hit is always current and must NOT be re-fetched
  // (revalidating re-downloaded the whole JS/CSS bundle on every load).
  if (url.pathname.startsWith('/_next/static/')) {
    // `next dev` serves UNHASHED chunk URLs whose bytes change on every edit;
    // leave those to the browser so local development never runs stale code.
    if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
      return;
    }
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (isCacheableResponse(response)) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // For other static assets (images, fonts, unhashed JS/CSS) -
  // stale-while-revalidate
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|eot)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Return cached, but also update cache in background
          event.waitUntil(
            fetch(request)
              .then((response) => {
                if (isCacheableResponse(response)) {
                  const responseToCache = response.clone();
                  caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseToCache);
                  });
                }
              })
              .catch(() => {})
          );
          return cached;
        }

        return fetch(request).then((response) => {
          if (isCacheableResponse(response)) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages and RSC payloads - network-first. The cache is consulted only
  // when the network fails (after one retry) or hangs past
  // PAGE_NETWORK_TIMEOUT_MS, so an online user never sees a stale render.
  const cachedFallback = () =>
    caches.match(request).then((cached) => {
      // A redirected response replayed for a navigation is a network error
      // (this is what bricked the site on Safari) — never serve one.
      if (cached && !cached.redirected) {
        return cached;
      }
      return undefined;
    });

  const networkPromise = fetchWithRetry(request).then((response) => {
    if (isCacheableResponse(response)) {
      const responseToCache = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, responseToCache);
      });
    }
    return response;
  });

  const offlineResponse = () =>
    cachedFallback().then((cached) => {
      if (cached) return cached;
      // Return offline page for navigation requests
      if (request.mode === 'navigate') {
        return caches.match('/').then((homePage) => {
          if (homePage && !homePage.redirected) {
            return homePage;
          }
          return offlineFallbackResponse();
        });
      }
      return new Response('Offline', { status: 503 });
    });

  // If the network hangs, fall back to a cached copy when one exists;
  // otherwise keep waiting for the network (there is nothing better to show).
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(resolve, PAGE_NETWORK_TIMEOUT_MS)
  ).then(() => cachedFallback().then((cached) => cached || networkPromise));

  // Keep the worker alive until the network settles so the cache still gets
  // refreshed when the timeout path answered first.
  event.waitUntil(networkPromise.catch(() => {}));
  event.respondWith(
    Promise.race([networkPromise, timeoutPromise]).catch(() => offlineResponse())
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
