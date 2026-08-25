/**
 * `runPostSessionStandaloneUpdates` — the no-mesocycle mirror of the meso
 * post-session runner. Verifies the weekly fatigue log lands with
 * mesocycle_id NULL keyed by the epoch week, that the standalone deload check
 * runs afterwards, and that the outcome REPORTS failures instead of
 * swallowing them (the postFinishQueue work item is only cleared on ok).
 */

import { runPostSessionStandaloneUpdates } from '../postSessionStandalone';
import {
  recordStandaloneDeloadIfTriggered,
  standaloneWeekNumber,
} from '@/lib/training/standaloneDeload';
import { resetClock, setClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';

jest.mock('@/lib/training/standaloneDeload', () => ({
  ...jest.requireActual('@/lib/training/standaloneDeload'),
  recordStandaloneDeloadIfTriggered: jest.fn().mockResolvedValue(false),
}));

type Row = Record<string, unknown>;

/**
 * Minimal chainable stub covering the tables this runner touches:
 * joint_pain_events (read), weekly_fatigue_logs (find + insert/update).
 */
function stubClient(opts: { failFatigueInsert?: boolean; existingLogId?: string } = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{
    table: string;
    row: Row;
    filters: Array<[op: string, column: string, value: unknown]>;
  }> = [];
  const client = {
    from(table: string) {
      // Filters recorded after an update() are attributed to that update.
      let activeUpdate: (typeof updates)[number] | null = null;
      const filter =
        (op: string) =>
        // Chain-anything builder; typed loosely on purpose.
        // eslint-disable-next-line
        (column: string, value: unknown): any => {
          activeUpdate?.filters.push([op, column, value]);
          return builder;
        };
      // eslint-disable-next-line
      const builder: any = {
        select: () => builder,
        eq: filter('eq'),
        is: filter('is'),
        gte: filter('gte'),
        lte: filter('lte'),
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            table === 'weekly_fatigue_logs' && opts.existingLogId
              ? { id: opts.existingLogId }
              : null,
          error: null,
        }),
        insert: async (row: Row) => {
          inserts.push({ table, row });
          return opts.failFatigueInsert && table === 'weekly_fatigue_logs'
            ? { error: { message: 'insert failed' } }
            : { error: null };
        },
        update: (row: Row) => {
          activeUpdate = { table, row, filters: [] };
          updates.push(activeUpdate);
          return builder;
        },
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
  };
  return { client: client as never, inserts, updates };
}

const INPUT = {
  userId: 'u1',
  sessionRpe: 8,
  checkIn: { readinessScore: 70, sleepQuality: 4 as const, stressLevel: 2 as const },
};

describe('runPostSessionStandaloneUpdates', () => {
  beforeEach(() => {
    setClock(createTestClock('2026-08-15T18:00:00'));
    (recordStandaloneDeloadIfTriggered as jest.Mock).mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    resetClock();
    jest.restoreAllMocks();
  });

  it('writes the fatigue log with a NULL mesocycle and the epoch week, then runs the check', async () => {
    const { client, inserts } = stubClient();

    await expect(runPostSessionStandaloneUpdates(client, INPUT)).resolves.toEqual({ ok: true });

    const log = inserts.find((i) => i.table === 'weekly_fatigue_logs');
    expect(log).toBeDefined();
    expect(log!.row).toMatchObject({
      user_id: 'u1',
      mesocycle_id: null,
      week_number: standaloneWeekNumber(),
    });
    expect(recordStandaloneDeloadIfTriggered).toHaveBeenCalledWith(client, 'u1');
  });

  it('updates the existing row for the week instead of inserting a duplicate', async () => {
    const { client, inserts, updates } = stubClient({ existingLogId: 'log-1' });

    await expect(runPostSessionStandaloneUpdates(client, INPUT)).resolves.toEqual({ ok: true });

    expect(inserts.find((i) => i.table === 'weekly_fatigue_logs')).toBeUndefined();
    expect(updates.find((u) => u.table === 'weekly_fatigue_logs')).toBeDefined();
  });

  it('stamps loggedAt on the row and guards the update so an older retry cannot overwrite', async () => {
    const loggedAt = '2026-08-15T18:30:00.000Z';
    const { client, updates } = stubClient({ existingLogId: 'log-1' });

    await expect(
      runPostSessionStandaloneUpdates(client, { ...INPUT, loggedAt })
    ).resolves.toEqual({ ok: true });

    const update = updates.find((u) => u.table === 'weekly_fatigue_logs')!;
    expect(update.row).toMatchObject({ logged_at: loggedAt });
    // Advance-only: the update matches only rows at/before this session's
    // timestamp, so a newer session's data survives a stale retry.
    expect(update.filters).toContainEqual(['lte', 'logged_at', loggedAt]);
  });

  it('reports ok:false when the fatigue log write fails', async () => {
    const { client } = stubClient({ failFatigueInsert: true });
    await expect(runPostSessionStandaloneUpdates(client, INPUT)).resolves.toEqual({ ok: false });
  });

  it('reports ok:false when the deload check throws, without throwing', async () => {
    (recordStandaloneDeloadIfTriggered as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const { client } = stubClient();
    await expect(runPostSessionStandaloneUpdates(client, INPUT)).resolves.toEqual({ ok: false });
  });
});
