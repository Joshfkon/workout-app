/**
 * rep_total progression policy (pulled forward from Phase 5).
 *
 * ============================================================
 * SPEC — rep-total semantics (normative; branches must not disagree)
 * ============================================================
 * 1. WHAT THE TARGET IS. The session target is the sum of the per-set rep
 *    targets at the plan's fixed load — ONE number with ONE derivation.
 *    Anything that displays a planned total (banner, projected-volume header)
 *    must derive from the same per-set targets; there is no second
 *    "prevTotal + increment" total living beside a different per-set sum.
 * 2. FLOOR, NOT BUDGET. The target is a floor to meet or beat, never a
 *    budget to ration. Logging more reps than the plan's pace on an early
 *    set must NEVER lower a later set's ask; over-performance may only hold
 *    or raise subsequent prescriptions (evidence floor). No ask is ever
 *    derived by subtracting reps-done from reps-planned.
 * 3. HOW IT INCREMENTS. On a load repeat, the target grows from last
 *    session's actual total by at least 1 rep, scaled up by how far the
 *    previous session overshot ITS floor (rep margin over the prior
 *    session's total + effort left in reserve beyond the asked RIR), capped
 *    per session so growth can't run away. On an earned load bump, targets
 *    are last session's observed reps exchanged through the rep-cost model —
 *    the increment lives in the load, not the total.
 * 4. REP-RANGE INTERACTION. The configured range is a per-set zone, not the
 *    target. The range floor gates the load bump (every top-load set must
 *    clear it at target effort, priced at the exercise's TRUE smallest
 *    increment). The engine never knowingly emits a config-violating target
 *    when a LOAD lever exists instead (AM-5, option a): asks above the
 *    ceiling clamp to it — over-range capacity drives load increases (the
 *    multi-step bump fit; the load-appropriateness detector), never bigger
 *    rep asks; asks below the floor step the load down, and only when no
 *    meaningful step-down exists does the honest below-floor ask ship,
 *    carrying `outsideRange`. An out-of-range ask produced by plan/exchange
 *    ARITHMETIC alone is a bug in either direction.
 *    (Resolved conflict, 2026-07-29 PM merge: this spec originally allowed
 *    evidence-backed asks ABOVE the ceiling with a flag; the merged AM-5
 *    fix decided the ceiling always wins, so the ceiling rule above is the
 *    binding one and over-range pressure routes to the load lever.)
 * 5. LOAD CHANGE MID-PROGRESSION. Rep totals compare only at matched loads
 *    (max(half grid step, 2.5%) tolerance). A deviating load invalidates the
 *    prior total AND the plan total as targets: no branch may keep consuming
 *    them (remainders included). The per-set targets and the session target
 *    are re-priced onto the actual load; beat-last-session framing is
 *    forbidden (`totalComparable: false`); today sets the new baseline.
 * ============================================================
 *
 * For exercises whose rep boundary drifts (high-rep work where "a rep" is not
 * a crisp unit — calves, abs, burnout-style ranges), e1RM math is fiction:
 * most sets sit beyond the canonical estimator's 15-effective-rep domain.
 * These exercises progress on REP TOTALS instead:
 *
 *   - FIXED load planned for the session (held verbatim on a repeat, never
 *     re-rounded);
 *   - progress target = beat last session's rep TOTAL at that load;
 *   - add the smallest native increment only when EVERY top-load working set
 *     cleared the range floor at target effort last session;
 *   - otherwise repeat the load and chase reps.
 *
 * No e1RM is computed, displayed, or ingested for calibration on this path.
 *
 * PLANNER PARITY (rep_total re-derivation): the session-start plan is a
 * BASELINE, not a script. `recommendRepTotalNextSet` re-derives every set
 * from the sets actually logged this session (`observedSets`), mirroring the
 * e1RM path's `recommendSet` contract:
 *   - INV-1 analog: a rep ask outside the stated range carries `outsideRange`
 *     so the banner renders the contradiction, never silently;
 *   - INV-2 analog (session-capacity ceiling, in REP space): an ask may never
 *     imply more rep capacity at the asked effort than the best set OBSERVED
 *     today demonstrates (`sessionCapacityClamped`) — the fix for "did 6 @ 0
 *     RIR, engine re-asked 10 at the same load";
 *   - too-heavy reaction (recommendSet's reduce branch, rep-space): a set
 *     below the range floor at/past the failure deadband steps the LOAD down
 *     toward the range mid — holding a proven-too-heavy load and re-serving
 *     the plan is not a prescription;
 *   - INV-4 analog: banner deltas compare a slot to the SAME set position
 *     last session (`positionRef` provenance) or show no number.
 *
 * The load↔rep exchange rate is `expectedRepsAfterLoadChange` — Epley-slope
 * below 12 reps, flattened above it (the load-rep relationship is NOT linear
 * at high reps; Epley's slope overstates the cost of a load change in the
 * endurance domain).
 *
 * The e1RM prescription core (`prescribe`) is deliberately NOT shared with
 * this path: on rep_total exercises the e1RM curve is the documented fiction
 * this policy exists to avoid. What IS shared: the invariant vocabulary
 * (flags and their banner obligations), the loading-grid rules
 * (services/suggestionEngine/loadGrid), and the effort/deadband dials
 * (services/suggestionEngine/constants).
 *
 * Which exercises route here: an explicit `exercises.progression_model`
 * ('rep_total' | 'e1rm') always wins; NULL auto-classifies from history —
 * majority-inestimable recent sets → rep_total. "Inestimable" for
 * classification means ABOVE THE CANONICAL CAP (12 effective reps): capped
 * estimates are floors computed at the cap (w × 36/25 regardless of the
 * actual count), so an exercise living above it has an anchor that cannot
 * move with rep progress — frozen. Beyond-domain sets (> 15 eff) are the
 * extreme case of the same family.
 *
 * Pure functions — no DB calls or side effects.
 */

import type { PrevSessionSet } from '@/services/setRecommender';
import {
  MAX_REDUCE_PCT,
  HIGH_REP_COST_TAPER_PER_REP,
  HIGH_REP_COST_MIN_PER_PCT,
  REP_TOTAL_VOLUME_SHORTFALL_TOLERANCE,
  REP_TOTAL_LOAD_MATCH_FRACTION,
  REP_TOTAL_OVERSHOOT_GAIN,
  REP_TOTAL_TARGET_GROWTH_CAP_FRACTION,
  REP_TOTAL_RANGE_FIT_MAX_STEP_PCT,
} from './constants';
import { smallestIncrement, roundPrescribedLoad } from './loadGrid';
import { gradeEffort } from './effortGrade';

export type ProgressionModel = 'e1rm' | 'rep_total';
export type RepBoundary = 'crisp' | 'drifting';

/**
 * Resolve an exercise's progression model: explicit column value wins; NULL
 * auto-classifies from the recent history's estimability counts.
 */
export function resolveProgressionModel(
  explicit: ProgressionModel | null | undefined,
  estimableSetCount: number,
  inestimableSetCount: number
): ProgressionModel {
  if (explicit === 'rep_total' || explicit === 'e1rm') return explicit;
  return inestimableSetCount > estimableSetCount ? 'rep_total' : 'e1rm';
}

/** Effort tolerance: a set "at target effort" may be up to this much easier. */
const EFFORT_TOLERANCE_RIR = 1;

// ============================================================
// LOAD↔REP EXCHANGE RATE (rep-space, no e1RM)
// ============================================================

/**
 * Rep cost of a load change, per 1% of load, at a given rep count.
 *
 * Below 12 reps this is Epley's own local slope — reps(w) = 30(E/w − 1)
 * differentiates to (30 + r) / 100 reps per 1% load — so the rep_total policy
 * and the e1RM path agree wherever both are defined. ABOVE 12 reps the real
 * load-rep curve flattens (the endurance domain: the observed +10% on a
 * ~17-rep cable curl cost ~1 rep, where Epley's slope predicts ~4.7), so the
 * slope tapers per rep past 12, floored at HIGH_REP_COST_MIN_PER_PCT.
 */
function repCostPerPctLoad(reps: number): number {
  const epleySlope = (30 + Math.min(reps, 12)) / 100;
  if (reps <= 12) return epleySlope;
  return Math.max(
    HIGH_REP_COST_MIN_PER_PCT,
    epleySlope - HIGH_REP_COST_TAPER_PER_REP * (reps - 12)
  );
}

/**
 * Expected reps at a NEW load, given an observed rep count at a reference
 * load — THE rep_total load↔rep exchange function (both directions: a load
 * increase costs reps, a decrease returns them). Non-linear above 12 reps
 * (see repCostPerPctLoad). Never returns below 1; malformed inputs echo the
 * observation instead of throwing.
 */
export function expectedRepsAfterLoadChange(
  obsReps: number,
  fromKg: number,
  toKg: number
): number {
  if (!(obsReps > 0) || !(fromKg > 0) || !(toKg > 0)) {
    return Math.max(1, Math.round(obsReps || 1));
  }
  const pctChange = ((toKg - fromKg) / fromKg) * 100;
  if (pctChange === 0) return Math.max(1, Math.round(obsReps));
  return Math.max(1, Math.round(obsReps - repCostPerPctLoad(obsReps) * pctChange));
}

/** One set logged THIS session, with its resolved effort. */
export interface RepTotalObservedSet {
  weightKg: number;
  reps: number;
  /** Resolved RIR (resolveLastRir convention). Omitted → no effort signal. */
  rir?: number;
}

/**
 * The rep ask an observed set supports at `atLoadKg` and `targetRir` — the
 * INV-2 analog's unit of account. The set's zero-RIR capacity (reps + RIR
 * left) is exchanged to the asked load, then the asked reserve is paid out
 * of it.
 */
function observedAskCeiling(
  s: RepTotalObservedSet,
  atLoadKg: number,
  targetRir: number
): number {
  const zeroRirCapacity = s.reps + Math.max(0, s.rir ?? 0);
  const capacityAtLoad = expectedRepsAfterLoadChange(zeroRirCapacity, s.weightKg, atLoadKg);
  return Math.max(1, capacityAtLoad - Math.max(0, targetRir));
}

export interface RepTotalSessionStart {
  /** Fixed load for the session (kg) — held VERBATIM from history on a repeat. */
  weightKg: number;
  /**
   * Per-set rep targets, one per planned set. On a repeat: prev session's
   * counts, floored at the range floor. On a bump: prev session's OBSERVED
   * at-load counts exchanged to the new load through the non-linear rep-cost
   * model — NEVER a reset to the range floor (a floor a lifter clears by 5-8
   * reps is a tautology, not a target, and resetting to it is where the
   * silent volume cuts came from).
   */
  perSetRepTargets: number[];
  /**
   * The previous session's OBSERVED reps behind each slot's target (same
   * index), for like-to-like banner framing (INV-4 analog): a delta claim
   * compares a slot to the SAME position last session or shows nothing.
   * Undefined entries = the slot had no positional reference (padding).
   */
  perSetRefReps: Array<number | undefined>;
  /**
   * Session target — ALWAYS the sum of `perSetRepTargets` (spec §1: one
   * number, one derivation; the projected-volume header divides back to the
   * same total). On a repeat the increment (prev total + overshoot-scaled
   * growth) is distributed INTO the per-set targets; on a bump the targets
   * are the exchanged observations and the progression lives in the load.
   */
  sessionRepTotalTarget: number;
  /** Last session's rep total at the fixed load (0 when no history). */
  prevSessionRepTotal: number;
  /** True when last session earned the increment (all sets ≥ floor at effort). */
  bumped: boolean;
  /**
   * The gate cleared but the increment was WITHHELD: exchanging the observed
   * reps to the bumped load would price some set below the range floor — the
   * lifter can't yet absorb the smallest available load step and stay in
   * range (high-rep history / coarse increments). The plan holds the load and
   * chases reps, and the banner must say why the bump didn't happen.
   */
  bumpDeferred?: 'load_cost';
  /** The load the targets were derived FROM (last session's top load). */
  refLoadKg: number;
  /**
   * Last session was a RAMP: valid working sets exist below the at-load
   * tolerance of the top load. The fixed-load model's explicit rule for
   * ramped history: grading and rep totals read the TOP-LOAD sets only —
   * lighter ramp sets neither earn nor block the increment ("every set
   * cleared the floor" must never be trivially true of the light end) — and
   * the banner must name the load it graded at.
   */
  rampHistory: boolean;
  /** Last session's total tonnage (kg) across ALL valid working sets. */
  prevSessionVolumeKg: number;
  /** Last session's valid working-set count (all loads). */
  prevSessionSetCount: number;
  /** This plan's projected tonnage: plan load × Σ per-set targets. */
  projectedVolumeKg: number;
  /**
   * Sets this plan actually covers (perSetRepTargets.length). VOLUME IS A
   * CONSTRAINT: starts at max(planned sets, last session's at-load count) —
   * set count never silently drops below what was performed — and extends up
   * to last session's total set count while the projection at equal-or-
   * greater load falls short of last session's tonnage. When this exceeds
   * the block's planned sets, the banner must tell the lifter to add them.
   */
  recommendedSetCount: number;
  /**
   * Non-null when the projection STILL lands materially below last session's
   * tonnage after set extension (beyond REP_TOTAL_VOLUME_SHORTFALL_TOLERANCE)
   * — the banner must state the shortfall explicitly; it is never a silent
   * display field.
   */
  volumeShortfall: { prevKg: number; projectedKg: number } | null;
}

/**
 * Session-start seed for a rep_total exercise. `prevSessionSets` are the
 * previous session's NORMAL working sets in performed order (same eligibility
 * as everywhere else). Returns null when there is no usable history — the
 * caller keeps its cold-start path.
 */
export function recommendRepTotalSessionStart(input: {
  prevSessionSets: PrevSessionSet[];
  /**
   * Working sets from the session BEFORE last (same eligibility), when the
   * history carries them. Feeds the overshoot-scaled target increment
   * (spec §3): how far last session's total beat the one before it, at the
   * same load. Omitted → the rep-margin component is simply 0.
   */
  priorSessionSets?: PrevSessionSet[];
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
  /**
   * The exercise's recorded increment SET. The bump gate must price the load
   * step at the exercise's TRUE smallest step (spec §4): a rep-floor
   * rejection computed against a coarser legacy/default increment is the
   * live Dumbbell Shrug defect (a 5 lb assumption on a 2.5 lb rack held a
   * load the lifter then stepped up manually, in range).
   */
  availableIncrementsKg?: number[];
  plannedSets: number;
}): RepTotalSessionStart | null {
  const { targetRepRange, targetRir, plannedSets } = input;
  const [repMin, repMax] = targetRepRange;
  const valid = input.prevSessionSets.filter((s) => s.weightKg > 0 && s.reps > 0);
  if (valid.length === 0) return null;

  // The exercise's true smallest loadable step: the increment SET when one
  // is recorded, else the legacy single increment, else the engine default.
  // Every use below (at-load grid tolerance, bump pricing) reads THIS —
  // never the raw legacy field.
  const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);

  // Fixed-load model: the session's load is the top load actually worked.
  // The at-load group is a GRID tolerance — max(half the smallest increment,
  // 2.5%) — not the old loose ±5%: rep totals only ever compare at matched
  // loads, and the tolerance exists solely to absorb unit-conversion /
  // micro-loading noise, never a genuine ramp step.
  const topLoad = valid.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0);
  const halfStepKg = inc / 2;
  const atLoadToleranceKg = Math.max(halfStepKg, topLoad * REP_TOTAL_LOAD_MATCH_FRACTION);
  const atLoad = valid.filter((s) => s.weightKg >= topLoad - atLoadToleranceKg);
  const prevTotal = atLoad.reduce((sum, s) => sum + s.reps, 0);
  // Ramped history: working sets below the at-load tolerance. The explicit
  // rule (this used to be undefined and "right by luck"): grade and total
  // the TOP-LOAD sets only, and say so.
  const rampHistory = atLoad.length < valid.length;

  // Increment earned when EVERY working set cleared the range floor at target
  // effort (missing RIR → assume it landed on target).
  const bumped =
    atLoad.length > 0 &&
    atLoad.every(
      (s) => s.reps >= repMin && (s.rir === undefined || s.rir <= targetRir + EFFORT_TOLERANCE_RIR)
    );

  const sets = Math.max(1, plannedSets);

  // ---- Volume constraint (nothing about this plan may silently cut volume) ----
  // Baseline: last session's tonnage across ALL valid working sets. The plan
  // starts at max(planned sets, at-load count) — set count never silently
  // drops below what was performed — and extends (up to last session's total
  // set count) while the projection falls short of the baseline. A residual
  // gap beyond the tolerance is surfaced as an explicit shortfall.
  const prevSessionVolumeKg = valid.reduce((s, x) => s + x.weightKg * x.reps, 0);
  const maxSetCount = Math.max(valid.length, sets);
  const applyVolumeConstraint = (
    weightKg: number,
    targets: number[],
    padValue: number
  ): Pick<
    RepTotalSessionStart,
    'projectedVolumeKg' | 'recommendedSetCount' | 'volumeShortfall'
  > => {
    const sum = () => targets.reduce((a, b) => a + b, 0);
    while (weightKg * sum() < prevSessionVolumeKg && targets.length < maxSetCount) {
      targets.push(padValue);
    }
    const projectedVolumeKg = Math.round(weightKg * sum() * 10) / 10;
    const volumeShortfall =
      projectedVolumeKg < prevSessionVolumeKg * (1 - REP_TOTAL_VOLUME_SHORTFALL_TOLERANCE)
        ? {
            prevKg: Math.round(prevSessionVolumeKg * 10) / 10,
            projectedKg: projectedVolumeKg,
          }
        : null;
    return { projectedVolumeKg, recommendedSetCount: targets.length, volumeShortfall };
  };

  // Gate cleared → price the increment: every at-load observed count is
  // exchanged to the bumped load through the non-linear rep-cost model. The
  // bump is EARNED only when every exchanged target stays at/above the range
  // floor — clearing the floor while the smallest load step would price a
  // set below it (high-rep history, coarse increment) DEFERS the bump: hold
  // the load and keep chasing reps instead of buying a guaranteed range
  // violation (the Bayesian Cable Curl failure).
  let bumpDeferred: RepTotalSessionStart['bumpDeferred'];
  if (bumped) {
    // 2026-07-29 step 5(a): the bump must land INSIDE the configured range
    // at BOTH ends — the old path checked only the floor, which is how a
    // 4×15 history against an 8-12 range shipped 15-rep targets with a
    // "detected the violation and proceeded anyway" banner. Keep stepping
    // increments while any exchanged target still sits above the range
    // ceiling, bounded by the floor (never price a set below repMin) and by
    // REP_TOTAL_RANGE_FIT_MAX_STEP_PCT; any residual over-ceiling target is
    // clamped to the ceiling — the configured range wins, and the volume
    // constraint pads sets to protect the total.
    let bumpedLoad = topLoad + inc;
    let scaled = atLoad.map((s) => expectedRepsAfterLoadChange(s.reps, topLoad, bumpedLoad));
    while (scaled.some((r) => r > repMax)) {
      const nextLoad = bumpedLoad + inc;
      if (nextLoad > topLoad * (1 + REP_TOTAL_RANGE_FIT_MAX_STEP_PCT)) break;
      const nextScaled = atLoad.map((s) => expectedRepsAfterLoadChange(s.reps, topLoad, nextLoad));
      if (!nextScaled.every((r) => r >= repMin)) break; // the floor binds — stop
      bumpedLoad = nextLoad;
      scaled = nextScaled;
    }
    if (scaled.every((r) => r >= repMin)) {
      // Targets anchor to OBSERVED reps at the prior load, exchanged for the
      // load change — never reset to the range floor, and never above the
      // range ceiling. Planned sets beyond history pad with the LAST
      // exchanged target (the fatigue end); the plan covers at least the
      // at-load count actually performed.
      const fitted = scaled.map((r) => Math.min(r, repMax));
      const tail = fitted[fitted.length - 1];
      const perSet = Array.from({ length: Math.max(sets, atLoad.length) }, (_, i) => fitted[i] ?? tail);
      const volume = applyVolumeConstraint(bumpedLoad, perSet, tail);
      return {
        weightKg: bumpedLoad,
        perSetRepTargets: perSet,
        perSetRefReps: Array.from({ length: perSet.length }, (_, i) => atLoad[i]?.reps),
        sessionRepTotalTarget: perSet.reduce((a, b) => a + b, 0),
        prevSessionRepTotal: prevTotal,
        bumped: true,
        refLoadKg: topLoad,
        rampHistory,
        prevSessionVolumeKg: Math.round(prevSessionVolumeKg * 10) / 10,
        prevSessionSetCount: valid.length,
        ...volume,
      };
    }
    bumpDeferred = 'load_cost';
  }

  // ---- Target increment (spec §3): scaled to last session's overshoot ----
  // A constant +1 (~3% on a 30-rep total) is functionally a stall and blind
  // to how decisively the prior target was beaten. Rep-space overshoot has
  // two components, both observable without e1RM math:
  //   - rep margin: how far last session's total beat the minimal target
  //     implied by the session before it (prior total + 1), at the SAME load
  //     (totals at different loads are not comparable — spec §5);
  //   - effort surplus: reps left in reserve beyond the asked RIR across the
  //     at-load sets (capacity shown but not banked as reps).
  // Growth is capped per session so one outlier can't run the target away.
  const effortSurplus = atLoad.reduce(
    (s, x) => s + Math.max(0, (x.rir ?? targetRir) - targetRir),
    0
  );
  let repMargin = 0;
  const priorValid = (input.priorSessionSets ?? []).filter((s) => s.weightKg > 0 && s.reps > 0);
  if (priorValid.length > 0) {
    const priorTop = priorValid.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0);
    if (Math.abs(priorTop - topLoad) <= atLoadToleranceKg) {
      const priorTotal = priorValid
        .filter((s) => s.weightKg >= priorTop - atLoadToleranceKg)
        .reduce((sum, s) => sum + s.reps, 0);
      repMargin = Math.max(0, prevTotal - (priorTotal + 1));
    }
  }
  const growthCap = Math.max(2, Math.round(prevTotal * REP_TOTAL_TARGET_GROWTH_CAP_FRACTION));
  const targetIncrement = Math.min(
    growthCap,
    1 + Math.round(REP_TOTAL_OVERSHOOT_GAIN * (repMargin + effortSurplus))
  );

  // Repeat the load VERBATIM and chase the total: per-set seeds mirror last
  // session's counts clamped INTO the configured range (floored at repMin so
  // a collapsed set re-asks the floor; ceilinged at repMax so an over-range
  // count never ships as a target — step 5: the engine must not knowingly
  // emit a config-violating target), padded with the floor for any extra
  // planned sets. The plan covers at least the at-load count actually
  // performed (no silent set-count drop); a total the clamp can no longer
  // reach in the planned sets surfaces through the volume constraint.
  const perSet = Array.from({ length: Math.max(sets, atLoad.length) }, (_, i) => {
    const prev = atLoad[i]?.reps;
    return Math.min(repMax, Math.max(repMin, prev ?? repMin));
  });

  // ONE total, ONE derivation (spec §1): the session target IS the sum of
  // the per-set targets. When the mirrored seeds fall short of
  // prevTotal + increment, the missing reps are distributed INTO the
  // targets — front-loaded onto the freshest sets, but never past the range
  // ceiling (spec §4 / AM-5: a target above repMax never ships). Growth the
  // ceiling can no longer absorb is the load's job, surfaced by the stall /
  // load-appropriateness detectors — not by a config-violating rep target.
  // The old shape carried "prevTotal + 1" beside per-set targets summing to
  // a different number; the projected-volume header derived from one and
  // the rationale from the other (the Kelso 1,875 lb vs "31 planned" split).
  let needed = prevTotal + targetIncrement - perSet.reduce((a, b) => a + b, 0);
  while (needed > 0) {
    let placed = false;
    for (let i = 0; i < perSet.length && needed > 0; i++) {
      if (perSet[i] < repMax) {
        perSet[i] += 1;
        needed -= 1;
        placed = true;
      }
    }
    if (!placed) break; // every set at the ceiling — the load lever owns the rest
  }

  const volume = applyVolumeConstraint(topLoad, perSet, repMin);
  return {
    weightKg: topLoad,
    perSetRepTargets: perSet,
    perSetRefReps: Array.from({ length: perSet.length }, (_, i) => atLoad[i]?.reps),
    sessionRepTotalTarget: perSet.reduce((a, b) => a + b, 0),
    prevSessionRepTotal: prevTotal,
    bumped: false,
    ...(bumpDeferred ? { bumpDeferred } : {}),
    refLoadKg: topLoad,
    rampHistory,
    prevSessionVolumeKg: Math.round(prevSessionVolumeKg * 10) / 10,
    prevSessionSetCount: valid.length,
    ...volume,
  };
}

export interface RepTotalNextSetInput {
  sessionPlan: RepTotalSessionStart;
  /** Sets completed THIS session, in performed order, with resolved effort. */
  observedSets: RepTotalObservedSet[];
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
  availableIncrementsKg?: number[];
}

export interface RepTotalNextSet {
  /** The load to lift next — today's actual load; stepped down on a clear miss. */
  weightKg: number;
  /** Rep target for the next set, re-derived from today's observations. */
  reps: number;
  /** Session total logged so far. */
  totalSoFar: number;
  /** Reps still needed to reach the session PLAN total (0 when reached). */
  remainingToTarget: number;
  /**
   * The EFFECTIVE session target (spec §1/§5): the plan's total on the plan's
   * load; on a deviating load it is the plan's per-set targets re-priced onto
   * the actual load (in-range slots stay in-range through the exchange) — the
   * stale plan total is never served beside a "previous total doesn't apply"
   * disclaimer. `remainingToTarget` always measures against THIS number.
   */
  sessionRepTotalTarget: number;
  /**
   * TWO CLAIMS, TWO NUMBERS (the old counter measured progress against the
   * PLAN total while labeling it "to beat last session", declared victory
   * early, and floored at the denominator):
   *  - remainingToBeatPrev — reps still needed to BEAT last session's ACTUAL
   *    total (prevSessionRepTotal + 1), 0 once beaten;
   *  - beatPrevBy — how far past last session's total the session is.
   * Valid only when `totalComparable`; the banner must not render any
   * beat-last-session framing otherwise.
   */
  remainingToBeatPrev: number;
  beatPrevBy: number;
  prevSessionRepTotal: number;
  /**
   * False when the session's rep total cannot honestly be compared to last
   * session's (the load changed — a bumped plan's prior total was earned at
   * the old load). Beat-last-session copy is forbidden when false.
   */
  totalComparable: boolean;
  /**
   * Why this target: 'follow_plan' = the session plan's slot target survived
   * today's evidence; 'reduce_load' = the last set proved the load too heavy
   * (below the range floor at/past the failure deadband) and the load steps
   * down toward the range mid.
   */
  rationale: 'follow_plan' | 'reduce_load';
  /** How the LAST observed set's effort compared to target (banner grammar). */
  effortVsTarget: 'easier' | 'on_target' | 'harder';
  /**
   * INV-2 analog: the plan's ask implied more rep capacity at the asked
   * effort than the best set observed today — trimmed to the observed
   * ceiling. The banner must say so.
   */
  sessionCapacityClamped?: boolean;
  /**
   * The ask was trimmed because the session is DECLINING: the most recent
   * set demonstrated less capacity at the asked load/effort than an earlier
   * set did, so the live ceiling sits below the session best. Distinct from
   * `sessionCapacityClamped` (a trim at today's best) so the banner can name
   * the real reason instead of "capped at today's best", which would be
   * false. The banner must say so — a silently shrinking ask is how this
   * defect stayed invisible in the other direction.
   */
  sessionDeclineTrimmed?: boolean;
  /** INV-1 analog: the ask falls outside the stated rep range — banner must acknowledge. */
  outsideRange?: 'below' | 'above';
  /**
   * INV-4 analog: the positional reference behind this slot's target — the
   * SAME set position last session. Absent → no delta claim may be rendered.
   */
  positionRef?: { setNo: number; prevReps: number };
  /**
   * The lifter is working at a load that deviates from the plan's by more
   * than max(half grid step, 2.5%) — the prior total is INVALID as a target
   * (`totalComparable` false), the slot targets are re-priced onto the
   * actual load, and the banner must say "previous total doesn't apply;
   * today sets the new baseline".
   */
  loadDeviation?: { planKg: number; observedKg: number };
}

/**
 * Within-session next-set target for a rep_total exercise — RE-DERIVED from
 * the sets actually logged this session on every call (parity with
 * `recommendSet`; the session plan is a baseline, not a script).
 */
export function recommendRepTotalNextSet(input: RepTotalNextSetInput): RepTotalNextSet {
  const { sessionPlan, observedSets, targetRepRange, targetRir } = input;
  const [repMin, repMax] = targetRepRange;
  const mid = Math.round((repMin + repMax) / 2);

  const valid = observedSets.filter((s) => s.weightKg > 0 && s.reps > 0);
  const totalSoFar = valid.reduce((sum, s) => sum + s.reps, 0);
  // Slot index counts LOGGED sets (invalid rows still consume their slot so
  // plan alignment survives a malformed row instead of shifting every target).
  const slot = observedSets.length;
  const last = valid[valid.length - 1];

  // Today's actual working load: what was last lifted, else the plan's load.
  const currentLoadKg = last && last.weightKg > 0 ? last.weightKg : sessionPlan.weightKg;

  // Load deviation (carried-over item 1, shipped): beyond max(half grid
  // step, 2.5%) the lifter is on a DIFFERENT load than the plan priced —
  // the prior total is invalid as a target and the slot targets re-price
  // onto the actual load. Inside the tolerance, the difference is
  // micro-loading / lb↔kg conversion noise and the plan load stands.
  const halfStep = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg) / 2;
  const deviationToleranceKg = Math.max(
    halfStep,
    sessionPlan.weightKg * REP_TOTAL_LOAD_MATCH_FRACTION
  );
  const deviated = Math.abs(currentLoadKg - sessionPlan.weightKg) > deviationToleranceKg;

  // Effort of the last set, graded through the SHARED reading
  // (services/suggestionEngine/effortGrade) — the same one the rest timer
  // uses, so one set never gets two verdicts.
  const effort = last ? gradeEffort(last.rir, targetRir) : null;
  const dev = effort?.dev ?? 0;
  const effortVsTarget: RepTotalNextSet['effortVsTarget'] = effort?.vsTarget ?? 'on_target';

  // Re-price a plan rep target onto a different load. Spec §4: the exchange
  // is a REPRICING, not evidence — an in-range plan target must come out of
  // it in-range (clamped, both directions). A plan target already outside the
  // range was put there by last session's observed reps and survives the
  // exchange as-is (it stays flagged downstream).
  const repriceOntoLoad = (planReps: number, toKg: number): number => {
    const exchanged = expectedRepsAfterLoadChange(planReps, sessionPlan.weightKg, toKg);
    if (planReps >= repMin && planReps <= repMax) {
      return Math.min(repMax, Math.max(repMin, exchanged));
    }
    return exchanged;
  };

  // Plan slot target, exchanged onto today's actual load when it differs from
  // the planned load (a lifter-chosen load must not be graded on the plan's).
  const planSlotReps =
    sessionPlan.perSetRepTargets[slot] ??
    sessionPlan.perSetRepTargets[sessionPlan.perSetRepTargets.length - 1] ??
    repMin;
  // AM-5 option (a): a target above repMax must never ship — the exchange
  // repricing keeps in-range sources in-range in BOTH directions
  // (repriceOntoLoad), and the ceiling binds unconditionally on top.
  let reps = Math.min(
    repMax,
    deviated ? repriceOntoLoad(planSlotReps, currentLoadKg) : planSlotReps
  );
  let weightKg = currentLoadKg;
  let rationale: RepTotalNextSet['rationale'] = 'follow_plan';

  // Too-heavy reaction (recommendSet's reduce branch, rep-space): the last
  // set fell below the range floor at/past the failure deadband — the LOAD is
  // the problem, and no rep target at this load is a prescription. Step the
  // load down so the set's demonstrated capacity prices out at the range mid,
  // capped at −MAX_REDUCE_PCT, on the loading grid.
  // `effort` is non-null only when `last.rir` was defined, so the ?? 0 below
  // is a type narrowing the compiler can't see, never a silent default.
  if (last && last.reps < repMin && effort?.pastDeadband) {
    const zeroRirCapacity = last.reps + Math.max(0, last.rir ?? 0);
    const neededZeroRir = mid + Math.max(0, targetRir);
    const pctDrop = (zeroRirCapacity - neededZeroRir) / repCostPerPctLoad(zeroRirCapacity);
    const rawKg = Math.max(
      currentLoadKg * (1 + pctDrop / 100),
      currentLoadKg * (1 - MAX_REDUCE_PCT)
    );
    const r = roundPrescribedLoad(Math.min(rawKg, currentLoadKg), {
      availableIncrementsKg: input.availableIncrementsKg,
      minIncrementKg: input.minIncrementKg,
      referenceKg: currentLoadKg,
    });
    if (!r.noMeaningfulChange && r.weightKg < currentLoadKg) {
      weightKg = Math.max(smallestIncrement(input.availableIncrementsKg, input.minIncrementKg), r.weightKg);
      rationale = 'reduce_load';
      reps = Math.min(repMax, observedAskCeiling(last, weightKg, targetRir));
    }
  }

  // Evidence floor (spec §2 — the target is a FLOOR, not a budget): a set
  // that beat its slot's ask raises the next ask instead of leaving a target
  // the lifter just disproved. The floor is one rep under the last set's
  // demonstrated ask ceiling at the asked load/effort (the natural
  // set-to-set fatigue decline); it can only RAISE the ask — banked reps
  // never reduce a later prescription, and no ask is ever remainder
  // arithmetic against the session total. Bounded by the range ceiling
  // (spec §4 / AM-5): capacity past repMax is the load-appropriateness
  // detector's signal, never a bigger rep ask.
  if (rationale === 'follow_plan' && last) {
    const lastSetAskCeiling = observedAskCeiling(last, weightKg, targetRir);
    reps = Math.min(repMax, Math.max(reps, lastSetAskCeiling - 1));
  }

  // INV-2 analog, LIVE anchor: once ≥1 set is logged, the ask may not exceed
  // what today's MOST RECENT set supports at the asked load and effort.
  //
  // This anchor used to be the session's BEST set (max over all observed
  // sets), which made the whole rep ask raise-only: the plan target is flat,
  // the evidence floor is a Math.max, and a max-ceiling can only be raised by
  // a later set, never lowered. A session that DECLINED therefore re-served
  // its opening ask verbatim — the live 175→180 lb Abdominal Crunch case
  // (set 1: 9 @ 2 RIR → ask 9; set 2: 7 @ 1 RIR → ask 9 again), where the
  // rest timer extended for a hotter-than-target set while the prescription
  // registered nothing. See docs/PRESCRIPTION_STALENESS_AUDIT.md.
  //
  // Within-session capacity is non-increasing, so the LATEST observation is
  // the live estimate of what the lifter can do on the next set; the max is
  // an estimate of what they could do at the session's START. With one set
  // logged the two anchors are identical — this only diverges once a later
  // set comes in under an earlier one, i.e. exactly the defect.
  //
  // The evidence floor above still raises the ask off a strong set, so the
  // ask lands in [liveCeiling − 1, liveCeiling]: reps absorb the decline at
  // a HELD load, and the load only moves if that lands below the range floor
  // (the step below). Reps first, load second — never re-serve an ask the
  // lifter just disproved.
  let sessionCapacityClamped = false;
  let sessionDeclineTrimmed = false;
  // Session-best ceiling — the ORIGINAL INV-2 bound, unchanged. It still
  // gates the load lever below: "even today's best set can't hold this load
  // in range" is a statement about the load, and it must not be triggered by
  // one weaker set. The live trim that follows moves REPS only.
  let bestCeiling = 0;
  for (const s of valid) {
    const c = observedAskCeiling(s, weightKg, targetRir);
    if (c > bestCeiling) bestCeiling = c;
  }
  if (bestCeiling > 0 && reps > bestCeiling) {
    reps = bestCeiling;
    sessionCapacityClamped = true;
  }
  // The ask the LOAD lever is judged on: post-best-clamp, pre-live-trim. A
  // declining set must not be able to trigger a mid-session load drop by
  // itself (spec: reps absorb fatigue, the load absorbs a wrong load).
  const repsAtBestCeiling = reps;

  // LIVE trim — the fix. Capacity within a session is non-increasing, so the
  // MOST RECENT set, not the best one, is the live estimate of what the next
  // set can do. Trimming to it makes the rep ask two-directional.
  if (last) {
    const liveCeiling = observedAskCeiling(last, weightKg, targetRir);
    if (liveCeiling > 0 && reps > liveCeiling) {
      reps = liveCeiling;
      sessionDeclineTrimmed = true;
    }
  }

  // Step 5: a capacity-trimmed ask below the range floor is a config
  // violation with a lever available — the LOAD. Instead of shipping a
  // target the configured range forbids (the old "target N — below the
  // range" state), step the load down so the reference set's demonstrated
  // capacity delivers the range mid, on the loading grid. When no meaningful
  // step-down exists (already at the smallest load), the honest below-floor
  // ask remains and carries `outsideRange`.
  //
  // Gated on `repsAtBestCeiling`, NOT the live-trimmed ask: the load only
  // moves when today's BEST set cannot hold this load inside the range. A
  // single declining set is absorbed by reps at the held load (which is what
  // the lifter asked for — "drop reps, hold load"), and shows up as an
  // honest below-floor ask carrying `outsideRange` rather than an 11%
  // mid-session deload off one weak set.
  if (repsAtBestCeiling < repMin && rationale === 'follow_plan' && valid.length > 0) {
    let best = valid[0];
    let bestSetCeiling = 0;
    for (const s of valid) {
      const c = observedAskCeiling(s, weightKg, targetRir);
      if (c > bestSetCeiling) {
        bestSetCeiling = c;
        best = s;
      }
    }
    const zeroRirCapacity = best.reps + Math.max(0, best.rir ?? 0);
    const capacityAtLoad = expectedRepsAfterLoadChange(zeroRirCapacity, best.weightKg, weightKg);
    const neededZeroRir = mid + Math.max(0, targetRir);
    const pctDrop = (capacityAtLoad - neededZeroRir) / repCostPerPctLoad(capacityAtLoad);
    if (pctDrop < 0) {
      const rawKg = Math.max(weightKg * (1 + pctDrop / 100), weightKg * (1 - MAX_REDUCE_PCT));
      const r = roundPrescribedLoad(Math.min(rawKg, weightKg), {
        availableIncrementsKg: input.availableIncrementsKg,
        minIncrementKg: input.minIncrementKg,
        referenceKg: weightKg,
      });
      if (!r.noMeaningfulChange && r.weightKg < weightKg) {
        weightKg = Math.max(
          smallestIncrement(input.availableIncrementsKg, input.minIncrementKg),
          r.weightKg
        );
        rationale = 'reduce_load';
        reps = Math.min(repMax, observedAskCeiling(best, weightKg, targetRir));
      }
    }
  }

  // INV-1 analog: the contradiction is rendered, never silent.
  const outsideRange: RepTotalNextSet['outsideRange'] =
    reps < repMin ? 'below' : reps > repMax ? 'above' : undefined;

  // INV-4 analog: positional provenance — only when this slot still follows
  // the plan at the planned load AND the emitted ask is still the plan
  // slot's number (an ask moved by the evidence floor or the capacity clamp
  // is no longer anchored by last session's position — claiming so would be
  // false provenance).
  const refReps =
    rationale === 'follow_plan' && !deviated && weightKg === currentLoadKg && reps === planSlotReps
      ? sessionPlan.perSetRefReps?.[slot]
      : undefined;

  // Spec §5: a load off the plan's invalidates the plan total for EVERY
  // consumer — no branch may emit remainder arithmetic against it. Judged on
  // the RETURNED load, not the last-logged one, so an automatic reduce_load
  // step re-prices the target exactly like a lifter-chosen deviation does
  // (Codex review: the reduce branch used to ship the original total beside
  // a prescription at the reduced load).
  const effectiveSessionTarget =
    Math.abs(weightKg - sessionPlan.weightKg) > deviationToleranceKg
      ? sessionPlan.perSetRepTargets.reduce((sum, t) => sum + repriceOntoLoad(t, weightKg), 0)
      : sessionPlan.sessionRepTotalTarget;

  // Beat-last-session accounting — against last session's ACTUAL total,
  // never the plan total, and only when the totals are comparable (same
  // load). A bumped plan's prior total was earned at the old load; a
  // deviated or reduced load invalidates it mid-session the same way.
  const prevTotal = sessionPlan.prevSessionRepTotal;
  const totalComparable = !sessionPlan.bumped && rationale !== 'reduce_load' && !deviated;

  return {
    weightKg,
    reps,
    totalSoFar,
    remainingToTarget: Math.max(0, effectiveSessionTarget - totalSoFar),
    sessionRepTotalTarget: effectiveSessionTarget,
    remainingToBeatPrev: Math.max(0, prevTotal + 1 - totalSoFar),
    beatPrevBy: Math.max(0, totalSoFar - prevTotal),
    prevSessionRepTotal: prevTotal,
    totalComparable,
    rationale,
    effortVsTarget,
    ...(sessionCapacityClamped ? { sessionCapacityClamped } : {}),
    ...(sessionDeclineTrimmed ? { sessionDeclineTrimmed } : {}),
    ...(outsideRange ? { outsideRange } : {}),
    ...(refReps !== undefined ? { positionRef: { setNo: slot + 1, prevReps: refReps } } : {}),
    ...(deviated
      ? { loadDeviation: { planKg: sessionPlan.weightKg, observedKg: currentLoadKg } }
      : {}),
  };
}
