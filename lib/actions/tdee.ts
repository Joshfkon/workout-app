'use server';

import { createClient } from '@/lib/supabase/server';
import { getLocalDateString } from '@/lib/utils';
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
import { validateWeightEntry } from '@/lib/weightUtils';

export interface TDEEData {
  adaptiveEstimate: TDEEEstimate | EnhancedTDEEEstimate | null;
  formulaEstimate: TDEEEstimate;
  bestEstimate: TDEEEstimate | EnhancedTDEEEstimate;
  predictions: WeightPrediction[];
  dataQuality: DataQualityCheck;
  currentWeight: number | null;
  regressionAnalysis: RegressionAnalysis | null;
  isEnhanced: boolean; // Whether enhanced TDEE was used
  debugData?: {
    weightCaloriePairs: Array<{
      date: string;
      weight: number;
      calories: number;
      isComplete: boolean;
    }>;
    totalDataPoints: number;
    validPairs: number;
  };
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
      .gte('logged_at', getLocalDateString(thirtyFiveDaysAgo))
      .order('logged_at', { ascending: false })
      .limit(1) as {
        data: Array<{ logged_at: string; weight: number; unit?: string | null }> | null;
      };
    
    if (weightLogs && weightLogs.length > 0) {
      const latest = weightLogs[0];
      // Use unified weight validation for consistency with enhanced data path
      const validated = validateWeightEntry(latest.weight, latest.unit as 'lb' | 'kg' | null);
      // Convert to lbs for TDEE calculations
      currentWeight = validated.unit === 'kg'
        ? validated.weight * 2.20462
        : validated.weight;
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

  // Prepare debug data for logging and return
  // NOTE: basicDataPoints already has corrected weights (from getEnhancedDailyDataPoints)
  // This shows the weights AFTER unit validation/conversion
  const validPairs = basicDataPoints.filter(dp => dp.weight > 0 && dp.calories > 0);
  const debugData = {
    weightCaloriePairs: validPairs.map(dp => ({
      date: dp.date,
      weight: dp.weight, // This is already in lbs after unit conversion
      calories: dp.calories,
      isComplete: dp.isComplete,
    })),
    totalDataPoints: basicDataPoints.length,
    validPairs: validPairs.length,
  };

  // Log weight/calorie pairs for debugging (safe for production)
  try {
    console.log('[TDEE] Weight/Calorie pairs being used:', debugData.weightCaloriePairs.map(dp => ({
      date: dp.date,
      weight: `${dp.weight.toFixed(1)} lbs`,
      calories: `${dp.calories.toFixed(0)} cal`,
      isComplete: dp.isComplete,
    })));
    console.log(`[TDEE] Total data points: ${debugData.totalDataPoints}, With weight & calories: ${debugData.validPairs}`);
  } catch (e) {
    // Silently fail if console.log causes issues
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
    debugData, // Include debug data so it can be displayed in UI
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

/**
 * Reset and recalculate TDEE estimates from scratch.
 * Use this after fixing weight unit bugs or when data needs to be recalculated.
 *
 * This function:
 * 1. Deletes the stored TDEE estimate (calculated with potentially buggy data)
 * 2. Recalculates TDEE fresh using the corrected weight validation logic
 * 3. Returns the new estimate and comparison with old values
 */
export async function resetAndRecalculateTDEE(): Promise<{
  success: boolean;
  oldEstimate: {
    tdee: number;
    burnRate: number;
    currentWeight: number;
    confidence: string;
  } | null;
  newEstimate: {
    tdee: number;
    burnRate: number;
    currentWeight: number;
    confidence: string;
    dataPointsUsed: number;
    rSquared: number | null;
  } | null;
  weightDataSummary: {
    totalEntries: number;
    entriesWithKgUnit: number;
    entriesWithLbUnit: number;
    entriesWithNullUnit: number;
    dateRange: { earliest: string; latest: string } | null;
  };
  message: string;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      oldEstimate: null,
      newEstimate: null,
      weightDataSummary: {
        totalEntries: 0,
        entriesWithKgUnit: 0,
        entriesWithLbUnit: 0,
        entriesWithNullUnit: 0,
        dateRange: null,
      },
      message: 'User not authenticated',
    };
  }

  // Step 1: Get the old stored estimate (if any)
  const { data: oldData } = await (supabase.from('tdee_estimates') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('user_id', user.id)
    .single() as {
      data: {
        burn_rate_per_lb: number;
        estimated_tdee: number;
        current_weight: number;
        confidence: string;
      } | null;
    };

  const oldEstimate = oldData ? {
    tdee: oldData.estimated_tdee,
    burnRate: oldData.burn_rate_per_lb,
    currentWeight: oldData.current_weight,
    confidence: oldData.confidence,
  } : null;

  // Step 2: Analyze raw weight data to understand what we're working with
  const { data: weightLogs } = await supabase
    .from('weight_log')
    .select('logged_at, weight, unit')
    .eq('user_id', user.id)
    .order('logged_at', { ascending: true }) as {
      data: Array<{ logged_at: string; weight: number; unit: string | null }> | null;
    };

  const weightDataSummary = {
    totalEntries: weightLogs?.length || 0,
    entriesWithKgUnit: weightLogs?.filter(w => w.unit === 'kg').length || 0,
    entriesWithLbUnit: weightLogs?.filter(w => w.unit === 'lb').length || 0,
    entriesWithNullUnit: weightLogs?.filter(w => !w.unit).length || 0,
    dateRange: weightLogs && weightLogs.length > 0 ? {
      earliest: weightLogs[0].logged_at,
      latest: weightLogs[weightLogs.length - 1].logged_at,
    } : null,
  };

  // Log the raw weight data for debugging
  console.log('[TDEE Reset] Raw weight data summary:', weightDataSummary);
  if (weightLogs && weightLogs.length > 0) {
    console.log('[TDEE Reset] Sample weight entries (first 5):');
    weightLogs.slice(0, 5).forEach(w => {
      const validated = validateWeightEntry(w.weight, w.unit as 'lb' | 'kg' | null);
      const weightInLbs = validated.unit === 'kg' ? validated.weight * 2.20462 : validated.weight;
      console.log(`  ${w.logged_at}: ${w.weight} ${w.unit || '(null)'} → ${weightInLbs.toFixed(1)} lbs`);
    });
  }

  // Step 3: Delete the old TDEE estimate
  const { error: deleteError } = await (supabase.from('tdee_estimates') as ReturnType<typeof supabase.from>)
    .delete()
    .eq('user_id', user.id);

  if (deleteError) {
    console.error('[TDEE Reset] Failed to delete old estimate:', deleteError);
  } else {
    console.log('[TDEE Reset] Deleted old TDEE estimate');
  }

  // Step 4: Recalculate TDEE fresh with corrected weight validation
  const tdeeData = await getAdaptiveTDEE();

  if (!tdeeData) {
    return {
      success: false,
      oldEstimate,
      newEstimate: null,
      weightDataSummary,
      message: 'Failed to recalculate TDEE - not enough data or error occurred',
    };
  }

  // Step 5: Save the new estimate
  if (tdeeData.adaptiveEstimate) {
    await saveTDEEEstimate(tdeeData.adaptiveEstimate as TDEEEstimate | EnhancedTDEEEstimate);
  }

  const newEstimate = tdeeData.adaptiveEstimate ? {
    tdee: tdeeData.adaptiveEstimate.estimatedTDEE,
    burnRate: tdeeData.adaptiveEstimate.burnRatePerLb,
    currentWeight: tdeeData.adaptiveEstimate.currentWeight,
    confidence: tdeeData.adaptiveEstimate.confidence,
    dataPointsUsed: tdeeData.adaptiveEstimate.dataPointsUsed,
    rSquared: tdeeData.regressionAnalysis?.rSquared ?? null,
  } : {
    tdee: tdeeData.formulaEstimate.estimatedTDEE,
    burnRate: tdeeData.formulaEstimate.burnRatePerLb,
    currentWeight: tdeeData.formulaEstimate.currentWeight,
    confidence: tdeeData.formulaEstimate.confidence,
    dataPointsUsed: 0,
    rSquared: null,
  };

  // Build comparison message
  let message = 'TDEE recalculated successfully with corrected weight validation.';
  if (oldEstimate && newEstimate) {
    const tdeeDiff = newEstimate.tdee - oldEstimate.tdee;
    const weightDiff = newEstimate.currentWeight - oldEstimate.currentWeight;
    if (Math.abs(tdeeDiff) > 50 || Math.abs(weightDiff) > 5) {
      message += ` Significant change detected: TDEE ${tdeeDiff > 0 ? '+' : ''}${tdeeDiff} cal/day, Weight ${weightDiff > 0 ? '+' : ''}${weightDiff.toFixed(1)} lbs.`;
      if (Math.abs(weightDiff) > 50) {
        message += ' Large weight difference suggests previous unit conversion bug was affecting your data.';
      }
    }
  }

  if (newEstimate.rSquared !== null) {
    const rSquaredPercent = (newEstimate.rSquared * 100).toFixed(1);
    message += ` New R² correlation: ${rSquaredPercent}%.`;
  }

  return {
    success: true,
    oldEstimate,
    newEstimate,
    weightDataSummary,
    message,
  };
}

/**
 * Get detailed regression diagnostic data for manual verification.
 * Returns all the raw data points used in the regression calculation.
 */
export async function getRegressionDiagnostics(): Promise<{
  success: boolean;
  rawData: Array<{
    date: string;
    weight: number;
    calories: number;
    isComplete: boolean;
  }>;
  regressionPairs: Array<{
    date: string;
    calories: number;
    weight: number;
    weightNextDay: number;
    actualChange: number;
    predictedChange: number;
    residual: number;
  }>;
  excludedPairs: Array<{
    date: string;
    calories: number;
    reason: string;
  }>;
  regressionStats: {
    burnRatePerLb: number;
    estimatedTDEE: number;
    rSquared: number;
    standardError: number;
    dataPointsUsed: number;
    meanActualChange: number;
    ssTot: number;
    ssRes: number;
  } | null;
  manualVerification: {
    sumNumerator: number;
    sumDenominator: number;
    calculatedAlpha: number;
    residuals: number[];
    residualMean: number;
    residualStdDev: number;
  } | null;
  message: string;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      rawData: [],
      regressionPairs: [],
      excludedPairs: [],
      regressionStats: null,
      manualVerification: null,
      message: 'User not authenticated',
    };
  }

  // Get enhanced daily data points (includes weight and calories)
  const enhancedDataPoints = await getEnhancedDailyDataPoints(35);

  const basicDataPoints: DailyDataPoint[] = enhancedDataPoints.map(dp => ({
    date: dp.date,
    weight: dp.weight,
    calories: dp.calories,
    isComplete: dp.isComplete,
  }));

  // Get current weight
  let currentWeight: number | null = null;
  if (enhancedDataPoints.length > 0) {
    const latestPoint = enhancedDataPoints[enhancedDataPoints.length - 1];
    currentWeight = latestPoint.weight;
  }

  if (!currentWeight) {
    return {
      success: false,
      rawData: basicDataPoints.map(dp => ({
        date: dp.date,
        weight: dp.weight,
        calories: dp.calories,
        isComplete: dp.isComplete,
      })),
      regressionPairs: [],
      excludedPairs: [],
      regressionStats: null,
      manualVerification: null,
      message: 'No weight data available',
    };
  }

  // Get regression analysis
  const regressionAnalysis = getRegressionAnalysis(basicDataPoints, currentWeight);

  if (!regressionAnalysis) {
    return {
      success: false,
      rawData: basicDataPoints.map(dp => ({
        date: dp.date,
        weight: dp.weight,
        calories: dp.calories,
        isComplete: dp.isComplete,
      })),
      regressionPairs: [],
      excludedPairs: [],
      regressionStats: null,
      manualVerification: null,
      message: 'Insufficient data for regression analysis',
    };
  }

  // Build detailed regression pairs showing the day-to-day pairing
  const CALORIES_PER_LB = 3500;
  const MIN_CALORIES_THRESHOLD = 1000; // Same as in adaptive-tdee.ts

  const validPairs = basicDataPoints
    .filter(dp => dp.weight > 0 && dp.calories > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const regressionPairs: Array<{
    date: string;
    calories: number;
    weight: number;
    weightNextDay: number;
    actualChange: number;
    predictedChange: number;
    residual: number;
  }> = [];

  const excludedPairs: Array<{
    date: string;
    calories: number;
    reason: string;
  }> = [];

  for (let i = 0; i < validPairs.length - 1; i++) {
    const today = validPairs[i];
    const tomorrow = validPairs[i + 1];

    // Check if dates are consecutive
    const todayDate = new Date(today.date);
    const tomorrowDate = new Date(tomorrow.date);
    const daysDiff = Math.floor((tomorrowDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff !== 1) {
      excludedPairs.push({
        date: today.date,
        calories: today.calories,
        reason: `Non-consecutive: ${daysDiff} days to next entry`,
      });
      continue;
    }

    // Exclude low-calorie days (likely incomplete logging)
    if (today.calories < MIN_CALORIES_THRESHOLD) {
      excludedPairs.push({
        date: today.date,
        calories: today.calories,
        reason: `Low calories: ${today.calories} < ${MIN_CALORIES_THRESHOLD} threshold`,
      });
      continue;
    }

    const actualChange = tomorrow.weight - today.weight;
    const predictedChange = (today.calories - regressionAnalysis.burnRatePerLb * today.weight) / CALORIES_PER_LB;

    regressionPairs.push({
      date: today.date,
      calories: today.calories,
      weight: today.weight,
      weightNextDay: tomorrow.weight,
      actualChange,
      predictedChange,
      residual: actualChange - predictedChange,
    });
  }

  // Manual verification of regression math
  let manualVerification = null;
  if (regressionPairs.length >= 2) {
    let sumNumerator = 0;
    let sumDenominator = 0;

    for (const pair of regressionPairs) {
      sumNumerator += pair.weight * (pair.calories / CALORIES_PER_LB - pair.actualChange);
      sumDenominator += (pair.weight * pair.weight) / CALORIES_PER_LB;
    }

    const calculatedAlpha = sumNumerator / sumDenominator;

    // Recalculate residuals with our alpha
    const residuals = regressionPairs.map(pair => {
      const predicted = (pair.calories - calculatedAlpha * pair.weight) / CALORIES_PER_LB;
      return pair.actualChange - predicted;
    });

    const residualMean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
    const residualVariance = residuals.reduce((sum, r) => sum + (r - residualMean) ** 2, 0) / residuals.length;
    const residualStdDev = Math.sqrt(residualVariance);

    manualVerification = {
      sumNumerator,
      sumDenominator,
      calculatedAlpha,
      residuals,
      residualMean,
      residualStdDev,
    };
  }

  // Calculate detailed R² stats
  const actualChanges = regressionPairs.map(p => p.actualChange);
  const meanActualChange = actualChanges.reduce((a, b) => a + b, 0) / actualChanges.length;
  const ssTot = actualChanges.reduce((sum, ac) => sum + (ac - meanActualChange) ** 2, 0);
  const ssRes = regressionPairs.reduce((sum, p) => sum + p.residual ** 2, 0);

  const regressionStats = {
    burnRatePerLb: regressionAnalysis.burnRatePerLb,
    estimatedTDEE: regressionAnalysis.estimatedTDEE,
    rSquared: regressionAnalysis.rSquared,
    standardError: regressionAnalysis.standardError,
    dataPointsUsed: regressionAnalysis.dataPoints.length,
    meanActualChange,
    ssTot,
    ssRes,
  };

  return {
    success: true,
    rawData: basicDataPoints.map(dp => ({
      date: dp.date,
      weight: dp.weight,
      calories: dp.calories,
      isComplete: dp.isComplete,
    })),
    regressionPairs,
    excludedPairs,
    regressionStats,
    manualVerification,
    message: `Found ${regressionPairs.length} valid pairs (${excludedPairs.length} excluded)`,
  };
}
