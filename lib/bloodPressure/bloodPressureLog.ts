// ============================================================
// BLOOD PRESSURE LOG (manual capture)
//
// DB access for the blood_pressure_log table (one or MORE readings per user
// per local day — no upsert, every save is a new reading). DB access lives
// here in lib/ (same placement as lib/sleep/sleepLog.ts), NOT in /services
// (which stays pure). Validation/classification/averaging live in
// services/bloodPressure.ts.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { getLocalDateString } from '@/lib/utils';
import { assertValidBloodPressure } from '@/services/bloodPressure';
import {
  BLOOD_PRESSURE_CONTEXTS,
  type BloodPressureContext,
  type BloodPressureEntry,
  type BloodPressureInput,
} from '@/types/schema';

interface BloodPressureRow {
  id: string;
  measured_at: string;
  local_day: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  context: string | null;
  notes: string | null;
  source: string | null;
}

const SELECT_COLUMNS =
  'id, measured_at, local_day, systolic, diastolic, pulse, context, notes, source';

function rowToEntry(row: BloodPressureRow): BloodPressureEntry {
  const context =
    row.context && (BLOOD_PRESSURE_CONTEXTS as readonly string[]).includes(row.context)
      ? (row.context as BloodPressureContext)
      : null;
  return {
    id: row.id,
    measuredAt: row.measured_at,
    localDay: row.local_day,
    systolic: Number(row.systolic),
    diastolic: Number(row.diastolic),
    pulse: row.pulse == null ? null : Number(row.pulse),
    context,
    notes: row.notes ?? null,
    source: 'manual',
  };
}

/**
 * Fetch the trailing `days` of readings (newest first). Anchored to the LOCAL
 * day, matching how readings are written. Pass a large number (or use
 * fetchAllBloodPressure) for the "all time" history filter.
 */
export async function fetchRecentBloodPressure(
  supabase: SupabaseClient,
  userId: string,
  days: number,
  now: Date = new Date()
): Promise<BloodPressureEntry[]> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const { data, error } = await supabase
    .from('blood_pressure_log')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .gte('local_day', getLocalDateString(cutoff))
    .order('measured_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BloodPressureRow[]).map(rowToEntry);
}

/** Every reading for a user, newest first — backs the "All" history filter. */
export async function fetchAllBloodPressure(
  supabase: SupabaseClient,
  userId: string
): Promise<BloodPressureEntry[]> {
  const { data, error } = await supabase
    .from('blood_pressure_log')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .order('measured_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BloodPressureRow[]).map(rowToEntry);
}

/**
 * Insert one new reading. Validation runs first (same rules as the UI), then
 * the local_day is derived from the reading's timestamp so a back-dated
 * reading lands on the correct calendar day. Returns the saved entry.
 */
export async function insertBloodPressureEntry(
  supabase: SupabaseClient,
  userId: string,
  input: BloodPressureInput
): Promise<BloodPressureEntry> {
  assertValidBloodPressure(input);

  const measuredAt = input.measuredAt ?? new Date().toISOString();
  const localDay = getLocalDateString(new Date(measuredAt));

  const { data, error } = await supabase
    .from('blood_pressure_log')
    .insert({
      user_id: userId,
      measured_at: measuredAt,
      local_day: localDay,
      systolic: input.systolic,
      diastolic: input.diastolic,
      pulse: input.pulse ?? null,
      context: input.context ?? null,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      source: 'manual',
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return rowToEntry(data as BloodPressureRow);
}

/** Delete one reading by id (RLS enforces ownership). */
export async function deleteBloodPressureEntry(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from('blood_pressure_log')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}
