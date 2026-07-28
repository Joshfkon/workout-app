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

/** Weekly decline (%/week) still counted as "on track" while cutting */
const CUT_ON_TRACK_FLOOR_PCT = -0.3;

/** Weekly decline (%/week) still counted as "on track" at maintenance */
const MAINTENANCE_ON_TRACK_FLOOR_PCT = -0.15;

/** Any measurable weekly gain on a deficit/maintenance is "ahead" */
const ZERO_EXPECTATION_AHEAD_PCT = 0.1;

/** Recomp expects roughly half the bulk-rate gains */
const RECOMP_RATE_MULTIPLIER = 0.5;

/**
 * Physiological sanity ceiling for a muscle group's weekly E1RM rate (%).
 * Elite novice whole-lift gains top out ~1–2%/week; anything past this is a
 * data artifact (a mis-scaled machine, a corrupted series) that survived the
 * filters — clamp it and flag it rather than display +35%/wk as a verdict.
 */
export const GROUP_RATE_SANITY_CEILING_PCT = 5;

// ============================================
// TYPES
// ============================================

export type ProgressionPace =
  | 'ahead'
  | 'on_track'
  | 'behind'
  | 'plateaued'
  /**
   * Sessions straddle a program boundary with too few since the switch —
   * the fitted slope is noise (same rule as liftTrends' lowConfidence).
   * Calibrating insights carry NO rate and never feed a rollup average.
   */
  | 'calibrating'
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
  /**
   * Robust-fit confidence (services/shared/trend). 'insufficient' means the
   * rate is 0-by-construction and the lift must not feed a group rollup.
   */
  confidence: 'high' | 'low' | 'insufficient';
  /** Working sets across the analyzed snapshots — the lift's volume share. */
  workingSetsAnalyzed: number;
  /** Top-set change vs the previous session (undefined with <2 sessions) */
  lastSessionDelta?: {
    weightKg: number;
    reps: number;
  };
}

/**
 * Goal-aware pace expectations. On a bulk the full experience-level gain
 * rate is expected; recomp roughly halves it; on maintenance or a cut,
 * E1RM gains aren't the goal — holding strength is on pace and only a
 * real decline counts as behind.
 */
export interface ExpectedPace {
  /** Expected weekly E1RM change (% of E1RM); 0 on maintenance/cut */
  expectedWeeklyPct: number;
  /** weeklyChangePct at or above this is "ahead" */
  aheadAtPct: number;
  /** weeklyChangePct at or above this is "on track" */
  onTrackAtPct: number;
}

export function getExpectedPace(experience: Experience, goal?: PlateauGoal): ExpectedPace {
  const base = EXPECTED_WEEKLY_E1RM_GAIN_PCT[experience];
  const normalized = goal === 'maintain' ? 'maintenance' : goal;
  switch (normalized) {
    case 'cut':
      return {
        expectedWeeklyPct: 0,
        aheadAtPct: ZERO_EXPECTATION_AHEAD_PCT,
        onTrackAtPct: CUT_ON_TRACK_FLOOR_PCT,
      };
    case 'maintenance':
      return {
        expectedWeeklyPct: 0,
        aheadAtPct: ZERO_EXPECTATION_AHEAD_PCT,
        onTrackAtPct: MAINTENANCE_ON_TRACK_FLOOR_PCT,
      };
    case 'recomp': {
      const rate = base * RECOMP_RATE_MULTIPLIER;
      return {
        expectedWeeklyPct: rate,
        aheadAtPct: rate * AHEAD_RATIO,
        onTrackAtPct: rate * ON_TRACK_RATIO,
      };
    }
    case 'bulk':
    default:
      return {
        expectedWeeklyPct: base,
        aheadAtPct: base * AHEAD_RATIO,
        onTrackAtPct: base * ON_TRACK_RATIO,
      };
  }
}

export interface MuscleGroupProgression {
  muscleGroup: string;
  pace: ProgressionPace;
  /**
   * Weekly E1RM change % for the group: a WEIGHTED average across qualifying
   * lifts (weight = session count × share of the group's working sets), so a
   * 3-session lift cannot outvote a 12-session one. Clamped at the sanity
   * ceiling — see rateImplausible.
   */
  avgWeeklyChangePct: number;
  /**
   * True when the weighted rate exceeded GROUP_RATE_SANITY_CEILING_PCT and
   * was clamped. A physiologically impossible group rate is a data-quality
   * bug signal, not a result — the UI must show it flagged, not celebrated.
   */
  rateImplausible: boolean;
  expectedWeeklyPct: number;
  exerciseCount: number;
  /** Exercises with enough history to classify */
  analyzedCount: number;
  /** Exercises whose trend is rebuilding after a program switch */
  calibratingCount: number;
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
  /**
   * Active program (mesocycle) start date, YYYY-MM-DD. When sessions
   * straddle this boundary and fewer than MIN_SESSIONS_FOR_INSIGHT have
   * accrued since it, the trend is 'calibrating' — mirrors
   * liftTrends.computeLiftTrends' lowConfidence rule so the two strength
   * surfaces can never disagree about which lifts are trustworthy.
   */
  programStartDate?: string | null;
  /**
   * Session dates the user explicitly marked as "different equipment"
   * (exercise_blocks.equipment_changed) — hard trend-segment boundaries,
   * honored even when the level shift is below the 25% heuristic, so this
   * surface restarts exactly where Lift Trends and History do.
   */
  knownDiscontinuities?: Array<string | Date>;
}

/**
 * Classify how a single exercise is progressing vs expectation.
 */
export function getExerciseProgression(
  input: GetExerciseProgressionInput
): ExerciseProgressionInsight {
  const { exerciseId, snapshots, experience, referenceDate, goal, programStartDate, knownDiscontinuities } = input;
  const expected = getExpectedPace(experience, goal);
  const expectedWeeklyPct = expected.expectedWeeklyPct;

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime()
  );

  const currentE1RM = sorted.length > 0 ? sorted[sorted.length - 1].estimatedE1RM : 0;
  const workingSetsAnalyzed = sorted.reduce((sum, s) => sum + (s.totalWorkingSets || 0), 0);

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
      confidence: 'insufficient',
      workingSetsAnalyzed,
      lastSessionDelta,
    };
  }

  // Program-boundary gate (same rule as liftTrends' lowConfidence): sessions
  // from before the current program with too few since it make the fitted
  // slope noise. Report 'calibrating' with NO rate — a low-confidence rate
  // must not render anywhere.
  if (programStartDate) {
    const boundary = programStartDate.slice(0, 10);
    const before = sorted.filter((s) => s.sessionDate < boundary).length;
    const since = sorted.length - before;
    if (before > 0 && since < MIN_SESSIONS_FOR_INSIGHT) {
      return {
        exerciseId,
        pace: 'calibrating',
        weeklyChangePct: 0,
        weeklyChangeKg: 0,
        expectedWeeklyPct,
        currentE1RM,
        isPlateaued: false,
        sessionsAnalyzed: sorted.length,
        confidence: 'insufficient',
        workingSetsAnalyzed,
        lastSessionDelta,
      };
    }
  }

  const trend = analyzeExerciseTrend(sorted, goal, { knownDiscontinuities });
  const plateau = detectPlateau({
    exerciseId,
    snapshots: sorted,
    referenceDate,
    goal,
    knownDiscontinuities,
  });

  // Data-discontinuity gate (equipment change detected by the robust trend):
  // same calibrating treatment as a program switch — the fitted slope mixes
  // two incomparable levels until a few sessions rebuild it. No rate. Gated
  // on the SEGMENT's point count, not just fit confidence: a two-point
  // post-shift fit succeeds at 'low' confidence, but two sessions on new
  // equipment are still below this module's own session floor.
  if (
    plateau.isCalibrating ||
    (trend.discontinuityDate != null &&
      (trend.pointsUsed ?? 0) < MIN_SESSIONS_FOR_INSIGHT)
  ) {
    return {
      exerciseId,
      pace: 'calibrating',
      weeklyChangePct: 0,
      weeklyChangeKg: 0,
      expectedWeeklyPct,
      currentE1RM,
      isPlateaued: false,
      sessionsAnalyzed: sorted.length,
      confidence: 'insufficient',
      workingSetsAnalyzed,
      lastSessionDelta,
    };
  }

  const weeklyChangeKg = trend.weeklyChange;
  const weeklyChangePct =
    currentE1RM > 0 ? Math.round((weeklyChangeKg / currentE1RM) * 1000) / 10 : 0;

  // Pace from goal-aware trend thresholds first. The plateau flag only
  // decides the weak cases: plateauDetector's bulk threshold (<2% over ~4
  // sessions) would otherwise label a normally-progressing intermediate/
  // advanced lifter as plateaued even when gaining at the expected rate.
  let pace: ProgressionPace;
  if (weeklyChangePct >= expected.aheadAtPct) {
    pace = 'ahead';
  } else if (weeklyChangePct >= expected.onTrackAtPct) {
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
    confidence: trend.confidence ?? 'high',
    workingSetsAnalyzed,
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
  /** Active program start date — see GetExerciseProgressionInput. */
  programStartDate?: string | null;
  /**
   * Per-exercise user-marked equipment-change dates — see
   * GetExerciseProgressionInput.knownDiscontinuities.
   */
  discontinuitiesByExercise?: Map<string, Array<string | Date>>;
}

/**
 * Roll per-exercise insights up to muscle groups. An exercise contributes
 * to the muscle group given in muscleByExercise; exercises missing from
 * that map are skipped.
 *
 * Confidence rule: a muscle's rollup shows a rate ONLY when at least one
 * contributing lift has a confident (non-calibrating, enough-history)
 * trend. Otherwise the row is 'calibrating' (or 'insufficient_data' when
 * nothing has even started building history) and carries no rate.
 */
export function getMuscleGroupProgression(
  input: GetMuscleGroupProgressionInput
): MuscleGroupProgression[] {
  const { snapshotsByExercise, muscleByExercise, experience, referenceDate, goal, programStartDate, discontinuitiesByExercise } = input;
  const expected = getExpectedPace(experience, goal);
  const expectedWeeklyPct = expected.expectedWeeklyPct;

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
      programStartDate,
      knownDiscontinuities: discontinuitiesByExercise?.get(exerciseId),
    });
    const list = byMuscle.get(muscle) ?? [];
    list.push(insight);
    byMuscle.set(muscle, list);
  });

  const results: MuscleGroupProgression[] = [];

  byMuscle.forEach((insights, muscleGroup) => {
    // Only CONFIDENT trends may feed the rollup rate — calibrating lifts'
    // slopes are noise and must not average into a real-looking number, and
    // a lift whose own fit is 'insufficient' has no rate to contribute. If
    // nothing qualifies, the group renders "Building history", never a
    // fabricated rate.
    const analyzed = insights.filter(
      (i) =>
        i.pace !== 'insufficient_data' &&
        i.pace !== 'calibrating' &&
        i.confidence !== 'insufficient'
    );
    const calibratingCount = insights.filter((i) => i.pace === 'calibrating').length;
    const plateauedCount = analyzed.filter((i) => i.isPlateaued).length;

    // Weighted by session count × share of the group's working volume: a
    // 3-session lift must not outvote a 12-session staple (the +35.4%/wk
    // Glutes bug was one 3-session lift promoted unweighted to the verdict).
    const totalSets = analyzed.reduce((sum, i) => sum + i.workingSetsAnalyzed, 0);
    let rawAvg = 0;
    if (analyzed.length > 0) {
      let weightSum = 0;
      let weighted = 0;
      for (const i of analyzed) {
        const volumeShare = totalSets > 0 ? i.workingSetsAnalyzed / totalSets : 1;
        const w = Math.max(i.sessionsAnalyzed * volumeShare, 1e-6);
        weighted += w * i.weeklyChangePct;
        weightSum += w;
      }
      rawAvg = weightSum > 0 ? weighted / weightSum : 0;
    }

    let rateImplausible = false;
    if (Math.abs(rawAvg) > GROUP_RATE_SANITY_CEILING_PCT) {
      console.warn(
        `getMuscleGroupProgression(${muscleGroup}): weighted rate ${rawAvg.toFixed(1)}%/wk ` +
          `exceeds the ${GROUP_RATE_SANITY_CEILING_PCT}%/wk sanity ceiling — clamping and flagging (data-quality signal)`
      );
      rawAvg = Math.sign(rawAvg) * GROUP_RATE_SANITY_CEILING_PCT;
      rateImplausible = true;
    }
    const avgWeeklyChangePct = analyzed.length > 0 ? Math.round(rawAvg * 10) / 10 : 0;

    // Same precedence as per-exercise: a healthy average trend wins;
    // "plateaued" only when the trend is weak AND most lifts are flagged.
    let pace: ProgressionPace;
    if (analyzed.length === 0) {
      pace = calibratingCount > 0 ? 'calibrating' : 'insufficient_data';
    } else if (avgWeeklyChangePct >= expected.aheadAtPct) {
      pace = 'ahead';
    } else if (avgWeeklyChangePct >= expected.onTrackAtPct) {
      pace = 'on_track';
    } else if (plateauedCount > analyzed.length / 2) {
      pace = 'plateaued';
    } else {
      pace = 'behind';
    }

    results.push({
      muscleGroup,
      pace,
      avgWeeklyChangePct,
      rateImplausible,
      expectedWeeklyPct,
      exerciseCount: insights.length,
      analyzedCount: analyzed.length,
      calibratingCount,
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
    calibrating: 4,
    insufficient_data: 5,
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
    case 'calibrating':
      return { label: 'Calibrating', tone: 'muted' };
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
