'use client';

import { useEffect, useState } from 'react';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/**
 * Anything occluding less than this many px of the layout viewport is not a
 * keyboard (browser chrome shuffling, the input-accessory bar flashing during
 * dismissal). Real on-screen keyboards occupy well over 150px.
 */
const MIN_KEYBOARD_PX = 80;

/**
 * Whether the on-screen keyboard is currently occluding the viewport.
 *
 * Companion to `useKeyboardInset`, for consumers that only need a boolean —
 * chiefly fixed bottom bars, which iOS detaches from the screen bottom while
 * the keyboard is up (they end up floating mid-page over content). Hiding
 * them while this returns true avoids the artifact, and the remount when it
 * flips back to false forces WebKit to re-anchor the bar at the true bottom.
 *
 * Detection mirrors `useKeyboardInset`:
 * - Capacitor (native shell): `@capacitor/keyboard` show/hide window events.
 * - PWA / mobile browser: the `visualViewport` API — the keyboard is the gap
 *   between the layout and visual viewport bottoms, tracked on both `resize`
 *   and `scroll` since iOS Safari moves the visual viewport while it's up.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isNativePlatform()) {
      const onShow = () => setOpen(true);
      const onHide = () => setOpen(false);

      window.addEventListener('keyboardWillShow', onShow);
      window.addEventListener('keyboardDidShow', onShow);
      window.addEventListener('keyboardWillHide', onHide);
      window.addEventListener('keyboardDidHide', onHide);

      return () => {
        window.removeEventListener('keyboardWillShow', onShow);
        window.removeEventListener('keyboardDidShow', onShow);
        window.removeEventListener('keyboardWillHide', onHide);
        window.removeEventListener('keyboardDidHide', onHide);
      };
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;
    const onViewportChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const occluded = window.innerHeight - viewport.height - viewport.offsetTop;
        setOpen(occluded > MIN_KEYBOARD_PX);
      });
    };

    onViewportChange();
    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
    };
  }, []);

  return open;
}
