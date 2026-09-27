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
 * How long the keyboard must have stayed down before we report it closed.
 * iOS keeps resizing/scrolling the visual viewport for a few hundred ms after
 * the keyboard starts to dismiss; a bar remounted mid-animation anchors to the
 * stale geometry and floats roughly a keyboard-height above the screen edge.
 * Any viewport or focus event during the window restarts it.
 */
export const KEYBOARD_CLOSE_SETTLE_MS = 350;

/** Input types that never raise an on-screen keyboard. */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether focusing `el` can put an on-screen keyboard up. */
export function isKeyboardTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.getAttribute('inputmode') === 'none') return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && !NON_TEXT_INPUT_TYPES.has(el.type);
  }
  return false;
}

/**
 * Whether the on-screen keyboard is currently occluding the viewport.
 *
 * Companion to `useKeyboardInset`, for consumers that only need a boolean —
 * chiefly fixed bottom bars, which iOS detaches from the screen bottom while
 * the keyboard is up (they end up floating mid-page over content). Hiding
 * them while this returns true avoids the artifact, and the remount when it
 * flips back to false forces WebKit to re-anchor the bar at the true bottom.
 *
 * Detection:
 * - Capacitor (native shell): `@capacitor/keyboard` show/hide window events.
 * - PWA / mobile browser: the `visualViewport` API — the keyboard is the gap
 *   between the layout and visual viewport bottoms, tracked on both `resize`
 *   and `scroll` since iOS Safari moves the visual viewport while it's up.
 *
 * Both paths also require a keyboard-raising element to be focused. Viewport
 * geometry alone produced false positives (pinch-zoom, iOS leaving the visual
 * viewport stale after a dismiss) that hid the rest timer with no keyboard on
 * screen until something happened to nudge the viewport — the "rest timer
 * sometimes disappears" bug. No focused text field means no keyboard.
 *
 * Opening is reported immediately; closing waits `KEYBOARD_CLOSE_SETTLE_MS`
 * for the viewport to settle so the remounted bar anchors at the real bottom.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const report = (next: boolean) => {
      clearTimeout(closeTimer);
      if (next) {
        setOpen(true);
      } else {
        closeTimer = setTimeout(() => setOpen(false), KEYBOARD_CLOSE_SETTLE_MS);
      }
    };
    const focused = () => isKeyboardTarget(document.activeElement);

    if (isNativePlatform()) {
      let shown = false;
      const evaluate = () => report(shown && focused());
      const onShow = () => {
        shown = true;
        evaluate();
      };
      const onHide = () => {
        shown = false;
        evaluate();
      };

      window.addEventListener('keyboardWillShow', onShow);
      window.addEventListener('keyboardDidShow', onShow);
      window.addEventListener('keyboardWillHide', onHide);
      window.addEventListener('keyboardDidHide', onHide);
      // A missed hide event must not strand the bar: losing focus ends it.
      document.addEventListener('focusin', evaluate);
      document.addEventListener('focusout', evaluate);

      return () => {
        clearTimeout(closeTimer);
        window.removeEventListener('keyboardWillShow', onShow);
        window.removeEventListener('keyboardDidShow', onShow);
        window.removeEventListener('keyboardWillHide', onHide);
        window.removeEventListener('keyboardDidHide', onHide);
        document.removeEventListener('focusin', evaluate);
        document.removeEventListener('focusout', evaluate);
      };
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const occluded = window.innerHeight - viewport.height - viewport.offsetTop;
        report(focused() && occluded > MIN_KEYBOARD_PX);
      });
    };

    onChange();
    viewport.addEventListener('resize', onChange);
    viewport.addEventListener('scroll', onChange);
    document.addEventListener('focusin', onChange);
    document.addEventListener('focusout', onChange);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(closeTimer);
      viewport.removeEventListener('resize', onChange);
      viewport.removeEventListener('scroll', onChange);
      document.removeEventListener('focusin', onChange);
      document.removeEventListener('focusout', onChange);
    };
  }, []);

  return open;
}
