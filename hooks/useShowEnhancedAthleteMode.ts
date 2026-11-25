'use client';

import { useEffect, useState } from 'react';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/**
 * Enhanced Athlete Mode (the "I use performance enhancing drugs" toggle) is
 * HIDDEN in the native iOS app for the first App Store review: an in-app
 * prompt about PED use is a review risk (Guideline 1.4.3). It stays on the web.
 *
 * Only the UI is hidden. users.enhanced_athlete_mode and the programming that
 * reads it are unchanged, so someone who turned it on on the web keeps their
 * volume settings in the app.
 *
 * To restore in the app: set this to true.
 */
export const ENHANCED_ATHLETE_MODE_IN_NATIVE_APP = false;

/**
 * Whether to show Enhanced Athlete Mode UI.
 * null until mounted (the native check can't run during SSR), so callers can
 * render nothing rather than flash the toggle in the app.
 */
export function useShowEnhancedAthleteMode(): boolean | null {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    setShow(ENHANCED_ATHLETE_MODE_IN_NATIVE_APP || !isNativePlatform());
  }, []);

  return show;
}
