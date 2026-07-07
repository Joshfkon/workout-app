// ============================================================
// BODY DATA SAVE HELPERS
//
// One write path per body-data type, shared by the unified "Log body data"
// sheet (Home Weight tile + Body hub) and any older entry surfaces. All
// helpers are client-side and take the untyped Supabase client.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DexaRegionalData } from '@/types/schema';

// ------------------------------------------------------------
// Weight (weight_log — the table the Home Weight tile reads)
// ------------------------------------------------------------

export interface WeightLogInput {
  /** Weight in the user's DISPLAY unit (weight_log stores display values). */
  weight: number;
  unit: 'lb' | 'kg';
  /** YYYY-MM-DD */
  date: string;
  notes?: string;
}

/**
 * Update-or-insert the day's weight_log row. Mirrors the Home dashboard's
 * long-standing behavior, including the retry without `unit` for databases
 * that predate the unit column. Throws on failure.
 */
export async function saveWeightLogEntry(
  supabase: SupabaseClient,
  userId: string,
  input: WeightLogInput
): Promise<void> {
  const { data: existing } = await supabase
    .from('weight_log')
    .select('id')
    .eq('user_id', userId)
    .eq('logged_at', input.date)
    .maybeSingle();

  let error;
  if (existing) {
    let result = await supabase
      .from('weight_log')
      .update({ weight: input.weight, unit: input.unit, notes: input.notes })
      .eq('id', existing.id);
    if (result.error?.message?.includes('column "unit"')) {
      result = await supabase
        .from('weight_log')
        .update({ weight: input.weight, notes: input.notes })
        .eq('id', existing.id);
    }
    error = result.error;
  } else {
    let result = await supabase.from('weight_log').insert({
      user_id: userId,
      logged_at: input.date,
      weight: input.weight,
      unit: input.unit,
      notes: input.notes,
    });
    if (result.error?.message?.includes('column "unit"')) {
      result = await supabase.from('weight_log').insert({
        user_id: userId,
        logged_at: input.date,
        weight: input.weight,
        notes: input.notes,
      });
    }
    error = result.error;
  }

  if (error) throw error;
}

// ------------------------------------------------------------
// Tape measurements (body_measurements — one row per day, cm)
// ------------------------------------------------------------

export type MeasurementSiteValues = Record<string, number>;

/**
 * Upsert the day's tape measurements. `valuesCm` contains only the sites the
 * user actually filled in (partial entry is fine); values must already be in
 * cm. Throws on failure.
 */
export async function saveBodyMeasurements(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  valuesCm: MeasurementSiteValues,
  notes?: string
): Promise<void> {
  const { error } = await supabase.from('body_measurements').upsert(
    {
      user_id: userId,
      logged_at: date,
      ...valuesCm,
      ...(notes ? { notes } : {}),
    },
    { onConflict: 'user_id,logged_at' }
  );
  if (error) throw error;
}

// ------------------------------------------------------------
// DEXA scans (dexa_scans — sparse, authoritative events)
// ------------------------------------------------------------

export interface DexaScanInput {
  /** YYYY-MM-DD */
  scanDate: string;
  weightKg: number;
  leanMassKg: number;
  fatMassKg: number;
  bodyFatPercent: number;
  boneMassKg?: number | null;
  boneDensityGCm2?: number | null;
  facility?: string | null;
  machine?: string | null;
  regionalData?: Partial<DexaRegionalData> | null;
  notes?: string | null;
}

/**
 * Error codes / messages meaning the 20260707000002_dexa_scan_details
 * columns (facility, machine, bone_density_g_cm2) don't exist yet.
 */
function isMissingDexaDetailColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .*(facility|machine|bone_density)/i.test(error.message ?? '');
}

/**
 * Insert a DEXA scan. Retries without the detail columns while the migration
 * hasn't been applied (same ship-before-migrate pattern as session origin).
 * Throws on failure — including the duplicate-date unique violation, which
 * callers should surface as "a scan already exists for this date".
 */
export async function saveDexaScan(
  supabase: SupabaseClient,
  userId: string,
  input: DexaScanInput
): Promise<void> {
  const base: Record<string, unknown> = {
    user_id: userId,
    scan_date: input.scanDate,
    weight_kg: Math.round(input.weightKg * 100) / 100,
    lean_mass_kg: Math.round(input.leanMassKg * 100) / 100,
    fat_mass_kg: Math.round(input.fatMassKg * 100) / 100,
    body_fat_percent: Math.round(input.bodyFatPercent * 10) / 10,
    bone_mass_kg: input.boneMassKg != null ? Math.round(input.boneMassKg * 100) / 100 : null,
    notes: input.notes || null,
  };
  if (input.regionalData) base.regional_data = input.regionalData;

  const details: Record<string, unknown> = {
    facility: input.facility || null,
    machine: input.machine || null,
    bone_density_g_cm2:
      input.boneDensityGCm2 != null ? Math.round(input.boneDensityGCm2 * 1000) / 1000 : null,
  };

  const first = await supabase.from('dexa_scans').insert({ ...base, ...details });
  if (!first.error) return;
  if (!isMissingDexaDetailColumn(first.error)) throw first.error;

  const retry = await supabase.from('dexa_scans').insert(base);
  if (retry.error) throw retry.error;
}
