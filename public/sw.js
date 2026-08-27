/**
 * Service Worker for HyperTrack
 *
 * Provides offline support and caching for better performance,
 * especially important for Capacitor native app deployment.
 *
 * Cache Strategy:
 * - Critical app shell: Precached on install
 * - Static assets (JS, CSS, images): Stale-while-revalidate for fast loads
 * - API responses: Network-first with fallback to cache
 * - HTML pages: Network-first with offline fallback
 *
 * Performance optimizations:
 * - Precaches critical routes for instant navigation
 * - Uses stale-while-revalidate for assets (show cached, update in background)
 * - Aggressive caching of Next.js static chunks
 */

// Bump this version on releases to invalidate old caches and trigger an update.
// v6: Purge caches poisoned with redirected responses. /dashboard 307s to
// /login for signed-out visitors; caching the followed redirect and replaying
// it for a navigation is a fetch-spec network error (Safari: "Response served
// by service worker has redirections"), which bricked the site until site data
// was cleared.
const CACHE_NAME = 'hypertrack-v6';

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

// Routes that should use stale-while-revalidate for instant loads
const INSTANT_LOAD_ROUTES = [
  '/dashboard',
  '/dashboard/workout',
  '/dashboard/nutrition',
];

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

  // For static assets (JS, CSS, images) - cache-first
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|eot)$/) ||
    url.pathname.startsWith('/_next/static/')
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

  // For instant-load routes - stale-while-revalidate (show cached immediately, update in background)
  const isInstantLoadRoute = INSTANT_LOAD_ROUTES.some(route =>
    url.pathname === route || url.pathname === route + '/'
  );

  if (isInstantLoadRoute) {
    event.respondWith(
      caches.match(request).then((maybeCached) => {
        // A redirected response replayed for a navigation is a network error
        // (this is what bricked the site on Safari) — never serve one.
        const cached = maybeCached && !maybeCached.redirected ? maybeCached : undefined;
        const fetchPromise = fetch(request)
          .then((response) => {
            if (isCacheableResponse(response)) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return response;
          })
          .catch(() => cached || new Response('Offline', { status: 503 }));

        // Return cached immediately if available, otherwise wait for network
        return cached || fetchPromise;
      })
    );
    return;
  }

  // For other HTML pages - network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (isCacheableResponse(response)) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached && !cached.redirected) {
            return cached;
          }
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/').then((homePage) => {
              if (homePage && !homePage.redirected) {
                return homePage;
              }
              return new Response(
                '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>You are offline</h1><p>Please check your internet connection.</p></body></html>',
                {
                  headers: { 'Content-Type': 'text/html' },
                }
              );
            });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
