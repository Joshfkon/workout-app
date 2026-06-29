'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';

/**
 * Fetch equipment IDs marked as unavailable for a user
 */
export async function fetchUnavailableEquipment(userId: string): Promise<string[]> {
  const supabase = await createUntypedServerClient();

  const { data } = await supabase
    .from('user_equipment')
    .select('equipment_id')
    .eq('user_id', userId)
    .eq('is_available', false);

  return data?.map((e: { equipment_id: string }) => e.equipment_id) || [];
}
