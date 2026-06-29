'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import type {
  ExerciseVisibilityStatus,
  ExerciseHideReason,
  UserExercisePreferenceRow,
} from '@/types/user-exercise-preferences';

/**
 * Fetch all exercise preference rows for a user
 */
export async function fetchUserExercisePreferences(
  userId: string
): Promise<{ data: UserExercisePreferenceRow[] | null; error: { code?: string; message?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const { data, error } = await supabase
    .from('user_exercise_preferences')
    .select('*')
    .eq('user_id', userId);

  return { data: data as UserExercisePreferenceRow[] | null, error };
}

/**
 * Delete an exercise preference (set status back to active)
 */
export async function deleteExercisePreference(
  userId: string,
  exerciseId: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const { error } = await supabase
    .from('user_exercise_preferences')
    .delete()
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId);

  return { error };
}

/**
 * Upsert an exercise preference
 */
export async function upsertExercisePreference(
  userId: string,
  exerciseId: string,
  status: ExerciseVisibilityStatus,
  reason?: ExerciseHideReason | null,
  reasonNote?: string | null
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const { error } = await supabase
    .from('user_exercise_preferences')
    .upsert(
      {
        user_id: userId,
        exercise_id: exerciseId,
        status,
        reason: reason || null,
        reason_note: reasonNote || null,
      },
      { onConflict: 'user_id,exercise_id' }
    );

  return { error };
}

/**
 * Bulk delete exercise preferences (set all back to active)
 */
export async function bulkDeleteExercisePreferences(
  userId: string,
  exerciseIds: string[]
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const { error } = await supabase
    .from('user_exercise_preferences')
    .delete()
    .eq('user_id', userId)
    .in('exercise_id', exerciseIds);

  return { error };
}

/**
 * Bulk upsert exercise preferences
 */
export async function bulkUpsertExercisePreferences(
  userId: string,
  exerciseIds: string[],
  status: ExerciseVisibilityStatus,
  reason?: ExerciseHideReason | null
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const rows = exerciseIds.map((exerciseId) => ({
    user_id: userId,
    exercise_id: exerciseId,
    status,
    reason: reason || null,
  }));

  const { error } = await supabase
    .from('user_exercise_preferences')
    .upsert(rows, { onConflict: 'user_id,exercise_id' });

  return { error };
}

/**
 * Delete all exercise preferences for a user (reset)
 */
export async function deleteAllExercisePreferences(
  userId: string
): Promise<{ error: { code?: string; message?: string } | null }> {
  const supabase = await createUntypedServerClient();
  const { error } = await supabase
    .from('user_exercise_preferences')
    .delete()
    .eq('user_id', userId);

  return { error };
}
