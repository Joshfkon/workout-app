/**
 * Standalone (no-mesocycle) deload recommendation.
 *
 * The pure helpers (week numbering, streak, performance mapping) are tested
 * directly; the DB functions run against a minimal chainable Supabase stub.
 * The trigger LOGIC itself is services/deloadEngine.checkDeloadTriggers and is
 * covered by its own suite — here we verify the wiring: what rows feed it,
 * when the check is suppressed, and what gets stamped on the user row.
 */

import {
  acceptStandaloneLightWeek,
  buildStandalonePerformance,
  consecutiveRecentWeeks,
  dismissStandaloneDeloadRecommendation,
  fetchStandaloneDeloadRecommendation,
  recordStandaloneDeloadIfTriggered,
  rewriteStandaloneReason,
  standaloneWeekNumber,
  type StandaloneFatigueLogRow,
} from '../standaloneDeload';
import { resetClock, setClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';

afterEach(resetClock);

// ============================================================
// Supabase stub
// ============================================================

type Row = Record<string, unknown>;

interface RecordedUpdate {
  table: string;
  patch: Row;
  filters: Array<[op: string, column: string, value: unknown]>;
}

function makeStub(opts: {
  user?: Row | null;
  logs?: StandaloneFatigueLogRow[];
  sleep?: Row[];
  wellness?: Row[];
  userError?: string;
  logsError?: string;
}) {
  const updates: RecordedUpdate[] = [];
  const client = {
    from(table: string) {
      const filters: RecordedUpdate['filters'] = [];
      // Chain-anything builder; typed loosely on purpose.
      // eslint-disable-next-line
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push(['eq', column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push(['is', column, value]);
          return builder;
        },
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          if (table === 'users') {
            return opts.userError
              ? { data: null, error: { message: opts.userError } }
              : { data: opts.user ?? null, error: null };
          }
          return { data: null, error: null };
        },
        update: (patch: Row) => {
          updates.push({ table, patch, filters });
          return builder;
        },
        // Awaiting the builder resolves list queries (and update chains).
        then: (
          resolve: (value: { data: unknown; error: unknown }) => unknown
        ) => {
          let data: unknown = null;
          let error: unknown = null;
          if (table === 'weekly_fatigue_logs') {
            if (opts.logsError) error = { message: opts.logsError };
            else data = opts.logs ?? [];
          } else if (table === 'sleep_log') {
            data = opts.sleep ?? [];
          } else if (table === 'daily_wellness_metrics') {
            data = opts.wellness ?? [];
          }
          return Promise.resolve({ data, error }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as never, updates };
}

/** A calm training week: nothing for the trigger engine to object to. */
function calmWeek(week_number: number): StandaloneFatigueLogRow {
  return {
    week_number,
    perceived_fatigue: 2,
    sleep_quality: 4,
    motivation_level: 4,
    missed_reps: 0,
    joint_pain: false,
    strength_decline: false,
  };
}

/** Default user row: nothing pending, intermediate, mid-30s equivalent. */
function userRow(overrides: Row = {}): Row {
  return {
    standalone_deload_recommended_at: null,
    standalone_deload_week: null,
    experience: 'intermediate',
    goal: 'bulk',
    birth_date: null, // age defaults to 30
    sleep_quality: 4,
    stress_level: 2,
    training_age_years: 3,
    ...overrides,
  };
}

// Fixed "now": Saturday 2026-08-15. Its week (Mon 2026-08-10) is used to key
// rows relative to the current week.
const NOW = '2026-08-15T10:00:00';

function currentWeekAt(now: string): number {
  setClock(createTestClock(now));
  const week = standaloneWeekNumber();
  return week;
}

// ============================================================
// standaloneWeekNumber
// ============================================================

describe('standaloneWeekNumber', () => {
  it('is 0 throughout the epoch week (Mon 2020-01-06 .. Sun 2020-01-12)', () => {
    setClock(createTestClock('2020-01-06T00:30:00'));
    expect(standaloneWeekNumber()).toBe(0);
    setClock(createTestClock('2020-01-12T23:30:00'));
    expect(standaloneWeekNumber()).toBe(0);
  });

  it('increments on Monday', () => {
    setClock(createTestClock('2020-01-13T00:30:00'));
    expect(standaloneWeekNumber()).toBe(1);
  });

  it('is stable across a training week and increments week over week', () => {
    const monday = currentWeekAt('2026-08-10T06:00:00');
    const saturday = currentWeekAt('2026-08-15T22:00:00');
    const nextMonday = currentWeekAt('2026-08-17T06:00:00');
    expect(saturday).toBe(monday);
    expect(nextMonday).toBe(monday + 1);
  });

  it('accepts an explicit date without touching the clock', () => {
    expect(standaloneWeekNumber(new Date(2020, 0, 20, 12, 0, 0))).toBe(2);
  });
});

// ============================================================
// consecutiveRecentWeeks
// ============================================================

describe('consecutiveRecentWeeks', () => {
  it('takes the consecutive run ending at the newest row', () => {
    const rows = [calmWeek(340), calmWeek(339), calmWeek(338)];
    expect(consecutiveRecentWeeks(rows).map((r) => r.week_number)).toEqual([340, 339, 338]);
  });

  it('stops at a gap — an untrained week resets the streak', () => {
    const rows = [calmWeek(340), calmWeek(339), calmWeek(336), calmWeek(335)];
    expect(consecutiveRecentWeeks(rows).map((r) => r.week_number)).toEqual([340, 339]);
  });

  it('stops at the accepted light-week boundary (inclusive)', () => {
    const rows = [calmWeek(340), calmWeek(339), calmWeek(338)];
    expect(consecutiveRecentWeeks(rows, 338).map((r) => r.week_number)).toEqual([340, 339]);
  });

  it('skips duplicate week rows defensively', () => {
    const rows = [calmWeek(340), calmWeek(340), calmWeek(339)];
    expect(consecutiveRecentWeeks(rows).map((r) => r.week_number)).toEqual([340, 339]);
  });
});

// ============================================================
// buildStandalonePerformance
// ============================================================

describe('buildStandalonePerformance', () => {
  it('renumbers the streak 1..n oldest-first so weekNumber reads as streak length', () => {
    const perf = buildStandalonePerformance([calmWeek(340), calmWeek(339), calmWeek(338)]);
    expect(perf.map((w) => w.weekNumber)).toEqual([1, 2, 3]);
  });

  it('defaults null signals to neutral values', () => {
    const perf = buildStandalonePerformance([
      {
        week_number: 340,
        perceived_fatigue: null,
        sleep_quality: null,
        motivation_level: null,
        missed_reps: null,
        joint_pain: null,
        strength_decline: null,
      },
    ]);
    expect(perf[0]).toMatchObject({
      perceivedFatigue: 3,
      sleepQuality: 3,
      motivationLevel: 3,
      missedReps: 0,
      jointPain: false,
      strengthDecline: false,
      isDeload: false,
    });
  });
});

describe('rewriteStandaloneReason', () => {
  it('reframes the mesocycle-start backup trigger for streak semantics', () => {
    expect(rewriteStandaloneReason('8 weeks since mesocycle start - overdue for deload')).toBe(
      '8 weeks of training without a break - overdue for a light week'
    );
  });

  it('passes other reasons through untouched', () => {
    expect(rewriteStandaloneReason('Joint pain reported - reduce intensity')).toBe(
      'Joint pain reported - reduce intensity'
    );
  });
});

// ============================================================
// recordStandaloneDeloadIfTriggered
// ============================================================

describe('recordStandaloneDeloadIfTriggered', () => {
  it('stamps the user row when two consecutive high-fatigue weeks fire the engine', async () => {
    const week = currentWeekAt(NOW);
    const { client, updates } = makeStub({
      user: userRow(),
      logs: [
        { ...calmWeek(week), perceived_fatigue: 4, sleep_quality: 2 },
        { ...calmWeek(week - 1), perceived_fatigue: 3, sleep_quality: 2 },
      ],
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(true);

    expect(updates).toHaveLength(1);
    const update = updates[0];
    expect(update.table).toBe('users');
    expect(update.patch.standalone_deload_recommended_at).toBeTruthy();
    expect(update.patch.standalone_deload_reasons).toEqual(
      expect.arrayContaining(['Perceived fatigue elevated for 2+ weeks'])
    );
    // Race-safe: first writer wins.
    expect(update.filters).toContainEqual(['is', 'standalone_deload_recommended_at', null]);
    expect(update.filters).toContainEqual(['eq', 'id', 'u1']);
  });

  it('fires the overdue backup trigger after a long unbroken streak, with rewritten copy', async () => {
    const week = currentWeekAt(NOW);
    // Intermediate, trainingAge 3, age 30, good sleep/stress -> deload
    // frequency 5; the backup trigger fires at streak >= 7.
    const logs = Array.from({ length: 8 }, (_, i) => calmWeek(week - i));
    const { client, updates } = makeStub({ user: userRow(), logs });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(true);
    const reasons = updates[0].patch.standalone_deload_reasons as string[];
    expect(reasons).toEqual([
      '8 weeks of training without a break - overdue for a light week',
    ]);
  });

  it('does nothing when the streak is calm and short', async () => {
    const week = currentWeekAt(NOW);
    const { client, updates } = makeStub({
      user: userRow(),
      logs: [calmWeek(week), calmWeek(week - 1), calmWeek(week - 2)],
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('returns false when a recommendation is already pending', async () => {
    currentWeekAt(NOW);
    const { client, updates } = makeStub({
      user: userRow({ standalone_deload_recommended_at: '2026-08-01T00:00:00Z' }),
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('suppresses the check while an accepted light week is current or upcoming', async () => {
    const week = currentWeekAt(NOW);
    const { client, updates } = makeStub({
      user: userRow({ standalone_deload_week: week }),
      logs: [
        { ...calmWeek(week), perceived_fatigue: 4 },
        { ...calmWeek(week - 1), perceived_fatigue: 4 },
      ],
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('cuts the streak at a PAST accepted light week instead of suppressing', async () => {
    const week = currentWeekAt(NOW);
    // Light week three weeks ago: the two weeks since form a fresh streak of
    // 2; older weeks (including the pre-light-week grind) no longer count.
    const logs = Array.from({ length: 8 }, (_, i) => calmWeek(week - i));
    const { client, updates } = makeStub({
      user: userRow({ standalone_deload_week: week - 3 }),
      logs,
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('ignores a stale streak (newest log older than last week)', async () => {
    const week = currentWeekAt(NOW);
    const { client, updates } = makeStub({
      user: userRow(),
      logs: [
        { ...calmWeek(week - 3), perceived_fatigue: 4 },
        { ...calmWeek(week - 4), perceived_fatigue: 4 },
      ],
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('requires at least two logged weeks', async () => {
    const week = currentWeekAt(NOW);
    const { client, updates } = makeStub({
      user: userRow(),
      logs: [{ ...calmWeek(week), perceived_fatigue: 5 }],
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('appends chronic-short-sleep evidence when the sleep log shows it', async () => {
    const week = currentWeekAt(NOW);
    const sleep = ['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12'].map((day) => ({
      local_day: day,
      hours: 5.5,
    }));
    const { client, updates } = makeStub({
      user: userRow(),
      logs: [
        { ...calmWeek(week), perceived_fatigue: 4, sleep_quality: 2 },
        { ...calmWeek(week - 1), perceived_fatigue: 3, sleep_quality: 2 },
      ],
      sleep,
    });

    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).resolves.toBe(true);
    const reasons = updates[0].patch.standalone_deload_reasons as string[];
    expect(reasons.some((r) => r.includes('sleep over the last week'))).toBe(true);
  });

  it('throws on a user read error (caller is fire-and-forget)', async () => {
    currentWeekAt(NOW);
    const { client } = makeStub({ userError: 'boom' });
    await expect(recordStandaloneDeloadIfTriggered(client, 'u1')).rejects.toThrow('boom');
  });
});

// ============================================================
// fetch / accept / dismiss
// ============================================================

describe('fetchStandaloneDeloadRecommendation', () => {
  it('returns null when nothing is pending', async () => {
    const { client } = makeStub({ user: userRow() });
    await expect(fetchStandaloneDeloadRecommendation(client, 'u1')).resolves.toBeNull();
  });

  it('parses the pending recommendation', async () => {
    const { client } = makeStub({
      user: userRow({
        standalone_deload_recommended_at: '2026-08-15T10:00:00Z',
        standalone_deload_reasons: ['Joint pain reported - reduce intensity'],
      }),
    });
    await expect(fetchStandaloneDeloadRecommendation(client, 'u1')).resolves.toEqual({
      recommendedAt: '2026-08-15T10:00:00Z',
      reasons: ['Joint pain reported - reduce intensity'],
    });
  });
});

describe('acceptStandaloneLightWeek', () => {
  it('stamps the UPCOMING week and clears the recommendation', async () => {
    const week = currentWeekAt(NOW);
    const { client, updates } = makeStub({ user: userRow() });

    await expect(acceptStandaloneLightWeek(client, 'u1')).resolves.toEqual({
      lightWeek: week + 1,
    });
    expect(updates).toEqual([
      expect.objectContaining({
        table: 'users',
        patch: {
          standalone_deload_week: week + 1,
          standalone_deload_recommended_at: null,
          standalone_deload_reasons: null,
        },
      }),
    ]);
  });
});

describe('dismissStandaloneDeloadRecommendation', () => {
  it('clears the stamp and reasons only', async () => {
    const { client, updates } = makeStub({ user: userRow() });
    await dismissStandaloneDeloadRecommendation(client, 'u1');
    expect(updates).toEqual([
      expect.objectContaining({
        table: 'users',
        patch: {
          standalone_deload_recommended_at: null,
          standalone_deload_reasons: null,
        },
      }),
    ]);
  });
});
