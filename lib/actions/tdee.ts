'use server';

import { createClient } from '@/lib/supabase/server';
import {
  calculateAdaptiveTDEE,
  getFormulaTDEE,
  predictFutureWeight,
  checkDataQuality,
  getBestTDEEEstimate,
  getRegressionAnalysis,
  type TDEEEstimate,
  type WeightPrediction,
  type DataQualityCheck,
  type DailyDataPoint,
  type BurnRateHistoryPoint,
  type RegressionAnalysis,
} from '@/lib/nutrition/adaptive-tdee';
import {
  calculateEnhancedTDEE,
  getBestEnhancedEstimate,
} from '@/lib/nutrition/enhanced-tdee';
import type { EnhancedTDEEEstimate } from '@/types/wearable';
import { getEnhancedDailyDataPoints } from '@/lib/actions/wearable';
import type { UserStats, ActivityConfig } from '@/lib/nutrition/macroCalculator';

export interface TDEEData {
  adaptiveEstimate: TDEEEstimate | EnhancedTDEEEstimate | null;
  formulaEstimate: TDEEEstimate;
  bestEstimate: TDEEEstimate | EnhancedTDEEEstimate;
  predictions: WeightPrediction[];
  dataQuality: DataQualityCheck;
  currentWeight: number | null;
  regressionAnalysis: RegressionAnalysis | null;
  isEnhanced: boolean; // Whether enhanced TDEE was used
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

  // Get nutrition targets
  const { data: nutritionTargets } = await supabase
    .from('nutrition_targets')
    .select('calories')
    .eq('user_id', user.id)
    .single() as {
      data: { calories?: number } | null;
    };

  // Try to get enhanced data points (includes steps and workout calories)
  const enhancedDataPoints = await getEnhancedDailyDataPoints(35);
  
  // Get current weight from enhanced data points or fall back to weight_log
  let currentWeight: number | null = null;
  if (enhancedDataPoints.length > 0) {
    // Get most recent weight from enhanced data points
    const latestPoint = enhancedDataPoints[enhancedDataPoints.length - 1];
    currentWeight = latestPoint.weight;
  } else {
    // Fall back to weight_log if no enhanced data
    const thirtyFiveDaysAgo = new Date();
    thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);
    const { data: weightLogs } = await supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', user.id)
      .gte('logged_at', thirtyFiveDaysAgo.toISOString().split('T')[0])
      .order('logged_at', { ascending: false })
      .limit(1) as {
        data: Array<{ logged_at: string; weight: number; unit?: string | null }> | null;
      };
    
    if (weightLogs && weightLogs.length > 0) {
      const latest = weightLogs[0];
      const weightUnit = latest.unit || 'lb';
      currentWeight = weightUnit === 'kg' ? latest.weight * 2.20462 : latest.weight;
    }
  }

  // Convert enhanced data points to format needed for TDEE calculation
  // Enhanced data points already have weight in lbs, calories, steps, and workout calories
  const enhancedPoints = enhancedDataPoints.map(dp => ({
    date: dp.date,
    weight: dp.weight,
    calories: dp.calories,
    isComplete: dp.isComplete,
    steps: dp.steps,
    netSteps: dp.netSteps,
    workoutCalories: dp.workoutCalories,
    activityLevel: (dp.activityLevel || 'sedentary') as 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active',
  }));

  // Also build basic data points for fallback
  const basicDataPoints: DailyDataPoint[] = enhancedPoints.map(dp => ({
    date: dp.date,
    weight: dp.weight,
    calories: dp.calories,
    isComplete: dp.isComplete,
  }));

  // Log weight/calorie pairs for debugging
  if (process.env.NODE_ENV === 'development' || true) { // Always log for now
    console.log('[TDEE] Weight/Calorie pairs being used:', basicDataPoints
      .filter(dp => dp.weight > 0 && dp.calories > 0)
      .map(dp => ({
        date: dp.date,
        weight: `${dp.weight.toFixed(1)} lbs`,
        calories: `${dp.calories.toFixed(0)} cal`,
        isComplete: dp.isComplete,
      }))
    );
    console.log(`[TDEE] Total data points: ${basicDataPoints.length}, With weight & calories: ${basicDataPoints.filter(dp => dp.weight > 0 && dp.calories > 0).length}`);
  }

  // Check data quality using basic data points
  const dataQuality = checkDataQuality(basicDataPoints);

  // Try enhanced TDEE first (if we have activity data)
  let adaptiveEstimate: TDEEEstimate | EnhancedTDEEEstimate | null = null;
  let isEnhanced = false;

  if (currentWeight && enhancedPoints.length >= 10) {
    // Check if we have any activity data (steps or workout calories)
    const hasActivityData = enhancedPoints.some(dp => dp.steps > 0 || dp.workoutCalories > 0);
    
    if (hasActivityData) {
      // Use enhanced TDEE with gradient descent
      adaptiveEstimate = calculateEnhancedTDEE(enhancedPoints, currentWeight);
      if (adaptiveEstimate) {
        isEnhanced = true;
      } else {
        // Enhanced TDEE failed (not enough data after outlier exclusion, etc.), fall back to basic
        adaptiveEstimate = calculateAdaptiveTDEE(basicDataPoints, currentWeight);
      }
    } else {
      // Fall back to basic TDEE if no activity data
      adaptiveEstimate = calculateAdaptiveTDEE(basicDataPoints, currentWeight);
    }
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

  // Get best estimate (handle both basic and enhanced)
  let bestEstimate: TDEEEstimate | EnhancedTDEEEstimate;
  if (isEnhanced && adaptiveEstimate) {
    // Use enhanced estimate if available
    bestEstimate = adaptiveEstimate;
  } else if (adaptiveEstimate) {
    // Use basic estimate
    bestEstimate = getBestTDEEEstimate(adaptiveEstimate as TDEEEstimate, formulaEstimate);
  } else {
    // Fall back to formula
    bestEstimate = formulaEstimate;
  }

  // Calculate predictions
  const predictions: WeightPrediction[] = [];
  const caloriesToUse = targetCalories || nutritionTargets?.calories || bestEstimate.estimatedTDEE;

  if (currentWeight) {
    for (const days of predictionDays) {
      // predictFutureWeight expects TDEEEstimate, but EnhancedTDEEEstimate has all the same fields
      const prediction = predictFutureWeight(currentWeight, bestEstimate as TDEEEstimate, caloriesToUse, days);
      predictions.push(prediction);
    }
  }

  // Get regression analysis for visualization (use basic data points)
  const regressionAnalysis = currentWeight && basicDataPoints.length > 0
    ? getRegressionAnalysis(basicDataPoints, currentWeight)
    : null;

  return {
    adaptiveEstimate,
    formulaEstimate,
    bestEstimate,
    predictions,
    dataQuality,
    currentWeight,
    regressionAnalysis,
    isEnhanced,
  };
}

/**
 * Save a TDEE estimate to the database
 */
export async function saveTDEEEstimate(estimate: TDEEEstimate | EnhancedTDEEEstimate): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return false;
  }

  // Check if this is an enhanced estimate
  const isEnhanced = 'baseBurnRate' in estimate;
  
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
      // Enhanced-specific fields (will be null for basic estimates)
      ...(isEnhanced ? {
        base_burn_rate: estimate.baseBurnRate,
        step_burn_rate: estimate.stepBurnRate,
        workout_multiplier: estimate.workoutMultiplier,
        average_steps: estimate.averageSteps,
        average_workout_calories: estimate.averageWorkoutCalories,
      } : {}),
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
  estimate: TDEEEstimate | EnhancedTDEEEstimate | null;
  syncResult: SyncResult | null;
}> {
  // Get fresh TDEE calculation
  const tdeeData = await getAdaptiveTDEE();

  if (!tdeeData) {
    return { estimate: null, syncResult: null };
  }

  // Save the estimate if we have one
  if (tdeeData.adaptiveEstimate) {
    await saveTDEEEstimate(tdeeData.adaptiveEstimate as TDEEEstimate | EnhancedTDEEEstimate);
  }

  // Try to sync with targets
  const syncResult = await syncAdaptiveTDEEWithTargets();

  return {
    estimate: tdeeData.adaptiveEstimate,
    syncResult,
  };
}
