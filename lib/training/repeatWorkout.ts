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
import type { Experience } from '@/types/schema';

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
