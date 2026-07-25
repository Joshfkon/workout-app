/**
 * exercise_performance_snapshots e1RM backfill — AUDIT-FIRST, VERSIONED.
 *
 * Recomputes every snapshot row's estimated_e1rm with the canonical RPE-aware
 * estimator (services/shared/e1rm) so trend charts stop mixing formula
 * vintages (the legacy writer was RPE-blind Epley capped at 12; other
 * surfaces used three more formulas).
 *
 * SAFETY MODEL (standing rules):
 *  - AUDIT FIRST: the default run is read-only — it prints the row count,
 *    per-row source (recomputed from the session's set_logs vs top-set
 *    fallback), and the magnitude distribution of the changes. NO writes.
 *  - VERSIONED, NOT IN-PLACE: with BACKFILL_WRITE=1, each row's original
 *    value is preserved in estimated_e1rm_legacy (COALESCE — written once,
 *    never clobbered on re-runs), estimated_e1rm gets the canonical value
 *    (NULL = no estimable set), and e1rm_version is set to 2.
 *  - IDEMPOTENT: rows already at e1rm_version = 2 are skipped.
 *
 * Recompute source, best first:
 *  1. The session's own set_logs (non-warmup, set_type 'normal'), matched by
 *     (exercise_id, local session date). Local date derives from
 *     workout_sessions.completed_at shifted by TZ_OFFSET_MINUTES (default
 *     -420, US Pacific in July) — the writer used the client's local date.
 *  2. Fallback: the snapshot's own stored top_set_weight_kg / top_set_reps /
 *     top_set_rpe through the canonical estimator (used when no set rows
 *     match, e.g. deleted sessions).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… AUDIT_USER_ID=… \
 *     npx -y tsx scripts/backfillSnapshotE1rm.ts            # audit only
 *   …same env… BACKFILL_WRITE=1 \
 *     npx -y tsx scripts/backfillSnapshotE1rm.ts            # audit, then write
 */

import { createClient } from '@supabase/supabase-js';
import { estimateE1RMFromRpe } from '../services/shared/e1rm';

const KG_TO_LB = 2.20462262;

interface SnapshotRow {
  id: string;
  exercise_id: string;
  session_date: string;
  top_set_weight_kg: number;
  top_set_reps: number;
  top_set_rpe: number;
  estimated_e1rm: number | null;
  estimated_e1rm_legacy: number | null;
  e1rm_version: number | null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
  const write = process.env.BACKFILL_WRITE === '1';
  const tzOffsetMinutes = Number(process.env.TZ_OFFSET_MINUTES ?? -420);

  if (!url || !key || !userId) {
    console.error('Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUDIT_USER_ID');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const localDate = (iso: string): string => {
    const d = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60000);
    return d.toISOString().slice(0, 10);
  };

  // ---- Load snapshots ----
  const { data: snapRows, error: snapErr } = await supabase
    .from('exercise_performance_snapshots')
    .select(
      'id, exercise_id, session_date, top_set_weight_kg, top_set_reps, top_set_rpe, estimated_e1rm, estimated_e1rm_legacy, e1rm_version'
    )
    .eq('user_id', userId)
    .order('session_date', { ascending: true });
  if (snapErr) throw snapErr;
  const snapshots = (snapRows ?? []) as SnapshotRow[];

  // ---- Load set history and index best canonical e1RM per (exercise, day) ----
  const { data: blockRows, error: blockErr } = await supabase
    .from('exercise_blocks')
    .select(
      `exercise_id,
       workout_sessions!inner ( user_id, state, completed_at ),
       set_logs ( weight_kg, reps, rpe, is_warmup, set_type )`
    )
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed');
  if (blockErr) throw blockErr;

  const bestByKey = new Map<string, number>(); // exercise_id|YYYY-MM-DD -> best canonical value
  for (const b of (blockRows ?? []) as any[]) {
    const completedAt = b.workout_sessions?.completed_at;
    if (!completedAt) continue;
    const keyDate = localDate(completedAt);
    for (const s of b.set_logs ?? []) {
      if (s.is_warmup || (s.set_type ?? 'normal') !== 'normal') continue;
      const est = estimateE1RMFromRpe(s.weight_kg, s.reps, s.rpe);
      if (!est) continue;
      const k = `${b.exercise_id}|${keyDate}`;
      const prev = bestByKey.get(k);
      if (prev === undefined || est.value > prev) bestByKey.set(k, est.value);
    }
  }

  // ---- Audit ----
  interface Plan {
    row: SnapshotRow;
    newValue: number | null;
    source: 'set_logs' | 'top_set_fallback';
    skip: boolean;
  }
  const plans: Plan[] = snapshots.map((row) => {
    if ((row.e1rm_version ?? 1) >= 2) {
      return { row, newValue: row.estimated_e1rm, source: 'set_logs', skip: true };
    }
    const fromSets = bestByKey.get(`${row.exercise_id}|${row.session_date}`);
    if (fromSets !== undefined) {
      return { row, newValue: fromSets, source: 'set_logs', skip: false };
    }
    const est = estimateE1RMFromRpe(
      row.top_set_weight_kg,
      row.top_set_reps,
      row.top_set_rpe > 0 ? row.top_set_rpe : undefined
    );
    return { row, newValue: est?.value ?? null, source: 'top_set_fallback', skip: false };
  });

  const pending = plans.filter((p) => !p.skip);
  const buckets = new Map<string, number>();
  const bucketOf = (oldV: number | null, newV: number | null): string => {
    if (oldV == null || oldV <= 0) return newV == null ? 'null → null' : 'null → value';
    if (newV == null) return 'value → NO ESTIMATE';
    const pct = ((newV - oldV) / oldV) * 100;
    if (pct < -20) return 'drop > 20%';
    if (pct < -10) return 'drop 10–20%';
    if (pct < -2) return 'drop 2–10%';
    if (pct <= 2) return 'within ±2%';
    if (pct <= 10) return 'gain 2–10%';
    return 'gain > 10%';
  };
  for (const p of pending) {
    const b = bucketOf(p.row.estimated_e1rm, p.newValue);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }

  console.log('='.repeat(72));
  console.log('SNAPSHOT e1RM BACKFILL — AUDIT');
  console.log(`  snapshot rows:        ${snapshots.length}`);
  console.log(`  already version 2:    ${snapshots.length - pending.length} (skipped)`);
  console.log(`  to update:            ${pending.length}`);
  console.log(`    from set_logs:      ${pending.filter((p) => p.source === 'set_logs').length}`);
  console.log(`    top-set fallback:   ${pending.filter((p) => p.source === 'top_set_fallback').length}`);
  console.log('  magnitude distribution (old → canonical):');
  for (const [b, n] of Array.from(buckets.entries()).sort((a, z) => z[1] - a[1])) {
    console.log(`    ${b.padEnd(20)} ${n}`);
  }
  const biggest = pending
    .filter((p) => p.row.estimated_e1rm != null && p.newValue != null)
    .map((p) => ({
      p,
      pct: ((p.newValue! - (p.row.estimated_e1rm as number)) / (p.row.estimated_e1rm as number)) * 100,
    }))
    .sort((a, z) => Math.abs(z.pct) - Math.abs(a.pct))
    .slice(0, 10);
  console.log('  largest changes:');
  for (const { p, pct } of biggest) {
    console.log(
      `    ${p.row.session_date}  ex=${p.row.exercise_id.slice(0, 8)}  ` +
        `${p.row.estimated_e1rm} → ${p.newValue} kg  (${pct.toFixed(1)}%)  ` +
        `[${((p.newValue ?? 0) * KG_TO_LB).toFixed(1)} lb]  via ${p.source}`
    );
  }

  if (!write) {
    console.log('='.repeat(72));
    console.log('AUDIT ONLY — no writes performed. Re-run with BACKFILL_WRITE=1 to apply.');
    return;
  }

  // ---- Write (versioned) ----
  console.log('='.repeat(72));
  console.log('WRITING (versioned: legacy preserved, e1rm_version=2)…');
  let written = 0;
  let failed = 0;
  for (const p of pending) {
    const { error } = await supabase
      .from('exercise_performance_snapshots')
      .update({
        // Preserve the ORIGINAL value once; never clobber it on re-runs.
        estimated_e1rm_legacy: p.row.estimated_e1rm_legacy ?? p.row.estimated_e1rm,
        estimated_e1rm: p.newValue,
        e1rm_version: 2,
      })
      .eq('id', p.row.id)
      .eq('user_id', userId);
    if (error) {
      failed++;
      console.error(`  FAILED ${p.row.id}: ${error.message}`);
    } else {
      written++;
    }
  }
  console.log(`  updated ${written} row(s), ${failed} failure(s).`);
  console.log('DONE.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
