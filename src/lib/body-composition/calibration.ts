/**
 * DEXA Calibration
 *
 * Learn user's personal P-ratio from actual DEXA scan results.
 * Uses scan pairs to calculate actual fat vs lean mass changes.
 */

import type {
  DEXAScan,
  UserBodyCompProfile,
  CalibrationResult,
  ScanPairAnalysis,
  PRatioConfidence,
  PredictionAccuracyLog,
  BodyCompChangeSummary,
} from './types';
import { getPRatioQuality } from './p-ratio';

/**
 * Calculate median of an array
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

/**
 * Analyze a pair of consecutive DEXA scans
 */
export function analyzeScanPair(
  startScan: DEXAScan,
  endScan: DEXAScan
): ScanPairAnalysis {
  const weightChange = endScan.totalMassKg - startScan.totalMassKg;
  const fatChange = endScan.fatMassKg - startScan.fatMassKg;
  const leanChange = endScan.leanMassKg - startScan.leanMassKg;

  const durationDays = Math.round(
    (endScan.scanDate.getTime() - startScan.scanDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Validate the scan pair
  let isValid = true;
  let invalidReason: string | undefined;

  // Need at least 1kg weight change for meaningful P-ratio
  if (Math.abs(weightChange) < 1) {
    isValid = false;
    invalidReason = 'Weight change too small for reliable P-ratio calculation';
  }

  // Need at least 14 days between scans
  if (durationDays < 14) {
    isValid = false;
    invalidReason = 'Scans too close together for reliable measurement';
  }

  // Calculate P-ratio (fat change / total change)
  // Only valid during weight loss or gain (not maintenance)
  let calculatedPRatio = 0;
  if (Math.abs(weightChange) >= 1) {
    calculatedPRatio = fatChange / weightChange;

    // Sanity check: P-ratio should be between 0.3 and 1.1
    // Can exceed 1.0 if gained muscle while losing fat (recomp)
    if (calculatedPRatio < 0.3 || calculatedPRatio > 1.1) {
      isValid = false;
      invalidReason = `Calculated P-ratio (${calculatedPRatio.toFixed(2)}) outside expected range`;
    }
  }

  return {
    startScan,
    endScan,
    weightChange,
    fatChange,
    leanChange,
    calculatedPRatio,
    durationDays,
    isValid,
    invalidReason,
  };
}

/**
 * Calibrate P-ratio from multiple DEXA scan pairs
 */
export function calibratePRatioFromScans(scans: DEXAScan[]): CalibrationResult | null {
  if (scans.length < 2) {
    return null;
  }

  // Sort by date
  const sortedScans = [...scans].sort(
    (a, b) => a.scanDate.getTime() - b.scanDate.getTime()
  );

  const scanPairs: ScanPairAnalysis[] = [];
  const validPRatios: number[] = [];

  // Analyze each consecutive pair
  for (let i = 1; i < sortedScans.length; i++) {
    const analysis = analyzeScanPair(sortedScans[i - 1], sortedScans[i]);
    scanPairs.push(analysis);

    if (analysis.isValid) {
      validPRatios.push(analysis.calculatedPRatio);
    }
  }

  if (validPRatios.length === 0) {
    return null;
  }

  // Use median to reduce outlier impact
  const learnedPRatio = median(validPRatios);

  // Determine confidence based on data points and consistency
  const stdDev = standardDeviation(validPRatios);
  let confidence: PRatioConfidence = 'low';

  if (validPRatios.length >= 4 && stdDev < 0.08) {
    confidence = 'high';
  } else if (validPRatios.length >= 2 && stdDev < 0.12) {
    confidence = 'medium';
  }

  return {
    learnedPRatio,
    confidence,
    dataPoints: validPRatios.length,
    scanPairs,
  };
}

/**
 * Get summary of body composition changes between scans
 */
export function getBodyCompChangeSummary(
  startScan: DEXAScan,
  endScan: DEXAScan
): BodyCompChangeSummary {
  const analysis = analyzeScanPair(startScan, endScan);

  return {
    startDate: startScan.scanDate,
    endDate: endScan.scanDate,
    weightChange: analysis.weightChange,
    fatChange: analysis.fatChange,
    leanChange: analysis.leanChange,
    bodyFatChange: endScan.bodyFatPercent - startScan.bodyFatPercent,
    calculatedPRatio: analysis.calculatedPRatio,
    pRatioQuality: getPRatioQuality(analysis.calculatedPRatio),
  };
}

/**
 * Compare prediction vs actual results
 */
export function comparePredictionVsActual(
  prediction: {
    bodyFat: number;
    leanMass: number;
    fatMass: number;
    pRatio: number;
    bodyFatRange: { optimistic: number; pessimistic: number };
  },
  actualScan: DEXAScan,
  startScan: DEXAScan,
  userId: string,
  predictionDate: Date
): PredictionAccuracyLog {
  // Calculate actual P-ratio from the scan pair
  const actualAnalysis = analyzeScanPair(startScan, actualScan);

  // Check if actual was within the predicted range
  const withinRange =
    actualScan.bodyFatPercent >= prediction.bodyFatRange.optimistic &&
    actualScan.bodyFatPercent <= prediction.bodyFatRange.pessimistic;

  return {
    userId,
    predictionDate,
    actualDate: actualScan.scanDate,

    predictedBodyFat: prediction.bodyFat,
    predictedLeanMass: prediction.leanMass,
    predictedFatMass: prediction.fatMass,

    actualBodyFat: actualScan.bodyFatPercent,
    actualLeanMass: actualScan.leanMassKg,
    actualFatMass: actualScan.fatMassKg,

    bodyFatError: actualScan.bodyFatPercent - prediction.bodyFat,
    leanMassError: actualScan.leanMassKg - prediction.leanMass,
    fatMassError: actualScan.fatMassKg - prediction.fatMass,

    withinRange,

    predictedPRatio: prediction.pRatio,
    actualPRatio: actualAnalysis.calculatedPRatio,
  };
}

/**
 * Update profile with new DEXA scan and recalibrate
 */
export function processNewDEXAScan(
  profile: UserBodyCompProfile,
  newScan: DEXAScan
): UserBodyCompProfile {
  // Add scan to history
  const updatedScans = [...profile.scans, newScan].sort(
    (a, b) => a.scanDate.getTime() - b.scanDate.getTime()
  );

  // Recalibrate P-ratio
  const calibration = calibratePRatioFromScans(updatedScans);

  if (calibration) {
    return {
      ...profile,
      scans: updatedScans,
      learnedPRatio: calibration.learnedPRatio,
      pRatioConfidence: calibration.confidence,
      pRatioDataPoints: calibration.dataPoints,
      lastUpdated: new Date(),
    };
  }

  return {
    ...profile,
    scans: updatedScans,
    lastUpdated: new Date(),
  };
}

/**
 * Format P-ratio as percentage of weight loss from fat
 */
export function formatPRatioAsPercentage(pRatio: number): string {
  const percent = Math.round(pRatio * 100);
  return `${percent}% of loss was fat`;
}

/**
 * Get human-readable explanation of the P-ratio result
 */
export function explainPRatioResult(pRatio: number): string {
  const quality = getPRatioQuality(pRatio);

  switch (quality) {
    case 'excellent':
      return 'Excellent! Almost all weight lost was fat, with minimal muscle loss.';
    case 'good':
      return 'Good result. Most weight lost was fat with some muscle loss.';
    case 'fair':
      return 'Fair result. Some muscle was lost along with fat.';
    case 'poor':
      return 'More muscle was lost than ideal. Consider adjusting protein, training, or deficit.';
  }
}

/**
 * Calculate how many more scans needed for better confidence
 */
export function getScansNeededForConfidence(
  currentDataPoints: number,
  currentConfidence: PRatioConfidence,
  targetConfidence: PRatioConfidence
): number {
  const confidenceOrder: PRatioConfidence[] = ['none', 'low', 'medium', 'high'];
  const currentIndex = confidenceOrder.indexOf(currentConfidence);
  const targetIndex = confidenceOrder.indexOf(targetConfidence);

  if (targetIndex <= currentIndex) return 0;

  // Rough estimates based on our confidence thresholds
  if (targetConfidence === 'medium' && currentDataPoints < 2) {
    return 2 - currentDataPoints;
  }

  if (targetConfidence === 'high' && currentDataPoints < 4) {
    return 4 - currentDataPoints;
  }

  return 1; // At least one more for any improvement
}
