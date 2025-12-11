// ============================================================
// TRAINING SCIENCE CONSTANTS
// Exercise database, benchmarks, fiber profiles, SFR data
// ============================================================

import type { 
  Exercise, 
  BenchmarkLift, 
  FiberType, 
  Equipment, 
  MovementPattern,
  ExerciseRelationship,
  StrengthStandards,
  FFMIBracket,
  Experience,
  WarmupSet,
} from '@/types/training';
import type { MuscleGroup } from '@/types/schema';

// ============================================================
// MUSCLE FIBER TYPE PROFILES
// Affects rep range recommendations
// ============================================================

export const MUSCLE_FIBER_PROFILE: Record<MuscleGroup, FiberType> = {
  chest: 'mixed',
  back: 'mixed',
  shoulders: 'mixed',
  biceps: 'mixed',
  triceps: 'fast',
  quads: 'mixed',
  hamstrings: 'fast',
  glutes: 'mixed',
  calves: 'slow',
  abs: 'slow',
};

// ============================================================
// SYSTEMIC FATIGUE BY MOVEMENT PATTERN
// Higher values = more systemic fatigue
// ============================================================

export const SYSTEMIC_FATIGUE_BY_PATTERN: Record<MovementPattern, number> = {
  hip_hinge: 10,      // Deadlifts are most fatiguing
  squat: 9,           // Squats close second
  lunge: 7,           // Unilateral leg work
  horizontal_pull: 5, // Rows
  vertical_pull: 5,   // Pull-ups
  horizontal_push: 5, // Bench
  vertical_push: 5,   // OHP
  carry: 6,           // Loaded carries
  isolation: 2,       // Curls, extensions etc.
};

// ============================================================
// EQUIPMENT FATIGUE MODIFIER
// Multiplier on base fatigue
// ============================================================

export const EQUIPMENT_FATIGUE_MODIFIER: Record<Equipment, number> = {
  barbell: 1.0,       // Standard
  dumbbell: 0.9,      // Slightly less systemic
  cable: 0.7,         // Lower systemic fatigue
  machine: 0.6,       // Lowest systemic, good for isolation
  bodyweight: 0.8,    // Variable based on exercise
  kettlebell: 0.85,   // Between DB and BB
};

// ============================================================
// BASE STIMULUS-TO-FATIGUE RATIOS (SFR)
// Higher = more muscle stimulus per unit of fatigue
// ============================================================

export const BASE_SFR: Record<MovementPattern, Record<Equipment, number>> = {
  horizontal_push: {
    barbell: 1.0,
    dumbbell: 1.1,
    cable: 1.0,
    machine: 0.95,
    bodyweight: 0.9,
    kettlebell: 0.85,
  },
  horizontal_pull: {
    barbell: 0.95,
    dumbbell: 1.05,
    cable: 1.15,
    machine: 1.1,
    bodyweight: 1.0,
    kettlebell: 0.9,
  },
  vertical_push: {
    barbell: 0.95,
    dumbbell: 1.0,
    cable: 0.9,
    machine: 1.0,
    bodyweight: 0.85,
    kettlebell: 0.85,
  },
  vertical_pull: {
    barbell: 0.9,
    dumbbell: 0.85,
    cable: 1.1,
    machine: 1.05,
    bodyweight: 1.15,
    kettlebell: 0.8,
  },
  squat: {
    barbell: 0.85,
    dumbbell: 0.9,
    cable: 0.7,
    machine: 1.0,
    bodyweight: 0.95,
    kettlebell: 0.85,
  },
  hip_hinge: {
    barbell: 0.75,
    dumbbell: 0.85,
    cable: 0.8,
    machine: 0.9,
    bodyweight: 0.7,
    kettlebell: 0.9,
  },
  lunge: {
    barbell: 0.85,
    dumbbell: 0.95,
    cable: 0.8,
    machine: 0.9,
    bodyweight: 1.0,
    kettlebell: 0.9,
  },
  isolation: {
    barbell: 0.9,
    dumbbell: 1.1,
    cable: 1.2,
    machine: 1.15,
    bodyweight: 0.85,
    kettlebell: 0.95,
  },
  carry: {
    barbell: 0.7,
    dumbbell: 0.8,
    cable: 0.5,
    machine: 0.5,
    bodyweight: 0.6,
    kettlebell: 0.85,
  },
};

// ============================================================
// EXERCISE RELATIONSHIPS
// Used to derive weights from known lifts
// ============================================================

export const EXERCISE_RELATIONSHIPS: Record<string, ExerciseRelationship> = {
  // Bench press family
  'Barbell Bench Press': { parent: 'Barbell Bench Press', ratioToParent: 1.0 },
  'Dumbbell Bench Press': { parent: 'Barbell Bench Press', ratioToParent: 0.8 },
  'Incline Barbell Press': { parent: 'Barbell Bench Press', ratioToParent: 0.75 },
  'Incline Dumbbell Press': { parent: 'Barbell Bench Press', ratioToParent: 0.6 },
  'Machine Chest Press': { parent: 'Barbell Bench Press', ratioToParent: 0.9 },
  'Close-Grip Bench Press': { parent: 'Barbell Bench Press', ratioToParent: 0.85 },
  'Dip': { parent: 'Barbell Bench Press', ratioToParent: 0.75, notes: 'Bodyweight + load' },
  'Cable Fly': { parent: 'Barbell Bench Press', ratioToParent: 0.25 },
  'Push-Up': { parent: 'Barbell Bench Press', ratioToParent: 0.65, notes: 'Bodyweight percentage' },
  
  // Squat family
  'Barbell Back Squat': { parent: 'Barbell Back Squat', ratioToParent: 1.0 },
  'Front Squat': { parent: 'Barbell Back Squat', ratioToParent: 0.8 },
  'Leg Press': { parent: 'Barbell Back Squat', ratioToParent: 2.0, notes: 'Machine advantage' },
  'Hack Squat': { parent: 'Barbell Back Squat', ratioToParent: 1.1 },
  'Bulgarian Split Squat': { parent: 'Barbell Back Squat', ratioToParent: 0.35, notes: 'Per leg' },
  'Walking Lunge': { parent: 'Barbell Back Squat', ratioToParent: 0.3 },
  'Goblet Squat': { parent: 'Barbell Back Squat', ratioToParent: 0.35 },
  'Leg Extension': { parent: 'Barbell Back Squat', ratioToParent: 0.25 },
  
  // Deadlift family
  'Conventional Deadlift': { parent: 'Conventional Deadlift', ratioToParent: 1.0 },
  'Romanian Deadlift': { parent: 'Conventional Deadlift', ratioToParent: 0.6 },
  'Dumbbell RDL': { parent: 'Conventional Deadlift', ratioToParent: 0.45 },
  'Good Morning': { parent: 'Conventional Deadlift', ratioToParent: 0.4 },
  'Hip Thrust': { parent: 'Conventional Deadlift', ratioToParent: 0.7 },
  'Lying Leg Curl': { parent: 'Conventional Deadlift', ratioToParent: 0.2 },
  'Cable Pull-Through': { parent: 'Conventional Deadlift', ratioToParent: 0.25 },
  'Kettlebell Swing': { parent: 'Conventional Deadlift', ratioToParent: 0.3 },
  
  // OHP family
  'Standing Overhead Press': { parent: 'Standing Overhead Press', ratioToParent: 1.0 },
  'Seated Dumbbell Shoulder Press': { parent: 'Standing Overhead Press', ratioToParent: 0.75 },
  'Machine Shoulder Press': { parent: 'Standing Overhead Press', ratioToParent: 0.9 },
  'Arnold Press': { parent: 'Standing Overhead Press', ratioToParent: 0.65 },
  'Lateral Raise': { parent: 'Standing Overhead Press', ratioToParent: 0.15 },
  'Face Pull': { parent: 'Standing Overhead Press', ratioToParent: 0.3 },
  'Reverse Fly': { parent: 'Standing Overhead Press', ratioToParent: 0.15 },
  'Front Raise': { parent: 'Standing Overhead Press', ratioToParent: 0.2 },
  
  // Row family
  'Barbell Row': { parent: 'Barbell Row', ratioToParent: 1.0 },
  'Dumbbell Row': { parent: 'Barbell Row', ratioToParent: 0.5, notes: 'Per arm' },
  'Cable Row': { parent: 'Barbell Row', ratioToParent: 0.8 },
  'Lat Pulldown': { parent: 'Barbell Row', ratioToParent: 0.75 },
  'Pull-Up': { parent: 'Barbell Row', ratioToParent: 0.7, notes: 'Bodyweight + load' },
  'Chin-Up': { parent: 'Barbell Row', ratioToParent: 0.75, notes: 'Bodyweight + load' },
  'T-Bar Row': { parent: 'Barbell Row', ratioToParent: 0.95 },
  
  // Arm exercises
  'Barbell Curl': { parent: 'Barbell Row', ratioToParent: 0.3 },
  'Dumbbell Curl': { parent: 'Barbell Row', ratioToParent: 0.15, notes: 'Per arm' },
  'Hammer Curl': { parent: 'Barbell Row', ratioToParent: 0.16, notes: 'Per arm' },
  'Preacher Curl': { parent: 'Barbell Row', ratioToParent: 0.25 },
  'Cable Curl': { parent: 'Barbell Row', ratioToParent: 0.25 },
  'Tricep Pushdown': { parent: 'Barbell Bench Press', ratioToParent: 0.3 },
  'Overhead Tricep Extension': { parent: 'Barbell Bench Press', ratioToParent: 0.25 },
  'Skull Crusher': { parent: 'Barbell Bench Press', ratioToParent: 0.35 },
};

// ============================================================
// STRENGTH STANDARDS (Bodyweight Ratios)
// by Experience Level and FFMI Bracket
// ============================================================

export const STRENGTH_STANDARDS: Record<Experience, Record<FFMIBracket, StrengthStandards>> = {
  novice: {
    below_average: { benchPress: 0.5, squat: 0.7, deadlift: 0.9, overheadPress: 0.35, barbellRow: 0.4 },
    average: { benchPress: 0.6, squat: 0.8, deadlift: 1.0, overheadPress: 0.4, barbellRow: 0.5 },
    above_average: { benchPress: 0.7, squat: 0.9, deadlift: 1.1, overheadPress: 0.45, barbellRow: 0.55 },
    excellent: { benchPress: 0.75, squat: 1.0, deadlift: 1.2, overheadPress: 0.5, barbellRow: 0.6 },
    elite: { benchPress: 0.8, squat: 1.1, deadlift: 1.3, overheadPress: 0.55, barbellRow: 0.65 },
  },
  intermediate: {
    below_average: { benchPress: 0.8, squat: 1.0, deadlift: 1.3, overheadPress: 0.5, barbellRow: 0.65 },
    average: { benchPress: 1.0, squat: 1.25, deadlift: 1.5, overheadPress: 0.6, barbellRow: 0.8 },
    above_average: { benchPress: 1.15, squat: 1.4, deadlift: 1.7, overheadPress: 0.7, barbellRow: 0.9 },
    excellent: { benchPress: 1.25, squat: 1.5, deadlift: 1.85, overheadPress: 0.75, barbellRow: 1.0 },
    elite: { benchPress: 1.35, squat: 1.65, deadlift: 2.0, overheadPress: 0.85, barbellRow: 1.1 },
  },
  advanced: {
    below_average: { benchPress: 1.2, squat: 1.4, deadlift: 1.7, overheadPress: 0.7, barbellRow: 0.9 },
    average: { benchPress: 1.4, squat: 1.7, deadlift: 2.0, overheadPress: 0.85, barbellRow: 1.1 },
    above_average: { benchPress: 1.55, squat: 1.9, deadlift: 2.25, overheadPress: 0.95, barbellRow: 1.2 },
    excellent: { benchPress: 1.75, squat: 2.1, deadlift: 2.5, overheadPress: 1.05, barbellRow: 1.35 },
    elite: { benchPress: 2.0, squat: 2.4, deadlift: 2.8, overheadPress: 1.2, barbellRow: 1.5 },
  },
};

// ============================================================
// BENCHMARK LIFTS
// For calibration/coaching sessions
// ============================================================

export const BENCHMARK_LIFTS: BenchmarkLift[] = [
  {
    id: 'bench_press',
    name: 'Barbell Bench Press',
    pattern: 'horizontal_push',
    equipment: 'barbell',
    description: 'The standard measure of upper body pushing strength.',
    safetyNotes: 'Use a spotter or safety bars. Do not test to absolute failure without spotters.',
    alternatives: ['Dumbbell Bench Press', 'Machine Chest Press'],
    derivesExercises: [
      'Dumbbell Bench Press', 'Incline Barbell Press', 'Incline Dumbbell Press',
      'Machine Chest Press', 'Close-Grip Bench Press', 'Dip', 'Cable Fly', 'Push-Up'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 40, reps: 10, rest: 60, notes: 'Empty bar or light weight' },
        { percentOfWorking: 60, reps: 5, rest: 90, notes: 'Building up' },
        { percentOfWorking: 80, reps: 3, rest: 120, notes: 'Getting close' },
      ],
      instructions: `Find a weight you can lift for 5 reps with 2 reps left in tank (RPE 8).
1. Start with a weight you know you can handle easily
2. Do 5 reps, assess difficulty
3. If RPE < 7: Add 5-10kg, rest 3 min, try again
4. If RPE 7-8: This is your test weight
5. If RPE > 8: Too heavy, but we can still use this data
Record: Weight × Reps @ RPE`,
      safetyWarnings: [
        'Always use safety bars or a spotter',
        'Do not attempt if you have shoulder injuries',
        'Stop immediately if you feel sharp pain'
      ],
      estimationAccuracy: 0.95
    },
    populationPercentiles: {
      male: { 5: 0.40, 10: 0.50, 25: 0.65, 50: 0.85, 75: 1.10, 90: 1.35, 95: 1.55, 99: 1.85 },
      female: { 5: 0.20, 10: 0.25, 25: 0.35, 50: 0.50, 75: 0.65, 90: 0.80, 95: 0.95, 99: 1.15 }
    }
  },
  {
    id: 'squat',
    name: 'Barbell Back Squat',
    pattern: 'squat',
    equipment: 'barbell',
    description: 'The king of lower body exercises. Tests overall leg strength and core stability.',
    safetyNotes: 'Use a squat rack with safety bars. Depth should be at least parallel.',
    alternatives: ['Leg Press', 'Goblet Squat', 'Hack Squat'],
    derivesExercises: [
      'Front Squat', 'Leg Press', 'Hack Squat', 'Bulgarian Split Squat',
      'Walking Lunge', 'Goblet Squat', 'Leg Extension', 'Hip Thrust'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 30, reps: 10, rest: 60, notes: 'Bodyweight or empty bar' },
        { percentOfWorking: 50, reps: 5, rest: 90, notes: 'Light weight, focus on depth' },
        { percentOfWorking: 70, reps: 3, rest: 120, notes: 'Moderate weight' },
        { percentOfWorking: 85, reps: 2, rest: 150, notes: 'Getting close' },
      ],
      instructions: `Find a weight you can squat for 5 reps with 2 reps left in tank (RPE 8).
Depth requirement: Hip crease must go below the top of your knee.
1. Start conservative - squats are fatiguing
2. Build up in 10-20kg jumps
3. When the bar speed noticeably slows, you're getting close
4. Target: 5 reps where rep 5 is hard but doable for 2 more
Rest 3-4 minutes between attempts.`,
      safetyWarnings: [
        'Always use safety bars set just below your bottom position',
        'Do not attempt with lower back or knee injuries',
        'Keep core braced throughout - never relax at the bottom'
      ],
      estimationAccuracy: 0.93
    },
    populationPercentiles: {
      male: { 5: 0.55, 10: 0.70, 25: 0.90, 50: 1.15, 75: 1.45, 90: 1.75, 95: 2.00, 99: 2.40 },
      female: { 5: 0.30, 10: 0.40, 25: 0.55, 50: 0.75, 75: 1.00, 90: 1.25, 95: 1.45, 99: 1.75 }
    }
  },
  {
    id: 'deadlift',
    name: 'Conventional Deadlift',
    pattern: 'hip_hinge',
    equipment: 'barbell',
    description: 'Tests posterior chain strength - back, glutes, and hamstrings.',
    safetyNotes: 'Keep back neutral. If your lower back rounds significantly, the weight is too heavy.',
    alternatives: ['Romanian Deadlift', 'Trap Bar Deadlift', 'Dumbbell RDL'],
    derivesExercises: [
      'Romanian Deadlift', 'Dumbbell RDL', 'Barbell Row', 'Good Morning',
      'Hip Thrust', 'Lying Leg Curl', 'Cable Pull-Through', 'Kettlebell Swing'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 40, reps: 8, rest: 60, notes: 'Light weight, groove the pattern' },
        { percentOfWorking: 60, reps: 5, rest: 90, notes: 'Building up' },
        { percentOfWorking: 75, reps: 3, rest: 120, notes: 'Moderate-heavy' },
        { percentOfWorking: 85, reps: 1, rest: 150, notes: 'Heavy single' },
      ],
      instructions: `Find a weight you can deadlift for 5 reps with 2 reps left in tank (RPE 8).
Form requirements:
- Bar starts over mid-foot
- Back stays neutral (no rounding)
- Full lockout at top (hips through, shoulders back)
Build up conservatively. Deadlifts are the most fatiguing lift to test.`,
      safetyWarnings: [
        'Stop immediately if lower back rounds',
        'Do not attempt with acute back injuries',
        'Reset between each rep - no touch and go during testing'
      ],
      estimationAccuracy: 0.92
    },
    populationPercentiles: {
      male: { 5: 0.70, 10: 0.90, 25: 1.15, 50: 1.50, 75: 1.85, 90: 2.20, 95: 2.50, 99: 3.00 },
      female: { 5: 0.40, 10: 0.55, 25: 0.75, 50: 1.00, 75: 1.30, 90: 1.60, 95: 1.85, 99: 2.25 }
    }
  },
  {
    id: 'overhead_press',
    name: 'Standing Overhead Press',
    pattern: 'vertical_push',
    equipment: 'barbell',
    description: 'Tests shoulder strength and overhead stability. Strict press - no leg drive.',
    safetyNotes: 'Keep core braced. Do not hyperextend lower back.',
    alternatives: ['Seated Dumbbell Shoulder Press', 'Machine Shoulder Press'],
    derivesExercises: [
      'Seated Dumbbell Shoulder Press', 'Machine Shoulder Press', 'Arnold Press',
      'Lateral Raise', 'Face Pull', 'Reverse Fly', 'Front Raise'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 40, reps: 10, rest: 60, notes: 'Empty bar' },
        { percentOfWorking: 60, reps: 5, rest: 90, notes: 'Light weight' },
        { percentOfWorking: 80, reps: 3, rest: 120, notes: 'Getting close' },
      ],
      instructions: `Find a weight you can press overhead for 5 reps with 2 reps left in tank (RPE 8).
Requirements:
- Strict press only (no leg drive)
- Full lockout at top
- Controlled descent
Start light - OHP is humbling compared to bench press!`,
      safetyWarnings: [
        'Keep core tight throughout',
        'Do not hyperextend back to help lift',
        'Stop if you feel shoulder impingement'
      ],
      estimationAccuracy: 0.94
    },
    populationPercentiles: {
      male: { 5: 0.30, 10: 0.35, 25: 0.45, 50: 0.55, 75: 0.70, 90: 0.85, 95: 0.95, 99: 1.15 },
      female: { 5: 0.15, 10: 0.20, 25: 0.25, 50: 0.35, 75: 0.45, 90: 0.55, 95: 0.65, 99: 0.80 }
    }
  },
  {
    id: 'barbell_row',
    name: 'Barbell Row',
    pattern: 'horizontal_pull',
    equipment: 'barbell',
    description: 'Primary horizontal pulling movement. Tests back thickness and rowing strength.',
    safetyNotes: 'Maintain neutral spine. Some body English is acceptable but avoid excessive swinging.',
    alternatives: ['Dumbbell Row', 'Cable Row', 'T-Bar Row'],
    derivesExercises: [
      'Dumbbell Row', 'Cable Row', 'Lat Pulldown', 'Pull-Up', 'Chin-Up',
      'T-Bar Row', 'Barbell Curl', 'Dumbbell Curl'
    ],
    testingProtocol: {
      type: 'rpe_based',
      targetReps: 5,
      targetRPE: 8,
      warmupProtocol: [
        { percentOfWorking: 40, reps: 10, rest: 60, notes: 'Light weight, establish position' },
        { percentOfWorking: 60, reps: 5, rest: 90, notes: 'Building up' },
        { percentOfWorking: 80, reps: 3, rest: 120, notes: 'Near working weight' },
      ],
      instructions: `Find a weight you can row for 5 reps with 2 reps left in tank (RPE 8).
Form:
- Hinged at hips, back at 45-60° angle
- Pull to lower chest/upper abs
- Controlled eccentric
Some body movement is fine, but shouldn't be swinging wildly.`,
      safetyWarnings: [
        'Maintain hip hinge position throughout',
        'Avoid excessive low back rounding',
        'Control the weight - no dropping'
      ],
      estimationAccuracy: 0.90
    },
    populationPercentiles: {
      male: { 5: 0.35, 10: 0.45, 25: 0.55, 50: 0.70, 75: 0.90, 90: 1.10, 95: 1.25, 99: 1.50 },
      female: { 5: 0.20, 10: 0.25, 25: 0.35, 50: 0.45, 75: 0.60, 90: 0.75, 95: 0.85, 99: 1.05 }
    }
  },
];

// ============================================================
// EXERCISE DATABASE
// ============================================================
/**
 * @deprecated Use exerciseService.ts instead!
 * 
 * This is FALLBACK/SEED DATA only.
 * The source of truth is the Supabase `exercises` table.
 * 
 * For runtime data, use:
 *   import { getExercises, getExercisesForMuscle } from '@/services/exerciseService';
 * 
 * To add new exercises:
 *   1. Add to supabase/seed.sql (for database)
 *   2. Add here (for fallback/offline mode only)
 */
export const EXERCISE_DATABASE: Exercise[] = [
  // Chest
  { name: 'Barbell Bench Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Dumbbell Bench Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Incline Barbell Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Incline Dumbbell Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Machine Chest Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], pattern: 'horizontal_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Cable Fly', primaryMuscle: 'chest', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Dip', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Push-Up', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1 },
  
  // Back
  { name: 'Barbell Row', primaryMuscle: 'back', secondaryMuscles: ['biceps', 'shoulders'], pattern: 'horizontal_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Dumbbell Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Cable Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Lat Pulldown', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Pull-Up', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Chin-Up', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'T-Bar Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Conventional Deadlift', primaryMuscle: 'back', secondaryMuscles: ['hamstrings', 'glutes'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'advanced', fatigueRating: 3 },
  
  // Shoulders
  { name: 'Standing Overhead Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Seated Dumbbell Shoulder Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Machine Shoulder Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Arnold Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'dumbbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Lateral Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Cable Lateral Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Face Pull', primaryMuscle: 'shoulders', secondaryMuscles: ['back'], pattern: 'horizontal_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Reverse Fly', primaryMuscle: 'shoulders', secondaryMuscles: ['back'], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Front Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  
  // Quads
  { name: 'Barbell Back Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'hamstrings'], pattern: 'squat', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 3 },
  { name: 'Front Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'barbell', difficulty: 'advanced', fatigueRating: 3 },
  { name: 'Leg Press', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Hack Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Bulgarian Split Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'lunge', equipment: 'dumbbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Walking Lunge', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'lunge', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Goblet Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Leg Extension', primaryMuscle: 'quads', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  
  // Hamstrings
  { name: 'Romanian Deadlift', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'back'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Dumbbell RDL', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes'], pattern: 'hip_hinge', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Lying Leg Curl', primaryMuscle: 'hamstrings', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Seated Leg Curl', primaryMuscle: 'hamstrings', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Good Morning', primaryMuscle: 'hamstrings', secondaryMuscles: ['back', 'glutes'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'advanced', fatigueRating: 2 },
  
  // Glutes
  { name: 'Hip Thrust', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'beginner', fatigueRating: 2 },
  { name: 'Cable Pull-Through', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Glute Bridge', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Kettlebell Swing', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'back'], pattern: 'hip_hinge', equipment: 'kettlebell', difficulty: 'intermediate', fatigueRating: 2 },
  
  // Biceps
  { name: 'Barbell Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Dumbbell Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Hammer Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Preacher Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Cable Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Incline Dumbbell Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  
  // Triceps
  { name: 'Close-Grip Bench Press', primaryMuscle: 'triceps', secondaryMuscles: ['chest'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2 },
  { name: 'Tricep Pushdown', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Overhead Tricep Extension', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Skull Crusher', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 1 },
  { name: 'Dumbbell Tricep Kickback', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1 },
  
  // Calves
  { name: 'Standing Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Seated Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Leg Press Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1 },
  
  // Abs
  { name: 'Cable Crunch', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1 },
  { name: 'Hanging Leg Raise', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 1 },
  { name: 'Ab Wheel Rollout', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 1 },
  { name: 'Plank', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1 },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

export function getExercisesByMuscle(muscle: MuscleGroup): Exercise[] {
  return EXERCISE_DATABASE.filter(e => e.primaryMuscle === muscle);
}

export function getExercisesByPattern(pattern: MovementPattern): Exercise[] {
  return EXERCISE_DATABASE.filter(e => e.pattern === pattern);
}

export function getExercisesByEquipment(equipment: Equipment): Exercise[] {
  return EXERCISE_DATABASE.filter(e => e.equipment === equipment);
}

export function getBenchmarkById(id: string): BenchmarkLift | undefined {
  return BENCHMARK_LIFTS.find(b => b.id === id);
}

export function getExerciseRelationship(exerciseName: string): ExerciseRelationship | undefined {
  return EXERCISE_RELATIONSHIPS[exerciseName];
}

export function getSFR(pattern: MovementPattern, equipment: Equipment): number {
  return BASE_SFR[pattern]?.[equipment] ?? 1.0;
}

export function getSystemicFatigue(pattern: MovementPattern, equipment: Equipment): number {
  const baseFatigue = SYSTEMIC_FATIGUE_BY_PATTERN[pattern] ?? 5;
  const modifier = EQUIPMENT_FATIGUE_MODIFIER[equipment] ?? 1.0;
  return baseFatigue * modifier;
}

