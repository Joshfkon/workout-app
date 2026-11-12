/**
 * ProgramEngine.checkDeloadTriggers (the live in-mesocycle path) must agree
 * with services/deloadEngine.checkDeloadTriggers (the pure engine the
 * standalone path runs) — there is ONE trigger implementation.
 *
 * Before: the engine carried its own copy with the experience gate inverted
 * (a novice needed two triggers, an advanced lifter one) and no
 * overdue-for-deload backup trigger. The pure engine's behaviour won.
 */
import { ProgramEngine, buildMesocyclePerformance } from '@/lib/training/programEngine';
import { checkDeloadTriggers, getDeloadStrategy } from '@/services/deloadEngine';
import type { ExtendedUserProfile, PeriodizationPlan } from '@/types/schema';

type Row = Record<string, unknown>;

/** Chainable stub: awaiting any chain yields the table's rows. */
function stubClient(rowsByTable: Record<string, Row[]>) {
  const builder = (table: string): unknown => {
    const rows = rowsByTable[table] ?? [];
    const result = { data: rows.length ? rows : null, error: null, count: rows.length };
    const one = { data: rows[0] ?? null, error: null };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then') {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(result).then(res, rej);
          }
          if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(one);
          return () => proxy;
        },
      }
    );
    return proxy;
  };
  return { from: (table: string) => builder(table) } as never;
}

const log = (week: number, over: Row = {}): Row => ({
  week_number: week,
  perceived_fatigue: 3,
  sleep_quality: 3,
  motivation_level: 3,
  missed_reps: 0,
  joint_pain: false,
  strength_decline: false,
  ...over,
});

async function engineCheck(experience: string, logsNewestFirst: Row[], deloadWeek = 6) {
  const engine = await ProgramEngine.create(
    'u1',
    stubClient({
      users: [{ experience, birth_date: null, training_age_years: 3 }],
      weekly_fatigue_logs: logsNewestFirst,
      mesocycles: [{ deload_week: deloadWeek }],
    })
  );
  return engine.checkDeloadTriggers('m1');
}

describe('ProgramEngine.checkDeloadTriggers — one implementation', () => {
  // The review's worked example: a single trigger (joint pain).
  const oneTrigger = [log(2, { joint_pain: true }), log(1)];

  it('a novice with one trigger gets a recommendation (as in the standalone path)', async () => {
    const result = await engineCheck('novice', oneTrigger);
    expect(result.shouldDeload).toBe(true);
    expect(result.reasons).toEqual(['Joint pain reported - reduce intensity']);
    expect(result.suggestedDeloadType).toBe('intensity');
  });

  it('an advanced lifter with one trigger does not', async () => {
    const result = await engineCheck('advanced', oneTrigger);
    expect(result.shouldDeload).toBe(false);
  });

  it('an advanced lifter with two triggers does', async () => {
    const result = await engineCheck('advanced', [
      log(2, { joint_pain: true, strength_decline: true }),
      log(1),
    ]);
    expect(result.shouldDeload).toBe(true);
    expect(result.reasons).toHaveLength(2);
  });

  it('an intermediate with one trigger does', async () => {
    const result = await engineCheck('intermediate', oneTrigger);
    expect(result.shouldDeload).toBe(true);
  });

  it('fewer than two weekly logs never triggers', async () => {
    const result = await engineCheck('novice', [log(1, { joint_pain: true })]);
    expect(result).toEqual({ shouldDeload: false, reasons: [], suggestedDeloadType: 'volume' });
  });

  it.each(['novice', 'intermediate', 'advanced'] as const)(
    'matches the pure engine exactly for %s across trigger combinations',
    async (experience) => {
      const cases: Row[][] = [
        [log(2), log(1)],
        [log(2, { perceived_fatigue: 4 }), log(1, { perceived_fatigue: 3 })],
        [log(2, { sleep_quality: 2 }), log(1, { sleep_quality: 2 })],
        [log(2, { motivation_level: 2, missed_reps: 6 }), log(1)],
        [log(3, { joint_pain: true, perceived_fatigue: 5 }), log(2, { perceived_fatigue: 4 }), log(1)],
      ];
      for (const logs of cases) {
        const engine = await ProgramEngine.create(
          'u1',
          stubClient({
            users: [{ experience, birth_date: null, training_age_years: 3 }],
            weekly_fatigue_logs: logs,
            mesocycles: [{ deload_week: 6 }],
          })
        );
        const deloadFrequency = engine.calculateRecoveryFactors().deloadFrequencyWeeks;
        const expected = checkDeloadTriggers(
          buildMesocyclePerformance(logs as never, 6),
          { experience } as ExtendedUserProfile,
          {
            model: 'linear',
            mesocycleWeeks: deloadFrequency + 1,
            weeklyProgression: [],
            deloadFrequency,
            deloadStrategy: getDeloadStrategy(experience),
          } as PeriodizationPlan
        );
        const actual = await engine.checkDeloadTriggers('m1');
        expect(actual.shouldDeload).toBe(expected.shouldDeload);
        expect(actual.suggestedDeloadType).toBe(expected.suggestedDeloadType);
        // Same triggers in the same order (evidence lines may follow).
        expect(actual.reasons.slice(0, expected.reasons.length)).toEqual(expected.reasons);
      }
    }
  );
});

describe('buildMesocyclePerformance', () => {
  it('orders oldest-first, flags the deload week, and reads missing ratings as neutral', () => {
    const rows = [
      log(3, { perceived_fatigue: null, sleep_quality: null, motivation_level: null }),
      log(1),
      log(2, { missed_reps: 4 }),
    ];
    const snapshot = JSON.stringify(rows);
    const performance = buildMesocyclePerformance(rows as never, 2);

    expect(performance.map((w) => w.weekNumber)).toEqual([1, 2, 3]);
    expect(performance.map((w) => w.isDeload)).toEqual([false, true, false]);
    expect(performance[2]).toMatchObject({
      perceivedFatigue: 3,
      sleepQuality: 3,
      motivationLevel: 3,
    });
    expect(performance[1].missedReps).toBe(4);
    // Input untouched.
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});
