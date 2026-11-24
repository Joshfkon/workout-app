'use client';

import { useEffect } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import {
  isApplePurchasesAvailable,
  onAppleTransaction,
  syncCurrentAppleEntitlements,
} from '@/lib/integrations/applePurchases';

/**
 * iOS only: on entering the app, send the App Store entitlements this device
 * holds to the server, and keep listening for renewals, Ask to Buy approvals
 * and purchases from other devices. Renders nothing; a no-op on the web and on
 * app builds without the purchases plugin.
 */
export function AppleEntitlementSync() {
  const { refresh } = useSubscription();

  useEffect(() => {
    if (!isApplePurchasesAvailable()) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    syncCurrentAppleEntitlements()
      .then((r) => {
        if (!cancelled && r?.applied) void refresh();
      })
      .catch(() => {});
    onAppleTransaction((r) => {
      if (r.applied) void refresh();
    })
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [refresh]);

  return null;
}
