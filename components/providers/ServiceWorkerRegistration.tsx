'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for offline support.
 * This component should be included in the root layout.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Register service worker after page load for better performance
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            // Check for updates periodically
            setInterval(() => {
              registration.update();
            }, 60 * 60 * 1000); // Check every hour

            // Handle updates
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // New version available - optionally prompt user to refresh
                  }
                });
              }
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
