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
import { e1rmValueFromRpe } from './shared/e1rm';
import { computeTrend, type TrendOptions } from './shared/trend';

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
 * Estimated 1RM for plateau/trend snapshots — delegates to THE canonical
 * estimator (services/shared/e1rm), same as every other e1RM surface. The
 * old private multi-formula average here was one of the divergent
 * implementations the e1rm consolidation retired; a plateau verdict computed
 * from a different e1RM than the history card displays produced
 * self-contradicting banners.
 *
 * RPE-aware on purpose: same load, same reps at a lower RPE is a HIGHER
 * estimate — set-level progress the old RPE-blind comparison discarded.
 * Returns 0 for "no estimate" (aggregation convention; never display the 0).
 */
export function calculateE1RM(
  weight: number,
  reps: number,
  rpe: number = 10
): number {
  return e1rmValueFromRpe(weight, reps, rpe);
}

// ============================================
// TREND ANALYSIS
// ============================================

/**
 * Sessions required after a detected discontinuity (equipment change, etc.)
 * before the fitted trend is trusted again — mirrors liftTrends'
 * MIN_SESSIONS_FOR_TREND so every strength surface rebuilds over the same
 * 2–3 sessions the "Calibrating" copy promises.
 */
export const MIN_SESSIONS_AFTER_DISCONTINUITY = 3;

/**
 * Shared robust-trend options for per-session e1RM series: ~2 sessions/week
 * means a weekly rate is meaningful from ~10 observed days, and a lift
 * untrained for 6+ weeks mid-window makes the fit low-confidence.
 */
const E1RM_TREND_OPTIONS: TrendOptions = {
  minPoints: 2,
  lowConfidenceSpanDays: 10,
  lowConfidenceGapDays: 45,
  // Session-to-session e1RM legitimately wobbles several percent — only
  // clearly-implausible jumps (fat-fingered loads) are outliers.
  minResidualFraction: 0.03,
  label: 'e1rm',
};

export interface ExerciseTrendOptions {
  /**
   * Session dates the USER explicitly marked as "different equipment" — a
   * permanent segment boundary, far more reliable than the heuristic (which
   * still runs as a backstop). Persisted on exercise_blocks.equipment_changed.
   */
  knownDiscontinuities?: Array<string | Date>;
}

/**
 * Analyze exercise performance trend over time via the canonical robust
 * estimator (services/shared/trend): Theil–Sen over elapsed days, corrupt
 * values hard-rejected, outliers MAD-excluded, and equipment-change level
 * shifts segmenting the fit instead of being smoothed into a fake decline.
 * Pass the user's diet goal so "stalled" is judged against what the phase
 * can realistically deliver (gains on a bulk, maintenance on a cut).
 */
export function analyzeExerciseTrend(
  snapshots: ExercisePerformanceSnapshot[],
  goal?: PlateauGoal,
  options?: ExerciseTrendOptions
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

  const trend = computeTrend(dataPoints.map((p) => ({ date: p.date, value: p.e1rm })), {
    ...E1RM_TREND_OPTIONS,
    knownDiscontinuities: options?.knownDiscontinuities,
  });

  const usedPoints = trend.usedIndices.map((i) => dataPoints[i]);

  // Plateau check runs on the points the fit actually used — a corrupt zero
  // or a pre-equipment-change level must not set the comparison baseline.
  const isPlateaued = checkForPlateau(usedPoints, resolveProfile(goal).threshold);

  return {
    exerciseId: snapshots[0].exerciseId,
    dataPoints,
    weeklyChange: Math.round(trend.slopePerWeek * 100) / 100,
    isPlateaued,
    confidence: trend.confidence,
    excludedDates: trend.excludedIndices.map((i) => dataPoints[i].date),
    discontinuityDate:
      trend.discontinuityIndex != null ? dataPoints[trend.discontinuityIndex].date : null,
    pointsUsed: trend.nPoints,
  };
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
  /** User-marked equipment-change boundaries — see ExerciseTrendOptions. */
  knownDiscontinuities?: Array<string | Date>;
}

export interface PlateauDetectionResult {
  isPlateaued: boolean;
  /**
   * True while the lift's trend is rebuilding after a detected data
   * discontinuity (e.g. equipment change): fewer than
   * MIN_SESSIONS_AFTER_DISCONTINUITY sessions at the new level. A
   * calibrating lift NEVER fires a plateau — set-level context is missing,
   * not progress.
   */
  isCalibrating: boolean;
  /** Set when isCalibrating: what interrupted the trend. */
  calibrationReason: 'equipment_change' | null;
  weeksSinceProgress: number;
  lastProgressDate: string | null;
  currentE1RM: number;
  /**
   * PEAK VOCABULARY — three different "peaks" exist and every surface must
   * say which one it means (the old single `peakE1RM` let one banner claim
   * "0.0 from peak" beside an all-time-best stat 15 lbs higher):
   *  - allTimeBest: max over FULL history, all segments — NOT computed here
   *    (this function only sees the analysis window); history surfaces own it.
   *  - segmentBestE1RM: max within the current calibration segment (after
   *    the last detected discontinuity, full passed history).
   *  - recentPeakE1RM: max within the active trend window (the last
   *    ANALYSIS_WINDOW_WEEKS, post-discontinuity, outliers excluded). This
   *    is what weeksSinceProgress counts from.
   */
  recentPeakE1RM: number;
  segmentBestE1RM: number;
  /**
   * @deprecated Alias of recentPeakE1RM (the analysis-window peak). Kept so
   * existing readers don't silently break; new code must use the explicit
   * vocabulary above.
   */
  peakE1RM: number;
  /** Session date of the discontinuity the segment is anchored to, if any. */
  discontinuityDate: string | null;
  suggestions: string[];
}

/** The no-alert result shape (insufficient data / stale / calibrating). */
function noAlert(
  currentE1RM: number,
  overrides: Partial<PlateauDetectionResult> = {}
): PlateauDetectionResult {
  return {
    isPlateaued: false,
    isCalibrating: false,
    calibrationReason: null,
    weeksSinceProgress: 0,
    lastProgressDate: null,
    currentE1RM,
    recentPeakE1RM: 0,
    segmentBestE1RM: 0,
    peakE1RM: 0,
    discontinuityDate: null,
    suggestions: [],
    ...overrides,
  };
}

/**
 * Detect if an exercise is in a plateau state
 */
export function detectPlateau(input: DetectPlateauInput): PlateauDetectionResult {
  const { snapshots } = input;

  if (snapshots.length < MIN_WEEKS_FOR_ANALYSIS) {
    return noAlert(snapshots[snapshots.length - 1]?.estimatedE1RM ?? 0);
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
    return noAlert(sorted[sorted.length - 1].estimatedE1RM);
  }

  // Only judge against recent training. Sessions older than the analysis
  // window (e.g. last year's heavier-bodyweight peaks) are excluded from
  // both the peak comparison and the trend.
  const windowStart = latestDate.getTime() - ANALYSIS_WINDOW_WEEKS * WEEK_MS;
  const recent = sorted.filter(
    (s) => new Date(s.sessionDate).getTime() >= windowStart
  );

  if (recent.length < MIN_WEEKS_FOR_ANALYSIS) {
    return noAlert(sorted[sorted.length - 1].estimatedE1RM);
  }

  // Robust trend over the window (Theil–Sen, outliers excluded, level shifts
  // segmenting the fit — see analyzeExerciseTrend).
  const profile = resolveProfile(input.goal);
  const trend = analyzeExerciseTrend(recent, input.goal, {
    knownDiscontinuities: input.knownDiscontinuities,
  });
  const discontinuityDate = trend.discontinuityDate ?? null;

  // Segment best: max within the CURRENT calibration segment over the full
  // passed history (not just the analysis window) — the honest "best" once
  // an equipment change makes pre-shift numbers incomparable.
  const segmentSnapshots = discontinuityDate
    ? sorted.filter(
        (s) =>
          new Date(s.sessionDate).getTime() >=
          new Date(discontinuityDate).getTime()
      )
    : sorted;
  const segmentBestE1RM = segmentSnapshots.reduce(
    (max, s) => Math.max(max, s.estimatedE1RM),
    0
  );

  // Recent peak: max over the points the fit actually USED (window ∩ current
  // segment, outliers excluded) — a corrupt spike or a pre-shift level must
  // not set the bar that "weeks since progress" counts from.
  const excludedDates = new Set(trend.excludedDates ?? []);
  const usable = recent.filter((s) => {
    if (excludedDates.has(s.sessionDate)) return false;
    if (!discontinuityDate) return true;
    return new Date(s.sessionDate).getTime() >= new Date(discontinuityDate).getTime();
  });

  const currentE1RM = recent[recent.length - 1].estimatedE1RM;

  // Trend still rebuilding after a discontinuity: verdicts wait. This is the
  // Cable Fly fix — a 57.5 → 40 stack-relabel must produce "Calibrating",
  // never "No progress in 4 weeks" measured against the old machine.
  if (discontinuityDate && usable.length < MIN_SESSIONS_AFTER_DISCONTINUITY) {
    return noAlert(currentE1RM, {
      isCalibrating: true,
      calibrationReason: 'equipment_change',
      segmentBestE1RM,
      discontinuityDate,
    });
  }

  let recentPeakE1RM = 0;
  let peakDate = '';
  for (const s of usable) {
    if (s.estimatedE1RM > recentPeakE1RM) {
      recentPeakE1RM = s.estimatedE1RM;
      peakDate = s.sessionDate;
    }
  }

  const currentDate = new Date(recent[recent.length - 1].sessionDate);
  const peakDateTime = new Date(peakDate);

  // Calculate weeks since progress
  const weeksSinceProgress = Math.floor(
    (currentDate.getTime() - peakDateTime.getTime()) / WEEK_MS
  );

  // A lift whose regression slope over the window is clearly positive is
  // progressing, full stop — suppress the alert regardless of what the
  // endpoint or peak comparisons say (they see dips a rising lift makes
  // while climbing back toward a recent peak).
  const slopePctPerWeek =
    currentE1RM > 0 ? (trend.weeklyChange / currentE1RM) * 100 : 0;
  const isRising = slopePctPerWeek >= RISING_SLOPE_SUPPRESSION_PCT_PER_WEEK;

  // The endpoint/peak comparisons also need enough USED points to mean
  // anything (the raw window count can be padded with excluded outliers).
  const hasEnoughUsable = usable.length >= MIN_WEEKS_FOR_ANALYSIS;

  const isPlateaued =
    !isRising &&
    hasEnoughUsable &&
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
    isCalibrating: false,
    calibrationReason: null,
    weeksSinceProgress,
    lastProgressDate: peakDate || null,
    currentE1RM,
    recentPeakE1RM,
    segmentBestE1RM,
    peakE1RM: recentPeakE1RM,
    discontinuityDate,
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

