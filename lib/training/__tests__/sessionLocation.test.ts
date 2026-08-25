/**
 * Changing where a workout is being logged, mid-session.
 *
 * The behavior these tests pin down is that a move is all-or-nothing. Moving a
 * session or an exercise has to carry the sets already logged under the old
 * location with it — including the ones still queued offline — and when it
 * can't, it has to leave the database where it started. A half-applied move
 * splits one session across two calibration tracks, which is the exact
 * conflation the location key exists to prevent, arrived at via the control
 * meant to fix it.
 */
import {
  resolveDefaultLocationId,
  updateBlockLocation,
  updateSessionLocation,
} from '../sessionLocation';
import { __setDriverForTests, createMemoryStore, enqueueSetInsert } from '@/lib/offline/setOutbox';
import type { OutboxEntry } from '@/lib/offline/setOutbox';

interface Call {
  table: string;
  method: 'select' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
  order: string[];
}

/**
 * Chainable Supabase stub. `responder` decides each chain's result from the
 * recorded query, so a test can make one table fail while the rest succeed.
 */
function createSupabaseStub(responder: (call: Call) => { data?: unknown; error?: unknown }) {
  const calls: Call[] = [];

  function makeBuilder(table: string) {
    const call: Call = { table, method: 'select', filters: {}, order: [] };
    let settled = false;
    const resolve = () => {
      if (!settled) {
        settled = true;
        calls.push(call);
      }
      return Promise.resolve(responder(call));
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (payload: unknown) => {
        call.method = 'update';
        call.payload = payload;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        call.filters[col] = val;
        return builder;
      },
      in: (col: string, vals: unknown) => {
        call.filters[col] = vals;
        return builder;
      },
      order: (col: string) => {
        call.order.push(col);
        return builder;
      },
      limit: () => builder,
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    return builder;
  }

  return {
    supabase: { from: (table: string) => makeBuilder(table) } as never,
    calls,
  };
}

const MISSING_COLUMN = { code: 'PGRST204', message: 'column not found in schema cache' };
const WRITE_FAILED = { code: '08006', message: 'connection failure' };

/** Fail only the set_logs re-stamp; the owning row's update succeeds. */
const restampFails = (call: Call) =>
  call.table === 'set_logs' ? { error: WRITE_FAILED } : { data: null };

let outbox: ReturnType<typeof createMemoryStore<OutboxEntry>>;

beforeEach(() => {
  outbox = createMemoryStore<OutboxEntry>();
  __setDriverForTests(outbox);
});

afterEach(() => {
  __setDriverForTests(null);
  jest.restoreAllMocks();
});

/** The location a queued (not-yet-inserted) set would write when it flushes. */
async function queuedLocation(setId: string): Promise<unknown> {
  const entry = await outbox.get(setId);
  return entry?.row.location_id;
}

describe('updateSessionLocation', () => {
  const base = {
    sessionId: 'session-1',
    locationId: 'loc-annex',
    previousLocationId: 'loc-main',
    blockIdsToRestamp: ['block-1', 'block-2'],
  };

  it('moves the session and re-stamps the sets logged under the old location', async () => {
    const { supabase, calls } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [{ id: 's1' }, { id: 's2' }] } : { data: null }
    );

    const result = await updateSessionLocation(supabase, base);

    expect(result).toEqual({
      ok: true,
      restampedSets: 2,
      unsupported: false,
      rolledBack: false,
    });

    const sessionWrite = calls.find((c) => c.table === 'workout_sessions');
    expect(sessionWrite?.payload).toEqual({ location_id: 'loc-annex' });
    expect(sessionWrite?.filters).toEqual({ id: 'session-1' });

    const setWrite = calls.find((c) => c.table === 'set_logs');
    expect(setWrite?.payload).toEqual({ location_id: 'loc-annex' });
    expect(setWrite?.filters).toEqual({ exercise_block_id: ['block-1', 'block-2'] });
  });

  it('skips the set re-stamp when no block follows the session', async () => {
    // Every block is pinned to its own machine, so there is nothing that
    // follows the session location and nothing to move.
    const { supabase, calls } = createSupabaseStub(() => ({ data: null }));

    const result = await updateSessionLocation(supabase, { ...base, blockIdsToRestamp: [] });

    expect(result.restampedSets).toBe(0);
    expect(calls.some((c) => c.table === 'set_logs')).toBe(false);
  });

  it('reports unsupported (not failure) on a database without the column', async () => {
    const { supabase } = createSupabaseStub(() => ({ error: MISSING_COLUMN }));

    const result = await updateSessionLocation(supabase, base);

    expect(result.unsupported).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('puts the session back when the set re-stamp fails', async () => {
    // Without the compensating write the session would claim the new gym
    // while its sets stayed on the old one — a split produced by the control
    // meant to prevent splits.
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase, calls } = createSupabaseStub(restampFails);

    const result = await updateSessionLocation(supabase, base);

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);

    const sessionWrites = calls.filter((c) => c.table === 'workout_sessions');
    expect(sessionWrites).toHaveLength(2);
    expect(sessionWrites[1].payload).toEqual({ location_id: 'loc-main' });
  });

  it('flags an unrecoverable split when the rollback also fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let sessionWrites = 0;
    const { supabase } = createSupabaseStub((call) => {
      if (call.table === 'set_logs') return { error: WRITE_FAILED };
      sessionWrites += 1;
      // The move landed; the compensating write did not.
      return sessionWrites === 1 ? { data: null } : { error: WRITE_FAILED };
    });

    const result = await updateSessionLocation(supabase, base);

    expect(result.ok).toBe(false);
    // The caller must say the session is split, not "please try again".
    expect(result.rolledBack).toBe(false);
  });
});

describe('updateBlockLocation', () => {
  const base = {
    blockId: 'block-7',
    locationId: 'loc-annex',
    previousLocationId: null,
    effectiveLocationId: 'loc-annex',
    previousEffectiveLocationId: 'loc-main',
  };

  it('pins one exercise and re-stamps only that exercise’s sets', async () => {
    const { supabase, calls } = createSupabaseStub((call) =>
      call.table === 'set_logs'
        ? { data: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] }
        : { data: null }
    );

    const result = await updateBlockLocation(supabase, base);

    expect(result).toEqual({
      ok: true,
      restampedSets: 3,
      unsupported: false,
      rolledBack: false,
    });

    const blockWrite = calls.find((c) => c.table === 'exercise_blocks');
    expect(blockWrite?.payload).toEqual({ location_id: 'loc-annex' });
    expect(blockWrite?.filters).toEqual({ id: 'block-7' });
    expect(calls.find((c) => c.table === 'set_logs')?.filters).toEqual({
      exercise_block_id: ['block-7'],
    });
  });

  it('clearing the pin re-stamps sets back onto the session location', async () => {
    // "Same as workout": the override column goes null, but the SETS must
    // carry the session's location — null there would mean "unknown gym".
    const { supabase, calls } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [{ id: 's1' }] } : { data: null }
    );

    await updateBlockLocation(supabase, {
      blockId: 'block-7',
      locationId: null,
      previousLocationId: 'loc-annex',
      effectiveLocationId: 'loc-main',
      previousEffectiveLocationId: 'loc-annex',
    });

    expect(calls.find((c) => c.table === 'exercise_blocks')?.payload).toEqual({
      location_id: null,
    });
    expect(calls.find((c) => c.table === 'set_logs')?.payload).toEqual({
      location_id: 'loc-main',
    });
  });

  it('puts the pin back when the set re-stamp fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase, calls } = createSupabaseStub(restampFails);

    const result = await updateBlockLocation(supabase, { ...base, previousLocationId: 'loc-old' });

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    const blockWrites = calls.filter((c) => c.table === 'exercise_blocks');
    expect(blockWrites).toHaveLength(2);
    expect(blockWrites[1].payload).toEqual({ location_id: 'loc-old' });
  });
});

describe('queued (offline) sets follow the move', () => {
  it('re-stamps a set still waiting in the outbox', async () => {
    // A database-only re-stamp can't reach this row — it doesn't exist yet —
    // so without patching the queue it would flush onto the old track.
    await enqueueSetInsert('set-queued', {
      id: 'set-queued',
      exercise_block_id: 'block-1',
      location_id: 'loc-main',
    });
    const { supabase } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [] } : { data: null }
    );

    const result = await updateSessionLocation(supabase, {
      sessionId: 'session-1',
      locationId: 'loc-annex',
      previousLocationId: 'loc-main',
      blockIdsToRestamp: ['block-1'],
    });

    await expect(queuedLocation('set-queued')).resolves.toBe('loc-annex');
    // A queued set is a logged set from the user's side, so it counts.
    expect(result.restampedSets).toBe(1);
  });

  it('leaves queued sets belonging to other blocks alone', async () => {
    await enqueueSetInsert('set-other', {
      id: 'set-other',
      exercise_block_id: 'block-99',
      location_id: 'loc-main',
    });
    const { supabase } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [] } : { data: null }
    );

    await updateSessionLocation(supabase, {
      sessionId: 'session-1',
      locationId: 'loc-annex',
      previousLocationId: 'loc-main',
      blockIdsToRestamp: ['block-1'],
    });

    await expect(queuedLocation('set-other')).resolves.toBe('loc-main');
  });

  it('rolls the queue back when the move fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await enqueueSetInsert('set-queued', {
      id: 'set-queued',
      exercise_block_id: 'block-1',
      location_id: 'loc-main',
    });
    const { supabase } = createSupabaseStub(restampFails);

    await updateSessionLocation(supabase, {
      sessionId: 'session-1',
      locationId: 'loc-annex',
      previousLocationId: 'loc-main',
      blockIdsToRestamp: ['block-1'],
    });

    // The database is back where it started; the queue must match it.
    await expect(queuedLocation('set-queued')).resolves.toBe('loc-main');
  });
});

describe('resolveDefaultLocationId', () => {
  it('returns the most recently used location', async () => {
    const { supabase } = createSupabaseStub(() => ({ data: [{ id: 'loc-recent' }] }));

    await expect(resolveDefaultLocationId(supabase, 'user-1')).resolves.toBe('loc-recent');
  });

  it('breaks the all-NULL last_used_at tie on is_default, then created_at', async () => {
    // last_used_at is written from one place only, so for most users every row
    // is NULL. Ordering on it alone would hand the winner to unspecified row
    // order and start a scheduled workout at an arbitrary gym.
    const { supabase, calls } = createSupabaseStub(() => ({ data: [{ id: 'loc-default' }] }));

    await resolveDefaultLocationId(supabase, 'user-1');

    expect(calls[0].order).toEqual(['last_used_at', 'is_default', 'created_at']);
  });

  it('returns null when the user has no locations', async () => {
    const { supabase } = createSupabaseStub(() => ({ data: [] }));

    await expect(resolveDefaultLocationId(supabase, 'user-1')).resolves.toBeNull();
  });

  it('falls back to the default flag before the last_used_at migration', async () => {
    let firstCall = true;
    const { supabase } = createSupabaseStub(() => {
      if (firstCall) {
        firstCall = false;
        return { error: MISSING_COLUMN };
      }
      return { data: [{ id: 'loc-default' }] };
    });

    await expect(resolveDefaultLocationId(supabase, 'user-1')).resolves.toBe('loc-default');
  });

  it('never throws — starting a workout cannot hinge on optional metadata', async () => {
    const broken = {
      from: () => {
        throw new Error('no such table');
      },
    } as never;
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(resolveDefaultLocationId(broken, 'user-1')).resolves.toBeNull();
  });
});
