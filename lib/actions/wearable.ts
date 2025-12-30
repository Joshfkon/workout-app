'use server';

/**
 * Server Actions for Wearable Integration
 *
 * Handles CRUD operations for wearable connections, activity data,
 * and activity settings.
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import type {
  WearableSource,
  WearableConnection,
  WearableConnectionInput,
  DailyActivityData,
  DailyActivityInput,
  ActivitySettings,
  CalorieAdjustmentMode,
  WearableConnectionRow,
  DailyActivityDataRow,
  ActivitySettingsRow,
} from '@/types/wearable';
import { getActivityLevelFromSteps } from '@/types/wearable';

// === WEARABLE CONNECTIONS ===

/**
 * Get all wearable connections for the current user
 */
export async function getWearableConnections(): Promise<WearableConnection[]> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('wearable_connections')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch wearable connections:', error);
    return [];
  }

  return data.map(mapConnectionFromRow);
}

/**
 * Get active (connected) wearable connections
 */
export async function getActiveWearableConnections(): Promise<WearableConnection[]> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('wearable_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_connected', true)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch active wearable connections:', error);
    return [];
  }

  return data.map(mapConnectionFromRow);
}

/**
 * Create or update a wearable connection
 */
export async function upsertWearableConnection(
  input: WearableConnectionInput
): Promise<{ success: boolean; connection?: WearableConnection; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('wearable_connections')
    .upsert(
      {
        user_id: user.id,
        source: input.source,
        is_connected: true,
        last_sync_at: new Date().toISOString(),
        permissions: input.permissions,
        device_name: input.deviceName || null,
        step_calibration_factor: 1.0,
        access_token: input.accessToken || null,
        refresh_token: input.refreshToken || null,
        token_expires_at: input.tokenExpiresAt?.toISOString() || null,
      },
      {
        onConflict: 'user_id,source',
      }
    )
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to upsert wearable connection:', error);
    return { success: false, error: error?.message || 'Failed to save connection' };
  }

  return { success: true, connection: mapConnectionFromRow(data) };
}

/**
 * Disconnect a wearable source
 */
export async function disconnectWearable(
  source: WearableSource
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('wearable_connections')
    .update({
      is_connected: false,
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
    })
    .eq('user_id', user.id)
    .eq('source', source);

  if (error) {
    console.error('Failed to disconnect wearable:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Update step calibration factor for a connection
 */
export async function updateStepCalibration(
  source: WearableSource,
  newFactor: number,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get current connection
  const { data: connection } = await supabase
    .from('wearable_connections')
    .select('id, step_calibration_factor')
    .eq('user_id', user.id)
    .eq('source', source)
    .single();

  if (!connection) {
    return { success: false, error: 'Connection not found' };
  }

  // Update calibration
  const { error: updateError } = await supabase
    .from('wearable_connections')
    .update({ step_calibration_factor: newFactor })
    .eq('id', connection.id);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Log history
  await supabase.from('step_calibration_history').insert({
    user_id: user.id,
    wearable_connection_id: connection.id,
    old_factor: connection.step_calibration_factor,
    new_factor: newFactor,
    reason,
  });

  return { success: true };
}

// === DAILY ACTIVITY DATA ===

/**
 * Get daily activity data for a date
 */
export async function getDailyActivityData(
  date: string
): Promise<DailyActivityData | null> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('daily_activity_data')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .single();

  if (error || !data) {
    return null;
  }

  // Get app workouts for this day
  const { data: workouts } = await supabase
    .from('app_workout_activity')
    .select('*')
    .eq('daily_activity_id', data.id);

  return mapActivityDataFromRow(data, workouts || []);
}

/**
 * Get daily activity data for a date range
 */
export async function getDailyActivityRange(
  startDate: string,
  endDate: string
): Promise<DailyActivityData[]> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('daily_activity_data')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error || !data) {
    console.error('Failed to fetch daily activity range:', error);
    return [];
  }

  return data.map((row) => mapActivityDataFromRow(row, []));
}

/**
 * Save daily activity data
 */
export async function saveDailyActivityData(
  input: DailyActivityInput,
  userWeightKg: number
): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Calculate expenditures
  const caloriesPerStep = 0.04 * (userWeightKg / 70);
  const stepExpenditure = Math.round(input.steps.total * caloriesPerStep);
  const activityLevel = getActivityLevelFromSteps(input.steps.total);

  const { data, error } = await supabase
    .from('daily_activity_data')
    .upsert(
      {
        user_id: user.id,
        date: input.date,
        steps_total: input.steps.total,
        steps_source: input.steps.source,
        steps_hourly_breakdown: input.steps.hourlyBreakdown || null,
        steps_confidence: input.steps.confidence,
        wearable_active_calories: input.wearableActiveCalories || null,
        wearable_active_calories_source: input.wearableActiveCalories
          ? input.steps.source
          : null,
        step_expenditure: stepExpenditure,
        workout_expenditure: 0, // Will be updated separately
        total_activity_expenditure: stepExpenditure,
        activity_level: activityLevel,
      },
      {
        onConflict: 'user_id,date',
      }
    )
    .select('id')
    .single();

  if (error || !data) {
    console.error('Failed to save daily activity data:', error);
    return { success: false, error: error?.message || 'Failed to save activity data' };
  }

  return { success: true, id: data.id };
}

/**
 * Update workout expenditure for a day (called after workout completion)
 */
export async function updateWorkoutExpenditure(
  date: string,
  workoutExpenditure: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Get current data
  const { data: current } = await supabase
    .from('daily_activity_data')
    .select('step_expenditure')
    .eq('user_id', user.id)
    .eq('date', date)
    .single();

  const stepExpenditure = current?.step_expenditure || 0;
  const totalExpenditure = stepExpenditure + workoutExpenditure;

  const { error } = await supabase
    .from('daily_activity_data')
    .update({
      workout_expenditure: workoutExpenditure,
      total_activity_expenditure: totalExpenditure,
    })
    .eq('user_id', user.id)
    .eq('date', date);

  if (error) {
    console.error('Failed to update workout expenditure:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// === ACTIVITY SETTINGS ===

/**
 * Get user's activity settings
 */
export async function getActivitySettings(): Promise<ActivitySettings | null> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('activity_settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    // Return defaults if no settings exist
    return {
      userId: user.id,
      adjustmentMode: 'fixed',
      maxDailyAdjustment: 300,
      targetDeficitCals: 500,
      useAppWorkoutEstimates: true,
      useWearableWorkoutCalories: false,
      preferredWearableSource: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return mapActivitySettingsFromRow(data);
}

/**
 * Save activity settings
 */
export async function saveActivitySettings(
  settings: Partial<ActivitySettings>
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase.from('activity_settings').upsert(
    {
      user_id: user.id,
      adjustment_mode: settings.adjustmentMode || 'fixed',
      max_daily_adjustment: settings.maxDailyAdjustment || 300,
      target_deficit_cals: settings.targetDeficitCals || 500,
      use_app_workout_estimates: settings.useAppWorkoutEstimates ?? true,
      use_wearable_workout_calories: settings.useWearableWorkoutCalories ?? false,
      preferred_wearable_source: settings.preferredWearableSource || null,
    },
    {
      onConflict: 'user_id',
    }
  );

  if (error) {
    console.error('Failed to save activity settings:', error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// === ENHANCED TDEE DATA ===

/**
 * Get enhanced daily data points for TDEE calculation
 */
export async function getEnhancedDailyDataPoints(
  windowDays: number = 28
): Promise<
  Array<{
    date: string;
    weight: number;
    calories: number;
    isComplete: boolean;
    steps: number;
    netSteps: number;
    workoutCalories: number;
    activityLevel: string;
  }>
> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  // Get weight log data (with unit for conversion)
  const { data: weightData } = await supabase
    .from('weight_log')
    .select('logged_at, weight, unit')
    .eq('user_id', user.id)
    .gte('logged_at', cutoffStr)
    .order('logged_at', { ascending: true });

  // Get food log totals by date
  const { data: foodData } = await supabase
    .from('food_log')
    .select('logged_at, calories')
    .eq('user_id', user.id)
    .gte('logged_at', cutoffStr);

  // Get activity data
  const { data: activityData } = await supabase
    .from('daily_activity_data')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', cutoffStr);

  // Create a map of dates to weight (convert to lbs for TDEE calculations)
  // Add validation to detect and fix unit errors
  const weightByDate = new Map<string, number>();
  weightData?.forEach((w) => {
    if (!w.weight || w.weight <= 0) return; // Skip invalid weights
    
    const weightUnit = w.unit || 'lb';
    let weightInLbs = w.weight;
    
    // Validation: detect mislabeled units
    // Reasonable adult human weight range: 80-600 lbs (36-272 kg)
    // Anything outside this range is suspicious and likely a unit error
    
    if (weightUnit === 'lb') {
      if (w.weight > 400) {
        // Weight > 400 lbs is probably in kg, convert (lowered from 500 to catch more errors)
        weightInLbs = w.weight * 2.20462;
        console.warn(`[TDEE] Detected unit error: weight ${w.weight} labeled as 'lb' but likely in kg (too high). Converting to ${weightInLbs.toFixed(1)} lbs.`);
      } else if (w.weight <= 85 && w.weight >= 30) {
        // Weight 30-85 lbs when labeled as 'lb' is suspicious - likely in kg
        // Convert from kg to lbs (includes 80.0, 80.1, 85.0, etc.)
        weightInLbs = w.weight * 2.20462;
        console.warn(`[TDEE] Detected unit error: weight ${w.weight} labeled as 'lb' but likely in kg (too low for adult). Converting to ${weightInLbs.toFixed(1)} lbs.`);
      } else {
        // Normal lbs, use as-is
        weightInLbs = w.weight;
      }
    } else if (weightUnit === 'kg') {
      if (w.weight >= 30 && w.weight <= 150) {
        // Common weights 30-150 kg are actually human weights in lbs, mislabeled as kg
        // The weight is already in lbs, just mislabeled - don't convert, use as-is
        weightInLbs = w.weight;
        console.warn(`[TDEE] Detected unit error: weight ${w.weight} labeled as 'kg' but likely in lbs. Using as-is (${weightInLbs.toFixed(1)} lbs).`);
      } else {
        // Normal kg to lbs conversion
        weightInLbs = w.weight * 2.20462;
      }
    } else {
      // Unknown unit, assume lbs
      weightInLbs = w.weight;
      console.warn(`[TDEE] Unknown weight unit '${weightUnit}', assuming lbs`);
    }
    
    // Final sanity check: weight should be in reasonable human range (30-600 lbs)
    // Using wider range to avoid false positives, outlier detection will catch extreme values
    if (weightInLbs < 30 || weightInLbs > 600) {
      console.warn(`[TDEE] Skipping invalid weight: ${weightInLbs.toFixed(1)} lbs (original: ${w.weight} ${weightUnit}) - outside reasonable human range`);
      return; // Skip this weight entry
    }
    
    weightByDate.set(w.logged_at, weightInLbs);
  });

  // Aggregate calories by date
  const caloriesByDate = new Map<string, number>();
  foodData?.forEach((f) => {
    const current = caloriesByDate.get(f.logged_at) || 0;
    caloriesByDate.set(f.logged_at, current + f.calories);
  });

  // Create activity map
  const activityByDate = new Map<string, DailyActivityDataRow>();
  activityData?.forEach((a) => {
    activityByDate.set(a.date, a);
  });

  // Combine into enhanced data points
  const dataPoints: Array<{
    date: string;
    weight: number;
    calories: number;
    isComplete: boolean;
    steps: number;
    netSteps: number;
    workoutCalories: number;
    activityLevel: string;
  }> = [];

  // Only include dates that have weight data (regression needs weight)
  // But we'll still include dates with calories/activity for completeness
  const allDates = new Set([
    ...Array.from(weightByDate.keys()), // Must have weight
    ...Array.from(caloriesByDate.keys()),
    ...Array.from(activityByDate.keys()),
  ]);

  Array.from(allDates).forEach((date) => {
    const weight = weightByDate.get(date); // Don't default to 0 - use undefined if missing
    const calories = caloriesByDate.get(date) || 0;
    const activity = activityByDate.get(date);

    // Only include days with valid weight data (skip days with 0 or missing weight)
    // This prevents creating invalid pairs in regression
    if (!weight || weight <= 0) {
      return; // Skip this date - no valid weight data
    }

    // Consider day complete if we have weight and calories
    const isComplete = weight > 0 && calories > 0;

    dataPoints.push({
      date,
      weight,
      calories,
      isComplete,
      steps: activity?.steps_total || 0,
      netSteps: activity?.steps_total || 0, // Will be calculated with workout overlap
      workoutCalories: activity?.workout_expenditure || 0,
      activityLevel: activity?.activity_level || 'sedentary',
    });
  });
  
  // Sort by date to ensure proper ordering
  return dataPoints.sort((a, b) => a.date.localeCompare(b.date));
}

// === HELPER FUNCTIONS ===

function mapConnectionFromRow(row: WearableConnectionRow): WearableConnection {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source as WearableSource,
    isConnected: row.is_connected,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
    permissions: row.permissions as WearableConnection['permissions'],
    deviceName: row.device_name || undefined,
    stepCalibrationFactor: row.step_calibration_factor,
    accessToken: row.access_token || undefined,
    refreshToken: row.refresh_token || undefined,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapActivityDataFromRow(
  row: DailyActivityDataRow,
  workouts: Array<{
    workout_session_id: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    muscle_groups: string[];
    total_sets: number;
    total_volume: number;
    average_rest_seconds: number;
    estimated_calories: number;
    steps_overlap: number;
  }>
): DailyActivityData {
  return {
    userId: row.user_id,
    date: row.date,
    steps: {
      total: row.steps_total,
      source: row.steps_source as WearableSource,
      hourlyBreakdown: row.steps_hourly_breakdown || undefined,
      confidence: row.steps_confidence as 'measured' | 'estimated' | 'manual',
    },
    wearableActiveCalories: row.wearable_active_calories
      ? {
          total: row.wearable_active_calories,
          source: row.wearable_active_calories_source as WearableSource,
        }
      : undefined,
    appWorkouts: workouts.map((w) => ({
      workoutId: w.workout_session_id,
      startTime: new Date(w.start_time),
      endTime: new Date(w.end_time),
      durationMinutes: w.duration_minutes,
      muscleGroups: w.muscle_groups,
      totalSets: w.total_sets,
      totalVolume: w.total_volume,
      averageRestSeconds: w.average_rest_seconds,
      estimatedCalories: w.estimated_calories,
      stepsOverlap: w.steps_overlap,
    })),
    calculated: {
      stepExpenditure: row.step_expenditure,
      workoutExpenditure: row.workout_expenditure,
      totalActivityExpenditure: row.total_activity_expenditure,
      activityLevel: row.activity_level as DailyActivityData['calculated']['activityLevel'],
    },
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapActivitySettingsFromRow(row: ActivitySettingsRow): ActivitySettings {
  return {
    userId: row.user_id,
    adjustmentMode: row.adjustment_mode as CalorieAdjustmentMode,
    maxDailyAdjustment: row.max_daily_adjustment,
    targetDeficitCals: row.target_deficit_cals,
    useAppWorkoutEstimates: row.use_app_workout_estimates,
    useWearableWorkoutCalories: row.use_wearable_workout_calories,
    preferredWearableSource: row.preferred_wearable_source as WearableSource | null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
