/**
 * `runPostSessionMesoUpdates` reports whether its work actually landed.
 *
 * It has always caught its own errors — it runs in the finish flow and must
 * never throw into it — but it used to return `void`, so a caller could not
 * tell a completed run from a failed one. That matters now that a durable work
 * item (lib/offline/postFinishQueue) is cleared on the strength of its answer:
 * a swallowed failure would drop the item after a run that did nothing, which
 * turns at-least-once into at-most-once.
 *
 * So these tests are about the ANSWER, not the writes. The writes are covered
 * where they live; what is asserted here is that each failure mode is visible
 * to the caller, and that a best-effort signal is not mistaken for one.
 */
import { runPostSessionMesoUpdates } from '../postSessionMeso';

jest.mock('@/lib/training/deloadRecommendation', () => ({
  recordDeloadRecommendationIfTriggered: jest.fn().mockResolvedValue(undefined),
}));

type Result = { error: { message: string } | null; data?: unknown };

interface StubOptions {
  /** Fail the weekly_fatigue_logs write. */
  failFatigueWrite?: boolean;
  /** Fail the mesocycles.current_week advance. */
  failWeekAdvance?: boolean;
  /** Fail the joint-pain lookup (a best-effort signal, not a write). */
  failJointPain?: boolean;
  /** Throw from the very first query. */
  throwOnMesoRead?: boolean;
}

/**
 * Enough of the client for this function: the mesocycle read, the completed
 * session count, the joint-pain lookup, and the two writes.
 */
function stubClient(opts: StubOptions = {}) {
  const ok = (data: unknown = null): Result => ({ data, error: null });
  const fail = (message: string): Result => ({ data: null, error: { message } });

  return {
    from: (table: string) => {
      if (table === 'mesocycles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.throwOnMesoRead) throw new Error('connection reset');
                return ok({ total_weeks: 4, days_per_week: 3, current_week: 1 });
              },
            }),
          }),
          update: () => ({
            eq: () => ({
              lt: async () =>
                opts.failWeekAdvance ? fail('week advance refused') : ok(),
            }),
          }),
        };
      }
      if (table === 'joint_pain_events') {
        return {
          select: () => ({
            eq: () => ({
              gte: async () => {
                if (opts.failJointPain) throw new Error('joint_pain_events missing');
                return ok([]);
              },
            }),
          }),
        };
      }
      if (table === 'weekly_fatigue_logs') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ok(null) }),
                is: () => ({ maybeSingle: async () => ok(null) }),
              }),
            }),
          }),
          insert: async () =>
            opts.failFatigueWrite ? fail('fatigue insert refused') : ok(),
          update: () => ({ eq: async () => ok() }),
        };
      }
      if (table === 'workout_sessions') {
        // countCompletedSessions: a head/count query.
        const q: Record<string, unknown> = {};
        const chain = new Proxy(q, {
          get: (_t, prop) => {
            if (prop === 'then') return undefined;
            return () => chain;
          },
        });
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: 3, error: null }),
              ...chain,
            }),
          }),
        };
      }
      throw new Error(`stubClient: unexpected table ${table}`);
    },
  } as never;
}

const INPUT = {
  mesocycleId: 'meso-1',
  userId: 'u1',
  sessionRpe: 8,
  checkIn: { readinessScore: 80 },
};

describe('runPostSessionMesoUpdates reports its outcome', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('reports ok when every step lands', async () => {
    expect(await runPostSessionMesoUpdates(stubClient(), INPUT)).toEqual({ ok: true });
  });

  it('reports failure when the weekly fatigue log does not save', async () => {
    // The one step that does NOT self-heal on the next finish — losing it
    // silently is exactly the case the work item exists to catch.
    expect(
      await runPostSessionMesoUpdates(stubClient({ failFatigueWrite: true }), INPUT)
    ).toEqual({ ok: false });
  });

  it('reports failure when the week advance is refused', async () => {
    expect(
      await runPostSessionMesoUpdates(stubClient({ failWeekAdvance: true }), INPUT)
    ).toEqual({ ok: false });
  });

  it('reports failure when a query throws outright', async () => {
    expect(
      await runPostSessionMesoUpdates(stubClient({ throwOnMesoRead: true }), INPUT)
    ).toEqual({ ok: false });
  });

  it('still reports ok when only the joint-pain signal fails', async () => {
    // Best-effort with a defined fallback (no pain), not a write that can be
    // lost. Treating it as a failure would retry the whole item for ever on
    // any install where that table is absent.
    expect(
      await runPostSessionMesoUpdates(stubClient({ failJointPain: true }), INPUT)
    ).toEqual({ ok: true });
  });

  it('never throws into the finish flow', async () => {
    await expect(
      runPostSessionMesoUpdates(stubClient({ throwOnMesoRead: true }), INPUT)
    ).resolves.toBeDefined();
  });
});
