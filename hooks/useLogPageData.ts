'use client';

/**
 * Boot data for /dashboard/log (the app's landing surface), cached-first.
 *
 * Cold-start perf work: this page used to fetch-in-useEffect on every boot —
 * a getUser() network round trip, then a 10-query batch, then a SERIAL tail
 * (completed sessions → program-slot exercise check) — all gating first
 * meaningful paint (~5.5s on a mid device). Now:
 *
 *  - `useLogHomeQuery` is one persisted React Query (`['log','home']`). A
 *    returning user's cold start rehydrates it from IndexedDB and paints real
 *    content immediately while a background refetch replaces it. Identity
 *    comes from the locally persisted session (no auth round trip) — RLS
 *    still validates the token on every actual request.
 *  - The hero-meta tail (`useLogHeroInfoQuery`) is a separate dependent query
 *    so its two extra round trips never gate paint; the hero's meta line
 *    fills in when it lands.
 *
 * The payload is day-stamped (`date`): day-scoped fields (today's totals,
 * check-in, in-progress banner) from a previous day's cache must not render
 * as today's — the page guards on `data.date === today` for those, while
 * non-day-scoped fields (mesocycle, weight, units) always paint.
 *
 * Mutations that used local setState (discard workout, check-in done, weight
 * saved) now write through `queryClient.setQueryData` so cache and UI stay
 * consistent (see CLAUDE.md "Loading States & Data Caching").
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { getLocalDateString } from '@/lib/utils';
import { bootMark } from '@/lib/perf/bootTrace';
import {
  getWorkoutForDate,
  programSessionHasUsableExercises,
} from '@/lib/training/startMesocycleSession';
import { sessionIndexFromCompleted } from '@/lib/training/mesocycleProgress';
import { getSessionFromProgramData, type ExerciseOverride } from '@/services/mesocycleHelpers';
import { fetchEatingWindow } from '@/lib/nutrition/eatingWindow';
import type { EatingWindow } from '@/services/intakePacing';
import { buildTrainingSchedule, type ScheduleMode } from '@/lib/training/trainingSchedule';
import type { FullProgramRecommendation, WorkoutDay } from '@/types/schema';

export interface LogInProgressSummary {
  id: string;
  /** null for ad-hoc (blank/quick/AI) sessions. */
  mesocycleId: string | null;
  startedAt: string | null;
  setsDone: number;
  /** exercise_block ids, needed by the discard path. */
  blockIds: string[];
}

/** Active mesocycle row: the fields the shared start path + day derivation need. */
export interface LogActiveMesocycleRow {
  id: string;
  name: string;
  current_week: number;
  total_weeks: number;
  deload_week: number;
  split_type: string;
  days_per_week: number;
  preferred_workout_days: WorkoutDay[] | null;
  /** Schedule shape: fixed weekdays, or every-N-days from start_date. */
  schedule_mode?: ScheduleMode | null;
  training_interval_days?: number | null;
  start_date?: string | null;
  program_data: unknown;
  exercise_overrides?: ExerciseOverride[];
}

export interface LogTodaySoFar {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  caloriesTarget: number | null;
  proteinTarget: number | null;
  carbsTarget: number | null;
  fatTarget: number | null;
  steps: number | null;
}

export interface LogHomeData {
  /** Local YYYY-MM-DD this payload was fetched for — guards day-scoped fields. */
  date: string;
  userId: string;
  inProgress: LogInProgressSummary | null;
  activeMeso: LogActiveMesocycleRow | null;
  checkInDone: boolean;
  userGoal: string | null;
  todaySoFar: LogTodaySoFar;
  lastWeight: { date: string; weight: number; unit: 'lb' | 'kg' } | null;
  weightUnit: 'lb' | 'kg';
  eatingWindow: EatingWindow;
}

export interface LogHeroInfo {
  /** program_data day name for today's slot, when its exercises resolve. */
  programDayName: string | null;
  exerciseCount: number;
  estMinutes: number;
  /** ISO timestamp when this split day was last completed, if ever. */
  lastDoneAt: string | null;
}

interface InProgressBlockRow {
  id: string;
  set_logs: { id: string; is_warmup: boolean | null }[] | null;
}

export const LOG_HOME_QUERY_KEY = ['log', 'home'] as const;

async function fetchLogHomeData(): Promise<LogHomeData | null> {
  const supabase = createUntypedClient();
  bootMark('auth-start');
  const userId = await getLocalUserId(supabase);
  bootMark('auth-resolved');
  // No locally persisted session — middleware/auth guards own the redirect;
  // render the signed-out shell rather than throwing into retry loops.
  if (!userId) return null;

  bootMark('data-start');
  const today = getLocalDateString();
  const [
    inProgressRes,
    mesoRes,
    checkInRes,
    goalRes,
    foodRes,
    targetsRes,
    activityRes,
    lastWeightRes,
    prefsRes,
    windowRes,
  ] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select('id, mesocycle_id, started_at, exercise_blocks(id, set_logs(id, is_warmup))')
      .eq('user_id', userId)
      .eq('planned_date', today)
      .eq('state', 'in_progress')
      .limit(1),
    supabase
      .from('mesocycles')
      .select('id, name, current_week, total_weeks, deload_week, split_type, days_per_week, preferred_workout_days, schedule_mode, training_interval_days, start_date, program_data, exercise_overrides, generated_with_enhanced_mode')
      .eq('user_id', userId)
      .eq('state', 'active')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('daily_check_ins')
      .select('id')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('users')
      .select('goal')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('food_log')
      .select('calories, protein, carbs, fat')
      .eq('user_id', userId)
      .eq('logged_at', today),
    supabase
      .from('nutrition_targets')
      .select('calories, protein, carbs, fat')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('daily_activity_data')
      .select('steps_total')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(1),
    supabase
      .from('user_preferences')
      .select('weight_unit')
      .eq('user_id', userId)
      .maybeSingle(),
    fetchEatingWindow(supabase, userId),
  ]);
  bootMark('data-first-batch');

  // Supabase queries resolve with { data: null, error } instead of throwing.
  // When EVERY query errored (offline, dead token, outage), the batch is a
  // failed fetch — not a user with no data. Throw so React Query keeps the
  // last good (persisted) payload and retries, instead of committing an
  // all-empty "success" over it. (fetchEatingWindow never errors — it
  // resolves to a default — so it's excluded from the check.)
  const results = [
    inProgressRes,
    mesoRes,
    checkInRes,
    goalRes,
    foodRes,
    targetsRes,
    activityRes,
    lastWeightRes,
    prefsRes,
  ];
  if (results.every((r) => r.error)) {
    throw new Error(
      `[Log] boot fetch failed entirely: ${mesoRes.error?.message ?? 'unknown error'}`
    );
  }

  const ipRow = inProgressRes.data?.[0];
  let inProgress: LogInProgressSummary | null = null;
  if (ipRow) {
    const blocks = (ipRow.exercise_blocks ?? []) as InProgressBlockRow[];
    inProgress = {
      id: ipRow.id,
      mesocycleId: ipRow.mesocycle_id ?? null,
      startedAt: ipRow.started_at ?? null,
      setsDone: blocks.reduce(
        (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
        0
      ),
      blockIds: blocks.map((b) => b.id),
    };
  }

  const foodRows = (foodRes.data ?? []) as {
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  }[];
  const targets = targetsRes.data as {
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  } | null;
  const activity = activityRes.data as { steps_total: number | null } | null;
  const sumOf = (key: 'calories' | 'protein' | 'carbs' | 'fat') =>
    Math.round(foodRows.reduce((sum, r) => sum + (r[key] || 0), 0));

  const preferredUnit =
    ((prefsRes.data as { weight_unit: string | null } | null)?.weight_unit as 'lb' | 'kg') || 'lb';
  const lastWeightRow = (lastWeightRes.data?.[0] ?? null) as {
    logged_at: string;
    weight: number;
    unit: 'lb' | 'kg' | null;
  } | null;

  bootMark('data-resolved');
  return {
    date: today,
    userId,
    inProgress,
    activeMeso: (mesoRes.data?.[0] ?? null) as LogActiveMesocycleRow | null,
    checkInDone: Boolean(checkInRes.data),
    userGoal: (goalRes.data as { goal: string | null } | null)?.goal ?? null,
    todaySoFar: {
      calories: sumOf('calories'),
      protein: sumOf('protein'),
      carbs: sumOf('carbs'),
      fat: sumOf('fat'),
      caloriesTarget: targets?.calories ?? null,
      proteinTarget: targets?.protein ?? null,
      carbsTarget: targets?.carbs ?? null,
      fatTarget: targets?.fat ?? null,
      steps: activity?.steps_total ?? null,
    },
    lastWeight: lastWeightRow
      ? {
          date: lastWeightRow.logged_at,
          weight: lastWeightRow.weight,
          unit: lastWeightRow.unit || preferredUnit,
        }
      : null,
    weightUnit: preferredUnit,
    eatingWindow: windowRes,
  };
}

/**
 * Main boot query. Persisted (see PERSISTED_QUERY_PREFIXES) so a cold start
 * paints the last-seen data instantly; a short staleTime keeps tab bounces
 * from refetching while every fresh visit revalidates in the background.
 */
export function useLogHomeQuery() {
  return useQuery({
    queryKey: LOG_HOME_QUERY_KEY,
    queryFn: fetchLogHomeData,
    staleTime: 30 * 1000,
  });
}

/**
 * Hero-meta tail: completed-session ordinals + the program-slot exercise
 * check. Two round trips (the second serial on the first) that used to gate
 * the whole page's first paint; as a dependent query the hero renders from
 * `useLogHomeQuery` immediately and this fills in the meta line/title.
 */
export function useLogHeroInfoQuery(meso: LogActiveMesocycleRow | null) {
  return useQuery({
    queryKey: ['log', 'heroInfo', meso?.id ?? null, meso?.current_week ?? 0],
    enabled: Boolean(meso),
    staleTime: 30 * 1000,
    queryFn: async (): Promise<LogHeroInfo | null> => {
      if (!meso) return null;
      const supabase = createUntypedClient();
      const { data: completedRows } = await supabase
        .from('workout_sessions')
        .select('started_at')
        .eq('mesocycle_id', meso.id)
        .eq('state', 'completed')
        .order('started_at', { ascending: true });
      const completed = (completedRows ?? []) as { started_at: string | null }[];

      // The session index is TOTAL completed sessions % days/week (the
      // self-extending scheme the start path uses), so the same ordinal
      // arithmetic also finds when this slot was last trained: one full cycle
      // (days_per_week sessions) ago in completion order.
      const sessionIndex = sessionIndexFromCompleted(completed.length, meso.days_per_week);
      const slotSession = getSessionFromProgramData(
        meso.program_data as FullProgramRecommendation | null,
        sessionIndex,
        meso.current_week,
        meso.total_weeks
      );
      // The hero must advertise the workout Start actually launches: this
      // program slot, which diverges from the calendar weekday after skipped
      // days. Treat the slot as absent (→ calendar fallback) when
      // program_data yields nothing OR none of its exercises resolve in the
      // library — exactly when the start path's block-building loop skips
      // every entry and builds from todayWorkout's muscles instead.
      const slotUsable = await programSessionHasUsableExercises(
        supabase,
        slotSession,
        meso.exercise_overrides
      );
      const programSession = slotUsable ? slotSession : null;

      // Fallback mirrors the start path's legacy behavior: 2 exercises per
      // scheduled muscle when program_data has no usable session.
      const tw = getWorkoutForDate(meso.split_type, new Date(), buildTrainingSchedule(meso));
      const exerciseCount =
        programSession?.exercises.length || (tw ? tw.muscles.length * 2 : 0);
      const estMinutes =
        (programSession?.estimatedMinutes ?? 0) > 0
          ? Math.round(programSession!.estimatedMinutes)
          : exerciseCount * 9;

      const lastCycleIdx = completed.length - meso.days_per_week;
      const lastStartedAt = lastCycleIdx >= 0 ? completed[lastCycleIdx]?.started_at : null;

      return {
        programDayName: programSession?.dayName ?? null,
        exerciseCount,
        estMinutes,
        lastDoneAt: lastStartedAt ?? null,
      };
    },
  });
}

/** Patch the cached home payload in place (optimistic UI after an action). */
export function useLogHomeMutator() {
  const queryClient = useQueryClient();
  return (patch: (data: LogHomeData) => LogHomeData) => {
    queryClient.setQueryData<LogHomeData | null>(LOG_HOME_QUERY_KEY, (prev) =>
      prev ? patch(prev) : prev
    );
  };
}
