'use client';

import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { getWeekSessionsFromProgramData } from '@/services/mesocycleHelpers';
import { plannedSessionsPerWeekByMuscle } from '@/services/plannedFrequency';
import type { FullProgramRecommendation, StandardMuscleGroup } from '@/types/schema';

/**
 * usePlannedFrequency — PLANNED sessions per muscle per week, read from the
 * active mesocycle's stored program.
 *
 * This is the `perMuscle` source for the recovery dose model's session-capacity
 * denominator (MRV / planned frequency). It reads `mesocycles.program_data`,
 * which holds the whole generated plan including each session's exercises, and
 * counts how many sessions in the CURRENT week touch each muscle.
 *
 * Deliberately plan-derived, never history-derived: see the module header in
 * services/plannedFrequency for why trailing observed sessions would make a
 * completed session's recovery window shrink as the rest of the week filled in.
 *
 * Users with no active mesocycle (freestyle logging, templates only) get an
 * empty map, and the recovery engine falls back to
 * DEFAULT_PLANNED_SESSIONS_PER_WEEK — reported as `plannedFrequencySource:
 * 'fallback'` in dose diagnostics and counted in the frequency-source metrics.
 */

export const PLANNED_FREQUENCY_QUERY_KEY_PREFIX = 'planned-frequency';
const QUERY_KEY_PREFIX = PLANNED_FREQUENCY_QUERY_KEY_PREFIX;

/**
 * Drop the cached plan so the next read re-derives frequency. Call this from
 * any CLIENT-side path that generates, replaces or advances a mesocycle.
 *
 * This is belt-and-braces, not the only defence: the weekly rollover advances
 * `current_week` inside startMesocycleSession, a server-side path with no
 * queryClient to invalidate from, so the short staleTime below is what actually
 * bounds staleness in the general case.
 */
export function invalidatePlannedFrequency(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: [PLANNED_FREQUENCY_QUERY_KEY_PREFIX] });
}

const EMPTY: Partial<Record<StandardMuscleGroup, number>> = {};

export function usePlannedFrequency(): {
  plannedSessionsPerWeekByMuscle: Partial<Record<StandardMuscleGroup, number>>;
  isLoading: boolean;
  /** True when an active mesocycle supplied the map. */
  hasPlan: boolean;
} {
  // Selector form (project convention): minimizes re-renders, and keeps this
  // hook usable from surfaces whose tests stub the store with a selector.
  const storeUserId = useUserStore((s) => s.user?.id);
  const { user: authUser } = useAuthUser();
  const userId = storeUserId || authUser?.id || null;

  const query = useQuery<{ programData: FullProgramRecommendation | null; currentWeek: number }>({
    queryKey: [QUERY_KEY_PREFIX, userId],
    enabled: !!userId,
    // Deliberately SHORT. The obvious reading is that a plan changes rarely so
    // the cache can stay warm — but the two events that change it (generating a
    // mesocycle, and the weekly rollover advancing current_week) are exactly
    // the moments the frequency is wrong, and the rollover happens server-side
    // in startMesocycleSession where no client invalidation can reach it. A
    // long staleTime would leave readiness and soreness learning normalizing
    // against the previous week's session capacity. One small row, refetched at
    // most once a minute, is the cheaper trade.
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('mesocycles')
        .select('program_data, current_week')
        .eq('user_id', userId)
        .eq('state', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return {
        programData: (data?.program_data as FullProgramRecommendation | null) ?? null,
        currentWeek: (data?.current_week as number | null) ?? 1,
      };
    },
  });

  const byMuscle = useMemo(() => {
    const programData = query.data?.programData;
    if (!programData) return EMPTY;
    const sessions = getWeekSessionsFromProgramData(programData, query.data?.currentWeek ?? 1);
    if (sessions.length === 0) return EMPTY;
    const counts = plannedSessionsPerWeekByMuscle(sessions);
    return Object.keys(counts).length > 0 ? counts : EMPTY;
  }, [query.data]);

  return {
    plannedSessionsPerWeekByMuscle: byMuscle,
    isLoading: query.isLoading,
    hasPlan: byMuscle !== EMPTY,
  };
}
