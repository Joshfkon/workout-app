'use client';

import { useState, useEffect } from 'react';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/**
 * Hydration-safe check for whether the app is running inside the native
 * Capacitor shell (iOS/Android) rather than a web browser.
 *
 * Returns `false` during SSR and the first client render so the markup matches
 * what the server produced, then resolves to the real value after mount. Use
 * this to hide App Store-prohibited purchase UI (Stripe checkout, upgrade CTAs,
 * the billing portal) inside the native app — see Path A in CAPACITOR_MIGRATION.md.
 *
 * Apple Guideline 3.1.1 requires digital subscriptions sold in-app to use Apple
 * In-App Purchase; we sell subscriptions on the web only, so the native build
 * must not surface any way to buy or manage paid plans.
 */
export function useIsNativePlatform(): boolean {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(isNativePlatform());
  }, []);

  return isNative;
}
