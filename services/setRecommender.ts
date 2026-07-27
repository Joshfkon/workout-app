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
import { rpeToRir, type ExerciseType } from '@/types/schema';
import {
  recommendDurationSet,
  recommendDurationSessionStart,
} from './suggestionEngine/durationPolicy';
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
  MIN_MEANINGFUL_CHANGE_FRACTION,
  OVERRIDE_DEVIATION_FRACTION,
  RECAL_FATIGUE_CORRECTION_PER_SET,
  RECAL_MAX_FRESHNESS_CORRECTION,
  SUGGESTION_ENGINE_VERSION,
  RAMP_ROLE_MAX_FRACTION,
  TOP_SET_LOAD_TOLERANCE,
  SCHEME_REP_WINDOW_FLOOR_MULTIPLE,
  STALL_LOAD_TOLERANCE,
  LIGHT_LOAD_INCREMENT_FRACTION,
  LIGHT_LOAD_REP_CEILING_EXTENSION,
  POSITION_MATCH_SET_COUNT_TOLERANCE,
  POSITION_MATCH_LOAD_TOLERANCE,
  SESSION_CAPACITY_TOLERANCE,
} from './suggestionEngine/constants';
import { estimateE1RM, E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS } from './shared/e1rm';
import { inferRolesForSession, type SetRole } from './suggestionEngine/setRoles';
import {
  smallestIncrement,
  smallestKnownIncrement,
  roundPrescribedLoad,
} from './suggestionEngine/loadGrid';

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
  /** Smallest load increment for this exercise (kg). Legacy single value. */
  minIncrementKg?: number;
  /**
   * Phase D — the exercise's available increment SET (e.g. [4.54, 1.13] for a
   * 10 lb stack with 2.5 lb add-ons). The achievable-load grid is multiples
   * of the smallest entry; when present it supersedes `minIncrementKg` for
   * all rounding (services/suggestionEngine/loadGrid).
   */
  availableIncrementsKg?: number[];
  /**
   * True on the exercise's FIRST-EVER session (no logged history): the weight
   * was a cold-start estimate, expected to be wrong low. An easy-rated set
   * (RIR >= COLD_START_EASY_RIR) bumps the load even mid-range, and the step
   * cap widens to COLD_START_STEP_PCT so the session converges fast.
   */
  coldStart?: boolean;
  /**
   * Exercise modality. 'duration_based' routes to the duration policy
   * (services/suggestionEngine/durationPolicy.ts): lastReps / targetRepRange /
   * the returned reps all carry SECONDS, and none of the e1RM math runs.
   * Absent = rep_based.
   */
  exerciseType?: ExerciseType;
  /**
   * True for bodyweight exercises. Duration policy only: a bodyweight hold has
   * no external-load lever, so it progresses by time alone and holds at the
   * range ceiling as a stable state.
   */
  isBodyweight?: boolean;
  /**
   * Phase A — set-position matching. When provided (and the sessions are
   * comparable), the next set's target is what the SAME set position did last
   * session plus the smallest meaningful progression, instead of a
   * re-derivation from the session-start anchor. Omitted → anchor path only
   * (legacy behavior, and the fall-through when matching doesn't apply).
   */
  positionContext?: PositionContext;
  /**
   * Phase 0 (INV-2) — ALL sets completed THIS session with their resolved
   * effort, in performed order. Their best canonical implied capacity is the
   * ceiling no prescription may exceed. The just-completed set (the last*
   * fields) is always included in the ceiling pool automatically; pass the
   * earlier sets here. Omitted → the ceiling is the last set alone.
   */
  sessionObservedSets?: Array<{ weightKg: number; reps: number; rir: number }>;
}

/** The session-comparison inputs for set-position matching. */
export interface PositionContext {
  /** ALL sets from the previous session, in performed order. */
  prevSessionSets: PrevSessionSet[];
  /** Today's completed working sets so far, in performed order. */
  todaySets: Array<{ weightKg: number; reps: number }>;
  /** Planned working-set count for this exercise today. */
  plannedSetCount: number;
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
  /**
   * Set by recommendSessionStart when THREE consecutive sessions attempted the
   * same prescription without progress (stall rule). Flag only — the UI may
   * later surface it as a deload suggestion; nothing consumes it yet.
   */
  suggestDeload?: boolean;
  /**
   * Present when the recommendation came from set-position matching (Phase A):
   * the target is last session's set at this position plus the smallest
   * meaningful progression, NOT an anchor-curve derivation. Carries the
   * matched set for provenance so the banner can say exactly what it matched.
   */
  positionMatch?: PositionMatchedTarget;
  /**
   * Phase D: the engine WANTED to move the load, but the true prescription
   * sat within half an increment of the current load — no meaningful change
   * is available at this increment. The load is held and the UI must say so
   * rather than rendering the no-op as a decision (or fabricating a full
   * increment the curve doesn't support).
   */
  noMeaningfulChange?: boolean;
  /**
   * Phase 0 (INV-1): the predicted reps fall outside the stated target rep
   * range. Honest reps are kept (a fatigue-driven decline below the floor on
   * late sets is real, and an under-load overshoot is the double-progression
   * signal) — but the UI MUST acknowledge the mismatch instead of rendering
   * the range header and the out-of-range number side by side silently.
   */
  outsideRange?: 'below' | 'above';
  /**
   * Phase 0 (INV-2): the rep ask was trimmed because the prescription's
   * implied capacity (canonical estimator, at the asked effort) exceeded the
   * best set OBSERVED this session — the engine was about to demand a
   * session best under fatigue.
   */
  sessionCapacityClamped?: boolean;
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
 * Inverse pricing for a CANONICAL (capped-estimator) anchor — the cap
 * asymmetry fix. Stored anchors come from capped Brzycki: any set past 12
 * effective reps contributes a FLOOR value computed AT the cap, so the anchor
 * never encodes capability beyond 12 effective reps. Inverting such an anchor
 * at a higher effective count (a 12-20 range's mid + RIR = 18) divides a
 * deflated number by an extrapolated divisor — double deflation, which is how
 * a lateral raise priced at nonsense loads. Structural for every high-rep
 * exercise on the e1rm path.
 *
 * Fix: the effective reps used to price a load off a capped anchor are
 * clamped to the same cap. Beyond it the curve cannot price — the eff-12 load
 * is the best in-domain answer, and the honest-reps check downstream (the
 * below-floor warning / INV-1) surfaces the range-vs-anchor tension instead
 * of a fabricated light load. Within-session Epley-on-Epley math (session
 * e1rm from today's sets) is deliberately NOT capped — both sides of that
 * inversion live on the same uncapped curve.
 */
function weightForRepsCappedAnchor(e1rm: number, reps: number, rir: number): number {
  const eff = Math.min(reps + Math.max(0, rir), E1RM_HIGH_CONFIDENCE_MAX_EFFECTIVE_REPS);
  return e1rm / (1 + eff / 30);
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

/** Target a session is graded against by sessionMetPrescription. */
export interface SessionPrescriptionTarget {
  targetRepRange: [number, number];
  targetRir: number;
  /**
   * Smallest loadable increment (kg), when known. Enables the light-load
   * rep-ceiling extension (effectiveRepCeiling): omitted → nominal repMax
   * always (never guess loadability).
   */
  minIncrementKg?: number;
}

/**
 * The rep ceiling a set must reach to earn a load bump. Nominal repMax —
 * EXCEPT when the smallest loadable increment exceeds
 * LIGHT_LOAD_INCREMENT_FRACTION of the load (e.g. 10 kg DB + 2.5 kg = +25%):
 * a bump that big is bump-then-fail-then-stall, and holding forever is worse,
 * so the ceiling extends by LIGHT_LOAD_REP_CEILING_EXTENSION and reps climb
 * past the range top as a substitute for the fractional load that doesn't
 * exist. Extension applies only when the increment is explicitly known.
 */
export function effectiveRepCeiling(
  repMax: number,
  weightKg: number,
  minIncrementKg?: number
): number {
  if (
    minIncrementKg &&
    minIncrementKg > 0 &&
    weightKg > 0 &&
    minIncrementKg / weightKg > LIGHT_LOAD_INCREMENT_FRACTION
  ) {
    return repMax + LIGHT_LOAD_REP_CEILING_EXTENSION;
  }
  return repMax;
}

/**
 * A previous session reduced to its gradable working sets, for the success
 * predicate and the stall rule. Null when NOTHING in the session is gradable
 * (malformed data, or no set inside the grading scheme) — callers must then
 * hold the last prescription rather than guess.
 */
interface GradedSession {
  /** Gradable set(s) at the session's top graded load (± TOP_SET_LOAD_TOLERANCE). */
  topSets: PrevSessionSet[];
  topWeightKg: number;
  /** Best reps among the top graded set(s) — the stall rule's progress signal. */
  topReps: number;
  met: boolean;
}

/**
 * Grade a session's sets against the prescribed rep range (design doc §10).
 *
 * Exclusions before grading:
 *  - invalid rows (non-finite / non-positive weight or reps) — skipped, never throw;
 *  - feeder work below RAMP_ROLE_MAX_FRACTION of the session's top load;
 *  - out-of-scheme sets whose reps fall outside
 *    [repMin, max(repMin × SCHEME_REP_WINDOW_FLOOR_MULTIPLE, repMax)] — e.g. a
 *    heavy 200×4 pyramid top against a 6–10 range. These are a different rep
 *    scheme: they neither earn nor block a bump. Rep overshoot beyond
 *    repMax + REP_OVERSHOOT stays gradable (it objectively proves under-load).
 *    TODO(known debt): the durable fix is per-slot rep ranges for pyramid
 *    schemes; this window is the interim heuristic.
 */
function gradeSession(
  sets: PrevSessionSet[],
  targetRepRange: [number, number],
  minIncrementKg?: number
): GradedSession | null {
  const [repMin, repMax] = targetRepRange;
  const valid = sets.filter(
    (s) =>
      Number.isFinite(s.weightKg) && s.weightKg > 0 && Number.isFinite(s.reps) && s.reps > 0
  );
  if (valid.length === 0) return null;

  const topLoad = valid.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0);
  // Window upper bound includes the light-load extension so an extended-ceiling
  // rep count is never excluded as out-of-scheme on narrow ranges.
  const schemeRepMax = Math.max(
    repMin * SCHEME_REP_WINDOW_FLOOR_MULTIPLE,
    repMax + LIGHT_LOAD_REP_CEILING_EXTENSION
  );
  const graded = valid.filter(
    (s) =>
      s.weightKg >= topLoad * RAMP_ROLE_MAX_FRACTION &&
      ((s.reps >= repMin && s.reps <= schemeRepMax) || s.reps > repMax + REP_OVERSHOOT)
  );
  if (graded.length === 0) return null;

  const topWeightKg = graded.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0);
  const topSets = graded.filter((s) => s.weightKg >= topWeightKg * (1 - TOP_SET_LOAD_TOLERANCE));
  const topReps = topSets.reduce((m, s) => (s.reps > m ? s.reps : m), 0);

  // The prescription is met when a top set reached the rep ceiling —
  // effectiveRepCeiling: nominal repMax, extended on light-load exercises
  // where the smallest increment is a >10% jump. Effort at ≤ targetRir + 1
  // meets it as prescribed (§10's "at ≤ targetRir", with the half-step chip
  // tolerance); a HIGHER logged RIR means it was met with effort to spare —
  // also success. Either way the rep ceiling decides: RIR cannot disqualify a
  // set that reached it.
  const met = topSets.some(
    (s) => s.reps >= effectiveRepCeiling(repMax, s.weightKg, minIncrementKg)
  );

  return { topSets, topWeightKg, topReps, met };
}

/**
 * THE session-to-session success predicate (single source of truth): did the
 * session meet its prescription — top working set(s) at reps >= repMax
 * (design doc §10)? Consumed by BOTH earnedSessionBump (seed/anchor bump
 * gate) and recommendSessionStart (rep seeding + stall rule), so the gate and
 * the seed can never disagree about what "earned it" means.
 *
 * False (never a throw) for empty, malformed, or ungradable sessions.
 */
export function sessionMetPrescription(
  sets: PrevSessionSet[],
  target: SessionPrescriptionTarget
): boolean {
  const graded = gradeSession(sets, target.targetRepRange, target.minIncrementKg);
  return graded ? graded.met : false;
}

/**
 * Did the previous session EARN a load increase? Delegates to
 * sessionMetPrescription — kept as the named gate the seed/anchor path calls.
 *
 * Previous semantics (EVERY working set at repMax with >= DEADBAND_RIR spare)
 * made progression unreachable when following prescriptions exactly: hitting
 * top-of-range at the target effort — textbook double-progression success —
 * never qualified. Now the TOP working set(s) reaching repMax earns the bump.
 */
export function earnedSessionBump(
  prevSessionSets: PrevSessionSet[],
  targetRepRange: [number, number],
  targetRir: number,
  minIncrementKg?: number
): boolean {
  return sessionMetPrescription(prevSessionSets, { targetRepRange, targetRir, minIncrementKg });
}

// ============================================
// SET-POSITION MATCHING (Phase A — intra-session prescription)
// ============================================

/**
 * A position-matched target: last session's set at the SAME position, plus
 * the smallest meaningful progression. `prev*` fields echo the matched set
 * for provenance (the banner must say what was matched, not just a number).
 */
export interface PositionMatchedTarget {
  weightKg: number;
  reps: number;
  rir: number;
  /**
   * Which progression was applied to the matched set:
   *  - 'add_rep'  — one more rep at the same load (positional set had target
   *    reserve, room existed);
   *  - 'add_load' — one increment up, one rep traded (positional set was at
   *    the rep ceiling with target reserve);
   *  - 'hold'     — matched verbatim (positional set was taken harder than
   *    target: repeating it at better effort IS the progression).
   */
  progression: 'add_rep' | 'add_load' | 'hold';
  prevWeightKg: number;
  prevReps: number;
  prevRir?: number;
}

/** Inputs for matchPositionTarget. Loads are unit-agnostic pure numbers. */
export interface PositionMatchInput {
  /** 0-indexed position of the set being prescribed (= working sets done today). */
  position: number;
  /** ALL sets from the previous session, in performed order. */
  prevSessionSets: PrevSessionSet[];
  /** Today's completed working sets so far, in performed order. */
  todaySets: Array<{ weightKg: number; reps: number }>;
  /** Planned working-set count for this exercise today. */
  plannedSetCount: number;
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
  /** Phase D — available increment set; smallest entry drives the load step. */
  availableIncrementsKg?: number[];
}

/**
 * THE set-position match (Phase A). Fixes the root defect of per-set
 * re-derivation from a session-START anchor: a static anchor has no term for
 * what already happened this session, so set 4 was prescribed the same value
 * as set 2 while the late sets measure the same capacity under accumulated
 * fatigue (the Iso-Lateral Incline Press fixture shows a ~13% e1RM spread
 * inside one session, monotonically ordered by fatigue). Last session's set
 * at the SAME position already embeds that session shape — no fitted fatigue
 * model needed.
 *
 * Target = the positional set, plus the smallest meaningful progression:
 *  - positional set at/above target reserve (within the half-chip effort
 *    tolerance) → one more rep at the same load; at the rep ceiling → one
 *    increment up, one rep traded;
 *  - positional set harder than target → held VERBATIM. It was already past
 *    the prescribed effort; asking for one more rep would demand exceeding
 *    failure (the fixture's set 4: 182.5×7 @0 must re-prescribe ×7, never 8).
 *
 * Returns null — fall through to the anchor path — when the sessions are not
 * comparable:
 *  - no valid previous-session set at this position;
 *  - set counts differ by more than POSITION_MATCH_SET_COUNT_TOLERANCE;
 *  - any completed set today deviates more than POSITION_MATCH_LOAD_TOLERANCE
 *    from the load the same position carried last session (plan override /
 *    restructure — last session is not being repeated);
 *  - the positional set was a ramp/feeder set (role inference): feeder work
 *    never receives working-set progression.
 *
 * KNOWN LIMIT: exercise ORDER within the workout is not checked — the stored
 * history shape doesn't carry the exercise's position in the previous workout.
 * The load-comparability gate catches most order-driven divergence (an
 * exercise moved from first to last shows up as lighter early sets today).
 */
export function matchPositionTarget(input: PositionMatchInput): PositionMatchedTarget | null {
  const { position, plannedSetCount, targetRepRange, targetRir } = input;
  const [repMin, repMax] = targetRepRange;
  if (!Number.isInteger(position) || position < 0) return null;
  if (!(plannedSetCount > 0)) return null;

  // Valid rows only, in performed order (malformed rows are skipped, never throw).
  const prev = input.prevSessionSets.filter(
    (s) => Number.isFinite(s.weightKg) && s.weightKg > 0 && Number.isFinite(s.reps) && s.reps > 0
  );
  if (prev.length === 0) return null;

  // Gate 1: comparable set counts.
  if (Math.abs(prev.length - plannedSetCount) > POSITION_MATCH_SET_COUNT_TOLERANCE) return null;

  // Gate 2: a working positional set exists.
  const ref = prev[position];
  if (!ref) return null;
  const roles = inferRolesForSession(prev.map((s) => ({ weightKg: s.weightKg })));
  if (roles[position] !== 'working') return null;

  // Gate 3: today's session so far is load-comparable, position by position.
  const compared = Math.min(position, input.todaySets.length);
  for (let i = 0; i < compared; i++) {
    const today = input.todaySets[i];
    const past = prev[i];
    if (!today || !past) continue;
    if (!(today.weightKg > 0) || !(past.weightKg > 0)) continue;
    if (Math.abs(today.weightKg - past.weightKg) / past.weightKg > POSITION_MATCH_LOAD_TOLERANCE) {
      return null;
    }
  }

  const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);
  const prevRir = ref.rir;
  // Missing RIR → assume the set landed on target (same convention as the
  // rest of the engine). The half-chip tolerance keeps the RIR-2 "good" chip
  // (stored RPE 7.5 → RIR 2.5) and a 1.5 both counting as at-target.
  const effRir = prevRir ?? targetRir;
  const provenance = {
    rir: targetRir,
    prevWeightKg: ref.weightKg,
    prevReps: ref.reps,
    ...(prevRir !== undefined ? { prevRir } : {}),
  };

  if (effRir >= targetRir - EFFORT_MATCH_TOLERANCE) {
    // Room existed at this position last time → smallest meaningful progression.
    // Ceiling extension keys on the smallest KNOWN step (never the default).
    const ceiling = effectiveRepCeiling(
      repMax,
      ref.weightKg,
      smallestKnownIncrement(input.availableIncrementsKg, input.minIncrementKg)
    );
    if (ref.reps + 1 <= ceiling) {
      return { weightKg: ref.weightKg, reps: ref.reps + 1, progression: 'add_rep', ...provenance };
    }
    // At the rep ceiling: one increment up, one rep traded (double progression
    // at the smallest available step, not a curve-derived jump).
    return {
      weightKg: ref.weightKg + inc,
      reps: Math.max(repMin, ref.reps - 1),
      progression: 'add_load',
      ...provenance,
    };
  }

  // Positional set was harder than target → hold it verbatim.
  return { weightKg: ref.weightKg, reps: ref.reps, progression: 'hold', ...provenance };
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
  /** Smallest load increment (kg) for weight picking. Legacy single value. */
  minIncrementKg?: number;
  /** Phase D — available increment set; smallest entry drives weight picking. */
  availableIncrementsKg?: number[];
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

  const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);
  const mid = Math.round((repRange[0] + repRange[1]) / 2);
  // Anchor-domain pricing (cap asymmetry fix): the weight pick never inverts
  // beyond the canonical estimator's 12-effective-rep cap — an anchor cannot
  // encode capability past it, so pricing a high-rep mid off it double-deflates.
  const weightKg = roundToIncrement(weightForRepsCappedAnchor(e1RMKg, mid, rir), inc);
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
  // Duration exercises (seconds in the reps field) never enter the e1RM curve.
  if (input.exerciseType === 'duration_based') {
    return recommendDurationSet(input, !input.isBodyweight);
  }

  const { lastWeightKg, lastReps, lastRir, targetRepRange, targetRir } = input;
  const [repMin, repMax] = targetRepRange;
  // Phase D: the load step is the smallest AVAILABLE increment (grid =
  // multiples of it) — a 10 lb stack with 2.5 lb add-ons steps by 2.5, not 10.
  const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);
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

  // ---- Phase 0 hard invariants — applied to EVERY prescription returned ----
  //
  // INV-2: never prescribe an implied capacity above the session's best
  // OBSERVED set. Implied capacity = canonical capped Brzycki at the ASKED
  // effort — the target RIR, except for a position-matched rec, which asks
  // the lifter to repeat a set performed at its RECORDED effort (grading a
  // repeat-ask at the stricter target effort would strip fixture-validated
  // targets whose evidence set was taken past target). The ceiling pool is
  // today's completed sets (sessionObservedSets + the just-completed set);
  // it only applies once at least one set is done THIS session — a
  // session-start replay off last session's reference set is not an
  // observation of today. Cheap proxy for the full fatigue model: confirmed
  // by two independent live reproductions (Iso-Lateral MISS B, Arnold Press
  // 42.5×10 = 61.2 implied against a 60.0 session best).
  //
  // INV-1: a prescription whose reps fall outside the stated range keeps its
  // honest count but carries `outsideRange` so the banner must re-render the
  // contradiction (never "8-12 @ 2 RIR" silently over a ×7 prefill).
  const finalizeRec = (rec: SetRecommendation): SetRecommendation => {
    const out = { ...rec };

    if (n >= 1 && out.weightKg > 0) {
      let ceiling = 0;
      const pool = [
        ...(input.sessionObservedSets ?? []),
        { weightKg: lastWeightKg, reps: lastReps, rir: safeRir },
      ];
      for (const s of pool) {
        const est =
          s.weightKg > 0 && s.reps > 0 ? estimateE1RM(s.weightKg, s.reps, Math.max(0, s.rir)) : null;
        if (est && est.value > ceiling) ceiling = est.value;
      }
      if (ceiling > 0) {
        const askedRir = out.positionMatch ? out.positionMatch.prevRir ?? out.rir : out.rir;
        let reps = out.reps;
        for (;;) {
          if (reps <= 1) break;
          const implied = estimateE1RM(out.weightKg, reps, Math.max(0, askedRir));
          // null = beyond the estimator's domain (> 15 effective reps): the
          // ask is not even measurable — keep trimming until it is.
          if (implied && implied.value <= ceiling * (1 + SESSION_CAPACITY_TOLERANCE)) break;
          reps -= 1;
        }
        if (reps !== out.reps) {
          out.reps = reps;
          out.sessionCapacityClamped = true;
        }
      }
    }

    if (out.reps < repMin) out.outsideRange = 'below';
    else if (out.reps > repMax) out.outsideRange = 'above';

    return out;
  };

  // ---- 0) SET-POSITION MATCH (Phase A) ----
  // When the previous session is comparable, the next set's target is what
  // the SAME set position did last time (plus the smallest meaningful
  // progression) — the positional set already embeds the session's fatigue
  // shape, which a static session-start anchor cannot see. Two reactive
  // guards keep today's evidence in charge when it clearly contradicts the
  // replay; on either, fall through to the anchor path below.
  if (input.positionContext) {
    const pm = matchPositionTarget({
      position: n,
      prevSessionSets: input.positionContext.prevSessionSets,
      todaySets: input.positionContext.todaySets,
      plannedSetCount: input.positionContext.plannedSetCount,
      targetRepRange,
      targetRir,
      minIncrementKg: input.minIncrementKg,
      availableIncrementsKg: input.availableIncrementsKg,
    });
    // Guard A: the set just completed ground past the failure deadband — a
    // position match may still prescribe DOWN (that's the fixture's set 4),
    // but never MORE load than the set that just ground out.
    const groundOut = dev <= -DEADBAND_RIR && !!pm && pm.weightKg > lastWeightKg;
    // Guard B: the set just completed proved objective under-load (reps past
    // the overshoot proof) — today is running far stronger than last session;
    // replaying last session's positions would under-prescribe.
    const provenUnderload = lastReps > repMax + REP_OVERSHOOT;
    if (pm && !groundOut && !provenUnderload) {
      return finalizeRec({
        weightKg: pm.weightKg,
        reps: pm.reps,
        rir: targetRir,
        rationale:
          pm.weightKg > lastWeightKg
            ? 'increase_load'
            : pm.weightKg < lastWeightKg
              ? 'reduce_load'
              : 'maintain',
        effortVsTarget,
        positionMatch: pm,
      });
    }
  }

  // ---- 1) Decide the WEIGHT (default: hold) ----
  let weightKg: number;
  let rationale: SetRecommendation['rationale'];
  let noMeaningfulChange = false;

  // Grid rounding for an intended load CHANGE against the just-completed
  // set's load (Phase D — services/suggestionEngine/loadGrid):
  //  - never renders an intended change as the reference load (grid ties
  //    round in the direction of the intent);
  //  - a true prescription within HALF an increment of the reference is not
  //    a decision: hold and say so, never fabricate a full-increment jump.
  const gridRound = (rawKg: number) =>
    roundPrescribedLoad(rawKg, {
      availableIncrementsKg: input.availableIncrementsKg,
      minIncrementKg: input.minIncrementKg,
      referenceKg: lastWeightKg,
    });

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
    const r = gridRound(Math.max(Math.min(ideal, lastWeightKg * (1 + stepCap)), lastWeightKg));
    if (r.noMeaningfulChange) {
      weightKg = lastWeightKg;
      rationale = 'maintain';
      noMeaningfulChange = true;
    } else {
      weightKg = r.weightKg;
      rationale = 'increase_load';
    }
  } else if (coldStartEasy) {
    // Cold-start "easy" rating: the RIR chip caps at 4+, so Epley can't see
    // the real headroom — a rated-easy first set means the estimate was low.
    // Bump by the full cold-start step rather than deriving from reported RIR.
    const r = gridRound(lastWeightKg * (1 + COLD_START_STEP_PCT));
    if (r.noMeaningfulChange) {
      weightKg = lastWeightKg;
      rationale = 'maintain';
      noMeaningfulChange = true;
    } else {
      weightKg = r.weightKg;
      rationale = 'increase_load';
    }
  } else if (lastReps < repMin || dev <= -DEADBAND_RIR) {
    // Too heavy, or went too close to failure → reduce toward mid-range.
    const ideal = weightForReps(e1rm, mid, targetRir);
    const r = gridRound(Math.min(Math.max(ideal, lastWeightKg * (1 - MAX_REDUCE_PCT)), lastWeightKg));
    if (r.noMeaningfulChange) {
      weightKg = lastWeightKg;
      rationale = 'maintain';
      noMeaningfulChange = true;
    } else {
      weightKg = Math.max(inc, r.weightKg);
      rationale = 'reduce_load';
    }
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

  return finalizeRec({
    weightKg,
    reps,
    rir: targetRir,
    rationale,
    effortVsTarget,
    ...(noMeaningfulChange ? { noMeaningfulChange } : {}),
  });
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
  /** Phase D — available increment set; smallest entry drives the load step. */
  availableIncrementsKg?: number[];
  /**
   * Exercise modality. 'duration_based' routes to the duration policy —
   * prevReps / targetRepRange / the returned reps carry SECONDS and the
   * session lists / stall / e1RM machinery below are not consulted.
   */
  exerciseType?: ExerciseType;
  /** True for bodyweight exercises (duration policy: time-only progression). */
  isBodyweight?: boolean;
  /**
   * ALL sets from the previous session (in performed order), for the success
   * predicate: a load increase is earned when the TOP working set(s) reached
   * the top of the range (sessionMetPrescription). Omitted → single-set
   * grading off the reference set (callers that only know the one
   * corresponding set).
   */
  prevSessionSets?: PrevSessionSet[];
  /**
   * ALL sets from the session BEFORE last. Two consumers: the regression path
   * (Fix 4 — a session-start load REDUCTION requires two consecutive
   * below-floor sessions, then steps down one increment capped −MAX_STEP_PCT;
   * a single bad session holds), and the stall rule (two consecutive attempts
   * at the same prescription without progress → hold instead of +1). Pass []
   * when the prior session is known not to exist. Omitted (undefined) →
   * legacy immediate curve-based reduce, and no stall detection.
   */
  priorSessionSets?: PrevSessionSet[];
  /**
   * ALL sets from the session before `priorSessionSets`' session (three back),
   * used ONLY by the stall rule's third strike: three consecutive attempts at
   * the same prescription without progress additionally set `suggestDeload`.
   * Omitted → the flag never fires.
   */
  earlierSessionSets?: PrevSessionSet[];
}

/**
 * How many consecutive completed sessions attempted the SAME prescription
 * (top graded load within STALL_LOAD_TOLERANCE) without rep progress, ending
 * at the most recent session. 0/1 = no stall; 2 = hold instead of +1; 3 =
 * hold + suggestDeload. Only counted when the most recent session did NOT
 * meet its prescription (callers check that first).
 */
function stallStreak(prevGraded: GradedSession, input: SessionStartInput): number {
  if (!input.priorSessionSets || input.priorSessionSets.length === 0) return 0;
  const knownInc = smallestKnownIncrement(input.availableIncrementsKg, input.minIncrementKg);
  const prior = gradeSession(input.priorSessionSets, input.targetRepRange, knownInc);
  if (!prior) return 0;
  const sameLoad = (a: number, b: number) => b > 0 && Math.abs(a - b) / b <= STALL_LOAD_TOLERANCE;
  if (!sameLoad(prevGraded.topWeightKg, prior.topWeightKg)) return 0;
  if (prevGraded.topReps > prior.topReps) return 0; // reps moved — that IS progress
  if (input.earlierSessionSets && input.earlierSessionSets.length > 0) {
    const earlier = gradeSession(input.earlierSessionSets, input.targetRepRange, knownInc);
    if (earlier && sameLoad(prior.topWeightKg, earlier.topWeightKg) && prior.topReps <= earlier.topReps) {
      return 3;
    }
  }
  return 2;
}

/**
 * Session-START recommendation: the first working set of a NEW session,
 * anchored to the corresponding set from the previous session, driven by the
 * shared success predicate (sessionMetPrescription / design doc §10):
 *
 *  - Previous session MET its prescription → bump the load (existing e1RM
 *    anchor math: ideal for repMax @ target RIR, capped +MAX_STEP_PCT, with
 *    the one-increment escape) and RESET the rep seed to repMin.
 *  - NOT met, no red flags → same load, prevReps + 1 (capped at repMax): the
 *    seed now ASKS for rep progression instead of replaying last session.
 *  - Stalled (2 consecutive sessions at the same prescription with no rep
 *    progress) → hold verbatim; a 3rd consecutive miss also sets
 *    `suggestDeload` (flag only).
 *  - Red flags (reference set below the floor or past the failure deadband)
 *    keep the regression path: confirmed two-in-a-row regressions step down
 *    one increment; a single bad session holds verbatim — never +1 off a miss.
 *  - Ungradable previous-session data → log and hold (never crash or guess).
 */
export function recommendSessionStart(input: SessionStartInput): SetRecommendation {
  // Duration exercises: time-then-load double progression, no e1RM/stall math.
  if (input.exerciseType === 'duration_based') {
    return recommendDurationSessionStart(input, !input.isBodyweight);
  }

  const [repMin, repMax] = input.targetRepRange;
  const rec = recommendSet({
    lastWeightKg: input.prevWeightKg,
    lastReps: input.prevReps,
    lastRir: input.prevRir ?? input.targetRir,
    setsCompletedThisExercise: 0,
    targetRepRange: input.targetRepRange,
    targetRir: input.targetRir,
    minIncrementKg: input.minIncrementKg,
    availableIncrementsKg: input.availableIncrementsKg,
  });

  // Degenerate reference (zero load / zero reps): recommendSet's guard already
  // produced the in-range hold (the only seed a bodyweight/broken slot has).
  if (input.prevWeightKg <= 0 || input.prevReps <= 0) return rec;

  const holdVerbatim = (suggestDeload?: boolean): SetRecommendation => ({
    weightKg: input.prevWeightKg,
    reps: clamp(input.prevReps, 1, repMax + OVERSHOOT_CEILING),
    rir: input.targetRir,
    rationale: 'maintain',
    effortVsTarget: rec.effortVsTarget,
    ...(suggestDeload ? { suggestDeload } : {}),
  });

  if (rec.rationale === 'reduce_load' && input.priorSessionSets !== undefined) {
    // RED FLAGS — regression path (Fix 4): prescribe DOWN only on CONFIRMED
    // underperformance — two consecutive sessions below the range floor at a
    // maintained load. One bad session (below floor, or a grind) is noise:
    // hold the load verbatim (never +1 off a miss) and let the lifter retry.
    const lastSessionSets: PrevSessionSet[] =
      input.prevSessionSets && input.prevSessionSets.length > 0
        ? input.prevSessionSets
        : [{ weightKg: input.prevWeightKg, reps: input.prevReps, rir: input.prevRir }];
    if (confirmedRegression(lastSessionSets, input.priorSessionSets, input.targetRepRange)) {
      const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);
      return {
        weightKg: regressionStepDown(input.prevWeightKg, inc),
        // Recenter the rep expectation on the plan at the reduced load.
        reps: Math.round((repMin + repMax) / 2),
        rir: input.targetRir,
        rationale: 'reduce_load',
        effortVsTarget: rec.effortVsTarget,
      };
    }
    return holdVerbatim();
  }
  if (rec.rationale === 'reduce_load') {
    // Legacy callers (no prior-session info): immediate curve-based reduce.
    return rec;
  }

  const lastSessionSets: PrevSessionSet[] =
    input.prevSessionSets && input.prevSessionSets.length > 0
      ? input.prevSessionSets
      : [{ weightKg: input.prevWeightKg, reps: input.prevReps, rir: input.prevRir }];
  const graded = gradeSession(
    lastSessionSets,
    input.targetRepRange,
    smallestKnownIncrement(input.availableIncrementsKg, input.minIncrementKg)
  );

  if (!graded) {
    // No silent failures: malformed / ungradable session data → hold the last
    // prescription rather than crash or invent progression.
    console.warn(
      '[setRecommender] recommendSessionStart: previous session has no gradable working sets — holding last prescription.'
    );
    return holdVerbatim();
  }

  if (graded.met) {
    // Bump earned (single source of truth: sessionMetPrescription). Load per
    // the existing e1RM anchor math — ideal for repMax @ target RIR off the
    // reference set's capacity estimate, capped +MAX_STEP_PCT, one-increment
    // escape — and the rep seed RESETS to the range floor for the new load.
    const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);
    const e1rm = epleyE1RM(
      input.prevWeightKg,
      input.prevReps,
      Math.max(0, input.prevRir ?? input.targetRir)
    );
    const ideal = weightForReps(e1rm, repMax, input.targetRir);
    // Grid rule (Phase D): an EARNED bump must land strictly above the
    // previous load — a grid tie rounds up, never down to last session's load.
    const r = roundPrescribedLoad(
      Math.max(Math.min(ideal, input.prevWeightKg * (1 + MAX_STEP_PCT)), input.prevWeightKg),
      {
        availableIncrementsKg: input.availableIncrementsKg,
        minIncrementKg: input.minIncrementKg,
        referenceKg: input.prevWeightKg,
      }
    );
    // An earned bump within half an increment of the previous load still
    // steps: unlike a curve-noise adjustment, this change was EARNED by
    // hitting the rep ceiling, and the smallest real step is the honest
    // double-progression move.
    const weightKg = r.noMeaningfulChange ? input.prevWeightKg + inc : r.weightKg;
    return {
      weightKg,
      reps: repMin,
      rir: input.targetRir,
      rationale: 'increase_load',
      effortVsTarget: rec.effortVsTarget,
    };
  }

  const streak = stallStreak(graded, input);
  if (streak >= 2) {
    // Stalled at this prescription — re-prescribe the same instead of piling
    // +1s the lifter isn't hitting; the third strike raises the deload flag.
    return holdVerbatim(streak >= 3);
  }

  // NOT met, no red flags → ask for one more rep at the same load, capped at
  // the effective rep ceiling (nominal repMax; extended past it on light-load
  // exercises where the smallest increment is a >10% jump, so reps substitute
  // for unavailable fractional load). A slot already at/above the ceiling
  // keeps its honest count (never seed fewer reps than the lifter did).
  const ceiling = effectiveRepCeiling(
    repMax,
    input.prevWeightKg,
    smallestKnownIncrement(input.availableIncrementsKg, input.minIncrementKg)
  );
  return {
    weightKg: input.prevWeightKg,
    reps: Math.min(input.prevReps + 1, Math.max(ceiling, input.prevReps)),
    rir: input.targetRir,
    rationale: 'maintain',
    effortVsTarget: rec.effortVsTarget,
  };
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
export type AnchorSource = 'e1rm' | 'last_session' | 'ramp_percent' | 'position_match' | 'none';

export interface SeedSlotInput {
  /** Resolved role for this slot (user tag beats inference — resolve upstream). */
  role: SetRole;
  /** Target working rep range [min, max]. */
  targetRepRange: [number, number];
  /** Target reps in reserve for WORKING sets. */
  targetRir: number;
  /** Smallest load increment for this exercise (kg). Legacy single value. */
  minIncrementKg?: number;
  /** Phase D — available increment set; smallest entry drives the load step. */
  availableIncrementsKg?: number[];
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
  /**
   * Exercise modality. 'duration_based' bypasses the e1RM anchor entirely:
   * the seed comes from the duration policy off the previous-session set
   * (targetRepRange and prevReps carry SECONDS), anchorSource is
   * 'last_session' or 'none' — never 'e1rm'.
   */
  exerciseType?: ExerciseType;
  /** True for bodyweight exercises (duration policy: time-only progression). */
  isBodyweight?: boolean;
  /**
   * Phase A — this slot's 0-indexed position. With `plannedSetCount` and a
   * comparable `prevSessionSets`, a WORKING slot seeds from set-position
   * matching (what the same position did last session + smallest meaningful
   * progression) before consulting the e1RM anchor. Confirmed regression
   * still wins (two below-floor sessions step down regardless of position).
   */
  slotIndex?: number;
  /** Planned working-set count today (position-match comparability gate). */
  plannedSetCount?: number;
}

/** Which rule bound the e1RM working prescription (loud clamps, Phase 4). */
export type SeedClampBinder =
  | 'none'
  /** Raw curve pick fell below the ±band's floor. */
  | 'band_low'
  /** Raw curve pick exceeded the ±band's ceiling. */
  | 'band_high'
  /** All-sets bump gate: increase not earned → ceilinged at recent weight. */
  | 'bump_gate'
  /** Delta below max(2.5%, one increment) — noise, held at recent weight. */
  | 'noise_floor';

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
  /** True when a clamp/gate bound the e1RM prescription (say so in provenance). */
  clamped: boolean;
  /** WHICH rule bound it — provenance must name the actual binder. */
  clampBinder?: SeedClampBinder;
  /** The raw curve pick (kg) BEFORE any clamp/gate/rounding, for provenance. */
  preClampWeightKg?: number;
  engineVersion: number;
  /**
   * The specific rep target that comes WITH the seeded weight, when the seed
   * carries one: duration exercises (the time policy's seconds target) and
   * position-matched slots (the matched set's rep target). Absent → the reps
   * come from the e1RM curve at the seeded weight.
   */
  seedReps?: number;
  /** Present when anchorSource is 'position_match' — the matched set, for provenance. */
  positionMatch?: PositionMatchedTarget;
}

/**
 * Compute the working-set weight from the e1RM anchor for the middle of the rep
 * range, clamped to ±WORKING_WEIGHT_CLAMP_FRACTION of the best recent working
 * weight, gated by the all-sets bump rule, and floored by the
 * minimum-meaningful-change threshold. Returned separately so a ramp slot can
 * base its percentage on the same working weight the working slots would get.
 *
 * HOLD-VERBATIM RULE (Phase 3): whenever the outcome is "stay at the recent
 * working weight" — the bump gate bound, or the prescribed delta is below
 * max(MIN_MEANINGFUL_CHANGE_FRACTION, one increment) — the function returns
 * `recentWorkingWeightKg` EXACTLY, never re-rounded to the increment grid.
 * Re-rounding a held weight is how "hold 135 lb" (61.23 kg) became a phantom
 * "132.5 lb" (60 kg on the old 5-kg grid). Mirrors recommendSessionStart's
 * holdVerbatim. Only genuinely NEW prescriptions are rounded.
 */
function workingWeightFromAnchor(
  anchorE1RMKg: number,
  targetRepRange: [number, number],
  targetRir: number,
  inc: number,
  recentWorkingWeightKg?: number,
  bumpEarned?: boolean
): { weightKg: number; clamped: boolean; binder: SeedClampBinder; preClampKg: number } {
  const [repMin, repMax] = targetRepRange;
  const mid = Math.round((repMin + repMax) / 2);
  // anchorE1RMKg is a CANONICAL (capped) estimate — price within its domain
  // (see weightForRepsCappedAnchor). For ranges whose mid + RIR exceed the
  // cap this raises the pick to the eff-12 load; the downstream honest-reps
  // below-floor warning then surfaces the range-vs-anchor tension.
  const raw = weightForRepsCappedAnchor(anchorE1RMKg, mid, targetRir);

  let bounded = raw;
  let binder: SeedClampBinder = 'none';
  if (recentWorkingWeightKg && recentWorkingWeightKg > 0) {
    const recent = recentWorkingWeightKg;
    const lo = recent * (1 - WORKING_WEIGHT_CLAMP_FRACTION);
    const hi = recent * (1 + WORKING_WEIGHT_CLAMP_FRACTION);
    bounded = clamp(raw, lo, hi);
    if (bounded < raw) binder = 'band_high';
    else if (bounded > raw) binder = 'band_low';
    // All-sets bump gate: a hot e1RM (usually one strong top set) may not
    // prescribe ABOVE the recent working weight unless the whole previous
    // session earned it.
    if (bumpEarned === false && bounded > recent) {
      bounded = recent;
      binder = 'bump_gate';
    }

    // What the un-touched curve pick would have shown, for the "did anything
    // actually move" comparison — `clamped` is a claim about the SHOWN
    // number, not about which internal branch ran.
    const rawRounded = roundToIncrement(raw, inc);
    const rounded = roundToIncrement(bounded, inc);
    // Minimum meaningful change: a session-start delta below max(2.5%, one
    // increment) is noise (a 1.85% "adjustment" on a calf machine is not a
    // prescription) → hold the recent weight VERBATIM. This also covers the
    // bump-gate case (its delta is pure rounding), preserving e.g. 135 lb
    // exactly instead of snapping it to the kg grid.
    const threshold = Math.max(recent * MIN_MEANINGFUL_CHANGE_FRACTION, inc);
    const final = Math.abs(rounded - recent) < threshold ? recent : rounded;
    return {
      weightKg: final,
      clamped: final !== rawRounded,
      binder:
        binder === 'none' && final === recent && final !== rawRounded
          ? 'noise_floor'
          : binder,
      preClampKg: raw,
    };
  }

  return {
    weightKg: roundToIncrement(bounded, inc),
    clamped: false,
    binder: 'none',
    preClampKg: raw,
  };
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
  const inc = smallestIncrement(input.availableIncrementsKg, input.minIncrementKg);
  const [repMin, repMax] = input.targetRepRange;

  // ---- Duration exercise: no e1RM curve, no ramp %, seed from last session ----
  if (input.exerciseType === 'duration_based') {
    // Reference hold: the slot's own previous set, else the previous session's
    // top set (heaviest load, then longest hold).
    type DurationRef = { weightKg: number; reps: number; rir?: number };
    let ref: DurationRef | undefined =
      input.prevReps && input.prevReps > 0
        ? { weightKg: input.prevWeightKg ?? 0, reps: input.prevReps, rir: input.prevRir }
        : undefined;
    if (!ref && input.prevSessionSets && input.prevSessionSets.length > 0) {
      ref = input.prevSessionSets.reduce<DurationRef | undefined>((best, s) => {
        if (!(s.reps > 0)) return best;
        if (!best || s.weightKg > best.weightKg || (s.weightKg === best.weightKg && s.reps > best.reps)) {
          return { weightKg: s.weightKg, reps: s.reps, rir: s.rir };
        }
        return best;
      }, undefined);
    }
    if (ref) {
      const rec = recommendDurationSessionStart(
        {
          prevWeightKg: ref.weightKg,
          prevReps: ref.reps,
          prevRir: ref.rir,
          targetRepRange: input.targetRepRange,
          targetRir: input.targetRir,
          minIncrementKg: input.minIncrementKg,
        },
        !input.isBodyweight
      );
      return {
        weightKg: rec.weightKg,
        repRange: input.targetRepRange,
        rir: input.targetRir,
        role: 'working',
        showRirTarget: true,
        anchorSource: 'last_session',
        clamped: false,
        engineVersion: SUGGESTION_ENGINE_VERSION,
        // The policy's seconds target (+step / ceiling hold / floor reset) —
        // without this the card would fall back to the mid of the range and
        // session-start time progression would be silently ignored.
        seedReps: rec.reps,
      };
    }
    // No history to anchor a load on. For a loaded duration exercise this is a
    // LOUD skip: the range is shown but no weight is fabricated (there is no
    // capacity curve to estimate a carry load from). Bodyweight holds need no
    // load at all, so 'none' with weight 0 is their normal cold start.
    if (!input.isBodyweight) {
      console.warn(
        '[setRecommender] recommendSeedForSlot: duration exercise with no history — cannot prescribe a load; showing the time range only.'
      );
    }
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

  const hasAnchor = !!(input.anchorE1RMKg && input.anchorE1RMKg > 0);

  // All-sets bump gate (audit failure mode #5): with the previous session's
  // full set list available, a load increase over the recent working weight is
  // earned only when EVERY working set cleared the top of the range. Undefined
  // (no set list supplied) preserves legacy behavior.
  const bumpEarned =
    input.prevSessionSets && input.prevSessionSets.length > 0
      ? earnedSessionBump(
          input.prevSessionSets,
          input.targetRepRange,
          input.targetRir,
          // KNOWN increment only (never the 2.5 rounding default): the
          // light-load rep-ceiling extension applies only to a recorded
          // equipment step — smallest of the increment set when present.
          smallestKnownIncrement(input.availableIncrementsKg, input.minIncrementKg)
        )
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

  // ---- WORKING slot, set-position match (Phase A) ----
  // Before the anchor path: when last session is comparable, this slot's
  // target is what the SAME position did last time plus the smallest
  // meaningful progression. Confirmed regression (checked below via
  // regressionWeightKg, computed above) is stronger evidence and must win,
  // so the match only runs when no regression fired.
  if (
    input.role === 'working' &&
    regressionWeightKg <= 0 &&
    input.slotIndex !== undefined &&
    input.plannedSetCount !== undefined &&
    input.prevSessionSets &&
    input.prevSessionSets.length > 0
  ) {
    const pm = matchPositionTarget({
      position: input.slotIndex,
      prevSessionSets: input.prevSessionSets,
      // Session start: nothing performed yet, so comparability is decided by
      // set count and the positional set's role alone.
      todaySets: [],
      plannedSetCount: input.plannedSetCount,
      targetRepRange: input.targetRepRange,
      targetRir: input.targetRir,
      minIncrementKg: input.minIncrementKg,
      availableIncrementsKg: input.availableIncrementsKg,
    });
    if (pm) {
      return {
        weightKg: pm.weightKg,
        repRange: input.targetRepRange,
        rir: input.targetRir,
        role: 'working',
        showRirTarget: true,
        anchorSource: 'position_match',
        clamped: false,
        engineVersion: SUGGESTION_ENGINE_VERSION,
        seedReps: pm.reps,
        positionMatch: pm,
      };
    }
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
    // Loud clamp (no silent failures): when a rule actually MOVED the shown
    // prescription, log the pre-clamp value, the post-clamp value, and WHICH
    // rule fired. (A gate that "bound" without changing the rounded number is
    // not an event worth shouting about.)
    if (w.clamped && w.binder !== 'none' && w.binder !== 'noise_floor') {
      console.warn(
        `[setRecommender] seed clamp fired (${w.binder}): raw curve pick ` +
          `${w.preClampKg.toFixed(2)} kg from anchor ${input.anchorE1RMKg!.toFixed(1)} kg ` +
          `→ prescribed ${w.weightKg.toFixed(2)} kg (recent working ` +
          `${input.recentWorkingWeightKg?.toFixed(2) ?? '—'} kg)`
      );
    }
    return {
      weightKg: w.weightKg,
      repRange: input.targetRepRange,
      rir: input.targetRir,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'e1rm',
      clamped: w.clamped || workingClamped,
      clampBinder: w.binder,
      preClampWeightKg: w.preClampKg,
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
      availableIncrementsKg: input.availableIncrementsKg,
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
