/**
 * e1RM / Prescription observed-values dump (READ-ONLY — SELECT queries only).
 *
 * Companion to docs/E1RM_PRESCRIPTION_AUDIT_FINDINGS.md. For ONE exercise it
 * prints, using the app's OWN pure functions (so every number is what the app
 * computes, not a re-derivation):
 *
 *   1. Every stored set of the last N completed non-deload sessions: raw
 *      weight_kg / reps / rpe / set_type / feedback.repsInTank / is_warmup.
 *   2. Per-set historySetE1RM (the anchor formula), its recency-decay weight,
 *      the decayed value, and which row wins decayedE1RMMax — i.e. the exact
 *      set behind the card's "Estimated 1RM".
 *   3. Each session's stored block targets (target_rep_range, target_rir) —
 *      answers whether the RIR target changed between sessions.
 *   4. The session-start seed replay: recommendSeedForSlot inputs, the raw
 *      pre-clamp curve pick, the ±clamp band, the bump-gate verdict
 *      (sessionMetPrescription), and the post-gate / post-rounding load.
 *   5. The rep-seed replay: lastSessionE1RM and prescribe() at the seeded
 *      weight — the exact source of the set-1 default rep count.
 *   6. Badge inputs: per-session best e1RM via the badge's formula
 *      (strengthCalculations via plateauDetector) and the fitted weekly slope
 *      vs the "ahead" threshold.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   AUDIT_USER_ID=<uuid> AUDIT_EXERCISE_NAME="Seated Calf Raise" \
 *     npx -y tsx scripts/auditE1rmPrescriptionDump.ts
 *
 * Optional: AUDIT_SESSIONS=5 (default 5), AUDIT_TARGET_RIR_OVERRIDE=<n> to
 * replay the seed with the calibration-adjusted RIR the card showed.
 *
 * This script NEVER writes: no insert/update/upsert/delete anywhere.
 */

import { createClient } from '@supabase/supabase-js';
import {
  historySetE1RM,
  bestQualifyingE1RM,
  type AnchorCandidate,
} from '../services/suggestionEngine/e1rmAnchor';
import {
  ANCHOR_QUALIFYING_SESSIONS,
  ANCHOR_MAX_AGE_DAYS,
  HISTORY_SESSIONS_PER_EXERCISE,
  WORKING_WEIGHT_CLAMP_FRACTION,
} from '../services/suggestionEngine/constants';

// Frozen pre-Phase-2 decay constant, for the legacy comparison only.
const LEGACY_E1RM_RECENCY_TAU_DAYS = 45;
import {
  recommendSeedForSlot,
  sessionMetPrescription,
  prescribe,
  type PrevSessionSet,
} from '../services/setRecommender';
import { calculateE1RM as badgeE1RM } from '../services/plateauDetector';
import { getExerciseProgression } from '../services/progressionInsights';
import { rpeToRir } from '../types/schema';
import { roundToIncrement } from '../lib/utils';
import type { ExercisePerformanceSnapshot } from '../types/schema';
import {
  RPECalibrationEngine,
  computeFatigueAdjustedPrediction,
  type CalibrationSetLog,
} from '../services/rpeCalibration';
import { getFailureSafetyTier } from '../services/exerciseSafety';

const KG_TO_LB = 2.20462262;
const lb = (kg: number) => `${(kg * KG_TO_LB).toFixed(1)} lb`;
const kgLb = (kg: number) => `${kg.toFixed(2)} kg (${lb(kg)})`;

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
  target_rep_range: [number, number] | number[] | null;
  target_rir: number | null;
  target_weight_kg: number | null;
  workout_sessions: {
    id: string;
    completed_at: string | null;
    state: string;
    is_deload: boolean | null;
  } | null;
  set_logs: SetRow[] | null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.AUDIT_USER_ID;
  const exerciseName = process.env.AUDIT_EXERCISE_NAME;
  const sessionsToShow = Number(process.env.AUDIT_SESSIONS ?? 5);

  if (!url || !key || !userId || !exerciseName) {
    console.error(
      'Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUDIT_USER_ID, AUDIT_EXERCISE_NAME'
    );
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // ---- Resolve the exercise (name, id, increment, defaults) ----
  const { data: exercises, error: exErr } = await supabase
    .from('exercises')
    .select('id, name, min_weight_increment_kg, default_rep_range, default_rir, exercise_type')
    .ilike('name', exerciseName)
    .limit(5);
  if (exErr) throw exErr;
  if (!exercises || exercises.length === 0) {
    console.error(`No exercise matching "${exerciseName}"`);
    process.exit(1);
  }
  const exercise = exercises[0];
  console.log('='.repeat(78));
  console.log(`EXERCISE  ${exercise.name}  (${exercise.id})`);
  console.log(
    `  min_weight_increment_kg=${exercise.min_weight_increment_kg}  ` +
      `default_rep_range=${JSON.stringify(exercise.default_rep_range)}  default_rir=${exercise.default_rir}`
  );

  // ---- History read: mirrors fetchExerciseHistory (suggestions.ts) ----
  const { data, error } = await supabase
    .from('exercise_blocks')
    .select(
      `id, exercise_id, target_rep_range, target_rir, target_weight_kg,
       workout_sessions!inner ( id, completed_at, state, is_deload ),
       set_logs ( weight_kg, reps, rpe, is_warmup, set_number, set_type, logged_at, feedback )`
    )
    .eq('exercise_id', exercise.id)
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed')
    .order('workout_sessions(completed_at)', { ascending: false })
    .limit(HISTORY_SESSIONS_PER_EXERCISE);
  if (error) throw error;

  const blocks = (data ?? []) as unknown as BlockRow[];
  const nonDeload = blocks.filter((b) => !b.workout_sessions?.is_deload);
  console.log(
    `\nHISTORY WINDOW  ${blocks.length} block(s) fetched (limit ${HISTORY_SESSIONS_PER_EXERCISE}); ` +
      `${blocks.length - nonDeload.length} deload block(s) excluded (as the app does)`
  );

  // ---- 1+2. Raw sets + anchor candidates ----
  const anchorEntries: (AnchorCandidate & {
    label: string;
    raw: number;
    setType: string;
  })[] = [];
  let newestMs = -Infinity;

  for (const block of nonDeload) {
    const t = Date.parse(block.workout_sessions?.completed_at ?? '');
    if (Number.isFinite(t) && t > newestMs) newestMs = t;
  }

  nonDeload.slice(0, sessionsToShow).forEach((block, i) => {
    const sess = block.workout_sessions;
    console.log('-'.repeat(78));
    console.log(
      `SESSION ${i === 0 ? '(last)' : `-${i}`}  ${sess?.completed_at ?? '?'}  session_id=${sess?.id}`
    );
    console.log(
      `  BLOCK TARGETS  rep_range=${JSON.stringify(block.target_rep_range)}  ` +
        `target_rir=${block.target_rir}  target_weight_kg=${block.target_weight_kg}`
    );
    const sets = [...(block.set_logs ?? [])].sort(
      (a, b) => (a.set_number ?? 0) - (b.set_number ?? 0)
    );
    for (const s of sets) {
      const inAnchorPool = !s.is_warmup; // suggestions.ts:295 — ALL non-warmup sets
      const est = inAnchorPool ? historySetE1RM(s.weight_kg, s.reps, s.rpe ?? 10) : null;
      console.log(
        `  set#${s.set_number ?? '?'}  ${kgLb(s.weight_kg)} × ${s.reps}  rpe=${s.rpe}  ` +
          `repsInTank=${s.feedback?.repsInTank ?? '—'}  type=${s.set_type ?? 'normal'}  ` +
          `warmup=${s.is_warmup}` +
          (inAnchorPool
            ? est
              ? `  → historySetE1RM=${kgLb(est.value)} (${est.confidence})`
              : '  → NO ESTIMATE (beyond canonical domain) — excluded from anchor pool'
            : '  → excluded (warmup)')
      );
    }
  });

  // Full anchor pool over the whole window (what the card actually aggregates)
  for (const block of nonDeload) {
    const sess = block.workout_sessions;
    for (const s of block.set_logs ?? []) {
      if (s.is_warmup) continue;
      if ((s.set_type ?? 'normal') !== 'normal') continue; // Phase 2: pool = normal sets only
      const est2 = historySetE1RM(s.weight_kg, s.reps, s.rpe ?? 10);
      if (!est2) continue; // canonical: no estimate -> never an anchor candidate
      const raw = est2.value;
      anchorEntries.push({
        e1rmKg: raw,
        sessionId: sess?.id ?? block.id,
        raw,
        timeMs: Date.parse(sess?.completed_at || s.logged_at),
        setType: s.set_type ?? 'normal',
        label: `${sess?.completed_at?.slice(0, 10)} ${s.weight_kg}kg×${s.reps}@${s.rpe} [${s.set_type ?? 'normal'}]`,
      });
    }
  }

  console.log('='.repeat(78));
  console.log(
    `ANCHOR AGGREGATION (best qualifying set, newest ${ANCHOR_QUALIFYING_SESSIONS} sessions ` +
      `within ${ANCHOR_MAX_AGE_DAYS}d of newest)`
  );
  const ranked = anchorEntries
    .map((e) => ({ ...e, ageDays: Math.max(0, (newestMs - e.timeMs) / 86400000) }))
    .sort((a, b) => b.raw - a.raw);
  ranked.slice(0, 8).forEach((e, i) => {
    console.log(
      `  ${i === 0 ? 'TOP   ' : `   #${i + 1}`}  ${e.label}  e1RM=${kgLb(e.raw)}  ` +
        `age=${e.ageDays.toFixed(1)}d vs newest  session=${e.sessionId}`
    );
  });
  const anchor = bestQualifyingE1RM(anchorEntries);
  console.log(`  → estimatedE1RM (card display + weight-pick anchor) = ${kgLb(anchor)}`);

  // ---- 4. Seed replay ----
  const lastBlock = nonDeload.find((b) =>
    (b.set_logs ?? []).some((s) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal')
  );
  if (!lastBlock) {
    console.log('No last session with normal working sets — seed replay skipped.');
    return;
  }
  const workingOf = (b: BlockRow) =>
    (b.set_logs ?? [])
      .filter((s) => !s.is_warmup && (s.set_type ?? 'normal') === 'normal')
      .sort((a, b2) => (a.set_number ?? 0) - (b2.set_number ?? 0));
  const lastSets = workingOf(lastBlock);
  const priorBlock = nonDeload.find(
    (b) =>
      b.workout_sessions &&
      b.workout_sessions.id !== lastBlock.workout_sessions?.id &&
      workingOf(b).length > 0
  );
  const toPrev = (s: SetRow): PrevSessionSet => ({
    weightKg: s.weight_kg,
    reps: s.reps,
    rir: s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : undefined,
  });
  const prevSessionSets = lastSets.map(toPrev);
  const priorSessionSets = priorBlock ? workingOf(priorBlock).map(toPrev) : undefined;

  const repRange = (lastBlock.target_rep_range ?? exercise.default_rep_range ?? [8, 12]) as [
    number,
    number,
  ];
  const storedRir = lastBlock.target_rir ?? exercise.default_rir ?? 2;
  const targetRir = Number(process.env.AUDIT_TARGET_RIR_OVERRIDE ?? storedRir);
  const inc = exercise.min_weight_increment_kg > 0 ? exercise.min_weight_increment_kg : 2.5;
  const recentWorking = prevSessionSets.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0);

  console.log('='.repeat(78));
  console.log('SEED REPLAY (recommendSeedForSlot — working slot 0)');
  console.log(
    `  inputs: anchorE1RM=${kgLb(anchor)}  repRange=[${repRange}]  targetRir=${targetRir}` +
      (targetRir !== storedRir ? ` (override; stored=${storedRir})` : ' (stored block value)') +
      `  inc=${inc}kg  recentWorkingWeight=${kgLb(recentWorking)}`
  );

  const mid = Math.round((repRange[0] + repRange[1]) / 2);
  const rawPick = anchor / (1 + (mid + Math.max(0, targetRir)) / 30);
  const lo = recentWorking * (1 - WORKING_WEIGHT_CLAMP_FRACTION);
  const hi = recentWorking * (1 + WORKING_WEIGHT_CLAMP_FRACTION);
  const met = sessionMetPrescription(prevSessionSets, {
    targetRepRange: repRange,
    targetRir,
    minIncrementKg: inc,
  });
  console.log(`  raw curve pick (mid=${mid} reps @ ${targetRir} RIR): ${kgLb(rawPick)}   ← PRE-CLAMP`);
  console.log(`  ±${WORKING_WEIGHT_CLAMP_FRACTION * 100}% band: [${kgLb(lo)} .. ${kgLb(hi)}]  bandBinds=${rawPick < lo || rawPick > hi}`);
  console.log(`  bump gate: sessionMetPrescription=${met}  gateBinds=${!met && rawPick > recentWorking}`);
  console.log(
    `  post-gate value=${kgLb(!met && rawPick > recentWorking ? recentWorking : Math.min(Math.max(rawPick, lo), hi))}` +
      `  → roundToIncrement(…, ${inc}) = ${kgLb(
        roundToIncrement(!met && rawPick > recentWorking ? recentWorking : Math.min(Math.max(rawPick, lo), hi), inc)
      )}`
  );

  const seed = recommendSeedForSlot({
    role: 'working',
    targetRepRange: repRange,
    targetRir,
    minIncrementKg: inc,
    anchorE1RMKg: anchor,
    recentWorkingWeightKg: recentWorking || undefined,
    prevWeightKg: lastSets[0]?.weight_kg,
    prevReps: lastSets[0]?.reps,
    prevRir: lastSets[0]?.rpe != null ? rpeToRir(lastSets[0].rpe) : undefined,
    prevSessionSets,
    priorSessionSets,
  });
  console.log(
    `  recommendSeedForSlot → weight=${kgLb(seed.weightKg)}  clamped=${seed.clamped}  ` +
      `anchorSource=${seed.anchorSource}  (engine v${seed.engineVersion})`
  );

  // ---- 5. Rep-seed replay (the set-1 default rep count) ----
  let lastSessionE1RM = 0;
  for (const s of lastSets) {
    if (s.weight_kg > 0 && s.reps > 0) {
      const rir = s.rpe != null ? Math.max(0, rpeToRir(s.rpe)) : Math.max(0, targetRir);
      const e = s.weight_kg * (1 + (s.reps + rir) / 30);
      if (e > lastSessionE1RM) lastSessionE1RM = e;
    }
  }
  const p = prescribe({
    e1RMKg: lastSessionE1RM,
    targetRir,
    repRange,
    weightKg: seed.weightKg,
  });
  console.log('REP SEED (seedRepsForWeight ladder — NOT the stored anchor)');
  console.log(
    `  lastSessionE1RM (Epley + rpeToRir over last session) = ${kgLb(lastSessionE1RM)}\n` +
      `  prescribe(e1RM=${lastSessionE1RM.toFixed(2)}kg, w=${seed.weightKg}kg, rir=${targetRir}) → reps=${p?.reps}` +
      `   ← set-1 default rep count`
  );
  console.log(
    `  cross-check vs anchor: same weight on the ${kgLb(anchor)} anchor → reps=${
      prescribe({ e1RMKg: anchor, targetRir, repRange, weightKg: seed.weightKg })?.reps
    }  (two anchors, one prescription line)`
  );

  // ---- 6. Badge inputs ----
  console.log('='.repeat(78));
  console.log('BADGE INPUTS (progressionInsights on strengthCalculations e1RMs)');
  const snapshots: ExercisePerformanceSnapshot[] = [];
  for (const block of nonDeload) {
    const sess = block.workout_sessions;
    if (!sess?.completed_at) continue;
    const working = (block.set_logs ?? []).filter(
      (s) => !s.is_warmup && s.weight_kg > 0 && s.reps > 0
    );
    if (working.length === 0) continue;
    let top = working[0];
    let best = 0;
    for (const s of working) {
      const e = badgeE1RM(s.weight_kg, s.reps, s.rpe ?? 10);
      if (e > best) {
        best = e;
        top = s;
      }
    }
    snapshots.push({
      id: block.id,
      userId,
      exerciseId: exercise.id,
      sessionDate: sess.completed_at,
      topSetWeightKg: top.weight_kg,
      topSetReps: top.reps,
      topSetRpe: top.rpe ?? 0,
      totalWorkingSets: working.length,
      estimatedE1RM: best,
    });
  }
  snapshots
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
    .forEach((s) =>
      console.log(
        `  ${s.sessionDate.slice(0, 10)}  bestE1RM(badge formula)=${kgLb(s.estimatedE1RM)}  ` +
          `top=${s.topSetWeightKg}kg×${s.topSetReps}@${s.topSetRpe}`
      )
    );
  for (const experience of ['novice', 'intermediate', 'advanced'] as const) {
    const insight = getExerciseProgression({
      exerciseId: exercise.id,
      snapshots,
      experience,
    });
    console.log(
      `  pace[${experience}]=${insight.pace}  weeklyChange=${insight.weeklyChangePct}%/wk ` +
        `(expected ${insight.expectedWeeklyPct}%/wk)`
    );
  }
  // ============================================================
  // CALIBRATION REPLAY (mirrors page.tsx:1445-1537 exactly)
  // ============================================================
  console.log('='.repeat(78));
  console.log('CALIBRATION REPLAY (28-day window, page.tsx ingestion rules)');

  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const { data: calRows, error: calErr } = await supabase
    .from('set_logs')
    .select(
      `id, weight_kg, reps, rpe, set_type, logged_at,
       exercise_blocks!inner (
         exercise_id, target_rep_range, target_rir,
         exercises!inner ( id, name ),
         workout_sessions!inner ( user_id, completed_at, state )
       )`
    )
    .eq('exercise_blocks.workout_sessions.user_id', userId)
    .eq('exercise_blocks.workout_sessions.state', 'completed')
    .gte('logged_at', fourWeeksAgo.toISOString())
    .eq('set_type', 'normal')
    .order('logged_at', { ascending: true });
  if (calErr) throw calErr;

  interface ReplayLog extends CalibrationSetLog {
    rpe: number;
    blockTargetRir: number;
  }
  const replayLogs: ReplayLog[] = [];
  for (const row of (calRows ?? []) as any[]) {
    const block = row.exercise_blocks;
    const ex = block?.exercises;
    if (!ex || !block) continue;
    // EXACT page conversions (page.tsx:1499-1500) — including the
    // Math.round(10 - rpe) that turns RPE 7.5 into RIR 3 (not rpeToRir's 2),
    // and the rpe>=9.5 && push_freely AMRAP inference.
    replayLogs.push({
      exerciseId: ex.id,
      exerciseName: ex.name,
      weight: row.weight_kg,
      prescribedReps: {
        min: block.target_rep_range?.[0] || 0,
        max: block.target_rep_range?.[1] || null,
      },
      actualReps: row.reps,
      reportedRIR: Math.max(0, Math.round(10 - row.rpe)),
      wasAMRAP: row.rpe >= 9.5 && getFailureSafetyTier(ex.name) === 'push_freely',
      timestamp: new Date(row.logged_at),
      rpe: row.rpe,
      blockTargetRir: block.target_rir ?? 2,
    });
  }
  replayLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Match page.tsx:1442,1519 — enhanced athlete mode changes the engine's
  // fatigue decay and sandbagging thresholds.
  const { data: userRow } = await supabase
    .from('users')
    .select('enhanced_athlete_mode')
    .eq('id', userId)
    .single();
  const enhancedAthleteMode = userRow?.enhanced_athlete_mode === true;
  console.log(`  enhancedAthleteMode=${enhancedAthleteMode}`);

  const engine = new RPECalibrationEngine([], [], { enhancedAthleteMode });
  const targetKey = exercise.name.toLowerCase();
  const seen: CalibrationSetLog[] = [];
  for (const log of replayLogs) {
    const isTarget = log.exerciseName.toLowerCase() === targetKey;
    const biasBefore = engine.getCalibrationResult(log.exerciseName)?.bias ?? null;

    if (isTarget || log.wasAMRAP) {
      const rawE1 = historySetE1RM(log.weight, log.actualReps, log.rpe)?.value ?? 0;
      if (isTarget) {
        console.log(
          `  ${log.timestamp.toISOString()}  ${kgLb(log.weight)} × ${log.actualReps}  rpe=${log.rpe}  ` +
            `reportedRIR(page)=${log.reportedRIR} (rpeToRir would say ${rpeToRir(log.rpe)})  ` +
            `rawE1RM=${kgLb(rawE1)}  inferredAMRAP=${log.wasAMRAP}`
        );
      }
      if (log.wasAMRAP) {
        // Show the comparison pool the engine will use, BEFORE feeding it.
        const pool = seen.filter(
          (s) =>
            s.exerciseName.toLowerCase() === log.exerciseName.toLowerCase() &&
            !s.wasAMRAP &&
            Math.abs(s.weight - log.weight) / Math.max(1, log.weight) < 0.1 &&
            s.timestamp < log.timestamp &&
            log.timestamp.getTime() - s.timestamp.getTime() < 28 * 86400000
        );
        const sameEx = seen.filter(
          (s) =>
            s.exerciseName.toLowerCase() === log.exerciseName.toLowerCase() &&
            s.timestamp <= log.timestamp
        );
        if (pool.length > 0) {
          const pred = computeFatigueAdjustedPrediction(log, pool, sameEx, enhancedAthleteMode);
          console.log(
            `    ⚡ AMRAP EVENT [${log.exerciseName}]: actual=${log.actualReps} reps  ` +
              `pool=${pool.length} set(s)  rawPredicted=${pred.rawPredictedMaxReps.toFixed(1)}  ` +
              `fatigueAdjusted=${pred.fatigueAdjustedMaxReps.toFixed(1)}`
          );
          for (const p of pool) {
            console.log(
              `       pool: ${p.timestamp.toISOString().slice(0, 10)}  ${p.weight}kg × ${p.actualReps} ` +
                `+ RIR ${p.reportedRIR} ⇒ implied max ${p.actualReps + p.reportedRIR}`
            );
          }
        } else {
          console.log(
            `    ⚡ AMRAP EVENT [${log.exerciseName}]: actual=${log.actualReps} — ` +
              `NO comparison pool (±10% weight) → bias RESETS to 0 ("first calibration")`
          );
        }
      }
    }

    engine.addSetLog(log);
    seen.push(log);

    const biasAfter = engine.getCalibrationResult(log.exerciseName)?.bias ?? null;
    if (log.wasAMRAP && (isTarget || biasBefore !== biasAfter)) {
      console.log(
        `    → bias[${log.exerciseName}]: ${biasBefore ?? '—'} → ${biasAfter ?? '—'}  ` +
          `(Δ ${biasBefore != null && biasAfter != null ? (biasAfter - biasBefore).toFixed(1) : 'n/a'})`
      );
    }
  }

  const finalCal = engine.getCalibrationResult(exercise.name);
  const blockRirForAdjust =
    replayLogs.filter((l) => l.exerciseName.toLowerCase() === targetKey).slice(-1)[0]
      ?.blockTargetRir ?? (exercise.default_rir ?? 2);
  const adjusted = engine.getAdjustedRIR(exercise.name, blockRirForAdjust);
  const effectiveRir = Math.max(0, Math.min(4, adjusted.prescribedRIR));
  console.log('-'.repeat(78));
  console.log(
    `  FINAL [${exercise.name}]: bias=${finalCal?.bias ?? '—'}  ` +
      `confidence=${finalCal?.confidenceLevel ?? '—'}  dataPoints=${finalCal?.dataPoints ?? '—'}  ` +
      `method=${finalCal?.method ?? '—'}  lastCalibrated=${finalCal?.lastCalibrated?.toISOString() ?? '—'}`
  );
  console.log(
    `  getAdjustedRIR(target ${blockRirForAdjust}) → prescribedRIR=${adjusted.prescribedRIR} ` +
      `(hasAdjustment=${adjusted.hasAdjustment}) → ExerciseCard clamp [0,4] → effectiveTargetRir=${effectiveRir} ` +
      `→ banner display clamp [0,3] → shown "@ ${Math.max(0, Math.min(3, effectiveRir))} RIR"`
  );
  if (adjusted.adjustmentReason) console.log(`  reason copy: "${adjusted.adjustmentReason}"`);

  // Audit trail cross-reference (in-session AMRAP events only; replay-inferred
  // events write no rows here).
  const { data: auditRows } = await supabase
    .from('amrap_calibrations')
    .select('calibrated_at, weight_kg, predicted_max_reps, actual_max_reps, bias, confidence_level, data_points, method, set_log_id')
    .eq('user_id', userId)
    .eq('exercise_id', exercise.id)
    .order('calibrated_at', { ascending: true });
  console.log(`  amrap_calibrations audit rows: ${auditRows?.length ?? 0}`);
  for (const r of auditRows ?? []) {
    console.log(
      `    ${r.calibrated_at}  ${r.weight_kg}kg  predicted=${r.predicted_max_reps}  ` +
        `actual=${r.actual_max_reps}  bias=${r.bias}  conf=${r.confidence_level}  ` +
        `n=${r.data_points}  method=${r.method}  set_log_id=${r.set_log_id}`
    );
  }

  // ============================================================
  // ALL-EXERCISE BIAS DISTRIBUTION (same replayed engine)
  // ============================================================
  console.log('='.repeat(78));
  console.log('ALL-EXERCISE BIAS DISTRIBUTION (28-day replay, current code rules)');
  const names = Array.from(new Set(replayLogs.map((l) => l.exerciseName)));
  const dist: { name: string; bias: number; conf: string; n: number; adj: number }[] = [];
  for (const name of names) {
    const cal = engine.getCalibrationResult(name);
    if (!cal) continue;
    const targetRirForName =
      replayLogs.filter((l) => l.exerciseName === name).slice(-1)[0]?.blockTargetRir ?? 2;
    const a = engine.getAdjustedRIR(name, targetRirForName);
    dist.push({
      name,
      bias: cal.bias,
      conf: cal.confidenceLevel,
      n: cal.dataPoints,
      adj: a.hasAdjustment ? a.prescribedRIR - targetRirForName : 0,
    });
  }
  dist.sort((a, b) => a.bias - b.bias);
  for (const d of dist) {
    console.log(
      `  bias=${String(d.bias).padStart(6)}  applied Δtarget=${String(d.adj).padStart(3)}  ` +
        `conf=${d.conf.padEnd(6)}  n=${String(d.n).padStart(2)}  ${d.name}`
    );
  }
  const exercisesWithoutCal = names.length - dist.length;
  const drifting = dist.filter((d) => Math.abs(d.bias) > 2).length;
  console.log(
    `  ${dist.length} calibrated exercise(s), ${exercisesWithoutCal} with sets but no AMRAP event, ` +
      `${drifting} with |bias| > 2 (drift candidates)`
  );

  // ============================================================
  // PHASE 1 IMPACT — old vs new e1RM anchor for EVERY exercise
  // ============================================================
  console.log('='.repeat(78));
  console.log('PHASE 1 IMPACT (old formula vs canonical, per exercise, decayed-max anchor)');

  // Frozen copy of the pre-Phase-1 anchor formula (Brzycki ≤12 eff reps,
  // linear Epley above, raw 10−rpe conversion, no upper bound) — for the
  // before/after comparison only. Do not use anywhere else.
  const legacyHistorySetE1RM = (w: number, reps: number, rpe: number = 10): number => {
    if (reps === 1 && rpe === 10) return w;
    const eff = rpe ? reps + (10 - rpe) : reps;
    if (eff > 12) return w * (1 + eff / 30);
    return w * (36 / (37 - eff));
  };
  // Frozen pre-Phase-2 aggregation (recency-decayed max) for the OLD side.
  const legacyDecayedMax = (entries: { e1rmKg: number; timeMs: number }[]): number => {
    let newest = -Infinity;
    for (const e of entries) {
      if (e.e1rmKg > 0 && Number.isFinite(e.timeMs) && e.timeMs > newest) newest = e.timeMs;
    }
    let best = 0;
    for (const e of entries) {
      if (!(e.e1rmKg > 0)) continue;
      const age =
        Number.isFinite(e.timeMs) && Number.isFinite(newest)
          ? Math.max(0, (newest - e.timeMs) / 86400000)
          : 0;
      const d = e.e1rmKg * Math.exp(-age / LEGACY_E1RM_RECENCY_TAU_DAYS);
      if (d > best) best = d;
    }
    return best;
  };

  const { data: exListRows, error: exListErr } = await supabase
    .from('exercise_blocks')
    .select('exercise_id, exercises!inner(name), workout_sessions!inner(user_id, state)')
    .eq('workout_sessions.user_id', userId)
    .eq('workout_sessions.state', 'completed');
  if (exListErr) throw exListErr;
  const exerciseIds = new Map<string, string>();
  for (const r of (exListRows ?? []) as any[]) {
    const nm = Array.isArray(r.exercises) ? r.exercises[0]?.name : r.exercises?.name;
    if (r.exercise_id && nm) exerciseIds.set(r.exercise_id, nm);
  }

  const impact: { name: string; oldKg: number; newKg: number }[] = [];
  for (const [exId, exName] of Array.from(exerciseIds.entries())) {
    const { data: hist } = await supabase
      .from('exercise_blocks')
      .select(
        `exercise_id, workout_sessions!inner ( id, completed_at, state, is_deload ),
         set_logs ( weight_kg, reps, rpe, is_warmup, logged_at )`
      )
      .eq('exercise_id', exId)
      .eq('workout_sessions.user_id', userId)
      .eq('workout_sessions.state', 'completed')
      .order('workout_sessions(completed_at)', { ascending: false })
      .limit(HISTORY_SESSIONS_PER_EXERCISE);

    const oldEntries: { e1rmKg: number; timeMs: number }[] = [];
    const newEntries: AnchorCandidate[] = [];
    for (const b of (hist ?? []) as any[]) {
      const sess = b.workout_sessions;
      if (!sess || sess.is_deload) continue;
      for (const s of b.set_logs ?? []) {
        if (s.is_warmup || !(s.weight_kg > 0) || !(s.reps > 0)) continue;
        const t = Date.parse(sess.completed_at || s.logged_at);
        // OLD pool: every non-warmup set (incl. dropsets), legacy formula+decay.
        oldEntries.push({ e1rmKg: legacyHistorySetE1RM(s.weight_kg, s.reps, s.rpe ?? 10), timeMs: t });
        // NEW pool: normal sets only, canonical estimate, session window.
        if ((s.set_type ?? 'normal') !== 'normal') continue;
        const est = historySetE1RM(s.weight_kg, s.reps, s.rpe ?? 10);
        if (est) newEntries.push({ e1rmKg: est.value, sessionId: sess.id, timeMs: t });
      }
    }
    if (oldEntries.length === 0) continue;
    impact.push({
      name: exName,
      oldKg: legacyDecayedMax(oldEntries),
      newKg: bestQualifyingE1RM(newEntries), // 0 = no estimate under canonical rules
    });
  }
  impact.sort((a, b) => (b.oldKg - b.newKg) - (a.oldKg - a.newKg));
  for (const row of impact) {
    const deltaPct = row.oldKg > 0 ? (((row.newKg - row.oldKg) / row.oldKg) * 100).toFixed(1) : '—';
    console.log(
      `  old=${kgLb(row.oldKg).padEnd(22)} new=${
        row.newKg > 0 ? kgLb(row.newKg).padEnd(22) : 'NO ESTIMATE'.padEnd(22)
      } Δ=${String(deltaPct).padStart(6)}%  ${row.name}`
    );
  }
  const dropped = impact.filter((r) => r.newKg === 0).length;
  const changed = impact.filter((r) => Math.abs(r.newKg - r.oldKg) > 0.05).length;
  console.log(
    `  ${impact.length} exercise(s) with history: ${changed} value changes, ` +
      `${dropped} now report NO estimate (only out-of-domain sets in the window)`
  );

  console.log('='.repeat(78));
  console.log('DONE (no writes performed).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
