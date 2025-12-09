/**
 * Deload Detection & Generation Engine
 * Implements reactive deload triggers based on performance markers
 * and generates appropriate deload week configurations.
 */

import type {
  Experience,
  PeriodizationPlan,
  WeeklyPerformanceData,
  DeloadTriggers,
  MesocycleWeek,
  ExtendedUserProfile,
} from '@/types/schema';

// ============================================================
// REACTIVE DELOAD DETECTION
// ============================================================

/**
 * Check if deload triggers are met based on recent performance data
 * @param recentPerformance - Array of weekly performance data (last 2+ weeks)
 * @param profile - User profile for experience-based adjustments
 * @param periodization - Current periodization plan for timing context
 */
export function checkDeloadTriggers(
  recentPerformance: WeeklyPerformanceData[],
  profile: ExtendedUserProfile,
  periodization: PeriodizationPlan
): DeloadTriggers {
  const reasons: string[] = [];
  let shouldDeload = false;
  let suggestedDeloadType: 'volume' | 'intensity' | 'full' = 'volume';
  
  // Need at least 2 weeks of data
  if (recentPerformance.length < 2) {
    return { shouldDeload: false, reasons: [], suggestedDeloadType: 'volume' };
  }
  
  const lastWeek = recentPerformance[recentPerformance.length - 1];
  const previousWeek = recentPerformance[recentPerformance.length - 2];
  
  // === TRIGGER 1: Accumulated fatigue (perceived fatigue trending up) ===
  if (lastWeek.perceivedFatigue >= 4 && previousWeek.perceivedFatigue >= 3) {
    reasons.push('Perceived fatigue elevated for 2+ weeks');
    shouldDeload = true;
  }
  
  // === TRIGGER 2: Performance decline ===
  if (lastWeek.strengthDecline || lastWeek.missedReps > 5) {
    reasons.push('Strength regression or significant missed reps');
    shouldDeload = true;
    suggestedDeloadType = 'intensity';
  }
  
  // === TRIGGER 3: Sleep/recovery issues ===
  if (lastWeek.sleepQuality <= 2 && previousWeek.sleepQuality <= 2) {
    reasons.push('Poor sleep for 2+ weeks - recovery compromised');
    shouldDeload = true;
    suggestedDeloadType = 'full';
  }
  
  // === TRIGGER 4: Motivation drop (often a sign of accumulated fatigue) ===
  if (lastWeek.motivationLevel <= 2 && previousWeek.motivationLevel <= 3) {
    reasons.push('Declining motivation - possible overreaching');
    shouldDeload = true;
  }
  
  // === TRIGGER 5: Joint pain ===
  if (lastWeek.jointPain) {
    reasons.push('Joint pain reported - reduce intensity');
    shouldDeload = true;
    suggestedDeloadType = 'intensity';
  }
  
  // === TRIGGER 6: Time since last deload (backup trigger) ===
  const weeksSinceStart = lastWeek.weekNumber;
  if (weeksSinceStart >= periodization.deloadFrequency + 2) {
    reasons.push(`${weeksSinceStart} weeks since mesocycle start - overdue for deload`);
    shouldDeload = true;
  }
  
  // === EXPERIENCE ADJUSTMENT ===
  // Novices recover faster, require more triggers before deloading
  if (profile.experience === 'novice' && reasons.length < 2) {
    shouldDeload = false;
  }
  
  // Advanced lifters are more attuned to fatigue, trust single triggers
  if (profile.experience === 'advanced' && reasons.length >= 1) {
    shouldDeload = true;
  }
  
  return { shouldDeload, reasons, suggestedDeloadType };
}

// ============================================================
// DELOAD WEEK GENERATION
// ============================================================

/**
 * Deload modifiers by type:
 * - volume: Same weight, fewer sets (maintain strength, reduce accumulated fatigue)
 * - intensity: Less weight, moderate volume (let joints/connective tissue recover)
 * - full: Light and easy (complete recovery from severe overreaching)
 */
const DELOAD_MODIFIERS: Record<'volume' | 'intensity' | 'full', { volume: number; intensity: number }> = {
  volume: { volume: 0.5, intensity: 1.0 },     // Same weight, half sets
  intensity: { volume: 0.7, intensity: 0.85 }, // Less weight, moderate volume
  full: { volume: 0.5, intensity: 0.6 },       // Light and easy
};

/**
 * Generate a deload week based on a template week and deload type
 */
export function generateDeloadWeek(
  baseWeek: MesocycleWeek,
  deloadType: 'volume' | 'intensity' | 'full'
): MesocycleWeek {
  const mod = DELOAD_MODIFIERS[deloadType];
  
  const deloadSessions = baseWeek.sessions.map(session => ({
    ...session,
    focus: `DELOAD (${deloadType}) - ${session.focus}`,
    exercises: session.exercises.map(ex => ({
      ...ex,
      sets: Math.max(1, Math.round(ex.sets * mod.volume)),
      reps: {
        ...ex.reps,
        targetRIR: Math.min(4, ex.reps.targetRIR + 2),
        notes: getDeloadNotes(deloadType),
      },
      loadGuidance: deloadType === 'intensity' || deloadType === 'full'
        ? `Reduce load to ${Math.round(mod.intensity * 100)}% of normal`
        : ex.loadGuidance,
    })),
    totalSets: Math.round(session.totalSets * mod.volume),
  }));
  
  return {
    ...baseWeek,
    focus: `DELOAD WEEK (${deloadType})`,
    volumeModifier: mod.volume,
    intensityModifier: mod.intensity,
    rpeTarget: { min: 5, max: 6 },
    sessions: deloadSessions,
    isDeload: true,
  };
}

/**
 * Get appropriate notes for deload type
 */
function getDeloadNotes(deloadType: 'volume' | 'intensity' | 'full'): string {
  switch (deloadType) {
    case 'volume':
      return 'Deload week: maintain load, reduce sets by 50%';
    case 'intensity':
      return 'Deload week: reduce load 15%, moderate volume for joint recovery';
    case 'full':
      return 'Deload week: light and easy - focus on movement quality and recovery';
  }
}

// ============================================================
// PROACTIVE DELOAD SCHEDULING
// ============================================================

/**
 * Calculate optimal deload timing based on user factors
 */
export function calculateDeloadFrequency(profile: ExtendedUserProfile): number {
  let baseWeeks = 5;
  
  // Age adjustments
  if (profile.age < 25) {
    baseWeeks = 6;  // Young lifters recover faster
  } else if (profile.age >= 35 && profile.age < 45) {
    baseWeeks = 5;
  } else if (profile.age >= 45 && profile.age < 55) {
    baseWeeks = 4;
  } else if (profile.age >= 55) {
    baseWeeks = 3;
  }
  
  // Training age adjustments
  if (profile.trainingAge < 1) {
    baseWeeks = 8;  // Novices can go longer before needing deloads
  } else if (profile.trainingAge >= 5) {
    baseWeeks = Math.max(3, baseWeeks - 1);  // Experienced lifters need more frequent deloads
  }
  
  // Sleep/stress adjustments
  if (profile.sleepQuality <= 2 || profile.stressLevel >= 4) {
    baseWeeks = Math.max(3, baseWeeks - 1);
  }
  
  return baseWeeks;
}

/**
 * Determine deload strategy based on experience
 */
export function getDeloadStrategy(experience: Experience): 'proactive' | 'reactive' {
  // Novices: use reactive deloads (they don't need as many scheduled deloads)
  // Intermediate/Advanced: use proactive deloads (scheduled in advance)
  return experience === 'novice' ? 'reactive' : 'proactive';
}

// ============================================================
// DELOAD DETECTION HELPERS
// ============================================================

/**
 * Calculate a fatigue score from performance data
 * Higher score = more accumulated fatigue
 */
export function calculateFatigueScore(performance: WeeklyPerformanceData): number {
  let score = 0;
  
  // Perceived fatigue (0-25 points)
  score += (performance.perceivedFatigue - 1) * 6.25;
  
  // Sleep quality inverse (0-25 points)
  score += (5 - performance.sleepQuality) * 6.25;
  
  // Motivation inverse (0-20 points)
  score += (5 - performance.motivationLevel) * 5;
  
  // Missed reps (0-15 points)
  score += Math.min(15, performance.missedReps * 3);
  
  // Joint pain (0-10 points)
  if (performance.jointPain) score += 10;
  
  // Strength decline (0-5 points)
  if (performance.strengthDecline) score += 5;
  
  return Math.min(100, Math.round(score));
}

/**
 * Determine if fatigue score warrants action
 */
export function assessFatigueScore(score: number): {
  level: 'low' | 'moderate' | 'high' | 'critical';
  recommendation: string;
} {
  if (score < 25) {
    return {
      level: 'low',
      recommendation: 'Continue training as planned',
    };
  } else if (score < 50) {
    return {
      level: 'moderate',
      recommendation: 'Monitor closely, consider reducing volume next week',
    };
  } else if (score < 75) {
    return {
      level: 'high',
      recommendation: 'Volume deload recommended soon',
    };
  } else {
    return {
      level: 'critical',
      recommendation: 'Full deload or complete rest recommended immediately',
    };
  }
}

/**
 * Track fatigue trend across multiple weeks
 */
export function analyzeFatigueTrend(performances: WeeklyPerformanceData[]): {
  trend: 'improving' | 'stable' | 'worsening';
  averageScore: number;
  peakScore: number;
  recommendation: string;
} {
  if (performances.length < 2) {
    return {
      trend: 'stable',
      averageScore: 0,
      peakScore: 0,
      recommendation: 'Not enough data to analyze trend',
    };
  }
  
  const scores = performances.map(calculateFatigueScore);
  const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const peakScore = Math.max(...scores);
  
  // Calculate trend direction
  const recentScores = scores.slice(-3);  // Last 3 weeks
  let trend: 'improving' | 'stable' | 'worsening';
  
  if (recentScores.length >= 2) {
    const firstHalf = recentScores.slice(0, Math.ceil(recentScores.length / 2));
    const secondHalf = recentScores.slice(Math.ceil(recentScores.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const diff = secondAvg - firstAvg;
    
    if (diff > 5) {
      trend = 'worsening';
    } else if (diff < -5) {
      trend = 'improving';
    } else {
      trend = 'stable';
    }
  } else {
    trend = 'stable';
  }
  
  // Generate recommendation
  let recommendation: string;
  if (trend === 'worsening' && averageScore > 40) {
    recommendation = 'Fatigue accumulating - schedule deload within 1-2 weeks';
  } else if (trend === 'improving') {
    recommendation = 'Recovery trending well - continue current approach';
  } else if (averageScore > 50) {
    recommendation = 'Sustained high fatigue - consider adjusting training load';
  } else {
    recommendation = 'Fatigue levels manageable - continue as planned';
  }
  
  return {
    trend,
    averageScore: Math.round(averageScore),
    peakScore,
    recommendation,
  };
}

