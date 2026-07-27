/**
 * Trend-migration regression sweep — READ-ONLY.
 *
 * Recomputes every user-facing trend slope two ways over the live dataset:
 *   OLD: the retired ordinary-least-squares fits (raw series, no outlier
 *        rejection, no discontinuity segmentation) exactly as each consumer
 *        implemented them pre-migration;
 *   NEW: the canonical robust estimator (services/shared/trend).
 *
 * Logs every series whose slope changed by more than DIFF_THRESHOLD (50%)
 * or flipped sign — that list is the migration's blast radius and should be
 * eyeballed before shipping. A large delta is EXPECTED wherever the old fit
 * was regressing through a corrupt zero, a tape outlier, or an equipment
 * level shift; the point of the sweep is to confirm each large delta has
 * one of those explanations.
 *
 * Covered surfaces:
 *   - per-lift e1RM trends (84-day window, per exercise)  [liftTrends]
 *   - per-site tape measurement trends (full history)     [measurementTrends]
 *   - body-weight rate (21-day window)                    [weightRate]
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx -y tsx scripts/auditTrendMigration.ts              # all users
 *   …same env… AUDIT_USER_ID=<uuid> \
 *     npx -y tsx scripts/auditTrendMigration.ts              # one user
 */

import { createClient } from '@supabase/supabase-js';
import { computeTrend } from '../services/shared/trend';
import { e1rmValueFromRpe } from '../services/shared/e1rm';

const DIFF_THRESHOLD = 0.5; // 50% relative slope change
const LIFT_WINDOW_DAYS = 84;
const WEIGHT_WINDOW_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

interface SeriesPoint {
  date: string;
  value: number;
}

/** The retired estimator: OLS over elapsed days, raw series, no gating. */
function legacyOlsSlopePerDay(points: SeriesPoint[]): number | null {
  if (points.length < 2) return null;
  const t0 = new Date(`${points[0].date.slice(0, 10)}T00:00:00`).getTime();
  const xs = points.map(
    (p) => (new Date(`${p.date.slice(0, 10)}T00:00:00`).getTime() - t0) / MS_PER_DAY
  );
  const ys = points.map((p) => p.value);
  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) ** 2;
  }
  return varX === 0 ? null : cov / varX;
}

interface Flagged {
  userId: string;
  surface: string;
  series: string;
  oldPerWeek: number;
  newPerWeek: number;
  note: string;
}

const flagged: Flagged[] = [];
let seriesCount = 0;

function compare(
  userId: string,
  surface: string,
  series: string,
  points: SeriesPoint[],
  newOpts: Parameters<typeof computeTrend>[1]
) {
  if (points.length < 3) return;
  seriesCount++;
  const oldSlope = legacyOlsSlopePerDay(points);
  const result = computeTrend(points, newOpts);
  if (oldSlope == null) return;
  const oldWk = oldSlope * 7;
  const newWk = result.slopePerWeek;
  const signFlip = Math.sign(oldWk) !== Math.sign(newWk) && Math.abs(oldWk) > 1e-6;
  const relDiff =
    Math.abs(oldWk) > 1e-6 ? Math.abs(newWk - oldWk) / Math.abs(oldWk) : Math.abs(newWk) > 1e-6 ? 1 : 0;
  if (relDiff > DIFF_THRESHOLD || signFlip) {
    const notes: string[] = [];
    if (result.nInvalid > 0) notes.push(`${result.nInvalid} impossible value(s) hard-rejected`);
    if (result.nExcluded > 0) notes.push(`${result.nExcluded} outlier(s) excluded`);
    if (result.discontinuityAt) {
      notes.push(`level shift at ${result.discontinuityAt.toISOString().slice(0, 10)}`);
    }
    if (result.confidence !== 'high') notes.push(`confidence=${result.confidence}`);
    flagged.push({
      userId,
      surface,
      series,
      oldPerWeek: Math.round(oldWk * 1000) / 1000,
      newPerWeek: Math.round(newWk * 1000) / 1000,
      note: notes.join('; ') || 'no rejection — robust median simply disagrees with OLS',
    });
  }
}

async function auditUser(userId: string) {
  // ---- Lift e1RM trends (84-day window) --------------------------------
  const since = new Date(Date.now() - LIFT_WINDOW_DAYS * MS_PER_DAY).toISOString();
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select(
      'id, completed_at, exercise_blocks (exercises (id, name), set_logs (weight_kg, reps, rpe, is_warmup))'
    )
    .eq('user_id', userId)
    .eq('state', 'completed')
    .gte('completed_at', since)
    .order('completed_at', { ascending: true });

  interface ExerciseSeries {
    name: string;
    points: SeriesPoint[];
  }
  const byExercise = new Map<string, ExerciseSeries>();
  for (const s of (sessions ?? []) as any[]) {
    if (!s.completed_at) continue;
    const date = String(s.completed_at).slice(0, 10);
    for (const block of (s.exercise_blocks as any[]) ?? []) {
      const ex = block.exercises;
      if (!ex) continue;
      let top = 0;
      for (const set of block.set_logs ?? []) {
        if (set.is_warmup || !(set.weight_kg > 0) || !(set.reps > 0)) continue;
        const e = e1rmValueFromRpe(set.weight_kg, set.reps, set.rpe);
        if (e > top) top = e;
      }
      if (top <= 0) continue;
      const entry: ExerciseSeries = byExercise.get(ex.id) ?? { name: ex.name, points: [] };
      entry.points.push({ date, value: top });
      byExercise.set(ex.id, entry);
    }
  }
  byExercise.forEach((entry, id) => {
    compare(userId, 'lift-e1rm', `${entry.name} (${id})`, entry.points, {
      minPoints: 2,
      lowConfidenceSpanDays: 10,
      minResidualFraction: 0.03,
      label: `sweep:e1rm:${id}`,
    });
  });

  // ---- Tape measurement trends (full history) --------------------------
  const { data: measurements } = await supabase
    .from('body_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('logged_at', { ascending: true });
  const siteKeys = new Set<string>();
  for (const row of measurements ?? []) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'number' && !['id'].includes(k)) siteKeys.add(k);
    }
  }
  for (const site of Array.from(siteKeys)) {
    const points: SeriesPoint[] = (measurements ?? [])
      .filter((r: any) => typeof r[site] === 'number' && Number.isFinite(r[site]))
      .map((r: any) => ({ date: r.logged_at, value: r[site] }));
    compare(userId, 'measurement', site, points, {
      minPoints: 3,
      lowConfidenceSpanDays: 21,
      detectDiscontinuity: false,
      label: `sweep:measurement:${site}`,
    });
  }

  // ---- Body-weight rate (21-day window) ---------------------------------
  const weightSince = new Date(Date.now() - WEIGHT_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const { data: weighIns } = await supabase
    .from('weight_logs')
    .select('logged_at, weight_kg')
    .eq('user_id', userId)
    .gte('logged_at', weightSince)
    .order('logged_at', { ascending: true });
  const weightPoints: SeriesPoint[] = (weighIns ?? [])
    .filter((w: any) => Number.isFinite(w.weight_kg) && w.weight_kg > 0)
    .map((w: any) => ({ date: String(w.logged_at).slice(0, 10), value: w.weight_kg }));
  compare(userId, 'weight-rate', 'bodyweight', weightPoints, {
    minPoints: 2,
    detectDiscontinuity: false,
    lowConfidenceSpanDays: 0,
    label: 'sweep:weight',
  });
}

async function main() {
  let userIds: string[];
  if (process.env.AUDIT_USER_ID) {
    userIds = [process.env.AUDIT_USER_ID];
  } else {
    const { data } = await supabase.from('users').select('id');
    userIds = (data ?? []).map((u: any) => u.id);
  }

  for (const id of userIds) {
    await auditUser(id);
  }

  console.log(`\n=== Trend migration sweep: ${seriesCount} series compared ===`);
  console.log(`${flagged.length} series changed slope by >${DIFF_THRESHOLD * 100}% or flipped sign:\n`);
  for (const f of flagged) {
    console.log(
      `  [${f.surface}] user=${f.userId.slice(0, 8)} ${f.series}: ` +
        `${f.oldPerWeek}/wk → ${f.newPerWeek}/wk — ${f.note}`
    );
  }
  if (flagged.length === 0) console.log('  (none)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
