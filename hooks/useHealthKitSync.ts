'use client';

/**
 * Foreground HealthKit sync trigger.
 *
 * On native iOS only: runs an anchored sync once on mount (app launch /
 * dashboard entry) and again on every app foreground via the Capacitor
 * appStateChange event. The sync itself is throttled and connection-gated in
 * lib/integrations/healthkit-sync.ts, so this hook can fire opportunistically.
 *
 * On web/PWA/Android this is a no-op and none of the HealthKit modules load
 * (dynamic imports behind the platform gate keep them out of the web bundle
 * graph at runtime).
 */

import { useEffect } from 'react';
import { isNativePlatform, getPlatform } from '@/lib/integrations/capacitor-stub';

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
      removeListener?.();
    };
  }, []);
}
