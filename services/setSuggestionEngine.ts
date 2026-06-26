/**
 * Set Suggestion Engine
 *
 * Single source of truth for calculating weight and rep suggestions between sets
 * during an active workout. Consolidates RPE-based adjustments and Epley-based
 * estimations that were previously duplicated in ExerciseCard and CompactSetRow.
 *
 * Pure functions - no database calls or side effects.
 */

import { estimate1RM } from './shared/strengthCalculations';

// ============================================
// TYPES
// ============================================

export interface PreviousSetData {
  weightKg: number;
  reps: number;
  rpe?: number;
}

export interface SuggestionContext {
  targetRepRange: [number, number];
  targetRir: number;
}

export interface SetSuggestion {
  weightKg: number;
  reps: number;
}

// ============================================
// REP ADJUSTMENT
// ============================================

/**
 * Calculate RPE-adjusted reps for the next set based on previous set performance.
 *
 * The target rep range is always respected as a hard bound — the returned value
 * will never exceed targetRepRange[1] or drop below targetRepRange[0].
 *
 * Decision logic:
 * 1. If previous reps exceeded the range, weight should increase → suggest mid-range
 * 2. If RPE was too low AND at top of range, weight will increase → suggest mid-range
 * 3. If RPE was slightly low, add reps (up to range max)
 * 4. If RPE was too high, reduce reps (down to range min)
 * 5. Otherwise keep same reps, clamped to the target range
 */
export function suggestReps(
  previousSet: PreviousSetData,
  context: SuggestionContext
): number {
  const { targetRepRange, targetRir } = context;
  const [minReps, maxReps] = targetRepRange;
  const lastReps = previousSet.reps;
  const lastRpe = previousSet.rpe ?? 8;
  const targetRpe = 10 - targetRir;
  const rpeDiff = targetRpe - lastRpe; // positive = set was easier than target

  // If user significantly exceeded rep range, weight should increase.
  // Suggest mid-range reps for the heavier weight.
  if (lastReps > maxReps + 1) {
    return midRange(minReps, maxReps);
  }

  // If RPE was significantly low AND at/near top of range, weight will increase.
  // Suggest mid-range reps for the heavier weight.
  if (rpeDiff > 1 && lastReps >= maxReps) {
    return midRange(minReps, maxReps);
  }

  // Set was slightly easy — add reps toward top of range
  if (rpeDiff > 0.3 && lastReps < maxReps) {
    const repIncrease = Math.min(2, Math.floor(rpeDiff));
    return Math.min(maxReps, lastReps + repIncrease);
  }

  // Set was harder than target — reduce reps toward bottom of range
  if (rpeDiff < -0.3) {
    const repDecrease = Math.max(1, Math.floor(Math.abs(rpeDiff)));
    return Math.max(minReps, lastReps - repDecrease);
  }

  // On target — keep same reps, clamped to the target range
  return clampReps(lastReps, minReps, maxReps);
}

// ============================================
// WEIGHT ADJUSTMENT
// ============================================

/**
 * Calculate RPE-adjusted weight for the next set based on previous set performance.
 *
 * Uses the shared estimate1RM function for E1RM calculations, ensuring consistency
 * with the rest of the codebase (Brzycki/Epley/Lombardi average).
 *
 * Decision logic:
 * 1. If previous reps exceeded the range, estimate 1RM and calculate weight for mid-range reps
 * 2. If RPE was lower than target, increase weight proportionally
 * 3. If RPE was higher than target, decrease weight proportionally
 */
export function suggestWeight(
  previousSet: PreviousSetData,
  context: SuggestionContext
): number {
  const { targetRepRange, targetRir } = context;
  const [minReps, maxReps] = targetRepRange;
  const lastWeightKg = previousSet.weightKg;
  const lastReps = previousSet.reps;
  const lastRpe = previousSet.rpe ?? 8;
  const targetRpe = 10 - targetRir;
  const rpeDiff = targetRpe - lastRpe;

  // If reps significantly exceeded target range, calculate weight to bring reps back to mid-range
  if (lastReps > maxReps + 1) {
    const e1rm = estimate1RM(lastWeightKg, lastReps, lastRpe);
    const targetMidReps = midRange(minReps, maxReps);
    const effectiveTargetReps = targetMidReps + targetRir;
    // Inverse Epley: weight = E1RM / (1 + effectiveReps/30)
    return e1rm / (1 + effectiveTargetReps / 30);
  }

  // Standard RPE-based adjustment
  let adjustmentPercent: number;
  if (rpeDiff > 0) {
    // Set was easier than target — increase weight (4% per RPE point)
    adjustmentPercent = rpeDiff * 0.04;
  } else {
    // Set was harder than target — decrease weight (3% per RPE point)
    adjustmentPercent = rpeDiff * 0.03;
  }

  return lastWeightKg * (1 + adjustmentPercent);
}

// ============================================
// REPS FROM WEIGHT CHANGE
// ============================================

/**
 * Estimate the number of achievable reps when the user manually changes weight.
 *
 * Uses Epley formula to estimate 1RM from the reference set, then calculates
 * expected reps at the new weight. Result is clamped to the target rep range
 * to prevent nonsensical suggestions (e.g., 30 reps).
 *
 * @param newWeightKg - The new weight the user entered
 * @param reference - The reference set data (last completed or previous session)
 * @param context - Target rep range and RIR
 * @returns Estimated reps at the new weight, clamped to target range
 */
export function estimateRepsForWeight(
  newWeightKg: number,
  reference: PreviousSetData,
  context: SuggestionContext
): number {
  const { targetRepRange, targetRir } = context;
  const [minReps, maxReps] = targetRepRange;

  if (reference.weightKg <= 0 || newWeightKg <= 0 || reference.reps <= 0) {
    return midRange(minReps, maxReps);
  }

  const refRpe = reference.rpe ?? 8;
  const rir = 10 - refRpe;
  const effectiveReps = reference.reps + rir;

  // Estimate 1RM from reference using Epley
  const e1rm = reference.weightKg * (1 + effectiveReps / 30);

  // Estimate effective reps at new weight, then subtract RIR
  const effectiveRepsAtNewWeight = 30 * (e1rm / newWeightKg - 1);
  const estimatedReps = Math.round(effectiveRepsAtNewWeight - rir);

  // Clamp to the target rep range — this is the key fix that prevents
  // suggesting 30 reps when the weight is much lower than 1RM
  return clampReps(estimatedReps, minReps, maxReps);
}

// ============================================
// AMRAP PREDICTION
// ============================================

/**
 * Predict max reps for an AMRAP (As Many Reps As Possible) set.
 *
 * Based on the last completed set's RPE: predictedMax = lastReps + RIR.
 * Result is floored at the target range minimum and capped at a reasonable
 * ceiling above the target range to prevent absurd suggestions.
 */
export function predictAmrapReps(
  lastCompletedSet: PreviousSetData,
  context: SuggestionContext
): number {
  const { targetRepRange } = context;
  const [minReps, maxReps] = targetRepRange;
  const lastRpe = lastCompletedSet.rpe ?? 8;

  const repsInReserve = 10 - lastRpe;
  const predictedMaxReps = Math.round(lastCompletedSet.reps + repsInReserve);

  // AMRAP can exceed the normal range but cap at a reasonable ceiling
  // (range max + 5 prevents absurd values like 30+ from propagating)
  const amrapCeiling = maxReps + 5;
  return Math.max(minReps, Math.min(amrapCeiling, predictedMaxReps));
}

// ============================================
// FULL SET SUGGESTION
// ============================================

/**
 * Calculate both weight and rep suggestions for the next set.
 *
 * Convenience function that combines suggestWeight and suggestReps.
 * If there is no previous set data, returns the suggested weight and mid-range reps.
 */
export function suggestNextSet(
  previousSet: PreviousSetData | undefined,
  context: SuggestionContext,
  fallbackWeightKg: number = 0
): SetSuggestion {
  const { targetRepRange } = context;

  if (!previousSet) {
    return {
      weightKg: fallbackWeightKg,
      reps: midRange(targetRepRange[0], targetRepRange[1]),
    };
  }

  const hasRpe = previousSet.rpe !== undefined;

  if (hasRpe) {
    return {
      weightKg: suggestWeight(previousSet, context),
      reps: suggestReps(previousSet, context),
    };
  }

  // No RPE data — carry forward previous values, clamped to range
  return {
    weightKg: previousSet.weightKg,
    reps: clampReps(previousSet.reps, targetRepRange[0], targetRepRange[1]),
  };
}

// ============================================
// HELPERS
// ============================================

/** Round to the middle of a rep range */
function midRange(min: number, max: number): number {
  return Math.round((min + max) / 2);
}

/** Clamp reps to [min, max], ensuring at least 1 */
function clampReps(reps: number, min: number, max: number): number {
  return Math.max(Math.max(1, min), Math.min(max, reps));
}
