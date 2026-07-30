/**
 * Last-3-sessions rep-range audit (READ-ONLY — SELECT queries only).
 *
 * 2026-07-29 prescription-defects remediation, step 6: after fixing the MTS
 * Abdominal Crunch range (8-12 -> 12-18, migration
 * 20260729000001_mts_abdominal_crunch_rep_range.sql), flag every OTHER
 * exercise whose last 3 completed sessions CONSISTENTLY logged outside its
 * configured range — the same "config disagrees with reality" smell.
 *
 * "Consistently" here means: in EACH of the exercise's last 3 completed
 * (non-deload) sessions, a strict majority of its normal working sets fell
 * outside the configured range on the SAME side. One odd session is noise;
 * three in a row on the same side is a mis-set range.
 *
 * REPORT ONLY. Nothing is written — per the standing audit-before-data-
 * changes rule, the output is the input to a human decision. (The broader
 * IQR-based audit lives in auditRepRangeIQR.ts; this one implements the
 * step-6 review rule exactly.)
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   AUDIT_USER_ID=<uuid> npx -y tsx scripts/auditRepRangeLast3Sessions.ts
 *
 * Optional env:
 *   AUDIT_EXERCISE_NAME="..."  restrict to one exercise (ilike match)
 */

import { createClient } from '@supabase/supabase-js';

const SESSIONS_REQUIRED = 3;

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

/** One session's verdict against the range: which side most sets fell on. */
function sessionVerdict(
  reps: number[],
  range: [number, number]
): 'above' | 'below' | 'in_range' {
  const [repMin, repMax] = range;
  const above = reps.filter((r) => r > repMax).length;
  const below = reps.filter((r) => r < repMin).length;
  if (above * 2 > reps.length) return 'above';
  if (below * 2 > reps.length) return 'below';
  return 'in_range';
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
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
    sessions: Array<{ date: string; reps: number[] }>;
  }
  const findings: Finding[] = [];
  let judged = 0;
  let skippedThin = 0;

  byExercise.forEach((list) => {
    const ex = list[0].exercises!;
    // Configured range: the most recent block's stored range, else the default.
    const range = (list[0].target_rep_range ?? ex.default_rep_range) as
      | [number, number]
      | null;
    if (!range || range.length < 2) return;

    // Collapse blocks to their session, newest first, keeping only sessions
    // with normal working sets (non-warmup, set_type 'normal' — the same
    // eligibility as the anchor pool / history card).
    const sessions: Array<{ id: string; date: string; reps: number[] }> = [];
    for (const b of list) {
      const s = b.workout_sessions;
      if (!s?.id) continue;
      const working = (b.set_logs ?? []).filter(
        (x) => !x.is_warmup && (x.set_type ?? 'normal') === 'normal' && x.reps > 0 && x.weight_kg > 0
      );
      if (working.length === 0) continue;
      const existing = sessions.find((x) => x.id === s.id);
      if (existing) {
        existing.reps.push(...working.map((x) => x.reps));
      } else {
        sessions.push({
          id: s.id,
          date: (s.completed_at ?? '').slice(0, 10),
          reps: working.map((x) => x.reps),
        });
      }
    }
    if (sessions.length < SESSIONS_REQUIRED) {
      skippedThin++;
      return;
    }
    judged++;

    const last3 = sessions.slice(0, SESSIONS_REQUIRED);
    const verdicts = last3.map((s) => sessionVerdict(s.reps, range));
    const allSameSide =
      verdicts.every((v) => v === 'above') || verdicts.every((v) => v === 'below');
    if (allSameSide) {
      findings.push({
        name: ex.name,
        direction: verdicts[0] as 'above' | 'below',
        range,
        sessions: last3.map(({ date, reps }) => ({ date, reps })),
      });
    }
  });

  findings.sort((a, b) => a.name.localeCompare(b.name));

  console.log(
    `\nRep-range last-${SESSIONS_REQUIRED}-sessions audit — user ${userId}\n` +
      `Exercises judged: ${judged} (skipped, fewer than ${SESSIONS_REQUIRED} sessions: ${skippedThin})\n`
  );
  if (findings.length === 0) {
    console.log('No exercise logged consistently outside its configured range. ✔');
    return;
  }
  console.log(
    `FLAGGED FOR REVIEW (${findings.length}) — no data has been changed; ` +
      'each line is a candidate for a range edit like the MTS Abdominal Crunch fix:\n'
  );
  for (const f of findings) {
    console.log(
      `  ${f.name} — configured ${f.range[0]}-${f.range[1]}, last ` +
        `${SESSIONS_REQUIRED} sessions consistently ${f.direction.toUpperCase()} it:`
    );
    for (const s of f.sessions) {
      console.log(`      ${s.date}: ${s.reps.join(', ')} reps`);
    }
  }
  console.log(
    '\nReview each flagged exercise and, if the range is wrong, change it with a ' +
      'guarded migration (see 20260729000001_mts_abdominal_crunch_rep_range.sql). ' +
      'Do not auto-edit.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
