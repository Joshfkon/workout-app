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

/** Which surface wrote a body_measurements row (see the source migration). */
export type MeasurementSource = 'body_grid' | 'daily_checkin' | 'import';

/** The unique key every body_measurements writer conflicts on — one row/day. */
export const BODY_MEASUREMENTS_CONFLICT = 'user_id,logged_at';

/**
 * Build the body_measurements upsert payload. Pure and exported so the
 * single-source invariant (check-in and grid target the SAME day-row) is
 * unit-testable without a database.
 */
export function buildMeasurementUpsert(
  userId: string,
  date: string,
  valuesCm: MeasurementSiteValues,
  opts: { source?: MeasurementSource; notes?: string } = {}
): Record<string, unknown> {
  return {
    user_id: userId,
    logged_at: date,
    ...valuesCm,
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  };
}

/** True when an error means the `source` column isn't there yet (pre-migrate). */
function isMissingSourceColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .*source/i.test(error.message ?? '');
}

/**
 * Upsert the day's tape measurements. `valuesCm` contains only the sites the
 * user actually filled in (partial entry is fine); values must already be in
 * cm. `source` records the writing surface (defaults to the grid). Retries
 * without `source` while the column migration hasn't landed — same
 * ship-before-migrate pattern as saveDexaScan. Throws on failure.
 */
export async function saveBodyMeasurements(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  valuesCm: MeasurementSiteValues,
  notes?: string,
  source: MeasurementSource = 'body_grid'
): Promise<void> {
  const withSource = buildMeasurementUpsert(userId, date, valuesCm, { source, notes });
  const first = await supabase
    .from('body_measurements')
    .upsert(withSource, { onConflict: BODY_MEASUREMENTS_CONFLICT });
  if (!first.error) return;
  if (!isMissingSourceColumn(first.error)) throw first.error;

  const withoutSource = buildMeasurementUpsert(userId, date, valuesCm, { notes });
  const retry = await supabase
    .from('body_measurements')
    .upsert(withoutSource, { onConflict: BODY_MEASUREMENTS_CONFLICT });
  if (retry.error) throw retry.error;
}

/**
 * Fast morning-waist path from the daily check-in. Writes ONLY the waist site
 * (partial upsert) to the SAME day-row the Body grid uses — never a parallel
 * store. `waistCm` must already be in cm. Stamps source='daily_checkin'.
 */
export async function saveWaistFromCheckin(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  waistCm: number
): Promise<void> {
  await saveBodyMeasurements(supabase, userId, date, { waist: waistCm }, undefined, 'daily_checkin');
}

/**
 * Correct a single site's value on an existing day-row (the "logged my calf
 * as my thigh" fix path). `valueCm` must already be in cm. No-op if the row
 * doesn't exist. Throws on failure.
 */
export async function updateMeasurementSiteEntry(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  site: string,
  valueCm: number
): Promise<void> {
  const { error } = await supabase
    .from('body_measurements')
    .update({ [site]: valueCm })
    .eq('user_id', userId)
    .eq('logged_at', date);
  if (error) throw error;
}

/**
 * Remove a single site's value from an existing day-row. Other sites logged
 * that day are untouched (the column is nulled); when the deleted site was
 * the row's ONLY value, the whole day-row is deleted so it never lingers as
 * an all-null husk. `allSiteKeys` is the canonical site list (the caller
 * passes MEASUREMENT_FIELDS keys — bodyLog can't import a component file).
 * Throws on failure.
 */
export async function deleteMeasurementSiteEntry(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  site: string,
  allSiteKeys: string[]
): Promise<void> {
  const { data: row, error: selectError } = await supabase
    .from('body_measurements')
    .select('*')
    .eq('user_id', userId)
    .eq('logged_at', date)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!row) return;

  const hasOtherValues = allSiteKeys.some(
    (key) => key !== site && (row as Record<string, unknown>)[key] != null
  );
  if (hasOtherValues) {
    const { error } = await supabase
      .from('body_measurements')
      .update({ [site]: null })
      .eq('user_id', userId)
      .eq('logged_at', date);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('body_measurements')
      .delete()
      .eq('user_id', userId)
      .eq('logged_at', date);
    if (error) throw error;
  }
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
