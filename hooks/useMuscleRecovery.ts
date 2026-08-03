'use client';

import { useMemo, useState } from 'react';
import { useUserStore } from '@/stores';
import {
  STANDARD_MUSCLE_GROUPS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import {
  computeMuscleRecovery,
  computeSleepWindowMultiplier,
  recoveryConfigFor,
  type MuscleRecoveryResult,
} from '@/services/muscleRecovery';
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
import { useRecoveryMultipliers } from '@/hooks/useRecoveryMultipliers';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';
import { useSleepLog } from '@/hooks/useSleepLog';

/**
 * useMuscleRecovery — per-STANDARD-muscle recovery statuses for surfaces that
 * work at exercise-muscle grain (Train page recovery list, workout builder
 * indicators, the home hero's "still sore" note, AI workout suggestions).
 *
 * This is an ADAPTER over the unified recovery model: it reads the same
 * history query and runs the same pure `muscleRecovery` heuristic (per-muscle
 * windows, dose/intensity adjustments, enhanced-athlete windowScale) as the
 * readiness sheet and the analytics recovery card, then reshapes each result
 * into the percent/ready/status-text form these consumers render. The old
 * standalone time-table model this hook used to implement is gone — if a
 * status here disagreed with a readiness badge, that was a bug.
 */

export interface MuscleRecoveryStatus {
  muscle: StandardMuscleGroup;
  /** Display name for the muscle */
  displayName: string;
  /** When this muscle was last trained */
  lastTrainedAt: Date | null;
  /** Hours since last training */
  hoursSinceTraining: number | null;
  /** The recovery window applied to the last session (hours) */
  recommendedRecoveryHours: number;
  /** Hours remaining until fully recovered (0 if ready) */
  hoursRemaining: number;
  /** Recovery progress as percentage (100 = fully recovered) */
  recoveryPercent: number;
  /** Whether the muscle is ready (Fresh) to train again */
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
  refresh: () => void;
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

function toStatus(
  muscle: StandardMuscleGroup,
  result: MuscleRecoveryResult,
  fallbackWindowHours: number
): MuscleRecoveryStatus {
  const isReady = result.status === 'fresh';
  const recoveryPercent =
    result.lastTrainedAt === null || !result.windowHours || isReady
      ? 100
      : Math.min(100, Math.round(((result.hoursSinceLast ?? 0) / result.windowHours) * 100));

  return {
    muscle,
    displayName: STANDARD_MUSCLE_DISPLAY_NAMES[muscle],
    lastTrainedAt: result.lastTrainedAt,
    hoursSinceTraining: result.hoursSinceLast,
    recommendedRecoveryHours: result.windowHours ?? fallbackWindowHours,
    hoursRemaining: result.hoursUntilReady,
    recoveryPercent,
    isReady,
    statusText: formatTimeRemaining(result.hoursUntilReady),
  };
}

/**
 * Hook to calculate recovery status for all standard muscle groups
 */
export function useMuscleRecovery(): UseMuscleRecoveryResult {
  // Stamp the clock once per mount so every muscle is evaluated against the
  // same instant (a refetch keeps the stamp; a remount refreshes it).
  const [now] = useState(() => new Date());
  const { sessions, isLoading, error, refetch } = useRecoveryHistory(now, true);

  const { user: storeUser } = useUserStore();
  const enhancedAthleteMode = storeUser?.enhancedAthleteMode === true;
  // The user's real experience level drives the Bug 6 session-capacity
  // normalizer (direct MRV / planned frequency). Left undefined it would
  // silently fall back to 'intermediate' — supply it wherever the store has it
  // so the fallback stays visible in dose diagnostics rather than routine.
  const experienceForCapacity = storeUser?.experience;
  const { multipliers } = useRecoveryMultipliers();
  // Recent sleep scales every window (trailing-2-night avg <6h stretches
  // recovery ×1.15; ≥8h good quality shrinks it ×0.95), and the wearable
  // HRV/RHR modifier layers on top — both composed + clamped globally in
  // recoveryConfigFor/windowForSession.
  const { entries: sleepEntries } = useSleepLog();
  const { state: wearableRecovery } = useWearableRecovery();
  const config = useMemo(
    () =>
      recoveryConfigFor(
        enhancedAthleteMode,
        multipliers,
        computeSleepWindowMultiplier(sleepEntries, now),
        wearableRecovery.scale,
        { experienceForCapacity: experienceForCapacity }
      ),
    [enhancedAthleteMode, multipliers, sleepEntries, now, wearableRecovery.scale, experienceForCapacity]
  );

  const recoveryStatus = useMemo(
    (): MuscleRecoveryStatus[] =>
      STANDARD_MUSCLE_GROUPS.map((muscle) => {
        const result = computeMuscleRecovery(sessions, muscle, now, config);
        const fallbackWindow =
          (config.windowHoursByMuscle[muscle] ?? config.defaultWindowHours) * config.windowScale;
        return toStatus(muscle, result, fallbackWindow);
      }),
    [sessions, now, config]
  );

  const recoveringMuscles = useMemo(
    () =>
      recoveryStatus
        .filter((m) => !m.isReady)
        .sort((a, b) => a.hoursRemaining - b.hoursRemaining),
    [recoveryStatus]
  );

  const readyMuscles = useMemo(
    () => recoveryStatus.filter((m) => m.isReady),
    [recoveryStatus]
  );

  return {
    recoveryStatus,
    recoveringMuscles,
    readyMuscles,
    isLoading,
    error,
    refresh: refetch,
  };
}
