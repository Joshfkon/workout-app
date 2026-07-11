'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import { getLocalDateString, inputWeightToKg } from '@/lib/utils';
import { buildAnchoredBodyCompTrend } from '@/services/bodyCompAnchor';
import { analyzeBodyCompTrend, computeFFMI } from '@/services/bodyCompEngine';
import { getBodyCompLayout } from '@/services/compositionSpace';
import { type WorkoutDay } from '@/types/schema';
import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  weeklyVolumeWindowStartISO,
  type MuscleVolumeStats,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { StandardMuscleGroup } from '@/types/schema';
import {
  computeLiftTrends,
  LIFT_TREND_WINDOW_DAYS,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { computeWeekSessions } from '@/app/(dashboard)/dashboard/_lib/weekSessions';
import type { PlateauGoal } from '@/services/plateauDetector';

export interface DashboardMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  workoutsCompleted: number;
  totalWorkouts: number;
  splitType: string;
  daysPerWeek: number;
  preferredWorkoutDays?: WorkoutDay[] | null;
  /** Sessions completed vs expected inside the current mesocycle week. */
  weekSessionsDone?: number;
  weekSessionsTotal?: number;
}

export interface TodaysWorkoutData {
  id: string;
  name: string;
  state: 'planned' | 'in_progress' | 'completed';
  exercises: number;
  completedSets: number;
  totalSets: number;
}

export interface NutritionData {
  totals: { calories: number; protein: number; carbs: number; fat: number };
  targets: { calories: number; protein: number; carbs: number; fat: number; cardio_prescription?: any } | null;
}

export interface WeightData {
  todaysWeight: { weight: number; unit: string } | null;
  weightHistory: { date: string; weight: number; unit: string }[];
  preferredUnit: 'lb' | 'kg';
}

/**
 * Compact body-composition glance for the Home card. Null until the user has
 * ≥2 DEXA scans and a profile height (getBodyCompLayout's home-card gate) —
 * a single scan can't show a trend, and FFMI needs height.
 */
export interface BodyCompGlance {
  scanCount: number;
  /** Latest ANCHORED BF% / raw FFMI — the last point of the same anchored
   * series the Body Composition Trend chart and FFMI gauge read, not the raw
   * latest scan (which goes stale as weigh-ins accumulate after it). */
  bodyFatPercent: number;
  ffmi: number;
  /** Monthly change rates across the scan history (trend arrows). */
  bodyFatRatePerMonth: number;
  ffmiRatePerMonth: number;
}

/**
 * Fetch active mesocycle and today's workout for the dashboard
 */
export async function fetchMesocycleData(userId: string): Promise<{
  mesocycle: DashboardMesocycle | null;
  todaysWorkout: TodaysWorkoutData | null;
}> {
  const supabase = await createUntypedServerClient();
  const today = new Date();
  const todayStr = getLocalDateString(today);

  const { data: mesocycles } = await supabase
    .from('mesocycles')
    .select(`id, name, start_date, total_weeks, split_type, days_per_week, preferred_workout_days, state, is_active,
      workout_sessions (id, planned_date, state, completed_at)`)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  let mesocycle = mesocycles?.find((m: any) => m.is_active === true || m.state === 'active') || null;
  if (!mesocycle && mesocycles && mesocycles.length > 0) {
    mesocycle = mesocycles.find((m: any) => m.state !== 'completed') || null;
  }

  if (!mesocycle) {
    return { mesocycle: null, todaysWorkout: null };
  }

  const startDate = new Date(mesocycle.start_date);
  const weeksSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const sessions = mesocycle.workout_sessions || [];
  const completed = sessions.filter((s: any) => s.state === 'completed').length;

  const currentWeek = Math.min(weeksSinceStart, mesocycle.total_weeks);
  const weekSessions = computeWeekSessions(
    sessions,
    mesocycle.start_date,
    currentWeek,
    mesocycle.days_per_week || 0
  );

  const dashboardMesocycle: DashboardMesocycle = {
    id: mesocycle.id,
    name: mesocycle.name,
    startDate: mesocycle.start_date,
    weeks: mesocycle.total_weeks,
    currentWeek,
    workoutsCompleted: completed,
    totalWorkouts: sessions.length,
    splitType: mesocycle.split_type,
    daysPerWeek: mesocycle.days_per_week,
    preferredWorkoutDays: mesocycle.preferred_workout_days || null,
    weekSessionsDone: weekSessions?.done,
    weekSessionsTotal: weekSessions?.total,
  };

  // Check for today's workout
  const todaySession = sessions.find((s: any) =>
    s.planned_date === todayStr || s.state === 'in_progress'
  );

  let todaysWorkout: TodaysWorkoutData | null = null;
  if (todaySession) {
    const { data: blocksWithSets } = await supabase
      .from('exercise_blocks')
      .select(`id, target_sets, set_logs!left(id, is_warmup)`)
      .eq('workout_session_id', todaySession.id);

    const blocks = blocksWithSets || [];
    const completedSets = blocks.reduce((sum: number, b: any) => {
      const workingSets = (b.set_logs || []).filter((s: any) => !s.is_warmup);
      return sum + workingSets.length;
    }, 0);

    todaysWorkout = {
      id: todaySession.id,
      name: mesocycle.name,
      state: todaySession.state,
      exercises: blocks.length,
      completedSets,
      totalSets: blocks.reduce((sum: number, b: any) => sum + (b.target_sets || 3), 0),
    };
  }

  return { mesocycle: dashboardMesocycle, todaysWorkout };
}

/**
 * Fetch nutrition data for today
 */
export async function fetchNutritionData(userId: string): Promise<NutritionData> {
  const supabase = await createUntypedServerClient();
  const todayStr = getLocalDateString();

  const [nutritionResult, targetsResult] = await Promise.all([
    supabase
      .from('food_log')
      .select('calories, protein, carbs, fat')
      .eq('user_id', userId)
      .eq('logged_at', todayStr),
    supabase
      .from('nutrition_targets')
      .select('calories, protein, carbs, fat, cardio_prescription')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const totals = nutritionResult.data?.reduce(
    (acc: any, entry: any) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fat: acc.fat + (entry.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  ) || { calories: 0, protein: 0, carbs: 0, fat: 0 };

  return {
    totals,
    targets: targetsResult.data || null,
  };
}

/**
 * Fetch weight data including today's weight and history
 */
export async function fetchWeightData(userId: string): Promise<WeightData> {
  const supabase = await createUntypedServerClient();
  const today = new Date();
  const todayStr = getLocalDateString(today);
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);

  const [weightResult, weightHistoryResult, prefsResult] = await Promise.all([
    supabase
      .from('weight_log')
      .select('weight, unit')
      .eq('user_id', userId)
      .eq('logged_at', todayStr)
      .maybeSingle(),
    supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', userId)
      .gte('logged_at', getLocalDateString(ninetyDaysAgo))
      .order('logged_at', { ascending: true }),
    supabase
      .from('user_preferences')
      .select('weight_unit')
      .eq('user_id', userId)
      .single(),
  ]);

  const preferredUnit = (prefsResult.data?.weight_unit as 'lb' | 'kg') || 'lb';

  return {
    todaysWeight: weightResult.data
      ? { weight: weightResult.data.weight, unit: weightResult.data.unit || preferredUnit }
      : null,
    weightHistory: (weightHistoryResult.data || []).map((w: any) => ({
      date: w.logged_at,
      weight: w.weight,
      unit: w.unit || preferredUnit,
    })),
    preferredUnit,
  };
}

/**
 * Body-comp glance for the Home card: latest anchored BF% + FFMI with
 * monthly trend rates. Null below 2 scans or without a profile height.
 */
export async function fetchBodyCompGlance(userId: string): Promise<BodyCompGlance | null> {
  const supabase = await createUntypedServerClient();
  const yearAgo = new Date();
  yearAgo.setDate(yearAgo.getDate() - 365);

  const [scansRes, weightsRes, profileRes] = await Promise.all([
    supabase
      .from('dexa_scans')
      .select('scan_date, body_fat_percent, lean_mass_kg, fat_mass_kg, weight_kg, bone_mass_kg')
      .eq('user_id', userId)
      .order('scan_date', { ascending: true }),
    supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', userId)
      .gte('logged_at', getLocalDateString(yearAgo))
      .order('logged_at', { ascending: true }),
    supabase.from('users').select('height_cm').eq('id', userId).single(),
  ]);

  const scans = scansRes.data ?? [];
  const heightCm = profileRes.data?.height_cm ? Number(profileRes.data.height_cm) : null;
  if (!getBodyCompLayout(scans.length).showHomeCard || !heightCm) return null;

  // Same anchored series the Body tab charts read (bodyCompAnchor), so the
  // card and the module it deep-links to can never disagree.
  const trend = buildAnchoredBodyCompTrend(
    (weightsRes.data ?? []).map((row: any) => ({
      date: row.logged_at,
      weightKg: inputWeightToKg(Number(row.weight), (row.unit ?? 'lb') as 'lb' | 'kg'),
    })),
    scans.map((scan: any) => ({
      date: scan.scan_date,
      bodyFatPercent: Number(scan.body_fat_percent),
      leanMassKg: Number(scan.lean_mass_kg),
      fatMassKg: Number(scan.fat_mass_kg),
      weightKg: scan.weight_kg != null ? Number(scan.weight_kg) : undefined,
      boneMassKg: scan.bone_mass_kg != null ? Number(scan.bone_mass_kg) : null,
    }))
  );
  if (trend.length === 0) return null;
  const latest = trend[trend.length - 1];

  const rates = analyzeBodyCompTrend(
    scans.map(
      (scan: any) =>
        ({
          scanDate: scan.scan_date,
          bodyFatPercent: Number(scan.body_fat_percent),
          leanMassKg: Number(scan.lean_mass_kg),
          fatMassKg: Number(scan.fat_mass_kg),
        }) as any
    ),
    heightCm
  );

  return {
    scanCount: scans.length,
    bodyFatPercent: latest.bodyFatPercent,
    ffmi: computeFFMI(latest.leanMassKg, latest.boneMassKg, heightCm).ffmi,
    bodyFatRatePerMonth: rates?.bodyFatChangeRate ?? 0,
    ffmiRatePerMonth: rates?.ffmiChangeRate ?? 0,
  };
}

/**
 * Fetch user goal
 */
export async function fetchUserGoal(userId: string): Promise<string> {
  const supabase = await createUntypedServerClient();
  const { data } = await supabase
    .from('users')
    .select('goal')
    .eq('id', userId)
    .single();
  return data?.goal || 'maintain';
}

/**
 * Fetch completed workouts count
 */
export async function fetchCompletedWorkoutsCount(userId: string): Promise<number> {
  const supabase = await createUntypedServerClient();
  const { count } = await supabase
    .from('workout_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('state', 'completed');
  return count || 0;
}

/**
 * Lift trends for the home "Lifts" glance tile: top-set E1RM trend per
 * frequently-trained exercise over the last 12 weeks (rising / flat / down
 * plus the longest stall). Heavy lifting is in the shared pure helper so the
 * client full-fetch path can reuse it.
 */
export async function fetchLiftTrends(userId: string): Promise<LiftTrendsSummary> {
  const supabase = await createUntypedServerClient();
  const since = new Date();
  since.setDate(since.getDate() - LIFT_TREND_WINDOW_DAYS);

  const [{ data: sessions }, { data: profile }, { data: activeMesos }] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select(`id, completed_at,
        exercise_blocks (exercises (id, name), set_logs (weight_kg, reps, is_warmup))`)
      .eq('user_id', userId)
      .eq('state', 'completed')
      .gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: true }),
    supabase.from('users').select('goal').eq('id', userId).single(),
    // Active program start — trend verdicts across this boundary are
    // low-confidence until a few sessions rebuild the history.
    supabase
      .from('mesocycles')
      .select('start_date')
      .eq('user_id', userId)
      .or('is_active.eq.true,state.eq.active')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  return computeLiftTrends(
    (sessions as any) || [],
    (profile?.goal as PlateauGoal | null) ?? undefined,
    new Date(),
    { programStartDate: activeMesos?.[0]?.start_date ?? null }
  );
}

/**
 * Weekly per-muscle volume for the atrophy-risk card (item 6: server-render
 * first paint). Same query + pure pipeline the client fast-path used, moved
 * server-side so the card — the dashboard's LCP element — ships in the HTML
 * instead of waiting on a post-hydration fetch.
 */
export interface WeeklyMuscleVolumeResult {
  stats: MuscleVolumeStats[];
  /**
   * Standard muscles the user's own logged exercises can credit — drives the
   * fine-muscle (erectors / glute_med / obliques) warning gate so the home
   * card never nags about a muscle no logged exercise could satisfy.
   */
  reachable: StandardMuscleGroup[];
}

export async function fetchWeeklyMuscleVolume(userId: string): Promise<WeeklyMuscleVolumeResult> {
  const supabase = await createUntypedServerClient();
  // Shared local-day-anchored window (see weeklyVolumeWindowStartISO) so this
  // server first-paint value matches the client fast-path and the volume page.
  const weekStartIso = weeklyVolumeWindowStartISO();

  const { data } = await supabase
    .from('exercise_blocks')
    .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
      workout_sessions!inner (user_id, completed_at, state)`)
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed')
    .gte('workout_sessions.completed_at', weekStartIso);

  const blocks = (data as any) || [];
  return {
    stats: computeWeeklyMuscleVolume(blocks),
    reachable: Array.from(computeReachableMuscles(blocks)),
  };
}
