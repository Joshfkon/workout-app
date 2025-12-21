/**
 * Exercise Preferences Service
 *
 * Manages user exercise preferences (active, do_not_suggest, archived).
 * Works alongside exerciseService to filter exercises based on user preferences.
 */

import { createUntypedClient } from '@/lib/supabase/client';
import type {
  ExerciseVisibilityStatus,
  ExerciseHideReason,
  UserExercisePreference,
  UserExercisePreferenceRow,
  ExercisePreferenceSummary,
  SetExerciseStatusInput,
  BulkArchiveByEquipmentInput,
} from '@/types/user-exercise-preferences';
import { getExercises, type Exercise } from './exerciseService';

// ============================================
// CACHE
// ============================================

let preferencesCache: Map<string, Map<string, UserExercisePreference>> = new Map();
let cacheTimestamp: Map<string, number> = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Clear the preferences cache for a user (useful after updates)
 */
export function clearPreferencesCache(userId?: string): void {
  if (userId) {
    preferencesCache.delete(userId);
    cacheTimestamp.delete(userId);
  } else {
    preferencesCache.clear();
    cacheTimestamp.clear();
  }
}

// ============================================
// CORE API
// ============================================

/**
 * Get all exercise preferences for a user (from cache or DB)
 */
export async function getUserExercisePreferences(
  userId: string
): Promise<Map<string, UserExercisePreference>> {
  // Check cache
  const cachedTs = cacheTimestamp.get(userId);
  const cached = preferencesCache.get(userId);
  if (cached && cachedTs && Date.now() - cachedTs < CACHE_TTL) {
    return cached;
  }

  try {
    const supabase = createUntypedClient();
    const { data, error } = await supabase
      .from('user_exercise_preferences')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      console.warn('Failed to load exercise preferences:', error);
      return new Map();
    }

    const prefs = new Map<string, UserExercisePreference>();
    (data || []).forEach((row: UserExercisePreferenceRow) => {
      prefs.set(row.exercise_id, mapRowToPreference(row));
    });

    // Update cache
    preferencesCache.set(userId, prefs);
    cacheTimestamp.set(userId, Date.now());

    return prefs;
  } catch (err) {
    console.warn('Error fetching exercise preferences:', err);
    return new Map();
  }
}

/**
 * Get the status of a specific exercise for a user
 */
export async function getExerciseStatus(
  userId: string,
  exerciseId: string
): Promise<ExerciseVisibilityStatus> {
  const prefs = await getUserExercisePreferences(userId);
  const pref = prefs.get(exerciseId);
  return pref?.status || 'active';
}

/**
 * Get the full preference for a specific exercise
 */
export async function getExercisePreference(
  userId: string,
  exerciseId: string
): Promise<UserExercisePreference | null> {
  const prefs = await getUserExercisePreferences(userId);
  return prefs.get(exerciseId) || null;
}

/**
 * Set the status of an exercise for a user (upsert)
 */
export async function setExerciseStatus(
  userId: string,
  input: SetExerciseStatusInput
): Promise<boolean> {
  const { exerciseId, status, reason, reasonNote } = input;

  try {
    const supabase = createUntypedClient();

    // If setting to active, we can just delete the preference row
    if (status === 'active') {
      const { error } = await supabase
        .from('user_exercise_preferences')
        .delete()
        .eq('user_id', userId)
        .eq('exercise_id', exerciseId);

      if (error) {
        console.error('Failed to delete exercise preference:', error);
        return false;
      }
    } else {
      // Upsert the preference
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

      if (error) {
        console.error('Failed to set exercise preference:', error);
        return false;
      }
    }

    // Clear cache
    clearPreferencesCache(userId);
    return true;
  } catch (err) {
    console.error('Error setting exercise preference:', err);
    return false;
  }
}

/**
 * Bulk set status for multiple exercises
 */
export async function bulkSetExerciseStatus(
  userId: string,
  exerciseIds: string[],
  status: ExerciseVisibilityStatus,
  reason?: ExerciseHideReason
): Promise<boolean> {
  if (exerciseIds.length === 0) return true;

  try {
    const supabase = createUntypedClient();

    if (status === 'active') {
      // Delete all preferences for these exercises
      const { error } = await supabase
        .from('user_exercise_preferences')
        .delete()
        .eq('user_id', userId)
        .in('exercise_id', exerciseIds);

      if (error) {
        console.error('Failed to bulk delete exercise preferences:', error);
        return false;
      }
    } else {
      // Upsert all preferences
      const rows = exerciseIds.map((exerciseId) => ({
        user_id: userId,
        exercise_id: exerciseId,
        status,
        reason: reason || null,
      }));

      const { error } = await supabase
        .from('user_exercise_preferences')
        .upsert(rows, { onConflict: 'user_id,exercise_id' });

      if (error) {
        console.error('Failed to bulk set exercise preferences:', error);
        return false;
      }
    }

    clearPreferencesCache(userId);
    return true;
  } catch (err) {
    console.error('Error bulk setting exercise preferences:', err);
    return false;
  }
}

/**
 * Archive all exercises that require equipment the user doesn't have
 */
export async function bulkArchiveByEquipment(
  userId: string,
  input: BulkArchiveByEquipmentInput
): Promise<{ archivedCount: number; success: boolean }> {
  const { availableEquipment, reason = 'no_equipment' } = input;

  try {
    // Get all exercises
    const allExercises = await getExercises(true);

    // Find exercises that require equipment not in the available list
    const toArchive = allExercises.filter(
      (ex) => !availableEquipment.includes(ex.equipment)
    );

    if (toArchive.length === 0) {
      return { archivedCount: 0, success: true };
    }

    const success = await bulkSetExerciseStatus(
      userId,
      toArchive.map((ex) => ex.id),
      'archived',
      reason
    );

    return { archivedCount: toArchive.length, success };
  } catch (err) {
    console.error('Error bulk archiving by equipment:', err);
    return { archivedCount: 0, success: false };
  }
}

/**
 * Reset all exercise preferences for a user (unarchive all, re-enable suggestions)
 */
export async function resetAllPreferences(userId: string): Promise<boolean> {
  try {
    const supabase = createUntypedClient();

    const { error } = await supabase
      .from('user_exercise_preferences')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to reset exercise preferences:', error);
      return false;
    }

    clearPreferencesCache(userId);
    return true;
  } catch (err) {
    console.error('Error resetting exercise preferences:', err);
    return false;
  }
}

/**
 * Get summary counts of preferences
 */
export async function getPreferenceSummary(
  userId: string
): Promise<ExercisePreferenceSummary> {
  const prefs = await getUserExercisePreferences(userId);
  const allExercises = await getExercises(true);

  let doNotSuggestCount = 0;
  let archivedCount = 0;

  prefs.forEach((pref) => {
    if (pref.status === 'do_not_suggest') doNotSuggestCount++;
    if (pref.status === 'archived') archivedCount++;
  });

  // Active count is total exercises minus the ones with preferences
  const activeCount = allExercises.length - doNotSuggestCount - archivedCount;

  return {
    activeCount,
    doNotSuggestCount,
    archivedCount,
  };
}

/**
 * Get all exercises with a specific status
 */
export async function getExercisesWithStatus(
  userId: string,
  status: ExerciseVisibilityStatus
): Promise<Exercise[]> {
  const prefs = await getUserExercisePreferences(userId);
  const allExercises = await getExercises(true);

  if (status === 'active') {
    // Return exercises that don't have a preference OR have active status
    return allExercises.filter((ex) => {
      const pref = prefs.get(ex.id);
      return !pref || pref.status === 'active';
    });
  }

  // Return exercises with the specific status
  return allExercises.filter((ex) => {
    const pref = prefs.get(ex.id);
    return pref?.status === status;
  });
}

/**
 * Get exercises available for suggestions (excludes archived and do_not_suggest)
 */
export async function getExercisesForSuggestion(userId: string): Promise<Exercise[]> {
  const prefs = await getUserExercisePreferences(userId);
  const allExercises = await getExercises(true);

  return allExercises.filter((ex) => {
    const pref = prefs.get(ex.id);
    // Only include if no preference (defaults to active) or explicitly active
    return !pref || pref.status === 'active';
  });
}

/**
 * Get exercises for the list view (excludes archived, includes do_not_suggest)
 */
export async function getExercisesForList(userId: string): Promise<Exercise[]> {
  const prefs = await getUserExercisePreferences(userId);
  const allExercises = await getExercises(true);

  return allExercises.filter((ex) => {
    const pref = prefs.get(ex.id);
    // Exclude only archived exercises
    return !pref || pref.status !== 'archived';
  });
}

/**
 * Search exercises including archived (with status marked)
 */
export async function searchExercisesWithPreferences(
  userId: string,
  query: string
): Promise<Array<Exercise & { status: ExerciseVisibilityStatus; isArchived: boolean }>> {
  const prefs = await getUserExercisePreferences(userId);
  const allExercises = await getExercises(true);
  const lowerQuery = query.toLowerCase().trim();

  if (!lowerQuery) {
    return [];
  }

  return allExercises
    .filter((ex) => ex.name.toLowerCase().includes(lowerQuery))
    .map((ex) => {
      const pref = prefs.get(ex.id);
      const status = pref?.status || 'active';
      return {
        ...ex,
        status,
        isArchived: status === 'archived',
      };
    });
}

// ============================================
// MAPPING HELPERS
// ============================================

function mapRowToPreference(row: UserExercisePreferenceRow): UserExercisePreference {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseId: row.exercise_id,
    status: row.status,
    reason: row.reason || undefined,
    reasonNote: row.reason_note || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
