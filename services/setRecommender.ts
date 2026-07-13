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
import { rpeToRir } from '@/types/schema';
import {
  DEADBAND_RIR,
  EFFORT_MATCH_TOLERANCE,
  MAX_STEP_PCT,
  MAX_REDUCE_PCT,
  HOLD_DROP_RATE,
  FATIGUE_PER_SET,
  FATIGUE_FLOOR,
  OVERSHOOT_CEILING,
  REP_OVERSHOOT,
  RAMP_LOAD_FRACTION,
  WORKING_WEIGHT_CLAMP_FRACTION,
  OVERRIDE_DEVIATION_FRACTION,
  RECAL_FATIGUE_CORRECTION_PER_SET,
  RECAL_MAX_FRESHNESS_CORRECTION,
  SUGGESTION_ENGINE_VERSION,
} from './suggestionEngine/constants';
import type { SetRole } from './suggestionEngine/setRoles';

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
}

/**
 * The exact rule that moved (or held) the load, so the banner copy can name the
 * observed trigger instead of a shared "too light / too heavy" paraphrase.
 * One value per distinct branch in recommendSet's weight decision:
 *  - rep_overshoot:     lastReps > repMax + REP_OVERSHOOT (reps alone prove
 *                       under-load, regardless of self-reported RIR)
 *  - top_range_reserve: lastReps >= repMax AND RIR beat target by >= DEADBAND_RIR
 *  - below_rep_min:     lastReps < repMin
 *  - rir_deficit:       RIR fell short of target by >= DEADBAND_RIR
 *  - none:              in the deadband (hold), or no usable reference set
 */
export type AdjustmentTrigger =
  | 'rep_overshoot'
  | 'top_range_reserve'
  | 'below_rep_min'
  | 'rir_deficit'
  | 'none';

export interface SetRecommendation {
  weightKg: number;
  reps: number;
  rir: number;
  rationale: 'maintain' | 'increase_load' | 'reduce_load';
  /** Which rule fired for the weight decision (see AdjustmentTrigger). */
  trigger: AdjustmentTrigger;
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
      trigger: 'none',
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
  let trigger: AdjustmentTrigger;

  if (lastReps > repMax + REP_OVERSHOOT || (lastReps >= repMax && dev >= DEADBAND_RIR)) {
    // Under-loaded — either an unambiguous rep-overshoot (reps prove it regardless
    // of RIR — checked BEFORE the effort branch, so a rep range moved down by
    // the one-tap plateau switch reprices upward even off a near-failure set)
    // OR cleared the top of the range with >= DEADBAND reserve.
    trigger = lastReps > repMax + REP_OVERSHOOT ? 'rep_overshoot' : 'top_range_reserve';
    const ideal = weightForReps(e1rm, repMax, targetRir);
    weightKg = roundToIncrement(Math.min(ideal, lastWeightKg * (1 + MAX_STEP_PCT)), inc);
    if (weightKg <= lastWeightKg) weightKg = lastWeightKg + inc;
    rationale = 'increase_load';
  } else if (lastReps < repMin || dev <= -DEADBAND_RIR) {
    // Over-loaded (reps below range) or went too close to failure → reduce
    // toward mid-range. Reps-below-min is the more objective signal, so it
    // names the trigger when both conditions hold.
    trigger = lastReps < repMin ? 'below_rep_min' : 'rir_deficit';
    const ideal = weightForReps(e1rm, mid, targetRir);
    weightKg = roundToIncrement(Math.max(ideal, lastWeightKg * (1 - MAX_REDUCE_PCT)), inc);
    if (weightKg >= lastWeightKg) weightKg = Math.max(inc, lastWeightKg - inc);
    rationale = 'reduce_load';
  } else {
    weightKg = lastWeightKg;
    rationale = 'maintain';
    trigger = 'none';
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
    reps = predictRepsAtWeight(e1rm, weightKg, targetRir, n, repMax);
  }

  return { weightKg, reps, rir: targetRir, rationale, trigger, effortVsTarget };
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
  /**
   * For the `last_session` anchor: the rule that moved the seed off the previous
   * session's load (see AdjustmentTrigger). 'none' for every other anchor and
   * for a seed that repeats last session.
   */
  trigger: AdjustmentTrigger;
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
  recentWorkingWeightKg?: number
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

  // Establish today's top working weight (the basis for a ramp %). Prefer the
  // e1RM working prescription; fall back to an explicitly supplied top; last of
  // all, the previous-session load for this slot.
  let topWorkingKg = input.topWorkingWeightKg ?? 0;
  let workingClamped = false;
  if (topWorkingKg <= 0 && hasAnchor) {
    const w = workingWeightFromAnchor(
      input.anchorE1RMKg!,
      input.targetRepRange,
      input.targetRir,
      inc,
      input.recentWorkingWeightKg
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
      trigger: 'none',
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
      input.recentWorkingWeightKg
    );
    return {
      weightKg: w.weightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'e1rm',
      clamped: w.clamped || workingClamped,
      trigger: 'none',
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
    });
    return {
      weightKg: rec.weightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'last_session',
      clamped: false,
      trigger: rec.trigger,
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
    trigger: 'none',
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
