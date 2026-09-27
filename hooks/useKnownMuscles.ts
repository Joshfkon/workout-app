'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { rollingWindowStartISO } from '@/lib/date/localDay';
import type { StandardMuscleGroup } from '@/types/schema';
import {
  knownMusclesFromExercises,
  KNOWN_MUSCLE_LOOKBACK_DAYS,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readinessStatus';

/**
 * Standard muscles the user has credited working sets for within the
 * known-muscles lookback ({@link KNOWN_MUSCLE_LOOKBACK_DAYS}) — the evidence
 * that separates "Fresh, just not trained this week" from "unknown, no data".
 *
 * Keyed under the 'muscle-readiness-history' prefix so a finished workout
 * invalidates it with the rest of the readiness feed. Returns `undefined`
 * while loading or on error: buildReadinessRows then falls back to window-only
 * evidence (the conservative reading — missing data never reads as fresh).
 */
export function useKnownMuscles(
  now: Date,
  enabled: boolean
): { knownMuscles: Set<StandardMuscleGroup> | undefined; isLoading: boolean } {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;
  const windowStart = useMemo(
    () => rollingWindowStartISO(KNOWN_MUSCLE_LOOKBACK_DAYS, now),
    [now]
  );

  const query = useQuery<Set<StandardMuscleGroup>>({
    queryKey: ['muscle-readiness-history', userId, 'known', windowStart],
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercise_blocks')
        .select(`
          exercises!inner ( primary_muscle, secondary_muscles ),
          workout_sessions!inner ( completed_at, user_id, state ),
          set_logs ( is_warmup )
        `)
        .eq('workout_sessions.user_id', userId)
        .eq('workout_sessions.state', 'completed')
        .gte('workout_sessions.completed_at', windowStart);
      if (error) throw error;

      type KnownRow = {
        exercises: { primary_muscle: string | null; secondary_muscles: string[] | null } | null;
        set_logs: { is_warmup: boolean | null }[] | null;
      };
      const worked = ((data as KnownRow[] | null) ?? []).flatMap((row) =>
        row.exercises?.primary_muscle && (row.set_logs ?? []).some((s) => !s.is_warmup)
          ? [
              {
                primaryMuscle: row.exercises.primary_muscle,
                secondaryMuscles: row.exercises.secondary_muscles ?? [],
              },
            ]
          : []
      );
      return knownMusclesFromExercises(worked);
    },
  });

  return { knownMuscles: query.data, isLoading: query.isLoading };
}
