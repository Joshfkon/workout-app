/**
 * Step Normalization and Calibration
 *
 * Different devices count steps differently. This module normalizes
 * step counts to a baseline (Apple Watch as reference) and learns
 * user-specific calibration factors over time.
 */

import type {
  WearableSource,
  WearableConnection,
  EnhancedDailyDataPoint,
  BurnRateHistoryPoint,
  BASELINE_STEP_MULTIPLIERS,
} from '@/types/wearable';
import { getLocalDateString } from '@/lib/utils';

// === CONSTANTS ===

/**
 * Baseline multipliers for normalizing step counts across devices.
 * Apple Watch is used as the reference baseline (1.0).
 * These are rough estimates, refined per-user over time.
 */
export const BASELINE_MULTIPLIERS: Record<WearableSource, number> = {
  apple_healthkit: 1.0, // Reference baseline
  google_fit: 0.95, // Tends to count slightly more
  fitbit: 1.02, // Tends to count slightly less
  samsung_health: 0.97,
  garmin: 1.0,
  manual: 1.0,
};

// Calibration limits
const MIN_CALIBRATION_FACTOR = 0.8;
const MAX_CALIBRATION_FACTOR = 1.2;
const MAX_ADJUSTMENT_PER_UPDATE = 0.05; // 5% max adjustment per update

// === NORMALIZATION FUNCTIONS ===

/**
 * Normalize raw step count based on device source and user calibration.
 *
 * @param rawSteps - Raw step count from the wearable
 * @param source - Which wearable the data came from
 * @param userCalibration - User-specific calibration factor (default 1.0)
 * @returns Normalized step count
 */
export function normalizeSteps(
  rawSteps: number,
  source: WearableSource,
  userCalibration: number = 1.0
): number {
  const baselineMultiplier = BASELINE_MULTIPLIERS[source] || 1.0;
  return Math.round(rawSteps * baselineMultiplier * userCalibration);
}

/**
 * Denormalize step count back to raw (for display purposes)
 */
export function denormalizeSteps(
  normalizedSteps: number,
  source: WearableSource,
  userCalibration: number = 1.0
): number {
  const baselineMultiplier = BASELINE_MULTIPLIERS[source] || 1.0;
  return Math.round(normalizedSteps / (baselineMultiplier * userCalibration));
}

// === CALIBRATION LEARNING ===

interface CalibrationResult {
  newCalibrationFactor: number;
  adjustment: number;
  reason: string;
  correlation: number;
  dataPointsAnalyzed: number;
  shouldUpdate: boolean;
}

/**
 * Learn user's step calibration by comparing predicted vs actual weight change.
 * If steps seem to burn more/less than expected, adjust calibration.
 *
 * @param connection - Current wearable connection
 * @param recentData - Recent daily data points (last 14+ days)
 * @param tdeeEstimate - Current TDEE estimate with burn rates
 * @returns Calibration result with recommendation
 */
export function calculateStepCalibration(
  connection: WearableConnection,
  recentData: EnhancedDailyDataPoint[],
  tdeeEstimate: {
    baseBurnRate: number; // cal/lb
    stepBurnRate: number; // cal/step
    confidence: string;
    averageSteps: number;
  }
): CalibrationResult {
  const currentFactor = connection.stepCalibrationFactor;

  // Need enough data and stable TDEE estimate
  if (recentData.length < 14) {
    return {
      newCalibrationFactor: currentFactor,
      adjustment: 0,
      reason: 'Insufficient data (need 14+ days)',
      correlation: 0,
      dataPointsAnalyzed: recentData.length,
      shouldUpdate: false,
    };
  }

  if (tdeeEstimate.confidence === 'unstable') {
    return {
      newCalibrationFactor: currentFactor,
      adjustment: 0,
      reason: 'TDEE estimate not stable yet',
      correlation: 0,
      dataPointsAnalyzed: recentData.length,
      shouldUpdate: false,
    };
  }

  // Calculate residuals: days where prediction was off
  const residuals = calculateResiduals(recentData, tdeeEstimate);

  // Calculate correlation between step deviation and prediction error
  const correlation = calculatePearsonCorrelation(
    residuals.map((r) => r.stepsDeviation),
    residuals.map((r) => r.error)
  );

  // If high-step days consistently lose more weight than predicted,
  // steps are burning more than we estimated (increase calibration)
  // Positive correlation = high steps → more loss than expected → increase cal

  // Calculate adjustment (max 5% per update)
  const rawAdjustment = correlation * 0.1; // 10% of correlation
  const cappedAdjustment = Math.max(
    -MAX_ADJUSTMENT_PER_UPDATE,
    Math.min(MAX_ADJUSTMENT_PER_UPDATE, rawAdjustment)
  );

  // Apply adjustment
  const newFactor = currentFactor * (1 + cappedAdjustment);

  // Clamp to reasonable range
  const clampedFactor = Math.max(
    MIN_CALIBRATION_FACTOR,
    Math.min(MAX_CALIBRATION_FACTOR, newFactor)
  );

  // Determine if we should update
  const shouldUpdate =
    Math.abs(cappedAdjustment) > 0.01 && // More than 1% change
    Math.abs(correlation) > 0.2; // Meaningful correlation

  let reason: string;
  if (!shouldUpdate) {
    reason = 'Current calibration is accurate';
  } else if (cappedAdjustment > 0) {
    reason = `Steps burning ${Math.round(cappedAdjustment * 100)}% more than estimated`;
  } else {
    reason = `Steps burning ${Math.round(Math.abs(cappedAdjustment) * 100)}% less than estimated`;
  }

  return {
    newCalibrationFactor: clampedFactor,
    adjustment: clampedFactor - currentFactor,
    reason,
    correlation,
    dataPointsAnalyzed: recentData.length,
    shouldUpdate,
  };
}

/**
 * Calculate prediction residuals for each day
 */
function calculateResiduals(
  data: EnhancedDailyDataPoint[],
  tdeeEstimate: {
    baseBurnRate: number;
    stepBurnRate: number;
    averageSteps: number;
  }
): Array<{
  date: string;
  error: number;
  stepsDeviation: number;
}> {
  const results: Array<{
    date: string;
    error: number;
    stepsDeviation: number;
  }> = [];

  for (let i = 0; i < data.length - 1; i++) {
    const day = data[i];
    const nextDay = data[i + 1];

    // Skip if missing data
    if (!day.weight || !nextDay.weight || !day.calories) continue;

    // Predicted TDEE for this day
    const predictedTDEE =
      tdeeEstimate.baseBurnRate * day.weight + tdeeEstimate.stepBurnRate * day.netSteps;

    // Predicted weight change
    const predictedChange = (day.calories - predictedTDEE) / 3500;

    // Actual weight change
    const actualChange = nextDay.weight - day.weight;

    // Error (positive = lost more than predicted)
    const error = actualChange - predictedChange;

    // Step deviation from average
    const stepsDeviation = day.steps - tdeeEstimate.averageSteps;

    results.push({
      date: day.date,
      error,
      stepsDeviation,
    });
  }

  return results;
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculatePearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;

  // Calculate means
  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  // Calculate covariance and standard deviations
  let covariance = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    covariance += diffX * diffY;
    varX += diffX * diffX;
    varY += diffY * diffY;
  }

  const stdX = Math.sqrt(varX);
  const stdY = Math.sqrt(varY);

  if (stdX === 0 || stdY === 0) return 0;

  return covariance / (stdX * stdY);
}

// === CALIBRATION HISTORY ===

interface CalibrationHistoryEntry {
  date: string;
  oldFactor: number;
  newFactor: number;
  reason: string;
  correlation: number;
  dataPointsAnalyzed: number;
}

/**
 * Create a calibration history entry for tracking changes over time
 */
export function createCalibrationHistoryEntry(
  result: CalibrationResult,
  currentFactor: number
): CalibrationHistoryEntry {
  return {
    date: getLocalDateString(),
    oldFactor: currentFactor,
    newFactor: result.newCalibrationFactor,
    reason: result.reason,
    correlation: result.correlation,
    dataPointsAnalyzed: result.dataPointsAnalyzed,
  };
}

// === UTILITY FUNCTIONS ===

/**
 * Get device-specific step accuracy notes for user display
 */
export function getDeviceAccuracyNotes(source: WearableSource): string {
  const notes: Record<WearableSource, string> = {
    apple_healthkit:
      'Apple Watch is our reference device. Step counts are used as-is with your personal calibration.',
    google_fit:
      'Android devices may count slightly more steps than average. We apply a small adjustment.',
    fitbit:
      'Fitbit devices may count slightly fewer steps than average. We apply a small adjustment.',
    samsung_health:
      'Samsung devices vary. We apply a standard adjustment that improves over time.',
    garmin: 'Garmin devices are highly accurate. Minimal adjustment needed.',
    manual: 'Manual entries are used as-is. For best accuracy, estimate conservatively.',
  };

  return notes[source] || 'Device-specific adjustments will be learned over time.';
}

/**
 * Format calibration factor for display
 */
export function formatCalibrationFactor(factor: number): string {
  const percentage = Math.round((factor - 1) * 100);
  if (percentage === 0) return 'Standard (no adjustment)';
  if (percentage > 0) return `+${percentage}% adjustment`;
  return `${percentage}% adjustment`;
}

/**
 * Check if calibration factor is within expected range
 */
export function isCalibrationReasonable(factor: number): boolean {
  return factor >= MIN_CALIBRATION_FACTOR && factor <= MAX_CALIBRATION_FACTOR;
}

/**
 * Reset calibration to default for a source
 */
export function getDefaultCalibration(source: WearableSource): number {
  return BASELINE_MULTIPLIERS[source] || 1.0;
}
