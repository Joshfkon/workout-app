'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * An active workout must never be reloaded out from under the lifter: a
 * half-typed set, a running rest timer and an in-flight motion capture all
 * live in page memory. Same test as components/dashboard/isActiveWorkoutRoute
 * (kept local so the root layout doesn't pull in the dashboard bundle).
 */
function isWorkoutInProgressPath(pathname: string | null | undefined): boolean {
  return pathname?.includes('/dashboard/workout/') ?? false;
}

/**
 * Registers the service worker for offline support.
 * This component should be included in the root layout.
 */
export function ServiceWorkerRegistration() {
  const pathname = usePathname();
  // Set when a new worker took control while a workout was on screen; the
  // reload is then deferred until the user navigates off the workout.
  const reloadPendingRef = useRef(false);
  const reloadedRef = useRef(false);

  useEffect(() => {
    if (reloadPendingRef.current && !reloadedRef.current && !isWorkoutInProgressPath(pathname)) {
      reloadedRef.current = true;
      window.location.reload();
    }
  }, [pathname]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // When a new service worker takes control, reload once so the page runs
      // the freshly-deployed assets instead of the previously-cached build.
      // Only attach this when a controller already exists — on the very first
      // install there's no prior version, so claiming control is not an update
      // and must not trigger a reload.
      // The reload is skipped while a workout is in progress and picked up
      // on the next navigation away from it (effect above) — the already
      // loaded page keeps working against the build it was served with.
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloadedRef.current) return;
          if (isWorkoutInProgressPath(window.location.pathname)) {
            reloadPendingRef.current = true;
            return;
          }
          reloadedRef.current = true;
          window.location.reload();
        });
      }

      // Register service worker after page load for better performance
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            console.log('[SW] Service Worker registered:', registration.scope);

            // Check for updates promptly on load, then periodically.
            registration.update();
            setInterval(() => {
              registration.update();
            }, 15 * 60 * 1000); // Check every 15 minutes

            // When an updated worker finishes installing, activate it
            // immediately. sw.js calls skipWaiting() on install, but we also
            // message any worker that ends up "waiting" so the new version
            // takes over without the user having to fully close the app.
            const promote = (worker: ServiceWorker | null) => {
              if (!worker) return;
              worker.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[SW] New version installed — activating');
                  worker.postMessage('skipWaiting');
                }
              });
            };

            if (registration.waiting) {
              registration.waiting.postMessage('skipWaiting');
            }

            registration.addEventListener('updatefound', () => {
              promote(registration.installing);
            });
          })
          .catch((error) => {
            console.error('[SW] Service Worker registration failed:', error);
          });
      });
    }
  }, []);

  return null;
}
