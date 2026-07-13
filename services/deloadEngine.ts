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
  DiscomfortSeverity,
} from '@/types/schema';
import { DELOAD_MODIFIERS } from '@/services/shared/fatigueConstants';
import {
  wearableDeloadEvidence,
  wearableDeloadPoints,
} from '@/services/wearableRecovery';

// ============================================================
// JOINT PAIN SIGNAL (deload signal 5)
// ============================================================

/**
 * Severity weights for user-initiated joint pain events. A 'stop' (had to
 * abandon the set) counts triple a passing twinge.
 */
export const JOINT_PAIN_SEVERITY_WEIGHTS: Record<DiscomfortSeverity, number> = {
  twinge: 1,
  discomfort: 1,
  pain: 2,
  stop: 3,
};

/** Trailing window over which pain events feed the deload signal. */
export const JOINT_PAIN_WINDOW_DAYS = 14;

/**
 * Cap on the joint-pain contribution to the fatigue score — the same 10 points
 * the legacy boolean contributed, so pain can nudge a deload but never force
 * one single-handedly.
 */
export const JOINT_PAIN_MAX_SCORE = 10;

/** A weighted score at/above this trips deload TRIGGER 5 (≈ one true pain event). */
export const JOINT_PAIN_TRIGGER_THRESHOLD = 4;

/** One joint pain event, as read from joint_pain_events. */
export interface JointPainSignalEvent {
  severity: DiscomfortSeverity;
  occurredAt: Date;
}

/**
 * Deload signal 5: severity-weighted count of joint-pain events in the
 * trailing JOINT_PAIN_WINDOW_DAYS, scaled onto the fatigue score's 0-10 band
 * and capped at JOINT_PAIN_MAX_SCORE.
 */
export function computeJointPainSignal(
  events: JointPainSignalEvent[],
  now: Date
): number {
  const cutoff = now.getTime() - JOINT_PAIN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let weighted = 0;
  for (const event of events) {
    const t = event.occurredAt.getTime();
    if (!Number.isFinite(t) || t < cutoff || t > now.getTime()) continue;
    weighted += JOINT_PAIN_SEVERITY_WEIGHTS[event.severity] ?? 1;
  }
  return Math.min(JOINT_PAIN_MAX_SCORE, weighted * 2);
}

// ============================================================
// CHRONIC SHORT SLEEP SIGNAL (deload signal 7)
// ============================================================

/** Trailing window over which logged sleep feeds the deload signal. */
export const SLEEP_DEBT_WINDOW_DAYS = 7;

/** A trailing average BELOW this many hours reads as chronic short sleep. */
export const SLEEP_DEBT_AVG_THRESHOLD_HOURS = 6.5;

/**
 * Cap on the sleep contribution to the fatigue score — a SMALL bump (under
 * the joint-pain signal's 10) so chronic short sleep can strengthen a deload
 * case but never force one single-handedly.
 */
export const SLEEP_DEBT_MAX_SCORE = 8;

/** Fatigue points per hour of average shortfall below the threshold. */
export const SLEEP_DEBT_POINTS_PER_HOUR = 4;

/** Nights required inside the window before the average is trusted. */
export const SLEEP_DEBT_MIN_NIGHTS = 3;

/** One logged night, as read from sleep_log. */
export interface SleepSignalNight {
  /** YYYY-MM-DD local day the night was logged against. */
  localDay: string;
  hours: number;
}

export interface SleepDebtSignal {
  /** Capped 0-SLEEP_DEBT_MAX_SCORE fatigue-score contribution. */
  score: number;
  /** Trailing average (hours) over the window, or null with too few nights. */
  avgHours: number | null;
  /** Evidence line for the deload reasons list, or null when not triggered. */
  evidence: string | null;
}

/** YYYY-MM-DD for a Date in LOCAL time (matches lib/utils.getLocalDateString). */
function localDayString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Deload signal 7: chronic short sleep. Averages the logged nights in the
 * trailing SLEEP_DEBT_WINDOW_DAYS; an average under
 * SLEEP_DEBT_AVG_THRESHOLD_HOURS yields a small capped score bump plus a
 * labeled evidence line ("Averaging 5.9h sleep over the last week"). Fewer
 * than SLEEP_DEBT_MIN_NIGHTS logged nights → no signal (one rough night is
 * not "chronic").
 */
export function computeSleepDebtSignal(
  nights: SleepSignalNight[],
  now: Date
): SleepDebtSignal {
  const today = localDayString(now);
  const cutoff = localDayString(
    new Date(now.getTime() - (SLEEP_DEBT_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)
  );
  // One entry per local day by construction (sleep_log unique constraint);
  // dedupe defensively anyway so a bad feed can't double-count a night.
  const byDay = new Map<string, number>();
  for (const night of nights) {
    if (night.localDay < cutoff || night.localDay > today) continue;
    if (!Number.isFinite(night.hours) || night.hours < 0) continue;
    byDay.set(night.localDay, night.hours);
  }

  if (byDay.size < SLEEP_DEBT_MIN_NIGHTS) {
    return { score: 0, avgHours: null, evidence: null };
  }

  const hours = Array.from(byDay.values());
  const avgHours = hours.reduce((a, b) => a + b, 0) / hours.length;
  if (avgHours >= SLEEP_DEBT_AVG_THRESHOLD_HOURS) {
    return { score: 0, avgHours, evidence: null };
  }

  const score = Math.min(
    SLEEP_DEBT_MAX_SCORE,
    Math.max(
      1,
      Math.round((SLEEP_DEBT_AVG_THRESHOLD_HOURS - avgHours) * SLEEP_DEBT_POINTS_PER_HOUR)
    )
  );
  return {
    score,
    avgHours,
    evidence: `Averaging ${avgHours.toFixed(1)}h sleep over the last week`,
  };
}

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
  // Either the legacy weekly boolean, or a severity-weighted event score at/
  // above the trigger threshold (≈ one genuine pain event in the window).
  if (lastWeek.jointPain || (lastWeek.jointPainScore ?? 0) >= JOINT_PAIN_TRIGGER_THRESHOLD) {
    reasons.push('Joint pain reported - reduce intensity');
    shouldDeload = true;
    suggestedDeloadType = 'intensity';
  }
  
  // === TRIGGER 6: Time since last deload (backup trigger) ===
  // A deload-flagged week resets accumulation: measure from the most recent
  // deload week rather than mesocycle start, so a light week the user just took
  // (auto-flagged, toggled at finish, or applied retroactively) doesn't leave
  // the detector still nagging "overdue for deload". When no deload is on
  // record, this falls back to weeks since start (weekNumber).
  const lastDeload = [...recentPerformance].reverse().find((w) => w.isDeload);
  const weeksSinceLastDeload = lastDeload
    ? lastWeek.weekNumber - lastDeload.weekNumber
    : lastWeek.weekNumber;
  if (weeksSinceLastDeload >= periodization.deloadFrequency + 2) {
    reasons.push(
      lastDeload
        ? `${weeksSinceLastDeload} weeks since last deload - overdue for deload`
        : `${weeksSinceLastDeload} weeks since mesocycle start - overdue for deload`
    );
    shouldDeload = true;
  }
  
  // === EXPERIENCE ADJUSTMENT ===
  // Novices have less efficient CNS patterns and are more prone to overtraining.
  // They should deload MORE readily, not less. Single trigger is sufficient.
  if (profile.experience === 'novice' && reasons.length >= 1) {
    shouldDeload = true;
  }

  // Advanced lifters are better at self-regulating and have more efficient
  // movement patterns. They can handle more fatigue markers before needing deload.
  if (profile.experience === 'advanced' && reasons.length < 2) {
    shouldDeload = false;
  }

  // === SIGNAL 7: Chronic short sleep (contributing evidence, never forcing) ===
  // Appended AFTER the trigger/experience logic so it can label the evidence
  // list ("Averaging 5.9h sleep…") and bump the fatigue score (see
  // calculateFatigueScore) without ever tripping a deload on its own.
  if (lastWeek.sleepDebtEvidence && (lastWeek.sleepDebtScore ?? 0) > 0) {
    reasons.push(lastWeek.sleepDebtEvidence);
  }

  // === SUPPORTING SIGNAL: sustained wearable deviation (HRV low / RHR high) ===
  // Named in evidence when a deload already fired, but never a trigger on its
  // own — the wearable signal whispers (its weight lives in
  // calculateFatigueScore's small capped contribution). Added after the
  // experience adjustment so it can't flip those decisions.
  const wearableEvidence = wearableDeloadEvidence(lastWeek.wearableDeviationDays ?? 0);
  if (shouldDeload && wearableEvidence) {
    reasons.push(wearableEvidence);
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
// DELOAD_MODIFIERS imported from shared/fatigueConstants.ts

/**
 * Exercise metadata for exercise-aware deload calculations
 */
export interface ExerciseDeloadInfo {
  movementPattern?: string;
  equipment?: string;
  mechanic?: 'compound' | 'isolation';
}

/**
 * Calculate exercise-specific deload modifier
 * Heavy compound movements (squats, deadlifts) need MORE reduction during deload
 * Isolation movements can maintain closer to normal volume/intensity
 */
export function getExerciseDeloadMultiplier(
  exerciseInfo?: ExerciseDeloadInfo
): { volumeMultiplier: number; intensityMultiplier: number } {
  if (!exerciseInfo) {
    return { volumeMultiplier: 1.0, intensityMultiplier: 1.0 };
  }

  let volumeMultiplier = 1.0;
  let intensityMultiplier = 1.0;

  // Movement pattern adjustments
  // Heavy compound movements need more aggressive deload
  const movementAdjustments: Record<string, { volume: number; intensity: number }> = {
    squat: { volume: 0.8, intensity: 0.9 },      // More reduction for squats
    hip_hinge: { volume: 0.75, intensity: 0.85 }, // Most reduction for deadlifts
    horizontal_push: { volume: 0.9, intensity: 0.95 },
    horizontal_pull: { volume: 0.9, intensity: 0.95 },
    vertical_push: { volume: 0.95, intensity: 0.95 },
    vertical_pull: { volume: 0.95, intensity: 0.95 },
    lunge: { volume: 0.9, intensity: 0.95 },
    isolation: { volume: 1.1, intensity: 1.0 },   // Less reduction for isolation
    carry: { volume: 0.85, intensity: 0.9 },
  };

  if (exerciseInfo.movementPattern && movementAdjustments[exerciseInfo.movementPattern]) {
    const adj = movementAdjustments[exerciseInfo.movementPattern];
    volumeMultiplier *= adj.volume;
    intensityMultiplier *= adj.intensity;
  }

  // Equipment adjustments
  // Barbell movements are more taxing and need more deload
  const equipmentAdjustments: Record<string, { volume: number; intensity: number }> = {
    barbell: { volume: 0.9, intensity: 0.95 },
    dumbbell: { volume: 0.95, intensity: 0.98 },
    machine: { volume: 1.1, intensity: 1.0 },     // Machines can maintain more
    cable: { volume: 1.05, intensity: 1.0 },
    bodyweight: { volume: 1.0, intensity: 1.0 },
  };

  if (exerciseInfo.equipment && equipmentAdjustments[exerciseInfo.equipment]) {
    const adj = equipmentAdjustments[exerciseInfo.equipment];
    volumeMultiplier *= adj.volume;
    intensityMultiplier *= adj.intensity;
  }

  // Compound vs isolation
  if (exerciseInfo.mechanic === 'isolation') {
    volumeMultiplier *= 1.1;  // Isolation can keep more volume
  }

  return {
    volumeMultiplier: Math.max(0.6, Math.min(1.2, volumeMultiplier)),
    intensityMultiplier: Math.max(0.75, Math.min(1.0, intensityMultiplier)),
  };
}

/**
 * Generate a deload week based on a template week and deload type
 * Now supports exercise-aware deload modifiers
 */
export function generateDeloadWeek(
  baseWeek: MesocycleWeek,
  deloadType: 'volume' | 'intensity' | 'full',
  exerciseMetadata?: Map<string, ExerciseDeloadInfo>
): MesocycleWeek {
  const mod = DELOAD_MODIFIERS[deloadType];

  const deloadSessions = baseWeek.sessions.map(session => ({
    ...session,
    focus: `DELOAD (${deloadType}) - ${session.focus}`,
    exercises: session.exercises.map(ex => {
      // Get exercise-specific deload multipliers if metadata available
      const exerciseId = ex.exercise?.id;
      const exerciseInfo = exerciseId ? exerciseMetadata?.get(exerciseId) : undefined;
      const exerciseMod = getExerciseDeloadMultiplier(exerciseInfo);

      // Apply both base deload modifier and exercise-specific modifier
      const effectiveVolumeReduction = mod.volume * exerciseMod.volumeMultiplier;
      const effectiveIntensityReduction = mod.intensity * exerciseMod.intensityMultiplier;

      return {
        ...ex,
        sets: Math.max(1, Math.round(ex.sets * effectiveVolumeReduction)),
        reps: {
          ...ex.reps,
          targetRIR: Math.min(4, ex.reps.targetRIR + 2),
          notes: getDeloadNotes(deloadType),
        },
        loadGuidance: deloadType === 'intensity' || deloadType === 'full'
          ? `Reduce load to ${Math.round(effectiveIntensityReduction * 100)}% of normal`
          : ex.loadGuidance,
      };
    }),
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
    baseWeeks = 4;  // Novices need more frequent deloads due to CNS inefficiency
  } else if (profile.trainingAge >= 5) {
    baseWeeks = Math.min(6, baseWeeks + 1);  // Experienced lifters tolerate longer blocks
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
  // Novices: use proactive (scheduled) deloads to prevent overtraining.
  // They often don't recognize fatigue signals, so scheduled deloads are safer.
  // Advanced lifters: use reactive deloads - they are better at reading their body
  // and can respond to fatigue signals as needed.
  return experience === 'advanced' ? 'reactive' : 'proactive';
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
  
  // Joint pain (0-10 points) — the severity-weighted event score when
  // available (signal 5, capped), else the legacy boolean's flat 10.
  if (performance.jointPainScore !== undefined) {
    score += Math.min(JOINT_PAIN_MAX_SCORE, Math.max(0, performance.jointPainScore));
  } else if (performance.jointPain) {
    score += 10;
  }
  
  // Strength decline (0-5 points)
  if (performance.strengthDecline) score += 5;

  // Chronic short sleep (0-8 points) — the capped signal-7 bump from
  // computeSleepDebtSignal (7d avg under 6.5h). Absent = no contribution.
  if (performance.sleepDebtScore !== undefined) {
    score += Math.min(SLEEP_DEBT_MAX_SCORE, Math.max(0, performance.sleepDebtScore));
  }

  // Sustained wearable deviation (0-8 points, capped) — HRV below / resting
  // HR above baseline for 5+ straight days. See services/wearableRecovery.ts.
  score += wearableDeloadPoints(performance.wearableDeviationDays ?? 0);

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

