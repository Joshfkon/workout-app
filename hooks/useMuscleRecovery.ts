'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { MUSCLE_GROUPS, type MuscleGroup } from '@/types/schema';

/**
 * Recovery time recommendations in hours based on muscle group size
 * These are general guidelines based on sports science research
 */
const RECOVERY_HOURS: Record<MuscleGroup, number> = {
  // Large muscle groups - need more recovery (48-72 hours)
  back: 72,
  quads: 72,
  hamstrings: 72,
  glutes: 72,

  // Medium muscle groups (48 hours)
  chest: 48,
  shoulders: 48,

  // Smaller muscle groups - recover faster (24-48 hours)
  biceps: 36,
  triceps: 36,
  calves: 36,
  abs: 24,
  traps: 48,
  forearms: 24,
  adductors: 48,
};

export interface MuscleRecoveryStatus {
  muscle: MuscleGroup;
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
 * Hook to calculate recovery status for all muscle groups
 */
export function useMuscleRecovery(): UseMuscleRecoveryResult {
  const [lastTrainedMap, setLastTrainedMap] = useState<Map<string, Date>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user: storeUser } = useUserStore();
  const [user, setUser] = useState(storeUser);

  // Get user from Supabase auth as fallback
  useEffect(() => {
    async function loadUser() {
      if (storeUser?.id) {
        setUser(storeUser);
        return;
      }

      try {
        const supabase = createUntypedClient();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          setUser({ id: authUser.id } as any);
        }
      } catch (err) {
        console.error('[useMuscleRecovery] Error getting user from auth:', err);
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

      // Build a map of muscle -> most recent training date
      const muscleLastTrained = new Map<string, Date>();

      if (blocks && blocks.length > 0) {
        blocks.forEach((block: any) => {
          const exercise = block.exercises;
          const session = block.workout_sessions;

          if (!exercise || !session?.completed_at) return;

          // Only count if there were working sets
          const workingSets = (block.set_logs || []).filter((s: any) => !s.is_warmup);
          if (workingSets.length === 0) return;

          const completedAt = new Date(session.completed_at);
          const primaryMuscle = exercise.primary_muscle?.toLowerCase();
          const secondaryMuscles = (exercise.secondary_muscles || []).map((m: string) => m.toLowerCase());

          // Update primary muscle
          if (primaryMuscle) {
            const existing = muscleLastTrained.get(primaryMuscle);
            if (!existing || completedAt > existing) {
              muscleLastTrained.set(primaryMuscle, completedAt);
            }
          }

          // Update secondary muscles (they also need recovery!)
          secondaryMuscles.forEach((muscle: string) => {
            const existing = muscleLastTrained.get(muscle);
            if (!existing || completedAt > existing) {
              muscleLastTrained.set(muscle, completedAt);
            }
          });
        });
      }

      setLastTrainedMap(muscleLastTrained);
    } catch (err) {
      console.error('[useMuscleRecovery] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load recovery data');
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

    return MUSCLE_GROUPS.map((muscle): MuscleRecoveryStatus => {
      const lastTrained = lastTrainedMap.get(muscle) || null;
      const recommendedHours = RECOVERY_HOURS[muscle];

      if (!lastTrained) {
        // Never trained (or not in last 7 days) - considered ready
        return {
          muscle,
          lastTrainedAt: null,
          hoursSinceTraining: null,
          recommendedRecoveryHours: recommendedHours,
          hoursRemaining: 0,
          recoveryPercent: 100,
          isReady: true,
          statusText: 'Ready',
        };
      }

      const hoursSince = (now.getTime() - lastTrained.getTime()) / (1000 * 60 * 60);
      const hoursRemaining = Math.max(0, recommendedHours - hoursSince);
      const recoveryPercent = Math.min(100, Math.round((hoursSince / recommendedHours) * 100));
      const isReady = hoursRemaining <= 0;

      return {
        muscle,
        lastTrainedAt: lastTrained,
        hoursSinceTraining: hoursSince,
        recommendedRecoveryHours: recommendedHours,
        hoursRemaining,
        recoveryPercent,
        isReady,
        statusText: formatTimeRemaining(hoursRemaining),
      };
    });
  }, [lastTrainedMap]);

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
