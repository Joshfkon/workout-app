/**
 * transferCandidates — DB glue for the cold-start estimation ladder.
 *
 * Fetches the user's recent completed set history across ALL exercises and
 * reduces it (via the pure engine builder) to one best-e1RM candidate per
 * exercise. weightEstimationEngine's transfer rungs use these to seed a
 * never-trained exercise from the user's real strength on a related one
 * (e.g. Seated Leg Curl from Lying Leg Curl) instead of profile heuristics.
 *
 * Exclusions (enforced both here and in the pure builder):
 *  - warmup sets
 *  - deload-session sets (held light on purpose)
 *  - soft-deleted exercises (exercises.deleted_at)
 */

import { createUntypedClient } from '@/lib/supabase/client';
import {
  buildTransferCandidatesFromRows,
  type TransferCandidate,
  type TransferSourceRow,
} from '@/services/weightEstimationEngine';

/** How far back transfer strength is trusted. Older strength is stale. */
const TRANSFER_LOOKBACK_DAYS = 180;

/** Row cap — recent-first, so this bounds the query without losing recency. */
const TRANSFER_ROW_LIMIT = 600;

interface RawSetRow {
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  is_warmup: boolean | null;
  exercise_blocks: {
    workout_sessions: {
      is_deload: boolean | null;
    } | null;
    exercises: {
      id: string;
      name: string;
      primary_muscle: string;
      movement_pattern: string | null;
      equipment_required: string[] | null;
      deleted_at: string | null;
    } | null;
  } | null;
}

/** Minimal query surface — any supabase client (typed or untyped) satisfies it. */
type QueryClient = { from: (table: string) => any };

export async function fetchTransferCandidates(
  userId: string,
  client?: QueryClient
): Promise<TransferCandidate[]> {
  try {
    const supabase = client ?? createUntypedClient();
    const cutoff = new Date(Date.now() - TRANSFER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('set_logs')
      .select(
        `
        weight_kg,
        reps,
        rpe,
        is_warmup,
        exercise_blocks!inner (
          workout_sessions!inner (
            user_id,
            state,
            is_deload
          ),
          exercises!inner (
            id,
            name,
            primary_muscle,
            movement_pattern,
            equipment_required,
            deleted_at
          )
        )
      `
      )
      .eq('exercise_blocks.workout_sessions.user_id', userId)
      .eq('exercise_blocks.workout_sessions.state', 'completed')
      .is('is_warmup', false)
      .not('weight_kg', 'is', null)
      .not('reps', 'is', null)
      .gte('logged_at', cutoff)
      .order('logged_at', { ascending: false })
      .limit(TRANSFER_ROW_LIMIT);

    if (error || !data) return [];

    const rows: TransferSourceRow[] = (data as RawSetRow[]).map((r) => ({
      weightKg: r.weight_kg ?? 0,
      reps: r.reps ?? 0,
      rpe: r.rpe,
      isWarmup: r.is_warmup,
      isDeload: r.exercise_blocks?.workout_sessions?.is_deload,
      exercise: {
        id: r.exercise_blocks?.exercises?.id,
        name: r.exercise_blocks?.exercises?.name ?? '',
        primaryMuscle: r.exercise_blocks?.exercises?.primary_muscle ?? '',
        movementPattern: r.exercise_blocks?.exercises?.movement_pattern,
        equipmentRequired: r.exercise_blocks?.exercises?.equipment_required,
        deletedAt: r.exercise_blocks?.exercises?.deleted_at,
      },
    }));

    return buildTransferCandidatesFromRows(rows);
  } catch {
    // Transfer candidates are an enhancement — a failed fetch degrades to the
    // profile heuristic, never blocks the workout page.
    return [];
  }
}
