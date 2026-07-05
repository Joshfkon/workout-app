/**
 * Lift-trend summary for the home "Lifts" glance tile: which of the user's
 * main lifts are rising / flat / declining, plus the longest-running stall.
 *
 * Shared by the dashboard's server initial-data path and the client
 * full-fetch path (same pattern as weeklyVolume.ts). Pure: no React, no
 * Supabase client — callers pass the queried session rows in.
 */

import { estimateE1RM, getLocalDateString } from '@/lib/utils';
import {
  analyzeExerciseTrend,
  detectPlateau,
  type PlateauGoal,
} from '@/services/plateauDetector';
import type { ExercisePerformanceSnapshot } from '@/types/schema';

export type LiftDirection = 'rising' | 'flat' | 'down';

export interface LiftTrend {
  exerciseId: string;
  name: string;
  direction: LiftDirection;
  /** Weekly E1RM change as % of current E1RM (regression slope). */
  weeklyChangePct: number;
}

export interface LiftTrendsSummary {
  /** Tracked lifts, ordered rising → flat → down (for the dot strip). */
  lifts: LiftTrend[];
  rising: number;
  flat: number;
  down: number;
  /** Longest-running plateaued lift, e.g. Bench stalled 3 wks. */
  stalled: { name: string; weeks: number } | null;
}

/** Completed-session row shape expected from the workout_sessions query. */
export interface LiftTrendSessionRow {
  id: string;
  completed_at: string | null;
  exercise_blocks: {
    exercises: { id: string; name: string } | null;
    set_logs: { weight_kg: number | null; reps: number | null; is_warmup: boolean | null }[] | null;
  }[] | null;
}

/** Sessions of history required before a lift is classified. */
export const MIN_SESSIONS_FOR_TREND = 3;

/** At most this many lifts feed the tile (the user's most-trained ones). */
export const MAX_TRACKED_LIFTS = 10;

/** Weekly E1RM change (%/wk) within ±this band counts as "flat". */
const FLAT_BAND_PCT = 0.15;

/**
 * Build per-exercise top-set E1RM snapshots (one per session) and classify
 * each frequently-trained lift's trend. Bodyweight/empty sets (no load) are
 * skipped — a 0 kg top set would zero the E1RM trend, not inform it.
 */
export function computeLiftTrends(
  sessions: LiftTrendSessionRow[],
  goal?: PlateauGoal,
  referenceDate: Date = new Date()
): LiftTrendsSummary {
  const snapshotsByExercise = new Map<string, ExercisePerformanceSnapshot[]>();
  const nameByExercise = new Map<string, string>();

  for (const session of sessions) {
    if (!session.completed_at || !session.exercise_blocks) continue;
    const sessionDate = getLocalDateString(new Date(session.completed_at));

    for (const block of session.exercise_blocks) {
      const exercise = block.exercises;
      if (!exercise) continue;
      const workingSets = (block.set_logs || []).filter(
        (s) => !s.is_warmup && (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0
      );
      if (workingSets.length === 0) continue;

      let topE1RM = 0;
      let topWeight = 0;
      let topReps = 0;
      for (const set of workingSets) {
        const e1rm = estimateE1RM(set.weight_kg as number, set.reps as number);
        if (e1rm > topE1RM) {
          topE1RM = e1rm;
          topWeight = set.weight_kg as number;
          topReps = set.reps as number;
        }
      }
      if (topE1RM <= 0) continue;

      nameByExercise.set(exercise.id, exercise.name);
      const list = snapshotsByExercise.get(exercise.id) ?? [];
      list.push({
        id: `${session.id}-${exercise.id}`,
        userId: '',
        exerciseId: exercise.id,
        sessionDate,
        topSetWeightKg: topWeight,
        topSetReps: topReps,
        // RPE isn't selected in the dashboard query; E1RM already reflects
        // logged performance and the detector mainly trends E1RM.
        topSetRpe: 10,
        totalWorkingSets: workingSets.length,
        estimatedE1RM: topE1RM,
      });
      snapshotsByExercise.set(exercise.id, list);
    }
  }

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

  const lifts: LiftTrend[] = [];
  let stalled: { name: string; weeks: number } | null = null;

  for (const [exerciseId, snapshots] of ranked) {
    const trend = analyzeExerciseTrend(snapshots, goal);
    const sorted = [...snapshots].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
    const currentE1RM = sorted[sorted.length - 1].estimatedE1RM;
    const weeklyChangePct =
      currentE1RM > 0 ? Math.round((trend.weeklyChange / currentE1RM) * 1000) / 10 : 0;

    const direction: LiftDirection =
      weeklyChangePct > FLAT_BAND_PCT ? 'rising' : weeklyChangePct < -FLAT_BAND_PCT ? 'down' : 'flat';

    lifts.push({
      exerciseId,
      name: nameByExercise.get(exerciseId) ?? 'Exercise',
      direction,
      weeklyChangePct,
    });

    const plateau = detectPlateau({ exerciseId, snapshots: sorted, referenceDate, goal });
    if (plateau.isPlateaued) {
      const weeks = Math.max(1, Math.round(plateau.weeksSinceProgress));
      if (!stalled || weeks > stalled.weeks) {
        stalled = { name: nameByExercise.get(exerciseId) ?? 'Exercise', weeks };
      }
    }
  }

  const order: Record<LiftDirection, number> = { rising: 0, flat: 1, down: 2 };
  lifts.sort((a, b) => order[a.direction] - order[b.direction] || b.weeklyChangePct - a.weeklyChangePct);

  return {
    lifts,
    rising: lifts.filter((l) => l.direction === 'rising').length,
    flat: lifts.filter((l) => l.direction === 'flat').length,
    down: lifts.filter((l) => l.direction === 'down').length,
    stalled,
  };
}
