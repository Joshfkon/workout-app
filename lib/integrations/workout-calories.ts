/**
 * Workout Calorie Estimation Engine
 *
 * Estimates calories burned during resistance training with conservative
 * calculations. Wearable estimates for lifting are notoriously inaccurate
 * (often 2-3x too high), so we use research-based formulas.
 */

import type {
  AppWorkoutActivity,
  WorkoutExpenditureEstimate,
  WorkoutIntensity,
  WORKOUT_CALORIES_PER_MINUTE,
  EPOC_MULTIPLIERS,
} from '@/types/wearable';

// === CONSTANTS ===

/**
 * Conservative calorie rates per minute for resistance training.
 * Research suggests ~5-8 cal/min for moderate lifting, including rest periods.
 */
const CALORIES_PER_MINUTE: Record<WorkoutIntensity, number> = {
  low: 4, // Light weights, long rest (3+ min)
  moderate: 6, // Typical hypertrophy training (90-120s rest)
  high: 8, // Heavy compounds, short rest (60-90s)
  very_high: 10, // High intensity, minimal rest (<60s)
};

/**
 * EPOC (Excess Post-Exercise Oxygen Consumption) multipliers.
 * Afterburn is typically 6-15% of workout calories for resistance training.
 */
const EPOC_FACTORS: Record<WorkoutIntensity, number> = {
  low: 0.06,
  moderate: 0.08,
  high: 0.12,
  very_high: 0.15,
};

/**
 * Heavy compound movements that increase calorie burn
 */
const HEAVY_COMPOUND_MUSCLES = [
  'quads',
  'back',
  'chest',
  'hamstrings',
  'glutes',
];

// Reference weight for calorie scaling (kg)
const REFERENCE_WEIGHT_KG = 80;

// === MAIN ESTIMATION FUNCTION ===

/**
 * Estimate calories burned during resistance training.
 * Uses conservative estimates based on workout characteristics.
 *
 * @param workout - App workout activity data
 * @param userWeightKg - User's weight in kg
 * @returns Expenditure estimate with breakdown
 */
export function estimateWorkoutExpenditure(
  workout: AppWorkoutActivity,
  userWeightKg: number
): WorkoutExpenditureEstimate {
  const durationMinutes = workout.durationMinutes;

  // Estimate intensity from workout data
  const intensity = estimateWorkoutIntensity(workout);

  // Base calorie rate for this intensity
  const baseRate = CALORIES_PER_MINUTE[intensity];

  // Weight adjustment (heavier people burn more)
  const weightMultiplier = userWeightKg / REFERENCE_WEIGHT_KG;

  // Calculate base calories
  const baseCalories = Math.round(baseRate * durationMinutes * weightMultiplier);

  // EPOC estimate (afterburn)
  const epocMultiplier = EPOC_FACTORS[intensity];
  const epocEstimate = Math.round(baseCalories * epocMultiplier);

  // Determine confidence based on data quality
  const confidence = determineConfidence(workout);

  return {
    baseCalories,
    epocEstimate,
    totalEstimate: baseCalories + epocEstimate,
    confidence,
    method: 'duration_intensity',
  };
}

/**
 * Estimate workout intensity from workout characteristics.
 * Factors: rest time, volume density, muscle groups
 */
export function estimateWorkoutIntensity(workout: AppWorkoutActivity): WorkoutIntensity {
  let score = 0;

  // Rest time scoring (shorter rest = higher intensity)
  const avgRest = workout.averageRestSeconds;
  if (avgRest < 60) score += 3;
  else if (avgRest < 90) score += 2;
  else if (avgRest < 120) score += 1;
  // 120+ seconds = no additional points

  // Volume density scoring (sets x reps x weight / duration)
  // Higher density = more work per minute
  const volumeDensity = workout.durationMinutes > 0
    ? workout.totalVolume / workout.durationMinutes
    : 0;

  if (volumeDensity > 500) score += 2;
  else if (volumeDensity > 300) score += 1;

  // Compound movements scoring
  // Working large muscle groups burns more calories
  const hasHeavyCompounds = workout.muscleGroups.some((m) =>
    HEAVY_COMPOUND_MUSCLES.includes(m.toLowerCase())
  );
  if (hasHeavyCompounds) score += 1;

  // Set count as intensity indicator
  if (workout.totalSets > 20) score += 1;

  // Map score to intensity
  if (score >= 5) return 'very_high';
  if (score >= 3) return 'high';
  if (score >= 2) return 'moderate';
  return 'low';
}

/**
 * Determine confidence level based on available data
 */
function determineConfidence(
  workout: AppWorkoutActivity
): 'low' | 'medium' | 'high' {
  // High confidence: have all data points
  if (
    workout.durationMinutes > 0 &&
    workout.totalSets > 0 &&
    workout.averageRestSeconds > 0 &&
    workout.totalVolume > 0
  ) {
    return 'high';
  }

  // Medium confidence: have duration and some set data
  if (workout.durationMinutes > 0 && workout.totalSets > 0) {
    return 'medium';
  }

  // Low confidence: minimal data
  return 'low';
}

// === ALTERNATIVE ESTIMATION METHODS ===

/**
 * Estimate calories using MET (Metabolic Equivalent of Task) method.
 * Alternative method for comparison/validation.
 *
 * Weight training MET: 3-6 depending on intensity
 */
export function estimateByMET(
  durationMinutes: number,
  userWeightKg: number,
  intensity: WorkoutIntensity
): number {
  const metValues: Record<WorkoutIntensity, number> = {
    low: 3.0,
    moderate: 4.5,
    high: 5.5,
    very_high: 6.0,
  };

  const met = metValues[intensity];
  const durationHours = durationMinutes / 60;

  // Calories = MET x weight (kg) x duration (hours)
  return Math.round(met * userWeightKg * durationHours);
}

/**
 * Estimate calories based on heart rate (if available).
 * This is more accurate but requires HR data.
 */
export function estimateByHeartRate(
  durationMinutes: number,
  avgHeartRate: number,
  userWeightKg: number,
  age: number,
  isMale: boolean
): number {
  // Keytel et al. (2005) formula
  if (isMale) {
    const calories =
      (-55.0969 +
        0.6309 * avgHeartRate +
        0.1988 * userWeightKg +
        0.2017 * age) *
      (durationMinutes / 4.184);
    return Math.round(Math.max(0, calories));
  } else {
    const calories =
      (-20.4022 +
        0.4472 * avgHeartRate -
        0.1263 * userWeightKg +
        0.074 * age) *
      (durationMinutes / 4.184);
    return Math.round(Math.max(0, calories));
  }
}

// === WORKOUT DATA EXTRACTION ===

/**
 * Create AppWorkoutActivity from a completed workout session.
 * This would integrate with the workout_sessions table.
 */
export function createWorkoutActivity(
  workoutSession: {
    id: string;
    startedAt: string;
    completedAt: string;
  },
  setLogs: Array<{
    weightKg: number;
    reps: number;
    restSeconds: number | null;
  }>,
  muscleGroups: string[]
): AppWorkoutActivity {
  const startTime = new Date(workoutSession.startedAt);
  const endTime = new Date(workoutSession.completedAt);
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / 1000 / 60
  );

  // Calculate total volume (sum of weight x reps for each set)
  const totalVolume = setLogs.reduce(
    (sum, set) => sum + set.weightKg * set.reps,
    0
  );

  // Calculate average rest
  const restTimes = setLogs
    .map((s) => s.restSeconds)
    .filter((r): r is number => r !== null && r > 0);
  const averageRestSeconds =
    restTimes.length > 0
      ? Math.round(restTimes.reduce((a, b) => a + b, 0) / restTimes.length)
      : 120; // Default 2 minutes if no rest data

  return {
    workoutId: workoutSession.id,
    startTime,
    endTime,
    durationMinutes,
    muscleGroups,
    totalSets: setLogs.length,
    totalVolume,
    averageRestSeconds,
    estimatedCalories: 0, // Will be calculated separately
    stepsOverlap: 0, // Will be calculated separately
  };
}

// === COMPARISON UTILITIES ===

/**
 * Compare our estimate with wearable-reported calories.
 * Used to help users understand why values differ.
 */
export function compareEstimates(
  ourEstimate: number,
  wearableCalories: number
): {
  difference: number;
  percentDifference: number;
  explanation: string;
  recommendation: 'use_app' | 'use_wearable' | 'average';
} {
  const difference = wearableCalories - ourEstimate;
  const percentDifference = ourEstimate > 0
    ? Math.round((difference / ourEstimate) * 100)
    : 0;

  let explanation: string;
  let recommendation: 'use_app' | 'use_wearable' | 'average';

  if (percentDifference > 50) {
    explanation =
      'Your wearable reported significantly higher calories. Heart rate-based estimates often overcount resistance training by 50-100% because elevated HR during lifting doesn\'t correlate with calorie burn like it does during cardio.';
    recommendation = 'use_app';
  } else if (percentDifference > 20) {
    explanation =
      'Your wearable reported moderately higher calories. This is common for resistance training where heart rate monitors can\'t accurately estimate work done.';
    recommendation = 'use_app';
  } else if (percentDifference < -20) {
    explanation =
      'Your wearable reported lower calories than our estimate. This is unusual - your workout may have been more intense than typical, or you may have taken longer rest periods.';
    recommendation = 'average';
  } else {
    explanation =
      'Both estimates are similar. This suggests your wearable is reasonably accurate for your training style.';
    recommendation = 'average';
  }

  return {
    difference,
    percentDifference,
    explanation,
    recommendation,
  };
}

// === DISPLAY UTILITIES ===

/**
 * Format workout intensity for display
 */
export function formatIntensity(intensity: WorkoutIntensity): string {
  const labels: Record<WorkoutIntensity, string> = {
    low: 'Light',
    moderate: 'Moderate',
    high: 'Intense',
    very_high: 'Very Intense',
  };
  return labels[intensity];
}

/**
 * Get intensity description for user
 */
export function getIntensityDescription(intensity: WorkoutIntensity): string {
  const descriptions: Record<WorkoutIntensity, string> = {
    low: 'Light weights with long rest periods (3+ minutes). Low heart rate elevation.',
    moderate:
      'Typical hypertrophy training with 90-120 second rest periods. Moderate effort.',
    high: 'Heavy compound lifts with shorter rest (60-90 seconds). Challenging sets.',
    very_high:
      'High intensity with minimal rest (<60 seconds). Near-failure sets throughout.',
  };
  return descriptions[intensity];
}

/**
 * Get confidence explanation
 */
export function getConfidenceExplanation(
  confidence: 'low' | 'medium' | 'high'
): string {
  const explanations = {
    low: 'Limited workout data available. Estimate based primarily on duration.',
    medium:
      'Partial workout data available. Estimate includes set count and duration.',
    high: 'Complete workout data including sets, reps, weights, and rest times. Most accurate estimate.',
  };
  return explanations[confidence];
}
