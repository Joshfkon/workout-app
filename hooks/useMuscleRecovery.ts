'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useUserStore } from '@/stores';
import {
  STANDARD_MUSCLE_GROUPS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup
} from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
import type { ExerciseBlockFull, SetLogRow, MinimalUser } from '@/types/database-queries';

/**
 * Recovery time recommendations in hours based on muscle group size
 * These are general guidelines based on sports science research
 */
/**
 * Volume-based recovery scaling
 * More sets = longer recovery needed
 */
const VOLUME_SCALING = {
  /** Sets at or below this count use base recovery time */
  baselineSetCount: 3,
  /** Additional hours per set beyond baseline */
  hoursPerExtraSet: 4,
  /** Maximum multiplier on base recovery time */
  maxMultiplier: 1.5,
};

const RECOVERY_HOURS: Record<StandardMuscleGroup, number> = {
  // Large muscle groups - need more recovery (48-72 hours)
  lats: 72,
  upper_back: 72,
  quads: 72,
  hamstrings: 72,
  glutes: 72,
  glute_med: 48,
  erectors: 72,

  // Medium muscle groups (48 hours)
  chest_upper: 48,
  chest_lower: 48,
  front_delts: 48,
  lateral_delts: 48,
  rear_delts: 48,
  traps: 48,
  adductors: 48,

  // Smaller muscle groups - recover faster (24-48 hours)
  biceps: 36,
  triceps: 36,
  forearms: 24,
  calves: 36,
  abs: 48,     // Increased from 24h - abs need more recovery especially after intense training
  obliques: 48, // Increased from 24h - same rationale as abs
};

export interface MuscleRecoveryStatus {
  muscle: StandardMuscleGroup;
  /** Display name for the muscle */
  displayName: string;
  /** When this muscle was last trained */
  lastTrainedAt: Date | null;
  /** Hours since last training */
  hoursSinceTraining: number | null;
  /** Recommended recovery hours for this muscle */
  recommendedRecoveryHours: number;
  /** Hours remaining until fully recovered (0 if ready) */
  hoursRemaining: number;
  /** Recovery progress as percentage (100 = fully recovered) */
  recoveryPercent: number;
  /** Whether the muscle is ready to train again */
  isReady: boolean;
  /** Human-readable status text */
  statusText: string;
}

interface UseMuscleRecoveryResult {
  /** Recovery status for all muscle groups */
  recoveryStatus: MuscleRecoveryStatus[];
  /** Only muscles that are still recovering */
  recoveringMuscles: MuscleRecoveryStatus[];
  /** Muscles that are ready to train */
  readyMuscles: MuscleRecoveryStatus[];
  /** Whether data is loading */
  isLoading: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Refresh the recovery data */
  refresh: () => Promise<void>;
}

/**
 * Format hours remaining into a human-readable string
 */
function formatTimeRemaining(hours: number): string {
  if (hours <= 0) return 'Ready';

  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  }

  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);

  if (remainingHours === 0) {
    return `${days}d`;
  }

  return `${days}d ${remainingHours}h`;
}

/**
 * Calculate adjusted recovery hours based on training volume
 */
function getAdjustedRecoveryHours(baseHours: number, setCount: number): number {
  const extraSets = Math.max(0, setCount - VOLUME_SCALING.baselineSetCount);
  const additionalHours = extraSets * VOLUME_SCALING.hoursPerExtraSet;
  const maxHours = baseHours * VOLUME_SCALING.maxMultiplier;
  return Math.min(baseHours + additionalHours, maxHours);
}

interface MuscleTrainingData {
  lastTrained: Date;
  setCount: number;
}

/**
 * Hook to calculate recovery status for all muscle groups
 */
export function useMuscleRecovery(): UseMuscleRecoveryResult {
  const [muscleDataMap, setMuscleDataMap] = useState<Map<string, MuscleTrainingData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user: storeUser } = useUserStore();
  const [user, setUser] = useState<MinimalUser | null>(storeUser ? { id: storeUser.id } : null);

  // Get user from Supabase auth as fallback
  useEffect(() => {
    async function loadUser() {
      if (storeUser?.id) {
        setUser({ id: storeUser.id });
        return;
      }

      try {
        const supabase = createUntypedClient();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          setUser({ id: authUser.id });
        }
      } catch (err: unknown) {
        console.error('[useMuscleRecovery] Error getting user from auth:', getErrorMessage(err));
      }
    }
    loadUser();
  }, [storeUser]);

  const fetchRecoveryData = useCallback(async () => {
    if (!user?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // Query completed workout sessions from the last 7 days
      // We need to find when each muscle group was last trained
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: blocks, error: blocksError } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          exercises!inner (
            id,
            name,
            primary_muscle,
            secondary_muscles
          ),
          workout_sessions!inner (
            id,
            completed_at,
            user_id,
            state
          ),
          set_logs (
            id,
            is_warmup
          )
        `)
        .eq('workout_sessions.user_id', user.id)
        .eq('workout_sessions.state', 'completed')
        .gte('workout_sessions.completed_at', sevenDaysAgo.toISOString())
        .order('workout_sessions(completed_at)', { ascending: false });

      if (blocksError) {
        console.error('[useMuscleRecovery] Error fetching blocks:', blocksError);
        throw blocksError;
      }

      // Build a map of muscle -> most recent training date and set count
      // We track both when the muscle was trained AND how many sets were done
      const muscleData = new Map<string, MuscleTrainingData>();

      if (blocks && blocks.length > 0) {
        blocks.forEach((block: ExerciseBlockFull) => {
          const exercise = block.exercises;
          const session = block.workout_sessions;

          if (!exercise || !session?.completed_at) return;

          // Only count working sets
          const workingSets = (block.set_logs || []).filter((s: SetLogRow) => !s.is_warmup);
          if (workingSets.length === 0) return;

          const completedAt = new Date(session.completed_at);
          const primaryMuscle = exercise.primary_muscle?.toLowerCase();
          const secondaryMuscles = (exercise.secondary_muscles || []).map((m: string) => m.toLowerCase());

          // Helper to update muscle data
          const updateMuscleData = (standardMuscle: string, isPrimary: boolean) => {
            const existing = muscleData.get(standardMuscle);
            // Count full sets for primary muscle, half for secondary (secondary muscles get less stimulus)
            const setsToAdd = isPrimary ? workingSets.length : Math.ceil(workingSets.length / 2);

            if (!existing) {
              muscleData.set(standardMuscle, {
                lastTrained: completedAt,
                setCount: setsToAdd,
              });
            } else if (completedAt > existing.lastTrained) {
              // More recent session - reset the count for this session
              muscleData.set(standardMuscle, {
                lastTrained: completedAt,
                setCount: setsToAdd,
              });
            } else if (completedAt.getTime() === existing.lastTrained.getTime()) {
              // Same session - accumulate sets
              muscleData.set(standardMuscle, {
                lastTrained: existing.lastTrained,
                setCount: existing.setCount + setsToAdd,
              });
            }
            // If completedAt < existing.lastTrained, ignore (older session)
          };

          // Update primary muscle (convert to standard format)
          if (primaryMuscle) {
            const standardMuscle = toStandardMuscleForVolume(primaryMuscle);
            if (standardMuscle) {
              updateMuscleData(standardMuscle, true);
            }
          }

          // Update secondary muscles (convert to standard format)
          secondaryMuscles.forEach((muscle: string) => {
            const standardMuscle = toStandardMuscleForVolume(muscle);
            if (standardMuscle) {
              updateMuscleData(standardMuscle, false);
            }
          });
        });
      }

      setMuscleDataMap(muscleData);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      console.error('[useMuscleRecovery] Error:', message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Load data when user is available
  useEffect(() => {
    if (user?.id) {
      fetchRecoveryData();
    }
  }, [user?.id, fetchRecoveryData]);

  // Calculate recovery status for all muscles
  const recoveryStatus = useMemo((): MuscleRecoveryStatus[] => {
    const now = new Date();

    return STANDARD_MUSCLE_GROUPS.map((muscle): MuscleRecoveryStatus => {
      const muscleTrainingData = muscleDataMap.get(muscle);
      const baseHours = RECOVERY_HOURS[muscle];
      const displayName = STANDARD_MUSCLE_DISPLAY_NAMES[muscle];

      if (!muscleTrainingData) {
        // Never trained (or not in last 7 days) - considered ready
        return {
          muscle,
          displayName,
          lastTrainedAt: null,
          hoursSinceTraining: null,
          recommendedRecoveryHours: baseHours,
          hoursRemaining: 0,
          recoveryPercent: 100,
          isReady: true,
          statusText: 'Ready',
        };
      }

      const { lastTrained, setCount } = muscleTrainingData;
      // Adjust recovery time based on volume (more sets = longer recovery)
      const adjustedRecoveryHours = getAdjustedRecoveryHours(baseHours, setCount);

      const hoursSince = (now.getTime() - lastTrained.getTime()) / (1000 * 60 * 60);
      const hoursRemaining = Math.max(0, adjustedRecoveryHours - hoursSince);
      const recoveryPercent = Math.min(100, Math.round((hoursSince / adjustedRecoveryHours) * 100));
      const isReady = hoursRemaining <= 0;

      return {
        muscle,
        displayName,
        lastTrainedAt: lastTrained,
        hoursSinceTraining: hoursSince,
        recommendedRecoveryHours: adjustedRecoveryHours,
        hoursRemaining,
        recoveryPercent,
        isReady,
        statusText: formatTimeRemaining(hoursRemaining),
      };
    });
  }, [muscleDataMap]);

  // Separate recovering and ready muscles
  const recoveringMuscles = useMemo(() =>
    recoveryStatus.filter((m: MuscleRecoveryStatus) => !m.isReady).sort((a: MuscleRecoveryStatus, b: MuscleRecoveryStatus) => a.hoursRemaining - b.hoursRemaining),
    [recoveryStatus]
  );

  const readyMuscles = useMemo(() =>
    recoveryStatus.filter((m: MuscleRecoveryStatus) => m.isReady),
    [recoveryStatus]
  );

  return {
    recoveryStatus,
    recoveringMuscles,
    readyMuscles,
    isLoading,
    error,
    refresh: fetchRecoveryData,
  };
}
