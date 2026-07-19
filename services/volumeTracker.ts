/**
 * Volume Tracker
 *
 * Pure functions for calculating weekly volume, comparing to landmarks,
 * and generating volume recommendations.
 *
 * Uses the two-tier muscle group system:
 * - Exercises store DetailedMuscleGroup (33 muscles) for precise targeting
 * - Volume tracking uses StandardMuscleGroup (20 muscles) for user-facing metrics
 */

import type {
  SetLog,
  ExerciseBlock,
  Exercise,
  VolumeLandmarks,
  VolumeStatus,
  WeeklyMuscleVolume,
  StandardMuscleGroup,
} from '@/types/schema';
import {
  STANDARD_MUSCLE_GROUPS,
  DEFAULT_VOLUME_LANDMARKS,
  isLegacyMuscle,
  normalizeMuscleToken,
  resolveMuscleToStandard,
} from '@/types/schema';
import { rirFromFeedback, sumEffectiveVolume } from '@/services/effectiveVolume';

// ============================================
// CONSTANTS / HELPERS
// ============================================

/** Fractional set credit given to a secondary (indirect) muscle per working set. */
export const SECONDARY_MUSCLE_CREDIT = 0.5;

/**
 * How a LEGACY coarse primary muscle distributes its direct-set credit across
 * standard muscle groups. A legacy tag can't tell us which head the exercise
 * emphasizes (a flat and an incline press are both just 'chest'), so credit is
 * split across the plausible heads instead of the old winner-takes-all
 * behavior (which sent ALL 'chest' volume to chest_upper, ALL 'shoulders'
 * volume to front_delts, and ALL 'back' volume to lats — leaving the sibling
 * muscles falsely reported as "not worked").
 *
 * 'glutes' and 'abs' intentionally do NOT split: crediting glute_med/obliques
 * from every glute/ab exercise would over-credit muscles that usually need
 * direct work, and their MEV defaults already assume indirect fill. 'traps'
 * and 'calves' follow the same rule — a coarse tag stays on the coarse
 * standard muscle and never leaks into upper_traps/mid_lower_traps or
 * gastrocnemius/soleus (only fine-grained tagging feeds those).
 */
const LEGACY_PRIMARY_VOLUME_WEIGHTS: Record<string, Partial<Record<StandardMuscleGroup, number>>> = {
  chest: { chest_upper: 0.5, chest_lower: 0.5 },
  back: { lats: 0.5, upper_back: 0.5 },
  shoulders: { front_delts: 1 / 3, lateral_delts: 1 / 3, rear_delts: 1 / 3 },
  glutes: { glutes: 1 },
  abs: { abs: 1 },
  traps: { traps: 1 },
  calves: { calves: 1 },
};

/** One standard muscle's share of an exercise's primary (direct) credit. */
export interface PrimaryMuscleCredit {
  muscle: StandardMuscleGroup;
  /** Fraction of each working set credited to this muscle (weights sum to 1). */
  weight: number;
}

/**
 * Resolve an exercise's primary muscle (any format: detailed, standard, or
 * legacy) into weighted standard-muscle credits. Non-legacy tokens resolve to
 * a single muscle at full weight; legacy coarse tokens split per
 * LEGACY_PRIMARY_VOLUME_WEIGHTS. Returns [] for unrecognized tokens.
 */
export function resolvePrimaryMuscleCredits(muscle: string): PrimaryMuscleCredit[] {
  const token = normalizeMuscleToken(muscle);

  if (isLegacyMuscle(token)) {
    const weights = LEGACY_PRIMARY_VOLUME_WEIGHTS[token];
    if (weights) {
      return (Object.entries(weights) as Array<[StandardMuscleGroup, number]>).map(
        ([m, weight]) => ({ muscle: m, weight })
      );
    }
    // Legacy tokens that map 1:1 ('biceps', 'quads', ...)
    const standards = resolveMuscleToStandard(token);
    return standards.length > 0 ? [{ muscle: standards[0], weight: 1 }] : [];
  }

  const standards = resolveMuscleToStandard(token);
  return standards.length > 0 ? [{ muscle: standards[0], weight: 1 }] : [];
}

// ============================================
// TYPES
// ============================================

export interface MuscleVolumeData {
  muscleGroup: StandardMuscleGroup;
  totalSets: number;
  directSets: number;
  indirectSets: number;
  /**
   * RIR-weighted "Effective Volume" for the same counted sets: Σ
   * EFFECTIVE_VOLUME_WEIGHTS[set.rir] with identical warm-up exclusion and
   * primary/secondary crediting as totalSets. Sets with unknown RIR weigh 1.0
   * (conservative). One decimal of precision; totalSets stays the raw count.
   * Optional: paths that only have pre-aggregated rows (no per-set RIR) omit
   * it, and consumers fall back to the raw count.
   */
  effectiveVolumeSets?: number;
  landmarks: VolumeLandmarks;
  status: VolumeStatus;
  percentOfMrv: number;
  /**
   * Optional per-exercise breakdown of the sets that fed this muscle (name +
   * fractional-credit set count), for the "which exercises fed this?" debug
   * view in the insufficient-volume warning. Populated by the shared weekly
   * MEV pipeline; omitted by the raw landmark-based calculators.
   */
  contributingExercises?: Array<{ id: string; name: string; sets: number }>;
}

export interface VolumeRecommendation {
  muscleGroup: StandardMuscleGroup;
  status: VolumeStatus;
  currentSets: number;
  targetRange: [number, number];
  message: string;
  action: 'increase' | 'maintain' | 'decrease' | 'optimal';
}

// ============================================
// VOLUME CALCULATION
// ============================================

export interface CalculateVolumeInput {
  exerciseBlocks: Array<{
    block: ExerciseBlock;
    exercise: Exercise;
    completedSets: SetLog[];
  }>;
  userLandmarks: Record<string, VolumeLandmarks>;
}

/**
 * Calculate weekly volume per muscle group
 * Counts working sets (non-warmup) from completed exercise blocks
 *
 * Handles three muscle formats:
 * - DetailedMuscleGroup (33 muscles) - new format from AI completion
 * - StandardMuscleGroup (20 muscles) - volume tracking format
 * - Legacy MuscleGroup (13 muscles) - old format for backwards compatibility
 */
export function calculateWeeklyVolume(input: CalculateVolumeInput): Map<StandardMuscleGroup, MuscleVolumeData> {
  const { exerciseBlocks, userLandmarks } = input;

  // Initialize volume map for all STANDARD muscle groups (20)
  const volumeMap = new Map<StandardMuscleGroup, MuscleVolumeData>();

  // Default landmarks for muscle groups not explicitly defined
  const DEFAULT_FALLBACK_LANDMARKS: VolumeLandmarks = { mev: 4, mav: 10, mrv: 16 };

  STANDARD_MUSCLE_GROUPS.forEach((muscle) => {
    const landmarks = userLandmarks[muscle]
      ?? DEFAULT_VOLUME_LANDMARKS.intermediate[muscle]
      ?? DEFAULT_FALLBACK_LANDMARKS;
    volumeMap.set(muscle, {
      muscleGroup: muscle,
      totalSets: 0,
      directSets: 0,
      indirectSets: 0,
      effectiveVolumeSets: 0,
      landmarks,
      status: 'below_mev',
      percentOfMrv: 0,
    });
  });

  // Per-muscle accumulator for the RIR-weighted effective volume (kept
  // separate from directSets/indirectSets so raw counting is untouched).
  const effectiveByMuscle = new Map<StandardMuscleGroup, number>();

  // Count sets per muscle group
  for (const { exercise, completedSets } of exerciseBlocks) {
    const workingSets = completedSets.filter((s) => !s.isWarmup);
    const setCount = workingSets.length;

    if (setCount === 0) continue;

    // Same counted sets, weighted by reported RIR (unknown -> 1.0, warned).
    const effectiveCount = sumEffectiveVolume(
      workingSets.map((s) => rirFromFeedback(s.feedback)),
      exercise.name
    );

    // Primary muscle: distribute direct credit across the standard muscles it
    // resolves to (legacy coarse tags like 'chest' split across their heads,
    // precise tags get full credit — see resolvePrimaryMuscleCredits).
    const primaryCredits = resolvePrimaryMuscleCredits(exercise.primaryMuscle);
    const primaryStandardSet = new Set(primaryCredits.map((c) => c.muscle));
    if (primaryCredits.length > 0) {
      for (const { muscle, weight } of primaryCredits) {
        const data = volumeMap.get(muscle);
        if (!data) continue;
        data.directSets += setCount * weight;
        effectiveByMuscle.set(muscle, (effectiveByMuscle.get(muscle) ?? 0) + effectiveCount * weight);
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // A primary muscle that doesn't map to a canonical group silently drops
      // volume; surface it in dev so the exercise data can be corrected.
      console.warn(
        `[volumeTracker] Unmatched primary muscle "${exercise.primaryMuscle}" - volume not counted`
      );
    }

    // Secondary muscles: convert to standard, partial credit
    // Track credit per standard muscle, distributing 0.5 proportionally when
    // a legacy muscle maps to multiple standard muscles
    const secondaryStandardCredits = new Map<StandardMuscleGroup, number>();

    for (const secondary of exercise.secondaryMuscles) {
      const secondaryStandards = resolveMuscleToStandard(secondary);
      // Distribute 0.5 credit proportionally among mapped standard muscles
      const creditPerMuscle = secondaryStandards.length > 0
        ? SECONDARY_MUSCLE_CREDIT / secondaryStandards.length
        : 0;

      for (const secondaryStandard of secondaryStandards) {
        // Don't count secondary if the primary already credits that group
        if (primaryStandardSet.has(secondaryStandard)) continue;

        // Accumulate credit for this standard muscle
        const existing = secondaryStandardCredits.get(secondaryStandard) ?? 0;
        secondaryStandardCredits.set(secondaryStandard, existing + creditPerMuscle);
      }
    }

    // Apply indirect credit based on accumulated credits
    // Don't round here - accumulate fractional values and round only at the end
    // This prevents losing volume when credit per muscle is small (e.g., 0.167)
    secondaryStandardCredits.forEach((credit, standardMuscle) => {
      if (volumeMap.has(standardMuscle)) {
        const data = volumeMap.get(standardMuscle)!;
        data.indirectSets += setCount * credit;
        effectiveByMuscle.set(
          standardMuscle,
          (effectiveByMuscle.get(standardMuscle) ?? 0) + effectiveCount * credit
        );
      }
    });
  }

  // Calculate status for each muscle group
  // Round direct/indirect sets and totals now that all accumulation is complete
  // This prevents losing fractional volume from small per-exercise credits
  volumeMap.forEach((data) => {
    data.directSets = Math.round(data.directSets);
    data.indirectSets = Math.round(data.indirectSets);
    data.totalSets = data.directSets + data.indirectSets;
    // Effective volume keeps one decimal (weighted sums are fractional by design).
    data.effectiveVolumeSets =
      Math.round((effectiveByMuscle.get(data.muscleGroup) ?? 0) * 10) / 10;
    data.status = assessVolumeStatus(data.totalSets, data.landmarks);
    // Guard against division by zero (mrv should never be 0, but protect anyway)
    data.percentOfMrv = data.landmarks.mrv > 0
      ? Math.round((data.totalSets / data.landmarks.mrv) * 100)
      : 0;
  });

  return volumeMap;
}

/**
 * Calculate volume from raw set logs grouped by exercise
 */
export function calculateVolumeFromSets(
  sets: SetLog[],
  exerciseMap: Map<string, Exercise>,
  blockMap: Map<string, ExerciseBlock>,
  userLandmarks: Record<string, VolumeLandmarks>
): Map<StandardMuscleGroup, MuscleVolumeData> {
  // Group sets by exercise block
  const blockSets = new Map<string, SetLog[]>();
  for (const set of sets) {
    if (!blockSets.has(set.exerciseBlockId)) {
      blockSets.set(set.exerciseBlockId, []);
    }
    blockSets.get(set.exerciseBlockId)!.push(set);
  }

  // Build input for calculateWeeklyVolume
  const exerciseBlocks: CalculateVolumeInput['exerciseBlocks'] = [];
  
  blockSets.forEach((completedSets, blockId) => {
    const block = blockMap.get(blockId);
    if (!block) return;
    
    const exercise = exerciseMap.get(block.exerciseId);
    if (!exercise) return;
    
    exerciseBlocks.push({ block, exercise, completedSets });
  });

  return calculateWeeklyVolume({ exerciseBlocks, userLandmarks });
}

// ============================================
// VOLUME STATUS ASSESSMENT
// ============================================

/**
 * Assess volume status relative to landmarks
 */
export function assessVolumeStatus(totalSets: number, landmarks: VolumeLandmarks): VolumeStatus {
  const { mev, mav, mrv } = landmarks;

  if (totalSets < mev) {
    return 'below_mev';
  }
  
  if (totalSets >= mev && totalSets < mav * 0.8) {
    return 'effective';
  }
  
  if (totalSets >= mav * 0.8 && totalSets <= mav * 1.1) {
    return 'optimal';
  }
  
  if (totalSets > mav * 1.1 && totalSets <= mrv) {
    return 'approaching_mrv';
  }
  
  return 'exceeding_mrv';
}

/**
 * Get human-readable description for volume status
 */
export function getVolumeStatusDescription(status: VolumeStatus): {
  label: string;
  description: string;
  color: string;
} {
  switch (status) {
    case 'below_mev':
      return {
        label: 'Below MEV',
        description: 'Not enough volume to maintain muscle. Consider adding sets.',
        color: 'text-surface-400',
      };
    case 'effective':
      return {
        label: 'Effective',
        description: 'Volume is sufficient for maintenance and some growth.',
        color: 'text-primary-400',
      };
    case 'optimal':
      return {
        label: 'Optimal',
        description: 'Volume is in the ideal range for maximum hypertrophy.',
        color: 'text-success-400',
      };
    case 'approaching_mrv':
      return {
        label: 'Approaching MRV',
        description: 'High volume - good for overreaching but monitor recovery.',
        color: 'text-warning-400',
      };
    case 'exceeding_mrv':
      return {
        label: 'Exceeding MRV',
        description: 'Volume exceeds recoverable limit. Risk of overtraining.',
        color: 'text-danger-400',
      };
  }
}

/**
 * MRV excess severity levels for detailed warnings
 */
export type MrvExcessSeverity = 'none' | 'warning' | 'critical' | 'severe';

/**
 * Get MRV excess severity based on percentage of MRV
 * - none: <= 100% MRV (within limits)
 * - warning: 101-120% MRV (mild excess, monitor recovery)
 * - critical: 121-150% MRV (significant excess, reduce volume)
 * - severe: >150% MRV (dangerous, immediate deload needed)
 */
export function getMrvExcessSeverity(percentOfMrv: number): MrvExcessSeverity {
  if (percentOfMrv <= 100) return 'none';
  if (percentOfMrv <= 120) return 'warning';
  if (percentOfMrv <= 150) return 'critical';
  return 'severe';
}

/**
 * Get detailed warning for MRV excess
 * Returns null if volume is within acceptable limits
 */
export function getMrvExcessWarning(
  muscleGroup: StandardMuscleGroup,
  percentOfMrv: number,
  totalSets: number,
  mrvSets: number
): {
  severity: MrvExcessSeverity;
  message: string;
  recommendation: string;
} | null {
  const severity = getMrvExcessSeverity(percentOfMrv);

  if (severity === 'none') return null;

  const excessSets = totalSets - mrvSets;
  const muscleLabel = muscleGroup.replace(/_/g, ' ');

  switch (severity) {
    case 'warning':
      return {
        severity,
        message: `${muscleLabel} is ${percentOfMrv}% of MRV (${excessSets} sets over limit)`,
        recommendation: 'Monitor recovery closely. Consider reducing volume if fatigue increases.',
      };
    case 'critical':
      return {
        severity,
        message: `⚠️ ${muscleLabel} is at ${percentOfMrv}% of MRV - significantly over recoverable volume`,
        recommendation: `Reduce by ${excessSets} sets immediately. Risk of overtraining and injury.`,
      };
    case 'severe':
      return {
        severity,
        message: `🚨 CRITICAL: ${muscleLabel} at ${percentOfMrv}% of MRV - dangerous volume level`,
        recommendation: `Immediate action required: reduce by ${excessSets}+ sets or take a deload week.`,
      };
  }
}

// ============================================
// VOLUME RECOMMENDATIONS
// ============================================

/**
 * Generate volume recommendations for all muscle groups
 */
export function generateVolumeRecommendations(
  volumeData: Map<StandardMuscleGroup, MuscleVolumeData>,
  weekInMeso: number,
  isDeloadWeek: boolean
): VolumeRecommendation[] {
  const recommendations: VolumeRecommendation[] = [];

  volumeData.forEach((data, muscle) => {
    const rec = generateMuscleRecommendation(data, weekInMeso, isDeloadWeek);
    recommendations.push(rec);
  });

  // Sort by priority (worse status first)
  const statusPriority: Record<VolumeStatus, number> = {
    'exceeding_mrv': 0,
    'below_mev': 1,
    'approaching_mrv': 2,
    'effective': 3,
    'optimal': 4,
  };

  recommendations.sort(
    (a, b) => statusPriority[a.status] - statusPriority[b.status]
  );

  return recommendations;
}

function generateMuscleRecommendation(
  data: MuscleVolumeData,
  weekInMeso: number,
  isDeloadWeek: boolean
): VolumeRecommendation {
  const { muscleGroup, totalSets, landmarks, status } = data;
  const { mev, mav, mrv } = landmarks;

  // Deload week: reduce regardless
  if (isDeloadWeek) {
    return {
      muscleGroup,
      status,
      currentSets: totalSets,
      targetRange: [Math.floor(mev * 0.5), mev],
      message: 'Deload week: reduce volume for recovery',
      action: 'decrease',
    };
  }

  switch (status) {
    case 'below_mev':
      return {
        muscleGroup,
        status,
        currentSets: totalSets,
        targetRange: [mev, mav],
        message: `Add ${mev - totalSets} sets to reach minimum effective volume`,
        action: 'increase',
      };

    case 'effective':
      // Progressive volume increase within meso
      const targetMin = Math.min(mav, totalSets + weekInMeso);
      return {
        muscleGroup,
        status,
        currentSets: totalSets,
        targetRange: [targetMin, mav],
        message: 'Room to add volume for more growth stimulus',
        action: 'increase',
      };

    case 'optimal':
      return {
        muscleGroup,
        status,
        currentSets: totalSets,
        targetRange: [Math.floor(mav * 0.9), Math.ceil(mav * 1.1)],
        message: 'Optimal volume - maintain this level',
        action: 'optimal',
      };

    case 'approaching_mrv':
      return {
        muscleGroup,
        status,
        currentSets: totalSets,
        targetRange: [mav, mrv],
        message: 'High volume - good for planned overreach, monitor fatigue',
        action: 'maintain',
      };

    case 'exceeding_mrv':
      return {
        muscleGroup,
        status,
        currentSets: totalSets,
        targetRange: [mav, mrv],
        message: `Reduce by ${totalSets - mrv} sets to prevent overtraining`,
        action: 'decrease',
      };
  }
}

// ============================================
// VOLUME TRACKING OVER TIME
// ============================================

/**
 * Calculate week-over-week volume change
 */
export function calculateVolumeProgression(
  currentWeek: Map<StandardMuscleGroup, MuscleVolumeData>,
  previousWeek: Map<StandardMuscleGroup, MuscleVolumeData>
): Map<StandardMuscleGroup, { change: number; percentChange: number }> {
  const changes = new Map<StandardMuscleGroup, { change: number; percentChange: number }>();

  currentWeek.forEach((current, muscle) => {
    const previous = previousWeek.get(muscle);
    const prevSets = previous?.totalSets ?? 0;
    const change = current.totalSets - prevSets;
    const percentChange = prevSets > 0 
      ? Math.round((change / prevSets) * 100) 
      : (current.totalSets > 0 ? 100 : 0);

    changes.set(muscle, { change, percentChange });
  });

  return changes;
}

/**
 * MRV warning info for a muscle group
 */
export interface MrvWarning {
  muscle: StandardMuscleGroup;
  percentOfMrv: number;
  severity: MrvExcessSeverity;
  message: string;
  recommendation: string;
}

/**
 * Get summary statistics for volume distribution
 */
export function getVolumeSummary(volumeData: Map<StandardMuscleGroup, MuscleVolumeData>): {
  totalSets: number;
  musclesBelowMev: StandardMuscleGroup[];
  musclesOptimal: StandardMuscleGroup[];
  musclesOverMrv: StandardMuscleGroup[];
  averagePercentMrv: number;
  criticalWarnings: MrvWarning[];
  hasCriticalExcess: boolean;
} {
  let totalSets = 0;
  let totalPercentMrv = 0;
  const musclesBelowMev: StandardMuscleGroup[] = [];
  const musclesOptimal: StandardMuscleGroup[] = [];
  const musclesOverMrv: StandardMuscleGroup[] = [];
  const criticalWarnings: MrvWarning[] = [];

  volumeData.forEach((data, muscle) => {
    totalSets += data.totalSets;
    totalPercentMrv += data.percentOfMrv;

    if (data.status === 'below_mev') {
      musclesBelowMev.push(muscle);
    } else if (data.status === 'optimal') {
      musclesOptimal.push(muscle);
    } else if (data.status === 'exceeding_mrv') {
      musclesOverMrv.push(muscle);

      // Check for critical/severe MRV excess (>120%)
      const warning = getMrvExcessWarning(
        muscle,
        data.percentOfMrv,
        data.totalSets,
        data.landmarks.mrv
      );
      if (warning && (warning.severity === 'critical' || warning.severity === 'severe')) {
        criticalWarnings.push({
          muscle,
          percentOfMrv: data.percentOfMrv,
          severity: warning.severity,
          message: warning.message,
          recommendation: warning.recommendation,
        });
      }
    }
  });

  // Sort critical warnings by severity (severe first) then by percentage
  criticalWarnings.sort((a, b) => {
    if (a.severity === 'severe' && b.severity !== 'severe') return -1;
    if (b.severity === 'severe' && a.severity !== 'severe') return 1;
    return b.percentOfMrv - a.percentOfMrv;
  });

  return {
    totalSets,
    musclesBelowMev,
    musclesOptimal,
    musclesOverMrv,
    criticalWarnings,
    hasCriticalExcess: criticalWarnings.length > 0,
    // Guard against division by zero if volumeData is empty
    averagePercentMrv: volumeData.size > 0
      ? Math.round(totalPercentMrv / volumeData.size)
      : 0,
  };
}

/**
 * Convert volume data to WeeklyMuscleVolume format for storage
 */
export function toWeeklyMuscleVolume(
  userId: string,
  weekStart: string,
  volumeData: Map<StandardMuscleGroup, MuscleVolumeData>
): WeeklyMuscleVolume[] {
  const records: WeeklyMuscleVolume[] = [];

  volumeData.forEach((data, muscleGroup) => {
    records.push({
      userId,
      weekStart,
      muscleGroup,
      totalSets: data.totalSets,
      status: data.status,
    });
  });

  return records;
}

