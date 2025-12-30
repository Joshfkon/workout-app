// ============================================================
// WEIGHT ESTIMATION ENGINE
// Intelligently estimates working weights based on:
// - Direct exercise history
// - Related exercise performance
// - Strength standards for experience/FFMI
// - Bodyweight ratios as fallback
// ============================================================

import type { Experience, MuscleGroup, DexaRegionalData, RegionalAnalysis } from '@/types/schema';
import { analyzeRegionalComposition, getAverageRegionalLeanMass } from './regionalAnalysis';

// ============================================================
// TYPES FOR WEIGHT ESTIMATION
// ============================================================

export interface BodyComposition {
  totalWeightKg: number;
  bodyFatPercentage: number;
  leanMassKg: number;
  ffmi: number;
}

export interface ExerciseHistoryEntry {
  exerciseName: string;
  date: Date;
  sets: {
    weight: number;
    reps: number;
    rpe?: number;
    completed: boolean;
  }[];
}

export interface EstimatedMax {
  exercise: string;
  estimated1RM: number;
  confidence: 'high' | 'medium' | 'low' | 'extrapolated';
  source: 'direct_history' | 'related_exercise' | 'strength_standards' | 'bodyweight_ratio' | 'calibration';
  lastUpdated?: Date;
}

export interface WorkingWeightRecommendation {
  exercise: string;
  targetReps: { min: number; max: number };
  targetRIR: number;
  recommendedWeight: number;
  weightRange: { low: number; high: number };
  confidence: 'high' | 'medium' | 'low' | 'find_working_weight';
  rationale: string;
  warmupProtocol?: WarmupSet[];
  findingWeightProtocol?: FindingWeightProtocol;
}

export interface WarmupSet {
  percentOfWorking: number;
  reps: number;
  rest: number;
  notes: string;
}

export interface FindingWeightProtocol {
  startingWeight: number;
  incrementKg: number;
  targetRPE: number;
  maxAttempts: number;
  instructions: string;
}

export interface UserStrengthProfile {
  bodyComposition: BodyComposition;
  experience: Experience;
  trainingAge: number;
  exerciseHistory: ExerciseHistoryEntry[];
  knownMaxes: EstimatedMax[];
  regionalData?: DexaRegionalData;
  regionalAnalysis?: RegionalAnalysis;
}

// ============================================================
// BODY COMPOSITION CALCULATIONS
// ============================================================

export function calculateBodyComposition(
  weightKg: number,
  bodyFatPercentage: number,
  heightCm: number
): BodyComposition {
  const leanMassKg = weightKg * (1 - bodyFatPercentage / 100);
  const heightM = heightCm / 100;
  
  // FFMI = lean mass / height^2 + 6.1 * (1.8 - height)
  const ffmi = (leanMassKg / (heightM * heightM)) + 6.1 * (1.8 - heightM);
  
  return {
    totalWeightKg: weightKg,
    bodyFatPercentage,
    leanMassKg,
    ffmi: Math.round(ffmi * 10) / 10
  };
}

// ============================================================
// EXERCISE RELATIONSHIPS
// ============================================================

interface ExerciseRelationship {
  parent: string;
  ratioToParent: number;
  ratioVariance: number;
  relatedExercises: { exercise: string; ratio: number }[];
}

// Normalize exercise names for fuzzy matching
function normalizeExerciseName(name: string): string {
  return name.toLowerCase()
    .replace(/bent[ -]?over/gi, '')
    .replace(/seated/gi, '')
    .replace(/standing/gi, '')
    .replace(/lying/gi, '')
    .replace(/machine/gi, '')
    .replace(/cable/gi, '')
    .replace(/ez[ -]?bar/gi, 'barbell')
    .replace(/smith[ -]?machine/gi, 'barbell')
    .replace(/dumbbell/gi, 'db')
    .replace(/barbell/gi, 'bb')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find matching exercise in relationships
function findExerciseMatch(exerciseName: string): string | null {
  const normalized = normalizeExerciseName(exerciseName);
  const lowerName = exerciseName.toLowerCase();
  
  // Direct match first
  for (const key of Object.keys(EXERCISE_RELATIONSHIPS)) {
    if (key.toLowerCase() === lowerName) return key;
  }
  
  // Fuzzy match - check if exercise name contains key parts
  const matchPatterns: Record<string, string> = {
    'bench press': 'Barbell Bench Press',
    'incline press': 'Incline Barbell Press',
    'incline bench': 'Incline Barbell Press',
    'overhead press': 'Overhead Press',
    'shoulder press': 'Overhead Press',
    'military press': 'Overhead Press',
    'squat': 'Barbell Back Squat',
    'back squat': 'Barbell Back Squat',
    'front squat': 'Front Squat',
    'leg press': 'Leg Press',
    'deadlift': 'Deadlift',
    'rdl': 'Romanian Deadlift',
    'romanian': 'Romanian Deadlift',
    'row': 'Barbell Row',
    'bent over row': 'Barbell Row',
    'db row': 'Dumbbell Row',
    'dumbbell row': 'Dumbbell Row',
    'pulldown': 'Lat Pulldown',
    'lat pull': 'Lat Pulldown',
    'pull-up': 'Pull-Up',
    'pullup': 'Pull-Up',
    'chin-up': 'Pull-Up',
    'curl': 'Barbell Curl',
    'bicep curl': 'Barbell Curl',
    'hammer curl': 'Hammer Curl',
    'pushdown': 'Tricep Pushdown',
    'tricep push': 'Tricep Pushdown',
    'extension': 'Overhead Tricep Extension',
    'tricep extension': 'Overhead Tricep Extension',
    'lateral raise': 'Lateral Raise',
    'side raise': 'Lateral Raise',
    'face pull': 'Face Pull',
    'leg curl': 'Lying Leg Curl',
    'hamstring curl': 'Lying Leg Curl',
    'leg extension': 'Leg Extension',
    'calf raise': 'Standing Calf Raise',
    'hip thrust': 'Hip Thrust',
    'glute bridge': 'Hip Thrust',
    'fly': 'Cable Fly',
    'chest fly': 'Cable Fly',
    'pec fly': 'Cable Fly',
  };
  
  for (const [pattern, exercise] of Object.entries(matchPatterns)) {
    if (lowerName.includes(pattern)) {
      return exercise;
    }
  }
  
  return null;
}

const EXERCISE_RELATIONSHIPS: Record<string, ExerciseRelationship> = {
  // Chest exercises relative to Barbell Bench Press
  'Barbell Bench Press': {
    parent: 'Barbell Bench Press',
    ratioToParent: 1.0,
    ratioVariance: 0,
    relatedExercises: [
      { exercise: 'Dumbbell Bench Press', ratio: 0.80 },
      { exercise: 'Incline Barbell Press', ratio: 0.80 },
      { exercise: 'Incline Dumbbell Press', ratio: 0.65 },
      { exercise: 'Machine Chest Press', ratio: 0.90 },
      { exercise: 'Close-Grip Bench Press', ratio: 0.85 },
      { exercise: 'Cable Fly', ratio: 0.30 },
    ]
  },
  'Dumbbell Bench Press': {
    parent: 'Barbell Bench Press',
    ratioToParent: 0.80,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Incline Dumbbell Press', ratio: 0.85 },
    ]
  },
  'Incline Barbell Press': {
    parent: 'Barbell Bench Press',
    ratioToParent: 0.80,
    ratioVariance: 0.08,
    relatedExercises: []
  },
  'Incline Dumbbell Press': {
    parent: 'Barbell Bench Press',
    ratioToParent: 0.65,
    ratioVariance: 0.1,
    relatedExercises: []
  },
  // Back exercises
  'Deadlift': {
    parent: 'Deadlift',
    ratioToParent: 1.0,
    ratioVariance: 0,
    relatedExercises: [
      { exercise: 'Romanian Deadlift', ratio: 0.65 },
      { exercise: 'Barbell Row', ratio: 0.55 },
    ]
  },
  'Barbell Row': {
    parent: 'Deadlift',
    ratioToParent: 0.55,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Dumbbell Row', ratio: 0.45 },
      { exercise: 'T-Bar Row', ratio: 0.90 },
      { exercise: 'Seated Cable Row', ratio: 0.75 },
      { exercise: 'Chest-Supported Row', ratio: 0.40 },
    ]
  },
  'Dumbbell Row': {
    parent: 'Barbell Row',
    ratioToParent: 0.45,
    ratioVariance: 0.1,
    relatedExercises: []
  },
  'Lat Pulldown': {
    parent: 'Pull-Up',
    ratioToParent: 0.85,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Seated Cable Row', ratio: 1.0 },
    ]
  },
  // Squat variations
  'Barbell Back Squat': {
    parent: 'Barbell Back Squat',
    ratioToParent: 1.0,
    ratioVariance: 0,
    relatedExercises: [
      { exercise: 'Front Squat', ratio: 0.80 },
      { exercise: 'Leg Press', ratio: 1.8 },
      { exercise: 'Hack Squat', ratio: 1.2 },
      { exercise: 'Bulgarian Split Squat', ratio: 0.35 },
      { exercise: 'Goblet Squat', ratio: 0.35 },
    ]
  },
  'Leg Press': {
    parent: 'Barbell Back Squat',
    ratioToParent: 1.8,
    ratioVariance: 0.3,
    relatedExercises: [
      { exercise: 'Hack Squat', ratio: 0.70 },
    ]
  },
  'Romanian Deadlift': {
    parent: 'Deadlift',
    ratioToParent: 0.65,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Dumbbell RDL', ratio: 0.80 },
    ]
  },
  // Pressing
  'Overhead Press': {
    parent: 'Barbell Bench Press',
    ratioToParent: 0.60,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Dumbbell Shoulder Press', ratio: 0.80 },
    ]
  },
  // Isolation exercises
  'Barbell Curl': {
    parent: 'Barbell Row',
    ratioToParent: 0.35,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Dumbbell Curl', ratio: 0.45 },
      { exercise: 'Hammer Curl', ratio: 0.50 },
      { exercise: 'Cable Curl', ratio: 0.90 },
      { exercise: 'Preacher Curl', ratio: 0.80 },
      { exercise: 'Incline Dumbbell Curl', ratio: 0.40 },
    ]
  },
  'Tricep Pushdown': {
    parent: 'Close-Grip Bench Press',
    ratioToParent: 0.40,
    ratioVariance: 0.15,
    relatedExercises: [
      { exercise: 'Overhead Tricep Extension', ratio: 0.70 },
      { exercise: 'Skull Crusher', ratio: 0.60 },
      { exercise: 'Cable Tricep Pushdown', ratio: 1.0 },
      { exercise: 'Cable Overhead Tricep Extension', ratio: 0.70 },
    ]
  },
  'Lateral Raise': {
    parent: 'Overhead Press',
    ratioToParent: 0.15,
    ratioVariance: 0.05,
    relatedExercises: [
      { exercise: 'Cable Lateral Raise', ratio: 0.80 },
      { exercise: 'Cable Cross Body Lateral Raise', ratio: 0.80 },
      { exercise: 'Reverse Fly', ratio: 0.90 },
    ]
  },
  'Leg Extension': {
    parent: 'Barbell Back Squat',
    ratioToParent: 0.35,
    ratioVariance: 0.1,
    relatedExercises: []
  },
  'Lying Leg Curl': {
    parent: 'Romanian Deadlift',
    ratioToParent: 0.40,
    ratioVariance: 0.1,
    relatedExercises: [
      { exercise: 'Seated Leg Curl', ratio: 0.95 },
    ]
  },
  'Hip Thrust': {
    parent: 'Barbell Back Squat',
    ratioToParent: 1.1,
    ratioVariance: 0.2,
    relatedExercises: []
  },
  'Standing Calf Raise': {
    parent: 'Barbell Back Squat',
    ratioToParent: 0.50,
    ratioVariance: 0.15,
    relatedExercises: [
      { exercise: 'Seated Calf Raise', ratio: 0.60 },
      { exercise: 'Calf Machine', ratio: 1.0 },
    ]
  },
};

// ============================================================
// STRENGTH STANDARDS BY FFMI AND EXPERIENCE
// ============================================================

type FFMIBracket = 'below_average' | 'average' | 'above_average' | 'excellent' | 'elite';

interface StrengthStandards {
  benchPress: number;
  squat: number;
  deadlift: number;
  overheadPress: number;
  barbellRow: number;
}

const STRENGTH_STANDARDS: Record<Experience, Record<FFMIBracket, StrengthStandards>> = {
  novice: {
    below_average: { benchPress: 0.50, squat: 0.70, deadlift: 0.90, overheadPress: 0.35, barbellRow: 0.45 },
    average:       { benchPress: 0.60, squat: 0.80, deadlift: 1.00, overheadPress: 0.40, barbellRow: 0.50 },
    above_average: { benchPress: 0.65, squat: 0.85, deadlift: 1.10, overheadPress: 0.45, barbellRow: 0.55 },
    excellent:     { benchPress: 0.70, squat: 0.90, deadlift: 1.15, overheadPress: 0.50, barbellRow: 0.60 },
    elite:         { benchPress: 0.75, squat: 0.95, deadlift: 1.20, overheadPress: 0.55, barbellRow: 0.65 },
  },
  intermediate: {
    below_average: { benchPress: 0.85, squat: 1.10, deadlift: 1.40, overheadPress: 0.55, barbellRow: 0.70 },
    average:       { benchPress: 1.00, squat: 1.25, deadlift: 1.60, overheadPress: 0.65, barbellRow: 0.80 },
    above_average: { benchPress: 1.10, squat: 1.40, deadlift: 1.75, overheadPress: 0.70, barbellRow: 0.90 },
    excellent:     { benchPress: 1.25, squat: 1.55, deadlift: 1.90, overheadPress: 0.80, barbellRow: 1.00 },
    elite:         { benchPress: 1.35, squat: 1.70, deadlift: 2.05, overheadPress: 0.85, barbellRow: 1.10 },
  },
  advanced: {
    below_average: { benchPress: 1.25, squat: 1.50, deadlift: 1.85, overheadPress: 0.75, barbellRow: 0.95 },
    average:       { benchPress: 1.40, squat: 1.75, deadlift: 2.10, overheadPress: 0.85, barbellRow: 1.10 },
    above_average: { benchPress: 1.55, squat: 1.90, deadlift: 2.30, overheadPress: 0.95, barbellRow: 1.20 },
    excellent:     { benchPress: 1.75, squat: 2.10, deadlift: 2.50, overheadPress: 1.05, barbellRow: 1.35 },
    elite:         { benchPress: 2.00, squat: 2.35, deadlift: 2.80, overheadPress: 1.20, barbellRow: 1.50 },
  }
};

function getFFMIBracket(ffmi: number): FFMIBracket {
  if (ffmi < 18) return 'below_average';
  if (ffmi < 20) return 'average';
  if (ffmi < 22) return 'above_average';
  if (ffmi < 24) return 'excellent';
  return 'elite';
}

// ============================================================
// 1RM ESTIMATION FROM REPS
// ============================================================

/**
 * Estimate 1RM from weight, reps, and optional RPE
 * Uses average of Brzycki, Epley, and Lombardi formulas for accuracy
 * 
 * NOTE: This function is duplicated in lib/training/programEngine.ts
 * Both implementations should be kept in sync. Consider consolidating in the future.
 */
export function estimate1RM(weight: number, reps: number, rpe?: number): number {
  if (reps === 1) return weight;
  if (reps > 12) {
    return weight * (1 + reps / 40);
  }
  
  const effectiveReps = rpe ? reps + (10 - rpe) : reps;
  
  // Multiple formulas for accuracy
  const brzycki = weight * (36 / (37 - effectiveReps));
  const epley = weight * (1 + effectiveReps / 30);
  const lombardi = weight * Math.pow(effectiveReps, 0.10);
  
  const average = (brzycki + epley + lombardi) / 3;
  return Math.round(average * 10) / 10;
}

function calculateWorkingWeight(
  estimated1RM: number,
  targetReps: number,
  targetRIR: number
): number {
  const effectiveReps = targetReps + targetRIR;
  const percentage = (37 - effectiveReps) / 36;
  const safetyMargin = 0.95;
  return Math.round(estimated1RM * percentage * safetyMargin * 10) / 10;
}

// ============================================================
// MAIN WEIGHT ESTIMATION ENGINE
// ============================================================

export class WeightEstimationEngine {
  private profile: UserStrengthProfile;
  private estimatedMaxes: Map<string, EstimatedMax>;
  private unit: 'kg' | 'lb';
  
  constructor(profile: UserStrengthProfile, unit: 'kg' | 'lb' = 'kg') {
    this.profile = profile;
    this.unit = unit;
    this.estimatedMaxes = new Map();
    
    for (const max of profile.knownMaxes) {
      this.estimatedMaxes.set(max.exercise.toLowerCase(), max);
    }
  }
  
  getWorkingWeight(
    exerciseName: string,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    const estimatedMax = this.getEstimated1RM(exerciseName);
    
    if (estimatedMax.confidence === 'high' || estimatedMax.confidence === 'medium') {
      return this.calculateFromKnownMax(exerciseName, estimatedMax, targetReps, targetRIR);
    }
    
    if (estimatedMax.confidence === 'low') {
      return this.calculateFromLowConfidenceMax(exerciseName, estimatedMax, targetReps, targetRIR);
    }
    
    return this.generateFindingWeightProtocol(exerciseName, targetReps, targetRIR);
  }
  
  private getEstimated1RM(exerciseName: string): EstimatedMax {
    const normalizedName = exerciseName.toLowerCase();
    
    if (this.estimatedMaxes.has(normalizedName)) {
      const cached = this.estimatedMaxes.get(normalizedName)!;
      if (cached.lastUpdated && 
          (Date.now() - cached.lastUpdated.getTime()) < 28 * 24 * 60 * 60 * 1000) {
        return cached;
      }
    }
    
    const directEstimate = this.estimateFromDirectHistory(exerciseName);
    if (directEstimate) {
      this.estimatedMaxes.set(normalizedName, directEstimate);
      return directEstimate;
    }
    
    const relatedEstimate = this.estimateFromRelatedExercises(exerciseName);
    if (relatedEstimate) {
      this.estimatedMaxes.set(normalizedName, relatedEstimate);
      return relatedEstimate;
    }
    
    const standardEstimate = this.estimateFromStrengthStandards(exerciseName);
    if (standardEstimate) {
      this.estimatedMaxes.set(normalizedName, standardEstimate);
      return standardEstimate;
    }
    
    return this.estimateFromBodyweight(exerciseName);
  }
  
  private estimateFromDirectHistory(exerciseName: string): EstimatedMax | null {
    const history = this.profile.exerciseHistory.filter(h => 
      h.exerciseName.toLowerCase() === exerciseName.toLowerCase()
    );
    
    if (history.length === 0) return null;
    
    history.sort((a, b) => b.date.getTime() - a.date.getTime());
    
    const recentHistory = history.filter(h => 
      (Date.now() - h.date.getTime()) < 28 * 24 * 60 * 60 * 1000
    );
    
    if (recentHistory.length === 0) {
      const bestSet = this.findBestSet(history[0].sets);
      if (!bestSet) return null;
      
      return {
        exercise: exerciseName,
        estimated1RM: estimate1RM(bestSet.weight, bestSet.reps, bestSet.rpe),
        confidence: 'low',
        source: 'direct_history',
        lastUpdated: history[0].date
      };
    }
    
    const estimates: number[] = [];
    for (const session of recentHistory) {
      for (const set of session.sets) {
        if (set.completed && set.reps >= 1 && set.reps <= 12) {
          estimates.push(estimate1RM(set.weight, set.reps, set.rpe));
        }
      }
    }
    
    if (estimates.length === 0) return null;
    
    estimates.sort((a, b) => b - a);
    const percentile90Index = Math.floor(estimates.length * 0.1);
    const estimated1RM = estimates[percentile90Index] || estimates[0];
    
    return {
      exercise: exerciseName,
      estimated1RM: Math.round(estimated1RM * 10) / 10,
      confidence: recentHistory.length >= 3 ? 'high' : 'medium',
      source: 'direct_history',
      lastUpdated: recentHistory[0].date
    };
  }
  
  private findBestSet(sets: ExerciseHistoryEntry['sets']): ExerciseHistoryEntry['sets'][0] | null {
    let best: ExerciseHistoryEntry['sets'][0] | null = null;
    let bestEstimate = 0;
    
    for (const set of sets) {
      if (set.completed && set.reps >= 1 && set.reps <= 12) {
        const estimate = estimate1RM(set.weight, set.reps, set.rpe);
        if (estimate > bestEstimate) {
          bestEstimate = estimate;
          best = set;
        }
      }
    }
    
    return best;
  }
  
  private estimateFromRelatedExercises(exerciseName: string): EstimatedMax | null {
    const relationship = EXERCISE_RELATIONSHIPS[exerciseName];
    if (!relationship) return null;
    
    if (relationship.parent !== exerciseName) {
      const parentMax = this.estimateFromDirectHistory(relationship.parent);
      if (parentMax && parentMax.confidence !== 'low') {
        return {
          exercise: exerciseName,
          estimated1RM: Math.round(parentMax.estimated1RM * relationship.ratioToParent * 10) / 10,
          confidence: 'medium',
          source: 'related_exercise',
          lastUpdated: parentMax.lastUpdated
        };
      }
    }
    
    for (const related of relationship.relatedExercises) {
      const relatedMax = this.estimateFromDirectHistory(related.exercise);
      if (relatedMax && relatedMax.confidence !== 'low') {
        const relatedRelationship = EXERCISE_RELATIONSHIPS[related.exercise];
        if (relatedRelationship) {
          const conversionRatio = relationship.ratioToParent / relatedRelationship.ratioToParent;
          return {
            exercise: exerciseName,
            estimated1RM: Math.round(relatedMax.estimated1RM * conversionRatio * 10) / 10,
            confidence: 'low',
            source: 'related_exercise',
            lastUpdated: relatedMax.lastUpdated
          };
        }
      }
    }
    
    return null;
  }
  
  private estimateFromStrengthStandards(exerciseName: string): EstimatedMax | null {
    const ffmiBracket = getFFMIBracket(this.profile.bodyComposition.ffmi);
    const standards = STRENGTH_STANDARDS[this.profile.experience][ffmiBracket];
    
    const standardMap: Record<string, keyof StrengthStandards> = {
      'Barbell Bench Press': 'benchPress',
      'Barbell Back Squat': 'squat',
      'Deadlift': 'deadlift',
      'Overhead Press': 'overheadPress',
      'Barbell Row': 'barbellRow',
    };
    
    // Try direct match first
    if (standardMap[exerciseName]) {
      const ratio = standards[standardMap[exerciseName]];
      return {
        exercise: exerciseName,
        estimated1RM: Math.round(this.profile.bodyComposition.totalWeightKg * ratio * 10) / 10,
        confidence: 'low',
        source: 'strength_standards'
      };
    }
    
    // Try fuzzy match
    const matchedExercise = findExerciseMatch(exerciseName);
    
    // Check if matched exercise is in standards
    if (matchedExercise && standardMap[matchedExercise]) {
      const ratio = standards[standardMap[matchedExercise]];
      return {
        exercise: exerciseName,
        estimated1RM: Math.round(this.profile.bodyComposition.totalWeightKg * ratio * 10) / 10,
        confidence: 'low',
        source: 'strength_standards'
      };
    }
    
    // Check direct relationship
    let relationship = EXERCISE_RELATIONSHIPS[exerciseName];
    
    // If no direct relationship, try fuzzy match
    if (!relationship && matchedExercise) {
      relationship = EXERCISE_RELATIONSHIPS[matchedExercise];
    }
    
    if (relationship && standardMap[relationship.parent]) {
      const parentRatio = standards[standardMap[relationship.parent] as keyof StrengthStandards];
      const parent1RM = this.profile.bodyComposition.totalWeightKg * parentRatio;
      return {
        exercise: exerciseName,
        estimated1RM: Math.round(parent1RM * relationship.ratioToParent * 10) / 10,
        confidence: 'low',
        source: 'strength_standards'
      };
    }
    
    return null;
  }
  
  private estimateFromBodyweight(exerciseName: string): EstimatedMax {
    const lowerName = exerciseName.toLowerCase();
    
    // Muscle group based ratios as ultimate fallback
    const muscleGroupRatios: Record<string, number> = {
      'chest': 0.75,      // Based on bench press
      'back': 0.60,       // Based on row
      'shoulders': 0.45,  // Based on OHP
      'biceps': 0.25,     // Based on curl
      'triceps': 0.30,    // Based on pushdown
      'quads': 0.90,      // Based on squat
      'hamstrings': 0.50, // Based on RDL
      'glutes': 0.80,     // Based on hip thrust
      'calves': 0.50,     // Based on calf raise
    };
    
    // Detect muscle group from exercise name
    const getMuscleGroupRatio = (name: string): number => {
      if (name.includes('chest') || name.includes('bench') || name.includes('fly') || name.includes('push')) return muscleGroupRatios.chest;
      if (name.includes('back') || name.includes('row') || name.includes('pull') || name.includes('lat')) return muscleGroupRatios.back;
      if (name.includes('shoulder') || name.includes('delt') || name.includes('raise') || name.includes('press')) return muscleGroupRatios.shoulders;
      if (name.includes('bicep') || name.includes('curl')) return muscleGroupRatios.biceps;
      if (name.includes('tricep') || name.includes('pushdown') || name.includes('extension')) return muscleGroupRatios.triceps;
      if (name.includes('quad') || name.includes('squat') || name.includes('leg press') || name.includes('lunge')) return muscleGroupRatios.quads;
      if (name.includes('hamstring') || name.includes('rdl') || name.includes('leg curl')) return muscleGroupRatios.hamstrings;
      if (name.includes('glute') || name.includes('hip')) return muscleGroupRatios.glutes;
      if (name.includes('calf') || name.includes('calves')) return muscleGroupRatios.calves;
      return 0.30; // Default fallback
    };
    
    const bwRatios: Record<string, number> = {
      'Barbell Curl': 0.25,
      'Dumbbell Curl': 0.10,
      'Hammer Curl': 0.12,
      'Cable Curl': 0.25,
      'Preacher Curl': 0.20,
      'Incline Dumbbell Curl': 0.08,
      'Tricep Pushdown': 0.30,
      'Cable Tricep Pushdown': 0.30,
      'Overhead Tricep Extension': 0.20,
      'Cable Overhead Tricep Extension': 0.20,
      'Skull Crusher': 0.35,
      'Dips': 0.30,
      'Lateral Raise': 0.06,
      'Cable Lateral Raise': 0.08,
      'Cable Cross Body Lateral Raise': 0.08,
      'Face Pull': 0.25,
      'Rear Delt Fly': 0.06,
      'Cable Fly': 0.15,
      'Leg Extension': 0.85,
      'Lying Leg Curl': 0.30,
      'Seated Leg Curl': 0.30,
      'Standing Calf Raise': 0.80,
      'Calf Machine': 0.80,
      'Cable Crunch': 0.40,
      'Hip Abduction Machine': 0.50,
    };
    
    // Try direct match first, then fuzzy match, then muscle group fallback
    let ratio = bwRatios[exerciseName];
    
    if (!ratio) {
      // Try fuzzy matching against keys
      for (const [key, value] of Object.entries(bwRatios)) {
        if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
          ratio = value;
          break;
        }
      }
    }
    
    if (!ratio) {
      // Use muscle group based fallback
      ratio = getMuscleGroupRatio(lowerName);
    }
    
    return {
      exercise: exerciseName,
      estimated1RM: Math.round(this.profile.bodyComposition.totalWeightKg * ratio * 10) / 10,
      confidence: 'extrapolated',
      source: 'bodyweight_ratio'
    };
  }
  
  private calculateFromKnownMax(
    exerciseName: string,
    estimatedMax: EstimatedMax,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    const avgReps = Math.round((targetReps.min + targetReps.max) / 2);
    let workingWeight = calculateWorkingWeight(estimatedMax.estimated1RM, avgReps, targetRIR);
    const variance = estimatedMax.confidence === 'high' ? 0.05 : 0.10;
    
    // Apply regional mass adjustment if available
    let additionalNote = '';
    if (this.profile.regionalData) {
      const regionalAdj = this.adjustForRegionalMass(workingWeight, exerciseName);
      workingWeight = regionalAdj.weight;
      additionalNote = regionalAdj.note;
    }
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: this.roundToNearestPlate(this.unit, workingWeight),
      weightRange: {
        low: this.roundToNearestPlate(this.unit, workingWeight * (1 - variance)),
        high: this.roundToNearestPlate(this.unit, workingWeight * (1 + variance))
      },
      confidence: estimatedMax.confidence as 'high' | 'medium',
      rationale: this.buildRationale(estimatedMax, avgReps, targetRIR) + (additionalNote ? ` ${additionalNote}` : ''),
      warmupProtocol: this.generateWarmupSets(workingWeight, exerciseName)
    };
  }
  
  private calculateFromLowConfidenceMax(
    exerciseName: string,
    estimatedMax: EstimatedMax,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    const avgReps = Math.round((targetReps.min + targetReps.max) / 2);
    const workingWeight = calculateWorkingWeight(estimatedMax.estimated1RM, avgReps, targetRIR);
    const conservativeWeight = workingWeight * 0.85;
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: this.roundToNearestPlate(this.unit, conservativeWeight),
      weightRange: {
        low: this.roundToNearestPlate(this.unit, conservativeWeight * 0.85),
        high: this.roundToNearestPlate(this.unit, workingWeight)
      },
      confidence: 'low',
      rationale: `Estimated from ${estimatedMax.source.replace(/_/g, ' ')}. Start conservative and adjust based on feel.`,
      warmupProtocol: this.generateWarmupSets(conservativeWeight, exerciseName),
      findingWeightProtocol: {
        startingWeight: this.roundToNearestPlate(this.unit, conservativeWeight * 0.7),
        incrementKg: this.getAppropriateIncrement(exerciseName),
        targetRPE: 10 - targetRIR,
        maxAttempts: 4,
        instructions: `Start at ${this.roundToNearestPlate(this.unit, conservativeWeight * 0.7)}kg. Increase by ${this.getAppropriateIncrement(exerciseName)}kg each set until RPE ${10 - targetRIR}.`
      }
    };
  }
  
  private generateFindingWeightProtocol(
    exerciseName: string,
    targetReps: { min: number; max: number },
    targetRIR: number
  ): WorkingWeightRecommendation {
    const bwEstimate = this.estimateFromBodyweight(exerciseName);
    const startWeight = bwEstimate.estimated1RM * 0.5;
    const increment = this.getAppropriateIncrement(exerciseName);
    
    return {
      exercise: exerciseName,
      targetReps,
      targetRIR,
      recommendedWeight: 0,
      weightRange: { low: 0, high: 0 },
      confidence: 'find_working_weight',
      rationale: 'No history available. Use the ramping protocol below to find your working weight.',
      findingWeightProtocol: {
        startingWeight: this.roundToNearestPlate(this.unit, startWeight),
        incrementKg: increment,
        targetRPE: 10 - targetRIR,
        maxAttempts: 5,
        instructions: `Start with ${this.roundToNearestPlate(this.unit, startWeight)}kg for ${targetReps.max} reps. If RPE < ${10 - targetRIR - 1}, add ${increment}kg and try again. Stop when you hit RPE ${10 - targetRIR}.`
      }
    };
  }
  
  private roundToNearestPlate(unit: 'kg' | 'lb', weight: number): number {
    // Import would create circular dependency, so inline the logic
    if (unit === 'lb') {
      // Convert to lb, round to 2.5lb increments, convert back
      const lbs = weight * 2.20462;
      const rounded = Math.round(lbs / 2.5) * 2.5;
      return rounded / 2.20462;
    }
    
    // kg mode: 2.5kg increments
    if (weight < 20) {
      return Math.round(weight);
    }
    return Math.round(weight / 2.5) * 2.5;
  }
  
  private getAppropriateIncrement(exerciseName: string): number {
    const smallMuscleKeywords = [
      'Lateral', 'Curl', 'Tricep', 'Calf', 'Raise', 'Fly', 'Extension'
    ];
    
    if (smallMuscleKeywords.some(k => exerciseName.includes(k))) {
      return 1;
    }
    
    if (exerciseName.includes('Dumbbell')) {
      return 2;
    }
    
    return 2.5;
  }
  
  private generateWarmupSets(workingWeight: number, exerciseName: string): WarmupSet[] {
    const warmups: WarmupSet[] = [];
    
    if (workingWeight < 20) {
      warmups.push({
        percentOfWorking: 0.5,
        reps: 12,
        rest: 60,
        notes: 'Light warmup - focus on movement pattern'
      });
      return warmups;
    }
    
    warmups.push({
      percentOfWorking: 0.4,
      reps: 10,
      rest: 60,
      notes: 'Very light - groove the movement'
    });
    
    warmups.push({
      percentOfWorking: 0.6,
      reps: 6,
      rest: 90,
      notes: 'Building toward working weight'
    });
    
    warmups.push({
      percentOfWorking: 0.8,
      reps: 3,
      rest: 120,
      notes: 'Prime the nervous system'
    });
    
    const heavyCompounds = ['Squat', 'Deadlift', 'Bench Press', 'Overhead Press'];
    if (heavyCompounds.some(c => exerciseName.includes(c)) && workingWeight > 80) {
      warmups.push({
        percentOfWorking: 0.9,
        reps: 1,
        rest: 120,
        notes: 'Final warmup single'
      });
    }
    
    return warmups;
  }
  
  private buildRationale(
    estimatedMax: EstimatedMax,
    targetReps: number,
    targetRIR: number
  ): string {
    const sourceExplanation: Record<EstimatedMax['source'], string> = {
      'direct_history': 'Based on your recent training history',
      'related_exercise': 'Estimated from similar exercises you\'ve done',
      'strength_standards': 'Based on typical strength for your experience level',
      'bodyweight_ratio': 'Rough estimate based on bodyweight',
      'calibration': 'Based on your strength calibration test'
    };
    
    const percentage = Math.round(((37 - (targetReps + targetRIR)) / 36) * 100);
    
    return `${sourceExplanation[estimatedMax.source]}. Est. 1RM: ${estimatedMax.estimated1RM}kg → ${percentage}% for ${targetReps} reps @ ${targetRIR} RIR.`;
  }
  
  // Adjust weight recommendation based on regional lean mass
  private adjustForRegionalMass(
    baseWeight: number,
    exerciseName: string
  ): { weight: number; note: string } {
    if (!this.profile.regionalAnalysis || !this.profile.regionalData) {
      return { weight: baseWeight, note: '' };
    }
    
    const region = this.getExerciseRegion(exerciseName);
    if (!region) return { weight: baseWeight, note: '' };
    
    const userPart = this.profile.regionalAnalysis.parts.find(p => p.name === region);
    if (!userPart) return { weight: baseWeight, note: '' };
    
    // Get average regional lean mass for comparison
    const avgRegional = getAverageRegionalLeanMass(this.profile.bodyComposition.leanMassKg);
    const avgLean = region === 'Arms' ? avgRegional.arms :
                    region === 'Legs' ? avgRegional.legs :
                    avgRegional.trunk;
    
    // Calculate adjustment (60% carryover from lean mass to strength)
    const leanMassRatio = userPart.leanMassKg / avgLean;
    const adjustment = 1 + (leanMassRatio - 1) * 0.6;
    
    const adjustedWeight = Math.round(baseWeight * adjustment * 10) / 10;
    
    let note = '';
    if (adjustment > 1.05) {
      note = `Adjusted +${Math.round((adjustment - 1) * 100)}% based on above-average ${region.toLowerCase()} muscle mass.`;
    } else if (adjustment < 0.95) {
      note = `Adjusted ${Math.round((adjustment - 1) * 100)}% based on below-average ${region.toLowerCase()} muscle mass.`;
    }
    
    return { weight: adjustedWeight, note };
  }
  
  // Get asymmetry adjustment for unilateral exercises
  getAsymmetryAdjustment(
    exerciseName: string,
    side: 'left' | 'right'
  ): { adjustment: number; note: string } {
    if (!this.profile.regionalAnalysis) {
      return { adjustment: 0, note: '' };
    }
    
    const isArmExercise = ['Curl', 'Tricep', 'Press', 'Raise', 'Fly'].some(k => exerciseName.includes(k));
    const isLegExercise = ['Lunge', 'Split', 'Step', 'Leg'].some(k => exerciseName.includes(k));
    
    let asymmetry: number;
    if (isArmExercise) {
      asymmetry = this.profile.regionalAnalysis.asymmetries.arms;
    } else if (isLegExercise) {
      asymmetry = this.profile.regionalAnalysis.asymmetries.legs;
    } else {
      return { adjustment: 0, note: '' };
    }
    
    // Positive asymmetry = right is stronger
    // If doing left side and right is stronger, reduce weight
    const adjustmentPercent = side === 'left' 
      ? (asymmetry > 0 ? -asymmetry / 200 : 0)
      : (asymmetry < 0 ? asymmetry / 200 : 0);
    
    const adjustment = adjustmentPercent;
    
    let note = '';
    if (Math.abs(asymmetry) >= 5) {
      const strongerSide = asymmetry > 0 ? 'right' : 'left';
      const weakerSide = asymmetry > 0 ? 'left' : 'right';
      if (side === weakerSide) {
        note = `Your ${weakerSide} side is ${Math.abs(asymmetry).toFixed(0)}% weaker. Start with this side and match reps on your ${strongerSide}.`;
      }
    }
    
    return { adjustment, note };
  }
  
  private getExerciseRegion(exerciseName: string): 'Arms' | 'Legs' | 'Trunk' | null {
    const armKeywords = ['Curl', 'Tricep', 'Pushdown', 'Extension', 'Kickback'];
    const legKeywords = ['Squat', 'Leg', 'Lunge', 'Calf', 'Hamstring', 'Glute', 'Hip'];
    const trunkKeywords = ['Row', 'Pull', 'Deadlift', 'Press', 'Bench', 'Fly', 'Lat', 'Chest', 'Back'];
    
    if (armKeywords.some(k => exerciseName.includes(k))) return 'Arms';
    if (legKeywords.some(k => exerciseName.includes(k))) return 'Legs';
    if (trunkKeywords.some(k => exerciseName.includes(k))) return 'Trunk';
    return null;
  }
  
  updateFromWorkout(exerciseName: string, sets: ExerciseHistoryEntry['sets']): void {
    const bestSet = this.findBestSet(sets);
    if (!bestSet) return;
    
    const newEstimate = estimate1RM(bestSet.weight, bestSet.reps, bestSet.rpe);
    const existing = this.estimatedMaxes.get(exerciseName.toLowerCase());
    
    // Only update if new estimate is significantly different (5% threshold)
    // This prevents overwriting a better max with a lower one
    if (!existing) {
      // No existing estimate - always add
      this.estimatedMaxes.set(exerciseName.toLowerCase(), {
        exercise: exerciseName,
        estimated1RM: Math.round(newEstimate * 10) / 10,
        confidence: 'high',
        source: 'direct_history',
        lastUpdated: new Date()
      });
    } else {
      // Only update if new estimate is significantly higher (>5%) or significantly lower (<95%)
      // This ensures we track improvements and meaningful declines, but not minor fluctuations
      const isSignificantlyHigher = newEstimate > existing.estimated1RM * 1.05;
      const isSignificantlyLower = newEstimate < existing.estimated1RM * 0.95;
      
      if (isSignificantlyHigher || isSignificantlyLower) {
        this.estimatedMaxes.set(exerciseName.toLowerCase(), {
          exercise: exerciseName,
          estimated1RM: Math.round(newEstimate * 10) / 10,
          confidence: 'high',
          source: 'direct_history',
          lastUpdated: new Date()
        });
      }
    }
  }
}

// ============================================================
// HELPER: Create strength profile from user data
// ============================================================

export function createStrengthProfile(
  heightCm: number,
  weightKg: number,
  bodyFatPercentage: number,
  experience: Experience,
  trainingAge: number,
  exerciseHistory: ExerciseHistoryEntry[] = [],
  regionalData?: DexaRegionalData
): UserStrengthProfile {
  const bodyComp = calculateBodyComposition(weightKg, bodyFatPercentage, heightCm);
  
  const knownMaxes: EstimatedMax[] = [];
  const exerciseNames = Array.from(new Set(exerciseHistory.map(h => h.exerciseName)));
  
  for (const name of exerciseNames) {
    const history = exerciseHistory.filter(h => h.exerciseName === name);
    if (history.length > 0) {
      const recentHistory = history
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 10);
      
      const estimates: number[] = [];
      for (const session of recentHistory) {
        for (const set of session.sets) {
          if (set.completed && set.reps >= 1 && set.reps <= 12) {
            estimates.push(estimate1RM(set.weight, set.reps, set.rpe));
          }
        }
      }
      
      if (estimates.length > 0) {
        estimates.sort((a, b) => b - a);
        const best = estimates[Math.floor(estimates.length * 0.1)] || estimates[0];
        
        knownMaxes.push({
          exercise: name,
          estimated1RM: Math.round(best * 10) / 10,
          confidence: recentHistory.length >= 3 ? 'high' : 'medium',
          source: 'direct_history',
          lastUpdated: recentHistory[0].date
        });
      }
    }
  }
  
  // Calculate regional analysis if regional data provided
  const regionalAnalysis = regionalData 
    ? analyzeRegionalComposition(regionalData, bodyComp.leanMassKg)
    : undefined;
  
  return {
    bodyComposition: bodyComp,
    experience,
    trainingAge,
    exerciseHistory,
    knownMaxes,
    regionalData,
    regionalAnalysis
  };
}

// ============================================================
// QUICK ESTIMATE FOR UI (without full history)
// ============================================================

export function quickWeightEstimate(
  exerciseName: string,
  targetReps: { min: number; max: number },
  targetRIR: number,
  userWeightKg: number,
  heightCm: number,
  bodyFatPercent: number,
  experience: Experience,
  regionalData?: DexaRegionalData,
  unit: 'kg' | 'lb' = 'kg',
  knownE1RM?: number
): WorkingWeightRecommendation {
  const profile = createStrengthProfile(
    heightCm,
    userWeightKg,
    bodyFatPercent,
    experience,
    experience === 'novice' ? 0.5 : experience === 'intermediate' ? 2 : 5,
    [],
    regionalData
  );

  // If we have a known E1RM from exercise history, add it to knownMaxes
  // This takes priority over bodyweight-based estimation
  if (knownE1RM && knownE1RM > 0) {
    profile.knownMaxes.push({
      exercise: exerciseName,
      estimated1RM: knownE1RM,
      confidence: 'high',
      source: 'direct_history',
      lastUpdated: new Date()
    });
  }

  const engine = new WeightEstimationEngine(profile, unit);
  return engine.getWorkingWeight(exerciseName, targetReps, targetRIR);
}

// ============================================================
// CALIBRATED LIFTS INTEGRATION
// ============================================================

/**
 * Creates EstimatedMax entries from calibrated lift data
 * This is used to integrate coaching calibration results with the weight estimation engine
 */
export function createEstimatedMaxesFromCalibration(
  calibratedLifts: Array<{
    lift_name: string;
    estimated_1rm: number;
    tested_at: string;
  }>
): EstimatedMax[] {
  return calibratedLifts.map(lift => ({
    exercise: lift.lift_name,
    estimated1RM: lift.estimated_1rm,
    confidence: 'high' as const,
    source: 'calibration' as const,
    lastUpdated: new Date(lift.tested_at)
  }));
}

/**
 * Quick weight estimate that includes calibrated lifts
 */
export function quickWeightEstimateWithCalibration(
  exerciseName: string,
  targetReps: { min: number; max: number },
  targetRIR: number,
  userWeightKg: number,
  heightCm: number,
  bodyFatPercent: number,
  experience: Experience,
  calibratedLifts: Array<{
    lift_name: string;
    estimated_1rm: number;
    tested_at: string;
  }>,
  regionalData?: DexaRegionalData,
  unit: 'kg' | 'lb' = 'kg',
  knownE1RM?: number
): WorkingWeightRecommendation {
  // Create estimated maxes from calibrated lifts
  const calibratedMaxes = createEstimatedMaxesFromCalibration(calibratedLifts);

  // If we have a known E1RM from exercise history, add it with highest priority
  // This takes precedence over calibrated lifts for this specific exercise
  if (knownE1RM && knownE1RM > 0) {
    calibratedMaxes.push({
      exercise: exerciseName,
      estimated1RM: knownE1RM,
      confidence: 'high',
      source: 'direct_history',
      lastUpdated: new Date()
    });
  }

  const bodyComposition = calculateBodyComposition(userWeightKg, bodyFatPercent, heightCm);

  const profile: UserStrengthProfile = {
    bodyComposition,
    experience,
    trainingAge: experience === 'novice' ? 0.5 : experience === 'intermediate' ? 2 : 5,
    exerciseHistory: [],
    knownMaxes: calibratedMaxes,
    regionalData,
    regionalAnalysis: regionalData ? analyzeRegionalComposition(regionalData, bodyComposition.leanMassKg) : undefined
  };

  const engine = new WeightEstimationEngine(profile, unit);
  return engine.getWorkingWeight(exerciseName, targetReps, targetRIR);
}

