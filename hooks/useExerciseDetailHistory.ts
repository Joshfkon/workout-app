'use client';

/**
 * Full set history for one exercise, cached-first, for the tabbed exercise
 * detail sheet (History / Charts / Records tabs).
 *
 * Keyed under the persisted `history` prefix (see
 * `lib/query/queryClient.ts#PERSISTED_QUERY_PREFIXES`) so opening the sheet
 * mid-workout paints instantly from IndexedDB while a background refetch
 * picks up any newly completed session. All derivation (records, trend,
 * weekly volume) is pure and lives in `services/exerciseDetailAnalytics.ts`.
 */

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import {
  summarizeSessions,
  type ExerciseDetailSession,
  type ExerciseDetailSessionInput,
} from '@/services/exerciseDetailAnalytics';

export const exerciseDetailHistoryKey = (exerciseId: string) =>
  ['history', 'exerciseDetail', exerciseId] as const;

interface RawSetLog {
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  is_warmup: boolean | null;
  set_number: number | null;
  bodyweight_data?: {
    modification?: 'none' | 'weighted' | 'assisted';
    addedWeightKg?: number;
    assistanceWeightKg?: number;
    _needsReview?: boolean;
  } | null;
}

interface RawSessionJoin {
  id: string;
  completed_at: string | null;
  is_deload: boolean | null;
  /** Not in the schema yet — tolerated so a future location tag just works. */
  location_name?: string | null;
}

interface RawBlockRow {
  id: string;
  workout_sessions: RawSessionJoin | null;
  set_logs: RawSetLog[] | null;
}

async function fetchExerciseDetailHistory(
  exerciseId: string
): Promise<ExerciseDetailSession[]> {
  const supabase = createUntypedClient();
  const userId = await getLocalUserId(supabase);
  if (!userId) return [];

  const { data, error } = await supabase
    .from('exercise_blocks')
    .select(
      `
      id,
      workout_sessions!inner (
        id,
        completed_at,
        state,
        user_id,
        is_deload
      ),
      set_logs (
        weight_kg,
        reps,
        rpe,
        is_warmup,
        set_number,
        bodyweight_data
      )
    `
    )
    .eq('exercise_id', exerciseId)
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed')
    .order('workout_sessions(completed_at)', { ascending: false })
    .limit(500);

  if (error) throw error;

  // A session can contain multiple blocks of the same exercise — merge them.
  const bySession = new Map<string, ExerciseDetailSessionInput>();

  for (const block of (data ?? []) as RawBlockRow[]) {
    const session = block.workout_sessions;
    if (!session?.completed_at) continue;

    const sets = (block.set_logs ?? [])
      .filter((s) => !s.is_warmup && (s.weight_kg ?? 0) >= 0 && (s.reps ?? 0) > 0)
      .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
      .map((s) => ({
        weightKg: s.weight_kg ?? 0,
        reps: s.reps ?? 0,
        rpe: s.rpe ?? null,
        // "BW+25" display breakdown; migration-backfilled rows flagged
        // _needsReview keep the effective-load display.
        bw:
          s.bodyweight_data && !s.bodyweight_data._needsReview && s.bodyweight_data.modification
            ? {
                modification: s.bodyweight_data.modification,
                addedWeightKg: s.bodyweight_data.addedWeightKg,
                assistanceWeightKg: s.bodyweight_data.assistanceWeightKg,
              }
            : undefined,
      }));

    const existing = bySession.get(session.id);
    if (existing) {
      existing.sets.push(...sets);
    } else {
      bySession.set(session.id, {
        sessionId: session.id,
        date: session.completed_at,
        isDeload: session.is_deload === true,
        locationName: session.location_name ?? null,
        sets,
      });
    }
  }

  // Sessions where every logged set was a warmup carry no signal.
  return summarizeSessions(
    Array.from(bySession.values()).filter((s) => s.sets.length > 0)
  );
}

export function useExerciseDetailHistory(exerciseId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: exerciseDetailHistoryKey(exerciseId ?? 'none'),
    queryFn: () => fetchExerciseDetailHistory(exerciseId as string),
    enabled: enabled && !!exerciseId,
    // Completed history only changes when a workout finishes; keep it short
    // enough that reopening the sheet after finishing shows the new session.
    staleTime: 1000 * 60 * 2,
  });
}
