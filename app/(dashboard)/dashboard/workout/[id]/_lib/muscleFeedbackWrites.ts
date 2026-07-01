/**
 * muscleFeedbackWrites.ts
 *
 * Helpers that persist per-muscle session feedback (session_muscle_feedback),
 * the input data for services/weeklyProgressionEngine:
 *   - pump / workload    → captured at the END of the session that trained the
 *                          muscle (SessionSummary chip rows)
 *   - soreness_before    → captured at the START of the next session hitting
 *                          the same muscle, written onto the PREVIOUS session's
 *                          row (it describes recovery from that session)
 *
 * Schema confirmed from migrations:
 *   - session_muscle_feedback: supabase/migrations/20260701000001_session_muscle_feedback.sql
 *     (UNIQUE (session_id, muscle_group) → upsert onConflict)
 *
 * Kept as plain functions that receive the supabase client so the page stays
 * 'use client'. They surface errors (return them) rather than swallowing.
 */

import {
  DETAILED_TO_STANDARD_MAP,
  isDetailedMuscle,
  isStandardMuscle,
  legacyToStandardMuscles,
} from '@/types/schema';
import type {
  PumpRating0to3,
  SorenessRating,
  StandardMuscleGroup,
  WorkloadRating,
} from '@/types/schema';

type UntypedClient = ReturnType<
  typeof import('@/lib/supabase/client').createUntypedClient
>;

/**
 * Resolve any raw primary_muscle string (detailed, standard, or legacy) to a
 * StandardMuscleGroup — the granularity session_muscle_feedback is keyed on.
 * Returns null for unknown values so callers can drop them.
 */
export function resolvePrimaryMuscle(
  raw: string | null | undefined
): StandardMuscleGroup | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (isDetailedMuscle(lower)) return DETAILED_TO_STANDARD_MAP[lower];
  if (isStandardMuscle(lower)) return lower;
  const legacy = legacyToStandardMuscles(lower);
  return legacy.length > 0 ? legacy[0] : null;
}

export interface SessionMuscleFeedbackWrite {
  /** Session the feedback row belongs to (the session that TRAINED the muscle). */
  sessionId: string;
  muscleGroup: StandardMuscleGroup;
  pump?: PumpRating0to3;
  workload?: WorkloadRating;
  sorenessBefore?: SorenessRating;
}

/**
 * Upsert feedback rows keyed on (session_id, muscle_group).
 *
 * Only the columns present on each write are sent, so writing soreness_before
 * later does NOT clobber the pump/workload logged at session end (PostgREST's
 * ON CONFLICT update only touches payload columns). Writes are grouped by
 * column signature because a single PostgREST payload must be homogeneous.
 */
export async function upsertSessionMuscleFeedback(
  supabase: UntypedClient,
  userId: string,
  writes: SessionMuscleFeedbackWrite[]
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (writes.length === 0) return { ok: true, errors };

  // Group rows by which optional columns they carry (homogeneous payloads).
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const write of writes) {
    const row: Record<string, unknown> = {
      user_id: userId,
      session_id: write.sessionId,
      muscle_group: write.muscleGroup,
    };
    if (write.pump !== undefined) row.pump = write.pump;
    if (write.workload !== undefined) row.workload = write.workload;
    if (write.sorenessBefore !== undefined) row.soreness_before = write.sorenessBefore;

    const signature = Object.keys(row).sort().join(',');
    const group = groups.get(signature);
    if (group) group.push(row);
    else groups.set(signature, [row]);
  }

  for (const rows of Array.from(groups.values())) {
    const { error } = await supabase
      .from('session_muscle_feedback')
      .upsert(rows, { onConflict: 'session_id,muscle_group' });
    if (error) errors.push(error.message);
  }

  return { ok: errors.length === 0, errors };
}

export interface RecentMuscleSession {
  sessionId: string;
  completedAt: string; // ISO timestamp
}

/** Shape of the nested select in fetchRecentMuscleSessions. */
interface RecentSessionRow {
  id: string;
  completed_at: string | null;
  exercise_blocks:
    | Array<{ exercises: { primary_muscle: string | null } | null }>
    | null;
}

/**
 * Find, for each requested muscle, the most recent COMPLETED session within
 * the last `withinDays` days (default 4) whose blocks trained that muscle as
 * a primary mover. Used by the start-of-session soreness capture: the rating
 * is written onto that previous session's feedback row.
 */
export async function fetchRecentMuscleSessions(
  supabase: UntypedClient,
  args: {
    userId: string;
    muscles: StandardMuscleGroup[];
    /** Today's session — never a candidate for "previous". */
    excludeSessionId?: string;
    withinDays?: number;
  }
): Promise<{
  byMuscle: Partial<Record<StandardMuscleGroup, RecentMuscleSession>>;
  error?: string;
}> {
  const byMuscle: Partial<Record<StandardMuscleGroup, RecentMuscleSession>> = {};
  if (args.muscles.length === 0) return { byMuscle };

  const withinDays = args.withinDays ?? 4;
  const cutoff = new Date(
    Date.now() - withinDays * 24 * 60 * 60 * 1000
  ).toISOString();

  let query = supabase
    .from('workout_sessions')
    .select('id, completed_at, exercise_blocks(exercises(primary_muscle))')
    .eq('user_id', args.userId)
    .eq('state', 'completed')
    .gte('completed_at', cutoff)
    .order('completed_at', { ascending: false });
  if (args.excludeSessionId) {
    query = query.neq('id', args.excludeSessionId);
  }

  const { data, error } = await query;
  if (error) return { byMuscle, error: error.message };

  const wanted = new Set<StandardMuscleGroup>(args.muscles);
  for (const row of (data ?? []) as RecentSessionRow[]) {
    if (!row.completed_at) continue;
    for (const block of row.exercise_blocks ?? []) {
      const muscle = resolvePrimaryMuscle(block.exercises?.primary_muscle);
      if (!muscle || !wanted.has(muscle)) continue;
      // Rows are ordered newest-first, so the first hit per muscle wins.
      if (!byMuscle[muscle]) {
        byMuscle[muscle] = { sessionId: row.id, completedAt: row.completed_at };
      }
    }
  }

  return { byMuscle };
}
