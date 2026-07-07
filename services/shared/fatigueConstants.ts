/**
 * Shared Fatigue Constants
 *
 * Single source of truth for fatigue-related constants used across
 * fatigueEngine.ts, fatigueBudgetEngine.ts, deloadEngine.ts, etc.
 */

import type { Equipment } from '@/types/schema';

// ============================================
// EQUIPMENT FATIGUE MODIFIERS
// ============================================

/**
 * Fatigue multiplier per equipment type.
 * Free weights (barbell) cause more fatigue due to stabilizer demand.
 * Machines cause less due to guided movement paths.
 */
export const EQUIPMENT_FATIGUE_MULTIPLIER: Record<Equipment, number> = {
  barbell: 1.3,
  dumbbell: 1.1,
  kettlebell: 1.15,
  cable: 0.8,
  machine: 0.65,
  bodyweight: 1.0,
};

// ============================================
// RECOVERY
// ============================================

/** Base fatigue points recovered per day of rest (natural athlete) */
export const FATIGUE_RECOVERY_RATE = 3;

/**
 * Enhanced Athlete Mode recovery multiplier: fatigue dissipates ~22.5%
 * faster between sessions (tuning range ~1.20-1.25). Applies to recovery
 * time-constants ONLY — fatigue accumulation per set is unchanged, and
 * joint-stress / injury-driven limits never read this (tendons and
 * ligaments do not share the accelerated recovery).
 *
 * Sandbagging / RPE-calibration detection must also use this constant when
 * the mode is on, otherwise genuinely-recovered sessions read as sandbagging.
 */
export const ENHANCED_RECOVERY_MULTIPLIER = 1.225;

/** Per-day fatigue recovery rate for the athlete's recovery profile. */
export function effectiveFatigueRecoveryRate(enhancedAthleteMode?: boolean): number {
  return enhancedAthleteMode
    ? FATIGUE_RECOVERY_RATE * ENHANCED_RECOVERY_MULTIPLIER
    : FATIGUE_RECOVERY_RATE;
}

// ============================================
// AMRAP CALIBRATION — INTRA-SESSION REP DECAY
// ============================================

/**
 * Expected-decay model for fatigue-adjusting AMRAP calibration predictions.
 *
 * A prior set's "reps + reported RIR" implies the lifter's max AT THAT SET'S
 * POSITION in the session. An AMRAP performed sets later is done under more
 * accumulated fatigue, so the naive prediction must be decayed by the working
 * sets performed in between — otherwise normal intra-session rep decline
 * (e.g. 9 -> 8 -> 8 -> 6 at a fixed load) reads as RIR overestimation.
 *
 * Baseline: ~1-2 reps of decay per intervening working set of the same
 * exercise at 2-3 min rest, scaled by the set's rep range (higher-rep sets
 * lose more absolute reps per set) and by rest duration.
 *
 * Read by BOTH the calibration bias and the sandbagging detection so the two
 * verdicts share one fatigue baseline (see rpeCalibration.ts).
 */
export const AMRAP_DECAY_CONSTANTS = {
  /** Fraction of a set's implied max reps lost per intervening working set. */
  DECAY_RATE_PER_SET: 0.15,
  /** Lower bound on per-set decay (reps) — even low-rep work costs something. */
  MIN_DECAY_PER_SET: 1,
  /** Upper bound on per-set decay (reps) — keeps high-rep work sane. */
  MAX_DECAY_PER_SET: 3,
  /** Cap on total decay applied to any single prediction (reps). */
  MAX_TOTAL_DECAY: 6,
  /** Rest at or below this (seconds) increases decay. */
  SHORT_REST_THRESHOLD_SECONDS: 120,
  /** Decay multiplier for short rest. */
  SHORT_REST_MULTIPLIER: 1.25,
  /** Rest at or above this (seconds) reduces decay. */
  LONG_REST_THRESHOLD_SECONDS: 300,
  /** Decay multiplier for long rest. */
  LONG_REST_MULTIPLIER: 0.75,
  /**
   * Sets closer together than this are treated as the same session when the
   * calibration engine reconstructs set positions from timestamps.
   */
  SAME_SESSION_WINDOW_MS: 3 * 60 * 60 * 1000,
  /**
   * Approximate seconds a set itself takes; subtracted from set-completion
   * timestamp gaps when estimating rest intervals.
   */
  NOMINAL_SET_DURATION_SECONDS: 40,
} as const;

// ============================================
// READINESS ASSESSMENT
// ============================================

/** Weights for readiness score components (must sum to 1.0) */
export const READINESS_WEIGHTS = {
  sleep: 0.35,
  stress: 0.25,
  nutrition: 0.20,
  recovery: 0.20,
} as const;

// ============================================
// DELOAD THRESHOLDS
// ============================================

/** When to auto-trigger a deload week */
export const DELOAD_THRESHOLDS = {
  /** Fatigue score (0-100) that triggers deload */
  fatigueScore: 75,
  /** Consecutive sessions missing rep targets */
  missedTargets: 3,
  /** RPE creep (average RPE increase over recent sessions) */
  rpeCreep: 1.5,
} as const;

/** Volume and intensity modifiers for different deload strategies */
export const DELOAD_MODIFIERS: Record<
  'volume' | 'intensity' | 'full',
  { volume: number; intensity: number }
> = {
  volume: { volume: 0.5, intensity: 1.0 },
  intensity: { volume: 0.7, intensity: 0.85 },
  full: { volume: 0.5, intensity: 0.6 },
};
