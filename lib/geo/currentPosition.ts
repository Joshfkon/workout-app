/**
 * One-shot phone position, made safe to call from UI flows.
 *
 * navigator.geolocation's callback API can hang (no fix indoors), throw
 * (insecure context, WebView without the native permission), or prompt and
 * be denied. A gym suggestion is a convenience, so every one of those must
 * degrade to null quickly rather than block the location picker — the picker
 * renders identically without a fix, just unsorted.
 *
 * Works in the browser/PWA directly. In the Capacitor apps the WebView
 * forwards to the native prompt, which requires the platform permission
 * entries (ios/App/App/Info.plist NSLocationWhenInUseUsageDescription,
 * android ACCESS_COARSE/FINE_LOCATION) added alongside this module.
 */

import type { GeoPoint } from '@/services/gymProximity';

export interface PositionFix extends GeoPoint {
  /** Reported accuracy radius in metres (may be optimistic indoors). */
  accuracyM: number;
  /** When the fix was taken (ms epoch), for staleness checks by the caller. */
  takenAt: number;
}

/**
 * Resolve the current position, or null on ANY failure: denied, unavailable,
 * insecure context, or no fix within `timeoutMs`. Never rejects.
 *
 * `maximumAge` accepts a recent cached fix — the phone usually has one from
 * the OS, and "which building am I in" doesn't need a fresh satellite lock.
 */
export function getCurrentPositionSafe(timeoutMs = 8000): Promise<PositionFix | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: PositionFix | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        settle(null);
        return;
      }
      // The API's own timeout is unreliable in some WebViews; belt and braces.
      const fallback = setTimeout(() => settle(null), timeoutMs + 500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(fallback);
          settle({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
            takenAt: Date.now(),
          });
        },
        () => {
          clearTimeout(fallback);
          settle(null);
        },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120000 }
      );
    } catch {
      settle(null);
    }
  });
}
