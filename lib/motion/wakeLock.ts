/**
 * Screen Wake Lock for the recording screen: the phone is strapped to a
 * machine arm mid-set — the screen must not sleep (sleep suspends sensor
 * delivery). The lock is re-acquired on visibilitychange because the
 * browser silently releases it whenever the page is backgrounded.
 *
 * Best-effort: devices without the API just fall through (the UI separately
 * tells the user to keep the screen on).
 */

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', cb: () => void): void;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export interface WakeLockHandle {
  /** Release the lock and stop re-acquiring. */
  release(): void;
  /** Whether a lock is currently held (for UI hints). */
  isActive(): boolean;
}

export function acquireScreenWakeLock(): WakeLockHandle {
  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const request = async () => {
    const nav = navigator as unknown as WakeLockNavigator;
    if (!nav.wakeLock) return;
    try {
      const s = await nav.wakeLock.request('screen');
      if (released) {
        s.release().catch(() => {});
        return;
      }
      sentinel = s;
      s.addEventListener?.('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // Denied (low battery mode etc.) — nothing to do, UI copy covers it.
    }
  };

  const onVisibility = () => {
    if (!released && document.visibilityState === 'visible' && !sentinel) {
      void request();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  void request();

  return {
    release() {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
    isActive: () => sentinel !== null,
  };
}
