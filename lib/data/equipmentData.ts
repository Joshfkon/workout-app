/**
 * Equipment data-access (client-side)
 *
 * DB-fetching helpers extracted out of services/equipmentFilter.ts to keep
 * that service pure. Uses the browser Supabase client (matches the original
 * call sites, which run in client components).
 */

import { createUntypedClient } from '@/lib/supabase/client';
import { filterExercisesByEquipment, exerciseRequiresUnavailableEquipment } from '@/services/equipmentFilter';

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
 * Load unavailable equipment and return filter helpers
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
