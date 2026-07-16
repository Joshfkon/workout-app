'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import {
  LOCATION_PRESETS,
  presetUnavailableEquipmentIds,
  type LocationPresetKind,
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

/** Normalize a gym_locations row that may predate the profile columns. */
function toLocationRow(row: Partial<TrainingLocationRow> & { id: string; name: string }): TrainingLocationRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    icon: (row.icon as string | null) ?? null,
    preset_kind: (row.preset_kind as string | null) ?? null,
    is_default: Boolean(row.is_default),
    last_used_at: (row.last_used_at as string | null) ?? null,
    dumbbell_max_kg: (row.dumbbell_max_kg as number | null) ?? null,
  };
}

/**
 * Fetch the user's training locations. Existing gym_locations rows (set up
 * in Settings or the workout builder) are always used as-is; the Gym /
 * Home / Hotel presets are seeded ONLY for an account with zero locations
 * (first use). Preset seeding writes both the gym_locations rows and each
 * preset's user_equipment blocklist (is_available=false rows for equipment
 * the preset lacks).
 */
export async function fetchTrainingLocations(userId: string): Promise<TrainingLocationRow[]> {
  const supabase = await createUntypedServerClient();

  const { data, error } = await supabase
    .from('gym_locations')
    .select(LOCATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    // Pre-migration database: the profile columns don't exist yet. The
    // user's existing locations must still drive the chip row, so retry
    // with the original columns and fill the profile fields with nulls.
    const { data: legacyData, error: legacyError } = await supabase
      .from('gym_locations')
      .select('id, name, is_default')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (legacyError) {
      // gym_locations itself is unavailable — the sheet degrades to its
      // locationless behavior.
      console.warn('fetchTrainingLocations failed:', legacyError.message);
      return [];
    }
    return ((legacyData ?? []) as { id: string; name: string; is_default: boolean }[]).map(
      toLocationRow
    );
  }

  if (data && data.length > 0) return (data as TrainingLocationRow[]).map(toLocationRow);

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
 * Create a new training location and (when seeded from a preset) its
 * user_equipment blocklist, returning the created row for the caller to
 * splice into its chip row without a refetch. Mirrors the create branch of
 * the Settings GymEquipmentSettings form so the pre-workout sheet's inline
 * "+" add flow produces identical rows. Retries without the profile columns
 * if the migration hasn't run yet (pre-migration database).
 */
export async function createTrainingLocation(
  userId: string,
  input: { name: string; presetKind?: LocationPresetKind | null; dumbbellMaxKg?: number | null }
): Promise<TrainingLocationRow> {
  const supabase = await createUntypedServerClient();

  const name = input.name.trim();
  if (!name) throw new Error('Location name is required');

  const preset =
    input.presetKind && input.presetKind !== 'custom'
      ? LOCATION_PRESETS.find((p) => p.kind === input.presetKind) ?? null
      : null;

  // First location becomes the default (matches the Settings form).
  const { count } = await supabase
    .from('gym_locations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  const isDefault = (count ?? 0) === 0;

  let { data, error } = await supabase
    .from('gym_locations')
    .insert({
      user_id: userId,
      name,
      is_default: isDefault,
      icon: preset?.icon ?? null,
      preset_kind: input.presetKind ?? 'custom',
      dumbbell_max_kg: input.dumbbellMaxKg ?? null,
    })
    .select(LOCATION_COLUMNS)
    .single();

  if (error) {
    ({ data, error } = await supabase
      .from('gym_locations')
      .insert({ user_id: userId, name, is_default: isDefault })
      .select('id, name, is_default')
      .single());
  }

  if (error || !data) {
    throw new Error(`createTrainingLocation failed: ${error?.message ?? 'no row returned'}`);
  }

  if (preset) {
    const unavailable = presetUnavailableEquipmentIds(preset);
    if (unavailable.length > 0) {
      await supabase.from('user_equipment').upsert(
        unavailable.map((equipmentId) => ({
          user_id: userId,
          equipment_id: equipmentId,
          is_available: false,
          location_id: data.id,
        })),
        { onConflict: 'user_id,equipment_id,location_id' }
      );
    }
  }

  return toLocationRow(data as Partial<TrainingLocationRow> & { id: string; name: string });
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

  const { data, error } = await supabase
    .from('user_equipment')
    .select('equipment_id')
    .eq('user_id', userId)
    .eq('location_id', locationId)
    .eq('is_available', false);

  if (error) {
    // Swallowing this would silently fail open (no equipment constraint) —
    // let the caller decide how to degrade.
    throw new Error(`fetchUnavailableEquipmentForLocation failed: ${error.message}`);
  }

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
