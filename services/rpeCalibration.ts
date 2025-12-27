/**
 * RPE Calibration Engine
 *
 * Tracks user's RPE perception accuracy by comparing AMRAP results
 * to what their RIR reports predicted. Shows users their bias
 * and adjusts prescriptions accordingly.
 *
 * Pure functions - no database calls.
 */

import type { RepsInTank } from '@/types/schema';

// ============================================
// TYPES
// ============================================

/**
 * A logged set for calibration tracking
 */
export interface CalibrationSetLog {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  prescribedReps: { min: number; max: number | null };
  actualReps: number;
  /** User's estimate of reps in reserve (0-4) */
  reportedRIR: number;
  wasAMRAP: boolean;
  restTimeSeconds?: number;
  timestamp: Date;
}

/**
 * Result of comparing AMRAP to predicted performance
 */
export interface CalibrationResult {
  exerciseName: string;
  /** What their RIR reports implied they could do */
  predictedMaxReps: number;
  /** What AMRAP actually showed */
  actualMaxReps: number;
  /** Positive = sandbagging (stopped early), Negative = overreaching */
  bias: number;
  biasInterpretation: string;
  confidenceLevel: 'low' | 'medium' | 'high';
  lastCalibrated: Date;
  /** Number of data points used for this calibration */
  dataPoints: number;
}

/**
 * Overall RPE bias analysis across all exercises
 */
export interface RPEBiasAnalysis {
  overallBias: number;
  exerciseSpecificBias: Map<string, number>;
  sandbaggingDetected: boolean;
  overreachingDetected: boolean;
  recommendation: string;
  calibratedExercises: number;
  needsMoreData: boolean;
}

/**
 * Adjusted RIR prescription based on user's bias
 */
export interface AdjustedRIRResult {
  /** What to tell the user */
  prescribedRIR: number;
  /** What we actually want them to hit */
  internalTargetRIR: number;
  /** Whether an adjustment was made */
  hasAdjustment: boolean;
  /** Explanation if adjustment was made */
  adjustmentReason?: string;
}

// ============================================
// CALIBRATION ENGINE CLASS
// ============================================

/**
 * Engine for tracking and calculating RPE calibration
 *
 * Usage:
 * 1. Create instance with historical data
 * 2. Call addSetLog() after each set
 * 3. After AMRAP, getCalibrationResult() shows the comparison
 * 4. analyzeOverallBias() gives aggregate insights
 * 5. getAdjustedRIR() adjusts prescriptions based on bias
 */
export class RPECalibrationEngine {
  private setHistory: CalibrationSetLog[] = [];
  private calibrationResults: Map<string, CalibrationResult> = new Map();
  private readonly maxHistorySize = 500;

  constructor(
    initialHistory: CalibrationSetLog[] = [],
    initialCalibrations: CalibrationResult[] = []
  ) {
    this.setHistory = initialHistory.slice(-this.maxHistorySize);
    for (const cal of initialCalibrations) {
      this.calibrationResults.set(cal.exerciseName.toLowerCase(), cal);
    }
  }

  /**
   * Add a set log to the history
   * If it's an AMRAP, automatically calculate calibration
   */
  addSetLog(log: CalibrationSetLog): CalibrationResult | null {
    this.setHistory.push(log);

    // Keep history size bounded
    if (this.setHistory.length > this.maxHistorySize) {
      this.setHistory = this.setHistory.slice(-this.maxHistorySize);
    }

    // If this was an AMRAP, calculate calibration
    if (log.wasAMRAP) {
      return this.processAMRAPCalibration(log);
    }

    return null;
  }

  /**
   * Core calibration logic:
   * Compare AMRAP result to what recent RIR reports predicted
   */
  private processAMRAPCalibration(amrapSet: CalibrationSetLog): CalibrationResult {
    const key = amrapSet.exerciseName.toLowerCase();

    // Get recent non-AMRAP sets at similar weight (within 10%)
    const recentSets = this.setHistory.filter(s =>
      s.exerciseName.toLowerCase() === key &&
      !s.wasAMRAP &&
      Math.abs(s.weight - amrapSet.weight) / Math.max(1, amrapSet.weight) < 0.10 &&
      s.timestamp < amrapSet.timestamp &&
      (amrapSet.timestamp.getTime() - s.timestamp.getTime()) < 28 * 24 * 60 * 60 * 1000 // 4 weeks
    );

    if (recentSets.length === 0) {
      // No comparison data - just record the AMRAP
      const result: CalibrationResult = {
        exerciseName: amrapSet.exerciseName,
        predictedMaxReps: amrapSet.actualReps,
        actualMaxReps: amrapSet.actualReps,
        bias: 0,
        biasInterpretation: 'First calibration - no prior data to compare',
        confidenceLevel: 'low',
        lastCalibrated: amrapSet.timestamp,
        dataPoints: 0,
      };
      this.calibrationResults.set(key, result);
      return result;
    }

    // Calculate what their RIR reports predicted
    // If they did 8 reps @ RIR 3, they implied they could do 11
    const predictions = recentSets.map(s => s.actualReps + s.reportedRIR);
    const avgPrediction = predictions.reduce((a, b) => a + b, 0) / predictions.length;

    // Bias = actual - predicted
    // Positive bias = they could do more than they thought (sandbagging)
    const bias = amrapSet.actualReps - avgPrediction;

    const result: CalibrationResult = {
      exerciseName: amrapSet.exerciseName,
      predictedMaxReps: Math.round(avgPrediction * 10) / 10,
      actualMaxReps: amrapSet.actualReps,
      bias: Math.round(bias * 10) / 10,
      biasInterpretation: interpretBias(bias),
      confidenceLevel: recentSets.length >= 6 ? 'high' : recentSets.length >= 3 ? 'medium' : 'low',
      lastCalibrated: amrapSet.timestamp,
      dataPoints: recentSets.length,
    };

    this.calibrationResults.set(key, result);
    return result;
  }

  /**
   * Get calibration result for a specific exercise
   */
  getCalibrationResult(exerciseName: string): CalibrationResult | null {
    return this.calibrationResults.get(exerciseName.toLowerCase()) || null;
  }

  /**
   * Analyze overall bias patterns across all exercises
   */
  analyzeOverallBias(): RPEBiasAnalysis {
    const calibrations = Array.from(this.calibrationResults.values());

    if (calibrations.length === 0) {
      return {
        overallBias: 0,
        exerciseSpecificBias: new Map(),
        sandbaggingDetected: false,
        overreachingDetected: false,
        recommendation: 'Complete some AMRAP sets to calibrate your RPE perception.',
        calibratedExercises: 0,
        needsMoreData: true,
      };
    }

    // Weight by confidence
    const weightedBiases = calibrations.map(c => ({
      bias: c.bias,
      weight: c.confidenceLevel === 'high' ? 3 : c.confidenceLevel === 'medium' ? 2 : 1,
    }));

    const totalWeight = weightedBiases.reduce((a, b) => a + b.weight, 0);
    const overallBias = weightedBiases.reduce((a, b) => a + b.bias * b.weight, 0) / totalWeight;

    const exerciseSpecificBias = new Map<string, number>();
    for (const cal of calibrations) {
      exerciseSpecificBias.set(cal.exerciseName, cal.bias);
    }

    const sandbaggingDetected = overallBias >= 2;
    const overreachingDetected = overallBias <= -2;

    const recommendation = getOverallRecommendation(overallBias);
    const needsMoreData = calibrations.filter(c => c.confidenceLevel !== 'low').length < 3;

    return {
      overallBias: Math.round(overallBias * 10) / 10,
      exerciseSpecificBias,
      sandbaggingDetected,
      overreachingDetected,
      recommendation,
      calibratedExercises: calibrations.length,
      needsMoreData,
    };
  }

  /**
   * Get adjusted RIR prescription based on user's bias
   * If user has +2 bias, prescribe RIR 1 when we want RIR 3
   */
  getAdjustedRIR(exerciseName: string, targetRIR: number): AdjustedRIRResult {
    const calibration = this.calibrationResults.get(exerciseName.toLowerCase());

    if (!calibration || calibration.confidenceLevel === 'low') {
      return {
        prescribedRIR: targetRIR,
        internalTargetRIR: targetRIR,
        hasAdjustment: false,
      };
    }

    // If bias is +2, they stop 2 reps early
    // So if we want true RIR 2, tell them RIR 0
    const adjustment = Math.round(calibration.bias);
    const prescribedRIR = Math.max(0, targetRIR - adjustment);

    if (adjustment === 0) {
      return {
        prescribedRIR: targetRIR,
        internalTargetRIR: targetRIR,
        hasAdjustment: false,
      };
    }

    return {
      prescribedRIR,
      internalTargetRIR: targetRIR,
      hasAdjustment: true,
      adjustmentReason: adjustment > 0
        ? `Adjusted down by ${adjustment} based on your calibration data (you tend to stop ${adjustment} reps early)`
        : `Adjusted up by ${Math.abs(adjustment)} based on your calibration data (you tend to push ${Math.abs(adjustment)} reps closer to failure)`,
    };
  }

  /**
   * Check if an exercise needs recalibration
   */
  needsCalibration(exerciseName: string, dayThreshold: number = 14): boolean {
    const calibration = this.calibrationResults.get(exerciseName.toLowerCase());

    if (!calibration) return true;

    const daysSinceCalibration = Math.floor(
      (Date.now() - calibration.lastCalibrated.getTime()) / (24 * 60 * 60 * 1000)
    );

    return daysSinceCalibration >= dayThreshold || calibration.confidenceLevel === 'low';
  }

  /**
   * Export data for persistence
   */
  exportData(): {
    history: CalibrationSetLog[];
    calibrations: CalibrationResult[];
  } {
    return {
      history: this.setHistory,
      calibrations: Array.from(this.calibrationResults.values()),
    };
  }

  /**
   * Get exercises sorted by how much they need calibration
   */
  getCalibrationPriorities(): Array<{
    exerciseName: string;
    priority: 'high' | 'medium' | 'low';
    reason: string;
  }> {
    const allExercises = new Set<string>();

    // Collect all unique exercises from history
    for (const set of this.setHistory) {
      allExercises.add(set.exerciseName);
    }

    const priorities: Array<{
      exerciseName: string;
      priority: 'high' | 'medium' | 'low';
      reason: string;
    }> = [];

    for (const exerciseName of allExercises) {
      const calibration = this.calibrationResults.get(exerciseName.toLowerCase());

      if (!calibration) {
        priorities.push({
          exerciseName,
          priority: 'high',
          reason: 'Never calibrated',
        });
        continue;
      }

      if (calibration.confidenceLevel === 'low') {
        priorities.push({
          exerciseName,
          priority: 'high',
          reason: 'Low confidence calibration',
        });
        continue;
      }

      const daysSince = Math.floor(
        (Date.now() - calibration.lastCalibrated.getTime()) / (24 * 60 * 60 * 1000)
      );

      if (daysSince > 28) {
        priorities.push({
          exerciseName,
          priority: 'medium',
          reason: `Last calibrated ${daysSince} days ago`,
        });
      } else {
        priorities.push({
          exerciseName,
          priority: 'low',
          reason: 'Recently calibrated',
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorities.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Interpret bias value into human-readable text
 */
function interpretBias(bias: number): string {
  if (bias >= 4) {
    return 'Significant sandbagging - you had 4+ more reps than you thought';
  }
  if (bias >= 2) {
    return 'Moderate sandbagging - you\'re stopping 2-3 reps earlier than necessary';
  }
  if (bias >= 0.5) {
    return 'Slight underestimate - pretty well calibrated';
  }
  if (bias >= -0.5) {
    return 'Excellent calibration - your RIR estimates are accurate';
  }
  if (bias >= -2) {
    return 'Slight overestimate - you\'re pushing a bit harder than you think';
  }
  return 'Significant overestimate - be careful, you\'re closer to failure than you realize';
}

/**
 * Get overall recommendation based on average bias
 */
function getOverallRecommendation(overallBias: number): string {
  if (overallBias >= 3) {
    return 'You\'re consistently stopping 3+ reps before failure. Your "hard" sets aren\'t as hard as you think. Trust the process and push closer to failure on safe exercises.';
  }
  if (overallBias >= 1.5) {
    return 'You tend to underestimate your capacity by 1-2 reps. Consider pushing a bit harder, especially on machine and isolation work.';
  }
  if (overallBias >= -0.5) {
    return 'Your RPE calibration is solid. Keep using AMRAP sets periodically to stay calibrated.';
  }
  if (overallBias >= -1.5) {
    return 'You tend to push slightly closer to failure than you think. This is fine but monitor for signs of overreaching.';
  }
  return 'You may be pushing too close to failure regularly. This increases injury risk and recovery demands. Consider leaving 1-2 more reps in reserve.';
}

/**
 * Get bias level category for display
 */
export function getBiasLevel(bias: number): 'sandbagging' | 'accurate' | 'overreaching' {
  if (bias >= 1.5) return 'sandbagging';
  if (bias <= -1.5) return 'overreaching';
  return 'accurate';
}

/**
 * Get color for bias display
 */
export function getBiasColor(bias: number): 'green' | 'yellow' | 'red' {
  const level = getBiasLevel(bias);
  switch (level) {
    case 'accurate':
      return 'green';
    case 'sandbagging':
      return 'yellow';
    case 'overreaching':
      return 'red';
  }
}

/**
 * Convert RepsInTank to numeric RIR
 */
export function repsInTankToRIR(rit: RepsInTank): number {
  switch (rit) {
    case 4: return 4;
    case 2: return 2.5; // Represents 2-3 range
    case 1: return 1;
    case 0: return 0;
  }
}

/**
 * Format bias for display
 */
export function formatBias(bias: number): string {
  if (bias >= 0) {
    return `+${bias.toFixed(1)} reps`;
  }
  return `${bias.toFixed(1)} reps`;
}

/**
 * Create a calibration set log from workout data
 */
export function createCalibrationSetLog(
  exerciseId: string,
  exerciseName: string,
  weight: number,
  reps: number,
  reportedRIR: number,
  wasAMRAP: boolean,
  prescribedMin: number,
  prescribedMax: number | null = null,
  restTimeSeconds?: number
): CalibrationSetLog {
  return {
    exerciseId,
    exerciseName,
    weight,
    prescribedReps: { min: prescribedMin, max: prescribedMax },
    actualReps: reps,
    reportedRIR,
    wasAMRAP,
    restTimeSeconds,
    timestamp: new Date(),
  };
}
