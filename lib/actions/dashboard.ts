'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import { getLocalDateString } from '@/lib/utils';

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
}

export interface TodaysWorkoutData {
  id: string;
  name: string;
  state: string;
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
    .select(`id, name, start_date, total_weeks, split_type, days_per_week, state, is_active,
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

  const dashboardMesocycle: DashboardMesocycle = {
    id: mesocycle.id,
    name: mesocycle.name,
    startDate: mesocycle.start_date,
    weeks: mesocycle.total_weeks,
    currentWeek: Math.min(weeksSinceStart, mesocycle.total_weeks),
    workoutsCompleted: completed,
    totalWorkouts: sessions.length,
    splitType: mesocycle.split_type,
    daysPerWeek: mesocycle.days_per_week,
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
