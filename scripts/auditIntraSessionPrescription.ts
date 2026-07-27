/**
 * Intra-session prescription audit (READ-ONLY — SELECT queries only).
 *
 * Whole-library companion to the Phase A/D work and the pre-write reports the
 * held phases (B and E) require. For every exercise the user has trained it
 * prints, using the app's OWN pure functions:
 *
 *   1. UNREACHABLE REP RANGES ("Also" audit): the e1RM required to clear the
 *      range ceiling (repMax at the current top working load, at the target
 *      RIR, via the canonical estimator) vs the stored anchor
 *      (bestQualifyingE1RM). Ranges whose ceiling needs more than
 *      AUDIT_UNREACHABLE_MARGIN (default 5%) above the demonstrated anchor
 *      are listed — REPORT ONLY, nothing is narrowed automatically.
 *
 *   2. RIR CAPTURE CONTAMINATION (Phase E estimate): sets whose resolved RIR
 *      (feedback.repsInTank first, then rpe→RIR — resolveLastRir's read
 *      order) exactly equals the block's prescribed target RIR, and sessions
 *      where EVERY working set matches the target (the pre-selected-chip
 *      signature; e.g. the Jul 11 calf session, four sets all @2). This is
 *      the contamination estimate for excluding flagged sets from
 *      calibration/anchor pools.
 *
 *   3. PHASE B ANCHOR PREVIEW (report BEFORE any write): the current
 *      max-across-sets anchor vs (a) a first-working-set-of-session anchor
 *      and (b) the best true-failure (0 RIR) set, per exercise — the exact
 *      delta Phase B would apply to the stored anchors.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   AUDIT_USER_ID=<uuid> npx -y tsx scripts/auditIntraSessionPrescription.ts
 *
 * Optional env:
 *   AUDIT_UNREACHABLE_MARGIN=0.05   flag threshold for section 1
 *   AUDIT_EXERCISE_NAME="..."       restrict to one exercise (ilike match)
 *
 * This script NEVER writes: no insert/update/upsert/delete anywhere.
 */

import { createClient } from '@supabase/supabase-js';
import {
  historySetE1RM,
  bestQualifyingE1RM,
  type AnchorCandidate,
} from '../services/suggestionEngine/e1rmAnchor';
import { HISTORY_SESSIONS_PER_EXERCISE } from '../services/suggestionEngine/constants';
import { inferRolesForSession } from '../services/suggestionEngine/setRoles';
import { rpeToRir } from '../types/schema';

const KG_TO_LB = 2.20462262;
const lb = (kg: number) => `${(kg * KG_TO_LB).toFixed(1)} lb`;

interface SetRow {
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_warmup: boolean;
  set_number: number | null;
  set_type: string | null;
  logged_at: string;
  feedback: { repsInTank?: number | null } | null;
}

interface BlockRow {
  id: string;
  exercise_id: string;
  target_rep_range: number[] | null;
  target_rir: number | null;
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
    default_rir: number | null;
    min_weight_increment_kg: number | null;
    available_increments_kg: number[] | null;
    exercise_type: string | null;
  } | null;
}

/** resolveLastRir's read order, applied to a stored row (no target fallback —
 *  a set with no effort signal at all is excluded from the contamination
 *  denominator instead of being counted as a match). */
function resolvedRir(s: SetRow): number | null {
  if (s.feedback?.repsInTank != null) return Math.max(0, s.feedback.repsInTank);
  if (s.rpe != null) return Math.max(0, rpeToRir(s.rpe));
  return null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
  const margin = Number(process.env.AUDIT_UNREACHABLE_MARGIN ?? 0.05);
  const onlyExercise = process.env.AUDIT_EXERCISE_NAME;

  if (!url || !key || !userId) {
    console.error(
      'Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUDIT_USER_ID'
    );
    process.exit(1);
  }
  const supabase = createClient(url, key);

  // One paged read of all completed blocks + sets + joined exercise metadata.
  const blocks: BlockRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('exercise_blocks')
      .select(
        `id, exercise_id, target_rep_range, target_rir,
         workout_sessions!inner ( id, completed_at, state, is_deload ),
         set_logs ( weight_kg, reps, rpe, is_warmup, set_number, set_type, logged_at, feedback ),
         exercises ( id, name, default_rep_range, default_rir, min_weight_increment_kg, available_increments_kg, exercise_type )`
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

  // Group by exercise, newest session first, deloads excluded (as the app does).
  const byExercise = new Map<string, BlockRow[]>();
  for (const b of blocks) {
    if (!b.exercises || b.workout_sessions?.is_deload) continue;
    if (b.exercises.exercise_type === 'duration_based') continue; // no e1RM domain
    const list = byExercise.get(b.exercise_id) ?? [];
    list.push(b);
    byExercise.set(b.exercise_id, list);
  }
  byExercise.forEach((list) => {
    list.sort(
      (a: BlockRow, b: BlockRow) =>
        Date.parse(b.workout_sessions?.completed_at ?? '') -
        Date.parse(a.workout_sessions?.completed_at ?? '')
    );
  });

  const unreachable: string[] = [];
  let totalSets = 0;
  let setsAtTarget = 0;
  let setsWithSignal = 0;
  let sessionsAllAtTarget = 0;
  let sessionsGraded = 0;
  const allAtTargetExamples: string[] = [];
  const anchorPreview: string[] = [];

  console.log('='.repeat(96));
  console.log(
    `INTRA-SESSION PRESCRIPTION AUDIT  user=${userId}  exercises=${byExercise.size}  ` +
      `unreachable-margin=${(margin * 100).toFixed(0)}%`
  );

  const exerciseLists = Array.from(byExercise.values());
  for (const list of exerciseLists) {
    const ex = list[0].exercises!;
    const window = list.slice(0, HISTORY_SESSIONS_PER_EXERCISE);

    // ---- Anchor pools (current rule + Phase B alternatives) ----
    const currentPool: AnchorCandidate[] = [];
    const firstSetPool: AnchorCandidate[] = [];
    let bestFailureE1RM = 0;
    let bestFailureLabel = '';

    for (const block of window) {
      const sess = block.workout_sessions;
      const timeMs = Date.parse(sess?.completed_at ?? '');
      const sets = [...(block.set_logs ?? [])]
        .filter((s) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal')
        .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
      const roles = inferRolesForSession(sets.map((s) => ({ weightKg: s.weight_kg })));
      let firstWorkingSeen = false;
      sets.forEach((s, i) => {
        const est = historySetE1RM(s.weight_kg, s.reps, s.rpe ?? 10);
        if (!est) return;
        const candidate = { e1rmKg: est.value, sessionId: sess?.id ?? block.id, timeMs };
        currentPool.push(candidate);
        if (roles[i] === 'working' && !firstWorkingSeen) {
          firstWorkingSeen = true;
          firstSetPool.push(candidate);
        }
        const rir = resolvedRir(s);
        if (rir === 0 && est.value > bestFailureE1RM) {
          bestFailureE1RM = est.value;
          bestFailureLabel = `${sess?.completed_at?.slice(0, 10)} ${s.weight_kg}×${s.reps}@0`;
        }
      });
    }

    const currentAnchor = bestQualifyingE1RM(currentPool);
    const firstSetAnchor = bestQualifyingE1RM(firstSetPool);

    // ---- 1. Unreachable rep-range ceiling ----
    const newest = window[0];
    const repRange = (newest.target_rep_range ?? ex.default_rep_range ?? [8, 12]) as number[];
    const targetRir = newest.target_rir ?? ex.default_rir ?? 2;
    const repMax = repRange[1];
    const newestSets = (newest.set_logs ?? []).filter(
      (s) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal' && s.weight_kg > 0
    );
    const newestRoles = inferRolesForSession(
      newestSets.map((s) => ({ weightKg: s.weight_kg }))
    );
    const topWorking = newestSets.reduce(
      (m, s, i) => (newestRoles[i] === 'working' && s.weight_kg > m ? s.weight_kg : m),
      0
    );
    if (currentAnchor > 0 && topWorking > 0 && Number.isFinite(repMax)) {
      // Required capacity to CLEAR the range: repMax at the top working load
      // leaving the target reserve, through the canonical estimator.
      const required = historySetE1RM(topWorking, repMax, 10 - targetRir);
      if (required && required.value > currentAnchor * (1 + margin)) {
        const pct = ((required.value / currentAnchor - 1) * 100).toFixed(1);
        unreachable.push(
          `${ex.name}: range ${repRange[0]}-${repMax} @ ${targetRir} RIR at ${lb(topWorking)} ` +
            `needs e1RM ${lb(required.value)} — anchor is ${lb(currentAnchor)} (+${pct}% needed)`
        );
      }
    }

    // ---- 2. RIR contamination ----
    for (const block of list) {
      const target = block.target_rir;
      if (target == null) continue;
      const working = (block.set_logs ?? []).filter(
        (s) => !s.is_warmup && s.weight_kg > 0 && s.reps > 0
      );
      const withSignal = working
        .map((s) => resolvedRir(s))
        .filter((r): r is number => r !== null);
      totalSets += working.length;
      setsWithSignal += withSignal.length;
      const matches = withSignal.filter((r) => r === target).length;
      setsAtTarget += matches;
      if (withSignal.length >= 2) {
        sessionsGraded += 1;
        if (matches === withSignal.length) {
          sessionsAllAtTarget += 1;
          if (allAtTargetExamples.length < 15) {
            allAtTargetExamples.push(
              `${block.workout_sessions?.completed_at?.slice(0, 10)}  ${ex.name}  ` +
                `${withSignal.length} sets all @${target}`
            );
          }
        }
      }
    }

    // ---- 3. Phase B anchor preview ----
    if (currentAnchor > 0) {
      const delta =
        firstSetAnchor > 0
          ? `${(((firstSetAnchor - currentAnchor) / currentAnchor) * 100).toFixed(1)}%`
          : 'n/a';
      anchorPreview.push(
        `${ex.name}: current(max-any-set)=${lb(currentAnchor)}  ` +
          `first-working-set=${firstSetAnchor > 0 ? lb(firstSetAnchor) : '—'} (${delta})  ` +
          `best-true-failure=${bestFailureE1RM > 0 ? `${lb(bestFailureE1RM)} [${bestFailureLabel}]` : '—'}`
      );
    }
  }

  console.log('='.repeat(96));
  console.log(`1. UNREACHABLE REP RANGES (ceiling needs > +${(margin * 100).toFixed(0)}% over the anchor)`);
  console.log('   Report only — nothing is auto-narrowed.');
  if (unreachable.length === 0) console.log('   none');
  unreachable.forEach((l) => console.log(`   ${l}`));

  console.log('='.repeat(96));
  console.log('2. RIR CAPTURE CONTAMINATION (Phase E estimate)');
  console.log(
    `   working sets: ${totalSets}  with an effort signal: ${setsWithSignal}  ` +
      `resolved RIR == prescribed target: ${setsAtTarget} ` +
      `(${setsWithSignal > 0 ? ((setsAtTarget / setsWithSignal) * 100).toFixed(1) : '0'}% of signal sets)`
  );
  console.log(
    `   sessions (>=2 signal sets): ${sessionsGraded}  EVERY set exactly at target: ${sessionsAllAtTarget} ` +
      `(${sessionsGraded > 0 ? ((sessionsAllAtTarget / sessionsGraded) * 100).toFixed(1) : '0'}%) — the pre-selected-chip signature`
  );
  allAtTargetExamples.forEach((l) => console.log(`   ${l}`));

  console.log('='.repeat(96));
  console.log('3. PHASE B ANCHOR PREVIEW (no writes — what a freshness anchor would change)');
  anchorPreview.forEach((l) => console.log(`   ${l}`));
  console.log('='.repeat(96));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
