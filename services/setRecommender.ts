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
/** Cap on per-set load increase. */
const MAX_STEP_PCT = 0.10;
/**
 * Cap on per-set load reduction. Asymmetric on purpose: increases are capped tight
 * (+10%) to prevent wild jumps, but when the last set proves the load is far too
 * heavy (e.g. 2 reps against a 10–15 range) the correction to mid-range can need a
 * ~30% drop — capping it at 10% used to leave the next suggestion still too heavy,
 * with a predicted rep count below the target range.
 */
const MAX_REDUCE_PCT = 0.30;
/** Expected rep decline per set at a fixed load (HOLD case). */
const HOLD_DROP_RATE = 0.07;
/** Rep de-rating per already-completed set (weight-CHANGED case). */
const FATIGUE_PER_SET = 0.05;
/** Lower bound on the fatigue factor. */
const FATIGUE_FLOOR = 0.6;
/** Max reps shown above repMax (prevents absurd "30 reps", keeps honest under-load). */
const OVERSHOOT_CEILING = 5;
/**
 * Reps beyond repMax that objectively prove the load is too light, regardless of
 * self-reported RIR. Hitting this many reps over the top of the range is an
 * unambiguous under-load signal even if the RIR rating sits inside the deadband
 * (e.g. 18 reps in a 3-6 range).
 */
const REP_OVERSHOOT = 2;

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

/**
 * Predict achievable reps at a given weight from the capacity anchor, de-rated
 * for sets already done. Single prediction core shared by recommendSet's
 * weight-changed branch and estimateRepsForWeight (manual weight edits), so the
 * banner suggestion and the weight-edit recalc can never disagree.
 *
 * Honest reps (design §7): clamped to [1, repMax + OVERSHOOT_CEILING], never
 * floored up to the range minimum — a too-heavy load must show an out-of-range
 * prediction instead of being silently "fixed" to the plan.
 */
function predictRepsAtWeight(
  e1rm: number,
  weightKg: number,
  targetRir: number,
  setsCompleted: number,
  repMax: number
): number {
  const fresh = 30 * (e1rm / weightKg - 1) - targetRir;
  const fatigue = Math.max(FATIGUE_FLOOR, 1 - FATIGUE_PER_SET * setsCompleted);
  return clamp(Math.round(fresh * fatigue), 1, repMax + OVERSHOOT_CEILING);
}

// ============================================
// MAIN
// ============================================

export function recommendSet(input: SetRecommenderInput): SetRecommendation {
  const { lastWeightKg, lastReps, lastRir, targetRepRange, targetRir } = input;
  const [repMin, repMax] = targetRepRange;
  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
  const n = Math.max(0, Math.floor(input.setsCompletedThisExercise ?? 0));

  // Guard bad inputs: keep the last set's load, but pull the rep target into
  // the range — zero-load history (bodyweight without a check-in) has no
  // weight lever, so the reps must follow a moved rep range.
  if (lastWeightKg <= 0 || lastReps <= 0) {
    return {
      weightKg: Math.max(0, lastWeightKg),
      reps: clamp(lastReps || repMin, repMin, repMax),
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

  if (lastReps > repMax + REP_OVERSHOOT || (lastReps >= repMax && dev >= DEADBAND_RIR)) {
    // Too light — either an unambiguous rep-overshoot (reps prove it regardless
    // of RIR — checked BEFORE the effort branch, so a rep range moved down by
    // the one-tap plateau switch reprices upward even off a near-failure set)
    // OR cleared the top of the range with >= DEADBAND reserve.
    const ideal = weightForReps(e1rm, repMax, targetRir);
    weightKg = roundToIncrement(Math.min(ideal, lastWeightKg * (1 + MAX_STEP_PCT)), inc);
    if (weightKg <= lastWeightKg) weightKg = lastWeightKg + inc;
    rationale = 'increase_load';
  } else if (lastReps < repMin || dev <= -DEADBAND_RIR) {
    // Too heavy, or went too close to failure → reduce toward mid-range.
    const ideal = weightForReps(e1rm, mid, targetRir);
    weightKg = roundToIncrement(Math.max(ideal, lastWeightKg * (1 - MAX_REDUCE_PCT)), inc);
    if (weightKg >= lastWeightKg) weightKg = Math.max(inc, lastWeightKg - inc);
    rationale = 'reduce_load';
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
    reps = clamp(lastReps - drop, 1, repMax + OVERSHOOT_CEILING);
  } else {
    // Weight changed → no "last reps at this weight" to decrement from. Predict from
    // the fresh capacity anchor, de-rated for sets already done.
    reps = predictRepsAtWeight(e1rm, weightKg, targetRir, n, repMax);
  }

  return { weightKg, reps, rir: targetRir, rationale };
}

/** Input for recommendSessionStart — the matching set from the PREVIOUS session. */
export interface SessionStartInput {
  prevWeightKg: number;
  prevReps: number;
  /** RIR on that set, when recorded. Omitted → assume it landed on target. */
  prevRir?: number;
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
}

/**
 * Session-START recommendation: the first working set of a NEW session,
 * anchored to the corresponding set from the previous session.
 *
 * Same weight policy as recommendSet (hold by default, step only on a clear
 * miss), so a mis-loaded session — e.g. 20 reps left at 4 RIR against a
 * 10-15 @ 2 RIR target — doesn't get replayed verbatim. The rep prediction
 * differs: the lifter is FRESH, so on a hold there is no within-session
 * fatigue to shave and the expectation is to repeat last session's reps.
 */
export function recommendSessionStart(input: SessionStartInput): SetRecommendation {
  const rec = recommendSet({
    lastWeightKg: input.prevWeightKg,
    lastReps: input.prevReps,
    lastRir: input.prevRir ?? input.targetRir,
    setsCompletedThisExercise: 0,
    targetRepRange: input.targetRepRange,
    targetRir: input.targetRir,
    minIncrementKg: input.minIncrementKg,
  });
  if (rec.rationale === 'maintain' && input.prevReps > 0 && input.prevWeightKg > 0) {
    // Honest reps (design §7): repeat what the set actually was, capped only
    // at the display overshoot ceiling. Zero-load references skip this — with
    // no weight lever, the guard's in-range rep target IS the seed.
    return { ...rec, reps: clamp(input.prevReps, 1, input.targetRepRange[1] + OVERSHOOT_CEILING) };
  }
  return rec;
}

// ============================================
// AUXILIARY PREDICTIONS (design §8)
// ============================================

/**
 * Estimate achievable reps when the user manually types a different weight.
 *
 * Runs the same prediction core — and the same capacity anchor — as
 * recommendSet's weight-changed branch, so re-entering the recommended weight
 * reproduces the recommended reps exactly and nearby weights move the estimate
 * smoothly. Honest reps: never floored up to the range minimum (design §7).
 */
export function estimateRepsForWeight(
  newWeightKg: number,
  input: Omit<SetRecommenderInput, 'minIncrementKg'>
): number {
  const { lastWeightKg, lastReps, lastRir, targetRepRange, targetRir } = input;
  const [repMin, repMax] = targetRepRange;
  const n = Math.max(0, Math.floor(input.setsCompletedThisExercise ?? 0));

  // Capacity anchor: same rule as recommendSet (§6) — freshest/strongest
  // session E1RM, falling back to the reference set's estimate.
  const referenceE1RM =
    lastWeightKg > 0 && lastReps > 0 ? epleyE1RM(lastWeightKg, lastReps, Math.max(0, lastRir)) : 0;
  const e1rm = Math.max(input.sessionBestE1RMKg ?? 0, referenceE1RM);

  if (newWeightKg <= 0 || e1rm <= 0) {
    return Math.round((repMin + repMax) / 2);
  }

  return predictRepsAtWeight(e1rm, newWeightKg, targetRir, n, repMax);
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
