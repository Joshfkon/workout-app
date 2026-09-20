/**
 * Assigning pre-location history to a gym (the Settings backfill).
 *
 * The counting read must target exactly what the backfill_legacy_location
 * RPC will stamp — null-location rows of COMPLETED sessions only — or the
 * confirm dialog promises a different number than the transaction delivers.
 * And every failure (pre-migration schema, offline, RPC error) must come
 * back as a value the Settings card can render, never a thrown error that
 * takes the whole tab down.
 */
import {
  countLegacyLocationRows,
  runLegacyLocationBackfill,
} from '../legacyLocationBackfill';
import type { SupabaseClient } from '@supabase/supabase-js';

interface RecordedQuery {
  table: string;
  columns: string;
  options: unknown;
  filters: Array<{ op: string; col: string; val: unknown }>;
}

/** Minimal chainable stub for the two head-count queries plus rpc. */
function createStub(opts: {
  countFor?: (q: RecordedQuery) => { count: number | null; error?: unknown };
  rpc?: (fn: string, args: unknown) => { data?: unknown; error?: unknown } | Promise<never>;
}) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  const client = {
    from(table: string) {
      const q: RecordedQuery = { table, columns: '', options: undefined, filters: [] };
      queries.push(q);
      const builder = {
        select(columns: string, options?: unknown) {
          q.columns = columns;
          q.options = options;
          return builder;
        },
        eq(col: string, val: unknown) {
          q.filters.push({ op: 'eq', col, val });
          return builder;
        },
        is(col: string, val: unknown) {
          q.filters.push({ op: 'is', col, val });
          return builder;
        },
        then(resolve: (v: unknown) => unknown) {
          const res = opts.countFor?.(q) ?? { count: 0 };
          return Promise.resolve({
            count: res.error ? null : res.count,
            error: res.error ?? null,
          }).then(resolve);
        },
      };
      return builder;
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      const res = opts.rpc?.(fn, args) ?? { data: null };
      return res instanceof Promise ? res : Promise.resolve(res);
    },
  };

  return { client: client as unknown as SupabaseClient, queries, rpcCalls };
}

describe('countLegacyLocationRows', () => {
  it('counts null-location rows of completed sessions only, scoped to the user', async () => {
    const { client, queries } = createStub({
      countFor: (q) => ({ count: q.table === 'workout_sessions' ? 12 : 340 }),
    });

    const counts = await countLegacyLocationRows(client, 'user-1');

    expect(counts).toEqual({ sessionCount: 12, setCount: 340 });

    const sessions = queries.find((q) => q.table === 'workout_sessions')!;
    expect(sessions.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', col: 'user_id', val: 'user-1' },
        { op: 'eq', col: 'state', val: 'completed' },
        { op: 'is', col: 'location_id', val: null },
      ])
    );

    // The set count must ride the block→session join with the SAME state +
    // user constraints, or the dialog counts sets the RPC won't touch.
    const sets = queries.find((q) => q.table === 'set_logs')!;
    expect(sets.columns).toContain('exercise_blocks!inner');
    expect(sets.filters).toEqual(
      expect.arrayContaining([
        { op: 'is', col: 'location_id', val: null },
        { op: 'eq', col: 'exercise_blocks.workout_sessions.user_id', val: 'user-1' },
        { op: 'eq', col: 'exercise_blocks.workout_sessions.state', val: 'completed' },
      ])
    );
  });

  it('returns null when a query errors (pre-migration database)', async () => {
    const { client } = createStub({
      countFor: (q) =>
        q.table === 'set_logs' ? { count: null, error: { code: '42703' } } : { count: 5 },
    });

    expect(await countLegacyLocationRows(client, 'user-1')).toBeNull();
  });
});

describe('runLegacyLocationBackfill', () => {
  it('invokes the RPC with the location and maps its counts', async () => {
    const { client, rpcCalls } = createStub({
      rpc: () => ({ data: { sessions_stamped: 12, sets_stamped: 340 } }),
    });

    const res = await runLegacyLocationBackfill(client, 'loc-9');

    expect(rpcCalls).toEqual([
      { fn: 'backfill_legacy_location', args: { p_location_id: 'loc-9' } },
    ]);
    expect(res).toEqual({ ok: true, sessionsStamped: 12, setsStamped: 340 });
  });

  it('surfaces an RPC error as a message, not a throw', async () => {
    const { client } = createStub({
      rpc: () => ({ error: { message: 'function backfill_legacy_location does not exist' } }),
    });

    const res = await runLegacyLocationBackfill(client, 'loc-9');
    expect(res).toEqual({
      ok: false,
      message: 'function backfill_legacy_location does not exist',
    });
  });

  it('catches a rejected rpc call', async () => {
    const { client } = createStub({
      rpc: () => Promise.reject(new Error('network down')),
    });

    const res = await runLegacyLocationBackfill(client, 'loc-9');
    expect(res).toEqual({ ok: false, message: 'network down' });
  });
});
