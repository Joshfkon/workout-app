/**
 * Weight Projection (pure business logic)
 *
 * Projects a user's weight and body-composition trajectory forward from the
 * CURRENT phase's calorie target against a single TDEE estimate. This is the
 * math behind the "Weight Projection" card.
 *
 * Design contract (see the weight-projection ticket):
 *   - Pure function: (target calories, TDEE, phase, composition anchors, now)
 *     -> horizons. No clock reads, no store reads, no DB calls inside.
 *   - The caller MUST pass the same TDEE it displays on the Metabolism card so
 *     the two surfaces never disagree (single source of truth).
 *   - The caller MUST pass the current phase's calorie target, never a value
 *     cached from a previous phase.
 *   - A direction sanity check flags the (previously silent) bug where the
 *     projected direction contradicts the phase — e.g. projecting weight loss
 *     while the user is bulking because a stale below-TDEE target leaked in.
 *
 * Composition partitioning is phase-appropriate: a surplus and a deficit split
 * weight change into lean/fat mass differently. We branch on the projected
 * direction (which, once the target is phase-correct, follows the phase) and
 * use the surplus vs. deficit P-ratio models accordingly.
 */

import { calculateFFMI } from '@/services/bodyCompEngine';
import {
  calculatePRatio,
  predictWeightGainComposition,
  type PRatioInputs,
} from '@/lib/body-composition/p-ratio';

/** Calories per lb of body tissue (energy-balance convention). */
const CALORIES_PER_LB = 3500;
const LBS_PER_KG = 2.20462;
/** Minimum ± margin for water-weight fluctuation (lbs). */
const MIN_MARGIN_LBS = 1;

export type ProjectionPhase = 'bulk' | 'cut' | 'maintenance';

/**
 * Body-composition anchors. When null (missing height/body-fat), the projection
 * still returns weight horizons but omits BF%/FFMI.
 */
export interface CompositionAnchors {
  heightCm: number;
  /** Current body fat %, ideally anchored to the latest DEXA scan. */
  currentBodyFatPercent: number;
  avgDailyProteinGrams: number;
  avgWeeklyTrainingSets: number;
  trainingAge: 'beginner' | 'intermediate' | 'advanced';
  isEnhanced: boolean;
  biologicalSex: 'male' | 'female';
  chronologicalAge?: number;
}

export interface WeightProjectionInput {
  /** "Now" is injected so the math stays pure (no clock reads inside). */
  now: Date;
  currentWeightLbs: number;
  /** TDEE estimate — MUST be the same value shown on the Metabolism card. */
  tdee: number;
  /** Current phase's calorie target (never a stale/previous-phase value). */
  targetCalories: number;
  phase: ProjectionPhase;
  /** Standard error of the TDEE estimate, used to widen the ± margin over time. */
  standardError: number;
  /** Days ahead to project, e.g. [7, 14, 28, 56]. */
  horizonDays: number[];
  /** Composition anchors, or null when BF%/FFMI can't be projected. */
  composition: CompositionAnchors | null;
}

export interface ProjectionHorizon {
  daysFromNow: number;
  targetDate: string;
  predictedWeightLbs: number;
  marginLbs: number;
  /** Expected body fat % at this horizon, or null when composition is unavailable. */
  bodyFatPercent: number | null;
  /** Expected normalized FFMI at this horizon, or null when composition is unavailable. */
  ffmi: number | null;
}

export interface WeightProjectionResult {
  horizons: ProjectionHorizon[];
  /** cal/day actually used for the projection (echoes targetCalories). */
  usedCalories: number;
  /** TDEE actually used (echoes input.tdee) — single source of truth. */
  tdee: number;
  /** Positive = projected gain, negative = projected loss (lbs/day). */
  dailyWeightChangeLbs: number;
  /**
   * True when the projected direction contradicts the phase (loss while
   * bulking, or gain while cutting). When true the UI must not silently render
   * the projection — it means the calorie input is almost certainly stale.
   */
  directionMismatch: boolean;
  /** Card-level confidence in the composition trajectory. */
  confidenceLevel: 'high' | 'reasonable' | 'low';
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** YYYY-MM-DD in the local timezone of the provided date. */
function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A stable key over the inputs that must bust a memoized/cached projection.
 * When the phase, calorie target, TDEE, or current weight changes, this key
 * changes and the projection recomputes. Exported so callers can key a cache
 * (e.g. useMemo deps) and tests can assert the bust fires.
 */
export function projectionInputsKey(
  input: Pick<
    WeightProjectionInput,
    'phase' | 'targetCalories' | 'tdee' | 'currentWeightLbs'
  >
): string {
  return [
    input.phase,
    Math.round(input.targetCalories),
    Math.round(input.tdee),
    Math.round(input.currentWeightLbs * 10) / 10,
  ].join('|');
}

/**
 * Project the weight + body-composition trajectory. Pure: same inputs (including
 * `now`) always produce the same output.
 */
export function projectWeightTrajectory(
  input: WeightProjectionInput
): WeightProjectionResult {
  const { now, currentWeightLbs, tdee, targetCalories, phase, standardError, horizonDays, composition } =
    input;

  const dailyDeltaCal = targetCalories - tdee; // + surplus, - deficit
  const dailyWeightChangeLbs = dailyDeltaCal / CALORIES_PER_LB;

  // Direction sanity check: does the projected direction contradict the phase?
  const directionMismatch =
    (phase === 'bulk' && dailyDeltaCal < 0) || (phase === 'cut' && dailyDeltaCal > 0);

  // Energy balance as % of TDEE, using the documented sign convention:
  // negative = deficit, positive = surplus.
  const energyBalancePercent = tdee > 0 ? (dailyDeltaCal / tdee) * 100 : 0;

  // Precompute composition context once (P-ratio does not depend on horizon).
  let confidenceLevel: WeightProjectionResult['confidenceLevel'] = 'low';
  let pRatioInputs: PRatioInputs | null = null;
  let currentLeanMassKg = 0;
  let currentFatMassKg = 0;
  const currentWeightKg = currentWeightLbs / LBS_PER_KG;

  if (composition) {
    currentFatMassKg = currentWeightKg * (composition.currentBodyFatPercent / 100);
    currentLeanMassKg = currentWeightKg - currentFatMassKg;

    pRatioInputs = {
      avgDailyProteinGrams: composition.avgDailyProteinGrams,
      avgDailyProteinPerKgBW: composition.avgDailyProteinGrams / currentWeightKg,
      avgWeeklyTrainingSets: composition.avgWeeklyTrainingSets,
      avgDailyDeficitCals: dailyDeltaCal,
      energyBalancePercent,
      currentBodyFatPercent: composition.currentBodyFatPercent,
      currentLeanMassKg,
      trainingAge: composition.trainingAge,
      isEnhanced: composition.isEnhanced,
      biologicalSex: composition.biologicalSex,
      chronologicalAge: composition.chronologicalAge,
      personalPRatioHistory: undefined,
    };

    // Confidence comes from the P-ratio spread (deficit path). For surplus we
    // treat gain partitioning as inherently low-confidence (high variance).
    const pRatioResult = calculatePRatio(pRatioInputs);
    const rangeSpread = pRatioResult.confidenceRange[1] - pRatioResult.confidenceRange[0];
    const deficitConfidence: WeightProjectionResult['confidenceLevel'] =
      rangeSpread < 0.12 ? 'high' : rangeSpread < 0.18 ? 'reasonable' : 'low';
    confidenceLevel = dailyDeltaCal > 0 ? 'low' : deficitConfidence;
  }

  const horizons: ProjectionHorizon[] = horizonDays.map((days) => {
    const predictedWeightLbs = currentWeightLbs + dailyWeightChangeLbs * days;
    const errorMargin = (standardError * Math.sqrt(days)) / CALORIES_PER_LB;
    const marginLbs = Math.max(MIN_MARGIN_LBS, errorMargin);

    let bodyFatPercent: number | null = null;
    let ffmi: number | null = null;

    if (composition && pRatioInputs) {
      const predictedWeightKg = predictedWeightLbs / LBS_PER_KG;
      const weightChangeKg = predictedWeightKg - currentWeightKg;

      if (Math.abs(weightChangeKg) < 1e-6) {
        // No net change: composition holds.
        bodyFatPercent = composition.currentBodyFatPercent;
        ffmi = calculateFFMI(currentLeanMassKg, composition.heightCm).normalizedFfmi;
      } else if (weightChangeKg > 0) {
        // Surplus-appropriate partitioning.
        const proj = predictWeightGainComposition(
          currentWeightKg,
          predictedWeightKg,
          composition.currentBodyFatPercent,
          composition.heightCm,
          pRatioInputs
        );
        bodyFatPercent = proj.bodyFatPercent.expected;
        ffmi = proj.ffmi.expected;
      } else {
        // Deficit-appropriate partitioning.
        const pRatioResult = calculatePRatio(pRatioInputs);
        const pRatioMid = pRatioResult.finalPRatio;
        const expectedFatChange = weightChangeKg * pRatioMid;
        const expectedLeanChange = weightChangeKg * (1 - pRatioMid);
        const expectedFatMass = currentFatMassKg + expectedFatChange;
        const expectedLeanMass = currentLeanMassKg + expectedLeanChange;
        bodyFatPercent = (expectedFatMass / predictedWeightKg) * 100;
        ffmi = calculateFFMI(expectedLeanMass, composition.heightCm).normalizedFfmi;
      }
    }

    return {
      daysFromNow: days,
      targetDate: localDateString(addDays(now, days)),
      predictedWeightLbs: Math.round(predictedWeightLbs * 10) / 10,
      marginLbs: Math.round(marginLbs * 10) / 10,
      bodyFatPercent: bodyFatPercent === null ? null : Math.round(bodyFatPercent * 10) / 10,
      ffmi: ffmi === null ? null : Math.round(ffmi * 10) / 10,
    };
  });

  return {
    horizons,
    usedCalories: targetCalories,
    tdee,
    dailyWeightChangeLbs,
    directionMismatch,
    confidenceLevel,
  };
}
