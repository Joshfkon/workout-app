/**
 * Adaptive TDEE Estimation using Least-Squares Regression
 *
 * Instead of relying on generic formulas (Mifflin-St Jeor, Harris-Benedict),
 * this system back-calculates your actual burn rate from real weight and
 * calorie data using least-squares regression.
 *
 * The physics:
 * - Weight change (lbs) = (Calories in - TDEE) / 3500
 * - TDEE = α × Body Weight (where α is the personal burn rate)
 *
 * By collecting daily weight + calorie data over 2-4 weeks, we can run
 * regression to find the user's personal α value.
 */

import { calculateBMR, calculateTDEE, type UserStats, type ActivityConfig } from './macroCalculator';

// === TYPES ===

export interface DailyDataPoint {
  date: string; // ISO date string (YYYY-MM-DD)
  weight: number; // In lbs (user's logged weight)
  calories: number; // Total intake for the day
  isComplete: boolean; // Did user log all meals?
}

export interface TDEEEstimate {
  /** Personal burn rate (calories per lb of body weight) */
  burnRatePerLb: number;
  /** Estimated TDEE based on current weight */
  estimatedTDEE: number;
  /** Confidence level of the estimate */
  confidence: 'unstable' | 'stabilizing' | 'stable';
  /** Confidence score from 0-100 */
  confidenceScore: number;
  /** Number of data points used in calculation */
  dataPointsUsed: number;
  /** Data points after outlier exclusion (if applicable) */
  dataPointsAfterOutlierExclusion?: number;
  /** Window of days analyzed */
  windowDays: number;
  /** Standard error of the estimate (lower = more accurate) */
  standardError: number;
  /** When this estimate was calculated */
  lastUpdated: Date;
  /** Source of the estimate */
  source: 'regression' | 'formula';
  /** History of burn rate estimates for convergence chart */
  estimateHistory: BurnRateHistoryPoint[];
  /** Current weight used for TDEE calculation */
  currentWeight: number;
}

export interface BurnRateHistoryPoint {
  date: string;
  burnRate: number;
  confidence: number;
}

export interface WeightPrediction {
  targetDate: string;
  predictedWeight: number;
  confidenceRange: [number, number]; // [low, high]
  assumedDailyCalories: number;
  daysFromNow: number;
}

export interface GoalDatePrediction {
  targetWeight: number;
  estimatedDate: Date;
  daysRequired: number;
  confidenceRange: [Date, Date]; // [earliest, latest]
  requiredDailyCalories: number;
}

export interface DataQualityCheck {
  isValid: boolean;
  issues: string[];
  suggestions: string[];
  daysWithData: number;
  daysWithGaps: number;
  completeDays: number;
}

export interface AdaptiveTDEEOptions {
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

/**
 * Data point for regression visualization
 */
export interface RegressionDataPoint {
  date: string;
  weight: number;
  calories: number;
  actualChange: number;
  predictedChange: number;
  residual: number;
}

/**
 * Full regression analysis result for visualization
 */
export interface RegressionAnalysis {
  dataPoints: RegressionDataPoint[];
  burnRatePerLb: number;
  estimatedTDEE: number;
  rSquared: number;
  standardError: number;
  currentWeight: number;
}

// === CONSTANTS ===

/** Calories per lb of body weight (fat tissue) */
const CALORIES_PER_LB = 3500;

/** Default regression window in days */
const DEFAULT_WINDOW_DAYS = 21;

/** Minimum data points needed */
const DEFAULT_MIN_DATA_POINTS = 14;

/** Typical α range for most people */
const TYPICAL_BURN_RATE_MIN = 11; // cal/lb (sedentary)
const TYPICAL_BURN_RATE_MAX = 18; // cal/lb (very active)
const INITIAL_BURN_RATE = 13.5; // Default starting point for regression

/** Default smoothing window for weight averaging */
const DEFAULT_SMOOTHING_WINDOW = 3;

/** Default outlier threshold in standard deviations */
const DEFAULT_OUTLIER_THRESHOLD = 2.0;

// === MAIN FUNCTIONS ===

/**
 * Calculate adaptive TDEE using least-squares regression
 * on the user's actual weight and calorie data.
 */
export function calculateAdaptiveTDEE(
  dataPoints: DailyDataPoint[],
  currentWeight: number,
  options: AdaptiveTDEEOptions = {}
): TDEEEstimate | null {
  const {
    windowDays = DEFAULT_WINDOW_DAYS,
    minDataPoints = DEFAULT_MIN_DATA_POINTS,
    excludeIncomplete = true,
    smoothingWindow = DEFAULT_SMOOTHING_WINDOW,
    outlierThreshold = DEFAULT_OUTLIER_THRESHOLD,
  } = options;

  // Filter and validate data
  const filtered = filterDataPoints(dataPoints, windowDays, excludeIncomplete);

  if (filtered.length < minDataPoints) {
    return null; // Not enough data
  }

  // Run least-squares regression with smoothing and outlier exclusion
  const result = runLeastSquaresRegression(filtered, smoothingWindow, outlierThreshold);

  if (!result) {
    return null;
  }

  // Validate the burn rate is reasonable
  const clampedAlpha = clampBurnRate(result.alpha);

  // Calculate confidence using effective data points (after outlier exclusion)
  const effectiveDataPoints = result.dataPointsAfterExclusion ?? filtered.length;
  const confidence = calculateConfidence(result, effectiveDataPoints);
  const confidenceScore = calculateConfidenceScore(result.standardError, effectiveDataPoints);

  // Build history from rolling calculations
  const estimateHistory = buildEstimateHistory(dataPoints, windowDays, smoothingWindow, outlierThreshold);

  return {
    burnRatePerLb: clampedAlpha,
    estimatedTDEE: Math.round(clampedAlpha * currentWeight),
    confidence,
    confidenceScore,
    dataPointsUsed: filtered.length,
    dataPointsAfterOutlierExclusion: effectiveDataPoints,
    windowDays,
    standardError: result.standardError,
    lastUpdated: new Date(),
    source: 'regression',
    estimateHistory,
    currentWeight,
  };
}

/**
 * Get an initial TDEE estimate using formulas when insufficient data exists.
 * This serves as a starting point until regression data accumulates.
 */
export function getFormulaTDEE(
  stats: UserStats,
  activity: ActivityConfig
): TDEEEstimate {
  const bmr = calculateBMR(stats);
  const tdee = calculateTDEE(stats, activity);
  const burnRatePerLb = tdee / (stats.weightKg * 2.20462);

  return {
    burnRatePerLb,
    estimatedTDEE: tdee,
    confidence: 'unstable',
    confidenceScore: 20, // Low confidence for formula-based
    dataPointsUsed: 0,
    windowDays: 0,
    standardError: 300, // High uncertainty
    lastUpdated: new Date(),
    source: 'formula',
    estimateHistory: [],
    currentWeight: stats.weightKg * 2.20462,
  };
}

/**
 * Predict future weight based on planned calorie intake.
 */
export function predictFutureWeight(
  currentWeight: number,
  tdeeEstimate: TDEEEstimate,
  plannedDailyCalories: number,
  daysAhead: number
): WeightPrediction {
  const dailyDeficit = plannedDailyCalories - tdeeEstimate.estimatedTDEE;
  const dailyWeightChange = dailyDeficit / CALORIES_PER_LB;

  const predictedWeight = currentWeight + dailyWeightChange * daysAhead;

  // Confidence range grows with time and uncertainty
  const errorMargin = tdeeEstimate.standardError * Math.sqrt(daysAhead) / CALORIES_PER_LB;

  // Add a minimum margin for water weight fluctuation
  const minMargin = 1; // 1 lb minimum
  const adjustedMargin = Math.max(minMargin, errorMargin);

  return {
    targetDate: addDays(new Date(), daysAhead).toISOString().split('T')[0],
    predictedWeight: Math.round(predictedWeight * 10) / 10,
    confidenceRange: [
      Math.round((predictedWeight - adjustedMargin) * 10) / 10,
      Math.round((predictedWeight + adjustedMargin) * 10) / 10,
    ],
    assumedDailyCalories: plannedDailyCalories,
    daysFromNow: daysAhead,
  };
}

/**
 * Predict when user will reach their target weight.
 */
export function predictDateForTargetWeight(
  currentWeight: number,
  targetWeight: number,
  tdeeEstimate: TDEEEstimate,
  plannedDailyCalories: number
): GoalDatePrediction | null {
  const dailyDeficit = plannedDailyCalories - tdeeEstimate.estimatedTDEE;
  const dailyWeightChange = dailyDeficit / CALORIES_PER_LB;

  // Check if making progress in the right direction
  const weightToChange = targetWeight - currentWeight;
  if (
    dailyWeightChange === 0 ||
    (weightToChange > 0 && dailyWeightChange < 0) ||
    (weightToChange < 0 && dailyWeightChange > 0)
  ) {
    return null; // Not making progress toward goal
  }

  const daysRequired = Math.ceil(Math.abs(weightToChange / dailyWeightChange));

  // Confidence range: ±15% of estimate
  const minDays = Math.floor(daysRequired * 0.85);
  const maxDays = Math.ceil(daysRequired * 1.15);

  return {
    targetWeight,
    estimatedDate: addDays(new Date(), daysRequired),
    daysRequired,
    confidenceRange: [addDays(new Date(), minDays), addDays(new Date(), maxDays)],
    requiredDailyCalories: plannedDailyCalories,
  };
}

/**
 * Check data quality and provide feedback.
 */
export function checkDataQuality(dataPoints: DailyDataPoint[]): DataQualityCheck {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (dataPoints.length === 0) {
    return {
      isValid: false,
      issues: ['No data available'],
      suggestions: ['Start logging your weight and calories daily'],
      daysWithData: 0,
      daysWithGaps: 0,
      completeDays: 0,
    };
  }

  // Check for data gaps
  const gaps = findDataGaps(dataPoints);
  if (gaps > 3) {
    issues.push(`Missing data for ${gaps} days`);
    suggestions.push('Log weight and calories daily for best accuracy');
  }

  // Check for extreme calorie swings
  const calories = dataPoints.map((d) => d.calories).filter((c) => c > 0);
  if (calories.length >= 3) {
    const calorieStdDev = calculateStandardDeviation(calories);
    if (calorieStdDev > 800) {
      issues.push('Large calorie variations detected');
      suggestions.push('Try to log all meals consistently');
    }
  }

  // Check for suspiciously stable weight
  const weights = dataPoints.map((d) => d.weight).filter((w) => w > 0);
  if (weights.length >= 5) {
    const weightStdDev = calculateStandardDeviation(weights);
    if (weightStdDev < 0.3) {
      issues.push('Weight appears unusually stable');
      suggestions.push('Weigh at the same time daily, before eating');
    }
  }

  // Check for rapid weight swings
  const maxSwing = findMaxDailyWeightSwing(dataPoints);
  if (maxSwing > 4) {
    issues.push('Large day-to-day weight swings detected');
    suggestions.push('This is normal water weight - more data will smooth it out');
  }

  // Count complete days
  const completeDays = dataPoints.filter((d) => d.isComplete).length;

  return {
    isValid: issues.length <= 2 && dataPoints.length >= 7,
    issues,
    suggestions,
    daysWithData: dataPoints.length,
    daysWithGaps: gaps,
    completeDays,
  };
}

// === REGRESSION ALGORITHM ===

interface RegressionPair {
  weight: number;
  calories: number;
  actualChange: number;
  date: string; // For debugging/logging
}

interface RegressionResult {
  alpha: number; // Personal burn rate (cal/lb)
  standardError: number;
  rSquared: number; // How well the model fits
  outliersExcluded: number; // Number of outliers removed
  dataPointsAfterExclusion: number; // Effective data points after exclusion
}

/**
 * Calculate smoothed weight using a rolling average.
 * This reduces day-to-day noise from water weight, sodium, etc.
 * Uses a centered window (includes future days) for better smoothing.
 */
function getSmoothedWeight(
  data: DailyDataPoint[],
  index: number,
  window: number
): number {
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
  data: DailyDataPoint[]
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
  
  // Calculate mean and standard deviation
  const mean = average(calories);
  const sd = calculateStandardDeviation(calories);
  
  // Use 2.5 standard deviations below mean as threshold
  // This catches days that are unusually low (bottom ~1% if normally distributed)
  const sdThreshold = mean - (2.5 * sd);
  
  // Also use percentile-based approach: exclude bottom 10% if it's significantly below mean
  const sortedCalories = [...calories].sort((a, b) => a - b);
  const percentile10 = sortedCalories[Math.floor(sortedCalories.length * 0.1)];
  
  // Use the more conservative (higher) threshold to avoid over-excluding
  // This ensures we only exclude truly unusual days
  const finalThreshold = Math.max(sdThreshold, percentile10);
  
  // Mark dates that are outliers
  data.forEach(d => {
    if (d.calories > 0 && d.calories < finalThreshold) {
      outlierDates.add(d.date);
    }
  });
  
  if (outlierDates.size > 0) {
    console.log(`[TDEE] Detected ${outlierDates.size} low-calorie outlier days (threshold: ${finalThreshold.toFixed(0)} cal, mean: ${mean.toFixed(0)} cal, SD: ${sd.toFixed(0)} cal)`);
  }
  
  return outlierDates;
}

/**
 * Create regression pairs using smoothed weight changes.
 */

function createSmoothedPairs(
  data: DailyDataPoint[],
  smoothingWindow: number
): RegressionPair[] {
  const pairs: RegressionPair[] = [];
  
  // Detect low-calorie outliers using statistical methods
  const lowCalorieOutliers = detectLowCalorieOutliers(data);

  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].weight > 0 && data[i + 1].weight > 0 && data[i].calories > 0) {
      // Exclude days with unusually low calories (statistical outliers)
      if (lowCalorieOutliers.has(data[i].date)) {
        continue; // Skip this pair
      }
      
      const smoothedWeightToday = getSmoothedWeight(data, i, smoothingWindow);
      const smoothedWeightTomorrow = getSmoothedWeight(data, i + 1, smoothingWindow);
      
      pairs.push({
        weight: data[i].weight, // Use actual weight for TDEE calculation
        calories: data[i].calories,
        actualChange: smoothedWeightTomorrow - smoothedWeightToday, // Smoothed change
        date: data[i].date,
      });
    }
  }

  return pairs;
}

/**
 * Calculate residuals for outlier detection.
 */
function calculateResiduals(
  pairs: RegressionPair[],
  alpha: number
): number[] {
  return pairs.map((pair) => {
    const predictedChange = (pair.calories - alpha * pair.weight) / CALORIES_PER_LB;
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
  threshold: number
): { filtered: RegressionPair[]; excluded: number } {
  const residuals = calculateResiduals(pairs, alpha);
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

/**
 * Solve for α using the normal equation (closed-form solution).
 * Separated out so it can be called multiple times (for two-pass approach).
 */
function runNormalEquation(pairs: RegressionPair[]): number {
  // Solve for α using the normal equation
  // Minimize: Σ[(calories/3500 - α*weight/3500) - actualChange]²
  //
  // Taking derivative w.r.t. α and setting to 0:
  // Σ[2 * (calories/3500 - α*weight/3500 - actualChange) * (-weight/3500)] = 0
  //
  // Rearranging:
  // α = Σ[weight * (calories/3500 - actualChange)] / Σ[weight² / 3500]

  let numerator = 0;
  let denominator = 0;

  for (const pair of pairs) {
    numerator += pair.weight * (pair.calories / CALORIES_PER_LB - pair.actualChange);
    denominator += (pair.weight * pair.weight) / CALORIES_PER_LB;
  }

  if (denominator === 0) return INITIAL_BURN_RATE;

  return numerator / denominator;
}

/**
 * Run least-squares regression to find the burn rate (α) that minimizes
 * prediction error.
 *
 * Now includes smoothed weights and two-pass outlier exclusion.
 *
 * Model:
 *   predicted_change[i] = (calories[i] - α * weight[i]) / 3500
 *   actual_change[i] = smoothed_weight[i+1] - smoothed_weight[i]
 *
 * Minimize: Σ(predicted_change[i] - actual_change[i])²
 */
function runLeastSquaresRegression(
  data: DailyDataPoint[],
  smoothingWindow: number,
  outlierThreshold: number
): RegressionResult | null {
  if (data.length < 2) return null;

  // Create pairs with smoothed weight changes
  let pairs = createSmoothedPairs(data, smoothingWindow);

  if (pairs.length < 5) return null;

  // === FIRST PASS: Initial regression ===
  let alpha = runNormalEquation(pairs);

  // === OUTLIER EXCLUSION ===
  const { filtered: cleanedPairs, excluded } = excludeOutliers(
    pairs,
    alpha,
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
  alpha = runNormalEquation(pairs);

  // Calculate final error metrics on cleaned data
  const residuals = calculateResiduals(pairs, alpha);
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
    alpha,
    standardError,
    rSquared,
    outliersExcluded: excluded,
    dataPointsAfterExclusion: pairs.length,
  };
}

// === HELPER FUNCTIONS ===

function filterDataPoints(
  dataPoints: DailyDataPoint[],
  windowDays: number,
  excludeIncomplete: boolean
): DailyDataPoint[] {
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

function clampBurnRate(alpha: number): number {
  // Clamp to reasonable range
  if (alpha < TYPICAL_BURN_RATE_MIN) return TYPICAL_BURN_RATE_MIN;
  if (alpha > TYPICAL_BURN_RATE_MAX) return TYPICAL_BURN_RATE_MAX;
  return Math.round(alpha * 10) / 10; // Round to 1 decimal
}

function calculateConfidence(
  result: RegressionResult,
  dataPoints: number
): 'unstable' | 'stabilizing' | 'stable' {
  // Stable: low standard error, good R², enough data
  if (result.standardError < 0.5 && result.rSquared > 0.3 && dataPoints >= 18) {
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
  // More data = higher score (up to 50 points for 28 days)
  const dataScore = Math.min(dataPoints / 28, 1) * 50;

  // Lower error = higher score (up to 50 points)
  const accuracyScore = Math.max(0, 50 - standardError * 30);

  return Math.round(dataScore + accuracyScore);
}

function buildEstimateHistory(
  dataPoints: DailyDataPoint[],
  windowDays: number,
  smoothingWindow: number,
  outlierThreshold: number
): BurnRateHistoryPoint[] {
  const history: BurnRateHistoryPoint[] = [];

  // Sort by date
  const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 7) return history;

  // Calculate rolling estimates starting from day 7
  for (let i = 7; i <= sorted.length; i++) {
    const windowData = sorted.slice(Math.max(0, i - windowDays), i);
    const result = runLeastSquaresRegression(windowData, smoothingWindow, outlierThreshold);

    if (result) {
      const effectiveDataPoints = result.dataPointsAfterExclusion ?? windowData.length;
      history.push({
        date: sorted[i - 1].date,
        burnRate: clampBurnRate(result.alpha),
        confidence: calculateConfidenceScore(result.standardError, effectiveDataPoints),
      });
    }
  }

  return history;
}

function findDataGaps(dataPoints: DailyDataPoint[]): number {
  if (dataPoints.length < 2) return 0;

  const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));
  let gaps = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(sorted[i - 1].date);
    const currDate = new Date(sorted[i].date);
    const daysDiff = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 1) {
      gaps += daysDiff - 1;
    }
  }

  return gaps;
}

function findMaxDailyWeightSwing(dataPoints: DailyDataPoint[]): number {
  if (dataPoints.length < 2) return 0;

  const sorted = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));
  let maxSwing = 0;

  for (let i = 1; i < sorted.length; i++) {
    const swing = Math.abs(sorted[i].weight - sorted[i - 1].weight);
    if (swing > maxSwing) maxSwing = swing;
  }

  return maxSwing;
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

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// === REGRESSION VISUALIZATION ===

/**
 * Generate regression analysis data for visualization.
 * Returns the data points with actual vs predicted weight changes.
 */
export function getRegressionAnalysis(
  dataPoints: DailyDataPoint[],
  currentWeight: number,
  options: AdaptiveTDEEOptions = {}
): RegressionAnalysis | null {
  const {
    windowDays = DEFAULT_WINDOW_DAYS,
    excludeIncomplete = true,
  } = options;

  // Filter and validate data
  const filtered = filterDataPoints(dataPoints, windowDays, excludeIncomplete);

  if (filtered.length < 2) {
    console.warn(`[TDEE Regression] Insufficient data points: only ${filtered.length} (need at least 2)`);
    return null;
  }

  // Build pairs of consecutive days using ACTUAL (non-smoothed) weight changes for visualization
  // Apply sanity check: exclude obviously erroneous data (> 10 lbs/day change is physically impossible)
  // Using 10 lbs to be less strict - outlier detection will catch statistical outliers
  const MAX_REASONABLE_DAILY_CHANGE = 10.0; // lbs/day - anything beyond this is clearly an error
  
  const pairs: Array<{
    date: string;
    weight: number;
    calories: number;
    actualChange: number;
  }> = [];

  // Detect low-calorie outliers using statistical methods
  const lowCalorieOutliers = detectLowCalorieOutliers(filtered);
  
  for (let i = 0; i < filtered.length - 1; i++) {
    if (filtered[i].weight > 0 && filtered[i + 1].weight > 0 && filtered[i].calories > 0) {
      // Exclude days with unusually low calories (statistical outliers)
      if (lowCalorieOutliers.has(filtered[i].date)) {
        console.warn(`[TDEE Regression] Excluding low-calorie outlier day: ${filtered[i].date} with ${filtered[i].calories.toFixed(0)} cal`);
        continue; // Skip this pair
      }
      
      // Use actual weight changes (not smoothed) for visualization
      const actualChange = filtered[i + 1].weight - filtered[i].weight;
      
      // Sanity check: exclude physically impossible weight changes
      if (Math.abs(actualChange) > MAX_REASONABLE_DAILY_CHANGE) {
        console.warn(`[TDEE Regression] Excluding extreme outlier: ${filtered[i].date} to ${filtered[i + 1].date}: ${actualChange.toFixed(2)} lbs/day change (threshold: ${MAX_REASONABLE_DAILY_CHANGE} lbs/day)`);
        console.warn(`  - Weight ${i}: ${filtered[i].weight.toFixed(1)} lbs, Weight ${i+1}: ${filtered[i + 1].weight.toFixed(1)} lbs`);
        console.warn(`  - Calories: ${filtered[i].calories.toFixed(0)} cal`);
        continue; // Skip this pair
      }
      
      pairs.push({
        date: filtered[i].date,
        weight: filtered[i].weight,
        calories: filtered[i].calories,
        actualChange, // Raw actual change - shows all fluctuations
      });
    }
  }

  // Reduced minimum: allow graph with just 2 pairs (was 5)
  // This helps users see their data even when they have limited history
  if (pairs.length < 2) {
    console.warn(`[TDEE Regression] Insufficient data: only ${pairs.length} pairs (need at least 2)`);
    return null;
  }
  
  if (pairs.length < 5) {
    console.warn(`[TDEE Regression] Limited data: only ${pairs.length} pairs (recommend at least 5 for accuracy)`);
  }

  // Run regression to get alpha (use smoothing/outlier exclusion for calculation accuracy)
  const result = runLeastSquaresRegression(filtered, DEFAULT_SMOOTHING_WINDOW, DEFAULT_OUTLIER_THRESHOLD);
  if (!result) {
    return null;
  }

  const clampedAlpha = clampBurnRate(result.alpha);

  // Apply the same outlier exclusion logic to visualization pairs
  // This ensures we only show data points that were actually used in the regression
  const visualizationPairs: RegressionPair[] = pairs.map(p => ({
    weight: p.weight,
    calories: p.calories,
    actualChange: p.actualChange,
    date: p.date,
  }));

  // Calculate residuals and exclude outliers using the same logic as regression
  const { filtered: cleanedPairs, excluded } = excludeOutliers(
    visualizationPairs,
    clampedAlpha,
    DEFAULT_OUTLIER_THRESHOLD
  );
  
  // Log excluded outliers for debugging
  if (excluded > 0) {
    console.warn(`[TDEE Regression] Excluded ${excluded} statistical outlier(s) (threshold: ${DEFAULT_OUTLIER_THRESHOLD} SD)`);
    const excludedPairs = visualizationPairs.filter(p => {
      const predictedChange = (p.calories - clampedAlpha * p.weight) / CALORIES_PER_LB;
      const residual = p.actualChange - predictedChange;
      const residuals = visualizationPairs.map(p2 => {
        const pred2 = (p2.calories - clampedAlpha * p2.weight) / CALORIES_PER_LB;
        return p2.actualChange - pred2;
      });
      const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
      const stdDev = Math.sqrt(residuals.reduce((sum, r) => sum + (r - meanResidual) ** 2, 0) / residuals.length);
      return Math.abs(residual - meanResidual) > DEFAULT_OUTLIER_THRESHOLD * stdDev;
    });
    excludedPairs.forEach(p => {
      const predictedChange = (p.calories - clampedAlpha * p.weight) / CALORIES_PER_LB;
      const residual = p.actualChange - predictedChange;
      console.warn(`  - Excluded: ${p.date} | Weight: ${p.weight.toFixed(1)} lbs | Calories: ${p.calories.toFixed(0)} cal | Actual: ${p.actualChange > 0 ? '+' : ''}${p.actualChange.toFixed(2)} lbs/day | Predicted: ${predictedChange > 0 ? '+' : ''}${predictedChange.toFixed(2)} lbs/day | Residual: ${residual > 0 ? '+' : ''}${residual.toFixed(2)} lbs`);
    });
  }

  // Build visualization data points using only cleaned (non-outlier) pairs
  const regressionDataPoints: RegressionDataPoint[] = cleanedPairs.map((pair) => {
    const predictedChange = (pair.calories - clampedAlpha * pair.weight) / CALORIES_PER_LB;
    return {
      date: pair.date,
      weight: pair.weight,
      calories: pair.calories,
      actualChange: pair.actualChange, // Actual (non-smoothed) change - but only for valid data
      predictedChange, // Predicted based on smoothed regression
      residual: pair.actualChange - predictedChange,
    };
  });

  // Log pairs used in regression graph for debugging
  console.log(`[TDEE Regression Graph] Total pairs: ${regressionDataPoints.length} (${pairs.length} original, ${excluded} excluded)`);
  console.log('[TDEE Regression Graph] Pairs being displayed:', regressionDataPoints.map(dp => ({
    date: dp.date,
    weight: `${dp.weight.toFixed(1)} lbs`,
    calories: `${dp.calories.toFixed(0)} cal`,
    actualChange: `${dp.actualChange > 0 ? '+' : ''}${dp.actualChange.toFixed(2)} lbs/day`,
    predictedChange: `${dp.predictedChange > 0 ? '+' : ''}${dp.predictedChange.toFixed(2)} lbs/day`,
    residual: `${dp.residual > 0 ? '+' : ''}${dp.residual.toFixed(2)} lbs`,
  })));

  return {
    dataPoints: regressionDataPoints,
    burnRatePerLb: clampedAlpha,
    estimatedTDEE: Math.round(clampedAlpha * currentWeight),
    rSquared: result.rSquared,
    standardError: result.standardError,
    currentWeight,
  };
}

// === COMPARISON HELPERS ===

/**
 * Compare adaptive TDEE vs formula TDEE.
 * Useful for showing users the difference.
 */
export function compareTDEEEstimates(
  adaptiveEstimate: TDEEEstimate | null,
  formulaEstimate: TDEEEstimate
): {
  difference: number;
  percentDifference: number;
  adaptive: number | null;
  formula: number;
  recommendation: string;
} {
  const adaptive = adaptiveEstimate?.estimatedTDEE ?? null;
  const formula = formulaEstimate.estimatedTDEE;
  const difference = adaptive ? adaptive - formula : 0;
  const percentDifference = adaptive ? Math.round((difference / formula) * 100) : 0;

  let recommendation: string;
  if (!adaptive) {
    recommendation = 'Keep logging weight and calories to unlock personalized estimates.';
  } else if (Math.abs(percentDifference) < 5) {
    recommendation = 'Your personal metabolism closely matches the formula estimate.';
  } else if (difference > 0) {
    recommendation = `Your actual burn rate is ${percentDifference}% higher than formulas predict. You may be able to eat more!`;
  } else {
    recommendation = `Your actual burn rate is ${Math.abs(percentDifference)}% lower than formulas predict. Adjust your targets accordingly.`;
  }

  return {
    difference,
    percentDifference,
    adaptive,
    formula,
    recommendation,
  };
}

/**
 * Get the best available TDEE estimate.
 * Returns adaptive if available and confident, otherwise formula.
 */
export function getBestTDEEEstimate(
  adaptiveEstimate: TDEEEstimate | null,
  formulaEstimate: TDEEEstimate
): TDEEEstimate {
  if (
    adaptiveEstimate &&
    adaptiveEstimate.confidence !== 'unstable' &&
    adaptiveEstimate.dataPointsUsed >= 10
  ) {
    return adaptiveEstimate;
  }
  return formulaEstimate;
}
