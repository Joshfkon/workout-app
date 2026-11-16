'use client';

/**
 * One pop-up at a time. While a blocking prompt (the AI consent dialog) is
 * open, lesser overlays — first-time tips, the "finish setup" card — wait,
 * instead of stacking on top of it on a new user's first screen.
 */

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

export function setBlockingPromptOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a blocking prompt is on screen. */
export function useBlockingPromptOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false
  );
}
