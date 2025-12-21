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
    .single();

  // Get weight log entries (last 35 days for a good window)
  const thirtyFiveDaysAgo = new Date();
  thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);

  const { data: weightLogs } = await supabase
    .from('weight_log')
    .select('logged_at, weight')
    .eq('user_id', user.id)
    .gte('logged_at', thirtyFiveDaysAgo.toISOString().split('T')[0])
    .order('logged_at', { ascending: true }) as {
      data: Array<{ logged_at: string; weight: number }> | null;
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
    .single();

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

  for (const wl of weightLogs || []) {
    weightByDate[wl.logged_at] = wl.weight;
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

  // Get current weight (most recent)
  const currentWeight = weightLogs?.length ? weightLogs[weightLogs.length - 1].weight : null;

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

  const { error } = await supabase.from('tdee_estimates').upsert(
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

  const { data, error } = await supabase
    .from('tdee_estimates')
    .select('*')
    .eq('user_id', user.id)
    .single();

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
    estimateHistory: data.estimate_history || [],
    lastUpdated: new Date(data.updated_at),
  };
}
