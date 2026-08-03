'use client';

/**
 * useMesocyclePlan — the data behind the read-only mesocycle preview
 * (/dashboard/mesocycle/plan): one mesocycle row (the active one by default,
 * or an explicit id for a past block) plus its completed-session count, which
 * is what marks a session done / next in the preview.
 *
 * React Query, cached-first per the app's loading-state model: the plan is
 * immutable in practice (program_data only changes when the user regenerates
 * the block), so revisits paint from cache and revalidate in the background.
 * Deliberately NOT in PERSISTED_QUERY_PREFIXES — program_data is a large JSON
 * blob and cheap to refetch, so it stays memory-only.
 *
 * Writers that rewrite program_data (the Mesocycle page's regenerate path)
 * must invalidate MESOCYCLE_PLAN_QUERY_PREFIX so the preview can't advertise
 * a program the start path no longer serves.
 */

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { countCompletedSessions } from '@/lib/training/startMesocycleSession';
import type { ExerciseOverride } from '@/services/mesocycleHelpers';
import type { WorkoutDay } from '@/types/schema';

export const MESOCYCLE_PLAN_QUERY_PREFIX = 'mesocyclePlan';

/** The mesocycle fields the preview renders. */
export interface MesocyclePlanRow {
  id: string;
  name: string;
  state: string;
  split_type: string;
  total_weeks: number;
  current_week: number;
  days_per_week: number;
  deload_week: number;
  session_duration_minutes: number | null;
  start_date: string | null;
  preferred_workout_days: WorkoutDay[] | null;
  program_data: unknown;
  exercise_overrides?: ExerciseOverride[] | null;
}

export interface MesocyclePlanData {
  mesocycle: MesocyclePlanRow | null;
  /** TOTAL completed sessions for the block (0 when there's no mesocycle). */
  completedSessions: number;
}

const PLAN_COLUMNS =
  'id, name, state, split_type, total_weeks, current_week, days_per_week, deload_week, ' +
  'session_duration_minutes, start_date, preferred_workout_days, program_data, exercise_overrides';

async function fetchMesocyclePlan(mesocycleId: string | null): Promise<MesocyclePlanData> {
  const supabase = createUntypedClient();
  // Local-session identity (no auth round trip); RLS still scopes the read.
  const userId = await getLocalUserId(supabase);
  if (!userId) return { mesocycle: null, completedSessions: 0 };

  let query = supabase.from('mesocycles').select(PLAN_COLUMNS).eq('user_id', userId);
  query = mesocycleId
    ? query.eq('id', mesocycleId)
    : // No id: the active block, newest first if several are somehow active.
      query.eq('state', 'active').order('created_at', { ascending: false });

  const { data, error } = await query.limit(1);
  if (error) throw error;

  const mesocycle = (data?.[0] as MesocyclePlanRow | undefined) ?? null;
  if (!mesocycle) return { mesocycle: null, completedSessions: 0 };

  const completedSessions = await countCompletedSessions(supabase, mesocycle.id);
  return { mesocycle, completedSessions };
}

export function mesocyclePlanKey(mesocycleId: string | null) {
  return [MESOCYCLE_PLAN_QUERY_PREFIX, mesocycleId ?? 'active'] as const;
}

/**
 * @param mesocycleId Explicit block to preview, or null/undefined for the
 *                    user's active mesocycle.
 */
export function useMesocyclePlan(mesocycleId?: string | null) {
  return useQuery({
    queryKey: mesocyclePlanKey(mesocycleId ?? null),
    queryFn: () => fetchMesocyclePlan(mesocycleId ?? null),
    // The program only changes on an explicit regenerate (which invalidates);
    // the completed count changes at most once per workout.
    staleTime: 1000 * 60 * 2,
  });
}
