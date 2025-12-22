/**
 * Enhanced Adaptive TDEE Estimation with Activity Data
 *
 * Extends the base adaptive TDEE model to incorporate step data and
 * workout calories for more accurate daily calorie burn estimates.
 *
 * The enhanced model:
 * Daily TDEE = BMR + (beta x net_steps) + (gamma x workout_expenditure)
 * Where BMR = alpha x weight (the base burn rate we already estimate)
 *
 * This separates the signal:
 * - alpha captures resting metabolism
 * - beta captures step efficiency
 * - gamma captures workout calorie accuracy
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
}

interface EnhancedRegressionResult {
  alpha: number; // Base burn rate (cal/lb)
  beta: number; // Step burn rate (cal/step)
  gamma: number; // Workout multiplier
  standardError: number;
  rSquared: number;
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

// === MAIN FUNCTIONS ===

/**
 * Calculate enhanced TDEE using activity data (steps + workouts).
 *
 * Uses gradient descent to find optimal alpha, beta, gamma parameters
 * that minimize prediction error.
 */
export function calculateEnhancedTDEE(
  dataPoints: EnhancedDailyDataPoint[],
  currentWeight: number,
  options: EnhancedTDEEOptions = {}
): EnhancedTDEEEstimate | null {
  const { windowDays = 21, minDataPoints = 14, excludeIncomplete = true } = options;

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

  // Run enhanced regression with gradient descent
  const result = runEnhancedRegression(filtered);

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

  // Calculate confidence
  const confidence = calculateConfidence(result, filtered.length);
  const confidenceScore = calculateConfidenceScore(result.standardError, filtered.length);

  // Build history from rolling calculations
  const estimateHistory = buildEstimateHistory(filtered, windowDays);

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

// === REGRESSION ALGORITHM ===

/**
 * Run gradient descent to find optimal alpha, beta, gamma parameters.
 *
 * Model:
 *   predicted_TDEE[i] = alpha * weight[i] + beta * netSteps[i] + gamma * workoutCal[i]
 *   predicted_change[i] = (calories[i] - predicted_TDEE[i]) / 3500
 *   actual_change[i] = weight[i+1] - weight[i]
 *
 * Minimize: Σ(predicted_change[i] - actual_change[i])²
 */
function runEnhancedRegression(
  data: EnhancedDailyDataPoint[]
): EnhancedRegressionResult | null {
  if (data.length < 7) return null;

  // Initialize parameters
  let alpha = INITIAL_ALPHA;
  let beta = INITIAL_BETA;
  let gamma = INITIAL_GAMMA;

  // Create consecutive day pairs
  const pairs: Array<{
    weight: number;
    calories: number;
    netSteps: number;
    workoutCalories: number;
    actualChange: number;
  }> = [];

  for (let i = 0; i < data.length - 1; i++) {
    if (
      data[i].weight > 0 &&
      data[i + 1].weight > 0 &&
      data[i].calories > 0
    ) {
      pairs.push({
        weight: data[i].weight,
        calories: data[i].calories,
        netSteps: data[i].netSteps,
        workoutCalories: data[i].workoutCalories,
        actualChange: data[i + 1].weight - data[i].weight,
      });
    }
  }

  if (pairs.length < 5) return null;

  // Gradient descent
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let alphaGradient = 0;
    let betaGradient = 0;
    let gammaGradient = 0;

    for (const pair of pairs) {
      // Predicted TDEE for this day
      const predictedTDEE =
        alpha * pair.weight +
        beta * pair.netSteps +
        gamma * pair.workoutCalories;

      // Predicted weight change
      const predictedChange = (pair.calories - predictedTDEE) / CALORIES_PER_LB;

      // Error
      const error = predictedChange - pair.actualChange;

      // Gradients (partial derivatives of error^2)
      // d/d(alpha) of error = -weight / 3500
      // d/d(beta) of error = -netSteps / 3500
      // d/d(gamma) of error = -workoutCalories / 3500
      alphaGradient += error * (-pair.weight / CALORIES_PER_LB);
      betaGradient += error * (-pair.netSteps / CALORIES_PER_LB);
      gammaGradient += error * (-pair.workoutCalories / CALORIES_PER_LB);
    }

    // Average gradients
    const n = pairs.length;
    alphaGradient /= n;
    betaGradient /= n;
    gammaGradient /= n;

    // Update parameters (gradient descent step)
    alpha -= LEARNING_RATE * alphaGradient;
    beta -= LEARNING_RATE * betaGradient;
    gamma -= LEARNING_RATE * gammaGradient;

    // Clamp to reasonable ranges
    alpha = Math.max(ALPHA_MIN, Math.min(ALPHA_MAX, alpha));
    beta = Math.max(BETA_MIN, Math.min(BETA_MAX, beta));
    gamma = Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, gamma));
  }

  // Calculate final error metrics
  const residuals: number[] = [];
  for (const pair of pairs) {
    const predictedTDEE =
      alpha * pair.weight + beta * pair.netSteps + gamma * pair.workoutCalories;
    const predictedChange = (pair.calories - predictedTDEE) / CALORIES_PER_LB;
    const residual = predictedChange - pair.actualChange;
    residuals.push(residual);
  }

  const standardError = calculateStandardDeviation(residuals);

  // Calculate R²
  const actualChanges = pairs.map((p) => p.actualChange);
  const meanActualChange =
    actualChanges.reduce((a, b) => a + b, 0) / actualChanges.length;
  const ssTot = actualChanges.reduce(
    (sum, ac) => sum + (ac - meanActualChange) ** 2,
    0
  );
  const ssRes = residuals.reduce((sum, r) => sum + r ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return {
    alpha: Math.round(alpha * 10) / 10,
    beta: Math.round(beta * 1000) / 1000,
    gamma: Math.round(gamma * 100) / 100,
    standardError,
    rSquared,
  };
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
  dataPoints: number
): 'unstable' | 'stabilizing' | 'stable' {
  // Stable: low error, decent R², enough data
  if (result.standardError < 0.5 && result.rSquared > 0.25 && dataPoints >= 18) {
    return 'stable';
  }

  // Stabilizing: trending toward stability
  if (result.standardError < 1.0 || dataPoints >= 14) {
    return 'stabilizing';
  }

  return 'unstable';
}

function calculateConfidenceScore(standardError: number, dataPoints: number): number {
  // Score from 0-100
  const dataScore = Math.min(dataPoints / 28, 1) * 50;
  const accuracyScore = Math.max(0, 50 - standardError * 30);
  return Math.round(dataScore + accuracyScore);
}

function buildEstimateHistory(
  dataPoints: EnhancedDailyDataPoint[],
  windowDays: number
): BurnRateHistoryPoint[] {
  const history: BurnRateHistoryPoint[] = [];
  const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length < 7) return history;

  // Calculate rolling estimates starting from day 7
  for (let i = 7; i <= sorted.length; i++) {
    const windowData = sorted.slice(Math.max(0, i - windowDays), i);
    const result = runEnhancedRegression(windowData);

    if (result) {
      history.push({
        date: sorted[i - 1].date,
        burnRate: result.alpha,
        confidence: calculateConfidenceScore(result.standardError, windowData.length),
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
