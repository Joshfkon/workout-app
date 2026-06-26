'use server';

import { createUntypedClient } from '@/lib/supabase/client';
import type {
  ExerciseVarietyPreferencesRow,
  ExerciseUsageRow,
  UpdateVarietyPreferencesInput,
} from '@/types/user-exercise-preferences';

/**
 * Fetch variety preferences for a user
 */
export async function fetchVarietyPreferences(
  userId: string
): Promise<{ data: ExerciseVarietyPreferencesRow | null; error: { code?: string; message?: string } | null }> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from('exercise_variety_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  return { data: data as ExerciseVarietyPreferencesRow | null, error };
}

/**
 * Upsert variety preferences
 */
export async function upsertVarietyPreferences(
  userId: string,
  input: UpdateVarietyPreferencesInput,
  defaults: { varietyLevel: string; rotationFrequency: number; minPoolSize: number; prioritizeTopTier: boolean }
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = createUntypedClient();
  const { error } = await supabase
    .from('exercise_variety_preferences')
    .upsert(
      {
        user_id: userId,
        variety_level: input.varietyLevel ?? defaults.varietyLevel,
        rotation_frequency: input.rotationFrequency ?? defaults.rotationFrequency,
        min_pool_size: input.minPoolSize ?? defaults.minPoolSize,
        prioritize_top_tier: input.prioritizeTopTier ?? defaults.prioritizeTopTier,
      },
      { onConflict: 'user_id' }
    );

  return { error };
}

/**
 * Delete variety preferences (reset to defaults)
 */
export async function deleteVarietyPreferences(
  userId: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = createUntypedClient();
  const { error } = await supabase
    .from('exercise_variety_preferences')
    .delete()
    .eq('user_id', userId);

  return { error };
}

/**
 * Insert an exercise usage record
 */
export async function insertExerciseUsage(
  userId: string,
  exerciseId: string,
  muscleGroup: string,
  sessionId?: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = createUntypedClient();
  const { error } = await supabase
    .from('exercise_usage_history')
    .insert({
      user_id: userId,
      exercise_id: exerciseId,
      muscle_group: muscleGroup.toLowerCase(),
      session_id: sessionId ?? null,
    });

  return { error };
}

/**
 * Upsert multiple exercise usage records
 */
export async function upsertMultipleExerciseUsage(
  userId: string,
  exercises: Array<{ exerciseId: string; muscleGroup: string }>,
  sessionId?: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = createUntypedClient();
  const rows = exercises.map((ex) => ({
    user_id: userId,
    exercise_id: ex.exerciseId,
    muscle_group: ex.muscleGroup.toLowerCase(),
    session_id: sessionId ?? null,
  }));

  const { error } = await supabase
    .from('exercise_usage_history')
    .upsert(rows, { onConflict: 'user_id,exercise_id,session_id' });

  return { error };
}

/**
 * Fetch recent exercise usage records
 */
export async function fetchRecentExerciseUsage(
  userId: string,
  cutoffDate: Date
): Promise<{ data: ExerciseUsageRow[] | null; error: { code?: string; message?: string } | null }> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from('exercise_usage_history')
    .select('*')
    .eq('user_id', userId)
    .gte('used_at', cutoffDate.toISOString())
    .order('used_at', { ascending: false });

  return { data: data as ExerciseUsageRow[] | null, error };
}
