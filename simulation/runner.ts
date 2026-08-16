/**
 * Runner — one persona, one seed, N simulated sessions, checked throughout.
 *
 * This is where the pieces meet: the driver executes production code, the
 * persona decides what the human does, and the assertions watch. It owns no
 * training logic of its own.
 *
 * ASSERTION POINTS, and why they are where they are:
 *   after every prescription   a target must be usable before anyone acts on it
 *   after every set write      the primitive accounting must still hold
 *   after every edit/delete    same, plus the deletion really removed the row
 *   at session completion      the session's final state must be coherent
 *
 * Checking after EVERY state-changing operation rather than at the end is the
 * point: a corruption caught 40 sessions later is nearly impossible to
 * attribute, and the whole value of a deterministic harness is that the
 * failure names the operation that caused it.
 *
 * EXCEPTIONS. Anything thrown by production code aborts the run and is recorded
 * as an INVARIANT finding with the full context. Swallowing an engine exception
 * would let a run go green while the app was throwing on every set.
 */
import { SessionDriver } from './sessionDriver';
import { Rng } from './rng';
import {
  beginSession,
  createPersonaState,
  rirToReportedRpe,
  type PersonaState,
  type PrescribedSet,
} from './persona';
import { createPersona, type PersonaName } from './personas';
import {
  checkDeletionIsHard,
  checkEmptyPeriodSurvived,
  checkNumericSanity,
  checkPrescriptionSanity,
  checkSessionCompleted,
  checkSet3Contract,
  checkSetAccounting,
  checkStateIntegrity,
  guardLoadJump,
  guardOscillation,
  guardProgressionAfterLayoff,
  guardRatchetOnFlatPerformance,
  isHardFailure,
  type AssertionContext,
  type Finding,
  type SetAttempt,
} from './assertions';
import type { FakeSupabase } from './fakeSupabase';
import { SIM_MESOCYCLE_ID } from './fixtures';
import type { SetRecommendation } from '@/services/setRecommender';

export interface RunOptions {
  persona: PersonaName;
  seed: string | number;
  fake: FakeSupabase;
  userId: string;
  /** Session id to drive. Phase 1's fake does not yet cover session START. */
  sessionId: string;
  startAt: string;
  /** How many simulated sessions to run. */
  sessions: number;
  /** Calendar days between scheduled sessions. */
  daysBetweenSessions?: number;
  /** Stop at the first hard failure (default) or keep going and collect. */
  stopOnFailure?: boolean;
}

/** One trace row per logged set — the record a failure is diagnosed from. */
export interface TraceEvent {
  simulatedAt: string;
  simulatedDay: string;
  sessionIndex: number;
  sessionId: string;
  exerciseId: string;
  blockIndex: number;
  setNumber: number;
  prescribedLoadKg: number;
  prescribedReps: number;
  targetRir: number;
  repsAchieved: number;
  /** Simulator ground truth — never seen by the engine. */
  actualRIR: number;
  reportedRIR: number;
  /** Simulator ground truth. */
  trueE1RM: number;
  personaFatigue: number;
  disposition: string;
  setId: string | null;
}

export interface RunResult {
  persona: PersonaName;
  seed: string | number;
  findings: Finding[];
  trace: TraceEvent[];
  sessionsCompleted: number;
  /** Thrown by production code, if anything was. */
  crash?: { message: string; stack?: string; context: AssertionContext };
}

export function hardFailures(result: RunResult): Finding[] {
  return result.findings.filter(isHardFailure);
}

export function guardrailWarnings(result: RunResult): Finding[] {
  return result.findings.filter((f) => f.severity === 'GUARDRAIL');
}

/** The shell of one session's exercise block, carried forward between cycles. */
interface BlockSpec {
  exerciseId: string;
  targetSets: number;
  targetRepRange: [number, number];
  targetRir: number;
  targetWeightKg: number;
  targetRestSeconds: number;
}

/**
 * Insert the next session's shell: a `workout_sessions` row and its blocks.
 *
 * BOOTSTRAP ONLY, and the distinction matters. What is seeded here is the
 * structure `startMesocycleWorkoutSession` would normally build — the fake
 * client does not yet cover that function's full query surface (Phase 1 scope
 * note). What is NOT seeded is any prescription: the stored `target_weight_kg`
 * is carried forward UNCHANGED from the previous session, so it can only ever
 * act as a cold-start fallback. Every actual target still comes from the engine
 * via `getPrescription`, fed the previous session's logged sets.
 *
 * If the harness ever picked the next session's load itself, it would be
 * prescribing — and the run would be measuring the harness.
 */
function seedSessionShell(
  fake: FakeSupabase,
  userId: string,
  index: number,
  day: string,
  startedAt: string,
  specs: BlockSpec[]
): string {
  const sessionId = `sim-session-${String(index).padStart(4, '0')}`;
  fake.db.seed('workout_sessions', [
    {
      id: sessionId,
      user_id: userId,
      // Same mesocycle as the bootstrap session — see fixtures: an unlinked
      // session skips the mesocycle post-processing entirely.
      mesocycle_id: SIM_MESOCYCLE_ID,
      state: 'in_progress',
      planned_date: day,
      started_at: startedAt,
      completed_at: null,
      completion_percent: 0,
      location_id: null,
      is_deload: false,
    },
  ]);
  fake.db.seed(
    'exercise_blocks',
    specs.map((spec, i) => ({
      id: `${sessionId}-blk-${i + 1}`,
      workout_session_id: sessionId,
      exercise_id: spec.exerciseId,
      order: i + 1,
      target_sets: spec.targetSets,
      target_rep_range: spec.targetRepRange,
      target_rir: spec.targetRir,
      target_weight_kg: spec.targetWeightKg,
      target_rest_seconds: spec.targetRestSeconds,
      warmup_protocol: { sets: [] },
      skipped_at: null,
    }))
  );
  return sessionId;
}

/**
 * Run one persona against one database for `sessions` simulated sessions.
 *
 * Each cycle gets its OWN session (see `seedSessionShell`), and the previous
 * session's logged sets are fed forward into the prescription — so the
 * session-to-session path, not just the within-session one, is exercised.
 */
export async function runSimulation(options: RunOptions): Promise<RunResult> {
  const {
    persona: personaName,
    seed,
    fake,
    userId,
    sessionId,
    startAt,
    sessions,
    daysBetweenSessions = 2,
    stopOnFailure = true,
  } = options;

  const persona = createPersona(personaName);
  const rng = new Rng(`${personaName}:${seed}`);
  const driver = new SessionDriver({ supabase: fake.client, userId, startAt });
  driver.adoptSession(sessionId);
  let currentSessionId = sessionId;

  const findings: Finding[] = [];
  const trace: TraceEvent[] = [];
  let sessionsCompleted = 0;

  const state: PersonaState = createPersonaState();
  /** Per-exercise history, for the guardrails that need a longer view. */
  const perExercise = new Map<
    string,
    { day: string; prescribedLoadKg: number; bestRepsAchieved: number }[]
  >();
  const recentTargets = new Map<string, { weightKg: number; reps: number }[]>();
  const lastSessionLoad = new Map<string, number>();

  const ctx = (operation: string, extra: Partial<AssertionContext> = {}): AssertionContext => ({
    persona: personaName,
    seed,
    simulatedAt: driver.clock.now().toISOString(),
    simulatedDay: driver.clock.today(),
    operation,
    sessionId: currentSessionId,
    ...extra,
  });

  const record = (produced: Finding[]): boolean => {
    findings.push(...produced);
    return stopOnFailure && produced.some(isHardFailure);
  };

  try {
    await driver.refresh();

    // Seed hidden strength from the persona for every exercise in the session.
    for (const block of driver.blocks) {
      const id = block.exerciseId;
      if (!state.trueE1RM.has(id)) state.trueE1RM.set(id, persona.initialE1RM(id));
    }

    // The session template, taken from the seeded first session and reused
    // for every subsequent cycle.
    const blockSpecs: BlockSpec[] = driver.blocks.map((b) => ({
      exerciseId: b.exerciseId,
      targetSets: b.targetSets,
      targetRepRange: b.targetRepRange,
      targetRir: b.targetRir,
      targetWeightKg: b.targetWeightKg,
      targetRestSeconds: b.targetRestSeconds,
    }));
    /** Last session's logged sets per exercise — the engine's history input. */
    const previousSets = new Map<string, { weightKg: number; reps: number; rpe?: number }[]>();

    for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex++) {
      const attending = persona.attendSession({ state, rng, today: driver.clock.today() });
      if (!attending) {
        state.daysSinceLastSession += daysBetweenSessions;
        driver.advanceDays(daysBetweenSessions);
        continue;
      }

      if (sessionIndex > 0) {
        currentSessionId = seedSessionShell(
          fake,
          userId,
          sessionIndex,
          driver.clock.today(),
          driver.clock.now().toISOString(),
          blockSpecs
        );
        driver.adoptSession(currentSessionId);
        await driver.refresh();
      }

      const gapDays = state.daysSinceLastSession;
      beginSession(persona, state, rng);

      let abandoned = false;
      for (let blockIndex = 0; blockIndex < driver.blocks.length && !abandoned; blockIndex++) {
        const block = driver.blocks[blockIndex];
        const exerciseId = block.exerciseId;
        const targetRir = block.targetRir;
        let lastAttempt: SetAttempt | null = null;

        const alreadyLogged = driver.setsForBlock(blockIndex).length;
        for (let n = alreadyLogged; n < block.targetSets; n++) {
          const historyForExercise = previousSets.get(exerciseId);
          const inputsSnapshot = {
            targetRepRange: block.targetRepRange,
            targetRir,
            plannedSetCount: block.targetSets,
            completedSets: driver.setsForBlock(blockIndex).map((s) => ({
              weightKg: s.weightKg,
              reps: s.reps,
              rpe: s.rpe,
            })),
            previousSets: historyForExercise ?? [],
            minWeightIncrementKg: block.exercise?.minWeightIncrementKg,
          };
          const rx = driver.getPrescription(blockIndex, {
            previousSets: historyForExercise,
          });
          if (record(checkEmptyPeriodSurvived(rx, ctx('getPrescription', { exerciseId })))) {
            return { persona: personaName, seed, findings, trace, sessionsCompleted };
          }
          if (!rx) break;
          if (record(checkPrescriptionSanity(rx, ctx('getPrescription', { exerciseId })))) {
            return { persona: personaName, seed, findings, trace, sessionsCompleted };
          }

          // CONTRACT: the previous set missed its target at or below target
          // RIR — this prescription must not be the same unattained pair.
          if (lastAttempt) {
            const set3 = checkSet3Contract(
              lastAttempt,
              rx,
              ctx('getNextPrescription', { exerciseId, sessionIndex }),
              // The closest thing the engine has to a reason code
              // (PrescriptionProvenance.source). The approved list is empty, so
              // this only names what was claimed — it can never excuse a repeat.
              rx.provenance?.source
            ).map((f) => ({
              ...f,
              detail: { ...f.detail, prescriptionInputs: inputsSnapshot, provenance: rx.provenance },
            }));
            if (record(set3)) {
              return { persona: personaName, seed, findings, trace, sessionsCompleted };
            }
          }

          // Guardrails: never fatal, always recorded.
          const prevLoad = lastSessionLoad.get(exerciseId);
          if (prevLoad !== undefined && n === alreadyLogged) {
            findings.push(...guardLoadJump(prevLoad, rx.weightKg, ctx('getPrescription', { exerciseId })));
            findings.push(
              ...guardProgressionAfterLayoff(
                gapDays,
                prevLoad,
                rx.weightKg,
                ctx('getPrescription', { exerciseId })
              )
            );
          }
          const targets = recentTargets.get(exerciseId) ?? [];
          targets.push({ weightKg: rx.weightKg, reps: rx.reps });
          recentTargets.set(exerciseId, targets);
          findings.push(...guardOscillation(targets, ctx('getPrescription', { exerciseId })));

          const prescribed: PrescribedSet = {
            weightKg: rx.weightKg,
            reps: rx.reps,
            rir: rx.rir,
            setNumber: n + 1,
            exerciseId,
          };
          const outcome = persona.performSet({ prescribed, state, rng });

          if (outcome.disposition === 'abandoned') {
            trace.push(traceRow(driver, state, {
              sessionIndex, sessionId, exerciseId, blockIndex, setNumber: n + 1,
              rx, targetRir, outcome, setId: null,
            }));
            abandoned = true;
            break;
          }

          const { result } = await driver.logSet(
            blockIndex,
            {
              weightKg: rx.weightKg,
              reps: outcome.repsAchieved,
              rpe: rirToReportedRpe(outcome.reportedRIR),
            },
            { restSeconds: 150, prescribedFor: rx }
          );

          trace.push(traceRow(driver, state, {
            sessionIndex, sessionId, exerciseId, blockIndex, setNumber: n + 1,
            rx, targetRir, outcome, setId: result.set.id,
          }));

          if (record(runStateChecks(driver, fake, ctx('logSet', { exerciseId, sessionIndex })))) {
            return { persona: personaName, seed, findings, trace, sessionsCompleted };
          }

          lastAttempt = { prescribed: rx, outcome, targetRir };
        }

        // Messy editor: revise the log after the fact.
        if (persona.editsSets && rng.bool(0.3)) {
          const logged = driver.setsForBlock(blockIndex);
          if (logged.length > 0) {
            const victim = rng.pick(logged);
            if (rng.bool(0.5)) {
              await driver.editSet(victim.id, {
                weightKg: victim.weightKg,
                reps: Math.max(1, victim.reps - rng.int(1, 2)),
                rpe: victim.rpe,
              });
              if (record(runStateChecks(driver, fake, ctx('editSet', { exerciseId })))) {
                return { persona: personaName, seed, findings, trace, sessionsCompleted };
              }
            } else {
              await driver.deleteSet(victim.id);
              const produced = [
                ...checkDeletionIsHard(victim.id, fake.db.rows('set_logs') as { id: string }[], ctx('deleteSet', { exerciseId })),
                ...runStateChecks(driver, fake, ctx('deleteSet', { exerciseId })),
              ];
              if (record(produced)) {
                return { persona: personaName, seed, findings, trace, sessionsCompleted };
              }
            }
          }
        }

        // Long-view guardrail input.
        const logged = driver.setsForBlock(blockIndex);
        if (logged.length > 0) {
          const history = perExercise.get(exerciseId) ?? [];
          history.push({
            day: driver.clock.today(),
            prescribedLoadKg: logged[logged.length - 1].weightKg,
            bestRepsAchieved: Math.max(...logged.map((s) => s.reps)),
          });
          perExercise.set(exerciseId, history);
          findings.push(
            ...guardRatchetOnFlatPerformance(history, ctx('sessionComplete', { exerciseId }))
          );
          lastSessionLoad.set(exerciseId, logged[logged.length - 1].weightKg);
        }
      }

      // Carry this session's sets forward as next session's history. MUST
      // happen before completing: `completeSession` closes the driver's view
      // of the session, and reading blocks afterwards throws.
      for (let i = 0; i < driver.blocks.length; i++) {
        const logged = driver.setsForBlock(i);
        if (logged.length > 0) {
          previousSets.set(
            driver.blocks[i].exerciseId,
            logged.map((s) => ({ weightKg: s.weightKg, reps: s.reps, rpe: s.rpe }))
          );
        }
      }

      // Finish through the REAL finish flow — the durable outbox write, the
      // post-finish settlement, the mesocycle updates. Without this the
      // seeded sessions stayed `in_progress` for ever and every one of those
      // paths was outside the harness's reach, which made "the simulation is
      // green" a claim about less than it appeared to be.
      const finishedId = currentSessionId;
      await driver.completeSession({ sessionRpe: sessionRpe(trace, sessionIndex) });
      if (
        record(
          checkSessionCompleted(
            finishedId,
            fake.db.rows('workout_sessions') as never,
            ctx('completeSession')
          )
        )
      ) {
        return { persona: personaName, seed, findings, trace, sessionsCompleted };
      }

      sessionsCompleted++;
      state.sessionsCompleted++;
      persona.adaptAfterSession(state, rng);
      state.daysSinceLastSession = daysBetweenSessions;
      state.lastTrainedDay = driver.clock.today();
      driver.advanceDays(daysBetweenSessions);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const context = ctx('production-code-threw');
    findings.push({
      name: 'ENGINE_EXCEPTION',
      severity: 'INVARIANT',
      message: `Production code threw during simulation: ${error.message}`,
      context,
      detail: { stack: error.stack, lastTraceEvents: trace.slice(-5) },
    });
    return {
      persona: personaName,
      seed,
      findings,
      trace,
      sessionsCompleted,
      crash: { message: error.message, stack: error.stack, context },
    };
  }

  return { persona: personaName, seed, findings, trace, sessionsCompleted };
}

/**
 * The session RPE the lifter reports at the finish card: the mean of the
 * efforts they already reported on this session's sets.
 *
 * DELIBERATELY NOT AN RNG DRAW. Inserting one here would shift every
 * subsequent value in the stream and silently invalidate every recorded seed
 * — including the ones the open findings are reproduced from (simulation/rng
 * documents the rule). This needs no randomness anyway: the persona has
 * already made its per-set effort decisions, and this is an aggregation of
 * them, not a new one.
 */
function sessionRpe(trace: TraceEvent[], sessionIndex: number): number {
  const rows = trace.filter((e) => e.sessionIndex === sessionIndex && e.setId !== null);
  if (rows.length === 0) return 7;
  const mean = rows.reduce((sum, e) => sum + (10 - e.reportedRIR), 0) / rows.length;
  return Math.round(mean * 2) / 2;
}

function runStateChecks(
  driver: SessionDriver,
  fake: FakeSupabase,
  ctx: AssertionContext
): Finding[] {
  const blockIds = new Set(driver.blocks.map((b) => b.id));
  const dbRows = fake.db.rows('set_logs') as unknown as {
    id: string;
    exercise_block_id: string;
    set_number: number;
    reps: number;
    weight_kg: number;
  }[];
  return [
    ...checkSetAccounting(driver.sets, dbRows, blockIds, ctx),
    ...checkStateIntegrity(driver.sets, blockIds, ctx),
    ...checkNumericSanity(driver.sets, ctx),
  ];
}

function traceRow(
  driver: SessionDriver,
  state: PersonaState,
  args: {
    sessionIndex: number;
    sessionId: string;
    exerciseId: string;
    blockIndex: number;
    setNumber: number;
    rx: SetRecommendation;
    targetRir: number;
    outcome: { repsAchieved: number; actualRIR: number; reportedRIR: number; disposition: string };
    setId: string | null;
  }
): TraceEvent {
  return {
    simulatedAt: driver.clock.now().toISOString(),
    simulatedDay: driver.clock.today(),
    sessionIndex: args.sessionIndex,
    sessionId: args.sessionId,
    exerciseId: args.exerciseId,
    blockIndex: args.blockIndex,
    setNumber: args.setNumber,
    prescribedLoadKg: args.rx.weightKg,
    prescribedReps: args.rx.reps,
    targetRir: args.targetRir,
    repsAchieved: args.outcome.repsAchieved,
    actualRIR: args.outcome.actualRIR,
    reportedRIR: args.outcome.reportedRIR,
    trueE1RM: state.trueE1RM.get(args.exerciseId) ?? 0,
    personaFatigue: state.sessionFatigue,
    disposition: args.outcome.disposition,
    setId: args.setId,
  };
}

/**
 * A trace with everything intentionally irrelevant to determinism removed, for
 * the replay-equivalence invariant. Nothing engine-visible is normalised —
 * only ids the database generates, which carry no information.
 */
export function normalizeTrace(trace: TraceEvent[]): unknown[] {
  return trace.map((e) => ({ ...e, setId: e.setId ? 'set' : null, sessionId: 'session' }));
}
