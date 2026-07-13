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

import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';
import { ENHANCED_RECOVERY_MULTIPLIER } from '@/services/shared/fatigueConstants';

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
  /** A last session at/above this effective set dose adds recovery time. */
  highDoseSetThreshold: number;
  /** …or at/above this many effective hard sets (see hardRirThreshold). */
  highDoseHardSetThreshold: number;
  /** A set with RIR at/below this counts as "hard"/"maxed out". */
  hardRirThreshold: number;
  /** Hours ADDED to the window for a high-dose last session. */
  highDoseExtraHours: number;
  /** A last session at/below this effective dose with no hard sets is "light". */
  lowDoseSetThreshold: number;
  /** Hours SUBTRACTED from the window for a light last session. */
  lowDoseReducedHours: number;
  /** Secondary-muscle involvement contributes this fraction of a set's dose. */
  secondaryDoseFactor: number;
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
}

export const RECOVERY_CONFIG: RecoveryConfig = {
  defaultWindowHours: 48,
  windowHoursByMuscle: {
    // Large groups — more tissue, slower to clear fatigue.
    quads: 60,
    hamstrings: 60,
    glutes: 60,
    lats: 60,
    upper_back: 60,
    erectors: 60,
    // Small/fast recoverers.
    biceps: 36,
    triceps: 36,
    forearms: 36,
    calves: 36,
    gastrocnemius: 36,
    soleus: 36,
  },
  highDoseSetThreshold: 8,
  highDoseHardSetThreshold: 2,
  hardRirThreshold: 1,
  highDoseExtraHours: 24,
  lowDoseSetThreshold: 3,
  lowDoseReducedHours: 12,
  secondaryDoseFactor: 0.5,
  recoveringThreshold: 0.6,
  windowScale: 1,
};

/**
 * The config for a given athlete profile. Enhanced athletes dissipate muscular
 * fatigue faster, so every recovery window shrinks by the shared multiplier
 * (~22.5% faster) — the same constant the fatigue model uses, and the same
 * scaling the retired dashboard recovery card applied.
 */
export function recoveryConfigFor(enhancedAthleteMode: boolean): RecoveryConfig {
  if (!enhancedAthleteMode) return RECOVERY_CONFIG;
  return { ...RECOVERY_CONFIG, windowScale: 1 / ENHANCED_RECOVERY_MULTIPLIER };
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
 */
function involvementFactor(
  exercise: RecoveryExercise,
  muscle: StandardMuscleGroup,
  config: RecoveryConfig
): number {
  const primaryStandards = exercise.primaryMuscle
    ? resolveMuscleToStandard(exercise.primaryMuscle)
    : [];
  if (primaryStandards.includes(muscle)) return 1;

  const secondaryStandards = exercise.secondaryMuscles.flatMap((m) =>
    resolveMuscleToStandard(m)
  );
  if (secondaryStandards.includes(muscle)) return config.secondaryDoseFactor;

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

/** Resolve the recovery window (hours) for a muscle given its last dose. */
function windowForSession(
  muscle: StandardMuscleGroup,
  involvement: SessionInvolvement,
  config: RecoveryConfig
): number {
  const base = config.windowHoursByMuscle[muscle] ?? config.defaultWindowHours;

  const isHighDose =
    involvement.dose >= config.highDoseSetThreshold ||
    involvement.hardSets >= config.highDoseHardSetThreshold;
  const isLowDose =
    involvement.dose <= config.lowDoseSetThreshold && involvement.hardSets === 0;

  const window = isHighDose
    ? base + config.highDoseExtraHours
    : isLowDose
      ? Math.max(0, base - config.lowDoseReducedHours)
      : base;

  return window * config.windowScale;
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
    };
  }

  const windowHours = windowForSession(muscle, last, config);
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
  };
}
