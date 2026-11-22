import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * false while React hydrates server HTML (and on the server), true on every
 * other client render — including the FIRST render of a client-side remount.
 *
 * Use it to gate client-only UI without a hydration mismatch. A
 * `useState(() => typeof window !== 'undefined')` flag is true on the client's
 * hydration render while the server rendered false, which mismatches; a
 * `useState(false)` + effect flag avoids that but flashes the false branch on
 * every remount. useSyncExternalStore uses the server snapshot only while
 * hydrating, so it does neither.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
