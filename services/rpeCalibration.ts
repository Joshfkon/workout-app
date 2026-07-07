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
import {
  ENHANCED_RECOVERY_MULTIPLIER,
  AMRAP_DECAY_CONSTANTS,
} from '@/services/shared/fatigueConstants';

// ============================================
// CONSTANTS
// ============================================

/** Overall bias (reps) at or above which sandbagging is flagged (natural athlete). */
export const SANDBAGGING_BIAS_THRESHOLD = 2;

/** Per-exercise bias (reps) at or above which the display level reads 'sandbagging'. */
export const SANDBAGGING_DISPLAY_THRESHOLD = 1.5;

/** Per-exercise bias (reps) at or below which the display level reads 'overreaching'. */
export const OVERREACHING_DISPLAY_THRESHOLD = -1.5;

/**
 * Adjusted bias within +/- this many reps reads "well calibrated" — honest
 * self-report noise, never flagged in either direction.
 */
export const WELL_CALIBRATED_DEAD_ZONE = 1;

/** Data points needed before any verdict (medium confidence) is rendered. */
export const MIN_DATA_POINTS_FOR_VERDICT = 3;

/**
 * How the predicted max reps (and therefore the bias) were computed.
 * - 'naive_v1': raw average of reps + reported RIR from recent sets — NOT
 *   fatigue-adjusted, systematically misreads intra-session rep decay as
 *   overestimation.
 * - 'fatigue_adjusted_v2': prediction decayed per intervening working set
 *   (AMRAP_DECAY_CONSTANTS) before comparing to the AMRAP result.
 */
export type CalibrationMethod = 'naive_v1' | 'fatigue_adjusted_v2';

/** Method used for all newly computed calibration records. */
export const CURRENT_CALIBRATION_METHOD: CalibrationMethod = 'fatigue_adjusted_v2';

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
  /**
   * Expected AMRAP reps used for display and bias. Under
   * 'fatigue_adjusted_v2' this is the fatigue-adjusted expectation; the
   * naive value is kept in rawPredictedMaxReps for auditability.
   */
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
  /** Naive (non-fatigue-adjusted) prediction: avg of reps + reported RIR. */
  rawPredictedMaxReps?: number;
  /** Absent on legacy records — treated as 'naive_v1' and excluded from the rolling bias. */
  method?: CalibrationMethod;
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
// FATIGUE-ADJUSTED PREDICTION
// ============================================

export interface FatigueAdjustedPrediction {
  /** Naive prediction: average of reps + reported RIR across comparison sets. */
  rawPredictedMaxReps: number;
  /** Prediction decayed for the working sets between each source set and the AMRAP. */
  fatigueAdjustedMaxReps: number;
}

/**
 * 1-based position of a set within its own session, counting same-exercise
 * working (non-AMRAP) sets up to and including it. Sessions are reconstructed
 * from timestamps (sets within SAME_SESSION_WINDOW_MS of each other).
 */
function setPositionInSession(set: CalibrationSetLog, sameExerciseSets: CalibrationSetLog[]): number {
  const t = set.timestamp.getTime();
  return sameExerciseSets.filter(s =>
    !s.wasAMRAP &&
    s.timestamp.getTime() <= t &&
    t - s.timestamp.getTime() <= AMRAP_DECAY_CONSTANTS.SAME_SESSION_WINDOW_MS
  ).length;
}

/**
 * Estimate the rest interval (seconds) in the AMRAP's session. Prefers
 * explicit restTimeSeconds; falls back to the median gap between consecutive
 * same-session set completions minus a nominal set duration. Returns null
 * when nothing usable exists (treated as reference rest).
 */
function estimateSessionRestSeconds(
  amrapSet: CalibrationSetLog,
  sameSessionSets: CalibrationSetLog[]
): number | null {
  const explicit = [...sameSessionSets, amrapSet]
    .map(s => s.restTimeSeconds)
    .filter((r): r is number => typeof r === 'number' && r > 0);
  if (explicit.length > 0) {
    return explicit.reduce((a, b) => a + b, 0) / explicit.length;
  }

  const times = [...sameSessionSets.map(s => s.timestamp.getTime()), amrapSet.timestamp.getTime()]
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gapSeconds = (times[i] - times[i - 1]) / 1000;
    if (gapSeconds > 0) {
      gaps.push(Math.max(0, gapSeconds - AMRAP_DECAY_CONSTANTS.NOMINAL_SET_DURATION_SECONDS));
    }
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Decay multiplier for the estimated rest interval (1 at reference rest). */
function restDecayMultiplier(restSeconds: number | null): number {
  if (restSeconds === null) return 1;
  if (restSeconds <= AMRAP_DECAY_CONSTANTS.SHORT_REST_THRESHOLD_SECONDS) {
    return AMRAP_DECAY_CONSTANTS.SHORT_REST_MULTIPLIER;
  }
  if (restSeconds >= AMRAP_DECAY_CONSTANTS.LONG_REST_THRESHOLD_SECONDS) {
    return AMRAP_DECAY_CONSTANTS.LONG_REST_MULTIPLIER;
  }
  return 1;
}

/**
 * Compute both the naive and the fatigue-adjusted AMRAP prediction.
 *
 * Each comparison set's "reps + reported RIR" implies the max AT THAT SET'S
 * POSITION in its session — the report already embeds the fatigue of getting
 * TO that set, but not the cost of performing it or of any set after it.
 * The expectation for the AMRAP is therefore decayed by one step per
 * position difference: a prediction sourced from set N-1 decays at least one
 * step for an AMRAP at set N (the off-by-one the naive method missed).
 *
 * Cross-session sources use the same position algebra (their implied max
 * reflects their own within-session position), so a fresh AMRAP compared to
 * fresh sets from last week decays by zero steps and stays naive.
 *
 * Enhanced athlete mode divides per-step decay by ENHANCED_RECOVERY_MULTIPLIER:
 * faster inter-set recovery means less expected rep loss, so a recovered
 * enhanced user isn't misread in either direction. Sandbagging detection
 * reads the biases produced here, so both verdicts share these constants.
 */
export function computeFatigueAdjustedPrediction(
  amrapSet: CalibrationSetLog,
  comparisonSets: CalibrationSetLog[],
  sameExerciseSets: CalibrationSetLog[],
  enhancedAthleteMode: boolean = false
): FatigueAdjustedPrediction {
  const amrapTime = amrapSet.timestamp.getTime();
  const sameSessionSets = sameExerciseSets.filter(s =>
    !s.wasAMRAP &&
    s.timestamp.getTime() < amrapTime &&
    amrapTime - s.timestamp.getTime() <= AMRAP_DECAY_CONSTANTS.SAME_SESSION_WINDOW_MS
  );
  const amrapPosition = sameSessionSets.length + 1;
  const restMultiplier = restDecayMultiplier(estimateSessionRestSeconds(amrapSet, sameSessionSets));
  const recoveryDivisor = enhancedAthleteMode ? ENHANCED_RECOVERY_MULTIPLIER : 1;

  let rawSum = 0;
  let adjustedSum = 0;
  for (const set of comparisonSets) {
    const impliedMax = set.actualReps + set.reportedRIR;
    const sourcePosition = setPositionInSession(set, sameExerciseSets);
    const interveningSets = Math.max(0, amrapPosition - sourcePosition);

    const decayPerSet =
      Math.min(
        AMRAP_DECAY_CONSTANTS.MAX_DECAY_PER_SET,
        Math.max(
          AMRAP_DECAY_CONSTANTS.MIN_DECAY_PER_SET,
          AMRAP_DECAY_CONSTANTS.DECAY_RATE_PER_SET * impliedMax
        )
      ) * restMultiplier / recoveryDivisor;
    const totalDecay = Math.min(AMRAP_DECAY_CONSTANTS.MAX_TOTAL_DECAY, interveningSets * decayPerSet);

    rawSum += impliedMax;
    adjustedSum += Math.max(1, impliedMax - totalDecay);
  }

  const n = Math.max(1, comparisonSets.length);
  return {
    rawPredictedMaxReps: rawSum / n,
    fatigueAdjustedMaxReps: adjustedSum / n,
  };
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
  private readonly enhancedAthleteMode: boolean;

  constructor(
    initialHistory: CalibrationSetLog[] = [],
    initialCalibrations: CalibrationResult[] = [],
    options: { enhancedAthleteMode?: boolean } = {}
  ) {
    this.setHistory = initialHistory.slice(-this.maxHistorySize);
    this.enhancedAthleteMode = options.enhancedAthleteMode === true;
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
        rawPredictedMaxReps: amrapSet.actualReps,
        method: CURRENT_CALIBRATION_METHOD,
      };
      this.calibrationResults.set(key, result);
      return result;
    }

    // What their RIR reports predicted (8 reps @ RIR 3 implies a max of 11),
    // decayed for the working sets performed between each report and the
    // AMRAP — an AMRAP done as set 4 is compared to set-4 capacity, not to
    // the fresher capacity earlier reports implied.
    const sameExerciseSets = this.setHistory.filter(
      s => s.exerciseName.toLowerCase() === key && s.timestamp <= amrapSet.timestamp
    );
    const { rawPredictedMaxReps, fatigueAdjustedMaxReps } = computeFatigueAdjustedPrediction(
      amrapSet,
      recentSets,
      sameExerciseSets,
      this.enhancedAthleteMode
    );

    // Bias = actual - fatigue-adjusted expectation
    // Positive bias = they could do more than they thought (sandbagging)
    const bias = amrapSet.actualReps - fatigueAdjustedMaxReps;
    const confidenceLevel: CalibrationResult['confidenceLevel'] =
      recentSets.length >= 6 ? 'high' : recentSets.length >= MIN_DATA_POINTS_FOR_VERDICT ? 'medium' : 'low';

    const result: CalibrationResult = {
      exerciseName: amrapSet.exerciseName,
      predictedMaxReps: Math.round(fatigueAdjustedMaxReps * 10) / 10,
      actualMaxReps: amrapSet.actualReps,
      bias: Math.round(bias * 10) / 10,
      biasInterpretation: interpretBias(bias, confidenceLevel, recentSets.length),
      confidenceLevel,
      lastCalibrated: amrapSet.timestamp,
      dataPoints: recentSets.length,
      rawPredictedMaxReps: Math.round(rawPredictedMaxReps * 10) / 10,
      method: CURRENT_CALIBRATION_METHOD,
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
    const allCalibrations = Array.from(this.calibrationResults.values());

    // Legacy (naive-method) records were computed without fatigue adjustment
    // and would drag the average toward false overestimation — they are
    // excluded, never silently mixed. Old points recompute under the new
    // method when the engine replays raw set history; records restored
    // without their inputs simply expire from the rolling bias.
    const calibrations = allCalibrations.filter(
      c => (c.method ?? 'naive_v1') === CURRENT_CALIBRATION_METHOD
    );

    if (calibrations.length === 0) {
      return {
        overallBias: 0,
        exerciseSpecificBias: new Map(),
        sandbaggingDetected: false,
        overreachingDetected: false,
        recommendation: allCalibrations.length > 0
          ? 'Your previous calibration data used an older method. Complete new AMRAP sets to recalibrate.'
          : 'Complete some AMRAP sets to calibrate your RPE perception.',
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

    // AMRAP predictions come from prior sets performed under accumulated
    // weekly fatigue. Enhanced athletes rebound from that fatigue faster
    // (ENHANCED_RECOVERY_MULTIPLIER), so a fresh AMRAP legitimately beats
    // those predictions by more — the sandbagging threshold scales up
    // accordingly, or genuinely-recovered sessions get flagged.
    const sandbagThreshold =
      SANDBAGGING_BIAS_THRESHOLD * (this.enhancedAthleteMode ? ENHANCED_RECOVERY_MULTIPLIER : 1);
    const sandbaggingDetected = overallBias >= sandbagThreshold;
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

    // No adjustment from missing data, low confidence, legacy-method records
    // (naive bias is polluted by intra-session fatigue), or bias inside the
    // well-calibrated dead zone (honest self-report noise).
    if (
      !calibration ||
      calibration.confidenceLevel === 'low' ||
      (calibration.method ?? 'naive_v1') !== CURRENT_CALIBRATION_METHOD ||
      Math.abs(calibration.bias) <= WELL_CALIBRATED_DEAD_ZONE
    ) {
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

    for (const exerciseName of Array.from(allExercises)) {
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
 * Interpret bias into human-readable text, gated by confidence.
 *
 * Low confidence is informational only — no judgment. Medium hedges
 * ("early pattern suggests"). Strong verdicts — including the "closer to
 * failure than you realize" warning, reserved for bias <= -2 — require
 * high confidence.
 */
function interpretBias(
  bias: number,
  confidenceLevel: 'low' | 'medium' | 'high',
  dataPoints: number
): string {
  if (confidenceLevel === 'low') {
    const needed = Math.max(1, MIN_DATA_POINTS_FOR_VERDICT - dataPoints);
    return `Still gathering data — need ${needed} more AMRAP ${needed === 1 ? 'set' : 'sets'} before drawing conclusions.`;
  }

  // Well-calibrated dead zone: within honest self-report noise.
  if (Math.abs(bias) <= WELL_CALIBRATED_DEAD_ZONE) {
    return confidenceLevel === 'high'
      ? 'Well calibrated — your RIR estimates match your actual performance.'
      : 'Looking well calibrated so far — your RIR estimates match your fatigue-adjusted performance.';
  }

  if (bias > 0) {
    if (confidenceLevel === 'medium') {
      return 'Early pattern suggests you may have more reps in the tank than you report — a few more AMRAP sets will confirm.';
    }
    if (bias >= 4) {
      return 'Significant sandbagging - you had 4+ more reps than you thought';
    }
    if (bias >= 2) {
      return 'Moderate sandbagging - you\'re stopping 2-3 reps earlier than necessary';
    }
    return 'Slight underestimate — you occasionally stop a rep or two before you need to.';
  }

  // bias < -WELL_CALIBRATED_DEAD_ZONE
  if (confidenceLevel === 'medium') {
    return 'Early pattern suggests your RIR estimates may run slightly optimistic — worth watching, but more data is needed.';
  }
  if (bias <= -2) {
    return 'Significant overestimate - be careful, you\'re closer to failure than you realize';
  }
  return 'You tend to push slightly harder than you report. That\'s fine — just keep an eye on recovery.';
}

// ============================================
// CONFIDENCE-GATED VERDICT DISPLAY
// ============================================

export type CalibrationVerdictLevel = 'calibrating' | 'accurate' | 'sandbagging' | 'overreaching';

export interface CalibrationVerdict {
  level: CalibrationVerdictLevel;
  /** neutral = no judgment (low confidence), tentative = hedged, strong = full verdict. */
  severity: 'neutral' | 'tentative' | 'strong';
  badgeLabel: string;
  badgeVariant: 'default' | 'success' | 'warning' | 'danger';
  color: 'gray' | 'green' | 'yellow' | 'red';
  message: string;
}

/**
 * Single source of truth for how a calibration result is judged in the UI.
 * Gates the JUDGMENT by confidence — the raw numbers (predicted/actual/bias)
 * should always be shown alongside, never hidden.
 */
export function getCalibrationVerdict(
  result: Pick<CalibrationResult, 'bias' | 'confidenceLevel' | 'dataPoints'>,
  enhancedAthleteMode?: boolean
): CalibrationVerdict {
  const message = interpretBias(result.bias, result.confidenceLevel, result.dataPoints);

  if (result.confidenceLevel === 'low') {
    return {
      level: 'calibrating',
      severity: 'neutral',
      badgeLabel: 'Calibrating…',
      badgeVariant: 'default',
      color: 'gray',
      message,
    };
  }

  const severity = result.confidenceLevel === 'high' ? 'strong' : 'tentative';
  const level = getBiasLevel(result.bias, enhancedAthleteMode);

  if (level === 'accurate') {
    return { level, severity, badgeLabel: 'Well Calibrated', badgeVariant: 'success', color: 'green', message };
  }
  if (level === 'sandbagging') {
    return {
      level,
      severity,
      badgeLabel: severity === 'strong' ? 'Sandbagging' : 'Possibly Sandbagging',
      badgeVariant: 'warning',
      color: 'yellow',
      message,
    };
  }
  // Overreaching: red + alarming label only at high confidence.
  return {
    level,
    severity,
    badgeLabel: severity === 'strong' ? 'Pushing Too Hard' : 'Possibly Overreaching',
    badgeVariant: severity === 'strong' ? 'danger' : 'warning',
    color: severity === 'strong' ? 'red' : 'yellow',
    message,
  };
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
 * Get bias level category for display.
 * Pass enhancedAthleteMode so the sandbagging threshold uses the enhanced
 * recovery constants — enhanced athletes legitimately beat fatigued-week
 * predictions by more (see analyzeOverallBias).
 */
export function getBiasLevel(
  bias: number,
  enhancedAthleteMode?: boolean
): 'sandbagging' | 'accurate' | 'overreaching' {
  const sandbagThreshold =
    SANDBAGGING_DISPLAY_THRESHOLD * (enhancedAthleteMode ? ENHANCED_RECOVERY_MULTIPLIER : 1);
  if (bias >= sandbagThreshold) return 'sandbagging';
  if (bias <= OVERREACHING_DISPLAY_THRESHOLD) return 'overreaching';
  return 'accurate';
}

/**
 * Get color for bias display
 */
export function getBiasColor(bias: number, enhancedAthleteMode?: boolean): 'green' | 'yellow' | 'red' {
  const level = getBiasLevel(bias, enhancedAthleteMode);
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
    case 3: return 3;
    case 2: return 2;
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
