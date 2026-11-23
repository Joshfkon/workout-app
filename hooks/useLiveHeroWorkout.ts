'use client';

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import type { TodaysWorkout } from '@/components/dashboard/home/TodayHeroCard';

/**
 * Home's hero workout comes from the page's initial data (server render, or
 * Next's cached copy of it) and was never re-read. Discarding that workout —
 * from the resume pill on Home, or from the workout screen and then back —
 * left "Continue workout" pointing at a session that no longer existed.
 *
 * Everything under ['workout', …] is invalidated by both discard paths.
 */
export const WORKOUT_QUERY_PREFIX = 'workout';

export type LiveHeroState = { found: false } | { found: true; state: string };

/**
 * The hero as it really is now. Pure; exported for tests.
 *  - live unknown (loading / failed) → the hero unchanged
 *  - session gone (an ad-hoc discard deletes it) → null
 *  - reset to planned (a programme discard keeps the plan) → planned, 0 sets
 *  - otherwise the live state wins
 */
export function reconcileHeroWorkout(
  hero: TodaysWorkout | null,
  live: LiveHeroState | undefined
): TodaysWorkout | null {
  if (!hero || !live) return hero;
  if (!live.found) return null;
  if (live.state === hero.state) return hero;
  if (live.state === 'planned') return { ...hero, state: 'planned', completedSets: 0 };
  if (live.state === 'in_progress' || live.state === 'completed') return { ...hero, state: live.state };
  // Any other state (e.g. skipped/cancelled): nothing to continue.
  return null;
}

export function useLiveHeroWorkout(hero: TodaysWorkout | null): TodaysWorkout | null {
  const id = hero?.id ?? null;
  const { data } = useQuery<LiveHeroState>({
    queryKey: [WORKOUT_QUERY_PREFIX, 'hero-state', id],
    enabled: !!id,
    // Live state: a cached "in progress" is exactly the bug this fixes.
    staleTime: 0,
    queryFn: async () => {
      const { data: rows, error } = await createUntypedClient()
        .from('workout_sessions')
        .select('state')
        .eq('id', id as string)
        .limit(1);
      if (error) throw error;
      const row = rows?.[0] as { state: string } | undefined;
      return row ? { found: true, state: row.state } : { found: false };
    },
  });
  return reconcileHeroWorkout(hero, data);
}
