/**
 * Weekly set progression engine (RP-style adaptive volume).
 *
 * Pure functions — no database calls. Given a muscle's per-session feedback
 * from the past week (soreness / pump / workload, see session_muscle_feedback)
 * plus its performance trend, recommends adding, holding, or removing one set
 * for the coming week, bounded by the user's volume landmarks.
 *
 * Rules of thumb (tuned toward "never guess upward"):
 * - Deload weeks never change volume.
 * - Missing feedback holds — silence is not evidence of recovery.
 * - Recovered + handling the workload + not regressing → add a set (cap MRV;
 *   above MAV additionally require a decent pump, since sets past MAV need
 *   positive evidence they're producing stimulus).
 * - Soreness that barely resolves, or a "pushed it" workload → hold.
 * - Still sore at the next session, "too much" workload, or declining
 *   performance → remove a set (floor MEV).
 */

import type {
  StandardMuscleGroup,
  VolumeLandmarks,
  SorenessRating,
  PumpRating0to3,
  WorkloadRating,
} from '@/types/schema';

export type PerformanceTrend = 'improving' | 'flat' | 'declining';
export type SetAdjustmentAction = 'add' | 'hold' | 'remove';

/**
 * Sets added per green-light week for enhanced athletes (vs. 1 for natural).
 * Matches the ~1.375x MRV scaling: with a proportionally higher ceiling, the
 * per-week ramp must steepen for the lifter to reach it before deload.
 */
export const ENHANCED_WEEKLY_SET_INCREMENT = 2;

/** The slice of session_muscle_feedback the engine needs (one row per session). */
export interface MuscleWeekFeedback {
  sorenessBefore: SorenessRating | null;
  pump: PumpRating0to3 | null;
  workload: WorkloadRating | null;
}

export interface WeeklySetAdjustmentInput {
  muscle: StandardMuscleGroup;
  /** Working sets currently prescribed for this muscle in a week. */
  currentWeeklySets: number;
  /** Effective landmarks (defaults for the experience level, or learned muscleTolerance). */
  landmarks: VolumeLandmarks;
  /** Feedback rows from the past week's sessions that trained this muscle. */
  feedback: MuscleWeekFeedback[];
  performanceTrend: PerformanceTrend;
  weekInMeso: number;
  isDeloadWeek: boolean;
  /**
   * Enhanced Athlete Mode: the MRV ceiling is ~37.5% higher (see
   * ENHANCED_SCALING — callers pass already-scaled landmarks), so the weekly
   * set-addition rate rises proportionally (ENHANCED_WEEKLY_SET_INCREMENT).
   * Otherwise the lifter would never approach the raised ceiling before the
   * deload. Remove/hold logic is unchanged — recovery debt still wins.
   */
  enhancedAthleteMode?: boolean;
}

export interface WeeklySetAdjustment {
  action: SetAdjustmentAction;
  /** Signed set change to apply (+1, 0, -1). */
  delta: number;
  /** Human-readable explanation, surfaced in the workout header. */
  reason: string;
}

/**
 * Max across the week's rated sessions, ignoring nulls (null when nothing
 * was rated). For soreness/workload this is worst-case aggregation — one bad
 * session is a recovery signal even if the others were fine. For pump it's
 * best-case — the strongest pump is the evidence of stimulus.
 */
function maxRating<T extends number>(values: (T | null)[]): T | null {
  const rated = values.filter((v): v is T => v !== null);
  if (rated.length === 0) return null;
  return rated.reduce((max, v) => (v > max ? v : max));
}

/**
 * Inputs for {@link computePerformanceTrend}. Each entry is one session's
 * best-set E1RM (kg) for the muscle — callers compute these from set logs
 * and pass them in (no DB calls here).
 */
export interface PerformanceTrendInput {
  /** Best-set E1RMs from the week that just finished (one per session). */
  currentWeekBestSetE1rms: number[];
  /** Best-set E1RMs from the week before that (one per session). */
  previousWeekBestSetE1rms: number[];
}

/**
 * Classify a muscle's week-over-week performance by comparing the average of
 * its per-session best-set E1RMs. More than +1% → improving; less than -1% →
 * declining; otherwise flat. Missing data on either side → 'flat' (never
 * infer a trend from silence). Non-finite / non-positive entries are ignored.
 */
export function computePerformanceTrend(input: PerformanceTrendInput): PerformanceTrend {
  const average = (values: number[]): number | null => {
    const valid = values.filter((v) => Number.isFinite(v) && v > 0);
    if (valid.length === 0) return null;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
  };

  const current = average(input.currentWeekBestSetE1rms);
  const previous = average(input.previousWeekBestSetE1rms);
  if (current === null || previous === null) return 'flat';

  const change = (current - previous) / previous;
  if (change > 0.01) return 'improving';
  if (change < -0.01) return 'declining';
  return 'flat';
}

export function recommendWeeklySetAdjustment(
  input: WeeklySetAdjustmentInput
): WeeklySetAdjustment {
  const { currentWeeklySets, landmarks, feedback, performanceTrend, isDeloadWeek } = input;

  if (isDeloadWeek) {
    return { action: 'hold', delta: 0, reason: 'Deload week — volume stays reduced' };
  }

  const soreness = maxRating(feedback.map((f) => f.sorenessBefore));
  const workload = maxRating(feedback.map((f) => f.workload));
  const pump = maxRating(feedback.map((f) => f.pump));

  // Remove signals take priority — recovery debt beats everything else.
  const removeSignal =
    soreness === 3 || workload === 3 || performanceTrend === 'declining';
  if (removeSignal) {
    const why =
      performanceTrend === 'declining'
        ? 'performance is declining'
        : soreness === 3
          ? 'still sore going into the next session'
          : 'workload felt like too much';
    if (currentWeeklySets - 1 >= landmarks.mev) {
      return { action: 'remove', delta: -1, reason: `Removing a set — ${why}` };
    }
    return {
      action: 'hold',
      delta: 0,
      reason: `Holding at minimum effective volume despite recovery signals (${why})`,
    };
  }

  // No feedback at all → never guess upward.
  if (soreness === null && workload === null) {
    return {
      action: 'hold',
      delta: 0,
      reason: 'No recovery feedback logged this week — holding volume',
    };
  }

  const holdSignal = soreness === 2 || workload === 2;
  if (holdSignal) {
    return {
      action: 'hold',
      delta: 0,
      reason:
        soreness === 2
          ? 'Soreness resolved just in time — volume is at your current ceiling'
          : 'Workload felt hard — consolidating before adding sets',
    };
  }

  // Add path: recovered (soreness <= 1) and handling it (workload <= 1).
  if (currentWeeklySets + 1 > landmarks.mrv) {
    return {
      action: 'hold',
      delta: 0,
      reason: 'At maximum recoverable volume — holding',
    };
  }
  // Past MAV, adding needs positive evidence of stimulus, not just tolerance.
  if (currentWeeklySets >= landmarks.mav && (pump === null || pump < 2)) {
    return {
      action: 'hold',
      delta: 0,
      reason: 'Above optimal volume and pump is modest — extra sets need to earn their place',
    };
  }
  // Enhanced athletes ramp faster toward their (higher) MRV, but never past it.
  const increment = input.enhancedAthleteMode
    ? Math.min(ENHANCED_WEEKLY_SET_INCREMENT, landmarks.mrv - currentWeeklySets)
    : 1;
  return {
    action: 'add',
    delta: increment,
    reason:
      currentWeeklySets < landmarks.mev
        ? 'Below minimum effective volume and recovering well — building up'
        : increment > 1
          ? `Recovering well and handling the workload — adding ${increment} sets (enhanced recovery)`
          : 'Recovering well and handling the workload — adding a set',
  };
}

/**
 * Roll per-exercise pump/workload chip answers up to per-muscle entries for
 * session_muscle_feedback — the SAME rows this engine (and the adaptive-volume
 * learner) already ingests, so per-exercise chips flow through the existing
 * update path rather than a parallel one. Aggregation mirrors `maxRating`:
 * pump keeps the best evidence of stimulus, workload keeps the worst-case
 * recovery signal.
 */
export function rollUpExerciseFeedback(
  entries: {
    muscle: StandardMuscleGroup;
    pump: PumpRating0to3 | null;
    workload: WorkloadRating | null;
  }[]
): Partial<Record<StandardMuscleGroup, { pump?: PumpRating0to3; workload?: WorkloadRating }>> {
  const byMuscle: Partial<
    Record<StandardMuscleGroup, { pump?: PumpRating0to3; workload?: WorkloadRating }>
  > = {};
  for (const entry of entries) {
    if (entry.pump === null && entry.workload === null) continue;
    const current = (byMuscle[entry.muscle] ??= {});
    if (entry.pump !== null && (current.pump === undefined || entry.pump > current.pump)) {
      current.pump = entry.pump;
    }
    if (
      entry.workload !== null &&
      (current.workload === undefined || entry.workload > current.workload)
    ) {
      current.workload = entry.workload;
    }
  }
  return byMuscle;
}

/**
 * Convenience: apply an adjustment with landmark clamping (defensive — the
 * recommendation already respects landmarks, but callers may pass stale sets).
 */
export function applySetAdjustment(
  currentWeeklySets: number,
  adjustment: WeeklySetAdjustment,
  landmarks: VolumeLandmarks
): number {
  const next = currentWeeklySets + adjustment.delta;
  return Math.min(Math.max(next, Math.min(landmarks.mev, currentWeeklySets)), landmarks.mrv);
}
