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
  DetailedMuscleGroup,
} from '@/types/schema';
import {
  STANDARD_MUSCLE_GROUPS,
  DETAILED_TO_STANDARD_MAP,
  DEFAULT_VOLUME_LANDMARKS,
  isDetailedMuscle,
  isStandardMuscle,
  isLegacyMuscle,
  legacyToStandardMuscles,
} from '@/types/schema';

// ============================================
// TYPES
// ============================================

export interface MuscleVolumeData {
  muscleGroup: StandardMuscleGroup;
  totalSets: number;
  directSets: number;
  indirectSets: number;
  landmarks: VolumeLandmarks;
  status: VolumeStatus;
  percentOfMrv: number;
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
 * Convert any muscle string (detailed, standard, or legacy) to StandardMuscleGroup(s)
 * Returns an array because legacy muscles may map to multiple standard muscles
 */
function resolveToStandardMuscles(muscle: string): StandardMuscleGroup[] {
  const lowerMuscle = muscle.toLowerCase();

  // Check if it's a detailed muscle
  if (isDetailedMuscle(lowerMuscle)) {
    return [DETAILED_TO_STANDARD_MAP[lowerMuscle as DetailedMuscleGroup]];
  }

  // Check if it's already a standard muscle
  if (isStandardMuscle(lowerMuscle)) {
    return [lowerMuscle as StandardMuscleGroup];
  }

  // Check if it's a legacy muscle
  if (isLegacyMuscle(lowerMuscle)) {
    return legacyToStandardMuscles(lowerMuscle);
  }

  // Unknown muscle - return empty array
  return [];
}

/**
 * Convert any muscle string to a single StandardMuscleGroup (primary only)
 * For primary muscles, we only want one result
 */
function resolveToStandardMuscle(muscle: string): StandardMuscleGroup | null {
  const results = resolveToStandardMuscles(muscle);
  return results.length > 0 ? results[0] : null;
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
      landmarks,
      status: 'below_mev',
      percentOfMrv: 0,
    });
  });

  // Count sets per muscle group
  for (const { exercise, completedSets } of exerciseBlocks) {
    const workingSets = completedSets.filter((s) => !s.isWarmup);
    const setCount = workingSets.length;

    if (setCount === 0) continue;

    // Primary muscle: convert to standard and give full credit
    const primaryStandard = resolveToStandardMuscle(exercise.primaryMuscle);
    if (primaryStandard && volumeMap.has(primaryStandard)) {
      const data = volumeMap.get(primaryStandard)!;
      data.directSets += setCount;
      data.totalSets += setCount;
    }

    // Secondary muscles: convert to standard, partial credit
    // Track credit per standard muscle, distributing 0.5 proportionally when
    // a legacy muscle maps to multiple standard muscles
    const secondaryStandardCredits = new Map<StandardMuscleGroup, number>();

    for (const secondary of exercise.secondaryMuscles) {
      const secondaryStandards = resolveToStandardMuscles(secondary);
      // Distribute 0.5 credit proportionally among mapped standard muscles
      const creditPerMuscle = secondaryStandards.length > 0
        ? 0.5 / secondaryStandards.length
        : 0;

      for (const secondaryStandard of secondaryStandards) {
        // Don't count secondary if it's the same standard group as primary
        if (secondaryStandard === primaryStandard) continue;

        // Accumulate credit for this standard muscle
        const existing = secondaryStandardCredits.get(secondaryStandard) ?? 0;
        secondaryStandardCredits.set(secondaryStandard, existing + creditPerMuscle);
      }
    }

    // Apply indirect credit based on accumulated credits
    secondaryStandardCredits.forEach((credit, standardMuscle) => {
      if (volumeMap.has(standardMuscle)) {
        const data = volumeMap.get(standardMuscle)!;
        const indirectCredit = Math.round(setCount * credit);
        data.indirectSets += indirectCredit;
        data.totalSets += indirectCredit;
      }
    });
  }

  // Calculate status for each muscle group
  volumeMap.forEach((data) => {
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
 * Get summary statistics for volume distribution
 */
export function getVolumeSummary(volumeData: Map<StandardMuscleGroup, MuscleVolumeData>): {
  totalSets: number;
  musclesBelowMev: StandardMuscleGroup[];
  musclesOptimal: StandardMuscleGroup[];
  musclesOverMrv: StandardMuscleGroup[];
  averagePercentMrv: number;
} {
  let totalSets = 0;
  let totalPercentMrv = 0;
  const musclesBelowMev: StandardMuscleGroup[] = [];
  const musclesOptimal: StandardMuscleGroup[] = [];
  const musclesOverMrv: StandardMuscleGroup[] = [];

  volumeData.forEach((data, muscle) => {
    totalSets += data.totalSets;
    totalPercentMrv += data.percentOfMrv;

    if (data.status === 'below_mev') {
      musclesBelowMev.push(muscle);
    } else if (data.status === 'optimal') {
      musclesOptimal.push(muscle);
    } else if (data.status === 'exceeding_mrv') {
      musclesOverMrv.push(muscle);
    }
  });

  return {
    totalSets,
    musclesBelowMev,
    musclesOptimal,
    musclesOverMrv,
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

