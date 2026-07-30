/**
 * Progression-health audit (READ-ONLY — SELECT queries only).
 *
 * Runs both services/progressionHealth detectors across EVERY exercise the
 * user has trained (Step 5c of the 2026-07-29 rep-total session):
 *
 *  - STALL: top working load unchanged for >= 4 consecutive sessions, OR a
 *    rep-total target that has only trivially crept (+1..+2/session, met
 *    each time) across >= 3 consecutive transitions at the same load;
 *  - LOAD UNDER-PRESCRIBED: logged reps above the configured range ceiling
 *    at RIR >= 2 in >= 2 consecutive sessions.
 *
 * REPORT ONLY. Nothing is narrowed, widened, or written — configs are never
 * auto-edited; the output is the input to a human decision.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   AUDIT_USER_ID=<uuid> npx -y tsx scripts/auditProgressionHealth.ts
 *
 * Optional env:
 *   AUDIT_SESSIONS=12          recent sessions per exercise (default 12,
 *                              matching the in-app history cap)
 *   AUDIT_EXERCISE_NAME="..."  restrict to one exercise (ilike match)
 *
 * This script NEVER writes: no insert/update/upsert/delete anywhere.
 */

import { createClient } from '@supabase/supabase-js';
import {
  detectProgressionStall,
  detectLoadUnderprescribed,
  type ProgressionHealthSession,
} from '../services/progressionHealth';

interface SetRow {
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_warmup: boolean;
  set_type: string | null;
}

interface BlockRow {
  id: string;
  exercise_id: string;
  target_rep_range: number[] | null;
  equipment_changed: boolean | null;
  workout_sessions: {
    id: string;
    completed_at: string | null;
    state: string;
    is_deload: boolean | null;
  } | null;
  set_logs: SetRow[] | null;
  exercises: {
    id: string;
    name: string;
    default_rep_range: number[] | null;
    exercise_type: string | null;
    min_weight_increment_kg: number | null;
    available_increments_kg: number[] | null;
    progression_model: string | null;
  } | null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
  const sessionWindow = Number(process.env.AUDIT_SESSIONS ?? 12);
  const onlyExercise = process.env.AUDIT_EXERCISE_NAME;

  if (!url || !key || !userId) {
    console.error(
      'Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUDIT_USER_ID'
    );
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const blocks: BlockRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('exercise_blocks')
      .select(
        `id, exercise_id, target_rep_range, equipment_changed,
         workout_sessions!inner ( id, completed_at, state, is_deload ),
         set_logs ( weight_kg, reps, rpe, is_warmup, set_type ),
         exercises ( id, name, default_rep_range, exercise_type, min_weight_increment_kg, available_increments_kg, progression_model )`
      )
      .eq('workout_sessions.user_id', userId)
      .eq('workout_sessions.state', 'completed')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (onlyExercise) q = q.ilike('exercises.name', onlyExercise);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as BlockRow[];
    blocks.push(...rows);
    if (rows.length < PAGE) break;
  }

  // Group by exercise; deloads excluded (held light by design); duration
  // exercises excluded (their "reps" are seconds — both detectors reason in
  // reps). Sessions oldest first, capped at the recent window.
  const byExercise = new Map<string, BlockRow[]>();
  for (const b of blocks) {
    if (!b.exercises || b.workout_sessions?.is_deload) continue;
    if (b.exercises.exercise_type === 'duration_based') continue;
    const list = byExercise.get(b.exercise_id) ?? [];
    list.push(b);
    byExercise.set(b.exercise_id, list);
  }

  interface Finding {
    name: string;
    line: string;
  }
  const stalls: Finding[] = [];
  const underloads: Finding[] = [];
  let judged = 0;

  byExercise.forEach((list) => {
    const ex = list[0].exercises!;
    list.sort(
      (a, b) =>
        Date.parse(a.workout_sessions?.completed_at ?? '') -
        Date.parse(b.workout_sessions?.completed_at ?? '')
    );

    const sessions: Array<ProgressionHealthSession & { boundary: boolean }> = [];
    for (const b of list) {
      const completedAt = b.workout_sessions?.completed_at;
      if (!completedAt) continue;
      const working = (b.set_logs ?? []).filter(
        (s) => !s.is_warmup && s.weight_kg > 0 && s.reps > 0
      );
      if (working.length === 0) continue;
      sessions.push({
        date: completedAt,
        boundary: !!b.equipment_changed,
        sets: working.map((s) => ({
          weightKg: s.weight_kg,
          reps: s.reps,
          rir: s.rpe != null ? Math.max(0, 10 - s.rpe) : undefined,
        })),
      });
    }
    // Honor explicit equipment boundaries: consecutive runs must not span
    // two machines / loading scales — keep only the latest segment (the
    // boundary session starts it), mirroring the in-app builder.
    let segmentStart = 0;
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (sessions[i].boundary) {
        segmentStart = i;
        break;
      }
    }
    const recent = sessions.slice(segmentStart).slice(-sessionWindow);
    if (recent.length < 2) return;
    judged++;

    const stall = detectProgressionStall(recent, {
      minIncrementKg: ex.min_weight_increment_kg ?? undefined,
      availableIncrementsKg: ex.available_increments_kg,
      // The target-stall claim only exists for rep_total exercises. Only
      // the explicit column is read here — a NULL (auto-classified) model
      // falls back to the generic load-stall check, which still flags the
      // jam, just without the rep-total-specific wording.
      repTotal: ex.progression_model === 'rep_total',
    });
    if (stall) {
      stalls.push({
        name: ex.name,
        line:
          stall.kind === 'target_stall'
            ? `target creeping +1–2/session, met each time — ${stall.sessions} sessions at ${stall.loadKg.toFixed(1)} kg`
            : `load unchanged ${stall.sessions} consecutive sessions at ${stall.loadKg.toFixed(1)} kg`,
      });
    }

    const range = (list[list.length - 1].target_rep_range ?? ex.default_rep_range) as
      | [number, number]
      | null;
    if (range && range.length >= 2) {
      const under = detectLoadUnderprescribed(recent, range[1], {
        minIncrementKg: ex.min_weight_increment_kg ?? undefined,
        availableIncrementsKg: ex.available_increments_kg,
      });
      if (under) {
        underloads.push({
          name: ex.name,
          line: `reps above the ${under.repMax}-rep ceiling at ≥2 RIR in ${under.sessions} consecutive sessions (worst ${under.worstReps}) at ${under.loadKg.toFixed(1)} kg — recommend a load increase`,
        });
      }
    }
  });

  console.log('PROGRESSION-HEALTH AUDIT (report only — nothing is changed)');
  console.log('============================================================');
  console.log(`window=${sessionWindow} sessions/exercise · ${judged} exercises judged`);
  console.log('');
  console.log(`STALLS (${stalls.length}):`);
  for (const f of stalls.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  - ${f.name}: ${f.line}`);
  }
  if (stalls.length === 0) console.log('  none');
  console.log('');
  console.log(`LOAD UNDER-PRESCRIBED (${underloads.length}):`);
  for (const f of underloads.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  - ${f.name}: ${f.line}`);
  }
  if (underloads.length === 0) console.log('  none');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
