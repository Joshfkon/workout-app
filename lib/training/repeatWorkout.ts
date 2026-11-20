// ============================================================
// REPEAT A PREVIOUS WORKOUT
//
// Clones a completed session's EXERCISE LIST (not its logged weights) into a
// fresh ad-hoc session. Weights are re-estimated from the previous best set's
// E1RM via quickWeightEstimate, rep ranges from the previous average reps.
// Shared by the History page's repeat button and the Train tab's "Repeat
// previous workout" launcher so the two paths cannot drift.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { estimateE1RM, getLocalDateString } from '@/lib/utils';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';
import { insertWorkoutSessions } from '@/lib/training/sessionOrigin';
import { toLegacyMuscleGroup, type Experience } from '@/types/schema';

export interface RepeatableSet {
  weight_kg: number;
  reps: number;
}

export interface RepeatableExercise {
  exerciseId: string;
  name: string;
  sets: RepeatableSet[];
}

/**
 * Create a new planned ad-hoc session (origin 'repeat') containing the given
 * exercise list and return its id. Throws on failure; callers own loading
 * state and navigation.
 */
export async function createRepeatSession(
  supabase: SupabaseClient,
  userId: string,
  exercises: RepeatableExercise[]
): Promise<{ sessionId: string }> {
  if (exercises.length === 0) throw new Error('No exercises to repeat');

  // Fetch user profile for weight estimation
  const { data: userData } = await supabase
    .from('users')
    .select('height_cm, weight_kg, body_fat_percent, experience')
    .eq('id', userId)
    .single();

  const userWeightKg = userData?.weight_kg || 70;
  const heightCm = userData?.height_cm || 170;
  const bodyFatPercent = userData?.body_fat_percent || 20;
  const experience = (userData?.experience as Experience) || 'intermediate';

  const { data: sessions, error: sessionError } = await insertWorkoutSessions(supabase, [
    {
      user_id: userId,
      state: 'planned',
      planned_date: getLocalDateString(),
      completion_percent: 0,
      origin: 'repeat' as const,
    },
  ]);

  const session = sessions?.[0];
  if (sessionError || !session) {
    throw (sessionError as Error | null) || new Error('Failed to create workout session');
  }

  const exerciseBlocks = exercises.map((exercise, index) => {
    // Rep range around the previous workout's average reps
    const avgReps =
      exercise.sets.length > 0
        ? Math.round(exercise.sets.reduce((sum, set) => sum + set.reps, 0) / exercise.sets.length)
        : 10;
    const repRangeMin = Math.max(avgReps - 2, 5);
    const repRangeMax = Math.max(avgReps + 2, repRangeMin);
    const targetRir = 2;

    // E1RM from the previous workout's best set for this exercise
    const bestSet = exercise.sets.reduce<RepeatableSet | null>((best, set) => {
      const e1rm = estimateE1RM(set.weight_kg, set.reps);
      const bestE1rm = best ? estimateE1RM(best.weight_kg, best.reps) : 0;
      return e1rm > bestE1rm ? set : best;
    }, null);
    const knownE1RM = bestSet ? estimateE1RM(bestSet.weight_kg, bestSet.reps) : undefined;

    const weightEstimate = quickWeightEstimate(
      exercise.name,
      { min: repRangeMin, max: repRangeMax },
      targetRir,
      userWeightKg,
      heightCm,
      bodyFatPercent,
      experience,
      undefined, // regionalData
      'kg',
      knownE1RM
    );

    return {
      workout_session_id: session.id,
      exercise_id: exercise.exerciseId,
      order: index + 1,
      target_sets: Math.max(exercise.sets.length, 3), // At least 3 sets
      target_rep_range: [repRangeMin, repRangeMax],
      target_rir: targetRir,
      target_weight_kg: weightEstimate.recommendedWeight,
      target_rest_seconds: 120, // Default 2 minutes
      suggestion_reason: 'Repeated from previous workout',
      warmup_protocol: { sets: [] },
    };
  });

  const { error: blocksError } = await supabase.from('exercise_blocks').insert(exerciseBlocks);
  if (blocksError) throw blocksError;

  return { sessionId: session.id };
}

// ============================================================
// RECENT COMPLETED SESSIONS → REPEATABLE WORKOUTS
//
// One select + one mapping, shared by the Train tab's "Repeat previous
// workout" list and Home's freestyle "Repeat …" button, so the title and the
// clone list can't drift between the two.
// ============================================================

/** Columns the mapping below needs from `workout_sessions`. */
export const RECENT_SESSION_SELECT =
  'id, completed_at, started_at, duration_seconds, exercise_blocks(exercise_id, order, suggestion_reason, exercises(name, primary_muscle), set_logs(is_warmup, weight_kg, reps))';

type MaybeArray<T> = T | T[] | null;

export interface RecentSessionBlockRow {
  exercise_id: string;
  order: number | null;
  suggestion_reason: string | null;
  exercises: MaybeArray<{ name: string | null; primary_muscle: string | null }>;
  set_logs: { is_warmup: boolean | null; weight_kg: number | null; reps: number | null }[] | null;
}

export interface RecentSessionRow {
  id: string;
  completed_at: string;
  started_at: string | null;
  /** Active duration snapshot (pauses excluded); null for legacy sessions. */
  duration_seconds: number | null;
  exercise_blocks: RecentSessionBlockRow[] | null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function firstOf<T>(value: MaybeArray<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * "Pull · Back, Biceps" — the split-day name parsed from the blocks'
 * suggestion_reason ("Pull - Week 2 ...", written by the start path) plus the
 * top two muscle groups by working sets. Falls back gracefully when either
 * half is missing (ad-hoc sessions have neither a day name nor a plan).
 */
export function deriveWorkoutTitle(blocks: RecentSessionBlockRow[]): string {
  let dayName: string | null = null;
  for (const block of blocks) {
    const match = /^(.+?) - Week \d+/.exec(block.suggestion_reason ?? '');
    if (match) {
      dayName = match[1];
      break;
    }
  }

  const setsByGroup = new Map<string, number>();
  blocks.forEach((block) => {
    const workingSets = (block.set_logs ?? []).filter((l) => !l.is_warmup).length;
    if (workingSets === 0) return;
    const exercise = firstOf(block.exercises);
    const legacy = exercise?.primary_muscle ? toLegacyMuscleGroup(exercise.primary_muscle) : null;
    if (!legacy) return;
    setsByGroup.set(legacy, (setsByGroup.get(legacy) ?? 0) + workingSets);
  });
  const topMuscles = Array.from(setsByGroup.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([group]) => capitalize(group))
    .join(', ');

  if (dayName && topMuscles) return `${dayName} · ${topMuscles}`;
  return dayName ?? (topMuscles || 'Workout');
}

/**
 * The clone list for repeating a session: exercise ids + working sets in
 * block order. Weights feed E1RM re-estimation in createRepeatSession, not
 * the targets; reps are passed through untouched (plumbing, moved here
 * from the Train page).
 */
export function toRepeatableExercises(blocks: RecentSessionBlockRow[]): RepeatableExercise[] {
  return [...blocks]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((b) => ({
      exerciseId: b.exercise_id,
      name: firstOf(b.exercises)?.name ?? '',
      sets: (b.set_logs ?? [])
        .filter((l) => !l.is_warmup)
        .map((l) => ({ weight_kg: l.weight_kg ?? 0, reps: l.reps ?? 0 })),
    }))
    .filter((e) => e.exerciseId && e.name);
}
