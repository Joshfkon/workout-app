/**
 * AI-Assisted Mesocycle Builder
 * Generates personalized training plans based on user data
 */

import type { Goal, Experience, DexaScan } from '@/types/schema';
import { calculateFFMI, getNaturalFFMILimit } from './bodyCompEngine';

// ============ TYPES ============

export interface UserProfile {
  goal: Goal;
  experience: Experience;
  heightCm: number | null;
  latestDexa: DexaScan | null;
}

export interface MesocycleRecommendation {
  splitType: string;
  splitReason: string;
  daysPerWeek: number;
  totalWeeks: number;
  deloadWeek: number;
  volumePerMuscle: Record<string, number>; // sets per week
  focusMuscles: string[];
  recommendations: string[];
}

export interface WorkoutTemplate {
  dayName: string;
  muscles: string[];
  exercises: ExerciseTemplate[];
}

export interface ExerciseTemplate {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  repRange: [number, number];
  rir: number;
  suggestedWeightKg: number;
  notes: string;
}

// ============ SPLIT RECOMMENDATIONS ============

/**
 * Recommend optimal training split based on days available and goal
 */
export function recommendSplit(daysPerWeek: number, goal: Goal, experience: Experience): { split: string; reason: string } {
  // Full body for beginners or 2-3 days
  if (experience === 'novice' || daysPerWeek <= 3) {
    return {
      split: 'Full Body',
      reason: daysPerWeek <= 3 
        ? 'Full body allows hitting each muscle 2-3x/week with limited days'
        : 'Full body is ideal for novices to practice movements frequently',
    };
  }

  // Upper/Lower for 4 days
  if (daysPerWeek === 4) {
    return {
      split: 'Upper/Lower',
      reason: 'Upper/Lower split hits each muscle 2x/week with good recovery',
    };
  }

  // PPL for 5-6 days
  if (daysPerWeek >= 5) {
    return {
      split: 'PPL',
      reason: 'Push/Pull/Legs allows high frequency and volume for each muscle group',
    };
  }

  return { split: 'Upper/Lower', reason: 'Balanced frequency and recovery' };
}

/**
 * Recommend mesocycle duration based on experience and goal
 */
export function recommendDuration(experience: Experience, goal: Goal): { weeks: number; reason: string } {
  if (goal === 'cut') {
    return {
      weeks: 6,
      reason: 'Shorter blocks during a cut help manage fatigue and diet adherence',
    };
  }

  switch (experience) {
    case 'novice':
      return { weeks: 4, reason: 'Shorter blocks let novices adapt and progress faster' };
    case 'intermediate':
      return { weeks: 6, reason: '6 weeks balances progression and recovery' };
    case 'advanced':
      return { weeks: 8, reason: 'Advanced lifters need longer to accumulate stimulus' };
    default:
      return { weeks: 6, reason: 'Standard mesocycle length' };
  }
}

/**
 * Recommend sets per muscle group per week
 */
export function recommendVolume(
  experience: Experience,
  goal: Goal,
  muscleGroup: string
): number {
  // Base volumes (MAV - Maximum Adaptive Volume estimates)
  const baseVolumes: Record<string, Record<Experience, number>> = {
    chest: { novice: 10, intermediate: 14, advanced: 18 },
    back: { novice: 12, intermediate: 16, advanced: 20 },
    shoulders: { novice: 10, intermediate: 14, advanced: 18 },
    biceps: { novice: 8, intermediate: 12, advanced: 16 },
    triceps: { novice: 8, intermediate: 12, advanced: 16 },
    quads: { novice: 10, intermediate: 14, advanced: 18 },
    hamstrings: { novice: 8, intermediate: 12, advanced: 14 },
    glutes: { novice: 8, intermediate: 12, advanced: 16 },
    calves: { novice: 10, intermediate: 14, advanced: 18 },
    abs: { novice: 8, intermediate: 12, advanced: 16 },
  };

  let volume = baseVolumes[muscleGroup]?.[experience] || 12;

  // Adjust for goal
  if (goal === 'cut') {
    volume = Math.round(volume * 0.7); // Reduce volume during cut to manage recovery
  } else if (goal === 'bulk') {
    volume = Math.round(volume * 1.1); // Slightly increase during surplus
  }

  return volume;
}

// ============ EXERCISE SELECTION ============

/**
 * Get recommended exercises for a muscle group based on goal and available equipment
 */
export function getRecommendedExercises(
  muscleGroup: string,
  mechanic: 'compound' | 'isolation' | 'both' = 'both'
): string[] {
  const exerciseMap: Record<string, { compound: string[]; isolation: string[] }> = {
    chest: {
      compound: ['Barbell Bench Press', 'Dumbbell Bench Press', 'Incline Dumbbell Press'],
      isolation: ['Cable Fly', 'Dumbbell Fly'],
    },
    back: {
      compound: ['Barbell Row', 'Lat Pulldown', 'Pull-Ups', 'Cable Row'],
      isolation: ['Face Pull', 'Straight Arm Pulldown'],
    },
    shoulders: {
      compound: ['Overhead Press', 'Dumbbell Shoulder Press'],
      isolation: ['Lateral Raise', 'Cable Cross Body Lateral Raise', 'Rear Delt Fly'],
    },
    biceps: {
      compound: [],
      isolation: ['Barbell Curl', 'Dumbbell Curl', 'Cable Bicep Curl', 'Hammer Curl'],
    },
    triceps: {
      compound: ['Close Grip Bench Press', 'Dips (Tricep Focus)'],
      isolation: ['Cable Tricep Pushdown', 'Cable Overhead Tricep Extension', 'Skull Crusher'],
    },
    quads: {
      compound: ['Barbell Back Squat', 'Leg Press', 'Hack Squat'],
      isolation: ['Leg Extension'],
    },
    hamstrings: {
      compound: ['Romanian Deadlift', 'Good Morning'],
      isolation: ['Lying Leg Curl', 'Seated Leg Curl'],
    },
    glutes: {
      compound: ['Hip Thrust', 'Bulgarian Split Squat'],
      isolation: ['Hip Abduction Machine', 'Cable Pull Through'],
    },
    calves: {
      compound: [],
      isolation: ['Standing Calf Raise', 'Seated Calf Raise', 'Calf Press Machine'],
    },
    abs: {
      compound: ['Hanging Leg Raise'],
      isolation: ['Cable Crunch', 'Hammer Strength Ab Crunch'],
    },
  };

  const exercises = exerciseMap[muscleGroup] || { compound: [], isolation: [] };
  
  if (mechanic === 'compound') return exercises.compound;
  if (mechanic === 'isolation') return exercises.isolation;
  return [...exercises.compound, ...exercises.isolation];
}

// ============ WEIGHT ESTIMATION ============

/**
 * Estimate starting weights based on body composition and experience
 * Uses lean mass and FFMI-based strength standards
 */
export function estimateStartingWeight(
  exerciseName: string,
  leanMassKg: number,
  experience: Experience
): number {
  // Strength multipliers relative to lean mass (rough estimates for 8-12 rep range)
  const strengthMultipliers: Record<string, Record<Experience, number>> = {
    // Compounds - multiplier of lean mass for working weight
    'Barbell Bench Press': { novice: 0.5, intermediate: 0.75, advanced: 1.0 },
    'Dumbbell Bench Press': { novice: 0.2, intermediate: 0.3, advanced: 0.4 }, // per hand
    'Incline Dumbbell Press': { novice: 0.15, intermediate: 0.25, advanced: 0.35 },
    'Barbell Back Squat': { novice: 0.6, intermediate: 0.9, advanced: 1.2 },
    'Leg Press': { novice: 1.2, intermediate: 1.8, advanced: 2.5 },
    'Romanian Deadlift': { novice: 0.5, intermediate: 0.75, advanced: 1.0 },
    'Barbell Row': { novice: 0.4, intermediate: 0.6, advanced: 0.8 },
    'Overhead Press': { novice: 0.3, intermediate: 0.45, advanced: 0.6 },
    'Lat Pulldown': { novice: 0.5, intermediate: 0.7, advanced: 0.9 },
    
    // Isolations - generally lighter
    'Lateral Raise': { novice: 0.05, intermediate: 0.08, advanced: 0.12 },
    'Cable Fly': { novice: 0.1, intermediate: 0.15, advanced: 0.2 },
    'Leg Extension': { novice: 0.3, intermediate: 0.45, advanced: 0.6 },
    'Leg Curl': { novice: 0.2, intermediate: 0.35, advanced: 0.5 },
    'Barbell Curl': { novice: 0.15, intermediate: 0.25, advanced: 0.35 },
    'Cable Tricep Pushdown': { novice: 0.15, intermediate: 0.25, advanced: 0.35 },
  };

  const multiplier = strengthMultipliers[exerciseName]?.[experience] || 0.3;
  const estimatedWeight = leanMassKg * multiplier;

  // Round to nearest 2.5kg for barbell, 2kg for dumbbells/cables
  const increment = exerciseName.toLowerCase().includes('dumbbell') ? 2 : 2.5;
  return Math.round(estimatedWeight / increment) * increment;
}

// ============ FULL RECOMMENDATION ============

/**
 * Generate complete mesocycle recommendation based on user profile
 */
export function generateMesocycleRecommendation(
  profile: UserProfile,
  daysPerWeek: number
): MesocycleRecommendation {
  const { goal, experience, heightCm, latestDexa } = profile;
  
  const splitRec = recommendSplit(daysPerWeek, goal, experience);
  const durationRec = recommendDuration(experience, goal);
  
  // Calculate volumes for each muscle
  const muscles = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'];
  const volumePerMuscle: Record<string, number> = {};
  muscles.forEach(m => {
    volumePerMuscle[m] = recommendVolume(experience, goal, m);
  });

  // Determine focus muscles based on FFMI and goal
  let focusMuscles: string[] = [];
  const recommendations: string[] = [];

  if (latestDexa && heightCm) {
    const ffmi = calculateFFMI(latestDexa.leanMassKg, heightCm);
    const naturalLimit = getNaturalFFMILimit(experience);
    
    if (ffmi.percentOfLimit > 90) {
      recommendations.push('You\'re near your genetic potential - focus on maintaining and small improvements');
    }
    
    if (latestDexa.bodyFatPercent > 20 && goal === 'bulk') {
      recommendations.push('Consider a mini-cut before continuing to bulk - you\'re above 20% body fat');
    }
    
    if (latestDexa.bodyFatPercent < 12 && goal === 'cut') {
      recommendations.push('You\'re already quite lean - be careful not to cut too aggressively');
    }
  }

  // Goal-specific recommendations
  if (goal === 'bulk') {
    recommendations.push('Prioritize progressive overload - aim to add weight or reps each week');
    recommendations.push('Ensure you\'re in a caloric surplus of 200-400 calories');
    focusMuscles = ['chest', 'back', 'quads']; // Major muscle groups for visual impact
  } else if (goal === 'cut') {
    recommendations.push('Maintain intensity (weight on bar) even as volume decreases');
    recommendations.push('Prioritize protein intake at 2.3-3.1g per kg of lean mass');
    focusMuscles = ['back', 'shoulders', 'glutes']; // Muscles that create shape
  } else {
    recommendations.push('Focus on technique refinement and gradual progression');
    focusMuscles = ['chest', 'back', 'shoulders'];
  }

  return {
    splitType: splitRec.split,
    splitReason: splitRec.reason,
    daysPerWeek,
    totalWeeks: durationRec.weeks,
    deloadWeek: durationRec.weeks,
    volumePerMuscle,
    focusMuscles,
    recommendations,
  };
}

/**
 * Generate workout templates for a split
 */
export function generateWorkoutTemplates(
  splitType: string,
  volumePerMuscle: Record<string, number>,
  leanMassKg: number | null,
  experience: Experience
): WorkoutTemplate[] {
  const templates: WorkoutTemplate[] = [];

  // Define split structures
  const splitStructures: Record<string, { dayName: string; muscles: string[] }[]> = {
    'Full Body': [
      { dayName: 'Full Body A', muscles: ['chest', 'back', 'shoulders', 'quads', 'hamstrings'] },
      { dayName: 'Full Body B', muscles: ['chest', 'back', 'biceps', 'triceps', 'glutes', 'calves'] },
      { dayName: 'Full Body C', muscles: ['shoulders', 'back', 'quads', 'abs'] },
    ],
    'Upper/Lower': [
      { dayName: 'Upper A', muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Upper B', muscles: ['back', 'chest', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull', muscles: ['back', 'biceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
  };

  const structure = splitStructures[splitType] || splitStructures['Upper/Lower'];

  structure.forEach(day => {
    const exercises: ExerciseTemplate[] = [];

    day.muscles.forEach(muscle => {
      const weeklyVolume = volumePerMuscle[muscle] || 12;
      const sessionsPerWeek = splitType === 'PPL' ? 2 : (splitType === 'Full Body' ? 3 : 2);
      const setsThisSession = Math.ceil(weeklyVolume / sessionsPerWeek);

      // Get recommended exercises
      const muscleExercises = getRecommendedExercises(muscle);
      const exerciseCount = Math.min(2, Math.ceil(setsThisSession / 3)); // 2-4 sets per exercise

      for (let i = 0; i < exerciseCount && i < muscleExercises.length; i++) {
        const exerciseName = muscleExercises[i];
        const isCompound = getRecommendedExercises(muscle, 'compound').includes(exerciseName);
        const setsForExercise = Math.ceil(setsThisSession / exerciseCount);

        exercises.push({
          exerciseId: '', // Will be looked up
          exerciseName,
          sets: Math.min(setsForExercise, 4),
          repRange: isCompound ? [6, 10] : [10, 15],
          rir: isCompound ? 2 : 1,
          suggestedWeightKg: leanMassKg ? estimateStartingWeight(exerciseName, leanMassKg, experience) : 0,
          notes: isCompound ? 'Focus on progressive overload' : 'Focus on mind-muscle connection',
        });
      }
    });

    templates.push({
      dayName: day.dayName,
      muscles: day.muscles,
      exercises,
    });
  });

  return templates;
}

