/**
 * Exercise Service
 * 
 * Single source of truth for exercise data.
 * Fetches from Supabase with in-memory caching.
 * Falls back to constants if database is unavailable.
 */

import { createUntypedClient } from '@/lib/supabase/client';
import type { 
  MuscleGroup, 
  Equipment, 
  MovementPattern,
  ExerciseDifficulty,
  FatigueRating,
  HypertrophyScore,
  HypertrophyTier,
  HypertrophyRating 
} from '@/types/schema';

// ============================================
// TYPES
// ============================================

export interface Exercise {
  id: string;
  name: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  pattern: MovementPattern | 'isolation' | 'carry';
  equipment: Equipment;
  difficulty: ExerciseDifficulty;
  fatigueRating: FatigueRating;
  
  // Progression fields
  defaultRepRange: [number, number];
  defaultRir: number;
  minWeightIncrementKg: number;
  
  // Metadata
  mechanic: 'compound' | 'isolation';
  isCustom: boolean;
  createdBy?: string;
  notes?: string;
  
  // Hypertrophy scoring (Nippard methodology)
  hypertrophyScore: HypertrophyScore;
}

// Re-export hypertrophy types for convenience
export type { HypertrophyScore, HypertrophyTier, HypertrophyRating };

// Re-export for convenience
export type { MuscleGroup, Equipment, MovementPattern };

// ============================================
// CACHE
// ============================================

let exerciseCache: Exercise[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear the exercise cache (useful after creating custom exercises)
 */
export function clearExerciseCache(): void {
  exerciseCache = null;
  cacheTimestamp = 0;
}

// ============================================
// MAIN API
// ============================================

/**
 * Get all exercises (from cache, DB, or fallback)
 */
export async function getExercises(includeCustom: boolean = true): Promise<Exercise[]> {
  // Return cache if fresh
  if (exerciseCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return includeCustom 
      ? exerciseCache 
      : exerciseCache.filter(e => !e.isCustom);
  }
  
  try {
    const supabase = createUntypedClient();
    const { data, error } = await supabase
      .from('exercises')
      .select('*')
      .order('name');
    
    if (error || !data) {
      console.warn('Failed to load exercises from DB, using fallback:', error);
      return getFallbackExercises();
    }
    
    const exercises = data.map(mapDbExercise);
    exerciseCache = exercises;
    cacheTimestamp = Date.now();
    
    return includeCustom 
      ? exercises 
      : exercises.filter((e: Exercise) => !e.isCustom);
  } catch (err) {
    console.warn('Error fetching exercises:', err);
    return getFallbackExercises();
  }
}

/**
 * Get exercises for a specific muscle group
 */
export async function getExercisesForMuscle(
  muscle: MuscleGroup,
  equipment?: Equipment[],
  includeSecondary: boolean = false
): Promise<Exercise[]> {
  const all = await getExercises();
  return all.filter(e => {
    // Primary muscle match
    const muscleMatch = e.primaryMuscle === muscle || 
      (includeSecondary && e.secondaryMuscles.includes(muscle));
    
    // Equipment filter
    const equipmentMatch = !equipment || equipment.length === 0 || 
      equipment.includes(e.equipment);
    
    return muscleMatch && equipmentMatch;
  });
}

/**
 * Get exercise by ID
 */
export async function getExerciseById(id: string): Promise<Exercise | null> {
  const all = await getExercises();
  return all.find(e => e.id === id) || null;
}

/**
 * Get exercise by name (case-insensitive)
 */
export async function getExerciseByName(name: string): Promise<Exercise | null> {
  const all = await getExercises();
  return all.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Get exercises by pattern (e.g., all squat movements)
 */
export async function getExercisesByPattern(
  pattern: MovementPattern | 'isolation' | 'carry',
  equipment?: Equipment[]
): Promise<Exercise[]> {
  const all = await getExercises();
  return all.filter(e => {
    const patternMatch = e.pattern === pattern;
    const equipmentMatch = !equipment || equipment.length === 0 || 
      equipment.includes(e.equipment);
    return patternMatch && equipmentMatch;
  });
}

/**
 * Search exercises by name
 */
export async function searchExercises(
  query: string,
  muscle?: MuscleGroup,
  equipment?: Equipment[]
): Promise<Exercise[]> {
  const all = await getExercises();
  const lowerQuery = query.toLowerCase();
  
  return all.filter(e => {
    const nameMatch = e.name.toLowerCase().includes(lowerQuery);
    const muscleMatch = !muscle || e.primaryMuscle === muscle;
    const equipmentMatch = !equipment || equipment.length === 0 || 
      equipment.includes(e.equipment);
    return nameMatch && muscleMatch && equipmentMatch;
  });
}

/**
 * Get compound exercises for a muscle
 */
export async function getCompoundExercises(
  muscle: MuscleGroup,
  equipment?: Equipment[]
): Promise<Exercise[]> {
  const exercises = await getExercisesForMuscle(muscle, equipment);
  return exercises.filter(e => e.mechanic === 'compound');
}

/**
 * Get isolation exercises for a muscle
 */
export async function getIsolationExercises(
  muscle: MuscleGroup,
  equipment?: Equipment[]
): Promise<Exercise[]> {
  const exercises = await getExercisesForMuscle(muscle, equipment);
  return exercises.filter(e => e.mechanic === 'isolation');
}

/**
 * Create a custom exercise
 */
export async function createCustomExercise(
  exercise: Omit<Exercise, 'id' | 'isCustom' | 'createdBy'>,
  userId: string
): Promise<Exercise | null> {
  try {
    const supabase = createUntypedClient();
    
    const { data, error } = await supabase
      .from('exercises')
      .insert({
        name: exercise.name,
        primary_muscle: exercise.primaryMuscle,
        secondary_muscles: exercise.secondaryMuscles,
        mechanic: exercise.mechanic,
        pattern: exercise.pattern,
        equipment: exercise.equipment,
        difficulty: exercise.difficulty,
        fatigue_rating: exercise.fatigueRating,
        default_rep_range: exercise.defaultRepRange,
        default_rir: exercise.defaultRir,
        min_weight_increment_kg: exercise.minWeightIncrementKg,
        movement_pattern: exercise.pattern,
        equipment_required: [exercise.equipment],
        is_custom: true,
        created_by: userId,
        notes: exercise.notes || '',
      })
      .select()
      .single();
    
    if (error || !data) {
      console.error('Failed to create custom exercise:', error);
      return null;
    }
    
    // Clear cache so new exercise shows up
    clearExerciseCache();
    
    return mapDbExercise(data);
  } catch (err) {
    console.error('Error creating custom exercise:', err);
    return null;
  }
}

/**
 * Delete a custom exercise
 */
export async function deleteCustomExercise(
  exerciseId: string,
  userId: string
): Promise<boolean> {
  try {
    const supabase = createUntypedClient();
    
    const { error } = await supabase
      .from('exercises')
      .delete()
      .eq('id', exerciseId)
      .eq('created_by', userId)
      .eq('is_custom', true);
    
    if (error) {
      console.error('Failed to delete custom exercise:', error);
      return false;
    }
    
    clearExerciseCache();
    return true;
  } catch (err) {
    console.error('Error deleting custom exercise:', err);
    return false;
  }
}

// ============================================
// MAPPING HELPERS
// ============================================

/**
 * Map database row to Exercise type
 */
function mapDbExercise(row: Record<string, unknown>): Exercise {
  const mechanic = (row.mechanic as string) || 'compound';
  const pattern = (row.pattern as string) || (row.movement_pattern as string) || derivePattern(row);
  
  return {
    id: row.id as string,
    name: row.name as string,
    primaryMuscle: row.primary_muscle as MuscleGroup,
    secondaryMuscles: (row.secondary_muscles as MuscleGroup[]) || [],
    pattern: pattern as MovementPattern | 'isolation' | 'carry',
    equipment: (row.equipment as Equipment) || getFirstEquipment(row),
    difficulty: (row.difficulty as ExerciseDifficulty) || 'intermediate',
    fatigueRating: (row.fatigue_rating as FatigueRating) || 2,
    defaultRepRange: parseRepRange(row.default_rep_range) || [8, 12],
    defaultRir: (row.default_rir as number) || 2,
    minWeightIncrementKg: (row.min_weight_increment_kg as number) || getDefaultIncrement(row.equipment as Equipment),
    mechanic: mechanic as 'compound' | 'isolation',
    isCustom: (row.is_custom as boolean) || false,
    createdBy: row.created_by as string | undefined,
    notes: row.notes as string | undefined,
    hypertrophyScore: {
      tier: (row.hypertrophy_tier as HypertrophyTier) || 'C',
      stretchUnderLoad: (row.stretch_under_load as HypertrophyRating) || 3,
      resistanceProfile: (row.resistance_profile as HypertrophyRating) || 3,
      progressionEase: (row.progression_ease as HypertrophyRating) || 3,
    },
  };
}

function getFirstEquipment(row: Record<string, unknown>): Equipment {
  const required = row.equipment_required as string[];
  if (required && required.length > 0) {
    return required[0] as Equipment;
  }
  return 'barbell';
}

function getDefaultIncrement(equipment: Equipment): number {
  switch (equipment) {
    case 'barbell': return 2.5;
    case 'dumbbell': return 2.0;
    case 'kettlebell': return 4.0;
    case 'cable': return 2.5;
    case 'machine': return 5.0;
    case 'bodyweight': return 0;
    default: return 2.5;
  }
}

function derivePattern(row: Record<string, unknown>): string {
  const movementPattern = row.movement_pattern as string;
  if (movementPattern) return movementPattern;
  
  const mechanic = row.mechanic as string;
  if (mechanic === 'isolation') return 'isolation';
  
  // Derive from muscle
  const muscle = row.primary_muscle as string;
  if (['quads', 'glutes'].includes(muscle)) return 'squat';
  if (muscle === 'hamstrings') return 'hip_hinge';
  if (muscle === 'chest') return 'horizontal_push';
  if (muscle === 'back') return 'horizontal_pull';
  if (muscle === 'shoulders') return 'vertical_push';
  if (['biceps', 'triceps'].includes(muscle)) return 'isolation';
  
  return 'compound';
}

function parseRepRange(range: unknown): [number, number] | null {
  if (!range) return null;
  
  // Handle array format [8, 12]
  if (Array.isArray(range) && range.length >= 2) {
    return [Number(range[0]), Number(range[1])];
  }
  
  // Handle PostgreSQL int4range format "[8,12)"
  if (typeof range === 'string') {
    const match = range.match(/\[(\d+),(\d+)\)/);
    if (match) return [parseInt(match[1]), parseInt(match[2])];
  }
  
  return null;
}

// ============================================
// FALLBACK DATA
// ============================================

/**
 * Fallback exercises when database is unavailable
 * This data is also used for seeding
 */
function getFallbackExercises(): Exercise[] {
  return FALLBACK_EXERCISES;
}

const FALLBACK_EXERCISES: Exercise[] = [
  // CHEST
  { id: 'bench-press', name: 'Barbell Bench Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 10], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 5 } },
  { id: 'db-bench-press', name: 'Dumbbell Bench Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'incline-bench', name: 'Incline Barbell Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 10], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 5 } },
  { id: 'incline-db-press', name: 'Incline Dumbbell Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'decline-bench', name: 'Decline Barbell Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 10], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'machine-chest-press', name: 'Machine Chest Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps'], pattern: 'horizontal_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'smith-bench', name: 'Smith Machine Bench Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'smith-incline', name: 'Smith Machine Incline Press', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'cable-fly', name: 'Cable Fly', primaryMuscle: 'chest', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'pec-deck', name: 'Pec Deck', primaryMuscle: 'chest', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'dip', name: 'Dip', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'push-up', name: 'Push-Up', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], pattern: 'horizontal_push', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 20], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 2 } },
  
  // BACK
  { id: 'barbell-row', name: 'Barbell Row', primaryMuscle: 'back', secondaryMuscles: ['biceps', 'shoulders'], pattern: 'horizontal_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 10], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 4 } },
  { id: 'db-row', name: 'Dumbbell Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'cable-row', name: 'Cable Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'machine-row', name: 'Seated Machine Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'chest-supported-row', name: 'Chest Supported Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'lat-pulldown', name: 'Lat Pulldown', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'close-grip-pulldown', name: 'Close Grip Lat Pulldown', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'pull-up', name: 'Pull-Up', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 12], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 3 } },
  { id: 'chin-up', name: 'Chin-Up', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 12], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 3 } },
  { id: 'assisted-pullup', name: 'Assisted Pull-Up Machine', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'vertical_pull', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 4 } },
  { id: 't-bar-row', name: 'T-Bar Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'straight-arm-pulldown', name: 'Straight Arm Pulldown', primaryMuscle: 'back', secondaryMuscles: [], pattern: 'vertical_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'hyperextension', name: 'Back Extension', primaryMuscle: 'back', secondaryMuscles: ['hamstrings', 'glutes'], pattern: 'hip_hinge', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 3 } },
  { id: 'deadlift', name: 'Conventional Deadlift', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'back', 'quads'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'advanced', fatigueRating: 3, defaultRepRange: [4, 8], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 5 } },
  
  // SHOULDERS
  { id: 'ohp', name: 'Standing Overhead Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 10], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'seated-db-press', name: 'Seated Dumbbell Shoulder Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'smith-ohp', name: 'Smith Machine Shoulder Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'arnold-press', name: 'Arnold Press', primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'], pattern: 'vertical_push', equipment: 'dumbbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'lateral-raise', name: 'Lateral Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 2, progressionEase: 3 } },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'machine-lateral-raise', name: 'Machine Lateral Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'front-raise', name: 'Front Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 2, progressionEase: 3 } },
  { id: 'face-pull', name: 'Face Pull', primaryMuscle: 'shoulders', secondaryMuscles: ['traps', 'back'], pattern: 'horizontal_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'reverse-fly', name: 'Reverse Fly', primaryMuscle: 'shoulders', secondaryMuscles: ['traps', 'back'], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 2, progressionEase: 3 } },
  { id: 'rear-delt-machine', name: 'Rear Delt Machine', primaryMuscle: 'shoulders', secondaryMuscles: ['traps', 'back'], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'upright-row', name: 'Upright Row', primaryMuscle: 'shoulders', secondaryMuscles: ['traps'], pattern: 'vertical_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, notes: 'Keep grip wide to protect shoulders', hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'cable-upright-row', name: 'Cable Upright Row', primaryMuscle: 'shoulders', secondaryMuscles: ['traps'], pattern: 'vertical_pull', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 4, progressionEase: 4 } },
  
  // BICEPS
  { id: 'barbell-curl', name: 'Barbell Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 2, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'ez-bar-curl', name: 'EZ Bar Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 2, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'db-curl', name: 'Dumbbell Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 2, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'hammer-curl', name: 'Hammer Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 2, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'incline-db-curl', name: 'Incline Dumbbell Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 4 } },
  { id: 'concentration-curl', name: 'Concentration Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'cable-curl', name: 'Cable Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'preacher-curl', name: 'Preacher Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'machine-curl', name: 'Machine Bicep Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 5 } },
  
  // TRICEPS
  { id: 'tricep-pushdown', name: 'Tricep Pushdown', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'rope-pushdown', name: 'Rope Tricep Pushdown', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'overhead-tricep', name: 'Overhead Tricep Extension', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'skull-crusher', name: 'Skull Crusher', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 1, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'close-grip-bench', name: 'Close-Grip Bench Press', primaryMuscle: 'triceps', secondaryMuscles: ['chest', 'shoulders'], pattern: 'horizontal_push', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [6, 10], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'machine-tricep', name: 'Machine Tricep Extension', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'tricep-dip-machine', name: 'Assisted Dip Machine', primaryMuscle: 'triceps', secondaryMuscles: ['chest', 'shoulders'], pattern: 'vertical_push', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 4, progressionEase: 4 } },
  { id: 'db-kickback', name: 'Dumbbell Kickback', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 2, progressionEase: 3 } },
  
  // QUADS
  { id: 'squat', name: 'Barbell Back Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes', 'hamstrings'], pattern: 'squat', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 3, defaultRepRange: [5, 8], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 5 } },
  { id: 'front-squat', name: 'Front Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'barbell', difficulty: 'advanced', fatigueRating: 3, defaultRepRange: [5, 8], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'smith-squat', name: 'Smith Machine Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'leg-press', name: 'Leg Press', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'hack-squat', name: 'Hack Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'pendulum-squat', name: 'Pendulum Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'machine', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'goblet-squat', name: 'Goblet Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'squat', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'leg-extension', name: 'Leg Extension', primaryMuscle: 'quads', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'sissy-squat', name: 'Sissy Squat', primaryMuscle: 'quads', secondaryMuscles: [], pattern: 'squat', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 4, resistanceProfile: 2, progressionEase: 2 } },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'lunge', equipment: 'dumbbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'walking-lunge', name: 'Walking Lunge', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'lunge', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'reverse-lunge', name: 'Reverse Lunge', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'lunge', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'step-up', name: 'Step Up', primaryMuscle: 'quads', secondaryMuscles: ['glutes'], pattern: 'lunge', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  
  // HAMSTRINGS
  { id: 'rdl', name: 'Romanian Deadlift', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'back'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'db-rdl', name: 'Dumbbell RDL', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes'], pattern: 'hip_hinge', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'stiff-leg-deadlift', name: 'Stiff Leg Deadlift', primaryMuscle: 'hamstrings', secondaryMuscles: ['back', 'glutes'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'single-leg-rdl', name: 'Single Leg RDL', primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes'], pattern: 'hip_hinge', equipment: 'dumbbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'lying-leg-curl', name: 'Lying Leg Curl', primaryMuscle: 'hamstrings', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'seated-leg-curl', name: 'Seated Leg Curl', primaryMuscle: 'hamstrings', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'good-morning', name: 'Good Morning', primaryMuscle: 'hamstrings', secondaryMuscles: ['back', 'glutes'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'nordic-curl', name: 'Nordic Curl', primaryMuscle: 'hamstrings', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'advanced', fatigueRating: 2, defaultRepRange: [5, 10], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 5, resistanceProfile: 2, progressionEase: 2 } },
  
  // GLUTES
  { id: 'hip-thrust', name: 'Hip Thrust', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'glute-drive', name: 'Glute Drive Machine', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'glute-bridge', name: 'Glute Bridge', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 20], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'single-leg-hip-thrust', name: 'Single Leg Hip Thrust', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'cable-pull-through', name: 'Cable Pull-Through', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings'], pattern: 'hip_hinge', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'glute-kickback', name: 'Cable Glute Kickback', primaryMuscle: 'glutes', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'hip-abduction', name: 'Hip Abduction Machine', primaryMuscle: 'glutes', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 20], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'hip-adduction', name: 'Hip Adduction Machine', primaryMuscle: 'adductors', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 20], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift', primaryMuscle: 'glutes', secondaryMuscles: ['hamstrings', 'back', 'quads'], pattern: 'hip_hinge', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 3, defaultRepRange: [4, 8], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 5 } },
  
  // CALVES
  { id: 'standing-calf-raise', name: 'Standing Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'leg-press-calf-raise', name: 'Leg Press Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 25], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'smith-calf-raise', name: 'Smith Machine Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 25], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  { id: 'donkey-calf-raise', name: 'Donkey Calf Raise', primaryMuscle: 'calves', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 25], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 4, progressionEase: 5 } },
  
  // ABS
  { id: 'cable-crunch', name: 'Cable Crunch', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'machine-crunch', name: 'Machine Ab Crunch', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'machine', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 20], defaultRir: 2, minWeightIncrementKg: 5.0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'decline-crunch', name: 'Decline Crunch', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 25], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 2, progressionEase: 2 } },
  { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'captain-chair', name: "Captain's Chair Leg Raise", primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'ab-wheel', name: 'Ab Wheel Rollout', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 15], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 3 } },
  { id: 'plank', name: 'Plank', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [30, 60], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 2, progressionEase: 2 } },
  { id: 'pallof-press', name: 'Pallof Press', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'dead-bug', name: 'Dead Bug', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 2, progressionEase: 2 } },
  { id: 'russian-twist', name: 'Russian Twist', primaryMuscle: 'abs', secondaryMuscles: [], pattern: 'isolation', equipment: 'bodyweight', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [15, 25], defaultRir: 2, minWeightIncrementKg: 0, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'C', stretchUnderLoad: 2, resistanceProfile: 2, progressionEase: 2 } },
  { id: 'woodchop', name: 'Cable Woodchop', primaryMuscle: 'abs', secondaryMuscles: ['shoulders'], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, hypertrophyScore: { tier: 'A', stretchUnderLoad: 4, resistanceProfile: 5, progressionEase: 4 } },
  
  // FUNCTIONAL / CARRIES
  { id: 'farmers-carry', name: "Farmer's Carry", primaryMuscle: 'abs', secondaryMuscles: ['shoulders', 'back'], pattern: 'carry', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [30, 60], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, notes: 'Rep range is seconds, not reps', hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  { id: 'suitcase-carry', name: 'Suitcase Carry', primaryMuscle: 'abs', secondaryMuscles: ['shoulders'], pattern: 'carry', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 2, defaultRepRange: [30, 60], defaultRir: 2, minWeightIncrementKg: 2.0, mechanic: 'compound', isCustom: false, notes: 'Rep range is seconds per side', hypertrophyScore: { tier: 'B', stretchUnderLoad: 3, resistanceProfile: 3, progressionEase: 4 } },
  
  // NIPPARD S-TIER EXERCISES
  { id: 'seated-cable-fly', name: 'Seated Cable Fly', primaryMuscle: 'chest', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, notes: 'Nippard S-tier', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 5 } },
  { id: 'meadows-row', name: 'Meadows Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, notes: 'Nippard S-tier - landmine single arm row', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'seal-row', name: 'Seal Row', primaryMuscle: 'back', secondaryMuscles: ['biceps'], pattern: 'horizontal_pull', equipment: 'barbell', difficulty: 'intermediate', fatigueRating: 2, defaultRepRange: [8, 12], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'compound', isCustom: false, notes: 'Chest-supported barbell row - eliminates momentum', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'behind-back-cable-lateral', name: 'Behind-the-Back Cable Lateral Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, notes: 'Nippard S-tier for side delts', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'cable-y-raise', name: 'Cable Y-Raise', primaryMuscle: 'shoulders', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, notes: 'Nippard S-tier', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'reverse-cable-crossover', name: 'Reverse Cable Crossover', primaryMuscle: 'shoulders', secondaryMuscles: ['back'], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [12, 20], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, notes: 'Nippard S-tier for rear delts', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: 'bayesian-cable-curl', name: 'Bayesian Cable Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, notes: 'Nippard #1 bicep exercise - face away from cable', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
  { id: '45-deg-preacher-curl', name: '45° Preacher Curl', primaryMuscle: 'biceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'dumbbell', difficulty: 'beginner', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 1.0, mechanic: 'isolation', isCustom: false, notes: 'Nippard S-tier - angled preacher', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 4, progressionEase: 4 } },
  { id: 'katana-tricep-extension', name: 'Katana Tricep Extension', primaryMuscle: 'triceps', secondaryMuscles: [], pattern: 'isolation', equipment: 'cable', difficulty: 'intermediate', fatigueRating: 1, defaultRepRange: [10, 15], defaultRir: 2, minWeightIncrementKg: 2.5, mechanic: 'isolation', isCustom: false, notes: 'Nippard A-tier - single arm overhead', hypertrophyScore: { tier: 'S', stretchUnderLoad: 5, resistanceProfile: 5, progressionEase: 4 } },
];

// Export fallback for use in other modules (seed data)
export { FALLBACK_EXERCISES };

// ============================================
// SYNC API (for backward compatibility)
// Uses cache if available, otherwise fallback
// ============================================

/**
 * Get exercises synchronously (uses cache or fallback)
 * Use this for synchronous code that can't await
 * Prefer getExercises() when async is possible
 */
export function getExercisesSync(): Exercise[] {
  if (exerciseCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return exerciseCache;
  }
  return FALLBACK_EXERCISES;
}

/**
 * Get exercises for a muscle synchronously
 */
export function getExercisesForMuscleSync(
  muscle: MuscleGroup,
  equipment?: Equipment[]
): Exercise[] {
  const all = getExercisesSync();
  return all.filter(e => {
    const muscleMatch = e.primaryMuscle === muscle;
    const equipmentMatch = !equipment || equipment.length === 0 || 
      equipment.includes(e.equipment);
    return muscleMatch && equipmentMatch;
  });
}

/**
 * Get exercise by name synchronously
 */
export function getExerciseByNameSync(name: string): Exercise | null {
  const all = getExercisesSync();
  return all.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Pre-warm the cache (call this early in app lifecycle)
 */
export async function warmExerciseCache(): Promise<void> {
  await getExercises();
}

