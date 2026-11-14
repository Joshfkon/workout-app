'use client';

import { useEffect } from 'react';
import { initializeCapacitorListeners } from '@/lib/integrations/capacitor-stub';
import { showKeyboardAccessoryBar } from '@/lib/integrations/keyboard';

/**
 * Component that adds native app-like behavior by preventing
 * context menu on long-press (except on inputs and copyable content),
 * and — inside the Capacitor shell only — routes deep links
 * (hypertrack://…) to the matching in-app page and restores the iOS keyboard
 * toolbar (its Done button is the only way to close the number pad). Mounted
 * in the root layout so this covers the auth screens as well as the dashboard.
 */
export function NativeAppBehavior() {
  useEffect(() => {
    try {
      initializeCapacitorListeners();
    } catch (error) {
      console.warn('[NativeAppBehavior] deep-link listeners unavailable:', error);
    }
    void showKeyboardAccessoryBar();
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.isContentEditable;

      if (!isInput && !target.closest('.copyable')) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  return null;
}
