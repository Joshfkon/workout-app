/**
 * Exercise Preferences Service
 *
 * Manages user exercise preferences (active, do_not_suggest, archived).
 * Works alongside exerciseService to filter exercises based on user preferences.
 *
 * Pure functions only — no database calls.
 * Use lib/actions/exercise-preferences.ts for DB operations.
 */

import type {
  ExerciseVisibilityStatus,
  ExerciseHideReason,
  UserExercisePreference,
  UserExercisePreferenceRow,
  ExercisePreferenceSummary,
  SetExerciseStatusInput,
} from '@/types/user-exercise-preferences';
import type { Exercise } from './exerciseService';
import {
  fetchUserExercisePreferences,
  deleteExercisePreference,
  upsertExercisePreference,
  bulkDeleteExercisePreferences,
  bulkUpsertExercisePreferences,
  deleteAllExercisePreferences,
} from '@/lib/actions/exercise-preferences';

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
    const { data, error } = await fetchUserExercisePreferences(userId);

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('Could not find the table') || error.code === '42P01') {
        console.warn('Exercise preferences table not found - returning empty preferences.');
        preferencesCache.set(userId, new Map());
        cacheTimestamp.set(userId, Date.now());
        return new Map();
      }
      console.warn('Failed to load exercise preferences:', error);
      return new Map();
    }

    const prefs = new Map<string, UserExercisePreference>();
    (data || []).forEach((row: UserExercisePreferenceRow) => {
      prefs.set(row.exercise_id, mapRowToPreference(row));
    });

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
    if (status === 'active') {
      const { error } = await deleteExercisePreference(userId, exerciseId);
      if (error) {
        console.error('Failed to delete exercise preference:', error);
        return false;
      }
    } else {
      const { error } = await upsertExercisePreference(userId, exerciseId, status, reason, reasonNote);
      if (error) {
        console.error('Failed to set exercise preference:', error);
        return false;
      }
    }

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
    if (status === 'active') {
      const { error } = await bulkDeleteExercisePreferences(userId, exerciseIds);
      if (error) {
        console.error('Failed to bulk delete exercise preferences:', error);
        return false;
      }
    } else {
      const { error } = await bulkUpsertExercisePreferences(userId, exerciseIds, status, reason);
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
 * Archive all exercises that require equipment the user doesn't have.
 * Requires pre-fetched exercise list.
 */
export async function bulkArchiveByEquipment(
  userId: string,
  allExercises: Exercise[],
  availableEquipment: string[],
  reason: ExerciseHideReason = 'no_equipment'
): Promise<{ archivedCount: number; success: boolean }> {
  try {
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
    const { error } = await deleteAllExercisePreferences(userId);
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
 * Get summary counts of preferences.
 * Requires pre-fetched exercise list.
 */
export function getPreferenceSummary(
  prefs: Map<string, UserExercisePreference>,
  totalExerciseCount: number
): ExercisePreferenceSummary {
  let doNotSuggestCount = 0;
  let archivedCount = 0;

  prefs.forEach((pref) => {
    if (pref.status === 'do_not_suggest') doNotSuggestCount++;
    if (pref.status === 'archived') archivedCount++;
  });

  const activeCount = totalExerciseCount - doNotSuggestCount - archivedCount;

  return {
    activeCount,
    doNotSuggestCount,
    archivedCount,
  };
}

/**
 * Filter exercises by status using pre-loaded preferences
 */
export function filterExercisesByStatus(
  exercises: Exercise[],
  prefs: Map<string, UserExercisePreference>,
  status: ExerciseVisibilityStatus
): Exercise[] {
  if (status === 'active') {
    return exercises.filter((ex) => {
      const pref = prefs.get(ex.id);
      return !pref || pref.status === 'active';
    });
  }

  return exercises.filter((ex) => {
    const pref = prefs.get(ex.id);
    return pref?.status === status;
  });
}

/**
 * Get exercises available for suggestions (excludes archived and do_not_suggest)
 */
export function getExercisesForSuggestion(
  exercises: Exercise[],
  prefs: Map<string, UserExercisePreference>
): Exercise[] {
  return exercises.filter((ex) => {
    const pref = prefs.get(ex.id);
    return !pref || pref.status === 'active';
  });
}

/**
 * Get exercises for list view (excludes archived, includes do_not_suggest)
 */
export function getExercisesForList(
  exercises: Exercise[],
  prefs: Map<string, UserExercisePreference>
): Exercise[] {
  return exercises.filter((ex) => {
    const pref = prefs.get(ex.id);
    return !pref || pref.status !== 'archived';
  });
}

/**
 * Search exercises including archived (with status marked)
 */
export function searchExercisesWithPreferences(
  exercises: Exercise[],
  prefs: Map<string, UserExercisePreference>,
  query: string
): Array<Exercise & { status: ExerciseVisibilityStatus; isArchived: boolean }> {
  const lowerQuery = query.toLowerCase().trim();

  if (!lowerQuery) {
    return [];
  }

  return exercises
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
