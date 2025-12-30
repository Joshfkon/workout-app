/**
 * Wearable Integration Types
 *
 * Types for integrating step data from Apple HealthKit, Google Fit, Fitbit,
 * and other wearable devices to enhance TDEE calculations.
 */

// === WEARABLE SOURCE TYPES ===

/** Supported wearable data sources */
export type WearableSource =
  | 'apple_healthkit'
  | 'google_fit'
  | 'fitbit'
  | 'samsung_health'
  | 'garmin'
  | 'manual';

/** Permissions that can be granted for wearable data access */
export type WearablePermission =
  | 'steps'
  | 'active_energy'
  | 'workouts'
  | 'heart_rate'
  | 'sleep';

/** Data confidence level */
export type DataConfidence = 'measured' | 'estimated' | 'manual';

/** Activity level classification based on step count and workouts */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

/** Workout intensity level */
export type WorkoutIntensity = 'low' | 'moderate' | 'high' | 'very_high';

/** Calorie adjustment mode for daily targets */
export type CalorieAdjustmentMode = 'fixed' | 'activity_adjusted' | 'deficit_locked';

// === WEARABLE CONNECTION ===

/**
 * Represents a user's connection to a wearable data source
 */
export interface WearableConnection {
  id: string;
  userId: string;
  source: WearableSource;
  isConnected: boolean;
  lastSyncAt: Date | null;
  permissions: WearablePermission[];
  deviceName?: string; // "Apple Watch Series 9", "Fitbit Charge 5"

  // Normalization factors (learned over time)
  stepCalibrationFactor: number; // Default 1.0, adjusted based on patterns

  // OAuth tokens for Fitbit/Garmin (encrypted)
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of a permission request
 */
export interface PermissionResult {
  granted: boolean;
  permissions?: WearablePermission[];
  reason?: string;
}

// === STEP DATA ===

/**
 * Step data from a wearable source
 */
export interface StepData {
  date: string; // YYYY-MM-DD
  steps: number;
  source: WearableSource;
  deviceName?: string;
  hourlyBreakdown?: number[]; // 24 values for each hour
  confidence: DataConfidence;
}

/**
 * Energy/calorie data from wearables
 */
export interface EnergyData {
  date: string;
  activeCalories: number;
  basalCalories?: number;
  source: WearableSource;
}

/**
 * Workout data from wearables (used cautiously for lifting)
 */
export interface WearableWorkoutData {
  id: string;
  startTime: Date;
  endTime: Date;
  workoutType: string;
  calories: number;
  heartRateAvg?: number;
  heartRateMax?: number;
  source: WearableSource;
}

// === DAILY ACTIVITY DATA ===

/**
 * Complete daily activity data combining wearable and app data
 */
export interface DailyActivityData {
  userId: string;
  date: string; // YYYY-MM-DD

  // Step data
  steps: {
    total: number;
    source: WearableSource;
    hourlyBreakdown?: number[]; // 24 values for each hour
    confidence: DataConfidence;
  };

  // Wearable-reported calories (used cautiously)
  wearableActiveCalories?: {
    total: number;
    source: WearableSource;
    // We don't fully trust this, especially for lifting
  };

  // App workout data (more reliable for resistance training)
  appWorkouts: AppWorkoutActivity[];

  // Calculated values
  calculated: {
    stepExpenditure: number; // Calories from steps
    workoutExpenditure: number; // Calories from logged workouts
    totalActivityExpenditure: number;
    activityLevel: ActivityLevel;
  };

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workout activity from our app (resistance training)
 */
export interface AppWorkoutActivity {
  workoutId: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;

  // From our workout logging
  muscleGroups: string[];
  totalSets: number;
  totalVolume: number; // Sets x reps x weight
  averageRestSeconds: number;

  // Estimated expenditure (conservative)
  estimatedCalories: number;

  // Steps during this period (to avoid double-count)
  stepsOverlap: number;
}

// === WORKOUT CALORIE ESTIMATION ===

/**
 * Estimate of calories burned during resistance training
 */
export interface WorkoutExpenditureEstimate {
  baseCalories: number; // From duration and intensity
  epocEstimate: number; // Excess Post-Exercise Oxygen Consumption
  totalEstimate: number;
  confidence: 'low' | 'medium' | 'high';
  method: string;
}

/**
 * Net activity expenditure after accounting for overlaps
 */
export interface NetActivityExpenditure {
  stepExpenditure: number;
  workoutExpenditure: number;
  totalExpenditure: number;
  adjustments: string[];
}

// === ENHANCED TDEE ===

/**
 * Enhanced TDEE estimate incorporating activity data
 *
 * Daily TDEE = BMR + (beta x net_steps) + (gamma x workout_expenditure)
 * Where BMR = alpha x weight (the base burn rate we already estimate)
 */
export interface EnhancedTDEEEstimate {
  // Base components
  baseBurnRate: number; // alpha - cal per unit weight at rest
  stepBurnRate: number; // beta - cal per step
  workoutMultiplier: number; // gamma - multiplier on workout estimates

  // Legacy compatibility
  burnRatePerLb: number;
  estimatedTDEE: number;

  // Daily breakdown (for today or any day)
  dailyBreakdown?: {
    baseTDEE: number; // alpha x weight
    stepExpenditure: number; // beta x net_steps
    workoutExpenditure: number; // gamma x estimated workout cals
    totalTDEE: number;
  };

  // Averages
  averageSteps: number;
  averageWorkoutCalories: number;

  // From base TDEEEstimate
  confidence: 'unstable' | 'stabilizing' | 'stable';
  confidenceScore: number;
  dataPointsUsed: number;
  dataPointsAfterOutlierExclusion?: number; // Data points after removing outliers
  windowDays: number;
  standardError: number;
  lastUpdated: Date;
  source: 'regression' | 'formula' | 'enhanced_regression';
  estimateHistory: BurnRateHistoryPoint[];
  currentWeight: number;
}

/**
 * Burn rate history point for tracking estimates over time
 */
export interface BurnRateHistoryPoint {
  date: string;
  burnRate: number;
  confidence: number;
}

/**
 * Enhanced daily data point including activity data
 */
export interface EnhancedDailyDataPoint {
  date: string;
  weight: number;
  calories: number;
  isComplete: boolean;
  steps: number;
  netSteps: number; // After deducting workout overlap
  workoutCalories: number;
  activityLevel: ActivityLevel;
}

/**
 * Daily TDEE calculation result
 */
export interface DailyTDEEResult {
  baseTDEE: number;
  stepExpenditure: number;
  workoutExpenditure: number;
  totalTDEE: number;
  vsAverage: number; // Difference from average day
}

// === DYNAMIC CALORIE TARGETS ===

/**
 * User's activity-related settings
 */
export interface ActivitySettings {
  userId: string;

  // Calorie adjustment settings
  adjustmentMode: CalorieAdjustmentMode;
  maxDailyAdjustment: number; // Cap on adjustments, e.g., 300 cal
  targetDeficitCals: number; // For deficit-locked mode

  // Workout calorie source preference
  useAppWorkoutEstimates: boolean; // Default true
  useWearableWorkoutCalories: boolean; // Default false (often overestimates)

  // Step data source
  preferredWearableSource: WearableSource | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Daily calorie target with activity adjustments
 */
export interface DailyCalorieTarget {
  baseTarget: number; // User's set target
  adjustedTarget: number; // After activity adjustment
  adjustment: number; // How much we adjusted
  reason: string;

  // Breakdown
  tdeeEstimate: number;
  targetDeficit: number;
}

// === STEP NORMALIZATION ===

/**
 * Baseline multipliers for normalizing step counts across devices
 * Apple Watch is used as the reference baseline (1.0)
 */
export const BASELINE_STEP_MULTIPLIERS: Record<WearableSource, number> = {
  apple_healthkit: 1.0, // Reference baseline
  google_fit: 0.95, // Tends to count slightly more
  fitbit: 1.02, // Tends to count slightly less
  samsung_health: 0.97,
  garmin: 1.0,
  manual: 1.0,
};

/**
 * Step normalization configuration
 */
export interface StepNormalization {
  baselineMultipliers: Record<WearableSource, number>;
  userCalibration: number; // User-specific adjustment (learned)
}

// === SYNC STATUS ===

/**
 * Health update from wearable subscription
 */
export interface HealthUpdate {
  type: 'steps' | 'calories' | 'workout';
  date: string;
  data: StepData | EnergyData | WearableWorkoutData;
}

/**
 * Sync result from activity sync service
 */
export interface SyncResult {
  success: boolean;
  source: WearableSource;
  date: string;
  stepsSync?: {
    count: number;
    updated: boolean;
  };
  caloriesSync?: {
    total: number;
    updated: boolean;
  };
  error?: string;
}

// === ACTIVITY THRESHOLDS ===

/**
 * Step thresholds for activity level classification
 */
export const ACTIVITY_LEVEL_THRESHOLDS: Record<ActivityLevel, { min: number; max: number }> = {
  sedentary: { min: 0, max: 2500 },
  light: { min: 2501, max: 5000 },
  moderate: { min: 5001, max: 7500 },
  active: { min: 7501, max: 10000 },
  very_active: { min: 10001, max: Infinity },
};

/**
 * Get activity level from step count
 */
export function getActivityLevelFromSteps(steps: number): ActivityLevel {
  if (steps <= 2500) return 'sedentary';
  if (steps <= 5000) return 'light';
  if (steps <= 7500) return 'moderate';
  if (steps <= 10000) return 'active';
  return 'very_active';
}

// === CALORIE ESTIMATION CONSTANTS ===

/**
 * Conservative calorie rates per minute for resistance training
 */
export const WORKOUT_CALORIES_PER_MINUTE: Record<WorkoutIntensity, number> = {
  low: 4, // Light weights, long rest
  moderate: 6, // Typical hypertrophy training
  high: 8, // Heavy compounds, short rest
  very_high: 10, // High intensity, minimal rest
};

/**
 * EPOC (afterburn) multipliers based on intensity
 */
export const EPOC_MULTIPLIERS: Record<WorkoutIntensity, number> = {
  low: 0.06,
  moderate: 0.08,
  high: 0.12,
  very_high: 0.15,
};

/**
 * Base calories per step (adjusted by weight)
 * Research suggests 0.03-0.06 cal/step depending on weight and pace
 */
export const BASE_CALORIES_PER_STEP = 0.04;

// === DATABASE TYPES ===

/**
 * Database row type for wearable_connections table
 */
export interface WearableConnectionRow {
  id: string;
  user_id: string;
  source: WearableSource;
  is_connected: boolean;
  last_sync_at: string | null;
  permissions: WearablePermission[];
  device_name: string | null;
  step_calibration_factor: number;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for daily_activity_data table
 */
export interface DailyActivityDataRow {
  id: string;
  user_id: string;
  date: string;
  steps_total: number;
  steps_source: WearableSource;
  steps_hourly_breakdown: number[] | null;
  steps_confidence: DataConfidence;
  wearable_active_calories: number | null;
  wearable_active_calories_source: WearableSource | null;
  step_expenditure: number;
  workout_expenditure: number;
  total_activity_expenditure: number;
  activity_level: ActivityLevel;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for activity_settings table
 */
export interface ActivitySettingsRow {
  user_id: string;
  adjustment_mode: CalorieAdjustmentMode;
  max_daily_adjustment: number;
  target_deficit_cals: number;
  use_app_workout_estimates: boolean;
  use_wearable_workout_calories: boolean;
  preferred_wearable_source: WearableSource | null;
  created_at: string;
  updated_at: string;
}

// === HELPER TYPES ===

/**
 * Input for creating/updating a wearable connection
 */
export interface WearableConnectionInput {
  source: WearableSource;
  deviceName?: string;
  permissions: WearablePermission[];
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

/**
 * Input for logging daily activity data
 */
export interface DailyActivityInput {
  date: string;
  steps: {
    total: number;
    source: WearableSource;
    hourlyBreakdown?: number[];
    confidence: DataConfidence;
  };
  wearableActiveCalories?: number;
}
