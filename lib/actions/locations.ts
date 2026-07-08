'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import {
  LOCATION_PRESETS,
  presetUnavailableEquipmentIds,
} from '@/services/locationProfiles';

/** gym_locations row as the pre-workout sheet consumes it. */
export interface TrainingLocationRow {
  id: string;
  name: string;
  icon: string | null;
  preset_kind: string | null;
  is_default: boolean;
  last_used_at: string | null;
  dumbbell_max_kg: number | null;
}

const LOCATION_COLUMNS = 'id, name, icon, preset_kind, is_default, last_used_at, dumbbell_max_kg';

/**
 * Fetch the user's training locations, seeding the Gym / Home / Hotel
 * presets on first use (a user with zero locations). Preset seeding writes
 * both the gym_locations rows and each preset's user_equipment blocklist
 * (is_available=false rows for equipment the preset lacks).
 */
export async function fetchTrainingLocations(userId: string): Promise<TrainingLocationRow[]> {
  const supabase = await createUntypedServerClient();

  const { data, error } = await supabase
    .from('gym_locations')
    .select(LOCATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    // Pre-migration database (missing columns/table) — the sheet degrades
    // to its locationless behavior.
    console.warn('fetchTrainingLocations failed:', error.message);
    return [];
  }

  if (data && data.length > 0) return data as TrainingLocationRow[];

  // First use: seed presets. Gym is the default; the others are editable
  // starting points. Insert one at a time so a partial failure (e.g. a
  // concurrent request already seeded) degrades to a re-fetch.
  for (const preset of LOCATION_PRESETS) {
    const { data: created, error: insertError } = await supabase
      .from('gym_locations')
      .insert({
        user_id: userId,
        name: preset.name,
        icon: preset.icon,
        preset_kind: preset.kind,
        is_default: preset.kind === 'gym',
      })
      .select(LOCATION_COLUMNS)
      .single();

    if (insertError || !created) continue;

    const unavailable = presetUnavailableEquipmentIds(preset);
    if (unavailable.length > 0) {
      await supabase.from('user_equipment').upsert(
        unavailable.map((equipmentId) => ({
          user_id: userId,
          equipment_id: equipmentId,
          is_available: false,
          location_id: created.id,
        })),
        { onConflict: 'user_id,equipment_id,location_id' }
      );
    }
  }

  const { data: seeded } = await supabase
    .from('gym_locations')
    .select(LOCATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  return (seeded ?? []) as TrainingLocationRow[];
}

/**
 * Equipment ids marked unavailable at a specific location (the blocklist
 * the equipment filter and substitution pass consume).
 */
export async function fetchUnavailableEquipmentForLocation(
  userId: string,
  locationId: string
): Promise<string[]> {
  const supabase = await createUntypedServerClient();

  const { data } = await supabase
    .from('user_equipment')
    .select('equipment_id')
    .eq('user_id', userId)
    .eq('location_id', locationId)
    .eq('is_available', false);

  return data?.map((e: { equipment_id: string }) => e.equipment_id) ?? [];
}

/** Record that a workout was started at this location (last-used default). */
export async function touchLocationLastUsed(userId: string, locationId: string): Promise<void> {
  const supabase = await createUntypedServerClient();

  await supabase
    .from('gym_locations')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', locationId)
    .eq('user_id', userId);
}
