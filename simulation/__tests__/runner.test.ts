/**
 * Phase 3 — the assertion suite running against real production code.
 *
 * These are the first tests where the harness is doing its actual job rather
 * than proving its own plumbing: personas drive the engine for dozens of
 * simulated sessions and the invariants watch every state-changing operation.
 *
 * A NOTE ON WHAT A GREEN RUN MEANS. It means no INVARIANT or CONTRACT was
 * violated on these paths, at these seeds, against the in-memory client. It
 * does NOT mean the engine is correct — the fake enforces no database
 * constraints, and session START is still seeded (Phase 1 scope note). Both are
 * recorded limitations, not silent ones. Session FINISH is no longer among
 * them: sessions now complete through the production finish flow.
 */
import type { FakeSupabase } from '../fakeSupabase';
import {
  createSimulationWorld,
  createMemoryOutbox,
  SIM_MESOCYCLE_ID,
  SIM_SESSION_ID,
  SIM_USER_ID,
} from '../fixtures';
import { runSimulation, hardFailures, guardrailWarnings, normalizeTrace } from '../runner';
import { formatFinding, APPROVED_REPETITION_REASONS, checkSet3Contract } from '../assertions';
import { PERSONA_NAMES, type PersonaName } from '../personas';
import { resetClock } from '@/lib/clock';
import { __setDriverForTests } from '@/lib/offline/setOutbox';
import {
  __setPostFinishStoreForTests,
  listPostFinishWork,
  type PostFinishWork,
} from '@/lib/offline/postFinishQueue';
import { createMemoryStore } from '@/lib/offline/setOutbox';

jest.mock('@/lib/actions/workout-calories', () => ({
  // The real action is a SERVER action and cannot resolve headlessly; it also
  // reports { success }, which the post-finish settlement checks. A mock
  // returning undefined reads as a failed run and leaves work items behind.
  calculateAndSaveWorkoutCalories: jest.fn().mockResolvedValue({ success: true }),
}));

const world = (): FakeSupabase => createSimulationWorld();

const run = (persona: PersonaName, seed: string | number, sessions = 12) =>
  runSimulation({
    persona, seed, fake: world(), userId: SIM_USER_ID, sessionId: SIM_SESSION_ID,
    startAt: '2026-04-06T09:00:00', sessions,
  });

beforeEach(() => {
  __setDriverForTests(createMemoryOutbox() as never);
  // Per-run isolation: the post-finish store is a module singleton, so a run
  // that left an item behind would otherwise leak into the next one.
  __setPostFinishStoreForTests(createMemoryStore<PostFinishWork>());
});
afterEach(() => {
  resetClock();
  __setDriverForTests(null);
  __setPostFinishStoreForTests(null);
});

/**
 * INVARIANTS are asserted unconditionally: they held across every persona and
 * every seed in a 175-run / 73,100-set sweep, so anything here is a regression.
 *
 * CONTRACTS are handled separately below, because the sweep found a real one
 * failing — see simulation/__tests__/scenarios.test.ts. Asserting "zero hard
 * failures" here would either be a lie or a permanently red suite; asserting
 * "no NEW contract violations" keeps the guard sharp while the known defect is
 * tracked by its own deterministic reproduction.
 */
const KNOWN_OPEN_CONTRACT_DEFECTS = ['REGRESSION_SET3_UNATTAINED_TARGET'];

describe('invariants hold for every persona', () => {
  it.each(PERSONA_NAMES)('%s: no INVARIANT violation over 12 sessions', async (persona) => {
    const result = await run(persona, 1);
    const invariants = hardFailures(result).filter((f) => f.severity === 'INVARIANT');
    // The message is the deliverable: a bare "expected 0" would send a
    // developer back to the harness instead of to the offending operation.
    expect(invariants.map(formatFinding).join('\n\n')).toBe('');
    expect(result.crash).toBeUndefined();
  });

  it.each(PERSONA_NAMES)('%s: holds across five different seeds', async (persona) => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const result = await run(persona, seed, 8);
      const invariants = hardFailures(result).filter((f) => f.severity === 'INVARIANT');
      expect(invariants.map(formatFinding).join('\n\n')).toBe('');
    }
  });

  it.each(PERSONA_NAMES)('%s: no NEW contract violation over a long run', async (persona) => {
    // 40 sessions is long enough to reach the session-to-session paths where
    // the known defect lives, so this really does exercise the contract set.
    const result = await run(persona, 'contract-scan', 40);
    const unexpected = hardFailures(result)
      .filter((f) => f.severity === 'CONTRACT')
      .filter((f) => !KNOWN_OPEN_CONTRACT_DEFECTS.includes(f.name));
    expect(unexpected.map(formatFinding).join('\n\n')).toBe('');
  });
});

describe('replay determinism (tests the harness itself)', () => {
  it.each(PERSONA_NAMES)('%s: the same seed produces the same normalized trace', async (persona) => {
    const a = await run(persona, 'replay', 10);
    const b = await run(persona, 'replay', 10);
    expect(normalizeTrace(a.trace)).toEqual(normalizeTrace(b.trace));
    expect(a.sessionsCompleted).toBe(b.sessionsCompleted);
  });

  it('different seeds diverge — otherwise the seed is doing nothing', async () => {
    const a = await run('chaotic-intermediate', 'seed-a', 10);
    const b = await run('chaotic-intermediate', 'seed-b', 10);
    expect(normalizeTrace(a.trace)).not.toEqual(normalizeTrace(b.trace));
  });
});

describe('the run produces a usable record', () => {
  it('traces every logged set with both reported and ground-truth effort', async () => {
    const result = await run('linear-novice', 7, 4);
    expect(result.trace.length).toBeGreaterThan(0);

    for (const e of result.trace) {
      expect(e.simulatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(e.simulatedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.prescribedLoadKg).toBeGreaterThan(0);
      expect(e.trueE1RM).toBeGreaterThan(0);
      expect(typeof e.actualRIR).toBe('number');
      expect(typeof e.reportedRIR).toBe('number');
    }
  });

  it('simulated time really advances across the run', async () => {
    const result = await run('linear-novice', 7, 6);
    const days = new Set(result.trace.map((e) => e.simulatedDay));
    expect(days.size).toBeGreaterThan(1);
  });

  it('every finding carries a one-command reproduction', async () => {
    const result = await run('plateauer', 3, 20);
    for (const f of result.findings) {
      const text = formatFinding(f);
      expect(text).toContain('npm run simulate');
      expect(text).toContain(`--persona=${f.context.persona}`);
      expect(text).toContain(`--seed=${f.context.seed}`);
      expect(text).toContain('simulated=');
    }
  });
});

describe('guardrails report without failing', () => {
  it('are classified as warnings and never counted as failures', async () => {
    const result = await run('plateauer', 5, 24);
    const warnings = guardrailWarnings(result);
    for (const g of warnings) {
      expect(g.severity).toBe('GUARDRAIL');
      expect(hardFailures(result)).not.toContain(g);
    }
  });

  it('the guardrails actually fire — one that never fires is indistinguishable from a broken one', async () => {
    const result = await run('plateauer', 5, 30);
    const names = new Set(guardrailWarnings(result).map((g) => g.name));
    expect(names.size).toBeGreaterThan(0);
  });
});

describe('the Set-3 contract', () => {
  const ctx = {
    persona: 'short-set-specialist',
    seed: 1,
    simulatedAt: '2026-04-06T09:00:00.000Z',
    simulatedDay: '2026-04-06',
    operation: 'getNextPrescription',
  };
  const rx = (weightKg: number, reps: number) =>
    ({ weightKg, reps, rir: 2, rationale: 'maintain', effortVsTarget: 'on_target' }) as never;

  it('fires when the same unattained target is served again', () => {
    const findings = checkSet3Contract(
      {
        prescribed: rx(100, 10),
        outcome: { repsAchieved: 7, actualRIR: 0, reportedRIR: 0, disposition: 'completed' },
        targetRir: 2,
      },
      rx(100, 10),
      ctx
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('CONTRACT');
    expect(findings[0].name).toBe('REGRESSION_SET3_UNATTAINED_TARGET');
  });

  it('does not fire when the target actually changed', () => {
    const attempt = {
      prescribed: rx(100, 10),
      outcome: { repsAchieved: 7, actualRIR: 0, reportedRIR: 0, disposition: 'completed' as const },
      targetRir: 2,
    };
    expect(checkSet3Contract(attempt, rx(95, 10), ctx)).toEqual([]);
    expect(checkSet3Contract(attempt, rx(100, 8), ctx)).toEqual([]);
  });

  it('does not fire when the set hit its target', () => {
    expect(
      checkSet3Contract(
        {
          prescribed: rx(100, 10),
          outcome: { repsAchieved: 10, actualRIR: 0, reportedRIR: 0, disposition: 'completed' },
          targetRir: 2,
        },
        rx(100, 10),
        ctx
      )
    ).toEqual([]);
  });

  it('does not fire when the miss came with RIR left in the tank', () => {
    // Reported RIR 3 against a target of 2 means the lifter stopped early, not
    // that the target was unattainable — a repeat is defensible there.
    expect(
      checkSet3Contract(
        {
          prescribed: rx(100, 10),
          outcome: { repsAchieved: 7, actualRIR: 3, reportedRIR: 3, disposition: 'completed' },
          targetRir: 2,
        },
        rx(100, 10),
        ctx
      )
    ).toEqual([]);
  });

  it('no reason code can excuse a repeat, because the approved list is empty', () => {
    expect(APPROVED_REPETITION_REASONS).toEqual([]);
    const findings = checkSet3Contract(
      {
        prescribed: rx(100, 10),
        outcome: { repsAchieved: 7, actualRIR: 0, reportedRIR: 0, disposition: 'completed' },
        targetRir: 2,
      },
      rx(100, 10),
      ctx,
      'anchor'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail?.reasonCode).toBe('anchor');
  });
});

describe('the short-set specialist actually reaches the contract', () => {
  it('produces sets that miss their target at zero reported RIR', async () => {
    // If this stops holding, the Set-3 contract is never evaluated in a real
    // run and its coverage silently drops to the unit tests above.
    const result = await run('short-set-specialist', 2, 15);
    const missesAtZeroRir = result.trace.filter(
      (e) => e.repsAchieved < e.prescribedReps && e.reportedRIR <= e.targetRir
    );
    expect(missesAtZeroRir.length).toBeGreaterThan(0);
  });
});

/**
 * The finish flow is REACHED.
 *
 * Sessions used to be left `in_progress` for ever: the loop counted them and
 * moved the clock on without calling `completeSession`, so the finish, the
 * post-finish settlement and the mesocycle updates were all outside the
 * harness. A green run said less than it appeared to. These guard against
 * silently regressing to that — a harness that stops exercising a path stops
 * being evidence about it.
 */
describe('sessions are finished through the production flow', () => {
  it('every simulated session ends up recorded as completed', async () => {
    const fake = world();
    const result = await runSimulation({
      persona: 'linear-novice', seed: 5, fake, userId: SIM_USER_ID,
      sessionId: SIM_SESSION_ID, startAt: '2026-04-06T09:00:00', sessions: 6,
    });

    const rows = fake.db.rows('workout_sessions') as unknown as {
      state: string;
      completed_at: string | null;
    }[];
    expect(rows.length).toBe(result.sessionsCompleted);
    expect(rows.every((r) => r.state === 'completed')).toBe(true);
    expect(rows.every((r) => !!r.completed_at)).toBe(true);
  });

  it('leaves no post-finish work outstanding', async () => {
    // Every finish should settle within the run. A backlog here means the
    // settlement is not completing, which is the B3 failure mode.
    await runSimulation({
      persona: 'chaotic-intermediate', seed: 9, fake: world(), userId: SIM_USER_ID,
      sessionId: SIM_SESSION_ID, startAt: '2026-04-06T09:00:00', sessions: 8,
    });
    expect(await listPostFinishWork()).toEqual([]);
  });
});

/**
 * The MESOCYCLE post-processing is reached too.
 *
 * Finishing a session is not enough on its own: `runPostSessionMesoUpdates`
 * short-circuits when the session has no `mesocycle_id`, so with unlinked
 * sessions the week advance, the weekly fatigue log and the deload-trigger
 * check stayed unexercised even after the runner started finishing properly
 * (Codex review on #609 — the first version of that change claimed coverage
 * it did not have). These assert the OUTPUTS, which is the only way to tell
 * "the code ran" from "the code was skipped quietly".
 */
describe('post-session mesocycle updates are reached', () => {
  it('writes a weekly fatigue log from the finished sessions', async () => {
    const fake = world();
    await runSimulation({
      persona: 'linear-novice', seed: 3, fake, userId: SIM_USER_ID,
      sessionId: SIM_SESSION_ID, startAt: '2026-04-06T09:00:00', sessions: 4,
    });

    // EVERY session must be linked, not just most of them: the fatigue log is
    // overwritten per (user, meso, week), so a single unlinked session is
    // invisible in the log rows themselves — but it silently drops out of the
    // completed-session count that drives the week advance.
    const sessions = fake.db.rows('workout_sessions') as unknown as {
      mesocycle_id: string | null;
    }[];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((r) => r.mesocycle_id === SIM_MESOCYCLE_ID)).toBe(true);

    const logs = fake.db.rows('weekly_fatigue_logs') as unknown as {
      mesocycle_id: string;
      week_number: number;
      notes: string;
    }[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.mesocycle_id === SIM_MESOCYCLE_ID)).toBe(true);
    // The RPE in the note comes from the finish card, i.e. from the sets the
    // persona actually logged — so this also proves the value is derived, not
    // a constant the fixture happened to supply.
    expect(logs.some((l) => /avg RPE \d/.test(l.notes))).toBe(true);
  });

  it('advances the mesocycle week once enough sessions are done', async () => {
    // days_per_week is 3, so the week rolls over on the 4th completed session.
    const fake = world();
    await runSimulation({
      persona: 'linear-novice', seed: 3, fake, userId: SIM_USER_ID,
      sessionId: SIM_SESSION_ID, startAt: '2026-04-06T09:00:00', sessions: 7,
    });

    const meso = (fake.db.rows('mesocycles') as unknown as { current_week: number }[])[0];
    expect(meso.current_week).toBeGreaterThan(1);
  });
});
