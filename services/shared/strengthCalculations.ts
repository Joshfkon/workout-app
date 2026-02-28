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
 * Uses average of Brzycki, Epley, and Lombardi formulas for accuracy.
 *
 * For high-rep sets (>12), uses a conservative linear estimate since
 * the standard formulas become unreliable.
 *
 * @param weight - Weight lifted
 * @param reps - Number of reps performed
 * @param rpe - Optional RPE (defaults to 10 / failure)
 * @returns Estimated 1RM
 */
export function estimate1RM(weight: number, reps: number, rpe?: number): number {
  if (reps === 0) return 0;
  if (reps === 1 && (!rpe || rpe >= 10)) return weight;

  // High rep sets (>12): use conservative linear estimate
  if (reps > 12) {
    // For very high reps, the formulas become unreliable
    // Use a conservative linear estimate
    return Math.round(weight * (1 + reps / 40) * 10) / 10;
  }

  const rir = rpeToRIR(rpe, reps);
  const effectiveReps = reps + rir;

  // Clamp effective reps to prevent formula breakdown
  const clampedEffectiveReps = Math.min(effectiveReps, 15);

  // Multiple formulas for accuracy
  // Brzycki: weight × 36 / (37 - reps)
  const brzycki = weight * (36 / (37 - clampedEffectiveReps));

  // Epley: weight × (1 + reps / 30)
  const epley = weight * (1 + clampedEffectiveReps / 30);

  // Lombardi: weight × reps^0.10
  const lombardi = weight * Math.pow(clampedEffectiveReps, 0.10);

  const average = (brzycki + epley + lombardi) / 3;
  return Math.round(average * 10) / 10;
}

/**
 * Simple E1RM calculation using only Epley formula.
 * Useful when a simpler calculation is preferred.
 *
 * @param weight - Weight lifted
 * @param reps - Number of reps performed
 * @param rpe - Optional RPE (defaults to 10)
 * @returns Estimated 1RM
 */
export function estimateE1RMSimple(weight: number, reps: number, rpe: number = 10): number {
  if (reps === 0) return 0;
  if (reps === 1 && rpe === 10) return weight;

  // Adjust reps for RIR
  const rir = 10 - rpe;
  const effectiveReps = reps + rir;

  // Epley formula: weight * (1 + reps/30)
  return Math.round(weight * (1 + effectiveReps / 30) * 100) / 100;
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
