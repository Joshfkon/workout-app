/**
 * Set Recommender — within-session next-set suggestion.
 *
 * Single engine for "what weight x reps should my next set be?" during an active
 * workout. Replaced the competing recommendNextSet (progressionEngine, since
 * deleted) and the suggestWeight/suggestReps pair (setSuggestionEngine).
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
import { rpeToRir } from '@/types/schema';
import {
  COLD_START_EASY_RIR,
  COLD_START_STEP_PCT,
  DEADBAND_RIR,
  EFFORT_MATCH_TOLERANCE,
  MAX_STEP_PCT,
  MAX_REDUCE_PCT,
  HOLD_DROP_RATE,
  FATIGUE_E1RM_PER_SET,
  FATIGUE_E1RM_FLOOR,
  OVERSHOOT_CEILING,
  REP_OVERSHOOT,
  RAMP_LOAD_FRACTION,
  WORKING_WEIGHT_CLAMP_FRACTION,
  OVERRIDE_DEVIATION_FRACTION,
  RECAL_FATIGUE_CORRECTION_PER_SET,
  RECAL_MAX_FRESHNESS_CORRECTION,
  SUGGESTION_ENGINE_VERSION,
} from './suggestionEngine/constants';
import { inferRolesForSession, type SetRole } from './suggestionEngine/setRoles';

// Tunable constants now live in services/suggestionEngine/constants.ts (one
// module for the whole suggestion surface — see task constraints). The design
// doc §4 table documents the within-session dials.

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
  /**
   * True on the exercise's FIRST-EVER session (no logged history): the weight
   * was a cold-start estimate, expected to be wrong low. An easy-rated set
   * (RIR >= COLD_START_EASY_RIR) bumps the load even mid-range, and the step
   * cap widens to COLD_START_STEP_PCT so the session converges fast.
   */
  coldStart?: boolean;
}

export interface SetRecommendation {
  weightKg: number;
  reps: number;
  rir: number;
  rationale: 'maintain' | 'increase_load' | 'reduce_load';
  /**
   * How the REFERENCE set's actual effort compared to the target RIR, derived
   * from the same `dev` (lastRir − targetRir) the weight/rep math uses. The
   * banner phrases a hold from this instead of assuming every in-deadband set
   * "matched" — a set left easier than target must not read as matched.
   */
  effortVsTarget: 'easier' | 'on_target' | 'harder';
}

/**
 * Resolve the RIR to feed the recommender from a PERSISTED set record, in
 * priority order:
 *   1. `feedback.repsInTank` — the exact RIR chip the user logged (ground truth).
 *   2. `rpe` → `rpeToRir` — derived effort when only RPE was stored.
 *   3. `targetRir` — ONLY when the set carries no effort signal at all.
 *
 * This is the read-path fix: the engine must grade the effort actually logged on
 * the set, never a UI-selected / default value. Reading the stored RIR directly
 * (rather than reconstructing it as `10 − rpe`) also keeps this consistent with
 * every other read site (which use `rpeToRir`) and with the RIR-2 "good" chip,
 * whose stored `rpe` is 7.5.
 */
export function resolveLastRir(
  set: { rpe?: number | null; feedback?: { repsInTank?: number | null } | null },
  targetRir: number
): number {
  const logged = set.feedback?.repsInTank;
  if (logged != null) return Math.max(0, logged);
  if (set.rpe != null) return Math.max(0, rpeToRir(set.rpe));
  return targetRir;
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
// SESSION-TO-SESSION BUMP GATING (all working sets)
// ============================================

/** One set from the previous session, in performed order, for bump gating. */
export interface PrevSessionSet {
  weightKg: number;
  reps: number;
  /** RIR on that set when recorded. Omitted → assume it landed on target. */
  rir?: number;
}

/**
 * Did the previous session EARN a load increase? True only when EVERY working
 * set cleared the top of the rep range under the existing effort condition
 * (>= DEADBAND_RIR spare, or an unambiguous +REP_OVERSHOOT rep overshoot).
 *
 * A single strong top set followed by mid-range back-half sets (12-10-9) must
 * read as "keep accumulating reps at this load", not as a bump — grading one
 * qualifying set was audit failure mode #5 (single-set gating).
 *
 * Set roles are respected: ramp / back-off sets (load below
 * RAMP_ROLE_MAX_FRACTION of the session top set, per setRoles inference) are
 * feeder work and are never graded against the working rep target — so a
 * designated light last set doesn't block a bump the working sets earned.
 */
export function earnedSessionBump(
  prevSessionSets: PrevSessionSet[],
  targetRepRange: [number, number],
  targetRir: number
): boolean {
  const repMax = targetRepRange[1];
  const roles = inferRolesForSession(prevSessionSets.map((s) => ({ weightKg: s.weightKg })));
  let gradedWorkingSets = 0;
  for (let i = 0; i < prevSessionSets.length; i++) {
    if (roles[i] !== 'working') continue;
    const s = prevSessionSets[i];
    if (!(s.weightKg > 0) || !(s.reps > 0)) continue;
    gradedWorkingSets++;
    const dev = Math.max(0, s.rir ?? targetRir) - targetRir;
    const qualified = s.reps > repMax + REP_OVERSHOOT || (s.reps >= repMax && dev >= DEADBAND_RIR);
    if (!qualified) return false;
  }
  return gradedWorkingSets > 0;
}

// ============================================
// SESSION-TO-SESSION REGRESSION (confirmed underperformance → step down)
// ============================================

/**
 * A session's floor evidence: did even the BEST working set fail to reach the
 * bottom of the rep range? Ramp / back-off sets are excluded via role
 * inference. Returns null when the session has no graded working sets.
 */
function sessionFloorMiss(
  sets: PrevSessionSet[],
  targetRepRange: [number, number]
): { belowFloor: boolean; topWorkingWeightKg: number } | null {
  const repMin = targetRepRange[0];
  const roles = inferRolesForSession(sets.map((s) => ({ weightKg: s.weightKg })));
  let bestReps = 0;
  let topWeight = 0;
  let graded = 0;
  for (let i = 0; i < sets.length; i++) {
    if (roles[i] !== 'working') continue;
    const s = sets[i];
    if (!(s.weightKg > 0) || !(s.reps > 0)) continue;
    graded++;
    if (s.reps > bestReps) bestReps = s.reps;
    if (s.weightKg > topWeight) topWeight = s.weightKg;
  }
  if (graded === 0) return null;
  return { belowFloor: bestReps < repMin, topWorkingWeightKg: topWeight };
}

/**
 * TWO consecutive sessions below the rep-range floor at a maintained load =
 * confirmed regression → the load steps DOWN one increment (Fix 4). One bad
 * session is noise (sleep, stress) and holds instead.
 *
 * "At a given load": the last session must not have already self-corrected
 * downward (top working load within 5% of, or above, the prior session's) —
 * if the load was already reduced and still missed, the reduced load gets its
 * own second chance before stepping further.
 */
export function confirmedRegression(
  lastSessionSets: PrevSessionSet[],
  priorSessionSets: PrevSessionSet[],
  targetRepRange: [number, number]
): boolean {
  const last = sessionFloorMiss(lastSessionSets, targetRepRange);
  const prior = sessionFloorMiss(priorSessionSets, targetRepRange);
  if (!last?.belowFloor || !prior?.belowFloor) return false;
  return last.topWorkingWeightKg >= prior.topWorkingWeightKg * 0.95;
}

/**
 * One per-exercise increment down, floored at −MAX_STEP_PCT (the mirror of
 * the up-cap). Rounding may collapse back to the held weight — then a full
 * increment is taken anyway, exactly like the up-step's `+= inc` escape.
 */
function regressionStepDown(weightKg: number, inc: number): number {
  let stepped = roundToIncrement(Math.max(weightKg - inc, weightKg * (1 - MAX_STEP_PCT)), inc);
  if (stepped >= weightKg) stepped = weightKg - inc;
  return Math.max(0, stepped);
}

// ============================================
// UNIFIED PRESCRIPTION CORE
// ============================================

/**
 * Input to the single RIR-invariant weight↔reps function. `e1RMKg` is the
 * EFFECTIVE capacity: every adjustment layer (within-session fatigue via
 * `fatigueAdjustedE1RM`, readiness easing via a raised `targetRir`, RPE
 * calibration via how logged RIR resolved into the e1RM) is applied to the
 * INPUTS before the curve is evaluated — never to the output reps/weight.
 */
export interface PrescribeInput {
  /** Effective estimated 1RM (kg) — after any input-side adjustments. */
  e1RMKg: number;
  /** Effective target reps in reserve. */
  targetRir: number;
  /**
   * Target rep range [min, max]. ADVISORY: only used to pick a weight when
   * `weightKg` is omitted (aim mid-range). It is never substituted into the
   * reps answer — a too-heavy or too-light weight shows its honest count.
   */
  repRange: [number, number];
  /** When given, answer "how many reps at THIS weight". When omitted, pick the weight. */
  weightKg?: number;
  /** Smallest load increment (kg) for weight picking. */
  minIncrementKg?: number;
}

export interface Prescription {
  weightKg: number;
  reps: number;
  rir: number;
}

/**
 * THE weight↔reps prescription function (one formula app-wide: Epley with
 * RIR-adjusted reps, and its inverse).
 *
 *  - `weightKg` given  → reps = round(30·(e1RM/weight − 1) − targetRIR),
 *    clamped to [1, ∞). Reps are strictly the curve answer: monotonically
 *    non-increasing in weight, and NEVER a range max, range mid, or any other
 *    constant fallback.
 *  - `weightKg` omitted → pick the weight so predicted reps land mid rep-range
 *    at the target RIR, then answer the reps AT the rounded weight so the
 *    suggested (weight, reps) pair round-trips through this same function.
 *
 * Returns null when there is no usable e1RM (or weight ≤ 0): with no capacity
 * anchor there is no curve, and the caller must leave the reps field untouched
 * rather than inventing a number.
 */
export function prescribe(input: PrescribeInput): Prescription | null {
  const { e1RMKg, repRange } = input;
  if (!(e1RMKg > 0)) return null;
  const rir = Math.max(0, input.targetRir);

  const repsAt = (weightKg: number) => Math.max(1, Math.round(30 * (e1RMKg / weightKg - 1) - rir));

  if (input.weightKg !== undefined) {
    if (!(input.weightKg > 0)) return null;
    return { weightKg: input.weightKg, reps: repsAt(input.weightKg), rir };
  }

  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
  const mid = Math.round((repRange[0] + repRange[1]) / 2);
  const weightKg = roundToIncrement(weightForReps(e1RMKg, mid, rir), inc);
  if (!(weightKg > 0)) return null;
  return { weightKg, reps: repsAt(weightKg), rir };
}

/**
 * Within-session fatigue as an INPUT adjustment: each completed set shaves a
 * small slice off the effective e1RM (floored), so later-set prescriptions sit
 * lower on the same curve instead of the reps being de-rated after the fact.
 * This is layer 1 of the adjustment stack (see prescriptionLayers.test.ts).
 */
export function fatigueAdjustedE1RM(e1RMKg: number, setsCompleted: number): number {
  const n = Math.max(0, Math.floor(setsCompleted));
  return e1RMKg * Math.max(FATIGUE_E1RM_FLOOR, 1 - FATIGUE_E1RM_PER_SET * n);
}

/**
 * Predict achievable reps at a given weight from the capacity anchor, de-rated
 * for sets already done. Single prediction core shared by recommendSet's
 * weight-changed branch and estimateRepsForWeight (manual weight edits), so the
 * banner suggestion and the weight-edit recalc can never disagree.
 *
 * Honest reps (design §7): clamped to [1, ∞) only — never floored up to the
 * range minimum, never capped to the range maximum. A mis-matched load must
 * show its honest out-of-range prediction instead of a substituted constant
 * (the range-max cap here is exactly what used to emit "× 20").
 */
function predictRepsAtWeight(
  e1rm: number,
  weightKg: number,
  targetRir: number,
  setsCompleted: number,
  repRange: [number, number]
): number {
  const p = prescribe({
    e1RMKg: fatigueAdjustedE1RM(e1rm, setsCompleted),
    targetRir,
    repRange,
    weightKg,
  });
  // Callers guarantee e1rm > 0 and weightKg > 0, so p is always present.
  return p ? p.reps : 1;
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
      effortVsTarget: 'on_target',
    };
  }

  const safeRir = Math.max(0, lastRir);
  // Capacity anchor: freshest/strongest estimate avoids double-counting fatigue (§6).
  const e1rm = Math.max(input.sessionBestE1RMKg ?? 0, epleyE1RM(lastWeightKg, lastReps, safeRir));
  const dev = safeRir - targetRir; // + = easier than target, - = harder
  const mid = Math.round((repMin + repMax) / 2);
  // Classify the last set's effort from the SAME `dev` the math below uses, so
  // the banner can never claim "matched" for a set that was actually easier or
  // harder than target within the deadband.
  const effortVsTarget: SetRecommendation['effortVsTarget'] =
    dev >= EFFORT_MATCH_TOLERANCE ? 'easier' : dev <= -EFFORT_MATCH_TOLERANCE ? 'harder' : 'on_target';

  // ---- 1) Decide the WEIGHT (default: hold) ----
  let weightKg: number;
  let rationale: SetRecommendation['rationale'];

  // Cold-start sets adapt aggressively: the starting weight was an estimate,
  // expected to be wrong low. The step cap widens, and an easy-rated set bumps
  // the load even when the reps landed mid-range.
  // (An easy rating on a below-range set is contradictory input — hold instead.)
  const coldStartEasy = !!input.coldStart && safeRir >= COLD_START_EASY_RIR && lastReps >= repMin;
  const stepCap = input.coldStart ? COLD_START_STEP_PCT : MAX_STEP_PCT;

  if (lastReps > repMax + REP_OVERSHOOT || (lastReps >= repMax && dev >= DEADBAND_RIR)) {
    // Too light — either an unambiguous rep-overshoot (reps prove it regardless
    // of RIR — checked BEFORE the effort branch, so a rep range moved down by
    // the one-tap plateau switch reprices upward even off a near-failure set)
    // OR cleared the top of the range with >= DEADBAND reserve.
    const ideal = weightForReps(e1rm, repMax, targetRir);
    weightKg = roundToIncrement(Math.min(ideal, lastWeightKg * (1 + stepCap)), inc);
    if (weightKg <= lastWeightKg) weightKg = lastWeightKg + inc;
    rationale = 'increase_load';
  } else if (coldStartEasy) {
    // Cold-start "easy" rating: the RIR chip caps at 4+, so Epley can't see
    // the real headroom — a rated-easy first set means the estimate was low.
    // Bump by the full cold-start step rather than deriving from reported RIR.
    weightKg = roundToIncrement(lastWeightKg * (1 + COLD_START_STEP_PCT), inc);
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
    // Honor the LOGGED effort: a set left easier than target (dev > 0) has more
    // reps in hand at the target effort; harder (dev < 0) fewer. Shifting by the
    // RIR gap is the fix — the old code shaved from lastReps alone, silently
    // grading every in-deadband set as if it hit the target (11 @ 3 RIR -> 10,
    // "matched", when ~12 were available @ 2 RIR).
    reps = clamp(lastReps + Math.round(dev) - drop, 1, repMax + OVERSHOOT_CEILING);
  } else {
    // Weight changed → no "last reps at this weight" to decrement from. Predict from
    // the fresh capacity anchor, de-rated for sets already done.
    reps = predictRepsAtWeight(e1rm, weightKg, targetRir, n, targetRepRange);
  }

  return { weightKg, reps, rir: targetRir, rationale, effortVsTarget };
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
  /**
   * ALL sets from the previous session (in performed order), for the all-sets
   * bump gate: a load increase is earned only when every working set cleared
   * the top of the range (earnedSessionBump). Omitted → legacy single-set
   * grading (callers that only know the one corresponding set).
   */
  prevSessionSets?: PrevSessionSet[];
  /**
   * ALL sets from the session BEFORE last, for the regression path (Fix 4):
   * a session-start load REDUCTION requires two consecutive below-floor
   * sessions (confirmedRegression) and then steps down exactly one increment
   * (capped −MAX_STEP_PCT); a single bad session holds. Pass [] when the
   * prior session is known not to exist. Omitted (undefined) → legacy
   * immediate curve-based reduce.
   */
  priorSessionSets?: PrevSessionSet[];
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
 *
 * With `prevSessionSets`, a session-to-session INCREASE additionally requires
 * the whole previous session to have earned it (every working set at the top
 * of the range — earnedSessionBump); a lone strong set holds instead.
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
  if (rec.rationale === 'reduce_load' && input.priorSessionSets !== undefined) {
    // Regression path (Fix 4): prescribe DOWN only on CONFIRMED
    // underperformance — two consecutive sessions below the range floor at a
    // maintained load. One bad session (below floor, or a grind) is noise:
    // hold the load and let the lifter retry fresh.
    const lastSessionSets: PrevSessionSet[] =
      input.prevSessionSets && input.prevSessionSets.length > 0
        ? input.prevSessionSets
        : [{ weightKg: input.prevWeightKg, reps: input.prevReps, rir: input.prevRir }];
    if (confirmedRegression(lastSessionSets, input.priorSessionSets, input.targetRepRange)) {
      const inc =
        input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
      const [repMin, repMax] = input.targetRepRange;
      return {
        weightKg: regressionStepDown(input.prevWeightKg, inc),
        // Recenter the rep expectation on the plan at the reduced load.
        reps: Math.round((repMin + repMax) / 2),
        rir: input.targetRir,
        rationale: 'reduce_load',
        effortVsTarget: rec.effortVsTarget,
      };
    }
    return {
      weightKg: input.prevWeightKg,
      reps: clamp(input.prevReps, 1, input.targetRepRange[1] + OVERSHOOT_CEILING),
      rir: input.targetRir,
      rationale: 'maintain',
      effortVsTarget: rec.effortVsTarget,
    };
  }
  if (
    rec.rationale === 'increase_load' &&
    input.prevSessionSets &&
    input.prevSessionSets.length > 0 &&
    !earnedSessionBump(input.prevSessionSets, input.targetRepRange, input.targetRir)
  ) {
    // The reference set alone would bump, but the session as a whole didn't
    // earn it — hold the load and keep accumulating reps across all sets.
    return {
      weightKg: input.prevWeightKg,
      reps: clamp(input.prevReps, 1, input.targetRepRange[1] + OVERSHOOT_CEILING),
      rir: input.targetRir,
      rationale: 'maintain',
      effortVsTarget: rec.effortVsTarget,
    };
  }
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
 *
 * Returns null when NO e1RM exists (no session anchor and no usable reference
 * set): a weight edit must then leave the reps field untouched — the range is
 * a plan, not a curve answer, and writing it here is how the "× 20" bug read.
 */
export function estimateRepsForWeight(
  newWeightKg: number,
  input: Omit<SetRecommenderInput, 'minIncrementKg'>
): number | null {
  const { lastWeightKg, lastReps, lastRir, targetRepRange, targetRir } = input;
  const n = Math.max(0, Math.floor(input.setsCompletedThisExercise ?? 0));

  // Capacity anchor: same rule as recommendSet (§6) — freshest/strongest
  // session E1RM, falling back to the reference set's estimate. The caller is
  // responsible for passing an anchor that is CONSISTENT with the on-screen
  // suggestion (session-best, else last-session resolved, else cold-start) —
  // never a stale all-time record the shown numbers weren't derived from.
  const referenceE1RM =
    lastWeightKg > 0 && lastReps > 0 ? epleyE1RM(lastWeightKg, lastReps, Math.max(0, lastRir)) : 0;
  const e1rm = Math.max(input.sessionBestE1RMKg ?? 0, referenceE1RM);

  if (newWeightKg <= 0 || e1rm <= 0) return null;

  return predictRepsAtWeight(e1rm, newWeightKg, targetRir, n, targetRepRange);
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

// ============================================
// SESSION-START PRESCRIPTION BY SET ROLE (Phases 2–3)
// ============================================

/**
 * What anchor the prescribed weight was actually computed from — surfaced in the
 * provenance sheet so we never list a number that didn't influence the output.
 */
export type AnchorSource = 'e1rm' | 'last_session' | 'ramp_percent' | 'none';

export interface SeedSlotInput {
  /** Resolved role for this slot (user tag beats inference — resolve upstream). */
  role: SetRole;
  /** Target working rep range [min, max]. */
  targetRepRange: [number, number];
  /** Target reps in reserve for WORKING sets. */
  targetRir: number;
  /** Smallest load increment for this exercise (kg). */
  minIncrementKg?: number;
  /**
   * The exercise's e1RM capacity anchor (kg) — the stored / session-best e1RM.
   * This is the number that was being displayed-but-ignored before the fix.
   */
  anchorE1RMKg?: number;
  /**
   * Best recent same-exercise WORKING weight (kg). The e1RM prescription is
   * clamped to within ±WORKING_WEIGHT_CLAMP_FRACTION of this so a hot e1RM can't
   * prescribe a giant jump. Omit → no clamp (nothing recent to bound against).
   */
  recentWorkingWeightKg?: number;
  /**
   * Today's prescribed top WORKING set (kg) — the reference a ramp set is a
   * percentage of. When omitted, it's derived from the e1RM working prescription
   * so ramp/working share one basis.
   */
  topWorkingWeightKg?: number;
  /** Fallback anchor when there's no e1RM: the previous session's set for this slot. */
  prevWeightKg?: number;
  prevReps?: number;
  prevRir?: number;
  /**
   * ALL sets from the previous session (in performed order). When provided,
   * the e1RM prescription may only rise above `recentWorkingWeightKg` if the
   * whole session earned it (every working set at the top of the range —
   * earnedSessionBump); otherwise the seed is ceilinged at the recent working
   * weight. Omitted → legacy behavior (±clamp only).
   */
  prevSessionSets?: PrevSessionSet[];
  /**
   * ALL sets from the session BEFORE last (Fix 4): with both session lists
   * present and BOTH sessions below the rep-range floor at a maintained load
   * (confirmedRegression), the working seed steps DOWN one increment from the
   * recent working weight instead of consulting the e1RM curve. Omitted → no
   * regression check.
   */
  priorSessionSets?: PrevSessionSet[];
}

export interface SeedRecommendation {
  weightKg: number;
  /** Prescribe the RANGE, never a copied rep count. */
  repRange: [number, number];
  /** Target RIR — only meaningful when `showRirTarget` is true. */
  rir: number;
  role: SetRole;
  /** Ramp sets carry no RIR target and no "too light" nagging. */
  showRirTarget: boolean;
  anchorSource: AnchorSource;
  /** True when the ±clamp bound the e1RM prescription (say so in provenance). */
  clamped: boolean;
  engineVersion: number;
}

/**
 * Compute the working-set weight from the e1RM anchor for the middle of the rep
 * range, clamped to ±WORKING_WEIGHT_CLAMP_FRACTION of the best recent working
 * weight. Returned separately so a ramp slot can base its percentage on the same
 * working weight the working slots would get.
 */
function workingWeightFromAnchor(
  anchorE1RMKg: number,
  targetRepRange: [number, number],
  targetRir: number,
  inc: number,
  recentWorkingWeightKg?: number,
  bumpEarned?: boolean
): { weightKg: number; clamped: boolean } {
  const [repMin, repMax] = targetRepRange;
  const mid = Math.round((repMin + repMax) / 2);
  const raw = weightForReps(anchorE1RMKg, mid, targetRir);

  let bounded = raw;
  let clamped = false;
  if (recentWorkingWeightKg && recentWorkingWeightKg > 0) {
    const lo = recentWorkingWeightKg * (1 - WORKING_WEIGHT_CLAMP_FRACTION);
    const hi = recentWorkingWeightKg * (1 + WORKING_WEIGHT_CLAMP_FRACTION);
    bounded = clamp(raw, lo, hi);
    clamped = bounded !== raw;
    // All-sets bump gate: a hot e1RM (usually one strong top set) may not
    // prescribe ABOVE the recent working weight unless the whole previous
    // session earned it. Only reported as clamped when the gate actually
    // moved the rounded prescription.
    if (bumpEarned === false && bounded > recentWorkingWeightKg) {
      const gated = recentWorkingWeightKg;
      clamped =
        clamped || roundToIncrement(gated, inc) !== roundToIncrement(bounded, inc);
      bounded = gated;
    }
  }

  return { weightKg: roundToIncrement(bounded, inc), clamped };
}

/**
 * Session-START prescription for one set slot, role-aware.
 *
 * WORKING slot:
 *  - weight from the e1RM anchor for the mid of the rep range, clamped ±10% of
 *    recent working weight; prescribe the rep RANGE.
 *  - if no e1RM anchor, fall back to the previous-session set via
 *    recommendSessionStart (still a range, not a copied count).
 *
 * RAMP slot:
 *  - weight = RAMP_LOAD_FRACTION of today's prescribed top working set; no RIR
 *    target, no "too light" copy.
 *
 * This is the fix for the anchor bug: a feeder set never gets working-set
 * progression, and the working prescription uses the e1RM that was previously
 * displayed-but-ignored.
 */
export function recommendSeedForSlot(input: SeedSlotInput): SeedRecommendation {
  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
  const [repMin, repMax] = input.targetRepRange;
  const hasAnchor = !!(input.anchorE1RMKg && input.anchorE1RMKg > 0);

  // All-sets bump gate (audit failure mode #5): with the previous session's
  // full set list available, a load increase over the recent working weight is
  // earned only when EVERY working set cleared the top of the range. Undefined
  // (no set list supplied) preserves legacy behavior.
  const bumpEarned =
    input.prevSessionSets && input.prevSessionSets.length > 0
      ? earnedSessionBump(input.prevSessionSets, input.targetRepRange, input.targetRir)
      : undefined;

  // Regression path (Fix 4): two consecutive below-floor sessions at a
  // maintained load → today's working weight is one increment DOWN from the
  // recent working weight, overriding the e1RM curve (whose 10-session max
  // reacts too slowly to a confirmed decline).
  const regressionConfirmed =
    input.prevSessionSets &&
    input.prevSessionSets.length > 0 &&
    input.priorSessionSets !== undefined &&
    confirmedRegression(input.prevSessionSets, input.priorSessionSets, input.targetRepRange);
  const regressionWeightKg =
    regressionConfirmed && input.recentWorkingWeightKg && input.recentWorkingWeightKg > 0
      ? regressionStepDown(input.recentWorkingWeightKg, inc)
      : 0;

  // Establish today's top working weight (the basis for a ramp %). Prefer the
  // e1RM working prescription; fall back to an explicitly supplied top; last of
  // all, the previous-session load for this slot.
  let topWorkingKg = input.topWorkingWeightKg ?? 0;
  let workingClamped = false;
  if (topWorkingKg <= 0 && regressionWeightKg > 0) {
    topWorkingKg = regressionWeightKg;
  }
  if (topWorkingKg <= 0 && hasAnchor) {
    const w = workingWeightFromAnchor(
      input.anchorE1RMKg!,
      input.targetRepRange,
      input.targetRir,
      inc,
      input.recentWorkingWeightKg,
      bumpEarned
    );
    topWorkingKg = w.weightKg;
    workingClamped = w.clamped;
  }
  if (topWorkingKg <= 0 && input.prevWeightKg && input.prevWeightKg > 0) {
    topWorkingKg = input.prevWeightKg;
  }

  // ---- RAMP slot ----
  if (input.role === 'ramp') {
    const weightKg =
      topWorkingKg > 0 ? roundToIncrement(topWorkingKg * RAMP_LOAD_FRACTION, inc) : Math.max(0, input.prevWeightKg ?? 0);
    return {
      weightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'ramp',
      showRirTarget: false,
      anchorSource: topWorkingKg > 0 ? 'ramp_percent' : 'none',
      clamped: false,
      engineVersion: SUGGESTION_ENGINE_VERSION,
    };
  }

  // ---- WORKING slot, confirmed regression → step down one increment ----
  if (regressionWeightKg > 0) {
    return {
      weightKg: regressionWeightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'working',
      showRirTarget: true,
      // The stepped weight is anchored to the last session's working load,
      // not the e1RM curve — provenance must say so.
      anchorSource: 'last_session',
      clamped: false,
      engineVersion: SUGGESTION_ENGINE_VERSION,
    };
  }

  // ---- WORKING slot, e1RM anchor available ----
  if (hasAnchor) {
    const w = workingWeightFromAnchor(
      input.anchorE1RMKg!,
      input.targetRepRange,
      input.targetRir,
      inc,
      input.recentWorkingWeightKg,
      bumpEarned
    );
    return {
      weightKg: w.weightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'e1rm',
      clamped: w.clamped || workingClamped,
      engineVersion: SUGGESTION_ENGINE_VERSION,
    };
  }

  // ---- WORKING slot, no anchor → previous-session fallback ----
  if (input.prevWeightKg && input.prevWeightKg > 0 && input.prevReps && input.prevReps > 0) {
    const rec = recommendSessionStart({
      prevWeightKg: input.prevWeightKg,
      prevReps: input.prevReps,
      prevRir: input.prevRir,
      targetRepRange: input.targetRepRange,
      targetRir: input.targetRir,
      minIncrementKg: inc,
      prevSessionSets: input.prevSessionSets,
      priorSessionSets: input.priorSessionSets,
    });
    return {
      weightKg: rec.weightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'last_session',
      clamped: false,
      engineVersion: SUGGESTION_ENGINE_VERSION,
    };
  }

  // ---- Nothing to anchor on ----
  return {
    weightKg: 0,
    repRange: [repMin, repMax],
    rir: input.targetRir,
    role: 'working',
    showRirTarget: true,
    anchorSource: 'none',
    clamped: false,
    engineVersion: SUGGESTION_ENGINE_VERSION,
  };
}

// ============================================
// LOGGED-SET OVERRIDE (Phase 4)
// ============================================

/**
 * True when a logged load deviates by more than OVERRIDE_DEVIATION_FRACTION from
 * what was suggested — the signal to treat the logged set as the new anchor and
 * stop commenting "vs suggestion" off the stale number.
 */
export function deviatesFromSuggestion(loggedWeightKg: number, suggestedWeightKg: number): boolean {
  if (!(suggestedWeightKg > 0) || !(loggedWeightKg > 0)) return false;
  return Math.abs(loggedWeightKg - suggestedWeightKg) / suggestedWeightKg > OVERRIDE_DEVIATION_FRACTION;
}

/**
 * Recalibration weighting hook (Phase 4). Estimate an exercise's session e1RM
 * from its WORKING sets, crediting each set for the intra-session fatigue that
 * preceded it: a fresh set-1 near-failure effort is trusted at face value, while
 * a late grinder at the same weight×reps is corrected upward (it fought through
 * fatigue, so its raw e1RM under-states capacity).
 *
 * `sets` must be in the order performed. Returns the max fatigue-corrected e1RM.
 * This is the only fatigue-model touch-point the fix introduces; the correction
 * is small (RECAL_FATIGUE_CORRECTION_PER_SET/set, capped) so it nudges the
 * estimate rather than dominating it.
 */
export function recalibrateSessionE1RM(
  sets: Array<{ weightKg: number; reps: number; rir?: number }>
): number {
  let best = 0;
  let workingPosition = 0;
  for (const s of sets) {
    if (!(s.weightKg > 0) || !(s.reps > 0)) continue;
    const rir = Math.max(0, s.rir ?? 0);
    const raw = epleyE1RM(s.weightKg, s.reps, rir);
    const correction = Math.min(
      RECAL_MAX_FRESHNESS_CORRECTION,
      RECAL_FATIGUE_CORRECTION_PER_SET * workingPosition
    );
    const corrected = raw * (1 + correction);
    if (corrected > best) best = corrected;
    workingPosition += 1;
  }
  return Math.round(best * 10) / 10;
}
