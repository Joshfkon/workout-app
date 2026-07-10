'use client';

/**
 * React Query hooks for the Eat/nutrition page (UX loading-states work).
 *
 * Two query families:
 *  - ['nutrition','day', dateKey] — the food_log rows for ONE day. Past days
 *    are immutable-in-practice (long staleTime); today gets a short staleTime.
 *    Uses keepPreviousData so switching days never unmounts to a spinner.
 *  - ['nutrition','global'] — the date-independent user context (targets,
 *    weight, custom foods, profile, DEXA, adaptive TDEE, …). Fetched once and
 *    cached across remounts so revisiting the route is instant.
 *
 * Both are 'nutrition'-prefixed so lib/query/idbPersister.ts persists them to
 * IndexedDB: a cold start paints the last-seen day from disk while it
 * revalidates. Date-key logic reuses getLocalDateString (the canonical, UTC-
 * safe utility) — no new date math here.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { getAdaptiveTDEE, type TDEEData } from '@/lib/actions/tdee';
import type {
  FoodLogEntry,
  WeightLogEntry,
  NutritionTargets,
  CustomFood,
} from '@/types/nutrition';

const TODAY_STALE_TIME = 1000 * 60 * 5; // 5 min — today is still being logged

export function nutritionDayKey(dateKey: string) {
  return ['nutrition', 'day', dateKey] as const;
}

export const NUTRITION_GLOBAL_KEY = ['nutrition', 'global'] as const;

export async function fetchFoodLog(dateKey: string): Promise<FoodLogEntry[]> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('food_log')
    .select('*')
    .eq('user_id', user.id)
    .eq('logged_at', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as FoodLogEntry[];
}

/**
 * Per-day food log. `keepPreviousData` means that while a never-fetched day
 * loads, `data` holds the previously-shown day (isPlaceholderData=true) rather
 * than going empty/pending — so the page never blanks to a full-screen
 * spinner. Already-cached days resolve synchronously (isPlaceholderData=false)
 * for an instant switch.
 */
export function useNutritionDay(dateKey: string | null) {
  const isToday = !!dateKey && dateKey === getLocalDateString();
  return useQuery({
    queryKey: nutritionDayKey(dateKey ?? '__none__'),
    queryFn: () => fetchFoodLog(dateKey as string),
    enabled: !!dateKey,
    staleTime: isToday ? TODAY_STALE_TIME : IMMUTABLE_GC_TIME,
    gcTime: IMMUTABLE_GC_TIME,
    placeholderData: keepPreviousData,
  });
}

/** Raw, date-independent nutrition context. Processed by the page. */
export interface NutritionGlobalBundle {
  userId: string;
  targets: NutritionTargets | null;
  targetsError: boolean;
  weight: WeightLogEntry[];
  customFoods: CustomFood[];
  frequentRaw: Array<{
    meal_type: string;
    food_name: string;
    serving_size: string;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    servings: number | null;
  }>;
  user: {
    height_cm: number | string | null;
    age: number | null;
    sex: string | null;
    goal: string | null;
  } | null;
  userError: boolean;
  dexa: { body_fat_percent: number | null; weight_kg: number | null } | null;
  mesocycle: { days_per_week: number | null } | null;
  prefs: { weight_unit: string | null } | null;
  volumeProfile: { training_age: string | null; is_enhanced: boolean | null } | null;
  proteinRaw: Array<{ protein?: number; logged_at: string }>;
  trainingSetsRaw: any[];
  tdee: TDEEData | null;
}

async function fetchNutritionGlobal(): Promise<NutritionGlobalBundle | null> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = getLocalDateString(thirtyDaysAgo);

  const [
    targetsResult,
    weightResult,
    customFoodsResult,
    frequentResult,
    userResult,
    dexaResult,
    mesocycleResult,
    prefsResult,
    volumeProfileResult,
    proteinResult,
    trainingSetsResult,
  ] = await Promise.all([
    supabase.from('nutrition_targets').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('weight_log')
      .select('*')
      .eq('user_id', user.id)
      .gte('logged_at', thirtyDaysAgoStr)
      .order('logged_at', { ascending: false }),
    supabase
      .from('custom_foods')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('food_log')
      .select('meal_type, food_name, serving_size, calories, protein, carbs, fat, servings')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(200),
    supabase.from('users').select('height_cm, age, sex, goal').eq('id', user.id).maybeSingle(),
    supabase
      .from('dexa_scans')
      .select('body_fat_percent, weight_kg')
      .eq('user_id', user.id)
      .order('scan_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('mesocycles')
      .select('days_per_week')
      .eq('user_id', user.id)
      .eq('state', 'active')
      .maybeSingle(),
    supabase.from('user_preferences').select('weight_unit').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('user_volume_profiles')
      .select('training_age, is_enhanced')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('food_log')
      .select('protein, logged_at')
      .eq('user_id', user.id)
      .gte('logged_at', thirtyDaysAgoStr)
      .order('logged_at', { ascending: false }),
    supabase
      .from('exercise_blocks')
      .select(`
        set_logs!inner (id, is_warmup),
        workout_sessions!inner (completed_at, state)
      `)
      .eq('workout_sessions.user_id', user.id)
      .eq('workout_sessions.state', 'completed')
      .gte('workout_sessions.completed_at', thirtyDaysAgo.toISOString()),
  ]);

  let tdee: TDEEData | null = null;
  try {
    tdee = await getAdaptiveTDEE(targetsResult.data?.calories);
  } catch (err) {
    console.error('[Nutrition] Error loading TDEE data:', err);
  }

  return {
    userId: user.id,
    targets: targetsResult.data ?? null,
    targetsError: !!targetsResult.error,
    weight: (weightResult.data ?? []) as WeightLogEntry[],
    customFoods: (customFoodsResult.data ?? []) as CustomFood[],
    frequentRaw: (frequentResult.data ?? []) as NutritionGlobalBundle['frequentRaw'],
    user: (userResult.data ?? null) as NutritionGlobalBundle['user'],
    userError: !!userResult.error,
    dexa: (dexaResult.data ?? null) as NutritionGlobalBundle['dexa'],
    mesocycle: (mesocycleResult.data ?? null) as NutritionGlobalBundle['mesocycle'],
    prefs: (prefsResult.data ?? null) as NutritionGlobalBundle['prefs'],
    volumeProfile: (volumeProfileResult.data ?? null) as NutritionGlobalBundle['volumeProfile'],
    proteinRaw: (proteinResult.data ?? []) as NutritionGlobalBundle['proteinRaw'],
    trainingSetsRaw: (trainingSetsResult.data ?? []) as any[],
    tdee,
  };
}

export function useNutritionGlobal(enabled: boolean) {
  return useQuery({
    queryKey: NUTRITION_GLOBAL_KEY,
    queryFn: fetchNutritionGlobal,
    enabled,
    staleTime: TODAY_STALE_TIME,
    gcTime: IMMUTABLE_GC_TIME,
  });
}
