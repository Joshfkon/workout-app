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
