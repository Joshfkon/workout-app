// ============================================================
// WEEKLY ROLLOVER (Phase 1.2 wiring)
//
// Applies weeklyProgressionEngine set adjustments to the upcoming week's
// program sessions. The app has no discrete "advance week" event — session
// blocks are generated lazily at workout-start from mesocycle.program_data
// (see app/(dashboard)/dashboard/mesocycle/page.tsx handleStartWorkout).
// So the flow is:
//
//   1. loadWeeklyMuscleSignals  — DB reads: last calendar week's
//      session_muscle_feedback rows + the last two weeks' best-set E1RMs
//      (trend inputs). DB access belongs here in lib/training, NOT in
//      /services.
//   2. planWeeklySetAdjustments — pure: runs recommendWeeklySetAdjustment
//      per standard muscle in the week's plan and maps non-zero deltas onto
//      concrete exercises: +1 set on the LAST exercise targeting the muscle
//      as primary in the week's plan; -1 removes a set from the last such
//      exercise that has more than 1 set (never below 1 set per exercise).
//   3. The workout-start call site applies `adjustedSets` to the matching
//      exercise block and appends `label` to suggestion_reason so the
//      workout page can display why.
//
// With no feedback rows (feature just shipped) the engine holds on every
// muscle, byExercise stays empty, and generation is byte-identical to today.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computePerformanceTrend,
  recommendWeeklySetAdjustment,
  type MuscleWeekFeedback,
  type PerformanceTrend,
  type SetAdjustmentAction,
} from '@/services/weeklyProgressionEngine';
import {
  DEFAULT_VOLUME_LANDMARKS,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  STANDARD_MUSCLE_GROUPS,
  isStandardMuscle,
  legacyToStandardMuscles,
} from '@/types/schema';
import type {
  Experience,
  PumpRating0to3,
  SorenessRating,
  StandardMuscleGroup,
  VolumeLandmarks,
  WorkloadRating,
} from '@/types/schema';

// ============================================================
// Types
// ============================================================

/** Minimal exercise shape the planner needs (subset of ExtractedExercise). */
export interface RolloverExercise {
  exerciseName: string;
  /** Legacy ('chest') or standard ('chest_upper') muscle name. */
  primaryMuscle: string;
  sets: number;
}

export interface RolloverSession {
  exercises: RolloverExercise[];
}

/** A concrete set change targeted at one exercise in the week's plan. */
export interface BlockSetAdjustment {
  muscle: StandardMuscleGroup;
  action: 'add' | 'remove';
  delta: 1 | -1;
  /** Sets to prescribe for the affected exercise after the delta (>= 1). */
  adjustedSets: number;
  /** Suggestion-reason suffix, e.g. "+1 set Upper Chest — recovering well…". */
  label: string;
}

/** Per-muscle engine output, including holds (for diagnostics/UI). */
export interface MuscleAdjustmentSummary {
  muscle: StandardMuscleGroup;
  action: SetAdjustmentAction;
  delta: number;
  reason: string;
}

export interface WeeklyAdjustmentPlan {
  /** Keyed by exerciseKey(sessionIndex, exerciseIndex) within the week's sessions. */
  byExercise: Map<string, BlockSetAdjustment>;
  summary: MuscleAdjustmentSummary[];
}

/** Signals loaded from the DB that feed the planner. */
export interface WeeklyMuscleSignals {
  feedbackByMuscle: Map<StandardMuscleGroup, MuscleWeekFeedback[]>;
  trendByMuscle: Map<StandardMuscleGroup, PerformanceTrend>;
}

export interface PlanWeeklySetAdjustmentsInput {
  /** The upcoming week's sessions, in order (from getWeekSessionsFromProgramData). */
  weekSessions: RolloverSession[];
  feedbackByMuscle: Map<StandardMuscleGroup, MuscleWeekFeedback[]>;
  trendByMuscle: Map<StandardMuscleGroup, PerformanceTrend>;
  landmarksByMuscle: Record<StandardMuscleGroup, VolumeLandmarks>;
  weekInMeso: number;
  isDeloadWeek: boolean;
}

// ============================================================
// Pure helpers
// ============================================================

/** Stable key for an exercise's position within the week's session list. */
export function exerciseKey(sessionIndex: number, exerciseIndex: number): string {
  return `${sessionIndex}:${exerciseIndex}`;
}

/**
 * Normalize an exercise's primary muscle (legacy or standard taxonomy) to
 * the standard muscle groups it trains. Unknown names yield [].
 */
export function standardMusclesFor(muscle: string): StandardMuscleGroup[] {
  const normalized = muscle.toLowerCase();
  if (isStandardMuscle(normalized)) return [normalized];
  return legacyToStandardMuscles(normalized);
}

/**
 * Weekly working sets per standard muscle across the week's plan, counting an
 * exercise's sets toward every standard muscle its primary maps to (a legacy
 * 'chest' exercise counts for both chest_upper and chest_lower).
 */
export function computeWeeklySetsByMuscle(
  sessions: RolloverSession[]
): Map<StandardMuscleGroup, number> {
  const setsByMuscle = new Map<StandardMuscleGroup, number>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      for (const muscle of standardMusclesFor(exercise.primaryMuscle)) {
        setsByMuscle.set(muscle, (setsByMuscle.get(muscle) ?? 0) + exercise.sets);
      }
    }
  }
  return setsByMuscle;
}

/**
 * Effective landmarks: experience-level defaults overlaid with any per-user
 * custom landmarks (users.volume_landmarks JSONB, keyed by standard muscle).
 */
export function resolveVolumeLandmarks(
  experience: Experience,
  customLandmarks?: Record<string, unknown> | null
): Record<StandardMuscleGroup, VolumeLandmarks> {
  const defaults = DEFAULT_VOLUME_LANDMARKS[experience];
  if (!customLandmarks || typeof customLandmarks !== 'object') return defaults;

  const merged: Record<StandardMuscleGroup, VolumeLandmarks> = { ...defaults };
  for (const [muscle, value] of Object.entries(customLandmarks)) {
    if (!isStandardMuscle(muscle) || value === null || typeof value !== 'object') continue;
    const v = value as Partial<VolumeLandmarks>;
    if (typeof v.mev === 'number' && typeof v.mav === 'number' && typeof v.mrv === 'number') {
      merged[muscle] = { mev: v.mev, mav: v.mav, mrv: v.mrv };
    }
  }
  return merged;
}

function adjustmentLabel(muscle: StandardMuscleGroup, delta: number, reason: string): string {
  // Engine "remove" reasons start with "Removing a set — "; strip the
  // action prefix since the label already carries the signed delta.
  const cleaned = reason.replace(/^(Adding|Removing) a set — /i, '');
  const sign = delta > 0 ? '+1' : '-1';
  return `${sign} set ${STANDARD_MUSCLE_DISPLAY_NAMES[muscle]} — ${cleaned}`;
}

/**
 * Run the weekly progression engine for every standard muscle in the week's
 * plan and target the resulting deltas at concrete exercises.
 *
 * Delta → exercise mapping:
 * - add:    the LAST exercise in the week whose primary targets the muscle.
 * - remove: the LAST such exercise with more than 1 set (an exercise is
 *           never reduced below 1 set; if every candidate has 1 set the
 *           removal is skipped).
 * - An exercise receives at most ONE adjustment per week. When a legacy
 *   primary maps to two standard muscles (e.g. 'chest' → chest_upper +
 *   chest_lower) whose recommendations land on the same exercise, the first
 *   (in STANDARD_MUSCLE_GROUPS order) wins — this stops one exercise from
 *   swinging ±2 sets off what is largely the same feedback.
 */
export function planWeeklySetAdjustments(
  input: PlanWeeklySetAdjustmentsInput
): WeeklyAdjustmentPlan {
  const { weekSessions, feedbackByMuscle, trendByMuscle, landmarksByMuscle } = input;

  const byExercise = new Map<string, BlockSetAdjustment>();
  const summary: MuscleAdjustmentSummary[] = [];

  const setsByMuscle = computeWeeklySetsByMuscle(weekSessions);

  // Deterministic iteration order over the muscles present in the plan.
  const planMuscles = STANDARD_MUSCLE_GROUPS.filter((m) => setsByMuscle.has(m));

  for (const muscle of planMuscles) {
    const recommendation = recommendWeeklySetAdjustment({
      muscle,
      currentWeeklySets: setsByMuscle.get(muscle) ?? 0,
      landmarks: landmarksByMuscle[muscle],
      feedback: feedbackByMuscle.get(muscle) ?? [],
      performanceTrend: trendByMuscle.get(muscle) ?? 'flat',
      weekInMeso: input.weekInMeso,
      isDeloadWeek: input.isDeloadWeek,
    });

    summary.push({
      muscle,
      action: recommendation.action,
      delta: recommendation.delta,
      reason: recommendation.reason,
    });

    if (recommendation.delta === 0) continue;
    const delta: 1 | -1 = recommendation.delta > 0 ? 1 : -1;

    // Walk the week's exercises from the end, looking for the last one that
    // targets this muscle as primary (and, for removals, still has >1 set).
    let target: { key: string; sets: number } | null = null;
    outer: for (let s = weekSessions.length - 1; s >= 0; s--) {
      const exercises = weekSessions[s].exercises;
      for (let e = exercises.length - 1; e >= 0; e--) {
        const exercise = exercises[e];
        if (!standardMusclesFor(exercise.primaryMuscle).includes(muscle)) continue;
        if (delta === -1 && exercise.sets <= 1) continue; // never below 1 set/exercise
        target = { key: exerciseKey(s, e), sets: exercise.sets };
        break outer;
      }
    }

    if (!target) continue; // nothing eligible (e.g. all candidates at 1 set)
    if (byExercise.has(target.key)) continue; // one adjustment per exercise per week

    byExercise.set(target.key, {
      muscle,
      action: delta === 1 ? 'add' : 'remove',
      delta,
      adjustedSets: Math.max(1, target.sets + delta),
      label: adjustmentLabel(muscle, delta, recommendation.reason),
    });
  }

  return { byExercise, summary };
}

// ============================================================
// DB loader (calling-layer side of the pure engine)
// ============================================================

interface SessionRow {
  id: string;
  completed_at: string | null;
}

interface FeedbackRow {
  muscle_group: string;
  soreness_before: number | null;
  pump: number | null;
  workload: number | null;
}

interface BlockRow {
  workout_session_id: string;
  exercises: { primary_muscle: string | null } | { primary_muscle: string | null }[] | null;
  set_logs: { weight_kg: number | null; reps: number | null; is_warmup: boolean | null }[] | null;
}

/** Monday 00:00 (local time) of the week containing `now`. */
function startOfLocalWeek(now: Date): Date {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = monday.getDay(); // 0 = Sunday
  monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
  return monday;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function asRating<T extends 0 | 1 | 2 | 3>(value: number | null): T | null {
  if (value === null || !Number.isInteger(value) || value < 0 || value > 3) return null;
  return value as T;
}

/** Epley estimated 1RM. */
function epleyE1rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

/**
 * Load the auto-regulation signals for a week rollover:
 * - session_muscle_feedback rows from LAST calendar week's completed sessions
 *   (the week whose training the upcoming week reacts to), grouped by muscle.
 * - performance trend per muscle: average per-session best-set E1RM of last
 *   week vs the week before (computePerformanceTrend).
 *
 * Weeks are Monday-based calendar weeks, matching the mesocycle page's
 * completed-sessions-this-week accounting. When there are no completed
 * sessions or no feedback rows, the maps come back empty and the engine
 * holds everywhere — behavior identical to before this feature shipped.
 */
export async function loadWeeklyMuscleSignals(
  supabase: SupabaseClient,
  userId: string,
  mesocycleId: string,
  now: Date = new Date()
): Promise<WeeklyMuscleSignals> {
  const feedbackByMuscle = new Map<StandardMuscleGroup, MuscleWeekFeedback[]>();
  const trendByMuscle = new Map<StandardMuscleGroup, PerformanceTrend>();

  const weekStart = startOfLocalWeek(now);
  const lastWeekStart = addDays(weekStart, -7);
  const prevWeekStart = addDays(weekStart, -14);

  const { data: sessionData, error: sessionError } = await supabase
    .from('workout_sessions')
    .select('id, completed_at')
    .eq('user_id', userId)
    .eq('mesocycle_id', mesocycleId)
    .eq('state', 'completed')
    .gte('completed_at', prevWeekStart.toISOString())
    .lt('completed_at', weekStart.toISOString());

  if (sessionError) throw sessionError;

  const sessions = (sessionData ?? []) as SessionRow[];
  const lastWeekIds = new Set<string>();
  const prevWeekIds = new Set<string>();
  for (const session of sessions) {
    if (!session.completed_at) continue;
    const completedAt = new Date(session.completed_at);
    if (completedAt >= lastWeekStart) lastWeekIds.add(session.id);
    else prevWeekIds.add(session.id);
  }

  if (lastWeekIds.size === 0) {
    // Nothing trained last week — nothing to react to.
    return { feedbackByMuscle, trendByMuscle };
  }

  // --- Feedback rows (last week only) ---
  const { data: feedbackData, error: feedbackError } = await supabase
    .from('session_muscle_feedback')
    .select('muscle_group, soreness_before, pump, workload')
    .eq('user_id', userId)
    .in('session_id', Array.from(lastWeekIds));

  if (feedbackError) throw feedbackError;

  for (const row of (feedbackData ?? []) as FeedbackRow[]) {
    const muscle = row.muscle_group.toLowerCase();
    if (!isStandardMuscle(muscle)) continue;
    const entry: MuscleWeekFeedback = {
      sorenessBefore: asRating<SorenessRating>(row.soreness_before),
      pump: asRating<PumpRating0to3>(row.pump),
      workload: asRating<WorkloadRating>(row.workload),
    };
    const list = feedbackByMuscle.get(muscle);
    if (list) list.push(entry);
    else feedbackByMuscle.set(muscle, [entry]);
  }

  // --- Best-set E1RMs (last two weeks) for the performance trend ---
  const allIds = Array.from(lastWeekIds).concat(Array.from(prevWeekIds));
  const { data: blockData, error: blockError } = await supabase
    .from('exercise_blocks')
    .select('workout_session_id, exercises (primary_muscle), set_logs (weight_kg, reps, is_warmup)')
    .in('workout_session_id', allIds);

  if (blockError) throw blockError;

  // best E1RM per (sessionId, muscle)
  const bestBySession = new Map<string, Map<StandardMuscleGroup, number>>();
  for (const block of (blockData ?? []) as BlockRow[]) {
    const exercise = Array.isArray(block.exercises) ? block.exercises[0] : block.exercises;
    const primary = exercise?.primary_muscle;
    if (!primary) continue;
    const muscles = standardMusclesFor(primary);
    if (muscles.length === 0) continue;

    let bestSetE1rm = 0;
    for (const set of block.set_logs ?? []) {
      if (set.is_warmup) continue;
      const weight = set.weight_kg ?? 0;
      const reps = set.reps ?? 0;
      if (weight <= 0 || reps <= 0) continue;
      bestSetE1rm = Math.max(bestSetE1rm, epleyE1rm(weight, reps));
    }
    if (bestSetE1rm <= 0) continue;

    let perMuscle = bestBySession.get(block.workout_session_id);
    if (!perMuscle) {
      perMuscle = new Map<StandardMuscleGroup, number>();
      bestBySession.set(block.workout_session_id, perMuscle);
    }
    for (const muscle of muscles) {
      perMuscle.set(muscle, Math.max(perMuscle.get(muscle) ?? 0, bestSetE1rm));
    }
  }

  const currentByMuscle = new Map<StandardMuscleGroup, number[]>();
  const previousByMuscle = new Map<StandardMuscleGroup, number[]>();
  bestBySession.forEach((perMuscle, sessionId) => {
    const bucket = lastWeekIds.has(sessionId) ? currentByMuscle : previousByMuscle;
    perMuscle.forEach((e1rm, muscle) => {
      const list = bucket.get(muscle);
      if (list) list.push(e1rm);
      else bucket.set(muscle, [e1rm]);
    });
  });

  const trendMuscles = new Set<StandardMuscleGroup>();
  currentByMuscle.forEach((_, muscle) => trendMuscles.add(muscle));
  previousByMuscle.forEach((_, muscle) => trendMuscles.add(muscle));
  trendMuscles.forEach((muscle) => {
    trendByMuscle.set(
      muscle,
      computePerformanceTrend({
        currentWeekBestSetE1rms: currentByMuscle.get(muscle) ?? [],
        previousWeekBestSetE1rms: previousByMuscle.get(muscle) ?? [],
      })
    );
  });

  return { feedbackByMuscle, trendByMuscle };
}
