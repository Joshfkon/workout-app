/**
 * Fatigue Engine
 * 
 * Pure functions for calculating readiness, fatigue accumulation, and deload recommendations.
 * Based on autoregulation principles for hypertrophy training.
 */

import type {
  ReadinessFactors,
  PreWorkoutCheckIn,
  Rating,
  Mesocycle,
  WorkoutSession,
  ProgressionTargets,
} from '@/types/schema';
import {
  EQUIPMENT_FATIGUE_MULTIPLIER,
  READINESS_WEIGHTS,
  DELOAD_THRESHOLDS,
  effectiveFatigueRecoveryRate,
} from '@/services/shared/fatigueConstants';

// ============================================
// CONSTANTS (local to this engine)
// ============================================

/** Fatigue accumulation rates per session RPE */
const FATIGUE_ACCUMULATION: Record<number, number> = {
  5: 2,
  6: 4,
  7: 6,
  8: 8,
  9: 10,
  10: 14,
};

/**
 * Fatigue multipliers based on movement pattern
 * Heavy compound movements (squats, deadlifts) cause significantly more systemic fatigue
 * than isolation movements (curls, lateral raises)
 */
const MOVEMENT_FATIGUE_MULTIPLIERS: Record<string, number> = {
  squat: 1.4,
  hip_hinge: 1.5,
  horizontal_push: 1.1,
  horizontal_pull: 1.1,
  vertical_push: 1.0,
  vertical_pull: 1.0,
  lunge: 0.9,
  isolation: 0.6,
  carry: 0.8,
};

/** Local alias for equipment multipliers (string-keyed for flexible lookup) */
const EQUIPMENT_FATIGUE_MULTIPLIERS: Record<string, number> = EQUIPMENT_FATIGUE_MULTIPLIER;

// ============================================
// READINESS CALCULATION
// ============================================

export interface ReadinessInput {
  sleepHours: number | null;
  sleepQuality: Rating | null;
  stressLevel: Rating | null;
  nutritionRating: Rating | null;
  previousSessionRpe?: number;
  daysSinceLastSession?: number;
  /**
   * Enhanced Athlete Mode: the recovery sub-score uses the enhanced recovery
   * constants (full rest credit after 1 day instead of 2), so a genuinely
   * recovered next-day session isn't scored as under-recovered.
   */
  enhancedAthleteMode?: boolean;
}

/**
 * Calculate readiness score (0-100) from pre-workout check-in factors
 * Higher score = better readiness for training
 */
export function calculateReadinessScore(input: ReadinessInput): number {
  const {
    sleepHours,
    sleepQuality,
    stressLevel,
    nutritionRating,
    previousSessionRpe = 7,
    daysSinceLastSession = 1,
  } = input;

  // Default to neutral values if not provided
  const sleep = sleepHours ?? 7;
  const quality = sleepQuality ?? 3;
  const stress = stressLevel ?? 3;
  const nutrition = nutritionRating ?? 3;

  // Sleep score (0-100)
  // Optimal: 7-9 hours
  // Note: Oversleeping (10+ hours) can be a warning sign of:
  // - Depression or health issues
  // - Poor sleep quality (not restorative)
  // - Overtraining and need for extra recovery
  let sleepScore: number;
  let isOversleeping = false;

  if (sleep >= 7 && sleep <= 9) {
    sleepScore = 100;
  } else if (sleep >= 6 && sleep < 7) {
    sleepScore = 70;
  } else if (sleep > 9 && sleep <= 10) {
    sleepScore = 80; // Slightly penalize - occasional long sleep is fine
  } else if (sleep > 10) {
    sleepScore = 60; // Significant penalty - oversleeping is a warning sign
    isOversleeping = true;
  } else if (sleep >= 5 && sleep < 6) {
    sleepScore = 50;
  } else {
    sleepScore = 30;
  }
  
  // Adjust by sleep quality (1-5 scale)
  sleepScore = sleepScore * (0.6 + quality * 0.1);

  // Stress score (1-5 scale, inverted - low stress = high score)
  const stressScore = (6 - stress) * 20;

  // Nutrition score (1-5 scale)
  const nutritionScore = nutrition * 20;

  // Recovery score based on previous session and rest days
  let recoveryScore = 70;

  // Adjust for previous session intensity
  if (previousSessionRpe >= 9) {
    recoveryScore -= 15;
  } else if (previousSessionRpe <= 6) {
    recoveryScore += 10;
  }

  // Adjust for rest days. Enhanced athletes dissipate fatigue faster
  // (ENHANCED_RECOVERY_MULTIPLIER), so full rest credit arrives a day sooner
  // and same-day training is penalized less.
  const fullRecoveryDays = input.enhancedAthleteMode ? 1 : 2;
  if (daysSinceLastSession >= fullRecoveryDays) {
    recoveryScore += 15;
  } else if (daysSinceLastSession === 0) {
    recoveryScore -= input.enhancedAthleteMode ? 10 : 20;
  }

  // Calculate weighted average
  const totalScore =
    sleepScore * READINESS_WEIGHTS.sleep +
    stressScore * READINESS_WEIGHTS.stress +
    nutritionScore * READINESS_WEIGHTS.nutrition +
    recoveryScore * READINESS_WEIGHTS.recovery;

  // Clamp to 0-100
  return Math.round(Math.max(0, Math.min(100, totalScore)));
}

/**
 * Warning types for readiness analysis
 */
export type ReadinessWarningType =
  | 'oversleeping'
  | 'undersleeping'
  | 'high_stress'
  | 'poor_nutrition'
  | 'insufficient_recovery';

export interface ReadinessWarning {
  type: ReadinessWarningType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  recommendation: string;
}

/**
 * Analyze readiness input and return any warnings
 * Separate from score calculation to maintain backwards compatibility
 */
export function getReadinessWarnings(input: ReadinessInput): ReadinessWarning[] {
  const warnings: ReadinessWarning[] = [];
  const sleep = input.sleepHours ?? 7;
  const stress = input.stressLevel ?? 3;
  const nutrition = input.nutritionRating ?? 3;
  const daysSinceLastSession = input.daysSinceLastSession ?? 1;

  // Oversleeping warning (10+ hours)
  if (sleep > 10) {
    warnings.push({
      type: 'oversleeping',
      severity: 'warning',
      message: `You slept ${sleep} hours, which is more than optimal.`,
      recommendation:
        'Regular oversleeping (10+ hours) can indicate overtraining, poor sleep quality, or health issues. ' +
        'If this is frequent, consider: reducing training volume, checking for sleep disorders, ' +
        'or consulting a healthcare provider.',
    });
  }

  // Undersleeping warning (less than 6 hours)
  if (sleep < 6) {
    warnings.push({
      type: 'undersleeping',
      severity: sleep < 5 ? 'critical' : 'warning',
      message: `You only slept ${sleep} hours.`,
      recommendation:
        'Sleep is critical for recovery and muscle growth. ' +
        'Aim for 7-9 hours. Consider a lighter session today or focusing on technique.',
    });
  }

  // High stress warning
  if (stress >= 4) {
    warnings.push({
      type: 'high_stress',
      severity: stress === 5 ? 'warning' : 'info',
      message: 'Your stress level is elevated.',
      recommendation:
        'High stress impairs recovery. Consider reducing volume or intensity today, ' +
        'or focus on exercises you enjoy.',
    });
  }

  // Poor nutrition warning
  if (nutrition <= 2) {
    warnings.push({
      type: 'poor_nutrition',
      severity: nutrition === 1 ? 'warning' : 'info',
      message: 'Your nutrition has been suboptimal.',
      recommendation:
        'Proper nutrition is essential for performance and recovery. ' +
        'Ensure adequate protein and carbohydrates before and after training.',
    });
  }

  // Insufficient recovery (training same day or consecutive days after hard session)
  if (daysSinceLastSession === 0 && (input.previousSessionRpe ?? 7) >= 8) {
    warnings.push({
      type: 'insufficient_recovery',
      severity: 'warning',
      message: 'Training twice on the same day after a hard session.',
      recommendation:
        'Allow at least 24 hours between intense sessions for the same muscle groups. ' +
        'Consider targeting different muscles or doing a recovery session.',
    });
  }

  return warnings;
}

/**
 * Create a PreWorkoutCheckIn object with calculated readiness
 */
export function createCheckIn(input: ReadinessInput): PreWorkoutCheckIn {
  return {
    sleepHours: input.sleepHours,
    sleepQuality: input.sleepQuality,
    stressLevel: input.stressLevel,
    nutritionRating: input.nutritionRating,
    bodyweightKg: null,
    readinessScore: calculateReadinessScore(input),
  };
}

// ============================================
// FATIGUE MANAGEMENT
// ============================================

export interface FatigueUpdateInput {
  currentFatigue: number;
  sessionRpe: number;
  daysSinceLastSession: number;
  /** Enhanced Athlete Mode: fatigue dissipates faster between sessions. */
  enhancedAthleteMode?: boolean;
}

/**
 * Update mesocycle fatigue score after a session
 * Fatigue accumulates from training and recovers over time
 */
export function updateMesocycleFatigue(input: FatigueUpdateInput): number {
  const { currentFatigue, sessionRpe, daysSinceLastSession } = input;

  // Recovery: subtract based on days since last session (accumulation is
  // NOT reduced for enhanced athletes — only dissipation speeds up)
  const recovery = daysSinceLastSession * effectiveFatigueRecoveryRate(input.enhancedAthleteMode);
  
  // Accumulation: add based on session RPE
  const roundedRpe = Math.round(sessionRpe);
  const accumulation = FATIGUE_ACCUMULATION[roundedRpe] ?? (sessionRpe * 1.2);

  // New fatigue score
  const newFatigue = currentFatigue - recovery + accumulation;

  // Clamp to 0-100
  return Math.round(Math.max(0, Math.min(100, newFatigue)));
}

/**
 * Exercise information for fatigue calculation
 */
export interface ExerciseFatigueInfo {
  movementPattern: string;
  equipment: string;
  mechanic: 'compound' | 'isolation';
  sets: number;
}

/**
 * Enhanced fatigue input with exercise type information
 */
export interface EnhancedFatigueUpdateInput extends FatigueUpdateInput {
  exercises?: ExerciseFatigueInfo[];
}

/**
 * Calculate fatigue multiplier for an exercise based on its characteristics
 */
export function getExerciseFatigueMultiplier(exercise: ExerciseFatigueInfo): number {
  const movementMultiplier = MOVEMENT_FATIGUE_MULTIPLIERS[exercise.movementPattern] ?? 1.0;
  const equipmentMultiplier = EQUIPMENT_FATIGUE_MULTIPLIERS[exercise.equipment] ?? 1.0;
  const mechanicMultiplier = exercise.mechanic === 'compound' ? 1.0 : 0.7;

  // Combine multipliers (geometric mean to avoid extreme values)
  return Math.pow(movementMultiplier * equipmentMultiplier * mechanicMultiplier, 1 / 2);
}

/**
 * Update mesocycle fatigue score with exercise type awareness
 * Different exercises contribute different amounts of systemic fatigue
 *
 * Example: A session of heavy squats at RPE 9 causes more fatigue than
 * a session of cable flies at RPE 9, even though the RPE is the same.
 */
export function updateMesocycleFatigueEnhanced(input: EnhancedFatigueUpdateInput): number {
  const { currentFatigue, sessionRpe, daysSinceLastSession, exercises } = input;

  // Recovery: subtract based on days since last session
  const recovery = daysSinceLastSession * effectiveFatigueRecoveryRate(input.enhancedAthleteMode);

  // Base accumulation from RPE
  const roundedRpe = Math.round(sessionRpe);
  let baseAccumulation = FATIGUE_ACCUMULATION[roundedRpe] ?? (sessionRpe * 1.2);

  // If exercise info provided, calculate weighted fatigue based on exercise types
  if (exercises && exercises.length > 0) {
    const totalSets = exercises.reduce((sum, ex) => sum + ex.sets, 0);

    if (totalSets > 0) {
      // Weight each exercise's fatigue contribution by its proportion of total sets
      let weightedMultiplier = 0;
      for (const exercise of exercises) {
        const exerciseMultiplier = getExerciseFatigueMultiplier(exercise);
        const proportion = exercise.sets / totalSets;
        weightedMultiplier += exerciseMultiplier * proportion;
      }

      // Apply the weighted multiplier to base accumulation
      baseAccumulation *= weightedMultiplier;
    }
  }

  // New fatigue score
  const newFatigue = currentFatigue - recovery + baseAccumulation;

  // Clamp to 0-100
  return Math.round(Math.max(0, Math.min(100, newFatigue)));
}

/**
 * Calculate fatigue recovery over a rest period
 */
export function calculateFatigueAfterRest(
  currentFatigue: number,
  restDays: number,
  enhancedAthleteMode?: boolean
): number {
  const recovery = restDays * effectiveFatigueRecoveryRate(enhancedAthleteMode);
  return Math.max(0, currentFatigue - recovery);
}

// ============================================
// DELOAD RECOMMENDATIONS
// ============================================

export interface DeloadCheckInput {
  fatigue: number;
  weekInMeso: number;
  totalWeeks: number;
  deloadWeek: number;
  recentSessions: Array<{
    sessionRpe: number;
    completionPercent: number;
  }>;
}

/**
 * Calculate mesocycle-aware fatigue threshold
 * Early in meso: lower threshold (high fatigue is unexpected)
 * Late in meso: higher threshold (some fatigue is expected as part of planned overreach)
 */
function getMesocycleAwareFatigueThreshold(weekInMeso: number, totalWeeks: number): number {
  const baseThreshold = DELOAD_THRESHOLDS.fatigueScore; // 75
  const progressRatio = weekInMeso / totalWeeks;

  // Weeks 1-2: Lower threshold (65-70) - early fatigue is concerning
  // Weeks 3-4: Normal threshold (75) - moderate accumulation expected
  // Week 5+: Higher threshold (80-85) - planned overreach before deload
  if (progressRatio <= 0.33) {
    return baseThreshold - 10; // 65 - early fatigue is a warning sign
  } else if (progressRatio <= 0.66) {
    return baseThreshold; // 75 - normal accumulation
  } else {
    return baseThreshold + 10; // 85 - tolerance for planned overreach
  }
}

/**
 * Get mesocycle-aware recommendation based on fatigue and timing
 */
function getMesocycleContextualRecommendation(
  fatigue: number,
  weekInMeso: number,
  totalWeeks: number
): string {
  const progressRatio = weekInMeso / totalWeeks;

  if (progressRatio <= 0.33) {
    // Early in meso - high fatigue is unexpected
    return `Unexpectedly high fatigue (${fatigue}/100) in week ${weekInMeso}. ` +
           'Consider: reducing volume, improving recovery factors, or checking for overtraining.';
  } else if (progressRatio <= 0.66) {
    // Mid meso - fatigue accumulation is normal
    return `Moderate fatigue accumulation (${fatigue}/100) in week ${weekInMeso}. ` +
           'This is normal for mid-mesocycle. Monitor recovery and adjust if needed.';
  } else {
    // Late in meso - fatigue is expected, near planned deload
    return `High fatigue (${fatigue}/100) in week ${weekInMeso} - planned overreach phase. ` +
           'Deload is approaching. Push through if recovery supports it, or deload early if needed.';
  }
}

/**
 * Determine if a deload should be triggered
 * Now includes mesocycle context for smarter recommendations
 */
export function shouldTriggerDeload(input: DeloadCheckInput): {
  shouldDeload: boolean;
  reason: string;
  urgency: 'low' | 'medium' | 'high';
  mesocycleContext?: string;
} {
  const { fatigue, weekInMeso, totalWeeks, deloadWeek, recentSessions } = input;

  // Scheduled deload week
  if (weekInMeso === deloadWeek) {
    return {
      shouldDeload: true,
      reason: 'Scheduled deload week in mesocycle',
      urgency: 'medium',
      mesocycleContext: `Week ${weekInMeso} of ${totalWeeks} - planned deload timing.`,
    };
  }

  // Mesocycle-aware fatigue threshold
  const fatigueThreshold = getMesocycleAwareFatigueThreshold(weekInMeso, totalWeeks);
  const mesocycleContext = getMesocycleContextualRecommendation(fatigue, weekInMeso, totalWeeks);

  // High fatigue score (adjusted for mesocycle position)
  if (fatigue >= fatigueThreshold) {
    const progressRatio = weekInMeso / totalWeeks;
    const urgency = progressRatio <= 0.33 ? 'high' : progressRatio <= 0.66 ? 'medium' : 'low';

    return {
      shouldDeload: true,
      reason: `Fatigue (${fatigue}/100) exceeds threshold (${fatigueThreshold}) for week ${weekInMeso}`,
      urgency,
      mesocycleContext,
    };
  }

  // Check for consecutive missed targets
  if (recentSessions.length >= 3) {
    const recentMissed = recentSessions
      .slice(-3)
      .filter((s) => s.completionPercent < 80);
    
    if (recentMissed.length >= DELOAD_THRESHOLDS.missedTargets) {
      return {
        shouldDeload: true,
        reason: 'Consistently missing workout targets',
        urgency: 'high',
      };
    }
  }

  // Check for RPE creep (average RPE increasing over time)
  if (recentSessions.length >= 6) {
    const firstThree = recentSessions.slice(0, 3);
    const lastThree = recentSessions.slice(-3);
    
    const avgFirst = firstThree.reduce((a, b) => a + b.sessionRpe, 0) / 3;
    const avgLast = lastThree.reduce((a, b) => a + b.sessionRpe, 0) / 3;
    
    if (avgLast - avgFirst >= DELOAD_THRESHOLDS.rpeCreep) {
      return {
        shouldDeload: true,
        reason: 'RPE increasing significantly - accumulated fatigue detected',
        urgency: 'medium',
      };
    }
  }

  // No deload needed
  return {
    shouldDeload: false,
    reason: '',
    urgency: 'low',
    mesocycleContext: getMesocycleContextualRecommendation(fatigue, weekInMeso, totalWeeks),
  };
}

// ============================================
// TARGET ADJUSTMENT FOR READINESS
// ============================================

export interface ReadinessAdjustmentInput {
  baseTargets: ProgressionTargets;
  readinessScore: number;
  minWeightIncrement: number;
}

/**
 * Adjust workout targets based on readiness score
 */
export function adjustTargetsForReadiness(
  input: ReadinessAdjustmentInput
): ProgressionTargets {
  const { baseTargets, readinessScore, minWeightIncrement } = input;

  // Guard against invalid minWeightIncrement (prevent division by zero)
  const safeIncrement = minWeightIncrement > 0 ? minWeightIncrement : 2.5;

  // High readiness (80+): No adjustment needed
  if (readinessScore >= 80) {
    return baseTargets;
  }

  // Moderate readiness (60-79): Minor adjustments
  if (readinessScore >= 60) {
    return {
      ...baseTargets,
      targetRir: baseTargets.targetRir + 1,
      restSeconds: baseTargets.restSeconds + 30,
      reason: `${baseTargets.reason} (adjusted for moderate readiness: ${readinessScore}%)`,
    };
  }

  // Low readiness (40-59): Significant adjustments
  if (readinessScore >= 40) {
    const weightReduction = Math.round(baseTargets.weightKg * 0.1 / safeIncrement) * safeIncrement;
    return {
      ...baseTargets,
      weightKg: Math.max(0, baseTargets.weightKg - weightReduction),
      targetRir: baseTargets.targetRir + 2,
      sets: Math.max(2, baseTargets.sets - 1),
      restSeconds: baseTargets.restSeconds + 60,
      reason: `Reduced targets due to low readiness (${readinessScore}%)`,
    };
  }

  // Very low readiness (<40): Consider skipping or light session
  const weightReduction = Math.round(baseTargets.weightKg * 0.2 / safeIncrement) * safeIncrement;
  return {
    ...baseTargets,
    weightKg: Math.max(0, baseTargets.weightKg - weightReduction),
    targetRir: 4,
    sets: 2,
    restSeconds: baseTargets.restSeconds + 90,
    progressionType: 'technique',
    reason: `Very low readiness (${readinessScore}%) - light technique session recommended`,
  };
}

// ============================================
// FATIGUE FORECASTING
// ============================================

/**
 * Forecast fatigue for upcoming week based on planned sessions
 */
export function forecastWeeklyFatigue(
  currentFatigue: number,
  plannedSessions: number,
  expectedAvgRpe: number = 7.5,
  enhancedAthleteMode?: boolean
): {
  projectedFatigue: number;
  recommendation: string;
} {
  const recoveryRate = effectiveFatigueRecoveryRate(enhancedAthleteMode);

  // Guard against zero or negative sessions
  if (plannedSessions <= 0) {
    // No sessions = pure recovery
    const recoveredFatigue = Math.max(0, currentFatigue - (7 * recoveryRate));
    return {
      projectedFatigue: Math.round(recoveredFatigue),
      recommendation: 'No sessions planned - good time for recovery',
    };
  }

  // Simulate week with evenly spaced sessions
  const daysPerSession = Math.floor(7 / plannedSessions);
  let fatigue = currentFatigue;

  for (let i = 0; i < plannedSessions; i++) {
    // Recovery between sessions
    const recovery = (i === 0 ? 0 : daysPerSession) * recoveryRate;
    fatigue = Math.max(0, fatigue - recovery);
    
    // Add session fatigue
    const accumulation = FATIGUE_ACCUMULATION[Math.round(expectedAvgRpe)] ?? 8;
    fatigue = Math.min(100, fatigue + accumulation);
  }

  // Recommendation based on projected fatigue
  let recommendation: string;
  if (fatigue < 50) {
    recommendation = 'Good capacity for high-intensity training';
  } else if (fatigue < 70) {
    recommendation = 'Moderate fatigue - maintain current intensity';
  } else if (fatigue < 85) {
    recommendation = 'Consider reducing volume or intensity this week';
  } else {
    recommendation = 'High fatigue risk - strongly recommend deload';
  }

  return {
    projectedFatigue: Math.round(fatigue),
    recommendation,
  };
}

/**
 * Get readiness interpretation message
 */
export function getReadinessInterpretation(score: number): {
  level: 'excellent' | 'good' | 'moderate' | 'low' | 'poor';
  message: string;
  recommendation: string;
} {
  if (score >= 85) {
    return {
      level: 'excellent',
      message: 'Excellent readiness for training',
      recommendation: 'Great day for progression or high-intensity work',
    };
  }
  if (score >= 70) {
    return {
      level: 'good',
      message: 'Good readiness for training',
      recommendation: 'Proceed with planned workout',
    };
  }
  if (score >= 55) {
    return {
      level: 'moderate',
      message: 'Moderate readiness',
      recommendation: 'Maintain current weights, focus on execution',
    };
  }
  if (score >= 40) {
    return {
      level: 'low',
      message: 'Low readiness today',
      recommendation: 'Consider reducing volume or intensity by 10-20%',
    };
  }
  return {
    level: 'poor',
    message: 'Poor readiness - recovery compromised',
    recommendation: 'Light technique work or rest day recommended',
  };
}


// ============================================
// READINESS -> SESSION MODULATION
// ============================================

export interface ReadinessModulation {
  /** Added to every block's target RIR for this session (0 = unchanged). */
  rirDelta: 0 | 1;
  /** UI hint: offer dropping the last set of each exercise (never auto-applied). */
  suggestSetReduction: boolean;
  /** Banner copy for the workout header; null when nothing changes. */
  banner: string | null;
}

/**
 * Turn a readiness score (calculateReadinessScore, 0-100) into concrete,
 * conservative session adjustments. Pure; the caller applies rirDelta to
 * prescriptions and renders the banner with a "train as planned" override.
 *
 * <40  -> ease targets a full RIR and suggest trimming a set per exercise
 * 40-55 -> ease targets a full RIR
 * >=55 -> unchanged
 */
export function applyReadinessModulation(readinessScore: number): ReadinessModulation {
  if (readinessScore < 40) {
    return {
      rirDelta: 1,
      suggestSetReduction: true,
      banner: 'Adjusted for low readiness — targets eased and shorter sessions suggested today',
    };
  }
  if (readinessScore < 55) {
    return {
      rirDelta: 1,
      suggestSetReduction: false,
      banner: 'Adjusted for readiness — leaving one extra rep in reserve today',
    };
  }
  return { rirDelta: 0, suggestSetReduction: false, banner: null };
}
