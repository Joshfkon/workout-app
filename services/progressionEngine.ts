/**
 * Progression Engine
 * 
 * Pure functions for calculating workout progression, set quality, and warmup protocols.
 * No side effects or database calls - all data passed as input.
 */

import type {
  Exercise,
  SetLog,
  SetQuality,
  ProgressionType,
  ProgressionTargets,
  LastSessionPerformance,
  WarmupSet,
  Experience,
} from '@/types/schema';
import { roundToIncrement } from '@/lib/utils';

// ============================================
// CONSTANTS
// ============================================

/** Weight increment thresholds based on experience */
const WEIGHT_INCREMENT_FACTOR: Record<Experience, number> = {
  novice: 1.0,      // Beginners can increase faster
  intermediate: 0.8,
  advanced: 0.6,    // Advanced lifters progress slower
};

/** RPE thresholds for set quality classification */
const SET_QUALITY_THRESHOLDS = {
  junk: { maxRpe: 5 },           // RPE <= 5 (RIR >= 5) is junk volume
  effective: { minRpe: 6, maxRpe: 7 }, // RPE 6-7 is effective
  stimulative: { minRpe: 7.5, maxRpe: 9.5 }, // RPE 7.5-9.5 is stimulative
  excessive: { minRpe: 10 },     // RPE 10 (failure) may be excessive
};

/** Minimum reps to complete before increasing weight */
const REP_PROGRESSION_THRESHOLD = 2; // Hit top of rep range for this many sets

/** Maximum weekly progression rate for weight (percentage) */
const MAX_WEEKLY_WEIGHT_INCREASE = 0.025; // 2.5%

// ============================================
// MAIN PROGRESSION LOGIC
// ============================================

export interface CalculateNextTargetsInput {
  exercise: Exercise;
  lastPerformance: LastSessionPerformance | null;
  experience: Experience;
  weekInMeso: number;
  isDeloadWeek: boolean;
  readinessScore?: number; // 0-100
}

/**
 * Calculate the next workout targets for an exercise
 * 
 * Progression hierarchy:
 * 1. Load progression (increase weight if hitting rep targets consistently)
 * 2. Rep progression (add reps if not ready for weight increase)
 * 3. Set progression (add sets within the mesocycle)
 * 4. Technique progression (maintain for consolidation)
 */
export function calculateNextTargets(input: CalculateNextTargetsInput): ProgressionTargets {
  const {
    exercise,
    lastPerformance,
    experience,
    weekInMeso,
    isDeloadWeek,
    readinessScore = 80,
  } = input;

  // Default starting targets
  const baseTargets: ProgressionTargets = {
    weightKg: lastPerformance?.weightKg ?? 0,
    repRange: exercise.defaultRepRange,
    targetRir: exercise.defaultRir,
    sets: 3,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'technique',
    reason: 'Starting weights - focus on form and technique',
  };

  // First time doing this exercise
  if (!lastPerformance) {
    return {
      ...baseTargets,
      reason: 'New exercise - start light and focus on form',
    };
  }

  // Deload week - reduce volume and intensity
  if (isDeloadWeek) {
    return calculateDeloadTargets(lastPerformance, exercise);
  }

  // Low readiness - reduce targets
  if (readinessScore < 60) {
    return calculateLowReadinessTargets(lastPerformance, exercise, readinessScore);
  }

  // Analyze last performance to determine progression type
  const analysis = analyzePerformance(lastPerformance, exercise);
  
  // Determine progression based on analysis
  if (analysis.readyForLoadProgression) {
    return calculateLoadProgression(lastPerformance, exercise, experience, weekInMeso);
  }
  
  if (analysis.readyForRepProgression) {
    return calculateRepProgression(lastPerformance, exercise);
  }
  
  if (analysis.readyForSetProgression && weekInMeso > 1) {
    return calculateSetProgression(lastPerformance, exercise, weekInMeso);
  }

  // Default: maintain current targets (technique consolidation)
  return {
    weightKg: lastPerformance.weightKg,
    repRange: exercise.defaultRepRange,
    targetRir: exercise.defaultRir,
    sets: lastPerformance.sets,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'technique',
    reason: analysis.reason || 'Consolidate technique at current weight',
  };
}

// ============================================
// PERFORMANCE ANALYSIS
// ============================================

interface PerformanceAnalysis {
  readyForLoadProgression: boolean;
  readyForRepProgression: boolean;
  readyForSetProgression: boolean;
  reason: string;
}

function analyzePerformance(
  performance: LastSessionPerformance,
  exercise: Exercise
): PerformanceAnalysis {
  const [minReps, maxReps] = exercise.defaultRepRange;
  const hitTopOfRange = performance.reps >= maxReps;
  const completedAllSets = performance.allSetsCompleted;
  const averageRpeAppropriate = performance.averageRpe >= 7 && performance.averageRpe <= 9;

  // Ready for load progression: hit top of rep range with good RPE
  if (hitTopOfRange && completedAllSets && averageRpeAppropriate) {
    return {
      readyForLoadProgression: true,
      readyForRepProgression: false,
      readyForSetProgression: false,
      reason: 'Hit top of rep range with appropriate RPE - ready for weight increase',
    };
  }

  // Ready for rep progression: in rep range but not at top
  if (performance.reps >= minReps && performance.reps < maxReps && completedAllSets) {
    return {
      readyForLoadProgression: false,
      readyForRepProgression: true,
      readyForSetProgression: false,
      reason: 'Add reps before increasing weight',
    };
  }

  // Ready for set progression: maintaining well, can add volume
  if (completedAllSets && performance.averageRpe < 8) {
    return {
      readyForLoadProgression: false,
      readyForRepProgression: false,
      readyForSetProgression: true,
      reason: 'RPE indicates capacity for more volume',
    };
  }

  // Not ready for progression
  let reason = 'Continue at current targets';
  if (!completedAllSets) {
    reason = 'Did not complete all sets - maintain current weight';
  } else if (performance.averageRpe > 9) {
    reason = 'RPE too high - maintain weight and focus on recovery';
  } else if (performance.reps < minReps) {
    reason = 'Reps below target range - consider reducing weight';
  }

  return {
    readyForLoadProgression: false,
    readyForRepProgression: false,
    readyForSetProgression: false,
    reason,
  };
}

// ============================================
// PROGRESSION CALCULATIONS
// ============================================

function calculateLoadProgression(
  lastPerformance: LastSessionPerformance,
  exercise: Exercise,
  experience: Experience,
  weekInMeso: number
): ProgressionTargets {
  const incrementFactor = WEIGHT_INCREMENT_FACTOR[experience];
  const baseIncrement = exercise.minWeightIncrementKg;
  
  // Calculate weight increase
  let weightIncrease = baseIncrement * incrementFactor;
  
  // Cap at max weekly increase
  const maxIncrease = lastPerformance.weightKg * MAX_WEEKLY_WEIGHT_INCREASE;
  weightIncrease = Math.min(weightIncrease, maxIncrease);
  
  // Round to exercise increment
  const newWeight = roundToIncrement(
    lastPerformance.weightKg + weightIncrease,
    exercise.minWeightIncrementKg
  );

  return {
    weightKg: newWeight,
    repRange: exercise.defaultRepRange,
    targetRir: exercise.defaultRir,
    sets: lastPerformance.sets,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'load',
    reason: `Weight increased by ${weightIncrease.toFixed(1)}kg based on hitting ${lastPerformance.reps} reps`,
  };
}

function calculateRepProgression(
  lastPerformance: LastSessionPerformance,
  exercise: Exercise
): ProgressionTargets {
  return {
    weightKg: lastPerformance.weightKg,
    repRange: exercise.defaultRepRange,
    targetRir: exercise.defaultRir,
    sets: lastPerformance.sets,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'reps',
    reason: `Target ${lastPerformance.reps + 1} reps (was ${lastPerformance.reps}) before increasing weight`,
  };
}

function calculateSetProgression(
  lastPerformance: LastSessionPerformance,
  exercise: Exercise,
  weekInMeso: number
): ProgressionTargets {
  // Add one set per week in the mesocycle (up to a maximum)
  const maxSets = exercise.mechanic === 'compound' ? 5 : 4;
  const newSets = Math.min(lastPerformance.sets + 1, maxSets);

  return {
    weightKg: lastPerformance.weightKg,
    repRange: exercise.defaultRepRange,
    targetRir: exercise.defaultRir,
    sets: newSets,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'sets',
    reason: `Week ${weekInMeso}: added set ${newSets} to increase volume`,
  };
}

function calculateDeloadTargets(
  lastPerformance: LastSessionPerformance,
  exercise: Exercise
): ProgressionTargets {
  // Deload: reduce weight by 40%, reduce sets by 50%, increase RIR
  const deloadWeight = roundToIncrement(
    lastPerformance.weightKg * 0.6,
    exercise.minWeightIncrementKg
  );
  const deloadSets = Math.max(2, Math.floor(lastPerformance.sets * 0.5));

  return {
    weightKg: deloadWeight,
    repRange: exercise.defaultRepRange,
    targetRir: 4,
    sets: deloadSets,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'technique',
    reason: 'Deload week: reduced intensity and volume for recovery',
  };
}

function calculateLowReadinessTargets(
  lastPerformance: LastSessionPerformance,
  exercise: Exercise,
  readinessScore: number
): ProgressionTargets {
  // Scale reduction based on readiness (lower readiness = more reduction)
  const reductionFactor = 0.7 + (readinessScore / 100) * 0.3; // 0.7 to 1.0
  
  const adjustedWeight = roundToIncrement(
    lastPerformance.weightKg * reductionFactor,
    exercise.minWeightIncrementKg
  );

  return {
    weightKg: adjustedWeight,
    repRange: exercise.defaultRepRange,
    targetRir: exercise.defaultRir + 1, // Increase RIR for safety
    sets: lastPerformance.sets,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic) + 30, // Extra rest
    progressionType: 'technique',
    reason: `Reduced targets due to low readiness (${readinessScore}%)`,
  };
}

// ============================================
// SET QUALITY CLASSIFICATION
// ============================================

export interface CalculateSetQualityInput {
  rpe: number;
  targetRir: number;
  reps: number;
  targetRepRange: [number, number];
  isLastSet: boolean;
}

/**
 * Calculate the quality classification of a logged set
 */
export function calculateSetQuality(input: CalculateSetQualityInput): {
  quality: SetQuality;
  reason: string;
} {
  const { rpe, targetRir, reps, targetRepRange, isLastSet } = input;
  const [minReps, maxReps] = targetRepRange;
  const rir = 10 - rpe;

  // Junk volume: too easy (high RIR, low RPE)
  if (rpe <= SET_QUALITY_THRESHOLDS.junk.maxRpe) {
    return {
      quality: 'junk',
      reason: `RPE ${rpe} (${rir} RIR) - too far from failure to stimulate growth`,
    };
  }

  // Excessive: too hard (failure or near-failure when not intended)
  if (rpe >= SET_QUALITY_THRESHOLDS.excessive.minRpe && !isLastSet) {
    return {
      quality: 'excessive',
      reason: 'Reached failure on non-final set - may impact remaining sets',
    };
  }

  // Check rep range compliance
  if (reps < minReps) {
    return {
      quality: 'effective',
      reason: `Below target rep range (${reps}/${minReps}-${maxReps}) - consider reducing weight`,
    };
  }

  // Stimulative: in the sweet spot
  if (
    rpe >= SET_QUALITY_THRESHOLDS.stimulative.minRpe &&
    rpe <= SET_QUALITY_THRESHOLDS.stimulative.maxRpe
  ) {
    return {
      quality: 'stimulative',
      reason: `RPE ${rpe} with ${reps} reps - excellent hypertrophy stimulus`,
    };
  }

  // Effective: good but not optimal
  return {
    quality: 'effective',
    reason: `RPE ${rpe} - contributing to volume but could push harder`,
  };
}

/**
 * Detect sets that count as "junk volume" (too easy to stimulate growth)
 */
export function detectJunkVolume(sets: SetLog[]): SetLog[] {
  return sets.filter((set) => !set.isWarmup && set.rpe <= SET_QUALITY_THRESHOLDS.junk.maxRpe);
}

/**
 * Detect regression in performance
 */
export function detectRegression(
  current: LastSessionPerformance,
  previous: LastSessionPerformance | null
): { isRegression: boolean; reason: string } {
  if (!previous) {
    return { isRegression: false, reason: 'No previous data to compare' };
  }

  // Weight decreased
  if (current.weightKg < previous.weightKg) {
    return {
      isRegression: true,
      reason: `Weight dropped from ${previous.weightKg}kg to ${current.weightKg}kg`,
    };
  }

  // Same weight, fewer reps
  if (current.weightKg === previous.weightKg && current.reps < previous.reps - 1) {
    return {
      isRegression: true,
      reason: `Reps dropped from ${previous.reps} to ${current.reps} at same weight`,
    };
  }

  // Higher RPE for same performance
  if (
    current.weightKg === previous.weightKg &&
    current.reps === previous.reps &&
    current.averageRpe > previous.averageRpe + 1
  ) {
    return {
      isRegression: true,
      reason: 'Same performance required significantly more effort',
    };
  }

  return { isRegression: false, reason: '' };
}

// ============================================
// WARMUP PROTOCOL GENERATION
// ============================================

export interface GenerateWarmupInput {
  workingWeight: number;
  exercise: Exercise;
  isFirstExercise: boolean;
}

/**
 * Generate a warmup protocol based on working weight
 */
export function generateWarmupProtocol(input: GenerateWarmupInput): WarmupSet[] {
  const { workingWeight, exercise, isFirstExercise } = input;

  // No warmup needed for very light weights
  if (workingWeight < 20) {
    return [
      {
        setNumber: 1,
        percentOfWorking: 50,
        targetReps: 10,
        purpose: 'Light activation',
      },
    ];
  }

  // Standard warmup protocol
  const protocol: WarmupSet[] = [];

  // Set 1: Empty bar or very light (if first exercise, add general warmup)
  if (isFirstExercise) {
    protocol.push({
      setNumber: 1,
      percentOfWorking: 0,
      targetReps: 10,
      purpose: 'General warmup - increase blood flow',
    });
  }

  // Progressive loading warmups
  const warmupPercents = workingWeight >= 100
    ? [30, 50, 70, 85]
    : workingWeight >= 50
    ? [40, 60, 80]
    : [50, 75];

  warmupPercents.forEach((percent, index) => {
    const warmupWeight = roundToIncrement(
      workingWeight * (percent / 100),
      exercise.minWeightIncrementKg
    );
    
    // Reps decrease as weight increases
    const reps = percent <= 50 ? 8 : percent <= 70 ? 5 : 3;
    
    let purpose = 'Progressive loading';
    if (percent <= 50) purpose = 'Movement groove practice';
    else if (percent <= 70) purpose = 'Neuromuscular preparation';
    else purpose = 'CNS potentiation';

    protocol.push({
      setNumber: protocol.length + 1,
      percentOfWorking: percent,
      targetReps: reps,
      purpose,
    });
  });

  return protocol;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getRestSecondsForMechanic(mechanic: 'compound' | 'isolation'): number {
  return mechanic === 'compound' ? 180 : 120;
}

/**
 * Calculate estimated 1 rep max using Epley formula
 */
export function calculateE1RM(weight: number, reps: number, rpe: number = 10): number {
  if (reps === 0) return 0;
  if (reps === 1 && rpe === 10) return weight;
  
  // Adjust reps for RIR
  const rir = 10 - rpe;
  const effectiveReps = reps + rir;
  
  // Epley formula: weight * (1 + reps/30)
  return Math.round(weight * (1 + effectiveReps / 30) * 100) / 100;
}

/**
 * Extract performance data from completed sets
 */
export function extractPerformanceFromSets(
  sets: SetLog[],
  exerciseId: string
): LastSessionPerformance | null {
  const workingSets = sets.filter((s) => !s.isWarmup);
  
  if (workingSets.length === 0) return null;

  // Get top set (highest weight or most reps at same weight)
  const topSet = workingSets.reduce((best, current) => {
    if (current.weightKg > best.weightKg) return current;
    if (current.weightKg === best.weightKg && current.reps > best.reps) return current;
    return best;
  });

  const averageRpe =
    workingSets.reduce((sum, s) => sum + s.rpe, 0) / workingSets.length;

  return {
    exerciseId,
    weightKg: topSet.weightKg,
    reps: topSet.reps,
    rpe: topSet.rpe,
    sets: workingSets.length,
    allSetsCompleted: true, // Would need target to verify
    averageRpe: Math.round(averageRpe * 10) / 10,
  };
}

