/**
 * Exercise Variety Service
 *
 * Manages exercise variety preferences and implements smart exercise rotation.
 * When variety is enabled, exercises are rotated per muscle group across sessions
 * to provide more diverse training stimulus.
 *
 * Pure functions only — no database calls.
 * Use lib/actions/exercise-variety.ts for DB operations.
 */

import type {
  ExerciseVarietyLevel,
  ExerciseVarietyPreferences,
  ExerciseVarietyPreferencesRow,
  ExerciseUsageRecord,
  ExerciseUsageRow,
  UpdateVarietyPreferencesInput,
} from '@/types/user-exercise-preferences';
import type { Exercise } from './exerciseService';
import {
  fetchVarietyPreferences,
  upsertVarietyPreferences,
  deleteVarietyPreferences,
  insertExerciseUsage,
  upsertMultipleExerciseUsage,
  fetchRecentExerciseUsage,
} from '@/lib/actions/exercise-variety';

// ============================================
// CACHE
// ============================================

let varietyPrefsCache: Map<string, ExerciseVarietyPreferences | null> = new Map();
let varietyCacheTimestamp: Map<string, number> = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

let usageHistoryCache: Map<string, Map<string, ExerciseUsageRecord[]>> = new Map();
let usageCacheTimestamp: Map<string, number> = new Map();
const USAGE_CACHE_TTL = 30 * 1000; // 30 seconds (shorter for usage data)

/**
 * Clear the variety preferences cache
 */
export function clearVarietyCache(userId?: string): void {
  if (userId) {
    varietyPrefsCache.delete(userId);
    varietyCacheTimestamp.delete(userId);
    usageHistoryCache.delete(userId);
    usageCacheTimestamp.delete(userId);
  } else {
    varietyPrefsCache.clear();
    varietyCacheTimestamp.clear();
    usageHistoryCache.clear();
    usageCacheTimestamp.clear();
  }
}

// ============================================
// DEFAULT PREFERENCES
// ============================================

const DEFAULT_VARIETY_PREFS: Omit<ExerciseVarietyPreferences, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
  varietyLevel: 'medium',
  rotationFrequency: 2,
  minPoolSize: 5,
  prioritizeTopTier: true,
};

// ============================================
// VARIETY PREFERENCES API
// ============================================

/**
 * Get user's exercise variety preferences (from cache or DB)
 */
export async function getVarietyPreferences(
  userId: string
): Promise<ExerciseVarietyPreferences | null> {
  // Check cache
  const cachedTs = varietyCacheTimestamp.get(userId);
  const cached = varietyPrefsCache.get(userId);
  if (cached !== undefined && cachedTs && Date.now() - cachedTs < CACHE_TTL) {
    return cached;
  }

  try {
    const { data, error } = await fetchVarietyPreferences(userId);

    if (error) {
      if (error.code === 'PGRST116' || error.code === 'PGRST205' || error.code === '42P01') {
        varietyPrefsCache.set(userId, null);
        varietyCacheTimestamp.set(userId, Date.now());
        return null;
      }
      console.warn('Failed to load variety preferences:', error);
      return null;
    }

    const prefs = data ? mapRowToVarietyPrefs(data) : null;
    varietyPrefsCache.set(userId, prefs);
    varietyCacheTimestamp.set(userId, Date.now());
    return prefs;
  } catch (err) {
    console.warn('Error fetching variety preferences:', err);
    return null;
  }
}

/**
 * Get variety preferences with defaults applied
 */
export async function getVarietyPreferencesWithDefaults(
  userId: string
): Promise<ExerciseVarietyPreferences> {
  const prefs = await getVarietyPreferences(userId);
  if (prefs) return prefs;

  return {
    id: '',
    userId,
    ...DEFAULT_VARIETY_PREFS,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Save or update variety preferences
 */
export async function saveVarietyPreferences(
  userId: string,
  input: UpdateVarietyPreferencesInput
): Promise<boolean> {
  try {
    const { error } = await upsertVarietyPreferences(userId, input, DEFAULT_VARIETY_PREFS);

    if (error) {
      console.error('Failed to save variety preferences:', error);
      return false;
    }

    clearVarietyCache(userId);
    return true;
  } catch (err) {
    console.error('Error saving variety preferences:', err);
    return false;
  }
}

/**
 * Reset variety preferences to defaults (delete the record)
 */
export async function resetVarietyPreferences(userId: string): Promise<boolean> {
  try {
    const { error } = await deleteVarietyPreferences(userId);

    if (error) {
      console.error('Failed to reset variety preferences:', error);
      return false;
    }

    clearVarietyCache(userId);
    return true;
  } catch (err) {
    console.error('Error resetting variety preferences:', err);
    return false;
  }
}

// ============================================
// EXERCISE USAGE TRACKING
// ============================================

/**
 * Record that an exercise was used in a session
 */
export async function recordExerciseUsage(
  userId: string,
  exerciseId: string,
  muscleGroup: string,
  sessionId?: string
): Promise<boolean> {
  try {
    const { error } = await insertExerciseUsage(userId, exerciseId, muscleGroup, sessionId);

    if (error) {
      // Ignore duplicate entries (same exercise in same session)
      if (error.code === '23505') return true;
      console.error('Failed to record exercise usage:', error);
      return false;
    }

    usageHistoryCache.delete(userId);
    usageCacheTimestamp.delete(userId);
    return true;
  } catch (err) {
    console.error('Error recording exercise usage:', err);
    return false;
  }
}

/**
 * Record multiple exercises used in a session
 */
export async function recordMultipleExerciseUsage(
  userId: string,
  exercises: Array<{ exerciseId: string; muscleGroup: string }>,
  sessionId?: string
): Promise<boolean> {
  if (exercises.length === 0) return true;

  try {
    const { error } = await upsertMultipleExerciseUsage(userId, exercises, sessionId);

    if (error) {
      console.error('Failed to record multiple exercise usage:', error);
      return false;
    }

    usageHistoryCache.delete(userId);
    usageCacheTimestamp.delete(userId);
    return true;
  } catch (err) {
    console.error('Error recording multiple exercise usage:', err);
    return false;
  }
}

/**
 * Get recent exercise usage for a muscle group
 */
export async function getRecentExerciseUsage(
  userId: string,
  muscleGroup: string,
  limitDays: number = 14
): Promise<ExerciseUsageRecord[]> {
  const cacheKey = userId;
  const cachedTs = usageCacheTimestamp.get(cacheKey);
  const cached = usageHistoryCache.get(cacheKey);

  if (cached && cachedTs && Date.now() - cachedTs < USAGE_CACHE_TTL) {
    const muscleUsage = cached.get(muscleGroup.toLowerCase()) ?? [];
    return muscleUsage;
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - limitDays);

    const { data, error } = await fetchRecentExerciseUsage(userId, cutoffDate);

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return [];
      }
      console.warn('Failed to load exercise usage:', error);
      return [];
    }

    // Build cache by muscle group
    const usageByMuscle = new Map<string, ExerciseUsageRecord[]>();
    (data || []).forEach((row: ExerciseUsageRow) => {
      const record = mapRowToUsageRecord(row);
      const muscle = record.muscleGroup.toLowerCase();
      if (!usageByMuscle.has(muscle)) {
        usageByMuscle.set(muscle, []);
      }
      usageByMuscle.get(muscle)!.push(record);
    });

    usageHistoryCache.set(cacheKey, usageByMuscle);
    usageCacheTimestamp.set(cacheKey, Date.now());

    return usageByMuscle.get(muscleGroup.toLowerCase()) ?? [];
  } catch (err) {
    console.warn('Error fetching exercise usage:', err);
    return [];
  }
}

/**
 * Get exercise IDs that were recently used (to deprioritize)
 */
export async function getRecentlyUsedExerciseIds(
  userId: string,
  muscleGroup: string,
  sessionsBack: number = 3
): Promise<Set<string>> {
  const usage = await getRecentExerciseUsage(userId, muscleGroup);

  // Group by session and take last N sessions
  const sessionGroups = new Map<string | undefined, ExerciseUsageRecord[]>();
  usage.forEach((record) => {
    const key = record.sessionId || record.usedAt.toISOString().split('T')[0];
    if (!sessionGroups.has(key)) {
      sessionGroups.set(key, []);
    }
    sessionGroups.get(key)!.push(record);
  });

  // Get unique sessions sorted by date
  const sessions = Array.from(sessionGroups.entries())
    .sort((a, b) => {
      const aDate = a[1][0]?.usedAt.getTime() ?? 0;
      const bDate = b[1][0]?.usedAt.getTime() ?? 0;
      return bDate - aDate;
    })
    .slice(0, sessionsBack);

  const recentIds = new Set<string>();
  sessions.forEach(([, records]) => {
    records.forEach((r) => recentIds.add(r.exerciseId));
  });

  return recentIds;
}

// ============================================
// VARIETY-AWARE EXERCISE SELECTION
// ============================================

/**
 * Apply variety filtering to a list of exercise candidates
 */
export async function applyVarietyFilter(
  userId: string,
  candidates: Exercise[],
  muscleGroup: string,
  prefs?: ExerciseVarietyPreferences | null
): Promise<Exercise[]> {
  if (candidates.length === 0) return candidates;

  const varietyPrefs = prefs ?? await getVarietyPreferencesWithDefaults(userId);

  if (varietyPrefs.varietyLevel === 'low' && varietyPrefs.rotationFrequency === 0) {
    return candidates;
  }

  const recentlyUsedIds = await getRecentlyUsedExerciseIds(
    userId,
    muscleGroup,
    varietyPrefs.rotationFrequency
  );

  const notRecentlyUsed = candidates.filter((e) => !recentlyUsedIds.has(e.id));
  const recentlyUsed = candidates.filter((e) => recentlyUsedIds.has(e.id));

  if (notRecentlyUsed.length >= varietyPrefs.minPoolSize) {
    return [...notRecentlyUsed, ...recentlyUsed];
  }

  return [...notRecentlyUsed, ...recentlyUsed];
}

/**
 * Select exercises with variety applied
 */
export async function selectExercisesWithVariety(
  userId: string,
  candidates: Exercise[],
  muscleGroup: string,
  setsNeeded: number,
  maxExercisesPerMuscle: number = 3
): Promise<Exercise[]> {
  if (candidates.length === 0) return [];

  const prefs = await getVarietyPreferencesWithDefaults(userId);

  const sortedCandidates = await applyVarietyFilter(
    userId,
    candidates,
    muscleGroup,
    prefs
  );

  let finalCandidates = sortedCandidates;
  if (prefs.prioritizeTopTier) {
    const topTier = sortedCandidates.filter(
      (e) => ['S', 'A'].includes(e.hypertrophyScore?.tier || '')
    );
    const otherTier = sortedCandidates.filter(
      (e) => !['S', 'A'].includes(e.hypertrophyScore?.tier || '')
    );
    finalCandidates = [...topTier, ...otherTier];
  }

  const selected: Exercise[] = [];
  let remainingSets = setsNeeded;

  for (const exercise of finalCandidates) {
    if (selected.length >= maxExercisesPerMuscle) break;
    if (remainingSets <= 0) break;

    selected.push(exercise);
    remainingSets -= exercise.pattern === 'isolation' ? 3 : 4;
  }

  return selected;
}

/**
 * Get the recommended pool size based on variety level
 */
export function getPoolSizeForLevel(level: ExerciseVarietyLevel): number {
  const POOL_SIZES: Record<ExerciseVarietyLevel, number> = {
    low: 3,
    medium: 5,
    high: 8,
  };
  return POOL_SIZES[level];
}

/**
 * Get the recommended rotation frequency based on variety level
 */
export function getRotationFrequencyForLevel(level: ExerciseVarietyLevel): number {
  const FREQUENCIES: Record<ExerciseVarietyLevel, number> = {
    low: 0,
    medium: 2,
    high: 3,
  };
  return FREQUENCIES[level];
}

// ============================================
// MAPPING HELPERS
// ============================================

function mapRowToVarietyPrefs(row: ExerciseVarietyPreferencesRow): ExerciseVarietyPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    varietyLevel: row.variety_level,
    rotationFrequency: row.rotation_frequency,
    minPoolSize: row.min_pool_size,
    prioritizeTopTier: row.prioritize_top_tier,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRowToUsageRecord(row: ExerciseUsageRow): ExerciseUsageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    exerciseId: row.exercise_id,
    muscleGroup: row.muscle_group,
    usedAt: new Date(row.used_at),
    sessionId: row.session_id ?? undefined,
  };
}
