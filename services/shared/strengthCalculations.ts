/**
 * Shared Strength Calculations Module
 *
 * Single source of truth for strength-related math:
 * - 1RM estimation from rep performance
 * - Working weight calculations from estimated maxes
 * - RPE/RIR conversions
 *
 * Used by both weightEstimationEngine.ts and progressionEngine.ts
 */

import { e1rmValueFromRpe } from './e1rm';

/**
 * Convert RPE (Rate of Perceived Exertion) to RIR (Reps In Reserve)
 * with bounds and rep-range awareness.
 *
 * @param rpe - The reported RPE (typically 6-10 scale)
 * @param reps - The number of reps performed (affects RIR reliability)
 * @returns RIR value, capped at 4
 */
export function rpeToRIR(rpe: number | undefined, reps: number): number {
  if (!rpe) return 0;  // Assume RPE 10 if not specified

  // Clamp RPE to reasonable range (6-10)
  const clampedRPE = Math.min(Math.max(rpe, 6), 10);

  // Base RIR calculation
  let rir = 10 - clampedRPE;

  // At higher rep ranges, RIR estimates become less reliable
  // Compress the RIR for high-rep sets
  if (reps > 10) {
    rir = rir * 0.75;  // RIR less meaningful at high reps
  }

  // Cap effective RIR at 4 (RPE 6 minimum useful)
  return Math.min(rir, 4);
}

/**
 * Convert RIR to RPE
 *
 * @param rir - Reps in reserve (0-4)
 * @returns RPE value (6-10)
 */
export function rirToRPE(rir: number): number {
  return Math.max(6, Math.min(10, 10 - rir));
}

/**
 * Estimate 1RM from weight, reps, and optional RPE.
 *
 * DELEGATES to the canonical estimator (services/shared/e1rm): Brzycki,
 * effective reps capped at 12, no estimate beyond 15. The old local
 * three-formula average (and its >12-rep linear extrapolation) is gone —
 * one formula app-wide.
 *
 * Numeric-compat signature: returns **0 when no estimate exists** (bad
 * inputs, or effective reps beyond the domain). 0 is for aggregation
 * contexts only (max/avg where "no estimate" must never win) — display
 * surfaces must gate on > 0 and render "no estimate", never the 0.
 *
 * @param weight - Weight lifted
 * @param reps - Number of reps performed
 * @param rpe - Optional RPE (absent = taken to failure)
 * @returns Estimated 1RM, or 0 when no valid estimate exists
 */
export function estimate1RM(weight: number, reps: number, rpe?: number): number {
  return e1rmValueFromRpe(weight, reps, rpe);
}

/**
 * Calculate working weight based on estimated 1RM, target reps, and target RIR.
 * Uses Brzycki-derived percentage with bounds for high-rep scenarios.
 *
 * @param estimated1RM - The estimated 1 rep max
 * @param targetReps - Target number of reps
 * @param targetRIR - Target reps in reserve (defaults to 2)
 * @param safetyMargin - Multiplier for conservative estimates (defaults to 0.95)
 * @returns Recommended working weight
 */
export function calculateWorkingWeight(
  estimated1RM: number,
  targetReps: number,
  targetRIR: number = 2,
  safetyMargin: number = 0.95
): number {
  const effectiveReps = targetReps + targetRIR;

  // Clamp effective reps to reasonable range for formula accuracy
  const clampedReps = Math.min(effectiveReps, 15);

  let percentage: number;
  if (clampedReps <= 12) {
    // Standard Brzycki-derived percentage: (37 - reps) / 36
    percentage = (37 - clampedReps) / 36;
  } else {
    // Linear extrapolation for higher reps (more conservative)
    // At 12 reps: 69.4%, at 15 reps: ~62%
    percentage = 0.694 - (clampedReps - 12) * 0.025;
  }

  return Math.round(estimated1RM * percentage * safetyMargin * 10) / 10;
}

/**
 * Calculate working weight using simple Epley inverse.
 * This is the exact mathematical inverse of the Epley 1RM formula.
 *
 * @param e1rm - Estimated 1RM
 * @param targetReps - Target number of reps
 * @param targetRIR - Target reps in reserve
 * @param safetyMargin - Multiplier for conservative estimates (defaults to 0.95)
 * @returns Recommended working weight
 */
export function calculateWorkingWeightSimple(
  e1rm: number,
  targetReps: number,
  targetRIR: number,
  safetyMargin: number = 0.95
): number {
  const avgReps = targetReps;
  const effectiveReps = avgReps + targetRIR;
  // Exact inverse of Epley formula: E1RM = weight * (1 + reps/30)
  // Therefore: weight = E1RM / (1 + reps/30) = E1RM * 30 / (30 + reps)
  const percentage = 30 / (30 + effectiveReps);
  return Math.round(e1rm * percentage * safetyMargin * 10) / 10;
}

/**
 * Calculate the percentage of 1RM for a given rep count and RIR.
 *
 * @param reps - Target rep count
 * @param rir - Target reps in reserve
 * @returns Percentage of 1RM (as decimal, e.g., 0.75 for 75%)
 */
export function getPercentageOf1RM(reps: number, rir: number = 0): number {
  const effectiveReps = reps + rir;
  const clampedReps = Math.min(effectiveReps, 15);

  if (clampedReps <= 12) {
    return (37 - clampedReps) / 36;
  }

  // Linear extrapolation for higher reps
  return 0.694 - (clampedReps - 12) * 0.025;
}

/**
 * Estimate reps achievable at a given percentage of 1RM.
 *
 * @param percentage - Percentage of 1RM (as decimal)
 * @param targetRIR - Target RIR (defaults to 0)
 * @returns Estimated reps achievable
 */
export function estimateRepsAtPercentage(percentage: number, targetRIR: number = 0): number {
  // Inverse of Brzycki: reps = 37 - (36 * percentage)
  const rawReps = 37 - (36 * percentage);
  const repsAtFailure = Math.max(1, Math.round(rawReps));
  return Math.max(1, repsAtFailure - targetRIR);
}
