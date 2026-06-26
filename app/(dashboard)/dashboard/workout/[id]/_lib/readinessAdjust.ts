/**
 * readinessAdjust.ts
 *
 * Applies the readiness score from the pre-workout check-in to SUGGESTED
 * working weights (un-logged set seeds only). Wraps
 * services/fatigueEngine.adjustTargetsForReadiness so the page does not have
 * to construct ProgressionTargets inline.
 *
 * Conservative + reversible: only the *suggested* seed weight is scaled down
 * when readiness is reduced; logged sets are never touched. When readiness is
 * high (>= 80) or unknown, the original weight is returned unchanged.
 */

import { adjustTargetsForReadiness } from '@/services/fatigueEngine';
import type { ProgressionTargets } from '@/types/schema';

export interface ReadinessAdjustedWeight {
  weightKg: number;
  wasReduced: boolean;
}

/**
 * Scale a single suggested working weight by the readiness score.
 *
 * @param recommendedWeightKg base suggested weight (kg); 0/negative -> no-op
 * @param readinessScore      0-100 (from pre_workout_check_in.readinessScore)
 * @param repRange            target rep range (for the synthetic targets)
 * @param targetRir           target RIR
 * @param minWeightIncrement  exercise min weight increment (kg) for rounding
 */
export function adjustWorkingWeightForReadiness(
  recommendedWeightKg: number,
  readinessScore: number,
  repRange: [number, number],
  targetRir: number,
  minWeightIncrement: number
): ReadinessAdjustedWeight {
  // No suggestion to scale, or readiness unknown/high -> leave untouched.
  if (recommendedWeightKg <= 0 || !Number.isFinite(readinessScore) || readinessScore <= 0 || readinessScore >= 80) {
    return { weightKg: recommendedWeightKg, wasReduced: false };
  }

  const baseTargets: ProgressionTargets = {
    weightKg: recommendedWeightKg,
    repRange,
    targetRir,
    sets: 3,
    restSeconds: 180,
    progressionType: 'load',
    reason: '',
  };

  const adjusted = adjustTargetsForReadiness({
    baseTargets,
    readinessScore,
    minWeightIncrement: minWeightIncrement > 0 ? minWeightIncrement : 2.5,
  });

  const wasReduced = adjusted.weightKg < recommendedWeightKg;
  return {
    weightKg: wasReduced ? adjusted.weightKg : recommendedWeightKg,
    wasReduced,
  };
}
