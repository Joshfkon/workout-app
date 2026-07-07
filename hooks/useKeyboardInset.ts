'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/**
 * Keyboard-aware bottom inset for modals and sheets.
 *
 * When the on-screen keyboard opens, fixed-position sheets don't get any
 * bottom inset, so lower form fields end up hidden behind the keyboard and
 * its input-accessory bar. This hook reports how many pixels of the layout
 * viewport the keyboard occludes so the sheet's scroll container can add
 * matching bottom padding, and scrolls the focused field into view once the
 * inset applies.
 *
 * Detection strategy:
 * - Capacitor (native shell): the `@capacitor/keyboard` plugin dispatches
 *   `keyboardWillShow` / `keyboardWillHide` window events with the keyboard
 *   height. The plugin may also resize the webview itself (resize mode
 *   `native`, the default), in which case no extra padding is needed — so the
 *   inset is the reported height minus however much the window already
 *   shrank. That way the hook is correct in every resize mode.
 * - PWA / mobile browser: the `visualViewport` API. The occluded region is
 *   the gap between the layout viewport bottom and the visual viewport
 *   bottom (`innerHeight - vv.height - vv.offsetTop`), tracked on both
 *   `resize` and `scroll` since iOS Safari moves the visual viewport around
 *   while the keyboard is up.
 *
 * Consumers must keep `env(safe-area-inset-bottom)` additive with this
 * value (e.g. `calc(env(safe-area-inset-bottom) + ${inset}px)`), not
 * replaced by it.
 *
 * @param enabled Pass the modal's `isOpen` so listeners only run while the
 *   sheet is actually showing.
 * @returns `inset` in px (0 when the keyboard is hidden) and a
 *   `scrollContainerRef` to attach to the sheet's scrollable element; any
 *   input focused inside it (including focus moved by the keyboard's
 *   prev/next accessory arrows) is scrolled into view above the keyboard.
 */
export function useKeyboardInset<T extends HTMLElement = HTMLDivElement>(
  enabled: boolean = true
): { inset: number; scrollContainerRef: RefObject<T> } {
  const [inset, setInset] = useState(0);
  const scrollContainerRef = useRef<T>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setInset(0);
      return;
    }

    let frame = 0;
    const apply = (value: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setInset(Math.max(0, Math.round(value))));
    };

    if (isNativePlatform()) {
      // Baseline window height while the keyboard is hidden, so we can tell
      // how much of the reported keyboard height the webview has already
      // absorbed by resizing itself.
      let baselineHeight = window.innerHeight;
      let keyboardHeight = 0;

      const computeNativeInset = () => {
        if (keyboardHeight <= 0) {
          apply(0);
          return;
        }
        const absorbedByResize = Math.max(0, baselineHeight - window.innerHeight);
        apply(keyboardHeight - absorbedByResize);
      };

      const onShow = (event: Event) => {
        keyboardHeight = (event as Event & { keyboardHeight?: number }).keyboardHeight ?? 0;
        computeNativeInset();
      };
      const onHide = () => {
        keyboardHeight = 0;
        apply(0);
      };
      const onDidHide = () => {
        keyboardHeight = 0;
        baselineHeight = window.innerHeight;
        apply(0);
      };
      // Re-check after the webview finishes its own resize animation.
      const onResize = () => {
        if (keyboardHeight > 0) {
          computeNativeInset();
        } else {
          baselineHeight = window.innerHeight;
        }
      };

      window.addEventListener('keyboardWillShow', onShow);
      window.addEventListener('keyboardDidShow', onShow);
      window.addEventListener('keyboardWillHide', onHide);
      window.addEventListener('keyboardDidHide', onDidHide);
      window.addEventListener('resize', onResize);

      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('keyboardWillShow', onShow);
        window.removeEventListener('keyboardDidShow', onShow);
        window.removeEventListener('keyboardWillHide', onHide);
        window.removeEventListener('keyboardDidHide', onDidHide);
        window.removeEventListener('resize', onResize);
      };
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    const onViewportChange = () => {
      apply(window.innerHeight - viewport.height - viewport.offsetTop);
    };

    onViewportChange();
    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', onViewportChange);
      viewport.removeEventListener('scroll', onViewportChange);
    };
  }, [enabled]);

  // Scroll the focused field into view — on focus (typing into the next
  // field, or the accessory bar's prev/next arrows moving focus) and again
  // when the inset changes (keyboard finished opening after focus landed).
  const insetRef = useRef(inset);
  insetRef.current = inset;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!enabled || !container) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const scrollFocusedIntoView = (target: Element | null, delay: number) => {
      if (
        !target ||
        !container.contains(target) ||
        !target.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      clearTimeout(timer);
      // Wait for the inset padding (and the keyboard's own animation) to
      // apply before measuring where the field sits.
      timer = setTimeout(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, delay);
    };

    const onFocusIn = (event: FocusEvent) => {
      // Give the keyboard time to open on first focus; subsequent focus
      // moves (accessory arrows) already have the inset in place.
      scrollFocusedIntoView(event.target as Element, insetRef.current > 0 ? 100 : 300);
    };

    container.addEventListener('focusin', onFocusIn);
    return () => {
      clearTimeout(timer);
      container.removeEventListener('focusin', onFocusIn);
    };
  }, [enabled]);

  // Keyboard height changed while a field inside is focused (e.g. the inset
  // arrived after focus, or the accessory bar toggled) — re-center it.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!enabled || !container || inset <= 0) return;
    const active = document.activeElement;
    if (
      !active ||
      !container.contains(active) ||
      !active.matches('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }
    const timer = setTimeout(() => {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [enabled, inset]);

  return { inset, scrollContainerRef };
}
