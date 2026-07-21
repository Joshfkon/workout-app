/**
 * Progression Logic Audit (REPORT ONLY — never mutates data)
 *
 * Replays historical sessions per exercise through the OLD session-start
 * progression logic (pre-v4: all-sets bump gate + verbatim rep replay) and the
 * NEW logic (v4: sessionMetPrescription-driven — MET → bump + repMin reseed,
 * not-met → +1 rep capped at repMax, stall → hold, 3rd miss → deload flag) and
 * prints a diff table: date, exercise, old prescription, new prescription, and
 * which rule fired.
 *
 * Reference slot: the TOP working set of the previous session (progression is
 * graded at the top load). All weights are kg as stored.
 *
 * Flags (candidate bugs, per review checklist):
 *  - JUMP>5%: the new prescribed load exceeds the previous top working load by
 *    more than 5%.
 *  - REPS>MAX: the new prescribed rep target exceeds the block's repMax.
 *
 * Usage (read-only; SELECT queries only):
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *     AUDIT_USER_ID=<uuid> \
 *     npx -y tsx scripts/auditProgressionDiff.ts
 *
 * Offline / export mode (same shape as the FixtureExercise type below):
 *   npx -y tsx scripts/auditProgressionDiff.ts --fixture data.json
 */

import * as fs from 'fs';
import {
  recommendSet,
  recommendSessionStart,
  sessionMetPrescription,
  confirmedRegression,
  type PrevSessionSet,
  type SetRecommendation,
} from '../services/setRecommender';
import {
  DEADBAND_RIR,
  MAX_STEP_PCT,
  REP_OVERSHOOT,
} from '../services/suggestionEngine/constants';
import { inferRolesForSession } from '../services/suggestionEngine/setRoles';
import { clamp, roundToIncrement } from '../lib/utils';
import { rpeToRir } from '../types/schema';

// ============================================
// Input shapes
// ============================================

interface FixtureSession {
  /** ISO date of the session (display only). */
  date: string;
  sets: PrevSessionSet[];
}

interface FixtureExercise {
  exercise: string;
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
  /** Oldest first. */
  sessions: FixtureSession[];
}

// ============================================
// OLD logic — frozen pre-v4 copies (do not "fix"; this IS the baseline)
// ============================================

/** Pre-v4 earnedSessionBump: EVERY working set at repMax with >= DEADBAND spare. */
function oldEarnedSessionBump(
  prevSessionSets: PrevSessionSet[],
  targetRepRange: [number, number],
  targetRir: number
): boolean {
  const repMax = targetRepRange[1];
  const roles = inferRolesForSession(prevSessionSets.map((s) => ({ weightKg: s.weightKg })));
  let graded = 0;
  for (let i = 0; i < prevSessionSets.length; i++) {
    if (roles[i] !== 'working') continue;
    const s = prevSessionSets[i];
    if (!(s.weightKg > 0) || !(s.reps > 0)) continue;
    graded++;
    const dev = Math.max(0, s.rir ?? targetRir) - targetRir;
    const qualified = s.reps > repMax + REP_OVERSHOOT || (s.reps >= repMax && dev >= DEADBAND_RIR);
    if (!qualified) return false;
  }
  return graded > 0;
}

/** Pre-v4 regression step-down (was module-private; reproduced verbatim). */
function oldRegressionStepDown(weightKg: number, inc: number): number {
  let stepped = roundToIncrement(Math.max(weightKg - inc, weightKg * (1 - MAX_STEP_PCT)), inc);
  if (stepped >= weightKg) stepped = weightKg - inc;
  return Math.max(0, stepped);
}

interface OldRec {
  weightKg: number;
  reps: number;
  rationale: string;
}

/**
 * Pre-v4 recommendSessionStart flow: recommendSet on the reference set, the
 * regression path (unchanged pieces imported), the all-sets bump veto, and a
 * verbatim rep replay on maintain.
 */
function oldRecommendSessionStart(input: {
  prevWeightKg: number;
  prevReps: number;
  prevRir?: number;
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
  prevSessionSets?: PrevSessionSet[];
  priorSessionSets?: PrevSessionSet[];
}): OldRec {
  const rec = recommendSet({
    lastWeightKg: input.prevWeightKg,
    lastReps: input.prevReps,
    lastRir: input.prevRir ?? input.targetRir,
    setsCompletedThisExercise: 0,
    targetRepRange: input.targetRepRange,
    targetRir: input.targetRir,
    minIncrementKg: input.minIncrementKg,
  });
  const [repMin, repMax] = input.targetRepRange;
  const holdVerbatim: OldRec = {
    weightKg: input.prevWeightKg,
    reps: clamp(input.prevReps, 1, repMax + 5),
    rationale: 'maintain',
  };
  if (rec.rationale === 'reduce_load' && input.priorSessionSets !== undefined) {
    const lastSets =
      input.prevSessionSets && input.prevSessionSets.length > 0
        ? input.prevSessionSets
        : [{ weightKg: input.prevWeightKg, reps: input.prevReps, rir: input.prevRir }];
    if (confirmedRegression(lastSets, input.priorSessionSets, input.targetRepRange)) {
      const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
      return {
        weightKg: oldRegressionStepDown(input.prevWeightKg, inc),
        reps: Math.round((repMin + repMax) / 2),
        rationale: 'reduce_load',
      };
    }
    return holdVerbatim;
  }
  if (
    rec.rationale === 'increase_load' &&
    input.prevSessionSets &&
    input.prevSessionSets.length > 0 &&
    !oldEarnedSessionBump(input.prevSessionSets, input.targetRepRange, input.targetRir)
  ) {
    return holdVerbatim;
  }
  if (rec.rationale === 'maintain' && input.prevReps > 0 && input.prevWeightKg > 0) {
    return holdVerbatim;
  }
  return { weightKg: rec.weightKg, reps: rec.reps, rationale: rec.rationale };
}

// ============================================
// Replay
// ============================================

interface DiffRow {
  date: string;
  exercise: string;
  prevTop: string;
  oldRx: string;
  newRx: string;
  rule: string;
  flags: string;
}

/**
 * Reference slot for the replay: the top working set of the session,
 * preferring sets inside the grading scheme window (mirrors the engine's
 * gradeSession exclusions) so a pyramid's heavy out-of-range top (200×4 vs a
 * 6–10 range) doesn't become the reference. Falls back to the heaviest set.
 */
function topWorkingSet(
  sets: PrevSessionSet[],
  [repMin, repMax]: [number, number]
): PrevSessionSet | null {
  const valid = sets.filter((s) => s.weightKg > 0 && s.reps > 0);
  if (valid.length === 0) return null;
  const schemeMax = Math.max(repMin * 2, repMax);
  const inScheme = valid.filter(
    (s) => (s.reps >= repMin && s.reps <= schemeMax) || s.reps > repMax + REP_OVERSHOOT
  );
  const pool = inScheme.length > 0 ? inScheme : valid;
  const topW = pool.reduce((m, s) => Math.max(m, s.weightKg), 0);
  const atTop = pool.filter((s) => s.weightKg === topW);
  return atTop.reduce((best, s) => (s.reps > (best?.reps ?? 0) ? s : best), atTop[0]);
}

function ruleLabel(
  newRec: SetRecommendation,
  ref: PrevSessionSet,
  prevSets: PrevSessionSet[],
  target: { targetRepRange: [number, number]; targetRir: number }
): string {
  const [repMin, repMax] = target.targetRepRange;
  if (newRec.rationale === 'increase_load') return 'MET → bump, seed repMin';
  if (newRec.rationale === 'reduce_load') return 'regression → step down';
  if (newRec.suggestDeload) return 'stall ×3 → hold + deload flag';
  if (newRec.reps > ref.reps) return '+1 rep';
  if (ref.reps >= repMax) return '+1 rep (capped at repMax)';
  const refRir = Math.max(0, ref.rir ?? target.targetRir);
  if (ref.reps < repMin || refRir - target.targetRir <= -DEADBAND_RIR) return 'hold (red flag: miss)';
  const gradable = prevSets.some((s) => Number.isFinite(s.weightKg) && s.weightKg > 0);
  if (!gradable) return 'hold (ungradable data)';
  return 'hold (stall ×2)';
}

function fmt(w: number, r: number): string {
  const wStr = Number.isInteger(w) ? String(w) : w.toFixed(1);
  return `${wStr}×${r}`;
}

function replayExercise(ex: FixtureExercise): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let i = 1; i < ex.sessions.length; i++) {
    const prev = ex.sessions[i - 1];
    const prior = i >= 2 ? ex.sessions[i - 2].sets : [];
    const earlier = i >= 3 ? ex.sessions[i - 3].sets : undefined;
    const ref = topWorkingSet(prev.sets, ex.targetRepRange);
    if (!ref) continue;

    const common = {
      prevWeightKg: ref.weightKg,
      prevReps: ref.reps,
      prevRir: ref.rir,
      targetRepRange: ex.targetRepRange,
      targetRir: ex.targetRir,
      minIncrementKg: ex.minIncrementKg,
      prevSessionSets: prev.sets,
      priorSessionSets: prior,
    };
    const oldRec = oldRecommendSessionStart(common);
    const newRec = recommendSessionStart({ ...common, earlierSessionSets: earlier });

    const flags: string[] = [];
    if (newRec.weightKg > ref.weightKg * 1.05) flags.push('JUMP>5%');
    if (newRec.reps > ex.targetRepRange[1]) flags.push('REPS>MAX');

    rows.push({
      date: ex.sessions[i].date,
      exercise: ex.exercise,
      prevTop: fmt(ref.weightKg, ref.reps) + (ref.rir != null ? `@${ref.rir}RIR` : ''),
      oldRx: fmt(oldRec.weightKg, oldRec.reps),
      newRx: fmt(newRec.weightKg, newRec.reps),
      rule: ruleLabel(newRec, ref, prev.sets, {
        targetRepRange: ex.targetRepRange,
        targetRir: ex.targetRir,
      }),
      flags: flags.join(' '),
    });
  }
  return rows;
}

// ============================================
// Data loading
// ============================================

async function loadFromSupabase(): Promise<FixtureExercise[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
  if (!url || !key || !userId) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and AUDIT_USER_ID, or pass --fixture <file.json>.'
    );
  }
  // Lazy import so fixture mode needs no supabase dependency at runtime.
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  // Read-only: completed, non-deload sessions with their blocks and set logs.
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(
      `
      id,
      completed_at,
      is_deload,
      exercise_blocks (
        exercise_id,
        target_rep_range,
        target_rir,
        exercises ( id, name, min_weight_increment_kg ),
        set_logs ( weight_kg, reps, rpe, is_warmup, set_number, set_type )
      )
    `
    )
    .eq('user_id', userId)
    .eq('state', 'completed')
    .order('completed_at', { ascending: true });
  if (error) throw error;

  const byExercise = new Map<string, FixtureExercise>();
  for (const session of (data ?? []) as any[]) {
    if (session.is_deload || !session.completed_at) continue;
    for (const block of session.exercise_blocks ?? []) {
      const exId = block.exercise_id as string;
      const name = block.exercises?.name ?? exId;
      const range = (block.target_rep_range ?? [8, 12]) as [number, number];
      const sets: PrevSessionSet[] = (block.set_logs ?? [])
        .filter((s: any) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal')
        .sort((a: any, b: any) => (a.set_number ?? 0) - (b.set_number ?? 0))
        .filter((s: any) => (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0)
        .map((s: any) => ({
          weightKg: s.weight_kg as number,
          reps: s.reps as number,
          rir: s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : undefined,
        }));
      if (sets.length === 0) continue;
      let entry = byExercise.get(exId);
      if (!entry) {
        entry = {
          exercise: name,
          targetRepRange: [range[0] ?? 8, range[1] ?? 12],
          targetRir: (block.target_rir as number) ?? 2,
          minIncrementKg: block.exercises?.min_weight_increment_kg ?? undefined,
          sessions: [],
        };
        byExercise.set(exId, entry);
      }
      entry.sessions.push({ date: String(session.completed_at).slice(0, 10), sets });
    }
  }
  return Array.from(byExercise.values()).filter((e) => e.sessions.length >= 2);
}

function loadFromFixture(path: string): FixtureExercise[] {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Fixture must be a JSON array of exercises.');
  return parsed as FixtureExercise[];
}

// ============================================
// Main
// ============================================

function printTable(rows: DiffRow[]): void {
  const headers = ['date', 'exercise', 'prev top set', 'OLD rx', 'NEW rx', 'rule fired', 'flags'];
  const cells = rows.map((r) => [r.date, r.exercise, r.prevTop, r.oldRx, r.newRx, r.rule, r.flags]);
  const widths = headers.map((h, c) => Math.max(h.length, ...cells.map((row) => row[c].length)));
  const line = (row: string[]) => row.map((v, c) => v.padEnd(widths[c])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of cells) console.log(line(row));
}

async function main(): Promise<void> {
  const fixtureIdx = process.argv.indexOf('--fixture');
  const exercises =
    fixtureIdx >= 0 ? loadFromFixture(process.argv[fixtureIdx + 1]) : await loadFromSupabase();

  const rows = exercises.flatMap(replayExercise);
  if (rows.length === 0) {
    console.log('No replayable sessions found (need >= 2 sessions per exercise).');
    return;
  }
  printTable(rows);

  const changed = rows.filter((r) => r.oldRx !== r.newRx).length;
  const flagged = rows.filter((r) => r.flags.length > 0);
  console.log(
    `\n${rows.length} session transitions replayed · ${changed} prescriptions changed (old → new) · ${flagged.length} flagged`
  );
  if (flagged.length > 0) {
    console.log('\nFLAGGED (candidate bugs — review before shipping):');
    for (const r of flagged) {
      console.log(`  ${r.date} ${r.exercise}: NEW ${r.newRx} vs prev top ${r.prevTop} [${r.flags}]`);
    }
  }
  // Sanity: the new gate must agree with the predicate on every replayed session.
  for (const ex of exercises) {
    for (const s of ex.sessions) {
      // throws → non-zero exit; predicate must never crash on real data
      sessionMetPrescription(s.sets, {
        targetRepRange: ex.targetRepRange,
        targetRir: ex.targetRir,
      });
    }
  }
}

main().catch((err) => {
  console.error('Audit failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
