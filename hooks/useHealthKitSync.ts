'use client';

/**
 * Foreground HealthKit sync trigger.
 *
 * On native iOS only: runs an anchored sync once on mount (app launch /
 * dashboard entry), again on every app foreground via the Capacitor
 * appStateChange event, and every HEALTHKIT_SYNC.whileOpenIntervalMs while
 * the app stays open and visible — so steps and sleep stay close to live.
 * The sync itself is throttled and connection-gated in
 * lib/integrations/healthkit-sync.ts, so this hook can fire opportunistically.
 *
 * On web/PWA/Android this is a no-op and none of the HealthKit modules load
 * (dynamic imports behind the platform gate keep them out of the web bundle
 * graph at runtime).
 */

import { useEffect } from 'react';
import { isNativePlatform, getPlatform } from '@/lib/integrations/capacitor-stub';

/**
 * Mirrors HEALTHKIT_SYNC.whileOpenIntervalMs (lib/integrations/healthkit-sync),
 * kept as a literal so the HealthKit modules stay out of the web bundle — they
 * are only ever loaded by the dynamic import below.
 */
export const WHILE_OPEN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Fired on `window` after a foreground sync stored new HealthKit data
 * (`detail` is the HealthKitSyncOutcome). Listeners refetch what they show.
 */
export const HEALTHKIT_SYNCED_EVENT = 'healthkit:synced';

export function useHealthKitForegroundSync(): void {
  useEffect(() => {
    if (!isNativePlatform() || getPlatform() !== 'ios') return;

    let disposed = false;
    let removeListener: (() => void) | null = null;

    const sync = () => {
      import('@/lib/integrations/healthkit-sync')
        .then((module) => module.runHealthKitSync())
        .then((outcome) => {
          // The dashboard cards read their rows on mount, in parallel with
          // this pull, so they render yesterday's picture of today. Tell them
          // when fresh rows have landed.
          if (outcome.status === 'synced' && !disposed) {
            window.dispatchEvent(
              new CustomEvent(HEALTHKIT_SYNCED_EVENT, { detail: outcome })
            );
          }
        })
        .catch(() => {
          // Plugin or network unavailable — foreground sync is best-effort.
        });
    };

    sync();

    // HealthKit offers no background delivery through this plugin, so keep
    // pulling while the app is open; hidden tabs/backgrounded apps skip.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') sync();
    }, WHILE_OPEN_INTERVAL_MS);

    import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) sync();
        })
      )
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeListener = () => void handle.remove();
      })
      .catch(() => {});

    return () => {
      disposed = true;
      window.clearInterval(interval);
      removeListener?.();
    };
  }, []);
}
