/**
 * Rep-range vs actual-reps IQR audit (READ-ONLY — SELECT queries only).
 *
 * The fourth-requested range audit: for every exercise the user has trained,
 * compare the exercise's TARGET rep range (the most recent block's
 * target_rep_range, falling back to the exercise default) against the
 * INTERQUARTILE RANGE of the reps actually logged on normal working sets in
 * the recent window.
 *
 * An exercise is FLAGGED when the two ranges do not overlap, in EITHER
 * direction:
 *   - reps consistently ABOVE the range (Q1 > repMax): the range is set too
 *     low — "cleared the floor" is tautological (Cable Curl 12-15 vs logged
 *     18/16/17);
 *   - reps consistently BELOW the range (Q3 < repMin): the range is set too
 *     high — the floor is unreachable at the working load.
 *
 * REPORT ONLY. Nothing is narrowed, widened, or written — per the standing
 * audit-before-data-changes rule the output is the input to a human decision.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   AUDIT_USER_ID=<uuid> npx -y tsx scripts/auditRepRangeIQR.ts
 *
 * Optional env:
 *   AUDIT_SESSIONS=10          recent sessions per exercise (default matches
 *                              HISTORY_SESSIONS_PER_EXERCISE)
 *   AUDIT_MIN_SETS=6           minimum logged working sets before an exercise
 *                              is judged at all (quartiles off 3 sets are noise)
 *   AUDIT_EXERCISE_NAME="..."  restrict to one exercise (ilike match)
 *
 * This script NEVER writes: no insert/update/upsert/delete anywhere.
 */

import { createClient } from '@supabase/supabase-js';
import { HISTORY_SESSIONS_PER_EXERCISE } from '../services/suggestionEngine/constants';

interface SetRow {
  weight_kg: number;
  reps: number;
  is_warmup: boolean;
  set_type: string | null;
}

interface BlockRow {
  id: string;
  exercise_id: string;
  target_rep_range: number[] | null;
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
  } | null;
}

/** Linear-interpolated quartile (type-7, the spreadsheet default). */
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
  const sessionWindow = Number(process.env.AUDIT_SESSIONS ?? HISTORY_SESSIONS_PER_EXERCISE);
  const minSets = Number(process.env.AUDIT_MIN_SETS ?? 6);
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
        `id, exercise_id, target_rep_range,
         workout_sessions!inner ( id, completed_at, state, is_deload ),
         set_logs ( weight_kg, reps, is_warmup, set_type ),
         exercises ( id, name, default_rep_range, exercise_type )`
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

  // Group by exercise, newest session first, deloads excluded (as the app
  // does everywhere reps are graded). Duration exercises carry seconds in
  // `reps` — no rep-range claim to audit.
  const byExercise = new Map<string, BlockRow[]>();
  for (const b of blocks) {
    if (!b.exercises || b.workout_sessions?.is_deload) continue;
    if (b.exercises.exercise_type === 'duration_based') continue;
    const list = byExercise.get(b.exercise_id) ?? [];
    list.push(b);
    byExercise.set(b.exercise_id, list);
  }
  byExercise.forEach((list) =>
    list.sort(
      (a, b) =>
        Date.parse(b.workout_sessions?.completed_at ?? '') -
        Date.parse(a.workout_sessions?.completed_at ?? '')
    )
  );

  interface Finding {
    name: string;
    direction: 'above' | 'below';
    range: [number, number];
    q1: number;
    q3: number;
    median: number;
    nSets: number;
    nSessions: number;
  }
  const findings: Finding[] = [];
  let judged = 0;
  let skippedThin = 0;

  byExercise.forEach((list) => {
    const ex = list[0].exercises!;
    // Target range: the most recent block's stored range, else the default.
    const range = (list[0].target_rep_range ?? ex.default_rep_range) as
      | [number, number]
      | null;
    if (!range || range.length < 2) return;

    // Recent window, normal working sets only (same eligibility as the
    // anchor pool / history card: non-warmup, set_type 'normal').
    const seenSessions = new Set<string>();
    const reps: number[] = [];
    for (const b of list) {
      const sid = b.workout_sessions?.id;
      if (!sid) continue;
      if (!seenSessions.has(sid) && seenSessions.size >= sessionWindow) continue;
      const working = (b.set_logs ?? []).filter(
        (s) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal' && s.reps > 0 && s.weight_kg > 0
      );
      if (working.length === 0) continue;
      seenSessions.add(sid);
      for (const s of working) reps.push(s.reps);
    }
    if (reps.length < minSets) {
      skippedThin++;
      return;
    }
    judged++;

    reps.sort((a, b) => a - b);
    const q1 = quantile(reps, 0.25);
    const q3 = quantile(reps, 0.75);
    const median = quantile(reps, 0.5);
    const [repMin, repMax] = range;

    // Non-overlap, both directions.
    if (q1 > repMax) {
      findings.push({
        name: ex.name,
        direction: 'above',
        range: [repMin, repMax],
        q1,
        q3,
        median,
        nSets: reps.length,
        nSessions: seenSessions.size,
      });
    } else if (q3 < repMin) {
      findings.push({
        name: ex.name,
        direction: 'below',
        range: [repMin, repMax],
        q1,
        q3,
        median,
        nSets: reps.length,
        nSessions: seenSessions.size,
      });
    }
  });

  console.log('REP-RANGE vs LOGGED-REPS IQR AUDIT (report only — nothing is changed)');
  console.log('======================================================================');
  console.log(
    `window=${sessionWindow} sessions/exercise · min ${minSets} working sets · ` +
      `${judged} exercises judged, ${skippedThin} skipped (too little data)`
  );
  console.log('');
  if (findings.length === 0) {
    console.log('No exercise has a target range disjoint from its logged-reps IQR.');
    return;
  }
  findings.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of findings) {
    const dir =
      f.direction === 'above'
        ? 'logged reps sit ABOVE the range (range too low)'
        : 'logged reps sit BELOW the range (range too high)';
    console.log(
      `  ${f.name}\n` +
        `    target ${f.range[0]}-${f.range[1]} · logged IQR ${f.q1}-${f.q3} ` +
        `(median ${f.median}) over ${f.nSets} sets / ${f.nSessions} sessions\n` +
        `    → ${dir}`
    );
  }
  console.log('');
  console.log(
    `${findings.length} exercise(s) flagged. No ranges were changed — adjust ` +
      'per-exercise via the workout editor / plateau range switch.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
