import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

/**
 * Manages screen wake lock during active workout sessions.
 * 
 * - Native (Capacitor): uses KeepAwake plugin
 * - Web: uses navigator.wakeLock API where available
 * - Fails gracefully when wake lock is unavailable
 * 
 * Automatically acquires the lock when `isActive` is true and releases when false.
 * Re-acquires on visibility change (web only, as required by the wake lock spec).
 */
export function useScreenWakeLock(isActive: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isActive) {
      acquireWakeLock();

      // On web, re-acquire wake lock when page becomes visible
      // (the browser auto-releases on visibility loss)
      if (!isNative) {
        document.addEventListener('visibilitychange', handleVisibilityChange);
      }
    }

    return () => {
      if (isActive) {
        releaseWakeLock();
        if (!isNative) {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  async function acquireWakeLock() {
    try {
      if (isNative) {
        await KeepAwake.keepAwake();
      } else {
        // Web: use navigator.wakeLock if available
        if ('wakeLock' in navigator) {
          const wakeLock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = wakeLock;
        }
        // Fail silently if wake lock API is not available
      }
    } catch (err) {
      // Fail silently: wake lock may be denied or unsupported
      // (e.g., insecure context, battery saver mode, permission denied)
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useScreenWakeLock] Failed to acquire wake lock:', err);
      }
    }
  }

  async function releaseWakeLock() {
    try {
      if (isNative) {
        await KeepAwake.allowSleep();
      } else {
        // Web: release the current wake lock
        if (wakeLockRef.current) {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        }
      }
    } catch (err) {
      // Fail silently on release errors
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useScreenWakeLock] Failed to release wake lock:', err);
      }
    }
  }

  function handleVisibilityChange() {
    // On web, re-acquire wake lock when page becomes visible
    // (browser auto-releases on hidden, per spec)
    if (document.visibilityState === 'visible' && isActive) {
      acquireWakeLock();
    }
  }
}
