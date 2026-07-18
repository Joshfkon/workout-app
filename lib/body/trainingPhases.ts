// ============================================================
// TRAINING PHASES (date-spanned bulk / cut / recomp / maintenance)
//
// DB access for the training_phases table. Lives in lib/ (same placement as
// lib/body/bodyLog.ts and lib/bloodPressure/bloodPressureLog.ts) — /services
// stays pure. Span invariants (no overlap, one active phase) are validated by
// services/phasePlanning.validatePhaseSpan BEFORE calling the write helpers
// here; the helpers trust their input.
//
// Days are localDay strings (YYYY-MM-DD). Low-frequency writes -> plain
// last-write-wins, no outbox (that queue is reserved for the mid-workout
// write path).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhaseType, TrainingPhase } from '@/types/schema';

interface TrainingPhaseRow {
  id: string;
  user_id: string;
  phase_type: string;
  start_day: string;
  end_day: string | null;
  target_rate_lbs_per_week: number | string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const SELECT_COLUMNS =
  'id, user_id, phase_type, start_day, end_day, target_rate_lbs_per_week, note, created_at, updated_at';

export interface TrainingPhaseInput {
  phaseType: PhaseType;
  startDay: string;
  endDay: string | null;
  targetRateLbsPerWeek: number | null;
  note?: string | null;
}

function rowToPhase(row: TrainingPhaseRow): TrainingPhase {
  return {
    id: row.id,
    userId: row.user_id,
    phaseType: row.phase_type as PhaseType,
    startDay: row.start_day.slice(0, 10),
    endDay: row.end_day ? row.end_day.slice(0, 10) : null,
    targetRateLbsPerWeek:
      row.target_rate_lbs_per_week == null ? null : Number(row.target_rate_lbs_per_week),
    note: row.note ?? null,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function inputToRow(input: TrainingPhaseInput) {
  return {
    phase_type: input.phaseType,
    start_day: input.startDay,
    end_day: input.endDay,
    target_rate_lbs_per_week: input.targetRateLbsPerWeek,
    note: input.note?.trim() ? input.note.trim() : null,
  };
}

/** All phases for a user, sorted by start day ascending. */
export async function fetchTrainingPhases(
  supabase: SupabaseClient,
  userId: string
): Promise<TrainingPhase[]> {
  const { data, error } = await supabase
    .from('training_phases')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .order('start_day', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TrainingPhaseRow[]).map(rowToPhase);
}

/** Insert one phase span. Returns the saved phase. */
export async function insertTrainingPhase(
  supabase: SupabaseClient,
  userId: string,
  input: TrainingPhaseInput
): Promise<TrainingPhase> {
  const { data, error } = await supabase
    .from('training_phases')
    .insert({ user_id: userId, ...inputToRow(input) })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return rowToPhase(data as TrainingPhaseRow);
}

/** Update a phase span by id (RLS enforces ownership). Returns the saved phase. */
export async function updateTrainingPhaseSpan(
  supabase: SupabaseClient,
  id: string,
  input: Partial<TrainingPhaseInput>
): Promise<TrainingPhase> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.phaseType !== undefined) patch.phase_type = input.phaseType;
  if (input.startDay !== undefined) patch.start_day = input.startDay;
  if (input.endDay !== undefined) patch.end_day = input.endDay;
  if (input.targetRateLbsPerWeek !== undefined)
    patch.target_rate_lbs_per_week = input.targetRateLbsPerWeek;
  if (input.note !== undefined) patch.note = input.note?.trim() ? input.note.trim() : null;

  const { data, error } = await supabase
    .from('training_phases')
    .update(patch)
    .eq('id', id)
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return rowToPhase(data as TrainingPhaseRow);
}

/** Delete a phase span by id (RLS enforces ownership). */
export async function deleteTrainingPhase(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('training_phases').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
