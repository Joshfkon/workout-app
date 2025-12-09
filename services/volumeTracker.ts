/**
 * Volume Tracker
 * 
 * Pure functions for calculating weekly volume, comparing to landmarks,
 * and generating volume recommendations.
 */

import type {
  SetLog,
  ExerciseBlock,
  Exercise,
  VolumeLandmarks,
  VolumeStatus,
  WeeklyMuscleVolume,
  MuscleGroup,
} from '@/types/schema';
import { MUSCLE_GROUPS, DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';

// ============================================
// TYPES
// ============================================

export interface MuscleVolumeData {
  muscleGroup: string;
  totalSets: number;
  directSets: number;
  indirectSets: number;
  landmarks: VolumeLandmarks;
  status: VolumeStatus;
  percentOfMrv: number;
}

export interface VolumeRecommendation {
  muscleGroup: string;
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
 */
export function calculateWeeklyVolume(input: CalculateVolumeInput): Map<string, MuscleVolumeData> {
  const { exerciseBlocks, userLandmarks } = input;
  
  // Initialize volume map for all muscle groups
  const volumeMap = new Map<string, MuscleVolumeData>();
  
  MUSCLE_GROUPS.forEach((muscle) => {
    const landmarks = userLandmarks[muscle] ?? DEFAULT_VOLUME_LANDMARKS.intermediate[muscle];
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

    // Primary muscle: full set credit
    const primaryMuscle = exercise.primaryMuscle.toLowerCase();
    if (volumeMap.has(primaryMuscle)) {
      const data = volumeMap.get(primaryMuscle)!;
      data.directSets += setCount;
      data.totalSets += setCount;
    }

    // Secondary muscles: partial set credit (typically 0.5)
    for (const secondary of exercise.secondaryMuscles) {
      const secondaryMuscle = secondary.toLowerCase();
      if (volumeMap.has(secondaryMuscle)) {
        const data = volumeMap.get(secondaryMuscle)!;
        const indirectCredit = Math.round(setCount * 0.5);
        data.indirectSets += indirectCredit;
        data.totalSets += indirectCredit;
      }
    }
  }

  // Calculate status for each muscle group
  volumeMap.forEach((data, muscle) => {
    data.status = assessVolumeStatus(data.totalSets, data.landmarks);
    data.percentOfMrv = Math.round((data.totalSets / data.landmarks.mrv) * 100);
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
): Map<string, MuscleVolumeData> {
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
  volumeData: Map<string, MuscleVolumeData>,
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
  currentWeek: Map<string, MuscleVolumeData>,
  previousWeek: Map<string, MuscleVolumeData>
): Map<string, { change: number; percentChange: number }> {
  const changes = new Map<string, { change: number; percentChange: number }>();

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
export function getVolumeSummary(volumeData: Map<string, MuscleVolumeData>): {
  totalSets: number;
  musclesBelowMev: string[];
  musclesOptimal: string[];
  musclesOverMrv: string[];
  averagePercentMrv: number;
} {
  let totalSets = 0;
  let totalPercentMrv = 0;
  const musclesBelowMev: string[] = [];
  const musclesOptimal: string[] = [];
  const musclesOverMrv: string[] = [];

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
    averagePercentMrv: Math.round(totalPercentMrv / volumeData.size),
  };
}

/**
 * Convert volume data to WeeklyMuscleVolume format for storage
 */
export function toWeeklyMuscleVolume(
  userId: string,
  weekStart: string,
  volumeData: Map<string, MuscleVolumeData>
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

