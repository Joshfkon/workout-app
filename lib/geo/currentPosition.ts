/**
 * One-shot phone position, made safe to call from UI flows.
 *
 * navigator.geolocation's callback API can hang (no fix indoors), throw
 * (insecure context, WebView without the native permission), or prompt and
 * be denied. A gym suggestion is a convenience, so every one of those must
 * degrade to null quickly rather than block the location picker — the picker
 * renders identically without a fix, just unsorted.
 *
 * Two transports:
 *  - Browser/PWA: navigator.geolocation.
 *  - Native app (Capacitor): the @capacitor/geolocation plugin. The app's
 *    WKWebView loads a remote origin, so navigator.geolocation there shows the
 *    iOS prompt AND a second website-style prompt ("www.hypertrack.app would
 *    like to use your location") that WebKit does not remember across
 *    launches. The plugin talks to CoreLocation directly: one iOS prompt,
 *    once, remembered by the OS. Needs ios/App/App/Info.plist
 *    NSLocationWhenInUseUsageDescription.
 *
 * An installed app binary that predates the plugin (the site deploys ahead of
 * the App Store build) reports the plugin as unavailable and keeps using
 * navigator.geolocation, so nothing regresses in between.
 */

import { Capacitor } from '@capacitor/core';
import type { GeoPoint } from '@/services/gymProximity';

export interface PositionFix extends GeoPoint {
  /** Reported accuracy radius in metres (may be optimistic indoors). */
  accuracyM: number;
  /** When the fix was taken (ms epoch), for staleness checks by the caller. */
  takenAt: number;
}

const GEOLOCATION_PLUGIN = 'Geolocation';

/** True when the native shell has the Geolocation plugin compiled in. */
function hasNativeGeolocation(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(GEOLOCATION_PLUGIN);
  } catch {
    return false;
  }
}

/**
 * Native path. Asks for the OS permission only when it has never been
 * decided ('prompt'); a prior denial resolves null without re-asking (iOS
 * would not show the dialog again anyway).
 */
async function getNativePosition(timeoutMs: number): Promise<PositionFix | null> {
  const { Geolocation } = await import('@capacitor/geolocation');

  let status = await Geolocation.checkPermissions();
  const granted = () =>
    status.location === 'granted' || status.coarseLocation === 'granted';
  if (!granted()) {
    const undecided =
      status.location === 'prompt' || status.location === 'prompt-with-rationale';
    if (!undecided) return null;
    status = await Geolocation.requestPermissions();
    if (!granted()) return null;
  }

  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: false,
    timeout: timeoutMs,
    maximumAge: 120000,
  });
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracyM: pos.coords.accuracy,
    takenAt: Date.now(),
  };
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
      if (hasNativeGeolocation()) {
        // No outer timer here: the first call may be sitting on the iOS
        // permission dialog, which the user can take as long as they like to
        // answer. The plugin's own `timeout` bounds the fix itself.
        getNativePosition(timeoutMs).then(settle, () => settle(null));
        return;
      }

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
