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
} from '@/types/schema';

// ============================================
// CONSTANTS
// ============================================

/** Minimum weeks of data needed for plateau detection */
const MIN_WEEKS_FOR_ANALYSIS = 4;

/** E1RM improvement threshold for plateau (percentage) */
const PLATEAU_THRESHOLD = 0.02; // 2%

/** Weeks without progress to trigger plateau alert */
const WEEKS_TO_PLATEAU = 3;

// ============================================
// E1RM CALCULATION
// ============================================

/**
 * Calculate Estimated 1 Rep Max using Epley formula
 * Adjusted for RPE (Reps in Reserve)
 */
export function calculateE1RM(
  weight: number,
  reps: number,
  rpe: number = 10
): number {
  if (reps === 0 || weight === 0) return 0;
  if (reps === 1 && rpe === 10) return weight;

  // Calculate RIR and add to reps for effective reps
  const rir = 10 - rpe;
  const effectiveReps = reps + rir;

  // Epley formula: weight * (1 + reps/30)
  return Math.round(weight * (1 + effectiveReps / 30) * 100) / 100;
}

/**
 * Alternative E1RM calculation using Brzycki formula
 * weight / (1.0278 - 0.0278 * reps)
 */
export function calculateE1RMBrzycki(
  weight: number,
  reps: number,
  rpe: number = 10
): number {
  if (reps === 0 || weight === 0) return 0;
  if (reps === 1 && rpe === 10) return weight;

  const rir = 10 - rpe;
  const effectiveReps = reps + rir;

  // Brzycki is only accurate up to ~10 reps
  if (effectiveReps > 10) {
    return calculateE1RM(weight, reps, rpe); // Fall back to Epley
  }

  return Math.round(weight / (1.0278 - 0.0278 * effectiveReps) * 100) / 100;
}

// ============================================
// TREND ANALYSIS
// ============================================

/**
 * Analyze exercise performance trend over time
 */
export function analyzeExerciseTrend(
  snapshots: ExercisePerformanceSnapshot[]
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
  const isPlateaued = checkForPlateau(dataPoints);

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

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  return Math.round(slope * 100) / 100;
}

/**
 * Check if the recent data points indicate a plateau
 */
function checkForPlateau(
  dataPoints: Array<{ date: string; e1rm: number }>
): boolean {
  if (dataPoints.length < MIN_WEEKS_FOR_ANALYSIS) return false;

  // Look at last N weeks
  const recentPoints = dataPoints.slice(-MIN_WEEKS_FOR_ANALYSIS);
  const firstE1RM = recentPoints[0].e1rm;
  const lastE1RM = recentPoints[recentPoints.length - 1].e1rm;

  // Calculate percent change
  const percentChange = (lastE1RM - firstE1RM) / firstE1RM;

  // If less than threshold improvement, it's a plateau
  return percentChange < PLATEAU_THRESHOLD;
}

// ============================================
// PLATEAU DETECTION
// ============================================

export interface DetectPlateauInput {
  exerciseId: string;
  snapshots: ExercisePerformanceSnapshot[];
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

  // Find peak E1RM and when it occurred
  let peakE1RM = 0;
  let peakDate = '';
  for (const s of sorted) {
    if (s.estimatedE1RM > peakE1RM) {
      peakE1RM = s.estimatedE1RM;
      peakDate = s.sessionDate;
    }
  }

  const currentE1RM = sorted[sorted.length - 1].estimatedE1RM;
  const currentDate = new Date(sorted[sorted.length - 1].sessionDate);
  const peakDateTime = new Date(peakDate);

  // Calculate weeks since progress
  const weeksSinceProgress = Math.floor(
    (currentDate.getTime() - peakDateTime.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  // Analyze trend
  const trend = analyzeExerciseTrend(snapshots);
  const isPlateaued = trend.isPlateaued || weeksSinceProgress >= WEEKS_TO_PLATEAU;

  // Generate suggestions if plateaued
  const suggestions = isPlateaued
    ? generatePlateauSuggestions(sorted, trend)
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
  trend: ExerciseTrend
): string[] {
  const suggestions: string[] = [];
  
  if (snapshots.length === 0) return suggestions;

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
  exerciseSnapshots: Map<string, ExercisePerformanceSnapshot[]>
): Map<string, PlateauDetectionResult> {
  const results = new Map<string, PlateauDetectionResult>();

  exerciseSnapshots.forEach((snapshots, exerciseId) => {
    const result = detectPlateau({ exerciseId, snapshots });
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

