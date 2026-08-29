/**
 * Storage-precision weight quantization.
 *
 * `set_logs.weight_kg` is DECIMAL(6,2) (supabase/migrations/
 * 20241209000001_initial_schema.sql): a weight read back from the database is
 * rounded to 2 decimals, while an in-memory value fresh from the lb→kg
 * conversion carries full float precision (82.5 lb → 37.42095890… kg). Any
 * comparison that mixes the two — a just-logged set against a persisted
 * record, a live session against history — must quantize both sides through
 * this helper first, or "the same weight" differs by a milligram and strict
 * comparisons misfire (the 0%-improvement "New Weight PR" bug).
 *
 * Matches Postgres NUMERIC rounding (half away from zero) for the
 * non-negative weights the schema allows. Pure, unit-preserving (kg in →
 * kg out).
 */
export function storageWeightKg(weightKg: number): number {
  return Math.round(weightKg * 100) / 100;
}
