/**
 * Changing where a workout is being logged, mid-session.
 *
 * The behavior these tests pin down is the re-stamp: moving a session or an
 * exercise onto a different location has to carry the sets already logged
 * under the old one with it. A change that only moved future sets would split
 * one session's work across two calibration tracks — the exact conflation the
 * location key exists to prevent, arrived at by a control meant to fix it.
 */
import {
  resolveDefaultLocationId,
  updateBlockLocation,
  updateSessionLocation,
} from '../sessionLocation';

interface Call {
  table: string;
  method: 'select' | 'update';
  payload?: unknown;
  filters: Record<string, unknown>;
}

/**
 * Chainable Supabase stub. `responder` decides each chain's result from the
 * recorded query, so a test can make one table fail (missing column) while the
 * rest succeed.
 */
function createSupabaseStub(
  responder: (call: Call) => { data?: unknown; error?: unknown }
) {
  const calls: Call[] = [];

  function makeBuilder(table: string) {
    const call: Call = { table, method: 'select', filters: {} };
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
      order: () => builder,
      limit: () => builder,
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    return builder;
  }

  return {
    supabase: { from: (table: string) => makeBuilder(table) } as any,
    calls,
  };
}

const MISSING_COLUMN = { code: 'PGRST204', message: 'column not found in schema cache' };

describe('updateSessionLocation', () => {
  it('moves the session and re-stamps the sets logged under the old location', async () => {
    const { supabase, calls } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [{ id: 's1' }, { id: 's2' }] } : { data: null }
    );

    const result = await updateSessionLocation(supabase, 'session-1', 'loc-annex', [
      'block-1',
      'block-2',
    ]);

    expect(result).toEqual({ ok: true, restampedSets: 2, unsupported: false });

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

    const result = await updateSessionLocation(supabase, 'session-1', 'loc-annex', []);

    expect(result.restampedSets).toBe(0);
    expect(calls.some((c) => c.table === 'set_logs')).toBe(false);
  });

  it('reports unsupported (not failure) on a database without the column', async () => {
    const { supabase } = createSupabaseStub(() => ({ error: MISSING_COLUMN }));

    const result = await updateSessionLocation(supabase, 'session-1', 'loc-a', ['block-1']);

    expect(result.unsupported).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('reports failure on a real write error', async () => {
    const { supabase } = createSupabaseStub(() => ({
      error: { code: '23503', message: 'foreign key violation' },
    }));

    const result = await updateSessionLocation(supabase, 'session-1', 'loc-a', ['block-1']);

    expect(result.ok).toBe(false);
  });
});

describe('updateBlockLocation', () => {
  it('pins one exercise and re-stamps only that exercise’s sets', async () => {
    const { supabase, calls } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] } : { data: null }
    );

    const result = await updateBlockLocation(supabase, 'block-7', 'loc-annex', 'loc-annex');

    expect(result).toEqual({ ok: true, restampedSets: 3, unsupported: false });

    const blockWrite = calls.find((c) => c.table === 'exercise_blocks');
    expect(blockWrite?.payload).toEqual({ location_id: 'loc-annex' });
    expect(blockWrite?.filters).toEqual({ id: 'block-7' });

    const setWrite = calls.find((c) => c.table === 'set_logs');
    expect(setWrite?.filters).toEqual({ exercise_block_id: ['block-7'] });
  });

  it('clearing the pin re-stamps sets back onto the session location', async () => {
    // "Same as workout": the override column goes null, but the SETS must
    // carry the session's location — null there would mean "unknown gym".
    const { supabase, calls } = createSupabaseStub((call) =>
      call.table === 'set_logs' ? { data: [{ id: 's1' }] } : { data: null }
    );

    await updateBlockLocation(supabase, 'block-7', null, 'loc-main');

    expect(calls.find((c) => c.table === 'exercise_blocks')?.payload).toEqual({
      location_id: null,
    });
    expect(calls.find((c) => c.table === 'set_logs')?.payload).toEqual({
      location_id: 'loc-main',
    });
  });
});

describe('resolveDefaultLocationId', () => {
  it('returns the most recently used location', async () => {
    const { supabase } = createSupabaseStub(() => ({ data: [{ id: 'loc-recent' }] }));

    await expect(resolveDefaultLocationId(supabase, 'user-1')).resolves.toBe('loc-recent');
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
    const broken = { from: () => { throw new Error('no such table'); } } as any;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(resolveDefaultLocationId(broken, 'user-1')).resolves.toBeNull();

    warn.mockRestore();
  });
});
