/**
 * Equipment Filter Service
 * Filters exercises based on user's available gym equipment
 */

import { createUntypedClient } from '@/lib/supabase/client';
import type { Exercise } from '@/services/exerciseService';

// Mapping from equipment_types IDs to exercise equipment names
const EQUIPMENT_MAPPING: Record<string, string[]> = {
  // Machines
  leg_press: ['leg press', 'machine'],
  leg_extension: ['leg extension', 'machine'],
  leg_curl: ['leg curl', 'machine'],
  hack_squat: ['hack squat', 'machine'],
  smith_machine: ['smith machine', 'smith'],
  chest_press: ['chest press machine', 'machine'],
  pec_deck: ['pec deck', 'fly machine', 'machine'],
  shoulder_press_machine: ['shoulder press machine', 'machine'],
  lat_pulldown: ['lat pulldown', 'cable'],
  seated_row: ['seated row', 'cable row', 'machine'],
  cable_machine: ['cable', 'pulley'],
  assisted_dip: ['assisted'],
  preacher_curl: ['preacher'],
  calf_raise: ['calf raise machine', 'machine'],
  hip_abductor: ['hip abductor', 'hip adductor', 'machine'],
  glute_kickback: ['glute kickback', 'cable'],
  reverse_hyper: ['reverse hyper'],
  
  // Free Weights
  barbell: ['barbell', 'bar'],
  dumbbells: ['dumbbell', 'db'],
  kettlebells: ['kettlebell', 'kb'],
  ez_bar: ['ez bar', 'ez curl', 'curl bar'],
  trap_bar: ['trap bar', 'hex bar'],
  
  // Benches & Racks
  flat_bench: ['flat bench', 'bench'],
  incline_bench: ['incline bench', 'incline'],
  decline_bench: ['decline bench', 'decline'],
  squat_rack: ['squat rack', 'power rack', 'rack'],
  dip_station: ['dip', 'parallel bars'],
  pull_up_bar: ['pull-up', 'pullup', 'chin-up', 'chinup'],
  
  // Other
  resistance_bands: ['band', 'resistance band'],
  trx: ['trx', 'suspension'],
  ab_wheel: ['ab wheel', 'rollout'],
  medicine_ball: ['medicine ball', 'med ball'],
  battle_ropes: ['battle ropes', 'rope'],
  landmine: ['landmine'],
};

/**
 * Get user's unavailable equipment IDs
 */
export async function getUnavailableEquipment(userId: string): Promise<string[]> {
  const supabase = createUntypedClient();
  
  const { data } = await supabase
    .from('user_equipment')
    .select('equipment_id')
    .eq('user_id', userId)
    .eq('is_available', false);
  
  return data?.map((e: { equipment_id: string }) => e.equipment_id) || [];
}

/**
 * Check if an exercise requires unavailable equipment
 */
export function exerciseRequiresUnavailableEquipment(
  exercise: Exercise | { name: string; equipment?: string },
  unavailableEquipmentIds: string[]
): boolean {
  if (unavailableEquipmentIds.length === 0) return false;
  
  const exerciseName = exercise.name.toLowerCase();
  const exerciseEquipment = ('equipment' in exercise ? exercise.equipment : '')?.toLowerCase() || '';
  
  for (const equipmentId of unavailableEquipmentIds) {
    const keywords = EQUIPMENT_MAPPING[equipmentId] || [];
    
    for (const keyword of keywords) {
      if (exerciseName.includes(keyword) || exerciseEquipment.includes(keyword)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Filter exercises to only include those the user can perform
 */
export function filterExercisesByEquipment<T extends { name: string; equipment?: string }>(
  exercises: T[],
  unavailableEquipmentIds: string[]
): T[] {
  if (unavailableEquipmentIds.length === 0) return exercises;
  
  return exercises.filter(ex => !exerciseRequiresUnavailableEquipment(ex, unavailableEquipmentIds));
}

/**
 * Get exercises that user CAN'T do (for UI display)
 */
export function getUnavailableExercises<T extends { name: string; equipment?: string }>(
  exercises: T[],
  unavailableEquipmentIds: string[]
): T[] {
  if (unavailableEquipmentIds.length === 0) return [];
  
  return exercises.filter(ex => exerciseRequiresUnavailableEquipment(ex, unavailableEquipmentIds));
}

/**
 * Load unavailable equipment and return filter function
 */
export async function createEquipmentFilter(userId: string) {
  const unavailableIds = await getUnavailableEquipment(userId);
  
  return {
    unavailableIds,
    filter: <T extends { name: string; equipment?: string }>(exercises: T[]) => 
      filterExercisesByEquipment(exercises, unavailableIds),
    isAvailable: (exercise: { name: string; equipment?: string }) => 
      !exerciseRequiresUnavailableEquipment(exercise, unavailableIds),
  };
}

