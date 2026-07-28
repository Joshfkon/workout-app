/**
 * Adaptive Volume & Recovery Estimation System
 *
 * Learns user's personalized Maximum Recoverable Volume (MRV) by tracking:
 * - Performance progression (e1RM changes)
 * - RPE/RIR drift (same weights feeling harder over time)
 * - Form quality degradation
 * - Recovery markers correlation with performance
 *
 * Rather than using generic volume recommendations, this system empirically
 * determines each user's individual recovery capacity over multiple mesocycles.
 */

import type {
  MuscleGroup,
  FormRating,
  RepsInTank,
  SetLog,
  DailyCheckIn,
  WorkoutSession,
  Rating,
} from '@/types/schema';
import { MUSCLE_GROUPS } from '@/types/schema';
import { ENHANCED_MRV_MULTIPLIERS, ENHANCED_MAV_MULTIPLIER, type CoarseMuscle } from '@/services/volumeBands';
import { estimateE1RM } from '@/lib/utils';
import { uniformSeriesSlope } from '@/services/shared/trend';

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * Weekly volume data aggregated per muscle group
 */
export interface MuscleVolumeData {
  id: string;
  muscle: MuscleGroup;
  weekNumber: number;
  mesocycleId: string;

  // Volume metrics
  totalSets: number;
  workingSets: number;           // Excluding warmups
  effectiveSets: number;         // Sets at RPE 7+ with clean/some_breakdown form (legacy binary count)
  /**
   * RIR-weighted "Effective Volume" (Σ EFFECTIVE_VOLUME_WEIGHTS[rir] over the
   * same working sets — see services/effectiveVolume). Optional: rows rebuilt
   * from stored weekly aggregates have no per-set RIR and omit it; consumers
   * fall back to raw workingSets. Distinct from the legacy binary
   * `effectiveSets` above, which is unchanged.
   */
  effectiveVolumeSets?: number;

  // Performance metrics
  totalVolume: number;           // Sets × reps × weight
  averageRIR: number;
  averageFormScore: number;      // 1.0 = clean, 0.5 = some_breakdown, 0 = ugly

  // Progression tracking
  exercisePerformance: ExerciseWeekPerformance[];
}

/**
 * Performance data for a specific exercise within a week
 */
export interface ExerciseWeekPerformance {
  id: string;
  exerciseId: string;
  exerciseName: string;

  // Best set of the week
  bestSetWeight: number;
  bestSetReps: number;
  bestSetRIR: RepsInTank;
  bestSetForm: FormRating;

  // Estimated 1RM for comparison
  estimated1RM: number;

  // Compared to previous week
  e1rmChange: number | null;     // Positive = progress, negative = regression
  rirDrift: number | null;       // Positive = felt harder at same weight
}

/**
 * Complete analysis of a mesocycle
 */
export interface MesocycleAnalysis {
  id: string;
  mesocycleId: string;
  startDate: string;
  endDate: string;
  weeks: number;

  // Volume prescribed
  muscleVolumes: Record<MuscleGroup, {
    avgWeeklySets: number;
    totalSets: number;
    effectiveSets: number;
  }>;

  // Outcomes per muscle
  muscleOutcomes: Record<MuscleGroup, MuscleOutcome>;

  // Overall assessment
  overallRecovery: 'under_recovered' | 'well_recovered' | 'under_stimulated';
}

/**
 * Volume verdict for a specific muscle group
 */
export type VolumeVerdict = 'too_high' | 'optimal' | 'too_low' | 'insufficient_data';

/**
 * Analysis outcome for a muscle group after a mesocycle
 */
export interface MuscleOutcome {
  muscle: MuscleGroup;
  weeklySets: number;

  // Progression analysis
  progressionRate: number;        // Average weekly e1RM change (%)
  progressionTrend: ProgressionTrend;

  // Fatigue indicators
  rirDrift: number;               // How much harder same weights felt by end
  formDegradation: number;        // Form score change over meso

  // Recovery correlation
  recoveryCorrelation: number;    // -1 to 1: does low recovery predict bad sessions?

  // Verdict
  volumeVerdict: VolumeVerdict;
  confidence: number;             // 0-100

  // Recommendation
  suggestedAdjustment: number;    // Sets to add/remove next meso
}

export type ProgressionTrend = 'improving' | 'maintaining' | 'declining';

/**
 * Subjective per-muscle feedback aggregated over a mesocycle from the
 * session_muscle_feedback chip rows (pump / workload / next-session soreness).
 * These are additional INPUTS to `determineVolumeVerdict`'s existing scoring —
 * NOT a parallel adjustment path. RP semantics:
 *  - chronic low pump + easy workload at current volume → MEV is likely above
 *    current (contributes to the too_low score)
 *  - "too much" workload / still-sore-at-next-session pattern → MRV is likely
 *    below current (contributes to the too_high score)
 */
export interface SubjectiveVolumeSignals {
  /** Sessions in the meso with at least one rating for this muscle. */
  ratedSessions: number;
  /** Sessions where pump was rated low (0-1 on the 0-3 scale). */
  lowPumpSessions: number;
  /** Sessions where workload was rated too easy (0). */
  easyWorkloadSessions: number;
  /** Sessions where workload was rated too much (3). */
  tooMuchWorkloadSessions: number;
  /** Sessions the muscle was still sore going into the NEXT session (soreness 3). */
  stillSoreSessions: number;
}

/**
 * Score contributions of the subjective signals, capped so chip answers can
 * nudge but never dominate the performance-derived indicators (each side of
 * `determineVolumeVerdict`'s scoring needs >= 50 to flip a verdict; subjective
 * evidence alone maxes out at 20).
 */
export const SUBJECTIVE_SIGNAL_MAX_SCORE = 20;

export function subjectiveVerdictNudges(
  signals: SubjectiveVolumeSignals | undefined
): { tooHighScore: number; tooLowScore: number } {
  if (!signals || signals.ratedSessions <= 0) {
    return { tooHighScore: 0, tooLowScore: 0 };
  }

  // Too high: recovery debt the user actually felt.
  const overreachEvents = signals.tooMuchWorkloadSessions + signals.stillSoreSessions;
  const tooHighScore = Math.min(
    SUBJECTIVE_SIGNAL_MAX_SCORE,
    overreachEvents >= 2 ? 20 : overreachEvents === 1 ? 10 : 0
  );

  // Too low: chronic low pump AND easy workload — both required, per RP the
  // combination (not either alone) suggests the stimulus isn't landing.
  const majority = Math.max(2, Math.ceil(signals.ratedSessions / 2));
  const chronicLowPump = signals.lowPumpSessions >= majority;
  const easyWorkload = signals.easyWorkloadSessions >= majority;
  const tooLowScore = Math.min(
    SUBJECTIVE_SIGNAL_MAX_SCORE,
    chronicLowPump && easyWorkload ? 20 : chronicLowPump && signals.easyWorkloadSessions > 0 ? 10 : 0
  );

  return { tooHighScore, tooLowScore };
}

/**
 * Fold session_muscle_feedback rows (already collapsed to the 13-group
 * MuscleGroup vocabulary this learner uses) into per-muscle
 * SubjectiveVolumeSignals. Ratings use the 0-3 scales from types/schema.ts:
 * pump 0 none…3 extreme; workload 0 too easy…3 too much; soreness 0 none…3
 * still sore at next session.
 *
 * Counters are per SESSION, so rows are first merged per (muscle, session):
 * collapsing standard subdivisions to coarse groups can hand this two rows
 * for one workout (chest_upper + chest_lower → chest), and counting both
 * would let a single session masquerade as a repeated pattern. Within a
 * session, pump keeps the best evidence of stimulus (max) while workload and
 * soreness keep the worst-case recovery signal (max) — mirroring the weekly
 * engine's aggregation semantics.
 */
export function aggregateSubjectiveSignals(
  rows: {
    sessionId: string;
    muscle: MuscleGroup;
    pump: number | null;
    workload: number | null;
    sorenessBefore: number | null;
  }[]
): Partial<Record<MuscleGroup, SubjectiveVolumeSignals>> {
  // 1. Merge rows into one entry per (muscle, session).
  const maxRating = (a: number | null, b: number | null): number | null =>
    a === null ? b : b === null ? a : Math.max(a, b);
  const perMuscleSession = new Map<
    string,
    { muscle: MuscleGroup; pump: number | null; workload: number | null; sorenessBefore: number | null }
  >();
  for (const row of rows) {
    if (row.pump === null && row.workload === null && row.sorenessBefore === null) continue;
    const key = `${row.muscle}|${row.sessionId}`;
    const merged = perMuscleSession.get(key);
    if (!merged) {
      perMuscleSession.set(key, {
        muscle: row.muscle,
        pump: row.pump,
        workload: row.workload,
        sorenessBefore: row.sorenessBefore,
      });
    } else {
      merged.pump = maxRating(merged.pump, row.pump);
      merged.workload = maxRating(merged.workload, row.workload);
      merged.sorenessBefore = maxRating(merged.sorenessBefore, row.sorenessBefore);
    }
  }

  // 2. Count sessions per muscle.
  const byMuscle: Partial<Record<MuscleGroup, SubjectiveVolumeSignals>> = {};
  perMuscleSession.forEach((sessionEntry) => {
    const entry = (byMuscle[sessionEntry.muscle] ??= {
      ratedSessions: 0,
      lowPumpSessions: 0,
      easyWorkloadSessions: 0,
      tooMuchWorkloadSessions: 0,
      stillSoreSessions: 0,
    });
    entry.ratedSessions += 1;
    if (sessionEntry.pump !== null && sessionEntry.pump <= 1) entry.lowPumpSessions += 1;
    if (sessionEntry.workload === 0) entry.easyWorkloadSessions += 1;
    if (sessionEntry.workload === 3) entry.tooMuchWorkloadSessions += 1;
    if (sessionEntry.sorenessBefore === 3) entry.stillSoreSessions += 1;
  });
  return byMuscle;
}

/**
 * Confidence level for volume estimates
 */
export type VolumeConfidence = 'low' | 'medium' | 'high';

/**
 * Per-muscle tolerance data learned over time
 */
export interface MuscleTolerance {
  estimatedMRV: number;           // Max Recoverable Volume (sets/week)
  estimatedMEV: number;           // Minimum Effective Volume
  confidence: VolumeConfidence;
  dataPoints: number;             // Mesocycles of data
  lastUpdated: Date;
}

/**
 * User's personalized volume profile learned over time
 */
export interface UserVolumeProfile {
  userId: string;
  updatedAt: Date;

  // Per-muscle learned tolerances
  muscleTolerance: Record<MuscleGroup, MuscleTolerance>;

  // Global modifiers
  globalRecoveryMultiplier: number;   // 0.8 = recovers slower, 1.2 = recovers faster

  // Context flags
  isEnhanced: boolean;                // PEDs increase recovery capacity
  trainingAge: 'novice' | 'intermediate' | 'advanced';
}

/**
 * Alert about fatigue accumulation
 */
export type FatigueAlertType = 'approaching_mrv' | 'rir_drift' | 'form_degradation';
export type FatigueAlertSeverity = 'warning' | 'alert';

export interface FatigueAlert {
  muscle: MuscleGroup;
  type: FatigueAlertType;
  severity: FatigueAlertSeverity;
  message: string;
  suggestion: string;
}

/**
 * RIR drift analysis result
 */
export interface RirDriftResult {
  drift: number;
  significance: 'normal' | 'elevated' | 'concerning';
}

/**
 * Form trend analysis result
 */
export interface FormTrendResult {
  avgDegradation: number;
  trend: 'improving' | 'stable' | 'degrading';
}

/**
 * Recovery correlation result
 */
export interface RecoveryCorrelationResult {
  correlation: number;
  avgRecoveryScore: number;
  significance: 'insufficient_data' | 'weak' | 'moderate' | 'strong';
  interpretation: string;
}

/**
 * Progression analysis result
 */
export interface ProgressionAnalysis {
  status: 'insufficient_data' | 'analyzed';
  avgProgressionRate?: number;
  progressionTrend?: ProgressionTrend;
  totalRirDrift?: number;
  avgFormDegradation?: number;
  weekCount?: number;
}

// ============================================
// BASELINE VOLUME RECOMMENDATIONS (RESEARCH-BASED)
// ============================================

/**
 * Research-based starting volume recommendations per muscle group.
 * Based on work by Dr. Mike Israetel, Dr. Brad Schoenfeld, and others.
 */
export const BASELINE_VOLUME_RECOMMENDATIONS: Record<MuscleGroup, {
  mev: number;      // Minimum Effective Volume
  mrv: number;      // Maximum Recoverable Volume
  optimal: number;  // Middle ground starting point
}> = {
  chest:      { mev: 8,  mrv: 22, optimal: 12 },
  back:       { mev: 8,  mrv: 25, optimal: 14 },
  shoulders:  { mev: 6,  mrv: 22, optimal: 12 },
  biceps:     { mev: 4,  mrv: 20, optimal: 10 },
  triceps:    { mev: 4,  mrv: 18, optimal: 8 },
  quads:      { mev: 6,  mrv: 20, optimal: 12 },
  hamstrings: { mev: 4,  mrv: 16, optimal: 10 },
  glutes:     { mev: 4,  mrv: 16, optimal: 8 },
  calves:     { mev: 6,  mrv: 20, optimal: 12 },
  abs:        { mev: 0,  mrv: 20, optimal: 8 },
  traps:      { mev: 0,  mrv: 16, optimal: 6 },
  forearms:   { mev: 0,  mrv: 12, optimal: 4 },
  adductors:  { mev: 0,  mrv: 12, optimal: 4 },
};

/**
 * Adjust baseline volume recommendations based on training status
 */
export function getAdjustedBaseline(
  muscle: MuscleGroup,
  trainingAge: 'novice' | 'intermediate' | 'advanced',
  isEnhanced: boolean
): { mev: number; mrv: number; optimal: number } {
  const base = BASELINE_VOLUME_RECOMMENDATIONS[muscle];

  let multiplier = 1.0;

  // Training age adjustments
  if (trainingAge === 'novice') {
    multiplier = 0.7;  // Novices need less volume
  } else if (trainingAge === 'advanced') {
    multiplier = 1.15; // Advanced may need more
  }

  // Enhanced athletes: per-muscle-TIERED ceiling scaling from the single
  // profile derivation (volumeBands) — MEV never rises (invariant), the MAV-
  // like 'optimal' shifts at most +10%, and the MRV scales by the muscle's
  // tier (isolation-friendly muscles most, axial-heavy least).
  const mevScale = 1;
  const optimalScale = isEnhanced ? ENHANCED_MAV_MULTIPLIER : 1;
  const mrvScale = isEnhanced ? ENHANCED_MRV_MULTIPLIERS[muscle as CoarseMuscle] ?? 1 : 1;

  return {
    mev: Math.round(base.mev * multiplier * mevScale),
    mrv: Math.round(base.mrv * multiplier * mrvScale),
    optimal: Math.round(base.optimal * multiplier * optimalScale)
  };
}

/**
 * Volume-counter version. Bumped when the set counter changes in a way that
 * invalidates learned MEV/MRV thresholds. v2 = the shared 0.5-secondary-credit,
 * reachability-gated counter. Profiles stored below this version are reset to
 * research baselines and relearn under the new counter (see the reset migration
 * and useAdaptiveVolume).
 */
export const VOLUME_COUNTER_VERSION = 2;

/**
 * Reset a profile's learned tolerances to research baselines (dataPoints 0,
 * confidence low) while preserving the user's context (training age, enhanced
 * flag, recovery multiplier). Used when migrating a profile onto a new counter:
 * the stale primary-only-calibrated thresholds are discarded and relearning
 * restarts from defaults.
 */
export function resetVolumeProfileToBaseline(profile: UserVolumeProfile): UserVolumeProfile {
  const baseline = createInitialVolumeProfile(profile.userId, profile.trainingAge, profile.isEnhanced);
  return {
    ...baseline,
    globalRecoveryMultiplier: profile.globalRecoveryMultiplier,
  };
}

/**
 * Create initial user volume profile with research-based defaults
 */
export function createInitialVolumeProfile(
  userId: string,
  trainingAge: 'novice' | 'intermediate' | 'advanced',
  isEnhanced: boolean = false
): UserVolumeProfile {
  const muscleTolerance: Record<MuscleGroup, MuscleTolerance> = {} as Record<MuscleGroup, MuscleTolerance>;

  const muscles: readonly MuscleGroup[] = MUSCLE_GROUPS;

  for (const muscle of muscles) {
    const baseline = getAdjustedBaseline(muscle, trainingAge, isEnhanced);
    muscleTolerance[muscle] = {
      estimatedMRV: baseline.mrv,
      estimatedMEV: baseline.mev,
      confidence: 'low',
      dataPoints: 0,
      lastUpdated: new Date(),
    };
  }

  return {
    userId,
    updatedAt: new Date(),
    muscleTolerance,
    globalRecoveryMultiplier: 1.0,
    isEnhanced,
    trainingAge,
  };
}

/**
 * Set enhanced-athlete status on an existing profile, rescaling every
 * muscle's MEV/MRV estimates so the flag change takes effect immediately
 * (baselines are otherwise only adjusted at profile creation). Learned
 * estimates are scaled rather than reset so accumulated data is preserved.
 * Scaling uses the single profile derivation's per-muscle MRV tiers
 * (volumeBands): the ceiling moves, the floor (MEV) NEVER does. Toggling off
 * divides by the same factor, so on→off→on round-trips instead of
 * compounding.
 * Returns the profile unchanged if the status isn't actually changing.
 */
export function setEnhancedStatus(
  profile: UserVolumeProfile,
  isEnhanced: boolean
): UserVolumeProfile {
  if (profile.isEnhanced === isEnhanced) return profile;

  const muscleTolerance = {} as Record<MuscleGroup, MuscleTolerance>;
  for (const [muscle, tolerance] of Object.entries(profile.muscleTolerance)) {
    const tier = ENHANCED_MRV_MULTIPLIERS[muscle as CoarseMuscle] ?? 1;
    const mrvScale = isEnhanced ? tier : 1 / tier;
    muscleTolerance[muscle as MuscleGroup] = {
      ...tolerance,
      estimatedMEV: tolerance.estimatedMEV, // MEV invariant: never scaled
      estimatedMRV: Math.round(tolerance.estimatedMRV * mrvScale),
      lastUpdated: new Date(),
    };
  }

  return {
    ...profile,
    isEnhanced,
    muscleTolerance,
    updatedAt: new Date(),
  };
}

// ============================================
// RESEARCH COMPARISON
// ============================================

export type ResearchComparisonStatus = 'lower' | 'average' | 'higher';

/**
 * One muscle's personalized MEV–MRV band compared against the unadjusted
 * research baseline, with the reasons the two differ (or don't).
 */
export interface ResearchComparisonEntry {
  muscle: MuscleGroup;
  status: ResearchComparisonStatus;
  /** The user's personalized band (learned or context-adjusted), sets/week. */
  personalMev: number;
  personalMrv: number;
  /** The raw research baseline band (intermediate, natural), sets/week. */
  researchMev: number;
  researchMrv: number;
  /** Midpoint-vs-midpoint difference, rounded percent (e.g. -30, 0, +15). */
  percentDiff: number;
  /** Human-readable basis for the personalization, most specific first. */
  reasons: string[];
}

export interface ResearchComparison {
  entries: ResearchComparisonEntry[];
  lower: ResearchComparisonEntry[];
  average: ResearchComparisonEntry[];
  higher: ResearchComparisonEntry[];
}

/**
 * A muscle counts as "at average" while its band midpoint is within ±10% of
 * the research midpoint — the training-age multipliers (0.7 / 1.15) and the
 * enhanced-mode scaling both land outside this window, so any deliberate
 * adjustment is classified, while rounding noise is not.
 */
export const RESEARCH_COMPARISON_TOLERANCE = 0.1;

/**
 * Compare a user's personalized volume profile against the unadjusted
 * research baselines, per muscle. Classification compares band midpoints
 * ((MEV+MRV)/2) so a raised ceiling and a raised floor both count toward
 * "higher" without double-weighting either landmark.
 */
export function compareProfileToResearch(profile: UserVolumeProfile): ResearchComparison {
  const entries: ResearchComparisonEntry[] = MUSCLE_GROUPS.map((muscle) => {
    const baseline = BASELINE_VOLUME_RECOMMENDATIONS[muscle];
    const tolerance = profile.muscleTolerance[muscle];
    const personalMev = tolerance?.estimatedMEV ?? baseline.mev;
    const personalMrv = tolerance?.estimatedMRV ?? baseline.mrv;

    const researchMid = (baseline.mev + baseline.mrv) / 2;
    const personalMid = (personalMev + personalMrv) / 2;
    const diff = researchMid > 0 ? (personalMid - researchMid) / researchMid : 0;

    let status: ResearchComparisonStatus = 'average';
    if (diff > RESEARCH_COMPARISON_TOLERANCE) status = 'higher';
    else if (diff < -RESEARCH_COMPARISON_TOLERANCE) status = 'lower';

    const reasons: string[] = [];
    if (tolerance && tolerance.dataPoints > 0) {
      reasons.push(
        `Learned from ${tolerance.dataPoints} mesocycle${tolerance.dataPoints === 1 ? '' : 's'} of your training (${tolerance.confidence} confidence)`
      );
    }
    if (profile.trainingAge === 'novice') {
      reasons.push('Novice training age — research volumes scaled to 70%');
    } else if (profile.trainingAge === 'advanced') {
      reasons.push('Advanced training age — research volumes scaled to 115%');
    }
    if (profile.isEnhanced) {
      reasons.push('Enhanced athlete mode — recoverable-volume ceiling raised');
    }
    if (reasons.length === 0) {
      reasons.push('Research default — personalizes as you complete mesocycles');
    }

    return {
      muscle,
      status,
      personalMev,
      personalMrv,
      researchMev: baseline.mev,
      researchMrv: baseline.mrv,
      percentDiff: Math.round(diff * 100),
      reasons,
    };
  });

  return {
    entries,
    lower: entries.filter((e) => e.status === 'lower'),
    average: entries.filter((e) => e.status === 'average'),
    higher: entries.filter((e) => e.status === 'higher'),
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Calculate form score (0-1 scale)
 */
export function formToScore(form: FormRating): number {
  switch (form) {
    case 'clean': return 1.0;
    case 'some_breakdown': return 0.5;
    case 'ugly': return 0;
  }
}

/**
 * Calculate Estimated 1RM. Delegates to the canonical Epley + RIR estimator in
 * lib/utils (single source of truth).
 */
export function calculateE1RM(weight: number, reps: number, rir: number = 0): number {
  return estimateE1RM(weight, reps, rir);
}

/**
 * Calculate average of an array
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate sum of an array
 */
export function sum(values: number[]): number {
  return values.reduce((s, val) => s + val, 0);
}

/**
 * Slope of a uniformly-spaced aggregate series (per-week rates, form
 * scores), in value units per step. Delegates to the canonical robust
 * estimator (services/shared/trend#uniformSeriesSlope) — index is only a
 * valid x here BECAUSE the callers pass one aggregated value per uniform
 * week; per-session/per-entry series must go through computeTrend with real
 * dates instead.
 */
export function linearRegressionSlope(values: number[]): number {
  return uniformSeriesSlope(values);
}

/**
 * Calculate Pearson correlation coefficient
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;

  const n = x.length;
  const meanX = average(x);
  const meanY = average(y);

  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    numerator += diffX * diffY;
    sumSqX += diffX * diffX;
    sumSqY += diffY * diffY;
  }

  const denominator = Math.sqrt(sumSqX * sumSqY);
  if (denominator === 0) return 0;

  return numerator / denominator;
}

// ============================================
// PROGRESSION TRACKING ALGORITHM
// ============================================

/**
 * Find the best set from a collection (by estimated 1RM)
 */
export function findBestSet(sets: SetLog[]): SetLog | null {
  if (sets.length === 0) return null;

  let bestSet = sets[0];
  let bestE1RM = 0;

  for (const set of sets) {
    if (set.isWarmup) continue;
    const rir = set.feedback?.repsInTank ?? 0;
    const e1rm = calculateE1RM(set.weightKg, set.reps, rir);
    if (e1rm > bestE1RM) {
      bestE1RM = e1rm;
      bestSet = set;
    }
  }

  return bestSet;
}

/**
 * Categorize progression based on week-over-week changes
 */
export function categorizeProgression(rates: number[]): ProgressionTrend {
  if (rates.length === 0) return 'maintaining';

  const avg = average(rates);
  const trend = linearRegressionSlope(rates);

  // Improving: positive average AND non-negative trend
  if (avg > 0.5 && trend >= -0.1) return 'improving';

  // Declining: negative average OR strong negative trend
  if (avg < -0.5 || trend < -0.3) return 'declining';

  return 'maintaining';
}

/**
 * Analyze exercise progression over multiple weeks
 */
export function analyzeExerciseProgression(
  weeklyBestSets: SetLog[][],
  minWeeks: number = 3
): ProgressionAnalysis {
  if (weeklyBestSets.length < minWeeks) {
    return { status: 'insufficient_data' };
  }

  // Calculate best e1RM per week
  interface WeeklyData {
    e1rm: number;
    rir: number;
    form: FormRating;
  }

  const weeklyE1RMs: WeeklyData[] = [];

  for (const weekSets of weeklyBestSets) {
    const bestSet = findBestSet(weekSets);
    if (!bestSet) continue;

    const rir = bestSet.feedback?.repsInTank ?? 0;
    const form = bestSet.feedback?.form ?? 'clean';

    weeklyE1RMs.push({
      e1rm: calculateE1RM(bestSet.weightKg, bestSet.reps, rir),
      rir,
      form,
    });
  }

  if (weeklyE1RMs.length < minWeeks) {
    return { status: 'insufficient_data' };
  }

  // Calculate week-over-week changes
  const progressionRates: number[] = [];
  const rirDrifts: number[] = [];
  const formChanges: number[] = [];

  for (let i = 1; i < weeklyE1RMs.length; i++) {
    const prev = weeklyE1RMs[i - 1];
    const curr = weeklyE1RMs[i];

    // E1RM change (percentage)
    const e1rmChange = ((curr.e1rm - prev.e1rm) / prev.e1rm) * 100;
    progressionRates.push(e1rmChange);

    // RIR drift (same weight feels harder = positive drift)
    const rirDrift = prev.rir - curr.rir;
    rirDrifts.push(rirDrift);

    // Form degradation
    const formChange = formToScore(prev.form) - formToScore(curr.form);
    formChanges.push(formChange);
  }

  return {
    status: 'analyzed',
    avgProgressionRate: average(progressionRates),
    progressionTrend: categorizeProgression(progressionRates),
    totalRirDrift: sum(rirDrifts),
    avgFormDegradation: average(formChanges),
    weekCount: weeklyE1RMs.length,
  };
}

// ============================================
// RIR DRIFT DETECTION
// ============================================

/**
 * Calculate RIR drift over a training block.
 * RIR Drift: When the same weight at the same reps feels significantly
 * harder over a training block, indicating fatigue accumulation.
 */
export function calculateRirDrift(
  muscleData: MuscleVolumeData[]
): RirDriftResult {
  if (muscleData.length < 3) {
    return { drift: 0, significance: 'normal' };
  }

  // Compare first week to last week
  const firstWeek = muscleData[0];
  const lastWeek = muscleData[muscleData.length - 1];

  // Average RIR across exercises
  const drift = firstWeek.averageRIR - lastWeek.averageRIR;

  // Also check mid-point to see if it's progressive
  const midWeek = muscleData[Math.floor(muscleData.length / 2)];
  const isProgressive = midWeek.averageRIR < firstWeek.averageRIR;

  let significance: RirDriftResult['significance'] = 'normal';

  if (drift > 2 || (drift > 1.5 && isProgressive)) {
    significance = 'concerning';
  } else if (drift > 1) {
    significance = 'elevated';
  }

  return { drift, significance };
}

// ============================================
// FORM TREND ANALYSIS
// ============================================

/**
 * Analyze form quality trends over a mesocycle
 */
export function analyzeFormTrend(muscleData: MuscleVolumeData[]): FormTrendResult {
  if (muscleData.length < 2) {
    return { avgDegradation: 0, trend: 'stable' };
  }

  const formScores = muscleData.map(d => d.averageFormScore);
  const slope = linearRegressionSlope(formScores);

  // Degradation is negative slope (form getting worse)
  const avgDegradation = formScores[0] - formScores[formScores.length - 1];

  let trend: FormTrendResult['trend'] = 'stable';
  if (slope < -0.05) {
    trend = 'degrading';
  } else if (slope > 0.05) {
    trend = 'improving';
  }

  return { avgDegradation, trend };
}

// ============================================
// RECOVERY CORRELATION ANALYSIS
// ============================================

interface CheckInWithDate {
  date: string;
  recovery: number;
}

/**
 * Find check-in from same day or day before
 */
function findCheckInBefore(
  checkIns: DailyCheckIn[],
  workoutDate: string,
  maxDaysBefore: number = 1
): DailyCheckIn | null {
  const workoutDateObj = new Date(workoutDate);

  for (const checkIn of checkIns) {
    const checkInDate = new Date(checkIn.date);
    const daysDiff = (workoutDateObj.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff >= 0 && daysDiff <= maxDaysBefore) {
      return checkIn;
    }
  }

  return null;
}

/**
 * Calculate workout performance score based on set completion and quality
 */
function calculateWorkoutPerformance(workout: WorkoutSession): number {
  // Base score from completion percentage
  let score = workout.completionPercent;

  // Adjust based on session RPE (lower is better for this measure)
  if (workout.sessionRpe !== null) {
    const rpeAdjust = (10 - workout.sessionRpe) * 2;
    score += rpeAdjust;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Get recovery score from daily check-in
 */
function getRecoveryScore(checkIn: DailyCheckIn): number {
  // Combine relevant factors
  const factors: number[] = [];

  if (checkIn.sleepQuality) factors.push(checkIn.sleepQuality);
  if (checkIn.energyLevel) factors.push(checkIn.energyLevel);
  if (checkIn.sorenessLevel) factors.push(checkIn.sorenessLevel);
  if (checkIn.moodRating) factors.push(checkIn.moodRating);

  // Invert stress (low stress = high recovery)
  if (checkIn.stressLevel) factors.push(6 - checkIn.stressLevel);

  if (factors.length === 0) return 3; // Neutral default
  return average(factors);
}

/**
 * Correlate daily recovery scores with next-day performance
 */
export function analyzeRecoveryCorrelation(
  checkIns: DailyCheckIn[],
  workouts: WorkoutSession[]
): RecoveryCorrelationResult {
  const pairs: { recovery: number; performance: number }[] = [];

  for (const workout of workouts) {
    if (!workout.completedAt) continue;

    const relevantCheckIn = findCheckInBefore(checkIns, workout.plannedDate, 1);
    if (!relevantCheckIn) continue;

    const recoveryScore = getRecoveryScore(relevantCheckIn);
    const performanceScore = calculateWorkoutPerformance(workout);

    pairs.push({ recovery: recoveryScore, performance: performanceScore });
  }

  if (pairs.length < 8) {
    return {
      correlation: 0,
      avgRecoveryScore: 0,
      significance: 'insufficient_data',
      interpretation: 'Need more data points to analyze recovery patterns.'
    };
  }

  const correlation = pearsonCorrelation(
    pairs.map(p => p.recovery),
    pairs.map(p => p.performance)
  );

  const avgRecovery = average(pairs.map(p => p.recovery));

  let significance: RecoveryCorrelationResult['significance'] = 'weak';
  if (Math.abs(correlation) >= 0.6) {
    significance = 'strong';
  } else if (Math.abs(correlation) >= 0.4) {
    significance = 'moderate';
  }

  return {
    correlation,
    avgRecoveryScore: avgRecovery,
    significance,
    interpretation: interpretRecoveryCorrelation(correlation, avgRecovery)
  };
}

function interpretRecoveryCorrelation(
  correlation: number,
  avgRecovery: number
): string {
  if (avgRecovery < 2.5 && correlation > 0.5) {
    return 'Low recovery is impacting performance. Consider reducing volume.';
  }

  if (avgRecovery >= 3.5 && correlation < 0.3) {
    return 'Recovering well from current volume. May have room to increase.';
  }

  if (avgRecovery >= 2.5 && avgRecovery <= 3.5) {
    return 'Recovery is moderate. Current volume appears sustainable.';
  }

  return 'Insufficient pattern detected.';
}

// ============================================
// MESOCYCLE ANALYSIS & VOLUME VERDICT
// ============================================

interface VerdictResult {
  verdict: VolumeVerdict;
  confidence: number;
  adjustment: number;
}

/**
 * Determine volume verdict for a muscle group
 */
export function determineVolumeVerdict(
  progression: ProgressionAnalysis,
  rirDrift: RirDriftResult,
  formTrend: FormTrendResult,
  currentSets: number,
  tolerance: MuscleTolerance,
  subjective?: SubjectiveVolumeSignals
): VerdictResult {
  if (progression.status === 'insufficient_data') {
    return { verdict: 'insufficient_data', confidence: 0, adjustment: 0 };
  }

  let verdict: VolumeVerdict = 'optimal';
  let adjustment = 0;
  let confidence = 50;

  const subjectiveNudges = subjectiveVerdictNudges(subjective);

  // TOO HIGH indicators:
  // - Declining progression
  // - High RIR drift
  // - Form degradation
  // - Current sets > estimated MRV
  // - Subjective overreach ("too much" workload / still-sore pattern, capped)

  const tooHighScore =
    (progression.progressionTrend === 'declining' ? 30 : 0) +
    (rirDrift.significance === 'concerning' ? 30 : rirDrift.significance === 'elevated' ? 15 : 0) +
    (formTrend.avgDegradation > 0.3 ? 25 : formTrend.avgDegradation > 0.15 ? 10 : 0) +
    (currentSets > tolerance.estimatedMRV ? 15 : 0) +
    subjectiveNudges.tooHighScore;

  // TOO LOW indicators:
  // - Strong progression (leaving gains on table)
  // - No RIR drift (not challenging enough)
  // - Perfect form throughout (could push harder)
  // - Current sets < estimated MEV
  // - Subjective under-stimulus (chronic low pump + easy workload, capped)

  const tooLowScore =
    (progression.progressionTrend === 'improving' && (progression.avgProgressionRate ?? 0) > 2 ? 25 : 0) +
    (rirDrift.drift < 0.3 ? 20 : 0) +
    (formTrend.avgDegradation < 0.05 ? 15 : 0) +
    (currentSets < tolerance.estimatedMEV ? 30 : 0) +
    subjectiveNudges.tooLowScore;

  if (tooHighScore >= 50) {
    verdict = 'too_high';
    adjustment = tooHighScore >= 70 ? -3 : -2;
    confidence = Math.min(90, 50 + tooHighScore);
  } else if (tooLowScore >= 50) {
    verdict = 'too_low';
    adjustment = tooLowScore >= 70 ? 3 : 2;
    confidence = Math.min(90, 50 + tooLowScore);
  } else {
    verdict = 'optimal';
    adjustment = 0;
    confidence = 60 + Math.max(0, 30 - Math.abs(tooHighScore - tooLowScore));
  }

  return { verdict, confidence, adjustment };
}

/**
 * Assess overall recovery based on muscle outcomes
 */
export function assessOverallRecovery(
  muscleOutcomes: Record<MuscleGroup, MuscleOutcome>
): 'under_recovered' | 'well_recovered' | 'under_stimulated' {
  const outcomes = Object.values(muscleOutcomes).filter(
    o => o.volumeVerdict !== 'insufficient_data'
  );

  if (outcomes.length === 0) return 'well_recovered';

  const tooHighCount = outcomes.filter(o => o.volumeVerdict === 'too_high').length;
  const tooLowCount = outcomes.filter(o => o.volumeVerdict === 'too_low').length;

  if (tooHighCount > outcomes.length * 0.3) {
    return 'under_recovered';
  }

  if (tooLowCount > outcomes.length * 0.3) {
    return 'under_stimulated';
  }

  return 'well_recovered';
}

/**
 * Analyze a complete mesocycle and generate muscle outcomes
 */
export function analyzeMesocycle(
  mesoId: string,
  muscleData: Record<MuscleGroup, MuscleVolumeData[]>,
  currentProfile: UserVolumeProfile,
  startDate: string,
  endDate: string,
  subjectiveByMuscle?: Partial<Record<MuscleGroup, SubjectiveVolumeSignals>>
): MesocycleAnalysis {
  const muscleOutcomes: Record<MuscleGroup, MuscleOutcome> = {} as Record<MuscleGroup, MuscleOutcome>;
  const muscleVolumes: MesocycleAnalysis['muscleVolumes'] = {} as MesocycleAnalysis['muscleVolumes'];

  let maxWeeks = 0;

  for (const [muscle, weeklyData] of Object.entries(muscleData)) {
    const muscleGroup = muscle as MuscleGroup;
    maxWeeks = Math.max(maxWeeks, weeklyData.length);

    // Calculate volume stats
    const avgWeeklySets = average(weeklyData.map(w => w.workingSets));
    const totalSets = sum(weeklyData.map(w => w.workingSets));
    const effectiveSets = sum(weeklyData.map(w => w.effectiveSets));
    // Hypertrophy targeting consumes RIR-weighted Effective Volume when the
    // week carried per-set RIR data; aggregate-only weeks fall back to raw
    // working sets (identical to the pre-weighting behavior). This is the
    // number compared against the learned MEV/MRV tolerance below — readiness
    // and fatigue models are NOT on this path and keep consuming raw volume.
    const avgWeeklyStimulus = average(
      weeklyData.map(w => w.effectiveVolumeSets ?? w.workingSets)
    );

    muscleVolumes[muscleGroup] = { avgWeeklySets, totalSets, effectiveSets };

    if (weeklyData.length < 3) {
      muscleOutcomes[muscleGroup] = {
        muscle: muscleGroup,
        weeklySets: avgWeeklyStimulus,
        progressionRate: 0,
        progressionTrend: 'maintaining',
        rirDrift: 0,
        formDegradation: 0,
        recoveryCorrelation: 0,
        volumeVerdict: 'insufficient_data',
        confidence: 0,
        suggestedAdjustment: 0
      };
      continue;
    }

    // Analyze progression (would need actual set logs for full analysis)
    // Using simplified version based on muscle volume data
    const rirDrift = calculateRirDrift(weeklyData);
    const formTrend = analyzeFormTrend(weeklyData);

    // Calculate progression from average RIR and form scores
    const rirValues = weeklyData.map(w => w.averageRIR);
    const progressionTrend = rirValues[0] - rirValues[rirValues.length - 1] > 1
      ? 'declining'
      : rirValues[rirValues.length - 1] >= rirValues[0]
        ? 'improving'
        : 'maintaining';

    const tolerance = currentProfile.muscleTolerance[muscleGroup];

    const verdict = determineVolumeVerdict(
      {
        status: 'analyzed',
        avgProgressionRate: 0,
        progressionTrend,
        totalRirDrift: rirDrift.drift,
        avgFormDegradation: formTrend.avgDegradation,
        weekCount: weeklyData.length
      },
      rirDrift,
      formTrend,
      avgWeeklyStimulus,
      tolerance,
      subjectiveByMuscle?.[muscleGroup]
    );

    muscleOutcomes[muscleGroup] = {
      muscle: muscleGroup,
      weeklySets: avgWeeklyStimulus,
      progressionRate: 0, // Would be calculated from actual progression data
      progressionTrend,
      rirDrift: rirDrift.drift,
      formDegradation: formTrend.avgDegradation,
      recoveryCorrelation: 0, // Would be calculated separately with check-in data
      volumeVerdict: verdict.verdict,
      confidence: verdict.confidence,
      suggestedAdjustment: verdict.adjustment
    };
  }

  return {
    id: `meso-analysis-${mesoId}`,
    mesocycleId: mesoId,
    startDate,
    endDate,
    weeks: maxWeeks,
    muscleVolumes,
    muscleOutcomes,
    overallRecovery: assessOverallRecovery(muscleOutcomes)
  };
}

// ============================================
// UPDATE USER VOLUME PROFILE
// ============================================

/**
 * Update user's learned tolerances after mesocycle analysis.
 * Uses exponential moving average to smooth estimates.
 */
export function updateVolumeProfile(
  currentProfile: UserVolumeProfile,
  mesoAnalysis: MesocycleAnalysis
): UserVolumeProfile {
  const alpha = 0.3;  // Learning rate
  const updatedProfile = { ...currentProfile };
  updatedProfile.muscleTolerance = { ...currentProfile.muscleTolerance };

  for (const [muscle, outcome] of Object.entries(mesoAnalysis.muscleOutcomes)) {
    if (outcome.volumeVerdict === 'insufficient_data') continue;

    const muscleGroup = muscle as MuscleGroup;
    const current = { ...updatedProfile.muscleTolerance[muscleGroup] };
    const observedSets = outcome.weeklySets;

    // Update estimates based on verdict
    if (outcome.volumeVerdict === 'too_high') {
      // Observed sets exceeded MRV - lower MRV estimate
      const newMRV = Math.min(current.estimatedMRV, observedSets - 1);
      current.estimatedMRV = Math.round(alpha * newMRV + (1 - alpha) * current.estimatedMRV);
    } else if (outcome.volumeVerdict === 'too_low') {
      // Could handle more - raise estimates
      const newMRV = Math.max(current.estimatedMRV, observedSets + 3);
      current.estimatedMRV = Math.round(alpha * newMRV + (1 - alpha) * current.estimatedMRV);

      const newMEV = Math.max(current.estimatedMEV, observedSets);
      current.estimatedMEV = Math.round(alpha * newMEV + (1 - alpha) * current.estimatedMEV);
    } else {
      // Optimal - reinforce current estimates with slight adjustment toward observed
      current.estimatedMRV = Math.round(alpha * (observedSets + 4) + (1 - alpha) * current.estimatedMRV);
      current.estimatedMEV = Math.round(alpha * Math.max(0, observedSets - 2) + (1 - alpha) * current.estimatedMEV);
    }

    // Ensure MEV <= MRV
    current.estimatedMEV = Math.min(current.estimatedMEV, current.estimatedMRV - 2);

    // Update confidence based on data points
    current.dataPoints += 1;
    current.confidence = current.dataPoints >= 4 ? 'high' :
                         current.dataPoints >= 2 ? 'medium' : 'low';
    current.lastUpdated = new Date();

    updatedProfile.muscleTolerance[muscleGroup] = current;
  }

  updatedProfile.updatedAt = new Date();
  return updatedProfile;
}

// ============================================
// REAL-TIME FATIGUE MONITORING
// ============================================

/**
 * Assess current fatigue status during a mesocycle.
 * Provides real-time alerts before fatigue becomes problematic.
 */
export function assessCurrentFatigueStatus(
  recentMuscleData: MuscleVolumeData[],
  profile: UserVolumeProfile
): FatigueAlert[] {
  const alerts: FatigueAlert[] = [];

  // Group by muscle
  const byMuscle: Record<MuscleGroup, MuscleVolumeData[]> = {} as Record<MuscleGroup, MuscleVolumeData[]>;

  for (const data of recentMuscleData) {
    if (!byMuscle[data.muscle]) {
      byMuscle[data.muscle] = [];
    }
    byMuscle[data.muscle].push(data);
  }

  for (const [muscle, muscleGroup] of Object.entries(byMuscle)) {
    const tolerance = profile.muscleTolerance[muscle as MuscleGroup];
    if (!tolerance) continue;

    const recentData = muscleGroup.slice(-3);  // Last 3 weeks
    if (recentData.length < 2) continue;

    // Check for warning signs
    const rirDrift = calculateRirDrift(recentData);
    const formTrend = analyzeFormTrend(recentData);
    const currentSets = recentData[recentData.length - 1].workingSets;

    // Approaching MRV
    if (currentSets >= tolerance.estimatedMRV * 0.9) {
      alerts.push({
        muscle: muscle as MuscleGroup,
        type: 'approaching_mrv',
        severity: 'warning',
        message: `${capitalize(muscle)} volume is approaching your estimated maximum (${currentSets}/${Math.round(tolerance.estimatedMRV)} sets)`,
        suggestion: 'Consider maintaining current volume or planning a deload'
      });
    }

    // RIR drift warning
    if (rirDrift.significance === 'elevated') {
      alerts.push({
        muscle: muscle as MuscleGroup,
        type: 'rir_drift',
        severity: 'warning',
        message: `${capitalize(muscle)} exercises are feeling harder than previous weeks`,
        suggestion: 'Fatigue may be accumulating. Monitor closely or reduce volume slightly.'
      });
    } else if (rirDrift.significance === 'concerning') {
      alerts.push({
        muscle: muscle as MuscleGroup,
        type: 'rir_drift',
        severity: 'alert',
        message: `Significant fatigue accumulation detected for ${muscle}`,
        suggestion: 'Consider reducing volume by 2-3 sets or taking a deload week'
      });
    }

    // Form degradation warning
    if (formTrend.avgDegradation > 0.25) {
      alerts.push({
        muscle: muscle as MuscleGroup,
        type: 'form_degradation',
        severity: 'warning',
        message: `Form quality declining on ${muscle} exercises`,
        suggestion: 'Volume may be exceeding recovery. Reduce weight or sets.'
      });
    }
  }

  return alerts;
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// VOLUME SUMMARY FOR DASHBOARD
// ============================================

/**
 * Summary of volume status for dashboard display
 */
export interface VolumeSummary {
  muscle: MuscleGroup;
  currentSets: number;
  estimatedMEV: number;
  estimatedMRV: number;
  percentOfMRV: number;
  /**
   * Volume status:
   * - 'below_mev': Under minimum effective volume (atrophy risk)
   * - 'low': Between MEV and optimal (adequate but suboptimal)
   * - 'optimal': In the ideal growth range
   * - 'high': Approaching MRV
   * - 'at_limit': At or exceeding MRV
   */
  status: 'below_mev' | 'low' | 'optimal' | 'high' | 'at_limit';
  trend: 'up' | 'down' | 'stable';
}

/**
 * Get volume summary for all muscle groups
 */
export function getVolumeSummary(
  currentWeekData: MuscleVolumeData[],
  previousWeekData: MuscleVolumeData[],
  profile: UserVolumeProfile
): VolumeSummary[] {
  const summaries: VolumeSummary[] = [];

  for (const data of currentWeekData) {
    const tolerance = profile.muscleTolerance[data.muscle];
    if (!tolerance) continue;

    const prevData = previousWeekData.find(p => p.muscle === data.muscle);
    const prevSets = prevData?.workingSets ?? data.workingSets;

    const percentOfMRV = Math.round((data.workingSets / tolerance.estimatedMRV) * 100);
    const percentOfMEV = tolerance.estimatedMEV > 0
      ? Math.round((data.workingSets / tolerance.estimatedMEV) * 100)
      : 100;

    // Determine status based on MEV and MRV thresholds
    let status: VolumeSummary['status'] = 'optimal';
    if (data.workingSets < tolerance.estimatedMEV) {
      // Below minimum effective volume - atrophy risk
      status = 'below_mev';
    } else if (percentOfMRV < 50) {
      // Above MEV but suboptimal
      status = 'low';
    } else if (percentOfMRV >= 100) {
      status = 'at_limit';
    } else if (percentOfMRV >= 85) {
      status = 'high';
    }

    let trend: VolumeSummary['trend'] = 'stable';
    if (data.workingSets > prevSets + 1) {
      trend = 'up';
    } else if (data.workingSets < prevSets - 1) {
      trend = 'down';
    }

    summaries.push({
      muscle: data.muscle,
      currentSets: data.workingSets,
      estimatedMEV: tolerance.estimatedMEV,
      estimatedMRV: tolerance.estimatedMRV,
      percentOfMRV,
      status,
      trend
    });
  }

  return summaries;
}
