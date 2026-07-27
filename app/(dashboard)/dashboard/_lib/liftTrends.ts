/**
 * Lift-trend summary for the home "Lifts" glance tile: which of the user's
 * main lifts are rising / flat / declining, plus the longest-running stall.
 *
 * Shared by the dashboard's server initial-data path, the client full-fetch
 * path, AND the Progress (analytics) Strength tab's lift-trend detail list
 * (same pattern as weeklyVolume.ts) — the tile's aggregate and the detail
 * view are both derived from this one function so they can never disagree.
 * Pure: no React, no Supabase client — callers pass the queried session
 * rows in.
 */

import { getLocalDateString } from '@/lib/utils';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';
import {
  analyzeExerciseTrend,
  detectPlateau,
  MIN_SESSIONS_AFTER_DISCONTINUITY,
  type PlateauGoal,
} from '@/services/plateauDetector';
import type { ExercisePerformanceSnapshot } from '@/types/schema';

export type LiftDirection = 'rising' | 'flat' | 'down';

/** One top-set E1RM point per completed session (for sparklines/detail). */
export interface LiftTrendPoint {
  /** Local session date, YYYY-MM-DD. */
  date: string;
  /** Estimated 1RM of the session's top set, in kg. */
  e1rmKg: number;
}

export interface LiftTrend {
  exerciseId: string;
  name: string;
  direction: LiftDirection;
  /** Weekly E1RM change as % of current E1RM (regression slope). */
  weeklyChangePct: number;
  /** Latest session's top-set E1RM in kg. */
  currentE1RMKg: number;
  /** Completed sessions with working sets inside the window. */
  sessionCount: number;
  /** Per-session top-set E1RM history, oldest first. */
  history: LiftTrendPoint[];
  /**
   * True when the lift's recent sessions span a program/mesocycle boundary
   * and it has fewer than MIN_SESSIONS_FOR_TREND sessions since the switch —
   * new exercise selection, rep ranges, and fatigue make the fitted trend
   * noise until a few sessions rebuild it. Same confidence-gating idea as
   * AMRAP calibration: show the data, don't shout a verdict. Also true while
   * the trend rebuilds after a data discontinuity (equipment change) — see
   * calibrationReason.
   */
  lowConfidence: boolean;
  /** Why the lift is calibrating, when lowConfidence is true. */
  calibrationReason: 'program_change' | 'equipment_change' | null;
  /**
   * Session dates the robust fit rejected as outliers — surfaced so the UI
   * can mark them instead of silently dropping data.
   */
  excludedDates: string[];
  /** Session date the current calibration segment starts at, if any. */
  discontinuityDate: string | null;
}

export interface LiftTrendsSummary {
  /** Tracked lifts, ordered rising → flat → down (for the dot strip). */
  lifts: LiftTrend[];
  /** Confident (not lowConfidence) lifts only — the headline counts. */
  rising: number;
  flat: number;
  down: number;
  /** Classified lifts currently low-confidence (program just changed). */
  rebuilding: number;
  /**
   * Lifts trained in the window that don't yet have enough sessions
   * (< MIN_SESSIONS_FOR_TREND) to classify at all.
   */
  insufficientData: number;
  /** Longest-running plateaued lift, e.g. Bench stalled 3 wks. */
  stalled: { name: string; weeks: number } | null;
  /** Days of history the summary was computed over. */
  windowDays: number;
}

/** Completed-session row shape expected from the workout_sessions query. */
export interface LiftTrendSessionRow {
  id: string;
  completed_at: string | null;
  exercise_blocks: {
    exercises: { id: string; name: string; exercise_type?: string | null } | null;
    /** User marked this session's equipment as different (segment boundary). */
    equipment_changed?: boolean | null;
    set_logs: {
      weight_kg: number | null;
      reps: number | null;
      rpe?: number | null;
      is_warmup: boolean | null;
    }[] | null;
  }[] | null;
}

/** Sessions of history required before a lift is classified. */
export const MIN_SESSIONS_FOR_TREND = 3;

/** At most this many lifts feed the tile (the user's most-trained ones). */
export const MAX_TRACKED_LIFTS = 10;

/** History window every caller must query with (keeps tile and detail views
 *  computing over identical data). */
export const LIFT_TREND_WINDOW_DAYS = 84;

/** Weekly E1RM change (%/wk) within ±this band counts as "flat". */
const FLAT_BAND_PCT = 0.15;

export interface ComputeLiftTrendsOptions {
  /**
   * Start date (YYYY-MM-DD or ISO) of the active program/mesocycle. Lifts
   * whose in-window sessions straddle this boundary with fewer than
   * MIN_SESSIONS_FOR_TREND sessions after it are flagged lowConfidence.
   */
  programStartDate?: string | null;
}

/**
 * Build per-exercise top-set E1RM snapshots (one per session) and classify
 * each frequently-trained lift's trend. Bodyweight/empty sets (no load) are
 * skipped — a 0 kg top set would zero the E1RM trend, not inform it.
 */
export function computeLiftTrends(
  sessions: LiftTrendSessionRow[],
  goal?: PlateauGoal,
  referenceDate: Date = new Date(),
  options: ComputeLiftTrendsOptions = {}
): LiftTrendsSummary {
  const snapshotsByExercise = new Map<string, ExercisePerformanceSnapshot[]>();
  const nameByExercise = new Map<string, string>();
  // User-marked "different equipment" sessions per exercise — permanent
  // segment boundaries for the robust trend (heuristic detection remains the
  // backstop for unmarked changes).
  const equipmentBoundariesByExercise = new Map<string, string[]>();

  for (const session of sessions) {
    if (!session.completed_at || !session.exercise_blocks) continue;
    const sessionDate = getLocalDateString(new Date(session.completed_at));

    for (const block of session.exercise_blocks) {
      const exercise = block.exercises;
      if (!exercise) continue;
      // Duration exercises store seconds in reps — an "E1RM trend" over hold
      // times is fiction, so timed work never feeds the lift-trend tile.
      if (exercise.exercise_type === 'duration_based') continue;
      const workingSets = (block.set_logs || []).filter(
        (s) => !s.is_warmup && (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0
      );
      if (workingSets.length === 0) continue;

      let topE1RM = 0;
      let topWeight = 0;
      let topReps = 0;
      let topRpe: number | null = null;
      for (const set of workingSets) {
        // Canonical RPE-aware estimator: same load/reps at a lower RPE is a
        // HIGHER estimate (set-level progress an RPE-blind compare discards).
        // Returns 0 for "no estimate" (>15 effective reps) — such sets never
        // enter the trend.
        const e1rm = e1rmValueFromRpe(
          set.weight_kg as number,
          set.reps as number,
          set.rpe ?? null
        );
        if (e1rm > topE1RM) {
          topE1RM = e1rm;
          topWeight = set.weight_kg as number;
          topReps = set.reps as number;
          topRpe = set.rpe ?? null;
        }
      }
      if (topE1RM <= 0) continue;

      nameByExercise.set(exercise.id, exercise.name);
      if (block.equipment_changed) {
        const boundaries = equipmentBoundariesByExercise.get(exercise.id) ?? [];
        boundaries.push(sessionDate);
        equipmentBoundariesByExercise.set(exercise.id, boundaries);
      }
      const list = snapshotsByExercise.get(exercise.id) ?? [];
      list.push({
        id: `${session.id}-${exercise.id}`,
        userId: '',
        exerciseId: exercise.id,
        sessionDate,
        topSetWeightKg: topWeight,
        topSetReps: topReps,
        topSetRpe: topRpe ?? 10,
        totalWorkingSets: workingSets.length,
        estimatedE1RM: topE1RM,
      });
      snapshotsByExercise.set(exercise.id, list);
    }
  }

  // Lifts seen in the window without enough sessions to fit a trend at all
  // (typical right after a program switch introduces new exercises).
  const insufficientData = Array.from(snapshotsByExercise.values()).filter(
    (snapshots) => snapshots.length < MIN_SESSIONS_FOR_TREND
  ).length;

  // The user's main lifts: most sessions first (ties broken by heavier E1RM),
  // classified only with enough history to fit a trend.
  const ranked = Array.from(snapshotsByExercise.entries())
    .filter(([, snapshots]) => snapshots.length >= MIN_SESSIONS_FOR_TREND)
    .sort((a, b) => {
      const bySessions = b[1].length - a[1].length;
      if (bySessions !== 0) return bySessions;
      const lastE1RM = (s: ExercisePerformanceSnapshot[]) => s[s.length - 1].estimatedE1RM;
      return lastE1RM(b[1]) - lastE1RM(a[1]);
    })
    .slice(0, MAX_TRACKED_LIFTS);

  // Program boundary as a local date string, comparable to sessionDate.
  // Date-only strings (mesocycles.start_date) are used verbatim — parsing
  // them through Date() would shift the boundary a day in UTC-negative zones.
  const programStart = options.programStartDate
    ? /^\d{4}-\d{2}-\d{2}$/.test(options.programStartDate)
      ? options.programStartDate
      : getLocalDateString(new Date(options.programStartDate))
    : null;

  const lifts: LiftTrend[] = [];
  let stalled: { name: string; weeks: number } | null = null;

  for (const [exerciseId, snapshots] of ranked) {
    const knownDiscontinuities = equipmentBoundariesByExercise.get(exerciseId);
    const trend = analyzeExerciseTrend(snapshots, goal, { knownDiscontinuities });
    const sorted = [...snapshots].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    const currentE1RM = sorted[sorted.length - 1].estimatedE1RM;
    const weeklyChangePct =
      currentE1RM > 0 ? Math.round((trend.weeklyChange / currentE1RM) * 1000) / 10 : 0;

    const direction: LiftDirection =
      weeklyChangePct > FLAT_BAND_PCT ? 'rising' : weeklyChangePct < -FLAT_BAND_PCT ? 'down' : 'flat';

    // Confidence gating across a program boundary: the fitted window mixes
    // old-program and new-program sessions, and fewer than
    // MIN_SESSIONS_FOR_TREND have happened since the switch.
    let lowConfidence = false;
    let calibrationReason: LiftTrend['calibrationReason'] = null;
    if (programStart) {
      const before = sorted.filter((s) => s.sessionDate < programStart).length;
      const since = sorted.length - before;
      if (before > 0 && since < MIN_SESSIONS_FOR_TREND) {
        lowConfidence = true;
        calibrationReason = 'program_change';
      }
    }
    // Data-discontinuity gating (robust trend detected/was told about an
    // equipment change): the trend rebuilds over the post-shift sessions,
    // exactly like a program switch.
    if (
      !lowConfidence &&
      trend.discontinuityDate &&
      (trend.pointsUsed ?? sorted.length) < MIN_SESSIONS_AFTER_DISCONTINUITY
    ) {
      lowConfidence = true;
      calibrationReason = 'equipment_change';
    }

    lifts.push({
      exerciseId,
      name: nameByExercise.get(exerciseId) ?? 'Exercise',
      direction,
      weeklyChangePct,
      currentE1RMKg: Math.round(currentE1RM * 10) / 10,
      sessionCount: sorted.length,
      history: sorted.map((s) => ({
        date: s.sessionDate,
        e1rmKg: Math.round(s.estimatedE1RM * 10) / 10,
      })),
      lowConfidence,
      calibrationReason: lowConfidence ? calibrationReason : null,
      excludedDates: trend.excludedDates ?? [],
      discontinuityDate: trend.discontinuityDate ?? null,
    });

    // A "stalled N wks" verdict across a program boundary is the same noise
    // as the direction verdict — skip low-confidence lifts.
    if (!lowConfidence) {
      const plateau = detectPlateau({
        exerciseId,
        snapshots: sorted,
        referenceDate,
        goal,
        knownDiscontinuities,
      });
      if (plateau.isPlateaued) {
        const weeks = Math.max(1, Math.round(plateau.weeksSinceProgress));
        if (!stalled || weeks > stalled.weeks) {
          stalled = { name: nameByExercise.get(exerciseId) ?? 'Exercise', weeks };
        }
      }
    }
  }

  const order: Record<LiftDirection, number> = { rising: 0, flat: 1, down: 2 };
  lifts.sort((a, b) => order[a.direction] - order[b.direction] || b.weeklyChangePct - a.weeklyChangePct);

  const confident = lifts.filter((l) => !l.lowConfidence);

  return {
    lifts,
    rising: confident.filter((l) => l.direction === 'rising').length,
    flat: confident.filter((l) => l.direction === 'flat').length,
    down: confident.filter((l) => l.direction === 'down').length,
    rebuilding: lifts.length - confident.length,
    insufficientData,
    stalled,
    windowDays: LIFT_TREND_WINDOW_DAYS,
  };
}
