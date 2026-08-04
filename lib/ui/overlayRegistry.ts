/**
 * Tiny global registry of "an overlay is currently open".
 *
 * Modals and bottom sheets render at z-50 from wherever they happen to sit in
 * the tree, while app-chrome floaters (the resume-workout pill) are fixed at
 * the layout root and paint *after* page content. Equal z-index + later DOM
 * order means the chrome wins, so the resume pill used to sit on top of the
 * "Log body data" sheet and cover the weight field.
 *
 * Rather than escalating z-index forever, overlays register here for as long
 * as they're open and chrome subscribes so it can get out of the way.
 *
 * Deliberately framework-free (module state + listeners) so it works across
 * portals, lazily-imported sheets, and separate React roots.
 */

let openCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Mark an overlay as open. Returns a release function that is safe to call
 * more than once (React 18 StrictMode double-invokes effect cleanups).
 */
export function openOverlay(): () => void {
  openCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

export function getOpenOverlayCount(): number {
  return openCount;
}

export function subscribeOverlays(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper — drops all state so suites don't leak counts into each other. */
export function resetOverlayRegistry(): void {
  openCount = 0;
  listeners.clear();
}
