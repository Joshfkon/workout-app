'use client';

import { useMemo } from 'react';
import type { ExerciseBlock } from '@/types/schema';

// Time estimate constants (matching mesocycleBuilder.ts formula)
const SECONDS_PER_SET_EXECUTION = 45; // ~0.75 minutes per set
const WARMUP_BUFFER_SECONDS = 600; // 10 minutes warmup buffer
const DEFAULT_REST_SECONDS = 180; // 3 minutes default rest

interface UseWorkoutEstimateOptions {
  /** All exercise blocks in the workout */
  exerciseBlocks: ExerciseBlock[];
  /** Number of working sets completed so far */
  completedSets: number;
  /** User's default rest timer in seconds (optional) */
  defaultRestSeconds?: number;
}

interface WorkoutEstimate {
  /** Total estimated workout duration in minutes */
  totalMinutes: number;
  /** Estimated remaining time in minutes */
  remainingMinutes: number;
  /** Total planned working sets */
  totalSets: number;
  /** Completed working sets */
  completedSets: number;
  /** Formatted total estimate string (e.g., "45 min") */
  formattedTotal: string;
  /** Formatted remaining time string (e.g., "~30 min left") */
  formattedRemaining: string;
}

/**
 * Calculate estimated workout duration based on sets and rest times.
 *
 * Formula breakdown:
 * - Rest time: Sum of rest periods between all sets
 * - Set execution: ~45 seconds per set
 * - Warmup buffer: 10 minutes for warmup/setup
 */
export function useWorkoutEstimate({
  exerciseBlocks,
  completedSets,
  defaultRestSeconds = DEFAULT_REST_SECONDS,
}: UseWorkoutEstimateOptions): WorkoutEstimate {
  return useMemo(() => {
    if (exerciseBlocks.length === 0) {
      return {
        totalMinutes: 0,
        remainingMinutes: 0,
        totalSets: 0,
        completedSets: 0,
        formattedTotal: '',
        formattedRemaining: '',
      };
    }

    // Calculate total sets and rest time
    let totalSets = 0;
    let totalRestSeconds = 0;

    for (const block of exerciseBlocks) {
      const sets = block.targetSets;
      totalSets += sets;

      // Use block-specific rest time or fall back to user default
      const restPerSet = block.targetRestSeconds ?? defaultRestSeconds;
      // Rest is taken after each set except the last one of each exercise
      totalRestSeconds += restPerSet * Math.max(0, sets - 1);
    }

    // Total estimated time in seconds
    const totalSetExecutionSeconds = totalSets * SECONDS_PER_SET_EXECUTION;
    const totalSeconds = totalRestSeconds + totalSetExecutionSeconds + WARMUP_BUFFER_SECONDS;
    const totalMinutes = Math.round(totalSeconds / 60);

    // Calculate remaining time based on progress
    // Assume linear progress through the workout
    const progressRatio = totalSets > 0 ? completedSets / totalSets : 0;
    const elapsedEstimateSeconds = progressRatio * (totalRestSeconds + totalSetExecutionSeconds);
    const remainingSeconds = Math.max(
      0,
      totalRestSeconds + totalSetExecutionSeconds - elapsedEstimateSeconds
    );
    const remainingMinutes = Math.round(remainingSeconds / 60);

    // Format strings
    const formattedTotal = totalMinutes > 0 ? `~${totalMinutes} min` : '';
    const formattedRemaining = remainingMinutes > 0
      ? `~${remainingMinutes} min left`
      : completedSets >= totalSets
        ? 'Complete!'
        : '';

    return {
      totalMinutes,
      remainingMinutes,
      totalSets,
      completedSets,
      formattedTotal,
      formattedRemaining,
    };
  }, [exerciseBlocks, completedSets, defaultRestSeconds]);
}

/**
 * Standalone function to estimate workout time (for use outside React components)
 */
export function estimateWorkoutTime(
  exerciseBlocks: ExerciseBlock[],
  defaultRestSeconds: number = DEFAULT_REST_SECONDS
): number {
  let totalSets = 0;
  let totalRestSeconds = 0;

  for (const block of exerciseBlocks) {
    const sets = block.targetSets;
    totalSets += sets;
    const restPerSet = block.targetRestSeconds ?? defaultRestSeconds;
    totalRestSeconds += restPerSet * Math.max(0, sets - 1);
  }

  const totalSetExecutionSeconds = totalSets * SECONDS_PER_SET_EXECUTION;
  const totalSeconds = totalRestSeconds + totalSetExecutionSeconds + WARMUP_BUFFER_SECONDS;

  return Math.round(totalSeconds / 60);
}
