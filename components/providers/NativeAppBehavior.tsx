'use client';

import { useEffect } from 'react';

/**
 * Component that adds native app-like behavior by preventing
 * context menu on long-press (except on inputs and copyable content)
 */
export function NativeAppBehavior() {
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
