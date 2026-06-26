/**
 * Set Recommender — within-session next-set suggestion.
 *
 * Single engine for "what weight x reps should my next set be?" during an active
 * workout. Replaces the competing recommendNextSet (progressionEngine) and the
 * suggestWeight/suggestReps pair (setSuggestionEngine).
 *
 * Design + rationale: docs/next-set-recommender-design.md
 *
 * Principles:
 *  - Default: HOLD the weight (straight sets stay put).
 *  - Reps decline set-to-set with accumulated fatigue (set number matters).
 *  - Change the weight only on a CLEAR miss (deadband): increase when you cleared
 *    the top of the range AND left >= DEADBAND RIR (clearly too light); reduce when
 *    you couldn't reach the bottom of the range or went too close to failure.
 *  - Honest reps (not clamped to the range) so under-load is visible and feeds
 *    session-to-session progression (handled elsewhere).
 *
 * Pure functions — no DB calls or side effects.
 */

import { roundToIncrement, clamp } from '@/lib/utils';

// ============================================
// TUNABLE CONSTANTS (design doc §4)
// ============================================

/** How far the last set's RIR must miss target before we touch the weight. */
const DEADBAND_RIR = 2;
/** Cap on per-set load change. */
const MAX_STEP_PCT = 0.10;
/** Expected rep decline per set at a fixed load (HOLD case). */
const HOLD_DROP_RATE = 0.07;
/** Rep de-rating per already-completed set (weight-CHANGED case). */
const FATIGUE_PER_SET = 0.05;
/** Lower bound on the fatigue factor. */
const FATIGUE_FLOOR = 0.6;
/** Max reps shown above repMax (prevents absurd "30 reps", keeps honest under-load). */
const OVERSHOOT_CEILING = 5;

// ============================================
// TYPES
// ============================================

export interface SetRecommenderInput {
  /** The set just completed. */
  lastWeightKg: number;
  lastReps: number;
  /** Reps in reserve on the last set (>= 0; i.e. 10 - RPE). */
  lastRir: number;
  /** How many working sets are already done for this exercise this session. */
  setsCompletedThisExercise: number;
  /** Freshest/strongest E1RM (kg) seen this exercise — capacity anchor (design §6). */
  sessionBestE1RMKg?: number;
  /** Target working rep range [min, max]. */
  targetRepRange: [number, number];
  /** Target reps in reserve for working sets. */
  targetRir: number;
  /** Smallest load increment for this exercise (kg). */
  minIncrementKg?: number;
}

export interface SetRecommendation {
  weightKg: number;
  reps: number;
  rir: number;
  rationale: 'maintain' | 'increase_load' | 'reduce_load';
}

// ============================================
// HELPERS
// ============================================

/** Epley E1RM with RIR-adjusted reps. Unclamped — for prescription, not display. */
function epleyE1RM(weightKg: number, reps: number, rir: number): number {
  return weightKg * (1 + (reps + rir) / 30);
}

/** Inverse Epley: the load at which `reps` are achievable leaving `rir` in reserve. */
function weightForReps(e1rm: number, reps: number, rir: number): number {
  return e1rm / (1 + (reps + rir) / 30);
}

// ============================================
// MAIN
// ============================================

export function recommendSet(input: SetRecommenderInput): SetRecommendation {
  const { lastWeightKg, lastReps, lastRir, targetRepRange, targetRir } = input;
  const [repMin, repMax] = targetRepRange;
  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
  const n = Math.max(0, Math.floor(input.setsCompletedThisExercise ?? 0));

  // Guard bad inputs: keep the last set's shape.
  if (lastWeightKg <= 0 || lastReps <= 0) {
    return {
      weightKg: Math.max(0, lastWeightKg),
      reps: Math.max(repMin, lastReps || repMin),
      rir: targetRir,
      rationale: 'maintain',
    };
  }

  const safeRir = Math.max(0, lastRir);
  // Capacity anchor: freshest/strongest estimate avoids double-counting fatigue (§6).
  const e1rm = Math.max(input.sessionBestE1RMKg ?? 0, epleyE1RM(lastWeightKg, lastReps, safeRir));
  const dev = safeRir - targetRir; // + = easier than target, - = harder
  const mid = Math.round((repMin + repMax) / 2);

  // ---- 1) Decide the WEIGHT (default: hold) ----
  let weightKg: number;
  let rationale: SetRecommendation['rationale'];

  if (lastReps < repMin || dev <= -DEADBAND_RIR) {
    // Too heavy, or went too close to failure → reduce toward mid-range.
    const ideal = weightForReps(e1rm, mid, targetRir);
    weightKg = roundToIncrement(Math.max(ideal, lastWeightKg * (1 - MAX_STEP_PCT)), inc);
    if (weightKg >= lastWeightKg) weightKg = Math.max(inc, lastWeightKg - inc);
    rationale = 'reduce_load';
  } else if (lastReps >= repMax && dev >= DEADBAND_RIR) {
    // Cleared the top of the range AND still had >= DEADBAND in reserve → too light.
    const ideal = weightForReps(e1rm, repMax, targetRir);
    weightKg = roundToIncrement(Math.min(ideal, lastWeightKg * (1 + MAX_STEP_PCT)), inc);
    if (weightKg <= lastWeightKg) weightKg = lastWeightKg + inc;
    rationale = 'increase_load';
  } else {
    weightKg = lastWeightKg;
    rationale = 'maintain';
  }

  // ---- 2) Predict the REPS for the next set ----
  let reps: number;
  if (rationale === 'maintain') {
    // Anchor on what you just did and shave incremental fatigue. Tracks the real
    // per-set decline (12->11->10->9) without double-counting.
    const drop = Math.max(1, Math.round(lastReps * HOLD_DROP_RATE));
    reps = lastReps - drop;
  } else {
    // Weight changed → no "last reps at this weight" to decrement from. Predict from
    // the fresh capacity anchor, de-rated for sets already done.
    const fresh = 30 * (e1rm / weightKg - 1) - targetRir;
    const fatigue = Math.max(FATIGUE_FLOOR, 1 - FATIGUE_PER_SET * n);
    reps = Math.round(fresh * fatigue);
  }
  reps = clamp(reps, 1, repMax + OVERSHOOT_CEILING);

  return { weightKg, reps, rir: targetRir, rationale };
}

// ============================================
// AUXILIARY PREDICTIONS (design §8)
// ============================================

/**
 * Estimate achievable reps when the user manually types a different weight.
 * Clamped to the target range to prevent nonsensical suggestions.
 */
export function estimateRepsForWeight(
  newWeightKg: number,
  reference: { weightKg: number; reps: number; rir?: number },
  targetRepRange: [number, number],
  targetRir: number
): number {
  const [repMin, repMax] = targetRepRange;
  if (reference.weightKg <= 0 || newWeightKg <= 0 || reference.reps <= 0) {
    return Math.round((repMin + repMax) / 2);
  }
  const rir = Math.max(0, reference.rir ?? targetRir);
  const e1rm = epleyE1RM(reference.weightKg, reference.reps, rir);
  const estimated = Math.round(30 * (e1rm / newWeightKg - 1) - targetRir);
  return clamp(estimated, repMin, repMax);
}

/**
 * Predict max reps for an AMRAP set: lastReps + RIR, floored at repMin and capped
 * a bit above repMax so absurd values don't propagate.
 */
export function predictAmrapReps(
  lastSet: { reps: number; rir?: number },
  targetRepRange: [number, number]
): number {
  const [repMin, repMax] = targetRepRange;
  const rir = Math.max(0, lastSet.rir ?? 0);
  const predicted = Math.round(lastSet.reps + rir);
  return clamp(predicted, repMin, repMax + OVERSHOOT_CEILING);
}
