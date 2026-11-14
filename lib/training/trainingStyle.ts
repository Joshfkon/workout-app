/**
 * Training style: does this user train from a plan (mesocycles) or freestyle?
 *
 * Freestyle hides mesocycle UI — the plan card on Home and Train, "Plan a
 * mesocycle" prompts, the plan's week label and deload card — and shows the
 * day's workout whatever started it. Plan behaves as the app always has.
 *
 * `users.preferences.trainingStyle` holds the user's choice: 'plan',
 * 'freestyle', or unset/'auto' = inferred from how they actually train. A
 * user can have an active mesocycle and still never train from it (it was set
 * up once and abandoned), so inference looks at recent COMPLETED workouts,
 * not at whether a plan exists. Planned rows are excluded on purpose: a
 * mesocycle pre-creates future planned rows with mesocycle_id set.
 *
 * Works with the server or browser Supabase client (same query surface).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type TrainingStyle = 'plan' | 'freestyle';
export type TrainingStylePreference = TrainingStyle | 'auto';

/** Recent completed workouts considered when inferring the style. */
export const TRAINING_STYLE_WINDOW = 10;
/** Fewer completed workouts than this: too little to infer — plan. */
export const TRAINING_STYLE_MIN_WORKOUTS = 3;
/** At or below this share of plan workouts in the window: freestyle. */
export const TRAINING_STYLE_MAX_PLAN_SHARE = 0.2;

/**
 * The style to show. An explicit preference wins; 'auto' (or unset) infers
 * from `recentFromPlan` — newest first, one flag per completed workout, true
 * when it belonged to a mesocycle.
 */
export function resolveTrainingStyle(input: {
  preference?: TrainingStylePreference | null;
  recentFromPlan: boolean[];
}): TrainingStyle {
  const { preference, recentFromPlan } = input;
  if (preference === 'plan' || preference === 'freestyle') return preference;
  const recent = recentFromPlan.slice(0, TRAINING_STYLE_WINDOW);
  if (recent.length < TRAINING_STYLE_MIN_WORKOUTS) return 'plan';
  const planShare = recent.filter(Boolean).length / recent.length;
  return planShare <= TRAINING_STYLE_MAX_PLAN_SHARE ? 'freestyle' : 'plan';
}

export function readTrainingStylePreference(preferences: unknown): TrainingStylePreference {
  const value = (preferences as { trainingStyle?: unknown } | null)?.trainingStyle;
  return value === 'plan' || value === 'freestyle' ? value : 'auto';
}

/** Read the preference and recent workouts, then resolve the style. */
export async function fetchTrainingStyle(
  supabase: SupabaseClient,
  userId: string
): Promise<{ style: TrainingStyle; preference: TrainingStylePreference }> {
  const [{ data: user }, { data: recent }] = await Promise.all([
    supabase.from('users').select('preferences').eq('id', userId).maybeSingle(),
    supabase
      .from('workout_sessions')
      .select('mesocycle_id')
      .eq('user_id', userId)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false })
      .limit(TRAINING_STYLE_WINDOW),
  ]);
  const preference = readTrainingStylePreference(user?.preferences);
  const recentFromPlan = ((recent ?? []) as { mesocycle_id: string | null }[]).map(
    (s) => s.mesocycle_id !== null
  );
  return { style: resolveTrainingStyle({ preference, recentFromPlan }), preference };
}

export interface TodaysWorkoutSummary {
  id: string;
  name: string;
  state: 'planned' | 'in_progress' | 'completed';
  exercises: number;
  completedSets: number;
  totalSets: number;
}

/**
 * Today's workout whatever started it (freestyle Home). In-progress first,
 * then planned, then completed. A mesocycle's pre-created planned row is
 * skipped: in freestyle it is not "today's workout" until the user starts it.
 */
export async function fetchTodaysWorkoutAnySource(
  supabase: SupabaseClient,
  userId: string,
  todayStr: string
): Promise<TodaysWorkoutSummary | null> {
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id, state, mesocycle_id, completed_at')
    .eq('user_id', userId)
    .eq('planned_date', todayStr)
    .in('state', ['in_progress', 'planned', 'completed']);
  const list = (sessions ?? []) as {
    id: string;
    state: TodaysWorkoutSummary['state'];
    mesocycle_id: string | null;
    completed_at: string | null;
  }[];
  const session =
    list.find((s) => s.state === 'in_progress') ??
    list.find((s) => s.state === 'planned' && s.mesocycle_id === null) ??
    list
      .filter((s) => s.state === 'completed')
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))[0];
  if (!session) return null;

  const { data: blocks } = await supabase
    .from('exercise_blocks')
    .select('id, target_sets, set_logs!left(id, is_warmup)')
    .eq('workout_session_id', session.id);
  const blockList = (blocks ?? []) as {
    target_sets: number | null;
    set_logs: { is_warmup: boolean | null }[] | null;
  }[];
  return {
    id: session.id,
    name: "Today's workout",
    state: session.state,
    exercises: blockList.length,
    completedSets: blockList.reduce(
      (sum, b) => sum + (b.set_logs ?? []).filter((s) => !s.is_warmup).length,
      0
    ),
    totalSets: blockList.reduce((sum, b) => sum + (b.target_sets || 3), 0),
  };
}
