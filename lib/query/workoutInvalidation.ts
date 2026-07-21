/**
 * Cache invalidation for workout-derived queries.
 *
 * Completed-workout data is cached cached-first with long stale times and
 * persisted to IndexedDB (see lib/query/queryClient.ts). "Immutable in
 * practice" holds for PAST sessions, but the newest edge changes every time a
 * workout finishes — so completion must explicitly invalidate the derived
 * caches, otherwise the History list, exercise-detail charts, and analytics
 * keep serving the pre-workout snapshot (up to their staleTime — 24h for the
 * history first page) while fresh-fetching surfaces (e.g. the History
 * calendar) already show the new session.
 */

import type { QueryClient } from '@tanstack/react-query';

/**
 * Query-key prefixes that derive from workout_sessions/set_logs and must be
 * refreshed once a new completion is visible in the DB:
 *  - 'history':   History list first page + per-exercise detail history
 *  - 'analytics': lift trends / progression inputs cached on Analytics
 *  - 'log':       the Train/log landing surface (recent sessions)
 */
export const WORKOUT_DERIVED_QUERY_PREFIXES = ['history', 'analytics', 'log'] as const;

/** Mark all workout-derived caches stale; mounted queries refetch immediately. */
export async function invalidateWorkoutDerivedCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    WORKOUT_DERIVED_QUERY_PREFIXES.map((prefix) =>
      queryClient.invalidateQueries({ queryKey: [prefix] })
    )
  );
}
