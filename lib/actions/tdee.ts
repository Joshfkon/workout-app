'use server';

import { createClient } from '@/lib/supabase/server';
import {
  calculateAdaptiveTDEE,
  getFormulaTDEE,
  predictFutureWeight,
  checkDataQuality,
  getBestTDEEEstimate,
  type TDEEEstimate,
  type WeightPrediction,
  type DataQualityCheck,
  type DailyDataPoint,
  type BurnRateHistoryPoint,
} from '@/lib/nutrition/adaptive-tdee';
import type { UserStats, ActivityConfig } from '@/lib/nutrition/macroCalculator';

export interface TDEEData {
  adaptiveEstimate: TDEEEstimate | null;
  formulaEstimate: TDEEEstimate;
  bestEstimate: TDEEEstimate;
  predictions: WeightPrediction[];
  dataQuality: DataQualityCheck;
  currentWeight: number | null;
}

/**
 * Get the user's adaptive TDEE estimate along with predictions
 */
export async function getAdaptiveTDEE(
  targetCalories?: number,
  predictionDays: number[] = [7, 14, 28, 56]
): Promise<TDEEData | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get user stats for formula-based TDEE
  const { data: userPrefs } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', user.id)
    .single() as {
      data: {
        height_cm?: number;
        age?: number;
        sex?: 'male' | 'female';
        body_fat_percent?: number;
        activity_level?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | 'athlete';
        workouts_per_week?: number;
        avg_workout_minutes?: number;
        workout_intensity?: 'light' | 'moderate' | 'intense';
      } | null;
    };

  // Get weight log entries (last 35 days for a good window)
  const thirtyFiveDaysAgo = new Date();
  thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

  const { data: weightLogs } = await supabase
    .from('weight_log')
    .select('logged_at, weight, unit')
    .eq('user_id', user.id)
    .gte('logged_at', thirtyFiveDaysAgo.toISOString().split('T')[0])
    .order('logged_at', { ascending: true }) as {
      data: Array<{ logged_at: string; weight: number; unit?: string | null }> | null;
    };

  // Get food log entries (daily totals)
  const { data: foodLogs } = await supabase
    .from('food_log')
    .select('logged_at, calories')
    .eq('user_id', user.id)
    .gte('logged_at', thirtyFiveDaysAgo.toISOString().split('T')[0]) as {
      data: Array<{ logged_at: string; calories: number }> | null;
    };

  // Get nutrition targets
  const { data: nutritionTargets } = await supabase
    .from('nutrition_targets')
    .select('calories')
    .eq('user_id', user.id)
    .single() as {
      data: { calories?: number } | null;
    };

  // Aggregate food logs by day
  const dailyCalories: Record<string, { total: number; entries: number }> = {};
  for (const log of foodLogs || []) {
    const date = log.logged_at;
    if (!dailyCalories[date]) {
      dailyCalories[date] = { total: 0, entries: 0 };
    }
    dailyCalories[date].total += log.calories || 0;
    dailyCalories[date].entries += 1;
  }

  // Build data points
  const dataPoints: DailyDataPoint[] = [];
  const weightByDate: Record<string, number> = {};

  // Get user's preferred weight unit (default to lbs)
  // Note: userPrefs doesn't include weight_unit in the type, so we'll fetch it separately or use 'lb' as default
  const preferredUnit = 'lb'; // Default - weights will be converted based on their stored unit

  for (const wl of weightLogs || []) {
    // Convert weight to lbs for TDEE calculations (which use CALORIES_PER_LB)
    let weightInLbs = wl.weight;
    const weightUnit = wl.unit || preferredUnit;
    if (weightUnit === 'kg') {
      weightInLbs = wl.weight * 2.20462;
    }
    weightByDate[wl.logged_at] = weightInLbs;
  }

  // Create data points for days where we have both weight and calories
  const allDates = Array.from(new Set([
    ...Object.keys(dailyCalories),
    ...Object.keys(weightByDate),
  ]));

  for (const date of allDates) {
    const weight = weightByDate[date];
    const calories = dailyCalories[date]?.total || 0;
    const entries = dailyCalories[date]?.entries || 0;

    if (weight && calories > 0) {
      dataPoints.push({
        date,
        weight,
        calories,
        isComplete: entries >= 3, // Consider complete if 3+ food entries
      });
    }
  }

  // Sort by date
  dataPoints.sort((a, b) => a.date.localeCompare(b.date));

  // Get current weight (most recent) - convert to lbs if needed
  let currentWeight: number | null = null;
  if (weightLogs && weightLogs.length > 0) {
    const latest = weightLogs[weightLogs.length - 1];
    const weightUnit = latest.unit || preferredUnit;
    currentWeight = weightUnit === 'kg' ? latest.weight * 2.20462 : latest.weight;
  }

  // Check data quality
  const dataQuality = checkDataQuality(dataPoints);

  // Calculate adaptive TDEE if we have enough data
  let adaptiveEstimate: TDEEEstimate | null = null;
  if (currentWeight && dataPoints.length >= 10) {
    adaptiveEstimate = calculateAdaptiveTDEE(dataPoints, currentWeight);
  }

  // Calculate formula-based TDEE as fallback/comparison
  const userStats: UserStats = {
    weightKg: currentWeight ? currentWeight / 2.20462 : 80, // Convert lbs to kg
    heightCm: userPrefs?.height_cm || 175,
    age: userPrefs?.age || 30,
    sex: userPrefs?.sex || 'male',
    bodyFatPercent: userPrefs?.body_fat_percent || undefined,
  };

  const activityConfig: ActivityConfig = {
    activityLevel: userPrefs?.activity_level || 'moderate',
    workoutsPerWeek: userPrefs?.workouts_per_week || 4,
    avgWorkoutMinutes: userPrefs?.avg_workout_minutes || 60,
    workoutIntensity: userPrefs?.workout_intensity || 'moderate',
  };

  const formulaEstimate = getFormulaTDEE(userStats, activityConfig);

  // Get best estimate
  const bestEstimate = getBestTDEEEstimate(adaptiveEstimate, formulaEstimate);

  // Calculate predictions
  const predictions: WeightPrediction[] = [];
  const caloriesToUse = targetCalories || nutritionTargets?.calories || bestEstimate.estimatedTDEE;

  if (currentWeight) {
    for (const days of predictionDays) {
      const prediction = predictFutureWeight(currentWeight, bestEstimate, caloriesToUse, days);
      predictions.push(prediction);
    }
  }

  return {
    adaptiveEstimate,
    formulaEstimate,
    bestEstimate,
    predictions,
    dataQuality,
    currentWeight,
  };
}

/**
 * Save a TDEE estimate to the database
 */
export async function saveTDEEEstimate(estimate: TDEEEstimate): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Use type assertion since tdee_estimates is a new table not in generated types
  const { error } = await (supabase.from('tdee_estimates') as ReturnType<typeof supabase.from>).upsert(
    {
      user_id: user.id,
      burn_rate_per_lb: estimate.burnRatePerLb,
      estimated_tdee: estimate.estimatedTDEE,
      current_weight: estimate.currentWeight,
      confidence: estimate.confidence,
      confidence_score: estimate.confidenceScore,
      standard_error: estimate.standardError,
      data_points_used: estimate.dataPointsUsed,
      window_days: estimate.windowDays,
      source: estimate.source,
      estimate_history: estimate.estimateHistory,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'user_id',
    }
  );

  return !error;
}

/**
 * Get stored TDEE estimate from database
 */
export async function getStoredTDEEEstimate(): Promise<TDEEEstimate | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Use type assertion since tdee_estimates is a new table not in generated types
  const { data, error } = await (supabase.from('tdee_estimates') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('user_id', user.id)
    .single() as {
      data: {
        burn_rate_per_lb: number;
        estimated_tdee: number;
        current_weight: number;
        confidence: string;
        confidence_score: number;
        standard_error: number;
        data_points_used: number;
        window_days: number;
        source: string;
        estimate_history: unknown[];
        updated_at: string;
      } | null;
      error: unknown;
    };

  if (error || !data) {
    return null;
  }

  return {
    burnRatePerLb: data.burn_rate_per_lb,
    estimatedTDEE: data.estimated_tdee,
    currentWeight: data.current_weight,
    confidence: data.confidence as 'unstable' | 'stabilizing' | 'stable',
    confidenceScore: data.confidence_score,
    standardError: data.standard_error,
    dataPointsUsed: data.data_points_used,
    windowDays: data.window_days,
    source: data.source as 'regression' | 'formula',
    estimateHistory: (data.estimate_history || []) as BurnRateHistoryPoint[],
    lastUpdated: new Date(data.updated_at),
  };
}

export interface SyncResult {
  synced: boolean;
  previousCalories: number | null;
  newCalories: number | null;
  tdeeSource: 'adaptive' | 'formula';
  confidence: 'unstable' | 'stabilizing' | 'stable';
  message: string;
}

/**
 * Sync adaptive TDEE with nutrition targets.
 * Recalculates macros using personalized TDEE when confidence is stable.
 * Returns info about whether targets were updated.
 */
export async function syncAdaptiveTDEEWithTargets(): Promise<SyncResult | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get the adaptive TDEE data
  const tdeeData = await getAdaptiveTDEE();
  if (!tdeeData) {
    return null;
  }

  // Get current nutrition targets
  const { data: currentTargets } = await supabase
    .from('nutrition_targets')
    .select('calories, protein, carbs, fat')
    .eq('user_id', user.id)
    .single() as {
      data: { calories: number; protein: number; carbs: number; fat: number } | null;
    };

  const previousCalories = currentTargets?.calories || null;

  // Only auto-sync when adaptive estimate is stable or stabilizing
  if (!tdeeData.adaptiveEstimate || tdeeData.adaptiveEstimate.confidence === 'unstable') {
    return {
      synced: false,
      previousCalories,
      newCalories: null,
      tdeeSource: 'formula',
      confidence: tdeeData.adaptiveEstimate?.confidence || 'unstable',
      message: 'Not enough data yet. Keep logging to unlock personalized targets.',
    };
  }

  // Check if adaptive TDEE differs significantly from current targets
  const adaptiveTDEE = tdeeData.adaptiveEstimate.estimatedTDEE;
  const currentTDEE = tdeeData.formulaEstimate.estimatedTDEE;
  const difference = Math.abs(adaptiveTDEE - currentTDEE);

  // If using stable estimate and it differs by more than 50 cal, update targets
  if (tdeeData.adaptiveEstimate.confidence === 'stable' && difference > 50) {
    // Get user preferences for macro calculation
    const { data: userPrefs } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single() as {
        data: {
          height_cm?: number;
          age?: number;
          sex?: 'male' | 'female';
          body_fat_percent?: number;
          activity_level?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active' | 'athlete';
          workouts_per_week?: number;
          avg_workout_minutes?: number;
          workout_intensity?: 'light' | 'moderate' | 'intense';
        } | null;
      };

    // Get macro settings for goal
    const { data: macroSettings } = await supabase
      .from('macro_settings')
      .select('goal, peptide')
      .eq('user_id', user.id)
      .single() as {
        data: { goal?: string; peptide?: string } | null;
      };

    // Import and use calculateMacros with adaptive TDEE
    const { calculateMacros } = await import('@/lib/nutrition/macroCalculator');

    const stats: UserStats = {
      weightKg: tdeeData.currentWeight ? tdeeData.currentWeight / 2.20462 : 80,
      heightCm: userPrefs?.height_cm || 175,
      age: userPrefs?.age || 30,
      sex: userPrefs?.sex || 'male',
      bodyFatPercent: userPrefs?.body_fat_percent,
    };

    const activity: ActivityConfig = {
      activityLevel: userPrefs?.activity_level || 'moderate',
      workoutsPerWeek: userPrefs?.workouts_per_week || 4,
      avgWorkoutMinutes: userPrefs?.avg_workout_minutes || 60,
      workoutIntensity: userPrefs?.workout_intensity || 'moderate',
    };

    const goalConfig = {
      goal: (macroSettings?.goal || 'maintain') as 'aggressive_cut' | 'moderate_cut' | 'slow_cut' | 'maintain' | 'slow_bulk' | 'moderate_bulk' | 'aggressive_bulk',
      peptide: (macroSettings?.peptide || 'none') as 'none' | 'semaglutide' | 'tirzepatide' | 'retatrutide' | 'liraglutide' | 'tesofensine' | 'gh_peptides',
    };

    // Calculate new macros using adaptive TDEE
    const newMacros = calculateMacros(stats, activity, goalConfig, adaptiveTDEE);

    // Update nutrition targets - use type assertion since nutrition_targets typing is strict
    await (supabase.from('nutrition_targets') as ReturnType<typeof supabase.from>)
      .upsert({
        user_id: user.id,
        calories: newMacros.calories,
        protein: newMacros.protein,
        carbs: newMacros.carbs,
        fat: newMacros.fat,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    const direction = adaptiveTDEE > currentTDEE ? 'higher' : 'lower';
    return {
      synced: true,
      previousCalories,
      newCalories: newMacros.calories,
      tdeeSource: 'adaptive',
      confidence: 'stable',
      message: `Your metabolism is ${Math.abs(difference)} cal/day ${direction} than estimated. Targets updated!`,
    };
  }

  // Stabilizing but not yet stable enough to auto-update
  if (tdeeData.adaptiveEstimate.confidence === 'stabilizing') {
    return {
      synced: false,
      previousCalories,
      newCalories: null,
      tdeeSource: 'formula',
      confidence: 'stabilizing',
      message: 'Your estimate is stabilizing. A few more days of data needed.',
    };
  }

  return {
    synced: false,
    previousCalories,
    newCalories: null,
    tdeeSource: 'adaptive',
    confidence: tdeeData.adaptiveEstimate.confidence,
    message: 'Targets are already up to date.',
  };
}

/**
 * Recalculate and sync TDEE after new weight is logged.
 * Call this from the weight logging flow.
 */
export async function onWeightLoggedRecalculateTDEE(): Promise<{
  estimate: TDEEEstimate | null;
  syncResult: SyncResult | null;
}> {
  // Get fresh TDEE calculation
  const tdeeData = await getAdaptiveTDEE();

  if (!tdeeData) {
    return { estimate: null, syncResult: null };
  }

  // Save the estimate if we have one
  if (tdeeData.adaptiveEstimate) {
    await saveTDEEEstimate(tdeeData.adaptiveEstimate);
  }

  // Try to sync with targets
  const syncResult = await syncAdaptiveTDEEWithTargets();

  return {
    estimate: tdeeData.adaptiveEstimate,
    syncResult,
  };
}
