// ============================================================
// START A WORKOUT FROM A SAVED TEMPLATE
//
// Turns a workout_templates row (+ its workout_template_exercises) into a fresh
// planned session whose exercise blocks carry the template's prescription —
// sets, rep range, rest, default weight and per-exercise notes. Shared by the
// templates list and the template detail page so the two "Start Workout"
// buttons cannot drift.
//
// Before this existed both buttons linked to /dashboard/workout/new?template=
// <uuid>, a page that treats `template` as a DISPLAY NAME — so starting a
// template showed "<uuid> Workout / Select muscle groups to train" and dropped
// the template's exercises on the floor.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { getLocalDateString } from '@/lib/utils';
import { insertWorkoutSessions } from '@/lib/training/sessionOrigin';

/** The subset of a workout_template_exercises row a session needs. */
export interface TemplateExerciseRow {
  exercise_id: string;
  exercise_name?: string | null;
  default_sets?: number | null;
  default_reps?: string | null;
  /** kg — app-wide storage invariant. */
  default_weight?: number | null;
  default_rest_seconds?: number | null;
  notes?: string | null;
}

/** exercise_blocks column bounds (20241209000001_initial_schema). */
const SETS_MIN = 1;
const SETS_MAX = 10;
const REST_MIN = 0;
const REST_MAX = 600;
const REPS_MIN = 1;
const REPS_MAX = 100;
/** target_weight_kg is DECIMAL(6,2). */
const WEIGHT_MAX_KG = 9999.99;

const DEFAULT_REP_RANGE: [number, number] = [8, 12];
const DEFAULT_SETS = 3;
const DEFAULT_REST_SECONDS = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse a template's free-text reps field into an exercise_blocks rep range.
 *
 * Templates store reps as typed text ("8-12", "10", "12+", "AMRAP"), so read
 * the numbers out of it rather than trusting a format: two or more numbers give
 * a range, one gives a fixed target, none falls back to 8-12.
 */
export function parseTemplateRepRange(reps: string | null | undefined): [number, number] {
  const numbers = (reps ?? '')
    .match(/\d+/g)
    ?.map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => clamp(n, REPS_MIN, REPS_MAX));

  if (!numbers || numbers.length === 0) return [...DEFAULT_REP_RANGE];
  if (numbers.length === 1) return [numbers[0], numbers[0]];

  const [a, b] = numbers;
  return a <= b ? [a, b] : [b, a];
}

/**
 * Build the exercise_blocks rows for a template start. Pure — every value is
 * clamped into the column's constraint so a hand-edited template (0 sets,
 * 20-minute rest) can never fail the insert.
 *
 * Warmups are intentionally left empty: the working weights aren't known until
 * the user is in the session, and the workout page owns warmup generation from
 * there.
 */
export function buildTemplateExerciseBlocks(
  sessionId: string,
  templateName: string,
  exercises: TemplateExerciseRow[]
): Record<string, unknown>[] {
  return exercises.map((exercise, index) => {
    const sets = Math.round(exercise.default_sets ?? DEFAULT_SETS);
    const rest = Math.round(exercise.default_rest_seconds ?? DEFAULT_REST_SECONDS);
    const weight = exercise.default_weight;

    return {
      workout_session_id: sessionId,
      exercise_id: exercise.exercise_id,
      order: index + 1,
      target_sets: clamp(Number.isFinite(sets) ? sets : DEFAULT_SETS, SETS_MIN, SETS_MAX),
      target_rep_range: parseTemplateRepRange(exercise.default_reps),
      target_rir: 2,
      // 0 means "suggest it live" — same contract as every other ad-hoc start.
      target_weight_kg:
        weight != null && Number.isFinite(weight) ? clamp(weight, 0, WEIGHT_MAX_KG) : 0,
      target_rest_seconds: clamp(
        Number.isFinite(rest) ? rest : DEFAULT_REST_SECONDS,
        REST_MIN,
        REST_MAX
      ),
      suggestion_reason: `From template: ${templateName}`,
      warmup_protocol: { sets: [] },
      note: exercise.notes || null,
    };
  });
}

/**
 * Create a planned session from a saved template and return its id, along with
 * the template's name for the caller's UI. Throws with a user-facing message on
 * failure; callers own loading state and navigation.
 *
 * Must only be called from an explicit user tap — never on page load (P0-1: a
 * GET that inserts rows).
 */
export async function startWorkoutFromTemplate(
  supabase: SupabaseClient,
  userId: string,
  templateId: string
): Promise<{ sessionId: string; templateName: string }> {
  const [templateResult, exercisesResult] = await Promise.all([
    supabase.from('workout_templates').select('id, name, times_performed').eq('id', templateId).single(),
    supabase
      .from('workout_template_exercises')
      .select('exercise_id, exercise_name, default_sets, default_reps, default_weight, default_rest_seconds, notes')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true }),
  ]);

  const template = templateResult.data as
    | { id: string; name: string; times_performed: number | null }
    | null;
  if (templateResult.error || !template) {
    throw (templateResult.error as Error | null) ?? new Error('Template not found');
  }
  if (exercisesResult.error) throw exercisesResult.error as Error;

  const templateExercises = (exercisesResult.data ?? []) as TemplateExerciseRow[];
  if (templateExercises.length === 0) {
    throw new Error('This template has no exercises yet — add one before starting a workout.');
  }

  // workout_template_exercises has no foreign key to exercises, so a template
  // can outlive a deleted custom exercise. Drop those rather than failing the
  // whole start on an opaque FK violation (exercise_blocks.exercise_id is
  // ON DELETE RESTRICT).
  const { data: liveExercises } = await supabase
    .from('exercises')
    .select('id')
    .in('id', templateExercises.map((e) => e.exercise_id));
  const liveIds = new Set(((liveExercises ?? []) as { id: string }[]).map((row) => row.id));
  const exercises = liveExercises
    ? templateExercises.filter((e) => liveIds.has(e.exercise_id))
    : templateExercises;
  if (exercises.length === 0) {
    throw new Error("This template's exercises no longer exist — edit the template to replace them.");
  }

  const { data: sessions, error: sessionError } = await insertWorkoutSessions(supabase, [
    {
      user_id: userId,
      state: 'planned',
      planned_date: getLocalDateString(),
      completion_percent: 0,
      origin: 'template' as const,
    },
  ]);

  const session = sessions?.[0];
  if (sessionError || !session) {
    throw (sessionError as Error | null) ?? new Error('Failed to create workout session');
  }

  const { error: blocksError } = await supabase
    .from('exercise_blocks')
    .insert(buildTemplateExerciseBlocks(session.id, template.name, exercises));

  if (blocksError) {
    // Don't leave an empty shell behind for the Continue card to advertise.
    await supabase.from('workout_sessions').delete().eq('id', session.id);
    throw blocksError as Error;
  }

  // Usage stats are cosmetic (the templates list shows "last performed"), so a
  // failure here must not sink a started workout.
  const { error: usageError } = await supabase
    .from('workout_templates')
    .update({
      last_performed_at: new Date().toISOString(),
      times_performed: (template.times_performed ?? 0) + 1,
    })
    .eq('id', template.id);
  if (usageError) console.warn('Failed to update template usage stats:', usageError);

  return { sessionId: session.id, templateName: template.name };
}
