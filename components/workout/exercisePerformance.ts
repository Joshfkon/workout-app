/**
 * Maps the workout page's already-loaded exercise-history rows into
 * per-session ExercisePerformanceSnapshot lists, the input shape
 * services/plateauDetector.detectPlateau expects.
 *
 * Pure mapping — no DB calls. Lives with the workout components because the
 * only consumer is the exercise card's plateau badge (Phase 2 / 1.7).
 */

import type { ExercisePerformanceSnapshot } from '@/types/schema';
import { calculateE1RM } from '@/services/plateauDetector';

interface SnapshotSourceSet {
  weight_kg: number;
  reps: number;
  rpe: number;
  is_warmup: boolean;
  set_type: string | null;
}

export interface SnapshotSourceBlock {
  id: string;
  exercise_id: string;
  workout_sessions: {
    id: string;
    completed_at: string | null;
    user_id?: string;
    /** Deload sessions are excluded from plateau/e1RM trend analysis. */
    is_deload?: boolean | null;
  } | null;
  set_logs: SnapshotSourceSet[] | null;
}

/** Most sessions kept per exercise for trend analysis. */
const MAX_SNAPSHOTS_PER_EXERCISE = 12;

/**
 * Build per-exercise performance snapshots (one per completed session) from
 * the batched exercise-history query result. Returns snapshots sorted
 * oldest-first, capped at the most recent MAX_SNAPSHOTS_PER_EXERCISE.
 */
export function buildPerformanceSnapshots(
  blocks: SnapshotSourceBlock[]
): Record<string, ExercisePerformanceSnapshot[]> {
  const byExercise: Record<string, ExercisePerformanceSnapshot[]> = {};

  for (const block of blocks || []) {
    const session = block.workout_sessions;
    if (!session?.completed_at) continue;
    // Deload sessions are held light — exclude from plateau / e1RM trend input.
    if (session.is_deload) continue;

    const workingSets = (block.set_logs || []).filter(
      (s) => !s.is_warmup && s.weight_kg > 0 && s.reps > 0
    );
    if (workingSets.length === 0) continue;

    // Top set = highest estimated 1RM in the session.
    let topSet = workingSets[0];
    let bestE1RM = 0;
    for (const set of workingSets) {
      const e1rm = calculateE1RM(set.weight_kg, set.reps, set.rpe);
      if (e1rm > bestE1RM) {
        bestE1RM = e1rm;
        topSet = set;
      }
    }

    const snapshot: ExercisePerformanceSnapshot = {
      id: block.id,
      userId: session.user_id ?? '',
      exerciseId: block.exercise_id,
      sessionDate: session.completed_at,
      topSetWeightKg: topSet.weight_kg,
      topSetReps: topSet.reps,
      topSetRpe: topSet.rpe,
      totalWorkingSets: workingSets.length,
      estimatedE1RM: bestE1RM,
    };

    (byExercise[block.exercise_id] ??= []).push(snapshot);
  }

  for (const exerciseId of Object.keys(byExercise)) {
    byExercise[exerciseId] = byExercise[exerciseId]
      .sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime())
      .slice(-MAX_SNAPSHOTS_PER_EXERCISE);
  }

  return byExercise;
}
