/**
 * Writes a parsed Hevy export into the user's history as completed workout
 * sessions — the same tables and shape the Strong import writes
 * (workout_sessions → exercise_blocks → set_logs), plus what Hevy carries
 * that Strong does not: real start/end times, set types, per-exercise notes.
 *
 * Parsing, unit conversion, exercise matching and dedupe are pure and live in
 * services/hevyImport.ts; this file only does the DB round-trips.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  filterAlreadyImported,
  hevySetToSetLog,
  isDurationExercise,
  workoutDurationSeconds,
  type ParsedHevyWorkout,
} from '@/services/hevyImport';
import {
  inferMechanicFromName,
  inferMovementPattern,
  inferMuscleFromName,
} from '@/services/exerciseInference';
import type { ImportResult } from '@/services/importExport';
import { getLocalDateString } from '@/lib/utils';

const BATCH_SIZE = 100;

export interface HevyImportProgress {
  current: number;
  total: number;
  currentItem: string;
}

/**
 * @param exerciseMap Hevy exercise name → library exercise id, or null to
 *   create it as a custom exercise.
 */
export async function runHevyImport(
  supabase: SupabaseClient,
  userId: string,
  workouts: ParsedHevyWorkout[],
  exerciseMap: Record<string, string | null>,
  onProgress: (p: HevyImportProgress) => void
): Promise<ImportResult> {
  const errors: string[] = [];
  const step = (n: number, label: string) =>
    onProgress({ current: n, total: 5, currentItem: `Step ${n + 1}/5: ${label}` });

  // ---- 1. Dedupe against existing history --------------------------------
  step(0, 'Checking for workouts already imported...');
  const times = workouts.map((w) => w.startedAt).sort();
  let existing: Array<string | null> = [];
  if (times.length > 0) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .select('started_at')
      .eq('user_id', userId)
      .gte('started_at', new Date(Date.parse(times[0]) - 60_000).toISOString())
      .lte('started_at', new Date(Date.parse(times[times.length - 1]) + 60_000).toISOString());
    if (error) throw error;
    existing = (data ?? []).map((r: { started_at: string | null }) => r.started_at);
  }
  const { fresh, duplicates } = filterAlreadyImported(workouts, existing);

  // ---- 2. Create custom exercises for unmatched names ---------------------
  step(1, 'Creating new exercises...');
  const idByName = new Map<string, string>();
  const toCreate: string[] = [];
  for (const w of fresh) {
    for (const e of w.exercises) {
      if (idByName.has(e.name) || toCreate.includes(e.name)) continue;
      const mapped = exerciseMap[e.name];
      if (mapped) idByName.set(e.name, mapped);
      else toCreate.push(e.name);
    }
  }

  const durationNames = new Set<string>();
  for (const w of fresh) for (const e of w.exercises) if (isDurationExercise(e)) durationNames.add(e.name);

  let newExercises = 0;
  for (const name of toCreate) {
    const { data: created, error } = await supabase
      .from('exercises')
      .insert({
        name,
        primary_muscle: inferMuscleFromName(name),
        mechanic: inferMechanicFromName(name),
        movement_pattern: inferMovementPattern(name),
        exercise_type: durationNames.has(name) ? 'duration_based' : 'rep_based',
        is_custom: true,
        created_by: userId,
      })
      .select('id')
      .single();
    if (created) {
      idByName.set(name, created.id);
      newExercises++;
      continue;
    }
    // Most likely a name clash with one of the user's own customs.
    const { data: found } = await supabase
      .from('exercises')
      .select('id')
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    if (found) idByName.set(name, found.id);
    else errors.push(`Could not create exercise "${name}"${error ? `: ${error.message}` : ''}`);
  }

  // ---- 3. Sessions -------------------------------------------------------
  step(2, 'Creating workout sessions...');
  const sessionIds = new Map<ParsedHevyWorkout, string>();
  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const batch = fresh.slice(i, i + BATCH_SIZE);
    const rows = batch.map((w) => {
      const notes = [w.title !== 'Hevy Workout' ? w.title : null, w.description].filter(Boolean).join('\n');
      return {
        user_id: userId,
        planned_date: getLocalDateString(new Date(w.startedAt)),
        state: 'completed',
        started_at: w.startedAt,
        completed_at: w.endedAt ?? w.startedAt,
        duration_seconds: workoutDurationSeconds(w),
        session_notes: notes || null,
        completion_percent: 100,
      };
    });
    const { data, error } = await supabase.from('workout_sessions').insert(rows).select('id');
    if (error || !data) {
      errors.push(`Failed to save ${batch.length} workouts${error ? `: ${error.message}` : ''}`);
      continue;
    }
    data.forEach((row: { id: string }, idx: number) => sessionIds.set(batch[idx], row.id));
  }

  // ---- 4. Exercise blocks ------------------------------------------------
  step(3, 'Creating exercise blocks...');
  type PendingBlock = {
    row: Record<string, unknown>;
    sets: NonNullable<ReturnType<typeof hevySetToSetLog>>[];
    loggedAt: string;
  };
  const pending: PendingBlock[] = [];
  let droppedSets = 0;
  for (const w of fresh) {
    const sessionId = sessionIds.get(w);
    if (!sessionId) continue;
    let order = 1;
    for (const e of w.exercises) {
      const exerciseId = idByName.get(e.name);
      const sets = e.sets.map(hevySetToSetLog).filter((s): s is NonNullable<typeof s> => s !== null);
      droppedSets += e.sets.length - sets.length;
      if (!exerciseId || sets.length === 0) continue;
      pending.push({
        row: {
          workout_session_id: sessionId,
          exercise_id: exerciseId,
          order: order++,
          target_sets: sets.filter((s) => !s.is_warmup).length || sets.length,
          target_rep_range: [8, 12],
          target_rir: 2,
          note: e.notes ?? null,
        },
        sets,
        loggedAt: w.endedAt ?? w.startedAt,
      });
    }
  }

  const blockIds = new Map<PendingBlock, string>();
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('exercise_blocks')
      .insert(batch.map((b) => b.row))
      .select('id');
    if (error || !data) {
      errors.push(`Failed to save ${batch.length} exercises${error ? `: ${error.message}` : ''}`);
      continue;
    }
    data.forEach((row: { id: string }, idx: number) => blockIds.set(batch[idx], row.id));
  }

  // ---- 5. Set logs -------------------------------------------------------
  step(4, 'Creating set logs...');
  const setRows: Record<string, unknown>[] = [];
  for (const b of pending) {
    const blockId = blockIds.get(b);
    if (!blockId) continue;
    b.sets.forEach((s, idx) =>
      setRows.push({ ...s, exercise_block_id: blockId, set_number: idx + 1, logged_at: b.loggedAt })
    );
  }
  for (let i = 0; i < setRows.length; i += BATCH_SIZE) {
    const { error } = await supabase.from('set_logs').insert(setRows.slice(i, i + BATCH_SIZE));
    if (error) errors.push(`Failed to save some sets: ${error.message}`);
  }

  if (droppedSets > 0) {
    errors.push(`${droppedSets} set${droppedSets === 1 ? '' : 's'} with no reps or time (e.g. distance-only cardio) were not imported.`);
  }

  onProgress({ current: 5, total: 5, currentItem: 'Complete!' });
  return {
    success: true,
    imported: sessionIds.size,
    skipped: workouts.length - sessionIds.size,
    duplicates,
    errors,
    newExercises,
  };
}

