'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  getOpenOverlayCount,
  openOverlay,
  subscribeOverlays,
} from '@/lib/ui/overlayRegistry';

/**
 * Register a modal/sheet as open for as long as `isOpen` is true, so app
 * chrome (the resume-workout pill) can step out of the way instead of
 * covering its fields. Call it above any early `return null`.
 */
export function useRegisterOverlay(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    return openOverlay();
  }, [isOpen]);
}

/**
 * True while any registered overlay is open. Server/initial snapshot is
 * `false` so it can't cause a hydration mismatch.
 */
export function useIsOverlayOpen(): boolean {
  return useSyncExternalStore(
    subscribeOverlays,
    () => getOpenOverlayCount() > 0,
    () => false
  );
}
