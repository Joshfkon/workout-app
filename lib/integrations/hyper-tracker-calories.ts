/**
 * HyperTracker: Set-Based Workout Calorie Calculator
 * 
 * Philosophy: Calories earned through actual work performed, not time in gym.
 * Accounts for muscle group size, intensity (RPE), rep ranges, and lean body mass.
 */

import type { MuscleGroup } from '@/types/schema';
import type { SetLog } from '@/types/schema';
import type { ExerciseEntry } from '@/types/schema';

// =============================================================================
// TYPES
// =============================================================================

export interface UserProfile {
  weightKg: number;
  bodyFatPercent: number;  // From DEXA or estimate
  sex: 'male' | 'female';
}

export interface LoggedSet {
  muscleGroup: MuscleGroup;
  movementType: MovementType;
  reps: number;
  rpe: number;           // 1-10 scale
  weightKg: number;      // Load used
  restAfterSec: number;  // Rest taken after this set
}

export type MovementType = 'compound' | 'isolation';

export interface WorkoutSummary {
  sets: LoggedSet[];
  totalDurationMin: number;  // For reference only, not primary calc
}

export interface CalorieBreakdown {
  setCalories: number;
  restCalories: number;
  epocCalories: number;
  totalCalories: number;
  metadata: {
    avgIntensity: number;
    totalSets: number;
    effectiveWorkMin: number;
    lbmKg: number;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Muscle Group Multipliers
 * Based on relative muscle mass and metabolic demand
 * Larger muscles = more motor units = more energy
 */
const MUSCLE_GROUP_MULTIPLIER: Record<MuscleGroup, number> = {
  // Large muscle groups (highest energy demand)
  quads: 1.4,
  hamstrings: 1.3,
  glutes: 1.4,
  back: 1.3,
  chest: 1.2,
  
  // Medium muscle groups
  shoulders: 1.0,
  triceps: 0.85,
  biceps: 0.8,
  traps: 0.9,
  
  // Small muscle groups (lowest energy demand)
  calves: 0.7,
  forearms: 0.6,
  abs: 0.75,
  adductors: 0.7,
};

/**
 * Movement Type Multiplier
 * Compounds recruit more total muscle mass and stabilizers
 */
const MOVEMENT_TYPE_MULTIPLIER: Record<MovementType, number> = {
  compound: 1.25,
  isolation: 1.0,
};

/**
 * Rep Range Energy Multiplier
 * More reps = longer time under tension = more metabolic work
 * But diminishing returns at very high reps (less load)
 */
function getRepRangeMultiplier(reps: number): number {
  if (reps <= 5) return 0.85;        // Heavy strength: fewer reps, more neural
  if (reps <= 8) return 1.0;         // Strength-hypertrophy
  if (reps <= 12) return 1.1;        // Hypertrophy sweet spot
  if (reps <= 15) return 1.15;       // Metabolic hypertrophy
  if (reps <= 20) return 1.2;        // High metabolic demand
  return 1.25;                        // 20+ (but load is usually light)
}

/**
 * RPE to Intensity Multiplier
 * Higher RPE = closer to failure = more motor unit recruitment
 */
function getRpeMultiplier(rpe: number): number {
  // Clamp to valid range
  const clampedRpe = Math.max(5, Math.min(10, rpe));
  
  // RPE 5-6: Warmup/easy sets (shouldn't really count much)
  // RPE 7: ~3 RIR, moderate effort
  // RPE 8: ~2 RIR, solid working set
  // RPE 9: ~1 RIR, hard
  // RPE 10: Failure
  
  const rpeMap: Record<number, number> = {
    5: 0.6,
    6: 0.75,
    7: 0.9,
    8: 1.0,    // Baseline "working set"
    9: 1.1,
    10: 1.2,
  };
  
  return rpeMap[Math.round(clampedRpe)] ?? 1.0;
}

/**
 * Base calories per set
 * Research suggests ~5-12 cal per set depending on factors
 * We use 7 as baseline for a "typical" set (RPE 8, moderate muscle group)
 */
const BASE_CALORIES_PER_SET = 7;

/**
 * Rest period calorie rate (cal/min)
 * Elevated metabolism during rest, but much lower than active work
 * ~1.5-2x resting metabolic rate
 */
const REST_CALORIES_PER_MIN = 1.8;

/**
 * Reference LBM for scaling (kg)
 * Based on "average" trained male ~175lb at 15% BF
 */
const REFERENCE_LBM_KG = 67;

// =============================================================================
// CORE CALCULATION FUNCTIONS
// =============================================================================

/**
 * Calculate lean body mass from profile
 */
function calculateLBM(profile: UserProfile): number {
  return profile.weightKg * (1 - profile.bodyFatPercent / 100);
}

/**
 * LBM-based scaling factor
 * More muscle mass = more metabolically active tissue = more calories burned
 */
function getLbmFactor(lbmKg: number): number {
  // Floor at 0.7 to prevent unrealistically low values
  // Cap at 1.5 to prevent unrealistically high values
  const factor = lbmKg / REFERENCE_LBM_KG;
  return Math.max(0.7, Math.min(1.5, factor));
}

/**
 * Calculate calories for a single set
 */
function calculateSetCalories(set: LoggedSet, lbmFactor: number): number {
  const muscleMultiplier = MUSCLE_GROUP_MULTIPLIER[set.muscleGroup];
  const movementMultiplier = MOVEMENT_TYPE_MULTIPLIER[set.movementType];
  const repMultiplier = getRepRangeMultiplier(set.reps);
  const rpeMultiplier = getRpeMultiplier(set.rpe);
  
  const calories = BASE_CALORIES_PER_SET
    * muscleMultiplier
    * movementMultiplier
    * repMultiplier
    * rpeMultiplier
    * lbmFactor;
  
  return Math.round(calories * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate EPOC (Excess Post-Exercise Oxygen Consumption)
 * Based on average workout intensity
 */
function calculateEpoc(baseCalories: number, avgIntensity: number): number {
  // avgIntensity is 0-1 scale based on overall workout RPE
  // EPOC ranges from ~5% (easy) to ~15% (very hard)
  const epocPercent = 0.05 + (avgIntensity * 0.12);
  return baseCalories * epocPercent;
}

/**
 * Estimate "effective work time" per set (seconds)
 * Used for reference, not primary calculation
 */
function estimateSetDuration(reps: number): number {
  // Assume ~3 seconds per rep average (eccentric + concentric + transition)
  return reps * 3;
}

/**
 * Determine if an exercise is compound or isolation based on movement pattern
 */
function isCompoundExercise(pattern: ExerciseEntry['pattern']): boolean {
  // Compound patterns
  const compoundPatterns: ExerciseEntry['pattern'][] = [
    'horizontal_push',
    'horizontal_pull',
    'vertical_push',
    'vertical_pull',
    'hip_hinge',
    'squat',
    'lunge',
    'knee_flexion',
  ];
  
  return compoundPatterns.includes(pattern);
}

// =============================================================================
// MAIN CALCULATION FUNCTION
// =============================================================================

/**
 * Calculate workout calories using set-based approach
 */
export function calculateWorkoutCalories(
  workout: WorkoutSummary,
  profile: UserProfile
): CalorieBreakdown {
  const lbmKg = calculateLBM(profile);
  const lbmFactor = getLbmFactor(lbmKg);
  
  // Calculate calories for each set
  let totalSetCalories = 0;
  let totalRestSeconds = 0;
  let totalRpe = 0;
  let effectiveWorkSeconds = 0;
  
  for (const set of workout.sets) {
    totalSetCalories += calculateSetCalories(set, lbmFactor);
    totalRestSeconds += set.restAfterSec;
    totalRpe += set.rpe;
    effectiveWorkSeconds += estimateSetDuration(set.reps);
  }
  
  // Rest calories (elevated metabolism between sets)
  const restCalories = (totalRestSeconds / 60) * REST_CALORIES_PER_MIN * lbmFactor;
  
  // Average intensity for EPOC calculation
  const avgRpe = workout.sets.length > 0 ? totalRpe / workout.sets.length : 7;
  const avgIntensity = (avgRpe - 5) / 5; // Normalize RPE 5-10 to 0-1
  
  // Base calories (sets + rest)
  const baseCalories = totalSetCalories + restCalories;
  
  // EPOC
  const epocCalories = calculateEpoc(baseCalories, avgIntensity);
  
  // Total
  const totalCalories = baseCalories + epocCalories;
  
  return {
    setCalories: Math.round(totalSetCalories),
    restCalories: Math.round(restCalories),
    epocCalories: Math.round(epocCalories),
    totalCalories: Math.round(totalCalories),
    metadata: {
      avgIntensity: Math.round(avgIntensity * 100) / 100,
      totalSets: workout.sets.length,
      effectiveWorkMin: Math.round(effectiveWorkSeconds / 60 * 10) / 10,
      lbmKg: Math.round(lbmKg * 10) / 10,
    },
  };
}

// =============================================================================
// DATA TRANSFORMATION
// =============================================================================

/**
 * Convert database set logs and exercises to LoggedSet format
 * 
 * @param setLogs - Array of set logs from the database
 * @param exerciseMap - Map from exercise_block_id to ExerciseEntry
 */
export function transformSetsToLoggedSets(
  setLogs: SetLog[],
  exerciseMap: Map<string, ExerciseEntry>
): LoggedSet[] {
  return setLogs
    .filter(set => {
      // Only count working sets (exclude warmups)
      return !set.isWarmup && set.setType !== 'warmup';
    })
    .map(set => {
      const exercise = exerciseMap.get(set.exerciseBlockId);
      if (!exercise) {
        // Fallback if exercise not found - skip this set
        return null;
      }
      
      const movementType: MovementType = isCompoundExercise(exercise.pattern) 
        ? 'compound' 
        : 'isolation';
      
      return {
        muscleGroup: exercise.primaryMuscle,
        movementType,
        reps: set.reps,
        rpe: set.rpe,
        weightKg: set.weightKg,
        restAfterSec: set.restSeconds || 0,
      };
    })
    .filter((set): set is LoggedSet => set !== null);
}

/**
 * Create workout summary from set logs and exercise data
 * 
 * @param setLogs - Array of set logs from the database
 * @param exerciseMap - Map from exercise_block_id to ExerciseEntry
 * @param totalDurationMin - Total workout duration in minutes
 */
export function createWorkoutSummary(
  setLogs: SetLog[],
  exerciseMap: Map<string, ExerciseEntry>,
  totalDurationMin: number
): WorkoutSummary {
  const loggedSets = transformSetsToLoggedSets(setLogs, exerciseMap);
  
  return {
    sets: loggedSets,
    totalDurationMin,
  };
}

