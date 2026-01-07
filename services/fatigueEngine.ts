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

// ============================================
// CONSTANTS
// ============================================

/** Weight factors for readiness calculation */
const READINESS_WEIGHTS = {
  sleep: 0.35,
  stress: 0.25,
  nutrition: 0.20,
  recovery: 0.20,
};

/** Fatigue accumulation rates per session RPE */
const FATIGUE_ACCUMULATION: Record<number, number> = {
  5: 2,
  6: 4,
  7: 6,
  8: 8,
  9: 10,
  10: 14,
};

/** Fatigue recovery rate per day of rest */
const FATIGUE_RECOVERY_RATE = 3;

/** Thresholds for deload recommendation */
const DELOAD_THRESHOLDS = {
  fatigueScore: 75,        // Recommend deload if fatigue >= 75
  missedTargets: 3,        // If missed targets 3+ sessions in a row
  rpeCreep: 1.5,           // If average RPE increased by 1.5 over 2 weeks
};

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
  let sleepScore: number;
  if (sleep >= 7 && sleep <= 9) {
    sleepScore = 100;
  } else if (sleep >= 6 && sleep < 7) {
    sleepScore = 70;
  } else if (sleep > 9 && sleep <= 10) {
    sleepScore = 85;
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
  
  // Adjust for rest days
  if (daysSinceLastSession >= 2) {
    recoveryScore += 15;
  } else if (daysSinceLastSession === 0) {
    recoveryScore -= 20;
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
}

/**
 * Update mesocycle fatigue score after a session
 * Fatigue accumulates from training and recovers over time
 */
export function updateMesocycleFatigue(input: FatigueUpdateInput): number {
  const { currentFatigue, sessionRpe, daysSinceLastSession } = input;

  // Recovery: subtract based on days since last session
  const recovery = daysSinceLastSession * FATIGUE_RECOVERY_RATE;
  
  // Accumulation: add based on session RPE
  const roundedRpe = Math.round(sessionRpe);
  const accumulation = FATIGUE_ACCUMULATION[roundedRpe] ?? (sessionRpe * 1.2);

  // New fatigue score
  const newFatigue = currentFatigue - recovery + accumulation;

  // Clamp to 0-100
  return Math.round(Math.max(0, Math.min(100, newFatigue)));
}

/**
 * Calculate fatigue recovery over a rest period
 */
export function calculateFatigueAfterRest(
  currentFatigue: number,
  restDays: number
): number {
  const recovery = restDays * FATIGUE_RECOVERY_RATE;
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
 * Determine if a deload should be triggered
 */
export function shouldTriggerDeload(input: DeloadCheckInput): {
  shouldDeload: boolean;
  reason: string;
  urgency: 'low' | 'medium' | 'high';
} {
  const { fatigue, weekInMeso, totalWeeks, deloadWeek, recentSessions } = input;

  // Scheduled deload week
  if (weekInMeso === deloadWeek) {
    return {
      shouldDeload: true,
      reason: 'Scheduled deload week in mesocycle',
      urgency: 'medium',
    };
  }

  // High fatigue score
  if (fatigue >= DELOAD_THRESHOLDS.fatigueScore) {
    return {
      shouldDeload: true,
      reason: `High accumulated fatigue (${fatigue}/100)`,
      urgency: 'high',
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
  expectedAvgRpe: number = 7.5
): {
  projectedFatigue: number;
  recommendation: string;
} {
  // Guard against zero or negative sessions
  if (plannedSessions <= 0) {
    // No sessions = pure recovery
    const recoveredFatigue = Math.max(0, currentFatigue - (7 * FATIGUE_RECOVERY_RATE));
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
    const recovery = (i === 0 ? 0 : daysPerSession) * FATIGUE_RECOVERY_RATE;
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

