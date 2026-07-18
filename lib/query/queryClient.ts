/**
 * Shared React Query client + persistence config (UX loading-states work).
 *
 * The app moved from "raw fetch in useEffect + full-screen spinner on every
 * navigation" to a cached-first / stale-while-revalidate model. React Query
 * holds the in-memory cache; a subset of queries is persisted to IndexedDB so
 * a cold start can paint the last-seen data instantly while it revalidates in
 * the background.
 *
 * Cache policy lives at the call site (per-query `staleTime`) — see
 * `hooks/useNutritionDay.ts` for the canonical example. The defaults here are
 * intentionally conservative: no refetch-on-focus (this is a mobile PWA where
 * focus churn is constant), a generous `gcTime` so a day/route the user
 * bounces away from and back to is still warm, and a short retry.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * First segment of a query key that is safe to persist to disk. Anything not
 * listed is memory-only — this deliberately EXCLUDES auth-sensitive or
 * volatile data (user rows, session tokens, live workout state). Immutable-
 * in-practice data (past nutrition days, completed history) benefits most.
 */
export const PERSISTED_QUERY_PREFIXES = [
  'log',            // the /dashboard/log landing surface — cold-start paint
  'nutrition',      // per-day food log — past days are immutable
  'history',        // completed workout sessions
  'analytics',      // DEXA / lift-trend history
  'exercises',      // static exercise catalog
  'templateDetail', // a single template's contents
  'templates',      // the folders + templates list
  'settings',       // user settings/preferences row
  'blood-pressure', // daily BP readings — history is immutable-in-practice
  'phases',         // training phase spans — low-frequency, drive the Body verdict
] as const;

export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  return (
    typeof head === 'string' &&
    (PERSISTED_QUERY_PREFIXES as readonly string[]).includes(head)
  );
}

/** gcTime for persisted, immutable-in-practice data: keep it warm for hours. */
export const IMMUTABLE_GC_TIME = 1000 * 60 * 60 * 24; // 24h

/**
 * How long the on-disk (IndexedDB) snapshot stays restorable. Deliberately
 * longer than the in-memory gcTime: a user coming back after a weekend should
 * still cold-start from cached content (stale data + background revalidate)
 * rather than a spinner — with 24h the whole persisted cache was discarded
 * after one skipped day.
 */
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cached-first: don't re-block the UI to refetch data we already have.
        staleTime: 1000 * 60 * 5, // 5 min default; call sites override
        gcTime: IMMUTABLE_GC_TIME,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });
}
