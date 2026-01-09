/**
 * Progression Engine
 * 
 * Pure functions for calculating workout progression, set quality, and warmup protocols.
 * No side effects or database calls - all data passed as input.
 */

import type {
  Exercise,
  ExerciseEntry,
  SetLog,
  SetQuality,
  ProgressionType,
  ProgressionTargets,
  LastSessionPerformance,
  WarmupSet,
  Experience,
  MovementPattern,
  Equipment,
} from '@/types/schema';
import { roundToIncrement } from '@/lib/utils';
import {
  estimateE1RMSimple,
  calculateWorkingWeightSimple,
} from './shared/strengthCalculations';

// ============================================
// TYPE ADAPTERS
// ============================================

/**
 * Convert ExerciseEntry (from mesocycle builder) to Exercise (for progression engine)
 * Derives missing progression fields from pattern and equipment
 */
export function exerciseEntryToExercise(entry: ExerciseEntry): Exercise {
  // Derive mechanic from pattern
  const mechanic = entry.mechanic || (entry.pattern === 'isolation' ? 'isolation' : 'compound');
  
  // Derive default rep range from pattern/equipment/difficulty
  const defaultRepRange = entry.defaultRepRange || getDefaultRepRangeForPattern(entry.pattern, mechanic);
  
  // Derive default RIR from difficulty
  const defaultRir = entry.defaultRir ?? (entry.difficulty === 'advanced' ? 2 : entry.difficulty === 'intermediate' ? 3 : 4);
  
  // Derive minimum weight increment from equipment
  const minWeightIncrementKg = entry.minWeightIncrementKg ?? getMinIncrementForEquipment(entry.equipment);
  
  // Map pattern to movement pattern string
  const movementPattern = typeof entry.pattern === 'string' ? entry.pattern : 'compound';
  
  return {
    id: entry.name.toLowerCase().replace(/\s+/g, '-'),
    name: entry.name,
    primaryMuscle: entry.primaryMuscle,
    secondaryMuscles: entry.secondaryMuscles,
    mechanic,
    defaultRepRange,
    defaultRir,
    minWeightIncrementKg,
    // Additional required fields with defaults
    formCues: [],
    commonMistakes: [],
    setupNote: entry.notes || '',
    movementPattern,
    equipmentRequired: [entry.equipment],
  };
}

/**
 * Get default rep range based on movement pattern
 */
function getDefaultRepRangeForPattern(
  pattern: MovementPattern | 'isolation' | 'carry',
  mechanic: 'compound' | 'isolation'
): [number, number] {
  if (mechanic === 'isolation') return [10, 15];
  
  // Compound movements
  switch (pattern) {
    case 'squat':
    case 'hip_hinge':
      return [5, 8]; // Heavy compounds
    case 'horizontal_push':
    case 'horizontal_pull':
    case 'vertical_push':
    case 'vertical_pull':
      return [6, 10];
    case 'lunge':
      return [8, 12];
    default:
      return [8, 12];
  }
}

/**
 * Get minimum weight increment based on equipment type
 */
function getMinIncrementForEquipment(equipment: Equipment): number {
  switch (equipment) {
    case 'barbell':
      return 2.5; // Standard barbell plates
    case 'dumbbell':
      return 2.0; // Most gyms have 1kg increments per hand
    case 'kettlebell':
      return 4.0; // Kettlebells have larger jumps
    case 'cable':
      return 2.5; // Cable stacks vary
    case 'machine':
      return 2.5; // Machine stacks vary
    case 'bodyweight':
      return 0; // No external load
    default:
      return 2.5;
  }
}

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
// PERIODIZATION PHASES
// ============================================

export type PeriodizationPhase = 'hypertrophy' | 'strength' | 'peaking' | 'deload';

/**
 * Determine periodization phase based on week and model
 */
export function getPeriodizationPhase(
  weekInMeso: number,
  totalWeeks: number,
  model: 'linear' | 'daily_undulating' | 'weekly_undulating' | 'block' = 'linear'
): PeriodizationPhase {
  // Guard against division by zero
  if (totalWeeks <= 0) {
    return 'hypertrophy'; // Default to hypertrophy phase
  }
  const progress = weekInMeso / totalWeeks;
  
  // Deload is always the last week
  if (weekInMeso === totalWeeks) return 'deload';
  
  if (model === 'block') {
    if (progress < 0.5) return 'hypertrophy';
    if (progress < 0.85) return 'strength';
    return 'peaking';
  }
  
  // Linear and undulating use progressive approach
  if (progress < 0.4) return 'hypertrophy';
  if (progress < 0.8) return 'strength';
  return 'peaking';
}

// ============================================
// MAIN PROGRESSION LOGIC
// ============================================

export interface CalculateNextTargetsInput {
  exercise: Exercise;
  lastPerformance: LastSessionPerformance | null;
  experience: Experience;
  weekInMeso: number;
  totalWeeksInMeso?: number;
  isDeloadWeek: boolean;
  readinessScore?: number; // 0-100
  
  // Periodization awareness
  periodizationPhase?: PeriodizationPhase;
  periodizationModel?: 'linear' | 'daily_undulating' | 'weekly_undulating' | 'block';
  weeklyModifiers?: {
    intensityModifier: number;
    volumeModifier: number;
    rpeTarget: { min: number; max: number };
  };
  
  // Calibration data integration
  calibratedE1RM?: number;  // From coaching calibration
  estimatedFromRelated?: number;  // From exercise relationships
  
  // Fatigue tracking
  systemicFatiguePercent?: number;  // Current systemic fatigue level (0-100)
  weeklyFatigueScore?: number;  // Accumulated weekly fatigue (1-10)
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
    totalWeeksInMeso = 6,
    isDeloadWeek,
    readinessScore = 80,
    periodizationPhase,
    periodizationModel = 'linear',
    weeklyModifiers,
    calibratedE1RM,
    estimatedFromRelated,
    systemicFatiguePercent = 0,
    weeklyFatigueScore = 0,
  } = input;

  // Determine current phase if not provided
  const currentPhase = periodizationPhase || getPeriodizationPhase(weekInMeso, totalWeeksInMeso, periodizationModel);
  
  // Adjust rep range based on periodization phase
  const phaseRepRange = getPhaseAdjustedRepRange(exercise.defaultRepRange, currentPhase, exercise.mechanic);
  const phaseRir = getPhaseAdjustedRIR(exercise.defaultRir, currentPhase, weekInMeso, totalWeeksInMeso);

  // Default starting targets
  const baseTargets: ProgressionTargets = {
    weightKg: lastPerformance?.weightKg ?? 0,
    repRange: phaseRepRange,
    targetRir: phaseRir,
    sets: 3,
    restSeconds: getRestSecondsForMechanic(exercise.mechanic),
    progressionType: 'technique',
    reason: 'Starting weights - focus on form and technique',
  };

  // First time doing this exercise - use calibration data if available
  if (!lastPerformance) {
    if (calibratedE1RM) {
      const workingWeight = calculateWorkingWeightFromE1RM(calibratedE1RM, phaseRepRange, phaseRir);
      return {
        ...baseTargets,
        weightKg: workingWeight,
        reason: 'Starting weight based on calibrated strength test',
      };
    }
    
    if (estimatedFromRelated) {
      const workingWeight = calculateWorkingWeightFromE1RM(estimatedFromRelated, phaseRepRange, phaseRir);
      return {
        ...baseTargets,
        weightKg: workingWeight * 0.9, // 10% conservative for estimated
        reason: 'Starting weight estimated from related exercises - starting conservative',
      };
    }
    
    return {
      ...baseTargets,
      reason: 'New exercise - start light and focus on form',
    };
  }

  // Deload week - reduce volume and intensity
  if (isDeloadWeek || currentPhase === 'deload') {
    return calculateDeloadTargets(lastPerformance, exercise);
  }

  // Low readiness - reduce targets
  if (readinessScore < 60) {
    return calculateLowReadinessTargets(lastPerformance, exercise, readinessScore);
  }

  // Analyze last performance to determine progression type
  // Pass phase-adjusted rep range so analysis uses the correct range for the current phase
  const analysis = analyzePerformance(lastPerformance, exercise, phaseRepRange);
  
  // Phase-specific progression logic
  let targets: ProgressionTargets;
  
  if (currentPhase === 'hypertrophy') {
    // Hypertrophy phase: prioritize rep and volume progression over load
    if (analysis.readyForRepProgression) {
      targets = calculateRepProgression(lastPerformance, exercise);
    } else if (analysis.readyForSetProgression && weekInMeso > 1) {
      targets = calculateSetProgression(lastPerformance, exercise, weekInMeso);
    } else if (analysis.readyForLoadProgression) {
      targets = calculateLoadProgression(lastPerformance, exercise, experience, weekInMeso);
    } else {
      targets = {
        weightKg: lastPerformance.weightKg,
        repRange: phaseRepRange,
        targetRir: phaseRir,
        sets: lastPerformance.sets,
        restSeconds: getRestSecondsForMechanic(exercise.mechanic),
        progressionType: 'technique',
        reason: 'Hypertrophy phase - accumulate quality volume',
      };
    }
  } else if (currentPhase === 'strength' || currentPhase === 'peaking') {
    // Strength/Peaking phase: prioritize load progression
    if (analysis.readyForLoadProgression) {
      targets = calculateLoadProgression(lastPerformance, exercise, experience, weekInMeso);
    } else if (analysis.readyForRepProgression) {
      targets = calculateRepProgression(lastPerformance, exercise);
    } else {
      targets = {
        weightKg: lastPerformance.weightKg,
        repRange: phaseRepRange,
        targetRir: phaseRir,
        sets: Math.max(2, lastPerformance.sets - 1), // Slightly lower volume in strength phase
        restSeconds: getRestSecondsForMechanic(exercise.mechanic) + 30, // More rest
        progressionType: 'technique',
        reason: `${currentPhase === 'peaking' ? 'Peaking' : 'Strength'} phase - focus on quality over quantity`,
      };
    }
  } else {
    // Default progression logic
    if (analysis.readyForLoadProgression) {
      targets = calculateLoadProgression(lastPerformance, exercise, experience, weekInMeso);
    } else if (analysis.readyForRepProgression) {
      targets = calculateRepProgression(lastPerformance, exercise);
    } else if (analysis.readyForSetProgression && weekInMeso > 1) {
      targets = calculateSetProgression(lastPerformance, exercise, weekInMeso);
    } else {
      targets = {
        weightKg: lastPerformance.weightKg,
        repRange: phaseRepRange,
        targetRir: phaseRir,
        sets: lastPerformance.sets,
        restSeconds: getRestSecondsForMechanic(exercise.mechanic),
        progressionType: 'technique',
        reason: analysis.reason || 'Consolidate technique at current weight',
      };
    }
  }
  
  // Apply weekly modifiers if provided
  if (weeklyModifiers) {
    targets.weightKg = Math.round(targets.weightKg * weeklyModifiers.intensityModifier * 10) / 10;
    // Ensure sets never goes below 1
    targets.sets = Math.max(1, Math.round(targets.sets * weeklyModifiers.volumeModifier));
    // Safely access rpeTarget with null check
    if (weeklyModifiers.rpeTarget?.max != null) {
      targets.targetRir = Math.max(0, Math.min(4, 10 - weeklyModifiers.rpeTarget.max));
    }
  }
  
  // Adjust for accumulated fatigue
  targets = adjustForFatigue(targets, weeklyFatigueScore, systemicFatiguePercent);
  
  return targets;
}

/**
 * Calculate working weight from estimated 1RM
 * Uses shared strength calculations with local rounding
 */
function calculateWorkingWeightFromE1RM(
  e1rm: number,
  repRange: [number, number],
  targetRir: number
): number {
  const avgReps = Math.round((repRange[0] + repRange[1]) / 2);
  // Use shared calculation for consistency across the codebase
  const workingWeight = calculateWorkingWeightSimple(e1rm, avgReps, targetRir);
  return roundToIncrement(workingWeight, 2.5);
}

/**
 * Adjust rep range based on periodization phase
 */
function getPhaseAdjustedRepRange(
  baseRange: [number, number],
  phase: PeriodizationPhase,
  mechanic: 'compound' | 'isolation'
): [number, number] {
  const isCompound = mechanic === 'compound';
  
  switch (phase) {
    case 'hypertrophy':
      // Higher reps for hypertrophy
      return isCompound 
        ? [Math.max(6, baseRange[0]), Math.min(12, baseRange[1] + 2)]
        : [Math.max(10, baseRange[0] + 2), Math.min(15, baseRange[1] + 3)];
        
    case 'strength':
      // Lower reps for strength
      return isCompound
        ? [Math.max(3, baseRange[0] - 2), Math.min(6, baseRange[1] - 2)]
        : [Math.max(6, baseRange[0]), Math.min(10, baseRange[1])];
        
    case 'peaking':
      // Very low reps for peaking
      return isCompound
        ? [1, 5]
        : [Math.max(4, baseRange[0] - 2), Math.min(8, baseRange[1] - 2)];
        
    case 'deload':
      // Moderate reps, reduced intensity
      return baseRange;
      
    default:
      return baseRange;
  }
}

/**
 * Adjust RIR based on periodization phase and week
 */
function getPhaseAdjustedRIR(
  baseRir: number,
  phase: PeriodizationPhase,
  weekInMeso: number,
  totalWeeks: number
): number {
  // Guard against division by zero
  if (totalWeeks <= 0) {
    return baseRir;
  }
  const progress = weekInMeso / totalWeeks;
  
  switch (phase) {
    case 'hypertrophy':
      // Start conservative, gradually decrease RIR
      return Math.max(1, Math.min(4, Math.round(baseRir - progress * 2)));
      
    case 'strength':
      // Lower RIR for strength
      return Math.max(1, baseRir - 1);
      
    case 'peaking':
      // Very low RIR for peaking
      return Math.max(0, baseRir - 2);
      
    case 'deload':
      // Higher RIR for deload
      return Math.min(5, baseRir + 2);
      
    default:
      return baseRir;
  }
}

/**
 * Adjust progression based on accumulated fatigue
 */
export function adjustForFatigue(
  targets: ProgressionTargets,
  weeklyFatigueScore: number,
  systemicFatiguePercent: number
): ProgressionTargets {
  // High systemic fatigue = more conservative progression
  if (systemicFatiguePercent > 80) {
    return {
      ...targets,
      targetRir: Math.min(4, targets.targetRir + 1),
      reason: targets.reason + ' (adjusted for high systemic fatigue)',
    };
  }
  
  // If weekly fatigue trending up, hold back
  if (weeklyFatigueScore > 7) {
    return {
      ...targets,
      progressionType: 'technique',
      reason: 'High fatigue score - maintaining to allow recovery',
    };
  }
  
  // Moderate fatigue warning
  if (systemicFatiguePercent > 60 || weeklyFatigueScore > 5) {
    return {
      ...targets,
      reason: targets.reason + ' (monitor fatigue levels)',
    };
  }
  
  return targets;
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
  exercise: Exercise,
  phaseRepRange?: [number, number] // Optional phase-adjusted rep range
): PerformanceAnalysis {
  // Use phase-adjusted range if provided, otherwise fall back to default
  const [minReps, maxReps] = phaseRepRange || exercise.defaultRepRange;
  const hitTopOfRange = performance.reps >= maxReps;
  const completedAllSets = performance.allSetsCompleted;
  const averageRpeAppropriate = performance.averageRpe >= 7 && performance.averageRpe <= 9;
  const rpeTooLow = performance.averageRpe < 7; // Weight is too light

  // PRIORITY 1: RPE too low (weight too light) + at/above top of rep range = needs MORE weight
  // This is the clearest signal for load progression - the weight is definitely too light
  if (hitTopOfRange && completedAllSets && rpeTooLow) {
    return {
      readyForLoadProgression: true,
      readyForRepProgression: false,
      readyForSetProgression: false,
      reason: 'Weight too light - RPE indicates significant capacity for heavier load',
    };
  }

  // PRIORITY 2: Standard load progression - hit top of rep range with appropriate RPE (7-9)
  if (hitTopOfRange && completedAllSets && averageRpeAppropriate) {
    return {
      readyForLoadProgression: true,
      readyForRepProgression: false,
      readyForSetProgression: false,
      reason: 'Hit top of rep range with appropriate RPE - ready for weight increase',
    };
  }

  // PRIORITY 3: RPE too low but not at top of range - add reps first, then weight
  if (performance.reps >= minReps && performance.reps < maxReps && completedAllSets && rpeTooLow) {
    return {
      readyForLoadProgression: false,
      readyForRepProgression: true,
      readyForSetProgression: false,
      reason: 'Weight may be light - add reps to reach top of range, then increase weight',
    };
  }

  // PRIORITY 4: Rep progression - in rep range but not at top, normal RPE
  if (performance.reps >= minReps && performance.reps < maxReps && completedAllSets) {
    return {
      readyForLoadProgression: false,
      readyForRepProgression: true,
      readyForSetProgression: false,
      reason: 'Add reps before increasing weight',
    };
  }

  // PRIORITY 5: Set progression - only when at appropriate RPE, not when weight is too light
  if (completedAllSets && averageRpeAppropriate) {
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
  const baseIncrement = exercise.minWeightIncrementKg || 2.5; // Default to 2.5kg if not set

  // Calculate weight increase
  let weightIncrease = baseIncrement * incrementFactor;

  // Cap at max weekly increase, but ensure at least the minimum increment for very light weights
  const maxIncrease = lastPerformance.weightKg * MAX_WEEKLY_WEIGHT_INCREASE;
  // Ensure weight increase is at least the minimum increment when max is very small
  weightIncrease = Math.max(baseIncrement * 0.5, Math.min(weightIncrease, maxIncrease));

  // Round to exercise increment (guard against zero increment)
  const increment = exercise.minWeightIncrementKg || 2.5;
  const newWeight = roundToIncrement(
    lastPerformance.weightKg + weightIncrease,
    increment
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
  /** Barbell type for determining empty bar weight (only used for barbell exercises) */
  barbellType?: 'olympic' | 'womens' | 'ez_curl' | 'trap';
}

/**
 * Get appropriate rest time for a warmup set based on intensity
 * Lighter warmups need less rest, heavier warmups need more
 */
function getWarmupRestSeconds(percentOfWorking: number): number {
  if (percentOfWorking <= 0) return 30;   // Empty bar / general warmup
  if (percentOfWorking <= 40) return 30;  // Very light
  if (percentOfWorking <= 50) return 45;  // Light
  if (percentOfWorking <= 70) return 60;  // Medium
  if (percentOfWorking <= 85) return 75;  // Heavy
  return 90;                               // Very heavy (potentiation)
}

/**
 * Get the barbell weight in kg based on barbell type
 */
function getBarbellWeightKg(barbellType: 'olympic' | 'womens' | 'ez_curl' | 'trap' = 'olympic'): number {
  switch (barbellType) {
    case 'olympic': return 20;
    case 'womens': return 15;
    case 'ez_curl': return 10;
    case 'trap': return 25;
    default: return 20;
  }
}

/**
 * Check if an exercise uses a barbell based on equipment
 */
function isBarbellExercise(exercise: Exercise): boolean {
  return exercise.equipmentRequired?.some(
    (eq) => eq.toLowerCase() === 'barbell' || eq.toLowerCase() === 'olympic barbell'
  ) ?? false;
}

/**
 * Generate a warmup protocol based on working weight
 */
export function generateWarmupProtocol(input: GenerateWarmupInput): WarmupSet[] {
  const { workingWeight, exercise, isFirstExercise, barbellType = 'olympic' } = input;

  const isBarbell = isBarbellExercise(exercise);
  const barbellWeightKg = getBarbellWeightKg(barbellType);

  // No warmup needed for very light weights
  if (workingWeight < 20) {
    return [
      {
        setNumber: 1,
        percentOfWorking: 50,
        targetReps: 10,
        purpose: 'Light activation',
        restSeconds: 30,
      },
    ];
  }

  // Standard warmup protocol
  const protocol: WarmupSet[] = [];

  // Set 1: Empty bar or light warmup (if first exercise, add general warmup)
  // Only barbell exercises can use "empty bar" (0%); other equipment uses a light percentage
  if (isFirstExercise) {
    if (isBarbell) {
      // Barbell exercises: empty bar for general warmup makes sense
      protocol.push({
        setNumber: 1,
        percentOfWorking: 0,
        targetReps: 10,
        purpose: 'General warmup',
        restSeconds: 30,
      });
    } else {
      // Non-barbell exercises (dumbbells, cables, etc.): use light weight, not 0
      // Use 30% of working weight as a minimum meaningful warmup
      protocol.push({
        setNumber: 1,
        percentOfWorking: 30,
        targetReps: 10,
        purpose: 'General warmup',
        restSeconds: 30,
      });
    }
  }

  // For barbell exercises with sufficient working weight, add a bar-only warmup set
  // This helps practice the movement pattern before adding plates
  if (isBarbell && workingWeight > barbellWeightKg * 1.5) {
    // Calculate what percentage of working weight the empty bar represents
    const barPercentOfWorking = Math.round((barbellWeightKg / workingWeight) * 100);

    protocol.push({
      setNumber: protocol.length + 1,
      percentOfWorking: barPercentOfWorking,
      targetReps: 10,
      purpose: 'Bar warmup',
      restSeconds: 30,
      isBarOnly: true,
    } as WarmupSet);
  }

  // Progressive loading warmups
  const warmupPercents = workingWeight >= 100
    ? [30, 50, 70, 85]
    : workingWeight >= 50
    ? [40, 60, 80]
    : [50, 75];

  // Filter out percentages that would be less than or equal to bar weight for barbell exercises
  const filteredPercents = isBarbell
    ? warmupPercents.filter((percent) => {
        const warmupWeight = workingWeight * (percent / 100);
        return warmupWeight > barbellWeightKg;
      })
    : warmupPercents;

  filteredPercents.forEach((percent) => {
    const warmupWeight = roundToIncrement(
      workingWeight * (percent / 100),
      exercise.minWeightIncrementKg
    );

    // Reps decrease as weight increases
    const reps = percent <= 50 ? 8 : percent <= 70 ? 5 : 3;

    let purpose = 'Progressive loading';
    if (percent <= 50) purpose = 'Movement groove';
    else if (percent <= 70) purpose = 'Neuro prep';
    else purpose = 'CNS activation';

    protocol.push({
      setNumber: protocol.length + 1,
      percentOfWorking: percent,
      targetReps: reps,
      purpose,
      restSeconds: getWarmupRestSeconds(percent),
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
 * Uses shared strength calculations for consistency across the codebase
 */
export function calculateE1RM(weight: number, reps: number, rpe: number = 10): number {
  return estimateE1RMSimple(weight, reps, rpe);
}

/**
 * Calculate estimated 1 rep max for bodyweight exercises using effective load
 * The effective load accounts for added weight or assistance
 */
export function calculateBodyweightE1RM(set: SetLog): number {
  // Use effective load if available, otherwise fall back to weightKg
  const effectiveLoad = set.bodyweightData?.effectiveLoadKg || set.weightKg;
  const reps = set.reps;
  const rpe = set.rpe;

  return calculateE1RM(effectiveLoad, reps, rpe);
}

/**
 * Calculate relative strength (effective load / bodyweight) for bodyweight exercises
 * This normalizes strength across different bodyweights
 */
export function calculateRelativeStrength(set: SetLog): number {
  if (!set.bodyweightData) return 1;
  const { effectiveLoadKg, userBodyweightKg } = set.bodyweightData;
  if (userBodyweightKg <= 0) return 1;
  return Math.round((effectiveLoadKg / userBodyweightKg) * 100) / 100;
}

/**
 * Extract performance data from completed sets
 * For bodyweight exercises, uses effective load (bodyweight +/- modifications)
 */
export function extractPerformanceFromSets(
  sets: SetLog[],
  exerciseId: string
): LastSessionPerformance | null {
  const workingSets = sets.filter((s) => !s.isWarmup);

  if (workingSets.length === 0) return null;

  // Get top set based on effective load for bodyweight exercises
  const topSet = workingSets.reduce((best, current) => {
    // Use effective load if available (bodyweight exercises), otherwise weight
    const currentLoad = current.bodyweightData?.effectiveLoadKg || current.weightKg;
    const bestLoad = best.bodyweightData?.effectiveLoadKg || best.weightKg;

    if (currentLoad > bestLoad) return current;
    if (currentLoad === bestLoad && current.reps > best.reps) return current;
    return best;
  });

  const averageRpe =
    workingSets.reduce((sum, s) => sum + s.rpe, 0) / workingSets.length;

  // Use effective load for bodyweight exercises
  const weightKg = topSet.bodyweightData?.effectiveLoadKg || topSet.weightKg;

  return {
    exerciseId,
    weightKg,
    reps: topSet.reps,
    rpe: topSet.rpe,
    sets: workingSets.length,
    allSetsCompleted: true, // Would need target to verify
    averageRpe: Math.round(averageRpe * 10) / 10,
  };
}

/**
 * Extract bodyweight-specific performance data from completed sets
 * Returns data needed for bodyweight exercise progression tracking
 */
export function extractBodyweightPerformance(
  sets: SetLog[],
  exerciseId: string
): {
  performance: LastSessionPerformance | null;
  bodyweightData: {
    modification: 'none' | 'weighted' | 'assisted';
    addedWeightKg?: number;
    assistanceWeightKg?: number;
    userBodyweightKg: number;
    effectiveLoadKg: number;
  } | null;
} {
  const performance = extractPerformanceFromSets(sets, exerciseId);

  const workingSets = sets.filter((s) => !s.isWarmup && s.bodyweightData);
  if (workingSets.length === 0) {
    return { performance, bodyweightData: null };
  }

  // Find the top set (same logic as extractPerformanceFromSets)
  const topSet = workingSets.reduce((best, current) => {
    const currentLoad = current.bodyweightData!.effectiveLoadKg;
    const bestLoad = best.bodyweightData!.effectiveLoadKg;

    if (currentLoad > bestLoad) return current;
    if (currentLoad === bestLoad && current.reps > best.reps) return current;
    return best;
  });

  return {
    performance,
    bodyweightData: {
      modification: topSet.bodyweightData!.modification,
      addedWeightKg: topSet.bodyweightData!.addedWeightKg,
      assistanceWeightKg: topSet.bodyweightData!.assistanceWeightKg,
      userBodyweightKg: topSet.bodyweightData!.userBodyweightKg,
      effectiveLoadKg: topSet.bodyweightData!.effectiveLoadKg,
    },
  };
}

// ============================================
// PR (PERSONAL RECORD) LOGIC WITH FORM QUALITY
// ============================================

import type {
  PRResult,
  PRCriteria,
  FormRating,
  RepsInTank,
  WeightSuggestion,
  FormTrendWarning,
  SessionFormHistory,
} from '@/types/schema';

/**
 * Check if a performance qualifies as a Personal Record
 * PRs with ugly form are NOT counted
 */
export function checkForPR(
  current: PRCriteria,
  previousPR: PRCriteria | null
): PRResult {
  // Calculate E1RM for comparison
  const currentE1RM = calculateE1RM(
    current.weight,
    current.reps,
    current.repsInTank === 4 ? 6 : current.repsInTank === 2 ? 7.5 : current.repsInTank === 1 ? 9 : 10
  );

  // First time doing this exercise
  if (!previousPR) {
    // Even first time, ugly form doesn't count as PR
    if (current.form === 'ugly') {
      return {
        isPR: false,
        reason: 'form_breakdown',
        message: 'First attempt recorded. Work on form before setting your PR baseline.',
      };
    }
    return {
      isPR: true,
      type: 'e1rm',
      reason: 'first_time',
      message: 'First PR set! Great starting point.',
    };
  }

  const previousE1RM = calculateE1RM(
    previousPR.weight,
    previousPR.reps,
    previousPR.repsInTank === 4 ? 6 : previousPR.repsInTank === 2 ? 7.5 : previousPR.repsInTank === 1 ? 9 : 10
  );

  // NO PR if form was ugly
  if (current.form === 'ugly') {
    return {
      isPR: false,
      reason: 'form_breakdown',
      message: 'Great effort! Not counted as PR due to form breakdown.',
    };
  }

  // Form PR: Same or better performance with cleaner form
  if (
    current.form === 'clean' &&
    previousPR.form !== 'clean' &&
    currentE1RM >= previousE1RM * 0.95
  ) {
    return {
      isPR: true,
      type: 'form',
      reason: 'new_pr',
      message: 'Form PR! Same weight with cleaner technique.',
    };
  }

  // Require same or better form to count as PR
  if (current.form === 'some_breakdown' && previousPR.form === 'clean') {
    const improvement = (currentE1RM - previousE1RM) / previousE1RM;
    if (improvement < 0.05) {
      return {
        isPR: false,
        reason: 'form_regression',
        message: 'Matched previous PR but with less clean form.',
      };
    }
    // Significant improvement overcomes form regression
    return {
      isPR: true,
      type: 'e1rm',
      reason: 'new_pr',
      message: `New PR! +${Math.round(improvement * 100)}% despite some form breakdown.`,
      improvement: Math.round(improvement * 100),
    };
  }

  // Standard PR logic for E1RM
  if (currentE1RM > previousE1RM) {
    const improvement = (currentE1RM - previousE1RM) / previousE1RM;
    return {
      isPR: true,
      type: 'e1rm',
      reason: 'new_pr',
      message: `New PR! +${Math.round(improvement * 100)}% improvement.`,
      improvement: Math.round(improvement * 100),
    };
  }

  // Weight PR (heavier weight even with fewer reps)
  if (current.weight > previousPR.weight && current.reps >= previousPR.reps * 0.7) {
    const improvement = (current.weight - previousPR.weight) / previousPR.weight;
    return {
      isPR: true,
      type: 'weight',
      reason: 'new_pr',
      message: `Weight PR! +${Math.round(improvement * 100)}% heavier.`,
      improvement: Math.round(improvement * 100),
    };
  }

  // Reps PR (more reps at same or higher weight)
  if (current.weight >= previousPR.weight && current.reps > previousPR.reps) {
    return {
      isPR: true,
      type: 'reps',
      reason: 'new_pr',
      message: `Rep PR! +${current.reps - previousPR.reps} more reps.`,
      improvement: current.reps - previousPR.reps,
    };
  }

  return {
    isPR: false,
    reason: 'not_better',
    message: 'Good set! Keep pushing for that PR.',
  };
}

// ============================================
// WEIGHT SUGGESTION WITH FORM QUALITY
// ============================================

export interface FormAwareProgressionInput {
  lastSession: {
    weight: number;
    reps: number[];
    repsInTank: RepsInTank[];
    form: FormRating[];
  };
  targetRepRange: [number, number];
  targetRIR: number;
  exerciseMinIncrement: number;
}

/**
 * Calculate suggested weight factoring in form quality
 */
export function calculateSuggestedWeight(
  input: FormAwareProgressionInput
): WeightSuggestion {
  const { lastSession, targetRepRange, targetRIR, exerciseMinIncrement } = input;

  // Guard against empty arrays
  if (lastSession.form.length === 0 || lastSession.repsInTank.length === 0 || lastSession.reps.length === 0) {
    return {
      weight: lastSession.weight,
      reason: 'on_target',
      message: 'Not enough data to calculate suggestion - maintain current weight',
      confidence: 'low',
    };
  }

  // Import form score calculation
  const formScoreHelper = (form: FormRating): number => {
    switch (form) {
      case 'clean':
        return 1.0;
      case 'some_breakdown':
        return 0.5;
      case 'ugly':
        return 0;
    }
  };

  const avgForm =
    lastSession.form.reduce((sum, f) => sum + formScoreHelper(f), 0) / lastSession.form.length;
  const avgRIR =
    lastSession.repsInTank.reduce((sum: number, r: number) => sum + r, 0) / lastSession.repsInTank.length;
  const avgReps = lastSession.reps.reduce((sum, r) => sum + r, 0) / lastSession.reps.length;

  // FORM REGRESSION: Suggest lower weight (avg form < 0.5 means mostly ugly/some breakdown)
  if (avgForm < 0.5) {
    return {
      weight: roundToIncrement(lastSession.weight * 0.9, exerciseMinIncrement),
      reason: 'form_correction',
      message: 'Reducing weight to rebuild clean form',
      confidence: 'high',
    };
  }

  // FORM BREAKDOWN: Hold weight, don't progress (0.5 <= avgForm < 0.8)
  if (avgForm < 0.8) {
    return {
      weight: lastSession.weight,
      reason: 'form_consolidation',
      message: 'Same weight - focus on cleaner reps before progressing',
      confidence: 'high',
    };
  }

  // CLEAN FORM + TOO EASY: Progress (avgRIR > targetRIR + 1)
  if (avgForm >= 0.8 && avgRIR > targetRIR + 1) {
    return {
      weight: roundToIncrement(lastSession.weight + exerciseMinIncrement, exerciseMinIncrement),
      reason: 'progression',
      message: 'Clean form and reps in tank - time to progress!',
      confidence: 'high',
    };
  }

  // CLEAN FORM + ON TARGET: Maintain
  if (avgForm >= 0.8 && avgRIR >= targetRIR - 0.5 && avgRIR <= targetRIR + 1) {
    return {
      weight: lastSession.weight,
      reason: 'on_target',
      message: 'Perfect - stay here until it feels easier',
      confidence: 'high',
    };
  }

  // CLEAN FORM + TOO HARD: Reduce slightly
  if (avgForm >= 0.8 && avgRIR < targetRIR - 0.5) {
    return {
      weight: roundToIncrement(lastSession.weight * 0.95, exerciseMinIncrement),
      reason: 'intensity_reduction',
      message: 'Reps were harder than target - slight reduction',
      confidence: 'medium',
    };
  }

  // Default: maintain weight
  return {
    weight: lastSession.weight,
    reason: 'on_target',
    message: 'Continue at current weight',
    confidence: 'medium',
  };
}

// ============================================
// FORM TREND WARNINGS
// ============================================

/**
 * Check for declining form trends across multiple sessions
 */
export function checkFormTrend(
  exerciseHistory: SessionFormHistory[]
): FormTrendWarning | null {
  if (exerciseHistory.length < 3) return null;

  const recentSessions = exerciseHistory.slice(0, 5);

  // Calculate average form score per session
  const formScoreHelper = (form: FormRating): number => {
    switch (form) {
      case 'clean':
        return 1.0;
      case 'some_breakdown':
        return 0.5;
      case 'ugly':
        return 0;
    }
  };

  const formScores = recentSessions.map((session) => {
    const forms = session.sets.map((s) => s.form);
    return forms.reduce((sum, f) => sum + formScoreHelper(f), 0) / forms.length;
  });

  // Declining form trend (each session worse than 2 sessions ago)
  if (
    formScores.length >= 4 &&
    formScores[0] < formScores[2] &&
    formScores[1] < formScores[3]
  ) {
    return {
      type: 'declining_form',
      message: 'Form has been declining over recent sessions',
      suggestion: 'Consider a 10% deload to rebuild movement quality',
      action: 'deload_suggested',
    };
  }

  // Consistently ugly form (3 sessions in a row with avg < 0.5)
  if (
    formScores.length >= 3 &&
    formScores.slice(0, 3).every((s) => s < 0.5)
  ) {
    return {
      type: 'persistent_breakdown',
      message: 'Form breakdown 3 sessions in a row',
      suggestion: 'Weight may be too heavy - recommending 15% reduction',
      action: 'deload_required',
    };
  }

  return null;
}

/**
 * Get form quality label for display
 */
export function getFormLabel(form: FormRating): string {
  switch (form) {
    case 'clean':
      return 'Clean';
    case 'some_breakdown':
      return 'Some Breakdown';
    case 'ugly':
      return 'Form Breakdown';
  }
}

/**
 * Get form quality color class for display
 */
export function getFormColorClass(form: FormRating): string {
  switch (form) {
    case 'clean':
      return 'text-success-400';
    case 'some_breakdown':
      return 'text-warning-400';
    case 'ugly':
      return 'text-danger-400';
  }
}

