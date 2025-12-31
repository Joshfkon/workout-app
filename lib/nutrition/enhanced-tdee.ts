/**
 * Enhanced Adaptive TDEE Estimation with Activity Data
 * 
 * UPDATED: Now includes smoothed weight averaging and outlier exclusion
 * for more robust regression with noisy daily weight data.
 *
 * The enhanced model:
 * Daily TDEE = BMR + (beta x net_steps) + (gamma x workout_expenditure)
 * Where BMR = alpha x weight (the base burn rate we already estimate)
 */

import type {
  EnhancedTDEEEstimate,
  EnhancedDailyDataPoint,
  DailyTDEEResult,
  DailyActivityData,
  BurnRateHistoryPoint,
} from '@/types/wearable';
import { calculateAdaptiveTDEE, type TDEEEstimate, type DailyDataPoint } from './adaptive-tdee';

// === TYPES ===

interface EnhancedTDEEOptions {
  /** Number of days to include in the rolling window (default: 21) */
  windowDays?: number;
  /** Minimum data points required for calculation (default: 14) */
  minDataPoints?: number;
  /** Whether to exclude incomplete days (default: true) */
  excludeIncomplete?: boolean;
  /** Window size for weight smoothing (default: 3) */
  smoothingWindow?: number;
  /** Standard deviations for outlier exclusion (default: 2.0) */
  outlierThreshold?: number;
}

interface EnhancedRegressionResult {
  alpha: number; // Base burn rate (cal/lb)
  beta: number; // Step burn rate (cal/step)
  gamma: number; // Workout multiplier
  standardError: number;
  rSquared: number;
  outliersExcluded: number; // Track how many outliers were removed
}

interface RegressionPair {
  weight: number;
  calories: number;
  netSteps: number;
  workoutCalories: number;
  actualChange: number;
  date: string; // For debugging/logging
}

// === CONSTANTS ===

const CALORIES_PER_LB = 3500;

// Initial parameter values (research-based)
const INITIAL_ALPHA = 13.5; // cal/lb base (typical range 11-18)
const INITIAL_BETA = 0.04; // cal/step (research: 0.03-0.06)
const INITIAL_GAMMA = 1.0; // workout multiplier (start at 1:1)

// Parameter bounds
const ALPHA_MIN = 10;
const ALPHA_MAX = 18;
const BETA_MIN = 0.02;
const BETA_MAX = 0.08;
const GAMMA_MIN = 0.5;
const GAMMA_MAX = 1.5;

// Learning rate for gradient descent
const LEARNING_RATE = 0.01;
const ITERATIONS = 100;

// Smoothing and outlier defaults
const DEFAULT_SMOOTHING_WINDOW = 3;
const DEFAULT_OUTLIER_THRESHOLD = 2.0; // Standard deviations

// === MAIN FUNCTIONS ===

/**
 * Calculate enhanced TDEE using activity data (steps + workouts).
 * Now with smoothed weight data and outlier exclusion.
 */
export function calculateEnhancedTDEE(
  dataPoints: EnhancedDailyDataPoint[],
  currentWeight: number,
  options: EnhancedTDEEOptions = {}
): EnhancedTDEEEstimate | null {
  const {
    windowDays = 21,
    minDataPoints = 14,
    excludeIncomplete = true,
    smoothingWindow = DEFAULT_SMOOTHING_WINDOW,
    outlierThreshold = DEFAULT_OUTLIER_THRESHOLD,
  } = options;

  // Filter data points
  const filtered = filterDataPoints(dataPoints, windowDays, excludeIncomplete);

  if (filtered.length < minDataPoints) {
    return null; // Not enough data
  }

  // Check if we have meaningful activity data
  const hasActivityData = filtered.some(
    (dp) => dp.steps > 0 || dp.workoutCalories > 0
  );

  if (!hasActivityData) {
    // Fall back to basic TDEE calculation
    const basicData: DailyDataPoint[] = filtered.map((dp) => ({
      date: dp.date,
      weight: dp.weight,
      calories: dp.calories,
      isComplete: dp.isComplete,
    }));
    const basicEstimate = calculateAdaptiveTDEE(basicData, currentWeight, options);

    if (!basicEstimate) return null;

    // Wrap in enhanced format
    return {
      baseBurnRate: basicEstimate.burnRatePerLb,
      stepBurnRate: INITIAL_BETA,
      workoutMultiplier: INITIAL_GAMMA,
      burnRatePerLb: basicEstimate.burnRatePerLb,
      estimatedTDEE: basicEstimate.estimatedTDEE,
      averageSteps: 0,
      averageWorkoutCalories: 0,
      confidence: basicEstimate.confidence,
      confidenceScore: basicEstimate.confidenceScore,
      dataPointsUsed: basicEstimate.dataPointsUsed,
      windowDays: basicEstimate.windowDays,
      standardError: basicEstimate.standardError,
      lastUpdated: new Date(),
      source: 'regression',
      estimateHistory: basicEstimate.estimateHistory,
      currentWeight,
    };
  }

  // Run enhanced regression with smoothing and outlier exclusion
  const result = runEnhancedRegression(filtered, smoothingWindow, outlierThreshold);

  if (!result) {
    return null;
  }

  // Calculate averages
  const avgSteps = average(filtered.map((d) => d.netSteps));
  const avgWorkout = average(filtered.map((d) => d.workoutCalories));

  // Calculate current TDEE with learned parameters
  const baseTDEE = result.alpha * currentWeight;
  const avgStepExpenditure = result.beta * avgSteps;
  const avgWorkoutExpenditure = result.gamma * avgWorkout;
  const estimatedTDEE = baseTDEE + avgStepExpenditure + avgWorkoutExpenditure;

  // Calculate confidence (boosted slightly due to outlier handling)
  const effectiveDataPoints = filtered.length - result.outliersExcluded;
  const confidence = calculateConfidence(result, effectiveDataPoints);
  const confidenceScore = calculateConfidenceScore(
    result.standardError,
    effectiveDataPoints
  );

  // Build history from rolling calculations
  const estimateHistory = buildEstimateHistory(filtered, windowDays, smoothingWindow, outlierThreshold);

  return {
    baseBurnRate: result.alpha,
    stepBurnRate: result.beta,
    workoutMultiplier: result.gamma,
    burnRatePerLb: result.alpha, // Legacy compatibility
    estimatedTDEE: Math.round(estimatedTDEE),
    dailyBreakdown: {
      baseTDEE: Math.round(baseTDEE),
      stepExpenditure: Math.round(avgStepExpenditure),
      workoutExpenditure: Math.round(avgWorkoutExpenditure),
      totalTDEE: Math.round(estimatedTDEE),
    },
    averageSteps: Math.round(avgSteps),
    averageWorkoutCalories: Math.round(avgWorkout),
    confidence,
    confidenceScore,
    dataPointsUsed: filtered.length,
    dataPointsAfterOutlierExclusion: effectiveDataPoints,
    windowDays,
    standardError: result.standardError,
    lastUpdated: new Date(),
    source: 'enhanced_regression',
    estimateHistory,
    currentWeight,
  };
}

/**
 * Calculate TDEE for a specific day based on that day's activity.
 * Used for daily calorie target adjustments.
 */
export function calculateDailyTDEE(
  estimate: EnhancedTDEEEstimate,
  activityData: DailyActivityData,
  weight: number
): DailyTDEEResult {
  // Calculate net steps (excluding workout overlap)
  const totalOverlap = activityData.appWorkouts.reduce(
    (sum, w) => sum + w.stepsOverlap,
    0
  );
  const netSteps = activityData.steps.total - totalOverlap;

  // Calculate daily components
  const baseTDEE = estimate.baseBurnRate * weight;
  const stepExpenditure = estimate.stepBurnRate * netSteps;
  const workoutExpenditure =
    estimate.workoutMultiplier * activityData.calculated.workoutExpenditure;

  const totalTDEE = baseTDEE + stepExpenditure + workoutExpenditure;
  const vsAverage = totalTDEE - estimate.estimatedTDEE;

  return {
    baseTDEE: Math.round(baseTDEE),
    stepExpenditure: Math.round(stepExpenditure),
    workoutExpenditure: Math.round(workoutExpenditure),
    totalTDEE: Math.round(totalTDEE),
    vsAverage: Math.round(vsAverage),
  };
}

/**
 * Get the best TDEE estimate - enhanced if activity data available,
 * otherwise fall back to basic.
 */
export function getBestEnhancedEstimate(
  enhancedEstimate: EnhancedTDEEEstimate | null,
  basicEstimate: TDEEEstimate | null
): EnhancedTDEEEstimate | TDEEEstimate | null {
  // Prefer enhanced if available and has good confidence
  if (
    enhancedEstimate &&
    enhancedEstimate.confidence !== 'unstable' &&
    enhancedEstimate.dataPointsUsed >= 10
  ) {
    return enhancedEstimate;
  }

  // Fall back to basic
  return basicEstimate;
}

// === SMOOTHING FUNCTIONS ===

/**
 * Calculate smoothed weight using a rolling average.
 * This reduces day-to-day noise from water weight, sodium, etc.
 * Uses a centered window (includes future days) for better smoothing.
 */
function getSmoothedWeight(
  data: EnhancedDailyDataPoint[],
  index: number,
  window: number
): number {
  // For early days, use what we have (centered where possible)
  const halfWindow = Math.floor(window / 2);
  const start = Math.max(0, index - halfWindow);
  const end = Math.min(data.length - 1, index + halfWindow);
  
  let sum = 0;
  let count = 0;
  
  for (let i = start; i <= end; i++) {
    if (data[i].weight > 0) {
      sum += data[i].weight;
      count++;
    }
  }
  
  return count > 0 ? sum / count : data[index].weight;
}

/**
 * Detect low-calorie outliers using statistical methods.
 * Excludes days that are significantly below the user's typical calorie intake.
 * Uses both standard deviation (2.5 SD below mean) and percentile (bottom 10%)
 * to catch unusually low days relative to the user's pattern.
 */
function detectLowCalorieOutliers(
  data: EnhancedDailyDataPoint[]
): Set<string> {
  const outlierDates = new Set<string>();
  
  if (data.length < 3) {
    // Need at least 3 days to calculate meaningful statistics
    return outlierDates;
  }
  
  // Get all calorie values from complete days only
  const calories = data
    .filter(d => d.calories > 0 && d.isComplete)
    .map(d => d.calories);
  
  if (calories.length < 3) {
    return outlierDates;
  }
  
  // First pass: Remove extreme outliers (< 500 cal) to get a robust mean/SD
  // These are clearly incomplete logging days and shouldn't influence the threshold
  const extremeOutlierThreshold = 500;
  const trimmedCalories = calories.filter(c => c >= extremeOutlierThreshold);
  
  // If we have at least 3 non-extreme days, use trimmed data for mean/SD
  // Otherwise, use all data (but this is a warning sign)
  const useTrimmed = trimmedCalories.length >= 3;
  const baseCalories = useTrimmed ? trimmedCalories : calories;
  
  // Calculate mean and standard deviation on trimmed data
  const mean = average(baseCalories);
  const sd = calculateStandardDeviation(baseCalories);
  
  // Use 1.5 standard deviations below mean as threshold
  // This catches days that are unusually low (bottom ~7% if normally distributed)
  const sdThreshold = mean - (1.5 * sd);
  
  // Also use percentile-based approach: exclude bottom 20%
  const sortedCalories = [...baseCalories].sort((a, b) => a - b);
  const percentile20 = sortedCalories[Math.floor(sortedCalories.length * 0.2)];
  
  // Use the lower of the two thresholds to catch more outliers
  // This ensures we catch days like 880 that are below the 20th percentile
  const finalThreshold = Math.min(sdThreshold, percentile20);
  
  // Mark dates that are outliers
  // Include both extreme outliers (< 500) and moderate outliers (< threshold)
  data.forEach(d => {
    if (d.calories > 0 && d.isComplete) {
      if (d.calories < extremeOutlierThreshold || d.calories < finalThreshold) {
        outlierDates.add(d.date);
      }
    }
  });
  
  if (outlierDates.size > 0) {
    const extremeCount = data.filter(d => d.calories > 0 && d.isComplete && d.calories < extremeOutlierThreshold).length;
    const moderateCount = outlierDates.size - extremeCount;
    console.log(`[TDEE Enhanced] Detected ${outlierDates.size} low-calorie outlier days (${extremeCount} extreme < ${extremeOutlierThreshold} cal, ${moderateCount} moderate < ${finalThreshold.toFixed(0)} cal)`);
    console.log(`[TDEE Enhanced] Threshold calculation: mean=${mean.toFixed(0)} cal, SD=${sd.toFixed(0)} cal, threshold=${finalThreshold.toFixed(0)} cal`);
  }
  
  return outlierDates;
}

/**
 * Create regression pairs using smoothed weight changes.
 * 
 * IMPORTANT: Pairs Day N's calories with Day N+1's weight change.
 * This is correct because:
 * - Day N's calories are consumed throughout Day N
 * - Day N+1's morning weight reflects Day N's intake
 * - Weight change = weight[N+1] - weight[N] reflects Day N's calorie impact
 * 
 * Example:
 * - Monday calories: 2000 cal, steps: 8000, workout: 300 cal
 * - Monday weight: 175.0 lbs
 * - Tuesday weight: 175.2 lbs
 * - Pair: {calories: 2000, netSteps: 8000, workoutCalories: 300, actualChange: 0.2 lbs}
 */
function createSmoothedPairs(
  data: EnhancedDailyDataPoint[],
  smoothingWindow: number
): RegressionPair[] {
  const pairs: RegressionPair[] = [];
  
  // Detect low-calorie outliers using statistical methods
  const lowCalorieOutliers = detectLowCalorieOutliers(data);

  for (let i = 0; i < data.length - 1; i++) {
    if (
      data[i].weight > 0 &&
      data[i + 1].weight > 0 &&
      data[i].calories > 0
    ) {
      // Exclude days with unusually low calories (statistical outliers)
      if (lowCalorieOutliers.has(data[i].date)) {
        continue; // Skip this pair
      }
      
      const smoothedWeightToday = getSmoothedWeight(data, i, smoothingWindow);
      const smoothedWeightTomorrow = getSmoothedWeight(data, i + 1, smoothingWindow);
      
      // Pair Day N's calories/activity with weight change from Day N to Day N+1
      pairs.push({
        weight: data[i].weight, // Use actual weight for TDEE calculation
        calories: data[i].calories, // Day N's calories
        netSteps: data[i].netSteps, // Day N's steps
        workoutCalories: data[i].workoutCalories, // Day N's workout calories
        actualChange: smoothedWeightTomorrow - smoothedWeightToday, // Weight change: Day N+1 - Day N
        date: data[i].date,
      });
    }
  }

  return pairs;
}

// === OUTLIER DETECTION ===

/**
 * Calculate residuals for outlier detection.
 */
function calculateResiduals(
  pairs: RegressionPair[],
  alpha: number,
  beta: number,
  gamma: number
): number[] {
  return pairs.map((pair) => {
    const predictedTDEE =
      alpha * pair.weight +
      beta * pair.netSteps +
      gamma * pair.workoutCalories;
    const predictedChange = (pair.calories - predictedTDEE) / CALORIES_PER_LB;
    return predictedChange - pair.actualChange;
  });
}

/**
 * Exclude outliers based on residual standard deviations.
 * Returns filtered pairs and count of excluded points.
 */
function excludeOutliers(
  pairs: RegressionPair[],
  alpha: number,
  beta: number,
  gamma: number,
  threshold: number
): { filtered: RegressionPair[]; excluded: number } {
  const residuals = calculateResiduals(pairs, alpha, beta, gamma);
  const mean = average(residuals);
  const sd = calculateStandardDeviation(residuals);

  // If SD is very small, don't exclude anything (data is already clean)
  if (sd < 0.1) {
    return { filtered: pairs, excluded: 0 };
  }

  const filtered = pairs.filter((_, i) => {
    const zScore = Math.abs((residuals[i] - mean) / sd);
    return zScore <= threshold;
  });

  return {
    filtered,
    excluded: pairs.length - filtered.length,
  };
}

// === REGRESSION ALGORITHM ===

/**
 * Run gradient descent with smoothed weights and outlier exclusion.
 * 
 * Two-pass approach:
 * 1. First pass: Run regression on smoothed data to get initial estimates
 * 2. Identify and exclude outliers based on residuals
 * 3. Second pass: Re-run regression on cleaned data
 */
function runEnhancedRegression(
  data: EnhancedDailyDataPoint[],
  smoothingWindow: number,
  outlierThreshold: number
): EnhancedRegressionResult | null {
  if (data.length < 7) return null;

  // Create pairs with smoothed weight changes
  let pairs = createSmoothedPairs(data, smoothingWindow);

  if (pairs.length < 5) return null;

  // === FIRST PASS: Initial regression ===
  let { alpha, beta, gamma } = runGradientDescent(pairs);

  // === OUTLIER EXCLUSION ===
  const { filtered: cleanedPairs, excluded } = excludeOutliers(
    pairs,
    alpha,
    beta,
    gamma,
    outlierThreshold
  );

  // Need at least 5 pairs after exclusion
  if (cleanedPairs.length < 5) {
    // Fall back to using all data if too many excluded
    console.warn(`Too many outliers excluded (${excluded}), using all data`);
  } else {
    pairs = cleanedPairs;
  }

  // === SECOND PASS: Re-run regression on cleaned data ===
  const finalParams = runGradientDescent(pairs);
  alpha = finalParams.alpha;
  beta = finalParams.beta;
  gamma = finalParams.gamma;

  // Calculate final error metrics on cleaned data
  const residuals = calculateResiduals(pairs, alpha, beta, gamma);
  const standardError = calculateStandardDeviation(residuals);

  // Calculate R²
  const actualChanges = pairs.map((p) => p.actualChange);
  const meanActualChange = average(actualChanges);
  const ssTot = actualChanges.reduce(
    (sum, ac) => sum + (ac - meanActualChange) ** 2,
    0
  );
  const ssRes = residuals.reduce((sum, r) => sum + r ** 2, 0);
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  return {
    alpha: Math.round(alpha * 10) / 10,
    beta: Math.round(beta * 1000) / 1000,
    gamma: Math.round(gamma * 100) / 100,
    standardError,
    rSquared,
    outliersExcluded: excluded,
  };
}

/**
 * Core gradient descent optimization.
 * Separated out so it can be called multiple times (for two-pass approach).
 */
function runGradientDescent(pairs: RegressionPair[]): {
  alpha: number;
  beta: number;
  gamma: number;
} {
  let alpha = INITIAL_ALPHA;
  let beta = INITIAL_BETA;
  let gamma = INITIAL_GAMMA;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    let alphaGradient = 0;
    let betaGradient = 0;
    let gammaGradient = 0;

    for (const pair of pairs) {
      const predictedTDEE =
        alpha * pair.weight +
        beta * pair.netSteps +
        gamma * pair.workoutCalories;

      const predictedChange = (pair.calories - predictedTDEE) / CALORIES_PER_LB;
      const error = predictedChange - pair.actualChange;

      alphaGradient += error * (-pair.weight / CALORIES_PER_LB);
      betaGradient += error * (-pair.netSteps / CALORIES_PER_LB);
      gammaGradient += error * (-pair.workoutCalories / CALORIES_PER_LB);
    }

    const n = pairs.length;
    alphaGradient /= n;
    betaGradient /= n;
    gammaGradient /= n;

    alpha -= LEARNING_RATE * alphaGradient;
    beta -= LEARNING_RATE * betaGradient;
    gamma -= LEARNING_RATE * gammaGradient;

    // Clamp to reasonable ranges
    alpha = Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, alpha));
    beta = Math.max(BETA_MIN, Math.min(BETA_MAX, beta));
    gamma = Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, gamma));
  }

  return { alpha, beta, gamma };
}

// === HELPER FUNCTIONS ===

function filterDataPoints(
  dataPoints: EnhancedDailyDataPoint[],
  windowDays: number,
  excludeIncomplete: boolean
): EnhancedDailyDataPoint[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - windowDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  return dataPoints
    .filter((dp) => {
      if (dp.date < cutoffStr) return false;
      if (excludeIncomplete && !dp.isComplete) return false;
      if (dp.weight <= 0 || dp.calories <= 0) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculateConfidence(
  result: EnhancedRegressionResult,
  effectiveDataPoints: number
): 'unstable' | 'stabilizing' | 'stable' {
  // Stable: low error, decent R², enough data
  if (result.standardError < 0.5 && result.rSquared > 0.25 && effectiveDataPoints >= 18) {
    return 'stable';
  }

  // Stabilizing: trending toward stability
  if (result.standardError < 1.0 || effectiveDataPoints >= 14) {
    return 'stabilizing';
  }

  return 'unstable';
}

function calculateConfidenceScore(standardError: number, dataPoints: number): number {
  const dataScore = Math.min(dataPoints / 28, 1) * 50;
  const accuracyScore = Math.max(0, 50 - standardError * 30);
  return Math.round(dataScore + accuracyScore);
}

function buildEstimateHistory(
  dataPoints: EnhancedDailyDataPoint[],
  windowDays: number,
  smoothingWindow: number,
  outlierThreshold: number
): BurnRateHistoryPoint[] {
  const history: BurnRateHistoryPoint[] = [];
  const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 7) return history;

  // Calculate rolling estimates starting from day 7
  for (let i = 7; i <= sorted.length; i++) {
    const windowData = sorted.slice(Math.max(0, i - windowDays), i);
    const result = runEnhancedRegression(windowData, smoothingWindow, outlierThreshold);

    if (result) {
      history.push({
        date: sorted[i - 1].date,
        burnRate: result.alpha,
        confidence: calculateConfidenceScore(
          result.standardError,
          windowData.length - result.outliersExcluded
        ),
      });
    }
  }

  return history;
}

function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// === COMPARISON AND ANALYSIS ===

/**
 * Compare enhanced TDEE with basic formula TDEE
 */
export function compareWithFormula(
  enhancedEstimate: EnhancedTDEEEstimate,
  formulaTDEE: number
): {
  difference: number;
  percentDifference: number;
  breakdown: string;
  recommendation: string;
} {
  const difference = enhancedEstimate.estimatedTDEE - formulaTDEE;
  const percentDifference = Math.round((difference / formulaTDEE) * 100);

  const breakdown = `
Base metabolism: ${enhancedEstimate.dailyBreakdown?.baseTDEE ?? 'N/A'} cal
Step activity: ${enhancedEstimate.dailyBreakdown?.stepExpenditure ?? 'N/A'} cal
Workout activity: ${enhancedEstimate.dailyBreakdown?.workoutExpenditure ?? 'N/A'} cal
Total: ${enhancedEstimate.estimatedTDEE} cal
  `.trim();

  let recommendation: string;
  if (Math.abs(percentDifference) < 5) {
    recommendation =
      'Your personalized estimate closely matches formula predictions.';
  } else if (difference > 0) {
    recommendation = `You burn ${percentDifference}% more than formulas predict. Your activity level may be underestimated by standard multipliers.`;
  } else {
    recommendation = `You burn ${Math.abs(percentDifference)}% less than formulas predict. Consider adjusting your calorie targets accordingly.`;
  }

  return {
    difference,
    percentDifference,
    breakdown,
    recommendation,
  };
}

/**
 * Analyze activity contribution to TDEE
 */
export function analyzeActivityContribution(
  estimate: EnhancedTDEEEstimate
): {
  basePercent: number;
  stepsPercent: number;
  workoutPercent: number;
  insights: string[];
} {
  const total = estimate.estimatedTDEE;
  const base = estimate.dailyBreakdown?.baseTDEE || total;
  const steps = estimate.dailyBreakdown?.stepExpenditure || 0;
  const workout = estimate.dailyBreakdown?.workoutExpenditure || 0;

  const basePercent = Math.round((base / total) * 100);
  const stepsPercent = Math.round((steps / total) * 100);
  const workoutPercent = Math.round((workout / total) * 100);

  const insights: string[] = [];

  if (stepsPercent > 15) {
    insights.push(
      `Your daily steps contribute significantly (${stepsPercent}%) to your calorie burn. Keep it up!`
    );
  } else if (stepsPercent < 5) {
    insights.push(
      `Your step activity is low (${stepsPercent}% of burn). Adding more daily movement could increase your TDEE.`
    );
  }

  if (workoutPercent > 10) {
    insights.push(
      `Your workouts add meaningful calorie burn (${workoutPercent}%). Resistance training is boosting your metabolism.`
    );
  }

  if (estimate.averageSteps > 10000) {
    insights.push(
      `Averaging ${estimate.averageSteps.toLocaleString()} steps/day puts you in the "active" category.`
    );
  }

  return {
    basePercent,
    stepsPercent,
    workoutPercent,
    insights,
  };
}
