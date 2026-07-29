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
 *    increment). An emitted ask may sit outside the range ONLY when observed
 *    evidence puts it there (a set proving the load too heavy/too light),
 *    and then it carries `outsideRange`; an out-of-range ask produced by
 *    plan/exchange ARITHMETIC alone is a bug and clamps into the range —
 *    in both directions.
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
  DEADBAND_RIR,
  EFFORT_MATCH_TOLERANCE,
  MAX_REDUCE_PCT,
  HIGH_REP_COST_TAPER_PER_REP,
  HIGH_REP_COST_MIN_PER_PCT,
  REP_TOTAL_VOLUME_SHORTFALL_TOLERANCE,
  REP_TOTAL_LOAD_MATCH_FRACTION,
} from './constants';
import { smallestIncrement, roundPrescribedLoad } from './loadGrid';

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
  /** Session target: beat this total (prev total + 1 on a repeat). */
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
  const [repMin] = targetRepRange;
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
    const bumpedLoad = topLoad + inc;
    const scaled = atLoad.map((s) => expectedRepsAfterLoadChange(s.reps, topLoad, bumpedLoad));
    if (scaled.every((r) => r >= repMin)) {
      // Targets anchor to OBSERVED reps at the prior load, exchanged for the
      // load change — never reset to the range floor. Planned sets beyond
      // history pad with the LAST exchanged target (the fatigue end); the
      // plan covers at least the at-load count actually performed.
      const tail = scaled[scaled.length - 1];
      const perSet = Array.from({ length: Math.max(sets, atLoad.length) }, (_, i) => scaled[i] ?? tail);
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

  // Repeat the load VERBATIM and chase the total: per-set seeds mirror last
  // session's counts (floored at repMin so a collapsed set re-asks the floor),
  // padded with the floor for any extra planned sets. The plan covers at
  // least the at-load count actually performed (no silent set-count drop).
  const perSet = Array.from({ length: Math.max(sets, atLoad.length) }, (_, i) => {
    const prev = atLoad[i]?.reps;
    return Math.max(repMin, prev ?? repMin);
  });
  const volume = applyVolumeConstraint(topLoad, perSet, repMin);
  return {
    weightKg: topLoad,
    perSetRepTargets: perSet,
    perSetRefReps: Array.from({ length: perSet.length }, (_, i) => atLoad[i]?.reps),
    sessionRepTotalTarget: prevTotal + 1,
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

  // Effort classification of the last set, same grammar as recommendSet.
  const dev = last && last.rir !== undefined ? last.rir - targetRir : 0;
  const effortVsTarget: RepTotalNextSet['effortVsTarget'] =
    !last || last.rir === undefined
      ? 'on_target'
      : dev >= EFFORT_MATCH_TOLERANCE
        ? 'easier'
        : dev <= -EFFORT_MATCH_TOLERANCE
          ? 'harder'
          : 'on_target';

  // Plan slot target, exchanged onto today's actual load when it differs from
  // the planned load (a lifter-chosen load must not be graded on the plan's).
  const planSlotReps =
    sessionPlan.perSetRepTargets[slot] ??
    sessionPlan.perSetRepTargets[sessionPlan.perSetRepTargets.length - 1] ??
    repMin;
  let reps = deviated
    ? expectedRepsAfterLoadChange(planSlotReps, sessionPlan.weightKg, currentLoadKg)
    : planSlotReps;
  let weightKg = currentLoadKg;
  let rationale: RepTotalNextSet['rationale'] = 'follow_plan';

  // Too-heavy reaction (recommendSet's reduce branch, rep-space): the last
  // set fell below the range floor at/past the failure deadband — the LOAD is
  // the problem, and no rep target at this load is a prescription. Step the
  // load down so the set's demonstrated capacity prices out at the range mid,
  // capped at −MAX_REDUCE_PCT, on the loading grid.
  if (last && last.reps < repMin && last.rir !== undefined && dev <= -DEADBAND_RIR) {
    const zeroRirCapacity = last.reps + Math.max(0, last.rir);
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
      reps = observedAskCeiling(last, weightKg, targetRir);
    }
  }

  // INV-2 analog: once ≥1 set is logged, the ask may not exceed what today's
  // best observed set supports at the asked load and effort.
  let sessionCapacityClamped = false;
  if (valid.length > 0) {
    let ceiling = 0;
    for (const s of valid) {
      const c = observedAskCeiling(s, weightKg, targetRir);
      if (c > ceiling) ceiling = c;
    }
    if (ceiling > 0 && reps > ceiling) {
      reps = ceiling;
      sessionCapacityClamped = true;
    }
  }

  // INV-1 analog: the contradiction is rendered, never silent.
  const outsideRange: RepTotalNextSet['outsideRange'] =
    reps < repMin ? 'below' : reps > repMax ? 'above' : undefined;

  // INV-4 analog: positional provenance — only when this slot still follows
  // the plan at the planned load (a reduced/deviated load has no like-to-like
  // positional claim).
  const refReps =
    rationale === 'follow_plan' && !deviated && weightKg === currentLoadKg
      ? sessionPlan.perSetRefReps?.[slot]
      : undefined;

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
    remainingToTarget: Math.max(0, sessionPlan.sessionRepTotalTarget - totalSoFar),
    sessionRepTotalTarget: sessionPlan.sessionRepTotalTarget,
    remainingToBeatPrev: Math.max(0, prevTotal + 1 - totalSoFar),
    beatPrevBy: Math.max(0, totalSoFar - prevTotal),
    prevSessionRepTotal: prevTotal,
    totalComparable,
    rationale,
    effortVsTarget,
    ...(sessionCapacityClamped ? { sessionCapacityClamped } : {}),
    ...(outsideRange ? { outsideRange } : {}),
    ...(refReps !== undefined ? { positionRef: { setNo: slot + 1, prevReps: refReps } } : {}),
    ...(deviated
      ? { loadDeviation: { planKg: sessionPlan.weightKg, observedKg: currentLoadKg } }
      : {}),
  };
}
