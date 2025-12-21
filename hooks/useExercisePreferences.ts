'use client';

import { useState, useEffect, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import type {
  ExerciseVisibilityStatus,
  ExerciseHideReason,
  UserExercisePreference,
  ExercisePreferenceSummary,
  SetExerciseStatusInput,
} from '@/types/user-exercise-preferences';
import {
  getUserExercisePreferences,
  setExerciseStatus as setExerciseStatusService,
  bulkSetExerciseStatus,
  resetAllPreferences as resetAllPreferencesService,
  getPreferenceSummary,
  clearPreferencesCache,
} from '@/services/exercisePreferencesService';

// Global state to share preferences across components
let globalPreferences: Map<string, UserExercisePreference> = new Map();
let globalUserId: string | null = null;
let globalListeners: Set<(prefs: Map<string, UserExercisePreference>) => void> = new Set();

function notifyListeners(prefs: Map<string, UserExercisePreference>) {
  globalPreferences = prefs;
  globalListeners.forEach((listener) => listener(prefs));
}

/**
 * Hook for managing exercise visibility preferences
 */
export function useExercisePreferences() {
  const [preferences, setPreferences] = useState<Map<string, UserExercisePreference>>(globalPreferences);
  const [summary, setSummary] = useState<ExercisePreferenceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(globalUserId);

  // Subscribe to global updates
  useEffect(() => {
    const listener = (prefs: Map<string, UserExercisePreference>) => setPreferences(prefs);
    globalListeners.add(listener);
    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  // Load preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      try {
        const supabase = createUntypedClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          setUserId(user.id);
          globalUserId = user.id;

          const prefs = await getUserExercisePreferences(user.id);
          notifyListeners(prefs);

          const summaryData = await getPreferenceSummary(user.id);
          setSummary(summaryData);
        }
      } catch (err) {
        console.error('Failed to load exercise preferences:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadPreferences();
  }, []);

  /**
   * Get the status of a specific exercise
   */
  const getExerciseStatus = useCallback(
    (exerciseId: string): ExerciseVisibilityStatus => {
      const pref = preferences.get(exerciseId);
      return pref?.status || 'active';
    },
    [preferences]
  );

  /**
   * Check if an exercise is archived
   */
  const isArchived = useCallback(
    (exerciseId: string): boolean => {
      return getExerciseStatus(exerciseId) === 'archived';
    },
    [getExerciseStatus]
  );

  /**
   * Check if an exercise is set to "do not suggest"
   */
  const isDoNotSuggest = useCallback(
    (exerciseId: string): boolean => {
      return getExerciseStatus(exerciseId) === 'do_not_suggest';
    },
    [getExerciseStatus]
  );

  /**
   * Set the status of an exercise
   */
  const setExerciseStatus = useCallback(
    async (input: SetExerciseStatusInput): Promise<boolean> => {
      if (!userId) return false;

      const success = await setExerciseStatusService(userId, input);

      if (success) {
        // Refresh preferences
        const prefs = await getUserExercisePreferences(userId);
        notifyListeners(prefs);

        const summaryData = await getPreferenceSummary(userId);
        setSummary(summaryData);
      }

      return success;
    },
    [userId]
  );

  /**
   * Mark an exercise as "do not suggest"
   */
  const muteExercise = useCallback(
    async (exerciseId: string, reason?: ExerciseHideReason, reasonNote?: string): Promise<boolean> => {
      return setExerciseStatus({
        exerciseId,
        status: 'do_not_suggest',
        reason,
        reasonNote,
      });
    },
    [setExerciseStatus]
  );

  /**
   * Archive (hide) an exercise
   */
  const archiveExercise = useCallback(
    async (exerciseId: string, reason?: ExerciseHideReason, reasonNote?: string): Promise<boolean> => {
      return setExerciseStatus({
        exerciseId,
        status: 'archived',
        reason,
        reasonNote,
      });
    },
    [setExerciseStatus]
  );

  /**
   * Restore an exercise to active status
   */
  const restoreExercise = useCallback(
    async (exerciseId: string): Promise<boolean> => {
      return setExerciseStatus({
        exerciseId,
        status: 'active',
      });
    },
    [setExerciseStatus]
  );

  /**
   * Bulk set status for multiple exercises
   */
  const bulkSetStatus = useCallback(
    async (
      exerciseIds: string[],
      status: ExerciseVisibilityStatus,
      reason?: ExerciseHideReason
    ): Promise<boolean> => {
      if (!userId) return false;

      const success = await bulkSetExerciseStatus(userId, exerciseIds, status, reason);

      if (success) {
        const prefs = await getUserExercisePreferences(userId);
        notifyListeners(prefs);

        const summaryData = await getPreferenceSummary(userId);
        setSummary(summaryData);
      }

      return success;
    },
    [userId]
  );

  /**
   * Reset all preferences (unarchive all, re-enable suggestions)
   */
  const resetAllPreferences = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;

    const success = await resetAllPreferencesService(userId);

    if (success) {
      notifyListeners(new Map());
      setSummary({
        activeCount: summary?.activeCount ?? 0 + (summary?.doNotSuggestCount ?? 0) + (summary?.archivedCount ?? 0),
        doNotSuggestCount: 0,
        archivedCount: 0,
      });
    }

    return success;
  }, [userId, summary]);

  /**
   * Refresh preferences from the database
   */
  const refreshPreferences = useCallback(async () => {
    if (!userId) return;

    clearPreferencesCache(userId);
    const prefs = await getUserExercisePreferences(userId);
    notifyListeners(prefs);

    const summaryData = await getPreferenceSummary(userId);
    setSummary(summaryData);
  }, [userId]);

  return {
    preferences,
    summary,
    isLoading,
    getExerciseStatus,
    isArchived,
    isDoNotSuggest,
    setExerciseStatus,
    muteExercise,
    archiveExercise,
    restoreExercise,
    bulkSetStatus,
    resetAllPreferences,
    refreshPreferences,
  };
}
