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

const CACHE_NAME = 'hypertrack-v2';

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
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
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
                if (response.ok) {
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
                // Don't cache partial responses (206) - these are range requests for videos
                if (response.ok && response.status !== 206) {
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
          // Don't cache partial responses (206) - these are range requests for videos
          if (response.ok && response.status !== 206) {
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

  // For HTML pages - network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) {
            return cached;
          }
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/').then((homePage) => {
              if (homePage) {
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
