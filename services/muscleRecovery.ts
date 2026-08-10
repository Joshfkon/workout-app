/**
 * muscleRecovery.ts — a PURE, transparent recovery heuristic for the in-workout
 * "which muscles should I hit today?" readiness sheet.
 *
 * This is a planning aid, not physiology. Given a muscle group, a flat list of
 * training sessions (past completed sessions AND the live in-progress session),
 * and an injected `now`, it answers: is this muscle Fresh, Recovering, or
 * Fatigued, how long since it was last worked, and roughly when it will be ready
 * again.
 *
 * Design rules (see the ticket):
 *  - No clock reads inside — ALL time math flows from the injected `now`.
 *  - No store / Supabase / React imports — this stays a pure function so it is
 *    trivially unit-testable and reusable on server or client.
 *  - Every tunable constant lives in the single `RECOVERY_CONFIG` object below
 *    so the heuristic can be re-tuned in one place.
 */

import {
  boundedComponentsOf,
  capacityOwnerFor,
  resolveMuscleToStandard,
  DEFAULT_VOLUME_LANDMARKS,
  type Experience,
  type StandardMuscleGroup,
  type SleepQuality,
} from '@/types/schema';
import { ENHANCED_RECOVERY_MULTIPLIER } from '@/services/shared/fatigueConstants';
import { composeGlobalRecoveryScale } from '@/services/wearableRecovery';
import { SECONDARY_MUSCLE_CREDIT } from '@/services/volumeTracker';
import { recordFrequencySource } from '@/services/plannedFrequency';

// ---------------------------------------------------------------------------
// Tunable heuristic constants — edit here to re-tune the whole model.
// ---------------------------------------------------------------------------

export interface RecoveryConfig {
  /** Base recovery window (hours) for a muscle with no per-muscle override. */
  defaultWindowHours: number;
  /**
   * Per-muscle window overrides — the large-group refinement over the flat v1
   * window. Values are deliberately TEMPERED versus the retired dashboard
   * card's 72h table: that model ignored intensity, so its windows did double
   * duty. Here the dose adjustments below already stretch a hard session
   * (+24h), so stacking them on 72h bases would tell a twice-a-week leg-day
   * user their quads are never Fresh.
   */
  windowHoursByMuscle: Partial<Record<StandardMuscleGroup, number>>;
  /** A set with RIR at/below this counts as "hard"/"maxed out". */
  hardRirThreshold: number;
  /** Secondary-muscle involvement contributes this fraction of a set's dose. */
  secondaryDoseFactor: number;
  /**
   * Experience level used to look up the capacity MRV that normalizes session
   * dose (see `sessionCapacityFor`). Live callers should pass the user's real
   * level; `EXPERIENCE_FALLBACK` is used when unavailable and is reported in
   * dose diagnostics so a silently-defaulted level is visible.
   */
  experienceForCapacity?: Experience;
  /**
   * PLANNED sessions per week per muscle, from the active program. Never
   * derive this from observed trailing-7-day sessions: observed frequency
   * rises as the week fills, which would re-interpret the SAME completed
   * session as a progressively lighter dose. Falls back to
   * DEFAULT_PLANNED_SESSIONS_PER_WEEK, reported in diagnostics.
   */
  plannedSessionsPerWeekByMuscle?: Partial<Record<StandardMuscleGroup, number>>;
  /** Program-wide planned frequency, used when no per-muscle value exists. */
  plannedSessionsPerWeek?: number;
  /**
   * Fraction of the window that separates Recovering from Fatigued. Past the
   * full window → Fresh; past this fraction → Recovering; under it → Fatigued.
   */
  recoveringThreshold: number;
  /**
   * Multiplier applied to every resolved window (base + dose adjustment).
   * 1 for natural athletes; Enhanced Athlete Mode passes < 1 so muscular
   * recovery windows shrink — see `recoveryConfigFor`.
   */
  windowScale: number;
  /**
   * Per-user, per-muscle LEARNED multiplier on that muscle's window, driven by
   * start-of-session soreness answers (user_muscle_recovery_multipliers table):
   * "still sore" when the model said Fresh/Recovering → +RECOVERY_MULTIPLIER_STEP;
   * "wasn't sore" when the model said Fatigued → −RECOVERY_MULTIPLIER_STEP.
   * Always clamped to RECOVERY_MULTIPLIER_BOUNDS. Muscles absent here use 1.
   * Applied on top of `windowScale` (the global athlete-profile scalar).
   */
  recoveryMultiplierByMuscle: Partial<Record<StandardMuscleGroup, number>>;
  /**
   * Global multiplier from recent SLEEP, applied to every muscle's window on
   * top of `windowScale` and the learned per-muscle multiplier. Resolve it
   * from logged sleep with `computeSleepWindowMultiplier` (trailing-2-night
   * average): short sleep stretches windows ×`sleepShortWindowMultiplier`,
   * long good-quality sleep shrinks them ×`sleepGoodWindowMultiplier`.
   * 1 when no recent sleep is logged.
   */
  sleepWindowMultiplier: number;
  /** Trailing-2-night average BELOW this (hours) reads as short sleep. */
  sleepShortAvgHours: number;
  /** Window multiplier for short sleep (modest, documented: +15%). */
  sleepShortWindowMultiplier: number;
  /** Trailing-2-night average AT/ABOVE this (hours) can read as good sleep… */
  sleepGoodAvgHours: number;
  /** …when every considered night's quality is 'good' (−5%). */
  sleepGoodWindowMultiplier: number;
  /** Only nights this many local days back count as "recent" sleep. */
  sleepLookbackDays: number;
}

/**
 * Hard bounds for the learned per-muscle recovery multiplier.
 *
 * Narrowed from 0.70–1.50. Stacked multiplicatively with the base window, the
 * dose adjustment and the global scalars, the old range produced degenerate
 * tails at both ends. Migration is CLAMP-ON-READ: `clampRecoveryMultiplier`
 * already runs both when loading rows and inside `windowForSession`, so a
 * persisted 1.50 is simply interpreted as 1.35 and the next learning step
 * writes an in-range value back. The database CHECK still permits 0.7–1.5 on
 * purpose — older clients may still write the old range.
 */
export const RECOVERY_MULTIPLIER_BOUNDS = { min: 0.85, max: 1.35 } as const;

/** Step applied per corrective soreness answer. */
export const RECOVERY_MULTIPLIER_STEP = 0.05;

/**
 * Final product guardrails on a resolved recovery window. These are a PRODUCT
 * floor and ceiling — "never tell a user a muscle needs less than a day or
 * more than five" — NOT evidence that the upstream model is calibrated. A
 * rising clamp rate is a signal to investigate the model, not to widen these.
 */
export const RECOVERY_WINDOW_BOUNDS_HOURS = { min: 24, max: 120 } as const;

/**
 * Planned per-muscle training frequency used to normalize session dose when
 * the active program does not supply one.
 */
export const DEFAULT_PLANNED_SESSIONS_PER_WEEK = 2;

/** Experience level assumed when a caller cannot supply the user's real one. */
export const EXPERIENCE_FALLBACK: Experience = 'intermediate';

export const RECOVERY_CONFIG: RecoveryConfig = {
  defaultWindowHours: 48,
  windowHoursByMuscle: {
    // Large groups — more tissue, slower to clear fatigue.
    quads: 60,
    // Hamstrings sit above the other large groups: high-force eccentric and
    // long-length work can leave strength impairments running 72–96h,
    // especially after unfamiliar or damaging sessions. This is a
    // CONSERVATIVE HEURISTIC BASE, not a measured universal duration — the
    // dose model below pulls it down after a light session and up after a
    // hard one. It also narrows the standing disagreement with
    // fatigueBudgetEngine, which already penalizes hamstring recovery through
    // its fast-twitch branch.
    hamstrings: 72,
    glutes: 60,
    lats: 60,
    upper_back: 60,
    // NOTE (deferred, deliberately unchanged): a single local window cannot
    // represent what loads the erectors — local muscular fatigue, axial
    // loading, connective-tissue fatigue and whole-body fatigue all land here.
    // Changing this number requires first deciding which of those the model is
    // meant to represent; see the unified-recovery work tracked separately.
    erectors: 60,
    // Traps sit with the other large upper-body groups, not on the 48h
    // default they used to fall through to. They are loaded the same way the
    // 60h groups are — heavy axial and pulling work (deadlift, RDL, rows,
    // carries) plus direct shrugging — and the app's own landmarks put the
    // group at the same capacity as upper_back (MRV 16 at intermediate). The
    // old default meant one pull session told a user their upper back needed
    // 60h and their traps 48h off the SAME sets. Components inherit the
    // group's window: `traps` is a partialRollup, so an upper-trap-only
    // window would have to claim the heads clear fatigue faster than the
    // group, which nothing here supports.
    traps: 60,
    upper_traps: 60,
    mid_lower_traps: 60,
    // Small/fast recoverers.
    biceps: 36,
    triceps: 36,
    triceps_long: 36,
    triceps_lat_med: 36,
    forearms: 36,
    calves: 36,
    gastrocnemius: 36,
    soleus: 36,
  },
  hardRirThreshold: 1,
  // The ONE secondary-credit coefficient (services/volumeTracker) — recovery
  // dose and volume counting must agree on what a secondary set is worth.
  secondaryDoseFactor: SECONDARY_MUSCLE_CREDIT,
  recoveringThreshold: 0.6,
  windowScale: 1,
  recoveryMultiplierByMuscle: {},
  sleepWindowMultiplier: 1,
  sleepShortAvgHours: 6,
  sleepShortWindowMultiplier: 1.15,
  sleepGoodAvgHours: 8,
  sleepGoodWindowMultiplier: 0.95,
  sleepLookbackDays: 2,
};

// ---------------------------------------------------------------------------
// Continuous dose adjustment
// ---------------------------------------------------------------------------

/**
 * The dose model replaces a step function that added a flat +24h whenever
 * effective sets hit 8 OR two sets landed at RIR <= 1. That was discontinuous
 * (7.9 sets and 8.0 sets differed by a full day) and fired on many ordinary
 * productive sessions.
 *
 * The replacement is continuous, bounded, and independently nondecreasing in
 * both inputs. Every breakpoint below is a HEURISTIC POLICY CHOICE, not a
 * measured physiological constant.
 */

/** Normalized total dose at/below which the set term contributes nothing. */
export const SET_LOAD_LOW = 0.15;
/** Normalized total dose at/above which the set term saturates. */
export const SET_LOAD_HIGH = 0.85;
/** Normalized hard dose at/below which the hard term contributes nothing. */
export const HARD_LOAD_LOW = 0.0;
/** Normalized hard dose at/above which the hard term saturates. */
export const HARD_LOAD_HIGH = 0.35;
/** Share of the load score driven by total volume. */
export const SET_WEIGHT = 0.6;
/** Share of the load score driven by proximity-to-failure volume. */
export const HARD_WEIGHT = 0.4;
/** Hours subtracted at zero load (a genuinely light session recovers faster). */
export const MIN_DOSE_ADJUSTMENT_HOURS = -12;
/** Hours added at saturated load. */
export const MAX_DOSE_ADJUSTMENT_HOURS = 24;

/** Hermite smoothstep, clamped outside [edge0, edge1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Everything the dose model saw and decided, for diagnostics and reports. */
export interface DoseDiagnostics {
  muscle: StandardMuscleGroup;
  /** The row whose MRV normalized the dose (parent for bounded components). */
  capacityMuscle: StandardMuscleGroup;
  experience: Experience;
  experienceSource: 'config' | 'fallback';
  plannedSessionsPerWeek: number;
  plannedFrequencySource: 'perMuscle' | 'program' | 'fallback';
  capacityMrv: number;
  sessionCapacity: number;
  effectiveSets: number;
  effectiveHardSets: number;
  totalDoseRatio: number;
  hardDoseRatio: number;
  adjustmentHours: number;
}

/**
 * Session capacity: the muscle's DIRECT-SET MRV at the user's experience level,
 * divided by planned weekly frequency.
 *
 * ACKNOWLEDGED UNIT MISMATCH — `effectiveSets` includes secondary credit at
 * SECONDARY_MUSCLE_CREDIT/set, while `capacityMrv` comes from the direct-set
 * landmark system (`referenceDirectMRV`). The ratio is therefore a HEURISTIC
 * NORMALIZER that puts dose on a per-muscle scale — it is not a like-for-like
 * physiological quantity, and the two numbers are not in the same currency.
 * The inclusive coarse band is deliberately NOT used instead: it is
 * experience-independent, and this model needs experience sensitivity.
 *
 * Bounded component rows (gastrocnemius, soleus, triceps heads, trap regions)
 * normalize against their PARENT's MRV via `capacityOwnerFor` — their own
 * landmark triples are non-additive compatibility subtargets and must never
 * serve as a capacity denominator.
 */
export function sessionCapacityFor(
  muscle: StandardMuscleGroup,
  config: RecoveryConfig
): {
  capacityMuscle: StandardMuscleGroup;
  experience: Experience;
  experienceSource: 'config' | 'fallback';
  plannedSessionsPerWeek: number;
  plannedFrequencySource: 'perMuscle' | 'program' | 'fallback';
  capacityMrv: number;
  sessionCapacity: number;
} {
  const experience = config.experienceForCapacity ?? EXPERIENCE_FALLBACK;
  const experienceSource: 'config' | 'fallback' = config.experienceForCapacity
    ? 'config'
    : 'fallback';

  const capacityMuscle = capacityOwnerFor(muscle);
  const capacityMrv = DEFAULT_VOLUME_LANDMARKS[experience][capacityMuscle].mrv;

  const perMuscle = config.plannedSessionsPerWeekByMuscle?.[muscle];
  let plannedSessionsPerWeek: number;
  let plannedFrequencySource: 'perMuscle' | 'program' | 'fallback';
  if (typeof perMuscle === 'number' && Number.isFinite(perMuscle) && perMuscle >= 1) {
    plannedSessionsPerWeek = perMuscle;
    plannedFrequencySource = 'perMuscle';
  } else if (
    typeof config.plannedSessionsPerWeek === 'number' &&
    Number.isFinite(config.plannedSessionsPerWeek) &&
    config.plannedSessionsPerWeek >= 1
  ) {
    plannedSessionsPerWeek = config.plannedSessionsPerWeek;
    plannedFrequencySource = 'program';
  } else {
    plannedSessionsPerWeek = DEFAULT_PLANNED_SESSIONS_PER_WEEK;
    plannedFrequencySource = 'fallback';
  }
  // Observability: lets production answer "what share of recovery windows run
  // on the fallback?" — the question that decides whether the fallback is a
  // deliberate policy or an unnoticed gap.
  recordFrequencySource(plannedFrequencySource);

  // Precondition: sessionCapacity > 0. capacityMrv is > 0 for every row in the
  // landmark table and frequency is >= 1, so the guard is belt-and-braces
  // against a future zero-MRV row rather than a reachable state today.
  const sessionCapacity = Math.max(
    Number.EPSILON,
    capacityMrv / Math.max(plannedSessionsPerWeek, 1)
  );

  return {
    capacityMuscle,
    experience,
    experienceSource,
    plannedSessionsPerWeek,
    plannedFrequencySource,
    capacityMrv,
    sessionCapacity,
  };
}

/**
 * Continuous, bounded dose adjustment in hours, nondecreasing in BOTH inputs.
 *
 * Feedback note: higher planned frequency shrinks session capacity, so the
 * same session reads as a larger relative dose and earns a longer window.
 * That is directionally negative feedback, but stability is NOT established —
 * see the frequency-sensitivity report before leaning on it.
 */
export function computeDoseAdjustmentHours(
  muscle: StandardMuscleGroup,
  effectiveSets: number,
  effectiveHardSets: number,
  config: RecoveryConfig
): DoseDiagnostics {
  if (!(effectiveSets >= 0)) {
    throw new Error(`[recovery] effectiveSets must be >= 0, got ${effectiveSets}`);
  }
  if (!(effectiveHardSets >= 0) || effectiveHardSets > effectiveSets + 1e-9) {
    throw new Error(
      `[recovery] require 0 <= effectiveHardSets <= effectiveSets, got ` +
        `${effectiveHardSets} / ${effectiveSets}`
    );
  }

  const capacity = sessionCapacityFor(muscle, config);
  const totalDoseRatio = effectiveSets / capacity.sessionCapacity;
  const hardDoseRatio = effectiveHardSets / capacity.sessionCapacity;

  const setLoad = smoothstep(SET_LOAD_LOW, SET_LOAD_HIGH, totalDoseRatio);
  const hardLoad = smoothstep(HARD_LOAD_LOW, HARD_LOAD_HIGH, hardDoseRatio);
  const loadScore = SET_WEIGHT * setLoad + HARD_WEIGHT * hardLoad;
  const adjustmentHours = lerp(
    MIN_DOSE_ADJUSTMENT_HOURS,
    MAX_DOSE_ADJUSTMENT_HOURS,
    loadScore
  );

  return {
    muscle,
    ...capacity,
    effectiveSets,
    effectiveHardSets,
    totalDoseRatio,
    hardDoseRatio,
    adjustmentHours,
  };
}

/**
 * The config for a given athlete profile. Enhanced athletes dissipate muscular
 * fatigue faster, so every recovery window shrinks by the shared multiplier
 * (~22.5% faster) — the same constant the fatigue model uses, and the same
 * scaling the retired dashboard recovery card applied.
 *
 * `wearableRecoveryScale` is the HRV/RHR global modifier from
 * services/wearableRecovery.ts (bounded 0.95–1.15, neutral 1). It composes
 * multiplicatively with the athlete-profile scalar; the combined global
 * effect is clamped by composeGlobalRecoveryScale (×1.25 cap). Per-muscle
 * learned multipliers stay independent with their own bounds.
 */
export interface RecoveryCapacityContext {
  /** The user's real experience level. Omit only when genuinely unavailable. */
  experienceForCapacity?: Experience;
  /** PLANNED per-muscle weekly frequency from the active program. */
  plannedSessionsPerWeekByMuscle?: Partial<Record<StandardMuscleGroup, number>>;
  /** PLANNED program-wide weekly frequency, used when no per-muscle value. */
  plannedSessionsPerWeek?: number;
}

export function recoveryConfigFor(
  enhancedAthleteMode: boolean,
  recoveryMultiplierByMuscle?: Partial<Record<StandardMuscleGroup, number>>,
  sleepWindowMultiplier?: number,
  wearableRecoveryScale?: number,
  capacity?: RecoveryCapacityContext
): RecoveryConfig {
  const baseScale = enhancedAthleteMode ? 1 / ENHANCED_RECOVERY_MULTIPLIER : 1;
  const windowScale = composeGlobalRecoveryScale(baseScale, wearableRecoveryScale ?? 1);
  let config =
    windowScale === RECOVERY_CONFIG.windowScale
      ? RECOVERY_CONFIG
      : { ...RECOVERY_CONFIG, windowScale };
  if (recoveryMultiplierByMuscle && Object.keys(recoveryMultiplierByMuscle).length > 0) {
    config = { ...config, recoveryMultiplierByMuscle };
  }
  if (sleepWindowMultiplier !== undefined && sleepWindowMultiplier !== config.sleepWindowMultiplier) {
    config = { ...config, sleepWindowMultiplier };
  }
  if (capacity?.experienceForCapacity) {
    config = { ...config, experienceForCapacity: capacity.experienceForCapacity };
  }
  if (capacity?.plannedSessionsPerWeekByMuscle) {
    config = {
      ...config,
      plannedSessionsPerWeekByMuscle: capacity.plannedSessionsPerWeekByMuscle,
    };
  }
  if (capacity?.plannedSessionsPerWeek !== undefined) {
    config = { ...config, plannedSessionsPerWeek: capacity.plannedSessionsPerWeek };
  }
  return config;
}

// ---------------------------------------------------------------------------
// Sleep adjustment
// ---------------------------------------------------------------------------

/** One logged night, as read from sleep_log. */
export interface SleepNight {
  /** YYYY-MM-DD local day the night was logged against. */
  localDay: string;
  hours: number;
  quality: SleepQuality;
}

/** YYYY-MM-DD for a Date in LOCAL time (matches lib/utils.getLocalDateString). */
function localDayString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolve the global sleep window multiplier from recent logged nights
 * (trailing-2-night average, per the ticket's documented constants):
 *  - average < sleepShortAvgHours (6h)            → ×1.15 (windows stretch)
 *  - average ≥ sleepGoodAvgHours (8h), all 'good' → ×0.95 (windows shrink)
 *  - anything else, or no night logged within sleepLookbackDays → ×1
 *
 * Pure: `now` is injected like everywhere else in this module. Only nights
 * within the lookback window count, so a stale entry from last month can
 * never masquerade as "last night".
 */
export function computeSleepWindowMultiplier(
  nights: SleepNight[],
  now: Date,
  config: RecoveryConfig = RECOVERY_CONFIG
): number {
  const cutoff = localDayString(
    new Date(now.getTime() - config.sleepLookbackDays * 24 * MS_PER_HOUR)
  );
  const today = localDayString(now);
  const recent = nights
    .filter(
      (n) =>
        n.localDay >= cutoff &&
        n.localDay <= today &&
        Number.isFinite(n.hours) &&
        n.hours >= 0
    )
    .sort((a, b) => b.localDay.localeCompare(a.localDay))
    .slice(0, 2);

  if (recent.length === 0) return 1;

  const avg = recent.reduce((sum, n) => sum + n.hours, 0) / recent.length;
  if (avg < config.sleepShortAvgHours) return config.sleepShortWindowMultiplier;
  if (avg >= config.sleepGoodAvgHours && recent.every((n) => n.quality === 'good')) {
    return config.sleepGoodWindowMultiplier;
  }
  return 1;
}

/** Clamp a learned multiplier into its hard bounds. */
export function clampRecoveryMultiplier(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(
    RECOVERY_MULTIPLIER_BOUNDS.max,
    Math.max(RECOVERY_MULTIPLIER_BOUNDS.min, value)
  );
}

/**
 * The subjective soreness report from the start-of-session chip row, reduced
 * to the three options the user actually sees.
 */
export type SorenessReport = 'none' | 'recovered' | 'still_sore';

/**
 * Learning update for the per-muscle recovery multiplier.
 *
 * Only DISAGREEMENT between the user's report and what the model believed at
 * ask time moves the multiplier:
 *  - "still sore" while the model said Fresh or Recovering → the window was
 *    too short → +RECOVERY_MULTIPLIER_STEP
 *  - "wasn't sore" while the model said Fatigued → the window was too long
 *    → −RECOVERY_MULTIPLIER_STEP
 * Agreement (or the ambiguous "sore, recovered") leaves it unchanged. The
 * result is always inside RECOVERY_MULTIPLIER_BOUNDS regardless of input.
 */
export function adjustRecoveryMultiplier(
  current: number,
  report: SorenessReport,
  statusAtAsk: RecoveryStatus
): number {
  const base = clampRecoveryMultiplier(current);
  if (report === 'still_sore' && (statusAtAsk === 'fresh' || statusAtAsk === 'recovering')) {
    return clampRecoveryMultiplier(base + RECOVERY_MULTIPLIER_STEP);
  }
  if (report === 'none' && statusAtAsk === 'fatigued') {
    return clampRecoveryMultiplier(base - RECOVERY_MULTIPLIER_STEP);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export type RecoveryStatus = 'fresh' | 'recovering' | 'fatigued';

/** One working set. `repsInTank` is the logged RIR, or null when unrated. */
export interface RecoverySet {
  repsInTank: number | null;
}

/** One logged exercise within a session (warmups already excluded). */
export interface RecoveryExercise {
  primaryMuscle: string | null;
  secondaryMuscles: string[];
  sets: RecoverySet[];
}

/**
 * One training session. For completed sessions pass `completed_at`. For the
 * LIVE in-progress session pass `now`, so its sets count as "just trained" and
 * immediately drive the muscle to Fatigued.
 */
export interface RecoverySession {
  performedAt: Date;
  exercises: RecoveryExercise[];
}

export interface MuscleRecoveryResult {
  status: RecoveryStatus;
  /** Hours since the muscle was last worked, or null if never worked. */
  hoursSinceLast: number | null;
  /** When the muscle is estimated to be Fresh again, or null if never worked. */
  estimatedReadyAt: Date | null;
  /** When the muscle was last worked, or null if never worked. */
  lastTrainedAt: Date | null;
  /** Hours until Fresh (0 when already Fresh). */
  hoursUntilReady: number;
  /** The recovery window (hours) applied to the last session, or null. */
  windowHours: number | null;
  /** Effective set dose of the most recent session that hit this muscle. */
  dose: number;
  /**
   * Full derivation of `windowHours` — base window, dose diagnostics, every
   * modifier, the pre-clamp value and which guardrail bit. Null when the
   * muscle was never worked in the supplied history. Read this (never
   * recompute) when reporting or debugging a window.
   */
  breakdown: WindowBreakdown | null;
}

// ---------------------------------------------------------------------------
// Core heuristic
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 1000 * 60 * 60;

/** Per-session involvement of a single muscle. */
interface SessionInvolvement {
  performedAt: Date;
  /** Effective dose (primary sets + 0.5× secondary sets). */
  dose: number;
  /** Effective count of hard/maxed sets, weighted by involvement. */
  hardSets: number;
}

/**
 * How much a single exercise involves `muscle`: 1 if primary, the secondary
 * factor if only secondary, 0 if uninvolved. A legacy coarse tag ("chest",
 * "shoulders") resolves to every standard muscle it covers.
 *
 * FAMILY FLOW (groupCapacity row ↔ its bounded components — traps/upper_traps/
 * mid_lower_traps, calves/gastrocnemius/soleus, triceps/triceps_long/
 * triceps_lat_med). `resolveMuscleToStandard` is standard-first ON PURPOSE, so
 * a coarse 'traps' tag credits ONLY the `traps` row and a 'upper_traps' tag
 * only that head. That is right for VOLUME (see volumeCredit — a coarse tag
 * must not smear across heads it cannot name), but it is wrong for RECOVERY:
 * fatigue does not partition by which token the exercise happened to be tagged
 * with. With ~27 coarse 'traps' tags in the library against 5 'upper_traps'
 * ones, a heavy deadlift day left BOTH trap heads reading "never trained →
 * Fresh" while the user's traps were plainly sore.
 *
 * So involvement flows along the parent/child edge, never between siblings:
 *  - a component-tagged set (shrug → upper_traps) is unambiguous work on the
 *    GROUP, so the parent row takes it at full strength;
 *  - a group-tagged set (deadlift → traps) cannot say WHICH component it hit,
 *    so each component takes it at one further `secondaryDoseFactor` discount.
 * Siblings stay independent — credit aggregation across this family is
 * disjoint (MUSCLE_VOLUME_AUTHORITY), so shrugs must never fatigue the
 * mid/lower traps.
 */
function involvementFactor(
  exercise: RecoveryExercise,
  muscle: StandardMuscleGroup,
  config: RecoveryConfig
): number {
  const primaryStandards = exercise.primaryMuscle
    ? resolveMuscleToStandard(exercise.primaryMuscle)
    : [];
  const secondaryStandards = exercise.secondaryMuscles.flatMap((m) =>
    resolveMuscleToStandard(m)
  );

  // Direct tag on this exact row.
  if (primaryStandards.includes(muscle)) return 1;

  // Child → parent: work on any component is work on the group.
  const components = boundedComponentsOf(muscle);
  if (components.some((c) => primaryStandards.includes(c))) return 1;

  if (secondaryStandards.includes(muscle)) return config.secondaryDoseFactor;
  if (components.some((c) => secondaryStandards.includes(c))) {
    return config.secondaryDoseFactor;
  }

  // Parent → child: the group tag names no component, so it lands indirectly.
  const parent = capacityOwnerFor(muscle);
  if (parent !== muscle) {
    if (primaryStandards.includes(parent)) return config.secondaryDoseFactor;
    if (secondaryStandards.includes(parent)) {
      return config.secondaryDoseFactor * config.secondaryDoseFactor;
    }
  }

  return 0;
}

/** Aggregate a session's dose + hard-set count toward one muscle. */
function sessionInvolvement(
  session: RecoverySession,
  muscle: StandardMuscleGroup,
  config: RecoveryConfig
): SessionInvolvement | null {
  let dose = 0;
  let hardSets = 0;

  for (const exercise of session.exercises) {
    const factor = involvementFactor(exercise, muscle, config);
    if (factor === 0) continue;

    dose += exercise.sets.length * factor;
    const hard = exercise.sets.filter(
      (s) => s.repsInTank !== null && s.repsInTank <= config.hardRirThreshold
    ).length;
    hardSets += hard * factor;
  }

  if (dose <= 0) return null;
  return { performedAt: session.performedAt, dose, hardSets };
}

/** Full derivation of one muscle's recovery window, pre- and post-clamp. */
export interface WindowBreakdown {
  muscle: StandardMuscleGroup;
  /** Per-muscle base window before any modifier. */
  baseWindowHours: number;
  /** Continuous dose adjustment (hours) and everything that produced it. */
  dose: DoseDiagnostics;
  /** Athlete-profile scalar (enhanced shrinks windows), incl. wearable. */
  windowScale: number;
  /** Sleep scalar. */
  sleepWindowMultiplier: number;
  /** Composed + capped global scalar actually applied. */
  globalScale: number;
  /** Learned per-muscle multiplier after clamping to the new bounds. */
  learnedMultiplier: number;
  /** Window BEFORE the 24–120h product guardrail. */
  preClampHours: number;
  /** Window after the guardrail — what the user sees. */
  windowHours: number;
  /** Which guardrail bit, if any. */
  clamp: 'none' | 'lower' | 'upper';
}

/**
 * Resolve the recovery window (hours) for a muscle given its last dose,
 * returning the full derivation so a clamp is never silent.
 */
export function windowBreakdownForSession(
  muscle: StandardMuscleGroup,
  involvement: SessionInvolvement,
  config: RecoveryConfig
): WindowBreakdown {
  const baseWindowHours = config.windowHoursByMuscle[muscle] ?? config.defaultWindowHours;

  const dose = computeDoseAdjustmentHours(
    muscle,
    involvement.dose,
    involvement.hardSets,
    config
  );

  // Learned per-muscle multiplier (soreness feedback), clamped defensively so
  // an out-of-range persisted value can never distort the window. This is
  // ALSO the migration path for the narrowed 0.85–1.35 bounds.
  const learnedMultiplier = clampRecoveryMultiplier(
    config.recoveryMultiplierByMuscle[muscle] ?? 1
  );

  // Global scalars compose multiplicatively — athlete profile × wearable
  // (already folded into windowScale) × sleep — with the combined global
  // effect clamped (×1.25 cap) so stacked bad signals whisper, never shout.
  // The learned multiplier stays OUTSIDE that cap on purpose: environmental
  // modifiers must not consume the whole range and suppress personalization.
  const globalScale = composeGlobalRecoveryScale(
    config.windowScale,
    config.sleepWindowMultiplier
  );

  const preClampHours =
    (baseWindowHours + dose.adjustmentHours) * globalScale * learnedMultiplier;

  const windowHours = Math.min(
    RECOVERY_WINDOW_BOUNDS_HOURS.max,
    Math.max(RECOVERY_WINDOW_BOUNDS_HOURS.min, preClampHours)
  );

  const clamp: 'none' | 'lower' | 'upper' =
    preClampHours < RECOVERY_WINDOW_BOUNDS_HOURS.min
      ? 'lower'
      : preClampHours > RECOVERY_WINDOW_BOUNDS_HOURS.max
        ? 'upper'
        : 'none';

  return {
    muscle,
    baseWindowHours,
    dose,
    windowScale: config.windowScale,
    sleepWindowMultiplier: config.sleepWindowMultiplier,
    globalScale,
    learnedMultiplier,
    preClampHours,
    windowHours,
    clamp,
  };
}

/**
 * Compute the recovery status of a single muscle group from a list of sessions.
 * Sessions may be in any order; the most recent one that involves the muscle
 * drives the result.
 */
export function computeMuscleRecovery(
  history: RecoverySession[],
  muscle: StandardMuscleGroup,
  now: Date,
  config: RecoveryConfig = RECOVERY_CONFIG
): MuscleRecoveryResult {
  // Find the most recent session that actually worked this muscle.
  let last: SessionInvolvement | null = null;
  for (const session of history) {
    const involvement = sessionInvolvement(session, muscle, config);
    if (!involvement) continue;
    if (!last || involvement.performedAt.getTime() > last.performedAt.getTime()) {
      last = involvement;
    }
  }

  if (!last) {
    // Never worked (in the supplied window) → treat as fully Fresh.
    return {
      status: 'fresh',
      hoursSinceLast: null,
      estimatedReadyAt: null,
      lastTrainedAt: null,
      hoursUntilReady: 0,
      windowHours: null,
      dose: 0,
      breakdown: null,
    };
  }

  const breakdown = windowBreakdownForSession(muscle, last, config);
  const windowHours = breakdown.windowHours;
  if (breakdown.clamp !== 'none') recordRecoveryClamp(breakdown);
  const hoursSinceLast = (now.getTime() - last.performedAt.getTime()) / MS_PER_HOUR;
  const estimatedReadyAt = new Date(last.performedAt.getTime() + windowHours * MS_PER_HOUR);
  const hoursUntilReady = Math.max(0, windowHours - hoursSinceLast);

  let status: RecoveryStatus;
  if (hoursSinceLast >= windowHours) {
    status = 'fresh';
  } else if (hoursSinceLast >= config.recoveringThreshold * windowHours) {
    status = 'recovering';
  } else {
    status = 'fatigued';
  }

  return {
    status,
    hoursSinceLast,
    estimatedReadyAt,
    lastTrainedAt: last.performedAt,
    hoursUntilReady,
    windowHours,
    dose: last.dose,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Clamp observability
// ---------------------------------------------------------------------------

/**
 * Every clamp event seen since the last reset, with the FULL derivation
 * attached — muscle, pre-clamp value, final value, base window, dose
 * adjustment, enhanced/sleep/wearable scalars, learned multiplier and clamp
 * direction. A guardrail that fires silently is indistinguishable from a model
 * that is working, which is exactly the failure mode this exists to prevent.
 *
 * Bounded so a long-lived client session cannot grow it without limit.
 */
const MAX_RETAINED_CLAMP_EVENTS = 200;
const recoveryClampEvents: WindowBreakdown[] = [];

function recordRecoveryClamp(breakdown: WindowBreakdown): void {
  recoveryClampEvents.push(breakdown);
  if (recoveryClampEvents.length > MAX_RETAINED_CLAMP_EVENTS) recoveryClampEvents.shift();
}

/** Observed clamp events (most recent last). */
export function getRecoveryClampEvents(): readonly WindowBreakdown[] {
  return recoveryClampEvents;
}

/** Clear retained clamp events (tests, and any per-session reset). */
export function resetRecoveryClampEvents(): void {
  recoveryClampEvents.length = 0;
}

export interface ClampMetrics {
  total: number;
  lower: number;
  upper: number;
  lowerRate: number;
  upperRate: number;
  byMuscle: Record<string, { lower: number; upper: number }>;
  byProfile: { natural: { lower: number; upper: number }; enhanced: { lower: number; upper: number } };
}

/**
 * Summarize clamp behaviour over a set of breakdowns. `total` is the number of
 * evaluated cases, so the rates are meaningful; pass every case, not just the
 * clamped ones.
 *
 * Enhanced is inferred from windowScale < 1 (the athlete-profile scalar is the
 * only thing that pushes it below 1).
 */
export function summarizeClamps(breakdowns: readonly WindowBreakdown[]): ClampMetrics {
  const byMuscle: Record<string, { lower: number; upper: number }> = {};
  const byProfile = {
    natural: { lower: 0, upper: 0 },
    enhanced: { lower: 0, upper: 0 },
  };
  let lower = 0;
  let upper = 0;

  for (const b of breakdowns) {
    if (b.clamp === 'none') continue;
    const bucket = (byMuscle[b.muscle] ??= { lower: 0, upper: 0 });
    const profile = b.windowScale < 1 ? byProfile.enhanced : byProfile.natural;
    if (b.clamp === 'lower') {
      lower++;
      bucket.lower++;
      profile.lower++;
    } else {
      upper++;
      bucket.upper++;
      profile.upper++;
    }
  }

  const total = breakdowns.length;
  return {
    total,
    lower,
    upper,
    lowerRate: total > 0 ? lower / total : 0,
    upperRate: total > 0 ? upper / total : 0,
    byMuscle,
    byProfile,
  };
}
