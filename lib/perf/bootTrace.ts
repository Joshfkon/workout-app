/**
 * Cold-start boot tracing (perf work: "6-7s cold start, two loading animations").
 *
 * Thin wrappers over performance.mark that build a single boot timeline,
 * readable three ways:
 *   - `performance.getEntriesByType('mark')` (names are `boot:*`) in DevTools
 *     or the Performance panel / Safari Web Inspector timeline,
 *   - `window.__BOOT_TRACE__` — [name, msSinceNavigationStart] tuples,
 *   - `localStorage.bootTrace = '1'` → console.table dump when Home paints.
 *
 * Mark points (all relative to navigationStart / timeOrigin):
 *   boot:js-eval            first app client chunk starts evaluating
 *   boot:app-mount          React mounted (SplashProvider effect)
 *   boot:auth-start/-resolved     Log page's client auth check
 *   boot:data-start/-first-batch/-resolved  Log page's boot data fetches
 *   boot:home-paint         Log page painted with real data (post-rAF)
 *
 * Every call is wrapped in try/catch and no-ops on the server — safe to call
 * unconditionally from any client module.
 */

type BootEntry = [name: string, tMs: number];

declare global {
  interface Window {
    __BOOT_TRACE__?: BootEntry[];
  }
}

const hasPerf =
  typeof window !== 'undefined' && typeof performance !== 'undefined';

export function bootMark(name: string): void {
  if (!hasPerf) return;
  try {
    const full = `boot:${name}`;
    // Only the first occurrence counts — boot happens once, but the marking
    // components can remount (StrictMode, SPA revisits).
    if (window.__BOOT_TRACE__?.some(([n]) => n === full)) return;
    performance.mark(full);
    (window.__BOOT_TRACE__ ??= []).push([
      full,
      Math.round(performance.now()),
    ]);
    // Let boot-orchestration code react to milestones (e.g. the native
    // Capacitor splash hides on 'boot:home-paint') without polling.
    window.dispatchEvent(new CustomEvent('bootmark', { detail: full }));
  } catch {
    /* never let tracing break boot */
  }
}

/** True once the given mark has been recorded this boot. */
export function hasBootMark(name: string): boolean {
  if (!hasPerf) return false;
  return Boolean(window.__BOOT_TRACE__?.some(([n]) => n === `boot:${name}`));
}

/** Dump the timeline to the console when `localStorage.bootTrace === '1'`. */
export function bootTraceDump(): void {
  if (!hasPerf) return;
  try {
    if (localStorage.getItem('bootTrace') !== '1') return;
    // eslint-disable-next-line no-console
    console.table(
      (window.__BOOT_TRACE__ ?? []).map(([name, t]) => ({ mark: name, 'ms from nav start': t }))
    );
  } catch {
    /* ignore */
  }
}

// Module-scope side effect: this module is imported by the root-layout client
// providers, so its evaluation is a good proxy for "app JS bundle eval start".
bootMark('js-eval');
