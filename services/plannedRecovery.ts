/**
 * plannedRecovery — generation-time recovery gating, served by the ONE
 * recovery model (#634).
 *
 * Mesocycle generation used to run on its own points-based fatigue system
 * (fatigueBudgetEngine.WeeklyFatigueTracker): its own accumulation constants,
 * its own decay rate, its own thresholds — none of which agreed with the
 * readiness model users actually see. This adapter replaces it without
 * becoming a third engine: it keeps a VIRTUAL history of the planned week's
 * sessions and asks `computeMuscleRecovery` / `computeStabilizerRecovery` —
 * the production models — what each muscle's readiness would be on each
 * planned day. The only logic that lives here is planning POLICY: how a
 * readiness ratio maps to skip/trim decisions, and how a coarse session
 * target ('back', 'shoulders') aggregates its standard muscles.
 *
 * PURE: no clock reads — planned days are offsets from a fixed virtual epoch,
 * so the same inputs always produce the same plan. Enhanced Athlete Mode
 * reaches the mover windows through `recoveryConfigFor` exactly as it does
 * live; the stabilizer channel ignores it inside the model (safety
 * invariant), so stabilizer-aware planning stays at natural-athlete timing.
 */

import {
  computeMuscleRecovery,
  computeStabilizerRecovery,
  recoveryConfigFor,
  stabilizerTrackedMuscles,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoveryExercise,
  type RecoverySession,
  type RecoveryStatus,
} from './muscleRecovery';
import {
  resolveMuscleToStandard,
  type Experience,
  type StandardMuscleGroup,
} from '@/types/schema';
import { stabilizersForExerciseName } from './shared/stabilizerTags';
import { plannedSessionWeightedHardSets } from './volumeTracker';

// ---------------------------------------------------------------------------
// Planning policy constants (generation-time; the model itself lives in
// services/muscleRecovery)
// ---------------------------------------------------------------------------

/**
 * Below this readiness ratio a session target is skipped outright — the
 * successor to the old tracker's "fatigue > 50 → skip" rule, now stated in
 * the model's own currency.
 */
export const PLANNED_SKIP_READINESS = 0.35;

/**
 * Below this readiness ratio (and at/above the skip line) the session's set
 * count for the muscle is scaled down — the successor to the old
 * "fatigue > 25 → proportional trim".
 */
export const PLANNED_TRIM_READINESS = 0.75;

/** The trim never removes more than half the planned sets. */
export const PLANNED_TRIM_FLOOR = 0.5;

/**
 * Set-count multiplier for a readiness ratio: 0 below the skip line, a
 * linear ramp from PLANNED_TRIM_FLOOR at the skip line up to 1 at the trim
 * line, and 1 above it.
 */
export function plannedSetScale(readinessRatio: number): number {
  if (readinessRatio >= PLANNED_TRIM_READINESS) return 1;
  if (readinessRatio < PLANNED_SKIP_READINESS) return 0;
  const span = PLANNED_TRIM_READINESS - PLANNED_SKIP_READINESS;
  return (
    PLANNED_TRIM_FLOOR +
    ((1 - PLANNED_TRIM_FLOOR) * (readinessRatio - PLANNED_SKIP_READINESS)) / span
  );
}

// ---------------------------------------------------------------------------
// Virtual clock
// ---------------------------------------------------------------------------

/**
 * Fixed virtual epoch (a Monday, 17:00 UTC — a typical session hour). Planned
 * day N trains at epoch + N days; readiness for day N is evaluated at that
 * same hour, so consecutive planned days are exactly 24h apart. All model
 * math is epoch-milliseconds arithmetic (no local-day reads), so this is
 * deterministic everywhere.
 */
const VIRTUAL_EPOCH_MS = Date.UTC(2001, 0, 1, 17, 0, 0);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateForDay(day: number): Date {
  return new Date(VIRTUAL_EPOCH_MS + day * MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** What the planner records about one planned exercise. */
export interface PlannedExercise {
  primaryMuscle: string;
  secondaryMuscles: string[];
  stabilizers?: string[];
  sets: number;
  targetRir: number;
  /**
   * Exercise name, used ONLY to look up stock stabilizer tags
   * (services/shared/stabilizerTags) when `stabilizers` is absent — generated
   * program entries don't always carry the column. Never used for matching
   * or display here.
   */
  name?: string;
}

export interface PlannedWeekRecoveryInput {
  enhancedAthleteMode?: boolean;
  experience?: Experience;
  /**
   * Profile sleep rating (1–5). Mapped onto the model's sleep window
   * multiplier the way logged nights would be: chronic short sleep (≤2)
   * stretches windows, excellent sleep (5) shrinks them slightly. This is
   * the successor to the old tracker's sleep-scaled recovery rate.
   */
  sleepQuality?: number;
  /**
   * PLANNED weekly frequency per standard muscle (the dose-normalization
   * denominator — see sessionCapacityFor). Derive from the program's
   * volume distribution; absent muscles use the model default.
   */
  plannedSessionsPerWeekByMuscle?: Partial<Record<StandardMuscleGroup, number>>;
}

export interface PlannedMuscleReadiness {
  /** Aggregate readiness for the session target (mean across standards). */
  readinessRatio: number;
  /** Status band of the aggregate ratio. */
  status: RecoveryStatus;
  /** Per-standard-muscle detail behind the aggregate. */
  byStandard: Partial<Record<StandardMuscleGroup, number>>;
}

export class PlannedWeekRecovery {
  private readonly config: RecoveryConfig;
  private readonly exercisesByDay = new Map<number, RecoveryExercise[]>();

  constructor(input: PlannedWeekRecoveryInput = {}) {
    const sleepWindowMultiplier =
      input.sleepQuality === undefined
        ? 1
        : input.sleepQuality <= 2
          ? RECOVERY_CONFIG.sleepShortWindowMultiplier
          : input.sleepQuality >= 5
            ? RECOVERY_CONFIG.sleepGoodWindowMultiplier
            : 1;

    this.config = recoveryConfigFor(
      input.enhancedAthleteMode ?? false,
      undefined,
      sleepWindowMultiplier,
      undefined,
      {
        experienceForCapacity: input.experience,
        plannedSessionsPerWeekByMuscle: input.plannedSessionsPerWeekByMuscle,
      }
    );
  }

  /** Record one planned exercise on a planned day (0-based day offset). */
  record(day: number, exercise: PlannedExercise): void {
    const list = this.exercisesByDay.get(day) ?? [];
    list.push({
      primaryMuscle: exercise.primaryMuscle,
      secondaryMuscles: exercise.secondaryMuscles,
      stabilizers: exercise.stabilizers,
      sets: Array.from({ length: Math.max(0, exercise.sets) }, () => ({
        repsInTank: Math.max(0, Math.min(4, Math.round(exercise.targetRir))),
      })),
    });
    this.exercisesByDay.set(day, list);
  }

  /**
   * Virtual history visible on `day`: every planned session from EARLIER
   * days. The day's own session is excluded — recovery debt starts when a
   * session completes (the model's completed-sessions-only rule); within-day
   * budgeting belongs to SessionFatigueManager.
   */
  private historyBefore(day: number): RecoverySession[] {
    const sessions: RecoverySession[] = [];
    for (const [sessionDay, exercises] of Array.from(this.exercisesByDay.entries())) {
      if (sessionDay >= day) continue;
      sessions.push({ performedAt: dateForDay(sessionDay), exercises });
    }
    return sessions;
  }

  /**
   * Readiness of a session target on a planned day. A coarse target
   * ('back', 'shoulders') resolves to several standard muscles; the
   * aggregate is the MEAN of their ratios — one fatigued head must not veto
   * a session that mostly trains the group's other heads (the generator
   * still trims through the aggregate, and exercise selection sees the
   * per-head detail via `byStandard`). Unknown tokens read as fresh, the
   * old tracker's behavior for unmapped muscles.
   */
  readiness(muscleToken: string, day: number): PlannedMuscleReadiness {
    const standards = resolveMuscleToStandard(muscleToken);
    if (standards.length === 0) {
      return { readinessRatio: 1, status: 'fresh', byStandard: {} };
    }

    const history = this.historyBefore(day);
    const now = dateForDay(day);
    const byStandard: Partial<Record<StandardMuscleGroup, number>> = {};
    let sum = 0;
    for (const muscle of standards) {
      const ratio = computeMuscleRecovery(history, muscle, now, this.config).readinessRatio;
      byStandard[muscle] = ratio;
      sum += ratio;
    }
    const readinessRatio = sum / standards.length;
    const status: RecoveryStatus =
      readinessRatio >= 1
        ? 'fresh'
        : readinessRatio >= this.config.recoveringThreshold
          ? 'recovering'
          : 'fatigued';
    return { readinessRatio, status, byStandard };
  }

  /**
   * Stabilizer-tracked muscles whose STABILIZER channel is under the warning
   * threshold on a planned day. Exercise selection uses this to deprioritize
   * candidates that require a run-down stabilizer — the planning-side
   * counterpart of the live pre-set warning, and the reason a heavy hinge
   * day is no longer followed by heavy unsupported rows in generated plans.
   */
  fatiguedStabilizers(day: number): Set<StandardMuscleGroup> {
    const fatigued = new Set<StandardMuscleGroup>();
    for (const muscle of stabilizerTrackedMuscles(this.config)) {
      if (this.stabilizerReadiness(muscle, day) < this.config.stabilizerReadinessThreshold) {
        fatigued.add(muscle);
      }
    }
    return fatigued;
  }

  /** Stabilizer-channel readiness ratio for one muscle on a planned day. */
  stabilizerReadiness(muscle: StandardMuscleGroup, day: number): number {
    return computeStabilizerRecovery(
      this.historyBefore(day),
      muscle,
      dateForDay(day),
      this.config
    ).readinessRatio;
  }
}

// ---------------------------------------------------------------------------
// Planned-schedule systemic / connective-tissue assessment
// (schedule-builder warnings — the load-driven successor to the old
// hrs-per-week "exceeds typical recovery capacity" banding)
// ---------------------------------------------------------------------------

/**
 * Consecutive HIGH-INTENSITY days at or past which the schedule warning
 * fires. A day is high-intensity when its session totals at least
 * LOW_INTENSITY_DAY_WEIGHTED_SET_CEILING weighted hard sets — one hard set
 * of curls does not make a day count.
 */
export const CONSECUTIVE_HIGH_INTENSITY_DAY_LIMIT = 6;

/**
 * A trained day with FEWER weighted hard sets than this reads as
 * low-intensity and breaks the consecutive-day streak (weights per
 * services/effectiveVolume, summed by
 * volumeTracker.plannedSessionWeightedHardSets).
 */
export const LOW_INTENSITY_DAY_WEIGHTED_SET_CEILING = 5;

/** One day of a repeating schedule cycle (0-based offset within the cycle). */
export interface PlannedScheduleDay {
  day: number;
  exercises: readonly PlannedExercise[];
}

export interface AssessPlannedSystemicLoadInput {
  /**
   * One repeating cycle of the proposed schedule: a week (cycleLengthDays 7)
   * for fixed-day schedules, or the interval for rolling ones (every other
   * day = one trained day, cycleLengthDays 2). Days absent from the list are
   * rest days.
   */
  days: readonly PlannedScheduleDay[];
  cycleLengthDays: number;
  /** Profile context for the recovery replay (same shape the planner uses). */
  recovery?: PlannedWeekRecoveryInput;
}

/** A stabilizer-tracked region re-loaded before its connective tissue clears. */
export interface StabilizerReloadFinding {
  muscle: StandardMuscleGroup;
  /** 0-based day within the cycle on which the under-recovered load lands. */
  day: number;
  /** Stabilizer-channel readiness at that point, steady state, [0, 1]. */
  readinessRatio: number;
}

export interface PlannedSystemicAssessment {
  /**
   * Longest run of consecutive high-intensity days the repeating schedule
   * produces (wrap-around included). Equals cycleLengthDays when the cycle
   * never breaks — see unbrokenCycle.
   */
  maxConsecutiveHighIntensityDays: number;
  /** Every day of the cycle is high-intensity: the streak never ends. */
  unbrokenCycle: boolean;
  consecutiveDaysWarning: string | null;
  /** Lowest-readiness finding per affected muscle, worst first. */
  stabilizerReloads: StabilizerReloadFinding[];
  stabilizerWarning: string | null;
}

function muscleDisplay(muscle: StandardMuscleGroup): string {
  const label = muscle.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Stock stabilizer tags fill in when a generated entry lacks the column. */
function withStabilizerTags(exercise: PlannedExercise): PlannedExercise {
  if (exercise.stabilizers && exercise.stabilizers.length > 0) return exercise;
  const stock = exercise.name ? stabilizersForExerciseName(exercise.name) : undefined;
  return stock && stock.length > 0 ? { ...exercise, stabilizers: [...stock] } : exercise;
}

/** Does this day's session load `muscle` — as a stabilizer OR as a mover? */
function dayLoadsMuscle(
  exercises: readonly PlannedExercise[],
  muscle: StandardMuscleGroup
): boolean {
  for (const exercise of exercises) {
    const tokens = [
      exercise.primaryMuscle,
      ...(exercise.secondaryMuscles ?? []),
      ...(exercise.stabilizers ?? []),
    ];
    for (const token of tokens) {
      if (resolveMuscleToStandard(token).includes(muscle)) return true;
    }
  }
  return false;
}

/**
 * Systemic / connective-tissue check for a PROPOSED schedule. Two
 * independent signals, both distinct from the per-muscle hard-set warning
 * (volumeTracker.assessPlannedMuscleLoad):
 *
 *  1. CONSECUTIVE HIGH-INTENSITY DAYS — 6+ in a row (wrap-around across the
 *     repeating cycle counts) with no rest or low-intensity day between.
 *
 *  2. CONNECTIVE-TISSUE RELOAD — the cycle is replayed TWICE through
 *     PlannedWeekRecovery (the real muscleRecovery model) and the stabilizer
 *     channel is read on the second pass, i.e. at steady state with the
 *     previous cycle's debt still in the history. A stabilizer-tracked
 *     region (erectors, rotator cuff, rear delts, forearms) that is loaded
 *     again while its channel sits under the model's existing
 *     stabilizerReadinessThreshold is flagged. NOTE: rear delts are exempt
 *     from the hard-set WARNING rollup, but their sets — and all pressing
 *     stabilizer dose — fully feed THIS channel; shoulder-joint load is
 *     exactly what it models.
 */
export function assessPlannedSystemicLoad(
  input: AssessPlannedSystemicLoadInput
): PlannedSystemicAssessment {
  const cycleLength = Math.max(1, Math.floor(input.cycleLengthDays));

  // Merge input days into the cycle (duplicate offsets combine; out-of-range
  // offsets wrap) and enrich stabilizer tags once.
  const exercisesByDay = new Map<number, PlannedExercise[]>();
  for (const day of input.days) {
    const idx = ((Math.floor(day.day) % cycleLength) + cycleLength) % cycleLength;
    const list = exercisesByDay.get(idx) ?? [];
    for (const exercise of day.exercises) list.push(withStabilizerTags(exercise));
    exercisesByDay.set(idx, list);
  }

  // --- Signal 1: consecutive high-intensity days ---
  const highIntensity: boolean[] = [];
  for (let idx = 0; idx < cycleLength; idx++) {
    const exercises = exercisesByDay.get(idx);
    highIntensity.push(
      !!exercises &&
        plannedSessionWeightedHardSets(exercises) >= LOW_INTENSITY_DAY_WEIGHTED_SET_CEILING
    );
  }

  const unbrokenCycle = highIntensity.every(Boolean);
  let maxRun = 0;
  if (unbrokenCycle) {
    maxRun = cycleLength;
  } else {
    // Doubling the cycle captures the longest run of the infinite repetition,
    // including runs that wrap across the cycle boundary.
    let run = 0;
    for (const high of [...highIntensity, ...highIntensity]) {
      run = high ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
  }

  const consecutiveDaysWarning = unbrokenCycle
    ? 'Every day in this schedule trains hard with no low-intensity or rest day — watch joint/tendon load.'
    : maxRun >= CONSECUTIVE_HIGH_INTENSITY_DAY_LIMIT
      ? `${maxRun} consecutive hard training days with no low-intensity day — watch joint/tendon load.`
      : null;

  // --- Signal 2: connective-tissue reload at steady state ---
  const recovery = new PlannedWeekRecovery(input.recovery);
  for (const cycle of [0, 1]) {
    exercisesByDay.forEach((exercises, idx) => {
      for (const exercise of exercises) recovery.record(cycle * cycleLength + idx, exercise);
    });
  }

  const worstByMuscle = new Map<StandardMuscleGroup, StabilizerReloadFinding>();
  exercisesByDay.forEach((exercises, idx) => {
    const steadyStateDay = cycleLength + idx;
    for (const muscle of Array.from(recovery.fatiguedStabilizers(steadyStateDay))) {
      if (!dayLoadsMuscle(exercises, muscle)) continue;
      const readinessRatio = recovery.stabilizerReadiness(muscle, steadyStateDay);
      const current = worstByMuscle.get(muscle);
      if (!current || readinessRatio < current.readinessRatio) {
        worstByMuscle.set(muscle, { muscle, day: idx, readinessRatio });
      }
    }
  });

  const stabilizerReloads = Array.from(worstByMuscle.values()).sort(
    (a, b) => a.readinessRatio - b.readinessRatio
  );

  let stabilizerWarning: string | null = null;
  if (stabilizerReloads.length > 0) {
    const worst = stabilizerReloads[0];
    const others = stabilizerReloads.slice(1).map((f) => muscleDisplay(f.muscle));
    stabilizerWarning =
      `${muscleDisplay(worst.muscle)} is loaded again before its connective tissue recovers ` +
      `(readiness ${Math.round(worst.readinessRatio * 100)}% by day ${worst.day + 1} of the ` +
      `schedule) — spread those sessions out or add a low-intensity day.` +
      (others.length > 0 ? ` Also under-recovered: ${others.join(', ')}.` : '');
  }

  return {
    maxConsecutiveHighIntensityDays: maxRun,
    unbrokenCycle,
    consecutiveDaysWarning,
    stabilizerReloads,
    stabilizerWarning,
  };
}
