/**
 * Progression Insights
 *
 * Pure functions that classify how an exercise (and, rolled up, a muscle
 * group) is progressing relative to what's expected for the user's
 * experience level: are they adding weight/reps as fast as expected,
 * faster, slower, or not at all (plateau)?
 *
 * Builds on plateauDetector's trend analysis (linear-regression E1RM slope)
 * and adds an expectation baseline so the UI can say "ahead of pace" /
 * "on track" / "behind pace" instead of only "plateaued or not".
 *
 * ANALYSIS-ONLY: like performanceTracker, this module never prescribes
 * weights. It produces display classifications.
 */

import type { Experience, ExercisePerformanceSnapshot } from '@/types/schema';
import { analyzeExerciseTrend, detectPlateau, type PlateauGoal } from './plateauDetector';

// ============================================
// CONSTANTS
// ============================================

/** Minimum sessions of history before we classify a pace */
export const MIN_SESSIONS_FOR_INSIGHT = 3;

/**
 * Expected weekly E1RM gain (% of current E1RM) by experience level.
 * Rough, evidence-informed rates: novices can gain ~1%/week on a lift,
 * intermediates ~0.3%/week, advanced lifters ~0.15%/week.
 */
export const EXPECTED_WEEKLY_E1RM_GAIN_PCT: Record<Experience, number> = {
  novice: 1.0,
  intermediate: 0.3,
  advanced: 0.15,
};

/** Actual/expected ratio at or above which the lifter is "ahead" */
const AHEAD_RATIO = 1.25;

/** Actual/expected ratio at or above which the lifter is "on track" */
const ON_TRACK_RATIO = 0.5;

// ============================================
// TYPES
// ============================================

export type ProgressionPace =
  | 'ahead'
  | 'on_track'
  | 'behind'
  | 'plateaued'
  | 'insufficient_data';

export interface ExerciseProgressionInsight {
  exerciseId: string;
  pace: ProgressionPace;
  /** E1RM change per week as % of current E1RM (regression slope) */
  weeklyChangePct: number;
  /** E1RM change per week in kg (regression slope) */
  weeklyChangeKg: number;
  /** Expected weekly gain % for the experience level */
  expectedWeeklyPct: number;
  currentE1RM: number;
  isPlateaued: boolean;
  sessionsAnalyzed: number;
  /** Top-set change vs the previous session (undefined with <2 sessions) */
  lastSessionDelta?: {
    weightKg: number;
    reps: number;
  };
}

export interface MuscleGroupProgression {
  muscleGroup: string;
  pace: ProgressionPace;
  /** Average weekly E1RM change % across exercises with enough data */
  avgWeeklyChangePct: number;
  expectedWeeklyPct: number;
  exerciseCount: number;
  /** Exercises with enough history to classify */
  analyzedCount: number;
  plateauedCount: number;
  insights: ExerciseProgressionInsight[];
}

// ============================================
// PER-EXERCISE INSIGHT
// ============================================

export interface GetExerciseProgressionInput {
  exerciseId: string;
  snapshots: ExercisePerformanceSnapshot[];
  experience: Experience;
  /** "Today" for plateau staleness checks; defaults inside plateauDetector */
  referenceDate?: string | Date;
  /** Diet phase — forwarded to plateauDetector's goal-aware thresholds */
  goal?: PlateauGoal;
}

/**
 * Classify how a single exercise is progressing vs expectation.
 */
export function getExerciseProgression(
  input: GetExerciseProgressionInput
): ExerciseProgressionInsight {
  const { exerciseId, snapshots, experience, referenceDate, goal } = input;
  const expectedWeeklyPct = EXPECTED_WEEKLY_E1RM_GAIN_PCT[experience];

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()
  );

  const currentE1RM = sorted.length > 0 ? sorted[sorted.length - 1].estimatedE1RM : 0;

  const lastSessionDelta =
    sorted.length >= 2
      ? {
          weightKg:
            sorted[sorted.length - 1].topSetWeightKg -
            sorted[sorted.length - 2].topSetWeightKg,
          reps:
            sorted[sorted.length - 1].topSetReps -
            sorted[sorted.length - 2].topSetReps,
        }
      : undefined;

  if (sorted.length < MIN_SESSIONS_FOR_INSIGHT) {
    return {
      exerciseId,
      pace: 'insufficient_data',
      weeklyChangePct: 0,
      weeklyChangeKg: 0,
      expectedWeeklyPct,
      currentE1RM,
      isPlateaued: false,
      sessionsAnalyzed: sorted.length,
      lastSessionDelta,
    };
  }

  const trend = analyzeExerciseTrend(sorted, goal);
  const plateau = detectPlateau({ exerciseId, snapshots: sorted, referenceDate, goal });

  const weeklyChangeKg = trend.weeklyChange;
  const weeklyChangePct =
    currentE1RM > 0 ? Math.round((weeklyChangeKg / currentE1RM) * 1000) / 10 : 0;

  // Pace from the trend ratio first. The plateau flag only decides the
  // weak cases: plateauDetector's threshold (<2% over ~4 sessions) would
  // otherwise label a normally-progressing intermediate/advanced lifter
  // as plateaued even when they're gaining exactly at the expected rate.
  const ratio = weeklyChangePct / expectedWeeklyPct;
  let pace: ProgressionPace;
  if (ratio >= AHEAD_RATIO) {
    pace = 'ahead';
  } else if (ratio >= ON_TRACK_RATIO) {
    pace = 'on_track';
  } else if (plateau.isPlateaued) {
    pace = 'plateaued';
  } else {
    pace = 'behind';
  }

  return {
    exerciseId,
    pace,
    weeklyChangePct,
    weeklyChangeKg: Math.round(weeklyChangeKg * 100) / 100,
    expectedWeeklyPct,
    currentE1RM,
    isPlateaued: plateau.isPlateaued,
    sessionsAnalyzed: sorted.length,
    lastSessionDelta,
  };
}

// ============================================
// MUSCLE GROUP ROLLUP
// ============================================

export interface GetMuscleGroupProgressionInput {
  /** Exercise snapshots keyed by exerciseId */
  snapshotsByExercise: Map<string, ExercisePerformanceSnapshot[]>;
  /** exerciseId -> muscle group (typically the exercise's primary muscle) */
  muscleByExercise: Map<string, string>;
  experience: Experience;
  referenceDate?: string | Date;
  /** Diet phase — forwarded to plateauDetector's goal-aware thresholds */
  goal?: PlateauGoal;
}

/**
 * Roll per-exercise insights up to muscle groups. An exercise contributes
 * to the muscle group given in muscleByExercise; exercises missing from
 * that map are skipped.
 */
export function getMuscleGroupProgression(
  input: GetMuscleGroupProgressionInput
): MuscleGroupProgression[] {
  const { snapshotsByExercise, muscleByExercise, experience, referenceDate, goal } = input;
  const expectedWeeklyPct = EXPECTED_WEEKLY_E1RM_GAIN_PCT[experience];

  const byMuscle = new Map<string, ExerciseProgressionInsight[]>();

  snapshotsByExercise.forEach((snapshots, exerciseId) => {
    const muscle = muscleByExercise.get(exerciseId);
    if (!muscle) return;
    const insight = getExerciseProgression({
      exerciseId,
      snapshots,
      experience,
      referenceDate,
      goal,
    });
    const list = byMuscle.get(muscle) ?? [];
    list.push(insight);
    byMuscle.set(muscle, list);
  });

  const results: MuscleGroupProgression[] = [];

  byMuscle.forEach((insights, muscleGroup) => {
    const analyzed = insights.filter((i) => i.pace !== 'insufficient_data');
    const plateauedCount = analyzed.filter((i) => i.isPlateaued).length;
    const avgWeeklyChangePct =
      analyzed.length > 0
        ? Math.round(
            (analyzed.reduce((sum, i) => sum + i.weeklyChangePct, 0) / analyzed.length) * 10
          ) / 10
        : 0;

    // Same precedence as per-exercise: a healthy average trend wins;
    // "plateaued" only when the trend is weak AND most lifts are flagged.
    let pace: ProgressionPace;
    if (analyzed.length === 0) {
      pace = 'insufficient_data';
    } else {
      const ratio = avgWeeklyChangePct / expectedWeeklyPct;
      if (ratio >= AHEAD_RATIO) pace = 'ahead';
      else if (ratio >= ON_TRACK_RATIO) pace = 'on_track';
      else if (plateauedCount > analyzed.length / 2) pace = 'plateaued';
      else pace = 'behind';
    }

    results.push({
      muscleGroup,
      pace,
      avgWeeklyChangePct,
      expectedWeeklyPct,
      exerciseCount: insights.length,
      analyzedCount: analyzed.length,
      plateauedCount,
      insights: insights.sort((a, b) => b.weeklyChangePct - a.weeklyChangePct),
    });
  });

  // Worst-progressing muscles first so problems surface at the top
  const paceRank: Record<ProgressionPace, number> = {
    plateaued: 0,
    behind: 1,
    on_track: 2,
    ahead: 3,
    insufficient_data: 4,
  };
  results.sort(
    (a, b) => paceRank[a.pace] - paceRank[b.pace] || a.muscleGroup.localeCompare(b.muscleGroup)
  );

  return results;
}

// ============================================
// DISPLAY HELPERS
// ============================================

export interface PaceDisplay {
  label: string;
  /** Semantic tone for styling */
  tone: 'positive' | 'neutral' | 'warning' | 'negative' | 'muted';
}

export function getPaceDisplay(pace: ProgressionPace): PaceDisplay {
  switch (pace) {
    case 'ahead':
      return { label: 'Ahead of pace', tone: 'positive' };
    case 'on_track':
      return { label: 'On track', tone: 'neutral' };
    case 'behind':
      return { label: 'Behind pace', tone: 'warning' };
    case 'plateaued':
      return { label: 'Plateaued', tone: 'negative' };
    case 'insufficient_data':
      return { label: 'Building history', tone: 'muted' };
  }
}

/**
 * Short "what changed since last time" text, e.g. "+2.5 kg", "+2 reps",
 * "+2.5 kg · +1 rep". Returns null when nothing changed or no history.
 * Weight is reported in kg; callers convert for display units.
 */
export function formatLastSessionDelta(
  delta: ExerciseProgressionInsight['lastSessionDelta']
): { weightKg: number; reps: number } | null {
  if (!delta) return null;
  if (delta.weightKg === 0 && delta.reps === 0) return null;
  return delta;
}
