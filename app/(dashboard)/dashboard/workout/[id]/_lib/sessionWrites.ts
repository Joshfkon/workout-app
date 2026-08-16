/**
 * sessionWrites.ts
 *
 * Helpers that persist derived workout data on completion / check-in.
 * These are the WRITERS for tables that were previously read-only in the app:
 *   - exercise_performance_snapshots  (read by useExerciseHistory)
 *   - weekly_fatigue_logs             (read by ProgramEngine.checkDeloadTriggers)
 *
 * Schema confirmed from migrations:
 *   - exercise_performance_snapshots: supabase/migrations/20241209000001_initial_schema.sql (lines 216-231)
 *   - weekly_fatigue_logs:            supabase/migrations/20241211000001_training_science.sql (lines 94-108)
 *
 * Kept as plain functions that receive the supabase client so the page stays
 * 'use client'. They surface errors (return them) rather than swallowing.
 */

import { estimateE1RMFromRpe } from '@/services/shared/e1rm';
import type { SetLog, Rating } from '@/types/schema';
import type { ExerciseBlockWithExercise } from './types';

export interface SnapshotWriteResult {
  inserted: number;
  errors: string[];
}

/**
 * Aggregate each exercise block's working (non-warmup) sets into a single
 * performance snapshot row and insert it.
 *
 * One row per (user_id, exercise_id, session_date) — the table has a UNIQUE
 * constraint on that triple, so we use upsert(onConflict) to avoid double
 * inserts when a completed workout is re-finished/edited.
 *
 * Columns written (exercise_performance_snapshots):
 *   user_id, exercise_id, session_date, top_set_weight_kg, top_set_reps,
 *   top_set_rpe, total_working_sets, estimated_e1rm
 */
export async function writePerformanceSnapshots(
  supabase: ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>,
  args: {
    userId: string;
    sessionDate: string; // YYYY-MM-DD (local)
    blocks: ExerciseBlockWithExercise[];
    sets: SetLog[];
    /** Mirror the session's deload flag so e1RM-trend reads can exclude it. */
    isDeload?: boolean;
  }
): Promise<SnapshotWriteResult> {
  const { userId, sessionDate, blocks, sets, isDeload = false } = args;
  const result: SnapshotWriteResult = { inserted: 0, errors: [] };

  // Build one snapshot per *exercise* (an exercise can appear in multiple
  // blocks; we aggregate all working sets across its blocks for the session).
  const setsByBlock = new Map<string, SetLog[]>();
  for (const set of sets) {
    if (set.isWarmup) continue;
    const arr = setsByBlock.get(set.exerciseBlockId);
    if (arr) arr.push(set);
    else setsByBlock.set(set.exerciseBlockId, [set]);
  }

  // exerciseId -> aggregated working sets
  const workingByExercise = new Map<string, SetLog[]>();
  for (const block of blocks) {
    const blockSets = setsByBlock.get(block.id);
    if (!blockSets || blockSets.length === 0) continue;
    const arr = workingByExercise.get(block.exerciseId);
    if (arr) arr.push(...blockSets);
    else workingByExercise.set(block.exerciseId, [...blockSets]);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const [exerciseId, working] of Array.from(workingByExercise.entries())) {
    if (working.length === 0) continue;

    // Top set = highest estimated E1RM among working sets (best stimulus
    // marker), via the canonical estimator WITH the set's logged RPE — the
    // old writer was RPE-blind, which under-stated every set left short of
    // failure and was one of the five divergent e1RM implementations.
    // Sets beyond the estimator's domain (effective reps > 15) carry no e1RM;
    // if NO set is estimable, the snapshot keeps its top-by-load set stats
    // and stores estimated_e1rm = NULL ("no estimate" — never 0, never an
    // extrapolation).
    let topSet: SetLog | null = null;
    let bestE1rm: number | null = null;
    for (const s of working) {
      const est = estimateE1RMFromRpe(s.weightKg, s.reps, s.rpe);
      if (est && (bestE1rm === null || est.value > bestE1rm)) {
        bestE1rm = est.value;
        topSet = s;
      }
    }
    if (!topSet) {
      // No estimable set: fall back to heaviest load (then most reps) so the
      // snapshot still records what was done.
      topSet = working.reduce((best, s) =>
        s.weightKg > best.weightKg ||
        (s.weightKg === best.weightKg && s.reps > best.reps)
          ? s
          : best
      );
    }

    rows.push({
      user_id: userId,
      exercise_id: exerciseId,
      session_date: sessionDate,
      top_set_weight_kg: topSet.weightKg,
      top_set_reps: topSet.reps,
      top_set_rpe: topSet.rpe ?? 0,
      total_working_sets: working.length,
      estimated_e1rm: bestE1rm,
      is_deload: isDeload,
    });
  }

  if (rows.length === 0) return result;

  const { error } = await supabase
    .from('exercise_performance_snapshots')
    .upsert(rows, { onConflict: 'user_id,exercise_id,session_date' });

  if (error) {
    result.errors.push(error.message);
  } else {
    result.inserted = rows.length;
  }

  return result;
}

/**
 * Convert a 1-5 readiness/quality Rating into the perceived-fatigue scale
 * the program engine expects (1 = fresh, 5 = wrecked).
 */
function ratingToFatigue(soreness: Rating | null, readinessScore: number): number {
  // Prefer readiness score when available (0-100, higher = fresher).
  // Map: >=80 -> 1, 60-79 -> 2, 40-59 -> 3, 20-39 -> 4, <20 -> 5
  if (readinessScore > 0) {
    if (readinessScore >= 80) return 1;
    if (readinessScore >= 60) return 2;
    if (readinessScore >= 40) return 3;
    if (readinessScore >= 20) return 4;
    return 5;
  }
  // Fallback to soreness/stress proxy (1-5, higher = more fatigued).
  if (soreness != null) return Math.max(1, Math.min(5, soreness));
  return 3;
}

export interface WeeklyFatigueWriteInput {
  userId: string;
  mesocycleId: string | null;
  weekNumber: number;
  readinessScore: number; // 0-100
  sleepQuality: Rating | null; // 1-5
  stressLevel: Rating | null; // 1-5 (1=low stress)
  sessionAvgRpe: number | null;
  missedReps?: number;
  strengthDecline?: boolean;
  jointPain?: boolean;
  /**
   * ISO timestamp of the session this write derives from (the post-finish
   * work item's enqueue time — STABLE across retries). When provided, the
   * update is advance-only: a retrying older work item can no longer
   * overwrite a newer session's data for the same week, so the stored row —
   * and any deload recommendation derived from it — always reflects the
   * LATEST session regardless of retry order.
   */
  loggedAt?: string;
}

/**
 * Upsert (one row per mesocycle + week) a weekly_fatigue_logs entry derived
 * from the check-in + session RPE so ProgramEngine.checkDeloadTriggers has data.
 *
 * NOTE: the table has NO unique constraint on (mesocycle_id, week_number) —
 * only an index — so a DB-level upsert(onConflict) is not available. We
 * emulate it: find existing row for (user, mesocycle, week) and UPDATE it,
 * else INSERT.
 *
 * Columns written (weekly_fatigue_logs):
 *   user_id, mesocycle_id, week_number, perceived_fatigue, sleep_quality,
 *   motivation_level, missed_reps, joint_pain, strength_decline
 */
export async function upsertWeeklyFatigueLog(
  supabase: ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>,
  input: WeeklyFatigueWriteInput
): Promise<{ ok: boolean; error?: string }> {
  const {
    userId,
    mesocycleId,
    weekNumber,
    readinessScore,
    sleepQuality,
    stressLevel,
    sessionAvgRpe,
  } = input;

  const perceivedFatigue = ratingToFatigue(stressLevel, readinessScore);

  // Motivation proxy: lower readiness -> lower motivation (1-5).
  const motivationLevel =
    readinessScore > 0
      ? Math.max(1, Math.min(5, Math.round(readinessScore / 20)))
      : 3;

  // High average RPE this session implies missed-rep / hard-grind risk.
  // We don't have per-set miss data here, so derive a conservative proxy:
  // very high session RPE (>= 9) flags a hard week, otherwise 0.
  const missedReps = input.missedReps ?? 0;
  const strengthDecline = input.strengthDecline ?? false;
  const jointPain = input.jointPain ?? false;

  const row: Record<string, unknown> = {
    user_id: userId,
    mesocycle_id: mesocycleId,
    week_number: weekNumber,
    perceived_fatigue: perceivedFatigue,
    sleep_quality: sleepQuality != null ? Math.max(1, Math.min(5, sleepQuality)) : null,
    motivation_level: motivationLevel,
    missed_reps: missedReps,
    joint_pain: jointPain,
    strength_decline: strengthDecline,
    notes:
      sessionAvgRpe != null
        ? `Auto-logged from workout (avg RPE ${sessionAvgRpe.toFixed(1)})`
        : 'Auto-logged from workout',
  };
  if (input.loggedAt) row.logged_at = input.loggedAt;

  // Find existing row for this (user, mesocycle, week).
  let existingQuery = supabase
    .from('weekly_fatigue_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('week_number', weekNumber);
  existingQuery = mesocycleId
    ? existingQuery.eq('mesocycle_id', mesocycleId)
    : existingQuery.is('mesocycle_id', null);

  const { data: existing, error: selectError } = await existingQuery.maybeSingle();

  if (selectError) {
    return { ok: false, error: selectError.message };
  }

  if (existing?.id) {
    let updateQuery = supabase
      .from('weekly_fatigue_logs')
      .update(row)
      .eq('id', existing.id);
    // Advance-only (like the current_week .lt() write): if the stored row
    // came from a NEWER session, this stale retry matches zero rows and the
    // newer data stays — which is success, not failure.
    if (input.loggedAt) {
      updateQuery = updateQuery.lte('logged_at', input.loggedAt);
    }
    const { error } = await updateQuery;
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from('weekly_fatigue_logs').insert(row);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
