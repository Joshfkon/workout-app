/**
 * Plateau Detector
 * 
 * Pure functions for detecting training plateaus and generating suggestions
 * to break through stagnation.
 */

import type {
  ExercisePerformanceSnapshot,
  Exercise,
  ExerciseTrend,
  PlateauAlert,
  Goal,
} from '@/types/schema';
import { estimate1RM } from './shared/strengthCalculations';

/**
 * Some parts of the app (coaching PhaseType, workout page check-in) use
 * 'maintain' where the schema Goal uses 'maintenance'; accept both.
 */
export type PlateauGoal = Goal | 'maintain';

// ============================================
// CONSTANTS
// ============================================

/** Minimum weeks of data needed for plateau detection */
const MIN_WEEKS_FOR_ANALYSIS = 4;

/**
 * Minimum weeks since the in-window peak before any plateau alert fires.
 * The endpoint check below can trip on ~1.3 weeks of data (4 sessions at
 * 3x/wk) — too little signal to call anything a stall.
 */
const MIN_STALL_WEEKS = 3;

/**
 * Regression slope (%/wk of current E1RM) at or above which plateau alerts
 * are suppressed outright. The fitted trend over the whole analysis window
 * wins over the single-peak / endpoint comparisons: a rising lift cannot be
 * plateaued even while sitting below a recent peak.
 */
const RISING_SLOPE_SUPPRESSION_PCT_PER_WEEK = 0.5;

interface GoalPlateauProfile {
  /**
   * E1RM percent change over the recent window below which it's a plateau.
   * Positive = gains expected; negative = only flag an actual decline.
   */
  threshold: number;
  /**
   * Flag after this many weeks without a new peak E1RM.
   * null disables the trigger (no new peaks are expected on a deficit).
   */
  weeksWithoutPeak: number | null;
}

/**
 * What counts as "stalled" depends on the diet phase: on a bulk, flat E1RM
 * is a plateau; on a cut, holding strength IS the goal and only a real
 * decline is worth an alert; recomp sits in between.
 */
const GOAL_PROFILES: Record<Goal, GoalPlateauProfile> = {
  bulk: { threshold: 0.02, weeksWithoutPeak: 3 },
  recomp: { threshold: 0, weeksWithoutPeak: 5 },
  maintenance: { threshold: -0.02, weeksWithoutPeak: null },
  cut: { threshold: -0.03, weeksWithoutPeak: null },
};

/** Pre-goal-awareness behavior, used when no goal is provided. */
const DEFAULT_PROFILE: GoalPlateauProfile = GOAL_PROFILES.bulk;

function resolveProfile(goal?: PlateauGoal): GoalPlateauProfile {
  if (!goal) return DEFAULT_PROFILE;
  const normalized: Goal = goal === 'maintain' ? 'maintenance' : goal;
  return GOAL_PROFILES[normalized] ?? DEFAULT_PROFILE;
}

/**
 * Only sessions within this many weeks of the most recent one are analyzed.
 * Older history (e.g. last year at a different bodyweight) must not set the
 * peak E1RM that current performance is judged against.
 */
const ANALYSIS_WINDOW_WEEKS = 12;

/**
 * No alert when the exercise hasn't been trained within this many weeks of
 * the reference date — an exercise you stopped doing isn't plateaued.
 */
const STALE_AFTER_WEEKS = 6;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================
// E1RM CALCULATION
// ============================================

/**
 * Calculate Estimated 1 Rep Max using multi-formula average
 * Uses shared strength calculations for consistency across the codebase
 * (Brzycki, Epley, Lombardi average for accuracy)
 */
export function calculateE1RM(
  weight: number,
  reps: number,
  rpe: number = 10
): number {
  if (reps === 0 || weight === 0) return 0;
  return estimate1RM(weight, reps, rpe);
}

// ============================================
// TREND ANALYSIS
// ============================================

/**
 * Analyze exercise performance trend over time.
 * Pass the user's diet goal so "stalled" is judged against what the phase
 * can realistically deliver (gains on a bulk, maintenance on a cut).
 */
export function analyzeExerciseTrend(
  snapshots: ExercisePerformanceSnapshot[],
  goal?: PlateauGoal
): ExerciseTrend {
  if (snapshots.length === 0) {
    return {
      exerciseId: '',
      dataPoints: [],
      weeklyChange: 0,
      isPlateaued: false,
    };
  }

  // Sort by date (oldest first)
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()
  );

  const dataPoints = sorted.map((s) => ({
    date: s.sessionDate,
    e1rm: s.estimatedE1RM,
  }));

  // Calculate weekly change (linear regression slope)
  const weeklyChange = calculateWeeklyChange(dataPoints);

  // Determine if plateaued
  const isPlateaued = checkForPlateau(dataPoints, resolveProfile(goal).threshold);

  return {
    exerciseId: snapshots[0].exerciseId,
    dataPoints,
    weeklyChange,
    isPlateaued,
  };
}

/**
 * Calculate average weekly E1RM change using linear regression
 */
function calculateWeeklyChange(
  dataPoints: Array<{ date: string; e1rm: number }>
): number {
  if (dataPoints.length < 2) return 0;

  // Convert dates to week numbers (from first date)
  const firstDate = new Date(dataPoints[0].date);
  const points = dataPoints.map((p) => {
    const date = new Date(p.date);
    const weeks = (date.getTime() - firstDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    return { x: weeks, y: p.e1rm };
  });

  // Simple linear regression
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);

  // Guard against a zero denominator (e.g. all points share the same x / week).
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;

  return Math.round(slope * 100) / 100;
}

/**
 * Check if the recent data points indicate a plateau
 */
function checkForPlateau(
  dataPoints: Array<{ date: string; e1rm: number }>,
  threshold: number
): boolean {
  if (dataPoints.length < MIN_WEEKS_FOR_ANALYSIS) return false;

  // Look at last N weeks
  const recentPoints = dataPoints.slice(-MIN_WEEKS_FOR_ANALYSIS);
  const firstE1RM = recentPoints[0].e1rm;
  const lastE1RM = recentPoints[recentPoints.length - 1].e1rm;

  // Guard against a zero (or invalid) baseline to avoid divide-by-zero.
  if (firstE1RM <= 0) {
    // No meaningful baseline: treat any positive improvement as not plateaued.
    return lastE1RM <= 0;
  }

  // Calculate percent change
  const percentChange = (lastE1RM - firstE1RM) / firstE1RM;

  // If less than the goal-adjusted threshold, it's a plateau
  return percentChange < threshold;
}

// ============================================
// PLATEAU DETECTION
// ============================================

export interface DetectPlateauInput {
  exerciseId: string;
  snapshots: ExercisePerformanceSnapshot[];
  /**
   * "Today" for the staleness check. Callers should pass the current date;
   * defaults to the most recent snapshot date so the function stays
   * deterministic when omitted (tests, historical analysis).
   */
  referenceDate?: string | Date;
  /**
   * Diet phase. Sets expectations: gains on a bulk, holding strength on a
   * cut. Omitted = bulk-like behavior (the pre-goal-awareness default).
   */
  goal?: PlateauGoal;
}

export interface PlateauDetectionResult {
  isPlateaued: boolean;
  weeksSinceProgress: number;
  lastProgressDate: string | null;
  currentE1RM: number;
  peakE1RM: number;
  suggestions: string[];
}

/**
 * Detect if an exercise is in a plateau state
 */
export function detectPlateau(input: DetectPlateauInput): PlateauDetectionResult {
  const { snapshots } = input;

  if (snapshots.length < MIN_WEEKS_FOR_ANALYSIS) {
    return {
      isPlateaued: false,
      weeksSinceProgress: 0,
      lastProgressDate: null,
      currentE1RM: snapshots[snapshots.length - 1]?.estimatedE1RM ?? 0,
      peakE1RM: 0,
      suggestions: [],
    };
  }

  // Sort by date
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()
  );

  const latestDate = new Date(sorted[sorted.length - 1].sessionDate);
  const referenceDate = input.referenceDate
    ? new Date(input.referenceDate)
    : latestDate;

  // Exercise not trained recently: stale history isn't a plateau, it's an
  // exercise the user stopped doing. No alert.
  if (referenceDate.getTime() - latestDate.getTime() > STALE_AFTER_WEEKS * WEEK_MS) {
    return {
      isPlateaued: false,
      weeksSinceProgress: 0,
      lastProgressDate: null,
      currentE1RM: sorted[sorted.length - 1].estimatedE1RM,
      peakE1RM: 0,
      suggestions: [],
    };
  }

  // Only judge against recent training. Sessions older than the analysis
  // window (e.g. last year's heavier-bodyweight peaks) are excluded from
  // both the peak comparison and the trend.
  const windowStart = latestDate.getTime() - ANALYSIS_WINDOW_WEEKS * WEEK_MS;
  const recent = sorted.filter(
    (s) => new Date(s.sessionDate).getTime() >= windowStart
  );

  if (recent.length < MIN_WEEKS_FOR_ANALYSIS) {
    return {
      isPlateaued: false,
      weeksSinceProgress: 0,
      lastProgressDate: null,
      currentE1RM: sorted[sorted.length - 1].estimatedE1RM,
      peakE1RM: 0,
      suggestions: [],
    };
  }

  // Find peak E1RM within the window and when it occurred
  let peakE1RM = 0;
  let peakDate = '';
  for (const s of recent) {
    if (s.estimatedE1RM > peakE1RM) {
      peakE1RM = s.estimatedE1RM;
      peakDate = s.sessionDate;
    }
  }

  const currentE1RM = recent[recent.length - 1].estimatedE1RM;
  const currentDate = new Date(recent[recent.length - 1].sessionDate);
  const peakDateTime = new Date(peakDate);

  // Calculate weeks since progress
  const weeksSinceProgress = Math.floor(
    (currentDate.getTime() - peakDateTime.getTime()) / WEEK_MS
  );

  // Analyze trend against goal-adjusted expectations
  const profile = resolveProfile(input.goal);
  const trend = analyzeExerciseTrend(recent, input.goal);

  // A lift whose regression slope over the window is clearly positive is
  // progressing, full stop — suppress the alert regardless of what the
  // endpoint or peak comparisons say (they see dips a rising lift makes
  // while climbing back toward a recent peak).
  const slopePctPerWeek =
    currentE1RM > 0 ? (trend.weeklyChange / currentE1RM) * 100 : 0;
  const isRising = slopePctPerWeek >= RISING_SLOPE_SUPPRESSION_PCT_PER_WEEK;

  const isPlateaued =
    !isRising &&
    weeksSinceProgress >= MIN_STALL_WEEKS &&
    (trend.isPlateaued ||
      (profile.weeksWithoutPeak !== null &&
        weeksSinceProgress >= profile.weeksWithoutPeak));

  // Generate suggestions if plateaued
  const suggestions = isPlateaued
    ? generatePlateauSuggestions(recent, trend, input.goal)
    : [];

  return {
    isPlateaued,
    weeksSinceProgress,
    lastProgressDate: peakDate,
    currentE1RM,
    peakE1RM,
    suggestions,
  };
}

// ============================================
// PLATEAU SUGGESTIONS
// ============================================

/**
 * Generate suggestions to break through a plateau
 */
export function generatePlateauSuggestions(
  snapshots: ExercisePerformanceSnapshot[],
  trend: ExerciseTrend,
  goal?: PlateauGoal
): string[] {
  const suggestions: string[] = [];

  if (snapshots.length === 0) return suggestions;

  // On a deficit, being flagged means strength is actually dropping — lead
  // with the diet-side levers before the usual training tweaks.
  if (goal === 'cut') {
    suggestions.push(
      'Strength is dropping faster than a cut should cost - check the deficit is not too aggressive and keep protein high'
    );
  } else if (goal === 'maintenance' || goal === 'maintain') {
    suggestions.push(
      'Strength is slipping at maintenance - verify calories are actually at maintenance and recovery is on point'
    );
  }

  // Analyze recent training patterns
  const recent = snapshots.slice(-6);
  const avgReps = recent.reduce((a, s) => a + s.topSetReps, 0) / recent.length;
  const avgRpe = recent.reduce((a, s) => a + s.topSetRpe, 0) / recent.length;
  const avgSets = recent.reduce((a, s) => a + s.totalWorkingSets, 0) / recent.length;

  // Rep range change suggestion
  if (avgReps > 10) {
    suggestions.push(
      'Try a lower rep range (5-8 reps) with heavier weight to build strength'
    );
  } else if (avgReps < 6) {
    suggestions.push(
      'Try a higher rep range (10-15 reps) to stimulate muscle through different mechanism'
    );
  } else {
    suggestions.push(
      'Consider cycling between strength (5-6 reps) and hypertrophy (10-12 reps) phases'
    );
  }

  // Volume suggestion
  if (avgSets < 3) {
    suggestions.push('Increase volume by adding 1-2 more working sets');
  } else if (avgSets > 4) {
    suggestions.push(
      'Consider reducing sets and increasing intensity - quality over quantity'
    );
  }

  // RPE/intensity suggestion
  if (avgRpe < 7) {
    suggestions.push(
      'Push closer to failure (RPE 8-9) - you may have room to work harder'
    );
  } else if (avgRpe > 9) {
    suggestions.push(
      'Consider backing off intensity slightly - constant failure can impede recovery'
    );
  }

  // Exercise variation suggestion
  suggestions.push(
    'Try a variation or similar exercise to provide a novel stimulus'
  );

  // Technique suggestion
  suggestions.push(
    'Film your sets and review technique - small improvements can unlock progress'
  );

  // Recovery suggestion
  if (trend.weeklyChange <= 0) {
    suggestions.push(
      'Check recovery factors: sleep, nutrition, and stress. Plateau can indicate under-recovery'
    );
  }

  return suggestions.slice(0, 5); // Return top 5 suggestions
}

/**
 * Create a PlateauAlert object from detection result
 */
export function createPlateauAlert(
  userId: string,
  exerciseId: string,
  result: PlateauDetectionResult
): PlateauAlert | null {
  if (!result.isPlateaued) return null;

  return {
    id: '', // Will be assigned by database
    userId,
    exerciseId,
    detectedAt: new Date().toISOString(),
    weeksSinceProgress: result.weeksSinceProgress,
    suggestedActions: result.suggestions,
    dismissed: false,
  };
}

// ============================================
// BATCH ANALYSIS
// ============================================

/**
 * Analyze all exercises for a user and detect plateaus
 */
export function analyzeAllExercises(
  exerciseSnapshots: Map<string, ExercisePerformanceSnapshot[]>,
  referenceDate?: string | Date,
  goal?: PlateauGoal
): Map<string, PlateauDetectionResult> {
  const results = new Map<string, PlateauDetectionResult>();

  exerciseSnapshots.forEach((snapshots, exerciseId) => {
    const result = detectPlateau({ exerciseId, snapshots, referenceDate, goal });
    results.set(exerciseId, result);
  });

  return results;
}

/**
 * Get exercises with plateaus, sorted by severity
 */
export function getPlateauedExercises(
  results: Map<string, PlateauDetectionResult>
): Array<{ exerciseId: string; result: PlateauDetectionResult }> {
  const plateaued: Array<{ exerciseId: string; result: PlateauDetectionResult }> = [];

  results.forEach((result, exerciseId) => {
    if (result.isPlateaued) {
      plateaued.push({ exerciseId, result });
    }
  });

  // Sort by weeks since progress (worst first)
  plateaued.sort((a, b) => b.result.weeksSinceProgress - a.result.weeksSinceProgress);

  return plateaued;
}

/**
 * Calculate overall progress score for a set of exercises
 * Returns 0-100 where 100 = all exercises progressing well
 */
export function calculateProgressScore(
  results: Map<string, PlateauDetectionResult>
): number {
  if (results.size === 0) return 100;

  let totalScore = 0;
  
  results.forEach((result) => {
    if (result.isPlateaued) {
      // Penalize based on how long the plateau has lasted
      const penalty = Math.min(50, result.weeksSinceProgress * 10);
      totalScore += 50 - penalty;
    } else {
      totalScore += 100;
    }
  });

  return Math.round(totalScore / results.size);
}

