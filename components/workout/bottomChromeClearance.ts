'use client';

import { useEffect, useState } from 'react';

/** Breathing room between the cleared element and the stack's top edge. */
const CLEARANCE_GAP_PX = 8;
/** Never scroll the element closer than this to the top of the screen. */
const TOP_MARGIN_PX = 8;
/**
 * Only clear the logger this soon after the lifter tapped it (the toast that
 * grows the stack arrives right after a logged set). Growth at any other time
 * is the lifter scrolling: the pinned Log set bar joins the stack when the
 * logger scrolls out of view, and clearing it then dragged them back down
 * (user report: "if I scroll up to see my sets it autoscrolls me back down").
 */
export const CLEAR_AFTER_TAP_MS = 6000;

/** Pure: should a stack growth at `now` scroll the logger clear? */
export function shouldClearAfterGrowth(
  now: number,
  lastLoggerTapAt: number | null,
  lastUserScrollAt: number | null
): boolean {
  if (lastLoggerTapAt == null || now - lastLoggerTapAt > CLEAR_AFTER_TAP_MS) return false;
  // The lifter has scrolled since that tap: their position wins.
  if (lastUserScrollAt != null && lastUserScrollAt >= lastLoggerTapAt) return false;
  return true;
}

/**
 * How far to scroll down so `target` sits above a fixed bottom stack whose
 * top edge is at `stackTop` (viewport px). 0 when nothing is covered, or when
 * the target is entirely below the stack (off-screen: the pinned Log set bar
 * stands in for it then, and yanking the page would be worse). Capped so the
 * target's top never scrolls above the screen. Pure.
 */
export function scrollToClear(
  target: { top: number; bottom: number },
  stackTop: number,
  gap: number = CLEARANCE_GAP_PX
): number {
  const limit = stackTop - gap;
  if (target.bottom <= limit) return 0; // already clear
  if (target.top >= stackTop) return 0; // fully under/below the stack
  const needed = Math.ceil(target.bottom - limit);
  const room = Math.max(0, Math.floor(target.top - TOP_MARGIN_PX));
  return Math.min(needed, room);
}

/**
 * Keep the active set logger above the workout's fixed bottom stack.
 *
 * The stack (toast · rest timer · pinned Log set) is `position: fixed`, so
 * when a toast joins it — "Set 2 logged · Undo", for 5 s after every set —
 * it grows UPWARD over whatever card is behind it, usually the logger the
 * lifter just tapped (UX panel round 20). Page bottom padding can't help
 * mid-page. So: whenever the stack gets taller, scroll by exactly the
 * overlap. Shrinking never scrolls back (the content was never moved under
 * the lifter's thumb in the first place). Only right after a tap in the
 * logger, and never once the lifter has scrolled (shouldClearAfterGrowth).
 */
export function useKeepLoggerClearOfBottomChrome(
  selector = '[data-active-logger]'
): (el: HTMLElement | null) => void {
  // A callback ref, not a RefObject: the page renders loading states before
  // the stack exists, and the observer must attach whenever it mounts.
  const [stack, setStack] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!stack || typeof ResizeObserver === 'undefined') return;
    let lastHeight = stack.getBoundingClientRect().height;
    let lastLoggerTapAt: number | null = null;
    let lastUserScrollAt: number | null = null;
    const onPointerDown = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.(selector) || stack.contains(t as Node)) lastLoggerTapAt = Date.now();
    };
    // Finger or wheel scrolling only (not our own smooth scroll).
    const onUserScroll = () => {
      lastUserScrollAt = Date.now();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('touchmove', onUserScroll, { passive: true });
    window.addEventListener('wheel', onUserScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      const rect = stack.getBoundingClientRect();
      const grew = rect.height > lastHeight + 1;
      lastHeight = rect.height;
      if (!grew || rect.height === 0) return;
      if (!shouldClearAfterGrowth(Date.now(), lastLoggerTapAt, lastUserScrollAt)) return;
      let scroll = 0;
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (stack.contains(el)) return;
        scroll = Math.max(scroll, scrollToClear(el.getBoundingClientRect(), rect.top));
      });
      if (scroll > 0) window.scrollBy({ top: scroll, behavior: 'smooth' });
    });
    observer.observe(stack);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('touchmove', onUserScroll);
      window.removeEventListener('wheel', onUserScroll);
    };
  }, [stack, selector]);
  return setStack;
}
