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
 * constraints, and session start is still seeded (Phase 1 scope note). Both are
 * recorded limitations, not silent ones.
 */
import type { FakeSupabase } from '../fakeSupabase';
import { createSimulationWorld, createMemoryOutbox, SIM_SESSION_ID, SIM_USER_ID } from '../fixtures';
import { runSimulation, hardFailures, guardrailWarnings, normalizeTrace } from '../runner';
import { formatFinding, APPROVED_REPETITION_REASONS, checkSet3Contract } from '../assertions';
import { PERSONA_NAMES, type PersonaName } from '../personas';
import { resetClock } from '@/lib/clock';
import { __setDriverForTests } from '@/lib/offline/setOutbox';

jest.mock('@/lib/actions/workout-calories', () => ({
  calculateAndSaveWorkoutCalories: jest.fn().mockResolvedValue(undefined),
}));

const world = (): FakeSupabase => createSimulationWorld();

const run = (persona: PersonaName, seed: string | number, sessions = 12) =>
  runSimulation({
    persona, seed, fake: world(), userId: SIM_USER_ID, sessionId: SIM_SESSION_ID,
    startAt: '2026-04-06T09:00:00', sessions,
  });

beforeEach(() => __setDriverForTests(createMemoryOutbox() as never));
afterEach(() => {
  resetClock();
  __setDriverForTests(null);
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
