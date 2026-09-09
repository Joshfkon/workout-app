/**
 * In-Workout Signal Detection
 *
 * Deterministic, rule-based detection of meaningful workout events that warrant
 * coach interruption. All logic is local/pure — no API calls, no async operations.
 * The LLM is called ONLY for natural language phrasing of detected signals.
 */

import type { SetLog } from '@/types/schema';
import { rirToRpe } from '@/types/schema';
import { getSetReps } from '@/services/shared/setModality';

export type SignalType =
  | 'big_drop'        // Significant performance drop vs last session
  | 'rpe_ceiling'     // Multiple consecutive sets at RPE 10
  | 'crushing_it'     // Exceeding last session performance
  | 'pain_logged'     // Joint pain just logged
  | 'fatigue_warning' // Signs of excessive fatigue
  | 'form_breakdown'  // Multiple ugly form ratings;

export interface WorkoutSignal {
  type: SignalType;
  severity: 'info' | 'warning' | 'alert';
  exerciseName: string;
  message: string;
  details: string;
  timestamp: Date;
}

export interface SessionStats {
  avgWeight: number;
  avgReps: number;
  avgRpe: number;
  totalSets: number;
}

export interface ExerciseContext {
  exerciseName: string;
  setsToday: SetLog[];
  lastSessionSets?: SetLog[];
  lastSessionDate?: string;
}

/**
 * Detect big performance drop vs last session
 */
export function detectBigDrop(context: ExerciseContext): WorkoutSignal | null {
  if (!context.lastSessionSets || context.lastSessionSets.length === 0 || context.setsToday.length < 2) {
    return null;
  }

  const todayStats = calculateStats(context.setsToday);
  const lastStats = calculateStats(context.lastSessionSets);

  // Check for significant weight drop (>10% or >10kg/20lb)
  const weightDropPercent = ((lastStats.avgWeight - todayStats.avgWeight) / lastStats.avgWeight) * 100;
  const weightDropAbs = lastStats.avgWeight - todayStats.avgWeight;

  if (weightDropPercent > 10 && weightDropAbs > 5) {
    return {
      type: 'big_drop',
      severity: 'warning',
      exerciseName: context.exerciseName,
      message: `Down ${weightDropAbs.toFixed(0)}kg from last session`,
      details: `Performance drop detected: ${todayStats.avgWeight.toFixed(1)}kg today vs ${lastStats.avgWeight.toFixed(1)}kg last time (${weightDropPercent.toFixed(0)}% drop)`,
      timestamp: new Date(),
    };
  }

  // Check for significant rep drop with same weight
  const repDrop = lastStats.avgReps - todayStats.avgReps;
  const weightSimilar = Math.abs(todayStats.avgWeight - lastStats.avgWeight) < 2;

  if (weightSimilar && repDrop >= 3) {
    return {
      type: 'big_drop',
      severity: 'warning',
      exerciseName: context.exerciseName,
      message: `${repDrop} fewer reps than last session at same weight`,
      details: `Rep drop: ${todayStats.avgReps.toFixed(1)} today vs ${lastStats.avgReps.toFixed(1)} last time`,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Detect RPE ceiling - multiple consecutive sets at RPE 10
 */
export function detectRpeCeiling(context: ExerciseContext): WorkoutSignal | null {
  if (context.setsToday.length < 2) {
    return null;
  }

  // Get last 3 working sets (skip warmups)
  const workingSets = context.setsToday
    .filter(s => !s.isWarmup)
    .slice(-3);

  if (workingSets.length < 2) {
    return null;
  }

  const allMaxedOut = workingSets.every(s => {
    const rpe = s.feedback?.repsInTank !== null && s.feedback?.repsInTank !== undefined 
      ? rirToRpe(s.feedback.repsInTank) 
      : s.rpe;
    return rpe !== null && rpe !== undefined && rpe >= 10;
  });

  if (allMaxedOut) {
    return {
      type: 'rpe_ceiling',
      severity: 'alert',
      exerciseName: context.exerciseName,
      message: `${workingSets.length} sets at RPE 10 — consider dropping weight`,
      details: `Consecutive maximal effort sets detected. Load may be too high for productive training.`,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Detect crushing performance - exceeding last session
 */
export function detectCrushingIt(context: ExerciseContext): WorkoutSignal | null {
  if (!context.lastSessionSets || context.lastSessionSets.length === 0 || context.setsToday.length < 2) {
    return null;
  }

  const todayStats = calculateStats(context.setsToday);
  const lastStats = calculateStats(context.lastSessionSets);

  // Check for weight increase with similar reps
  const weightIncrease = todayStats.avgWeight - lastStats.avgWeight;
  const repDelta = Math.abs(todayStats.avgReps - lastStats.avgReps);

  if (weightIncrease >= 5 && repDelta <= 1) {
    return {
      type: 'crushing_it',
      severity: 'info',
      exerciseName: context.exerciseName,
      message: `Up ${weightIncrease.toFixed(0)}kg from last time — solid progress`,
      details: `Weight progression: ${todayStats.avgWeight.toFixed(1)}kg today vs ${lastStats.avgWeight.toFixed(1)}kg last session`,
      timestamp: new Date(),
    };
  }

  // Check for rep increase with similar weight
  const repIncrease = todayStats.avgReps - lastStats.avgReps;
  const weightSimilar = Math.abs(todayStats.avgWeight - lastStats.avgWeight) < 2;

  if (weightSimilar && repIncrease >= 3) {
    return {
      type: 'crushing_it',
      severity: 'info',
      exerciseName: context.exerciseName,
      message: `${repIncrease.toFixed(0)} more reps than last session — nice`,
      details: `Rep progression: ${todayStats.avgReps.toFixed(1)} today vs ${lastStats.avgReps.toFixed(1)} last time`,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Detect pain signal from set discomfort
 */
export function detectPainSignal(
  exerciseName: string,
  discomfort: { joint: string; severity: 1 | 2 | 3 } | null
): WorkoutSignal | null {
  if (!discomfort) {
    return null;
  }

  const severityLabel = discomfort.severity === 3 ? 'significant' : discomfort.severity === 2 ? 'moderate' : 'mild';
  const joint = discomfort.joint.replace('_', ' ');

  return {
    type: 'pain_logged',
    severity: discomfort.severity >= 2 ? 'alert' : 'warning',
    exerciseName,
    message: `${severityLabel} ${joint} discomfort — consider form check`,
    details: `Pain logged: ${joint}, severity ${discomfort.severity}/3`,
    timestamp: new Date(),
  };
}

/**
 * Detect form breakdown pattern
 */
export function detectFormBreakdown(context: ExerciseContext): WorkoutSignal | null {
  if (context.setsToday.length < 2) {
    return null;
  }

  // Get last 3 working sets
  const workingSets = context.setsToday
    .filter(s => !s.isWarmup)
    .slice(-3);

  if (workingSets.length < 2) {
    return null;
  }

  const uglyCount = workingSets.filter(s => s.form_rating === 'ugly').length;

  if (uglyCount >= 2) {
    return {
      type: 'form_breakdown',
      severity: 'warning',
      exerciseName: context.exerciseName,
      message: `Form breaking down — consider dropping weight`,
      details: `${uglyCount}/${workingSets.length} recent sets with ugly form`,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Detect fatigue warning from RPE trend
 */
export function detectFatigueWarning(context: ExerciseContext): WorkoutSignal | null {
  if (context.setsToday.length < 3) {
    return null;
  }

  // Get all working sets
  const workingSets = context.setsToday.filter(s => !s.isWarmup);

  if (workingSets.length < 3) {
    return null;
  }

  // Calculate RPE trend - are later sets getting harder despite lower weight?
  const firstSet = workingSets[0];
  const lastSets = workingSets.slice(-2);

  const firstRpe = firstSet.feedback?.repsInTank !== null && firstSet.feedback?.repsInTank !== undefined 
    ? rirToRpe(firstSet.feedback.repsInTank) 
    : firstSet.rpe ?? 7;
  const lastRpes = lastSets.map(s => s.feedback?.repsInTank !== null && s.feedback?.repsInTank !== undefined 
    ? rirToRpe(s.feedback.repsInTank) 
    : s.rpe ?? 7);
  const avgLastRpe = lastRpes.reduce((sum, r) => sum + r, 0) / lastRpes.length;

  const firstWeight = firstSet.weight_kg;
  const avgLastWeight = lastSets.reduce((sum, s) => sum + s.weight_kg, 0) / lastSets.length;

  // If RPE increased by 1.5+ despite weight drop, flag fatigue
  const rpeIncrease = avgLastRpe - firstRpe;
  const weightDecrease = firstWeight - avgLastWeight;

  if (rpeIncrease >= 1.5 && weightDecrease > 2) {
    return {
      type: 'fatigue_warning',
      severity: 'warning',
      exerciseName: context.exerciseName,
      message: `RPE climbing despite lighter weight — check fatigue`,
      details: `RPE trend: ${firstRpe.toFixed(1)} → ${avgLastRpe.toFixed(1)} while weight decreased ${weightDecrease.toFixed(1)}kg`,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Check all signals for an exercise
 */
export function detectExerciseSignals(context: ExerciseContext): WorkoutSignal[] {
  const signals: WorkoutSignal[] = [];

  const drop = detectBigDrop(context);
  if (drop) signals.push(drop);

  const ceiling = detectRpeCeiling(context);
  if (ceiling) signals.push(ceiling);

  const crushing = detectCrushingIt(context);
  if (crushing) signals.push(crushing);

  const form = detectFormBreakdown(context);
  if (form) signals.push(form);

  const fatigue = detectFatigueWarning(context);
  if (fatigue) signals.push(fatigue);

  return signals;
}

/**
 * Calculate session statistics
 */
function calculateStats(sets: SetLog[]): SessionStats {
  const workingSets = sets.filter(s => !s.isWarmup);

  if (workingSets.length === 0) {
    return { avgWeight: 0, avgReps: 0, avgRpe: 7, totalSets: 0 };
  }

  const totalWeight = workingSets.reduce((sum, s) => sum + s.weight_kg, 0);
  // Use getSetReps helper - returns null for duration exercises (which we skip for progress calculation)
  const totalReps = workingSets.reduce((sum, s) => {
    const reps = getSetReps(s, null); // null exercise context: signals are always rep-based in current use
    return sum + (reps ?? 0);
  }, 0);
  const totalRpe = workingSets.reduce((sum, s) => {
    const rpe = s.feedback?.repsInTank !== null && s.feedback?.repsInTank !== undefined 
      ? rirToRpe(s.feedback.repsInTank) 
      : s.rpe ?? 7;
    return sum + rpe;
  }, 0);

  return {
    avgWeight: totalWeight / workingSets.length,
    avgReps: totalReps / workingSets.length,
    avgRpe: totalRpe / workingSets.length,
    totalSets: workingSets.length,
  };
}

/**
 * Should we show a whisper for this exercise?
 */
export function shouldShowWhisper(context: ExerciseContext): boolean {
  // Show after ~2 working sets are completed, or when user focuses the exercise
  const workingSets = context.setsToday.filter(s => !s.isWarmup);
  return workingSets.length >= 2;
}

/**
 * Calculate exercise progress vs last session
 */
export function calculateExerciseProgress(context: ExerciseContext): {
  trend: 'up' | 'down' | 'flat';
  delta: string;
} | null {
  if (!context.lastSessionSets || context.lastSessionSets.length === 0 || context.setsToday.length === 0) {
    return null;
  }

  const todayStats = calculateStats(context.setsToday);
  const lastStats = calculateStats(context.lastSessionSets);

  const weightDelta = todayStats.avgWeight - lastStats.avgWeight;
  const repDelta = todayStats.avgReps - lastStats.avgReps;

  if (Math.abs(weightDelta) >= 2.5) {
    return {
      trend: weightDelta > 0 ? 'up' : 'down',
      delta: `${Math.abs(weightDelta).toFixed(1)}kg`,
    };
  }

  if (Math.abs(repDelta) >= 2) {
    return {
      trend: repDelta > 0 ? 'up' : 'down',
      delta: `${Math.abs(repDelta).toFixed(0)} reps`,
    };
  }

  return {
    trend: 'flat',
    delta: 'similar to last time',
  };
}
