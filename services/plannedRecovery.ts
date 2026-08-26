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
    const history = this.historyBefore(day);
    const now = dateForDay(day);
    const fatigued = new Set<StandardMuscleGroup>();
    for (const muscle of stabilizerTrackedMuscles(this.config)) {
      const ratio = computeStabilizerRecovery(history, muscle, now, this.config).readinessRatio;
      if (ratio < this.config.stabilizerReadinessThreshold) fatigued.add(muscle);
    }
    return fatigued;
  }
}
