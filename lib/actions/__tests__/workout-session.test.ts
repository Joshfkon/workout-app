/**
 * Regression tests for the discardWorkoutSession server action.
 *
 * The real createUntypedServerClient is ASYNC (it awaits cookies()), and the
 * action originally called it without `await`, handing cancelWorkoutSession a
 * Promise instead of a client. Every discard then threw on `supabase.from`
 * and the resume pill's modal showed "Failed to discard workout" forever.
 * The mock here is async like the real one, so that bug fails these tests.
 */

jest.mock('@/lib/supabase/server', () => ({
  createUntypedServerClient: jest.fn(),
}));

import { discardWorkoutSession } from '@/lib/actions/workout-session';
import { createUntypedServerClient } from '@/lib/supabase/server';

const mockCreateClient = createUntypedServerClient as jest.Mock;

interface RecordedCall {
  table: string;
  op: 'delete' | 'update';
}

/**
 * Terminal query op shaped like a supabase builder: awaitable, and exposing
 * abortSignal() (cancelWorkoutSession's settleWithTimeout requires it).
 */
function makeOp() {
  const result = { error: null };
  return {
    then: (
      onFulfilled?: (v: typeof result) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
    abortSignal: (_signal: AbortSignal) => Promise.resolve(result),
  };
}

function makeFakeClient(calls: RecordedCall[]) {
  return {
    from: (table: string) => ({
      delete: () => ({
        eq: () => {
          calls.push({ table, op: 'delete' });
          return makeOp();
        },
        in: () => {
          calls.push({ table, op: 'delete' });
          return makeOp();
        },
      }),
      update: () => ({
        eq: () => {
          calls.push({ table, op: 'update' });
          return makeOp();
        },
      }),
    }),
  };
}

describe('discardWorkoutSession', () => {
  let calls: RecordedCall[];

  beforeEach(() => {
    calls = [];
    // Async, exactly like the real createUntypedServerClient. A missing
    // `await` in the action makes every test here fail with ok: false.
    mockCreateClient.mockImplementation(async () => makeFakeClient(calls));
  });

  it('deletes an ad-hoc session outright (calibrations, sets, blocks, session)', async () => {
    const result = await discardWorkoutSession('session-1', null, ['block-1']);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { table: 'amrap_calibrations', op: 'delete' },
      { table: 'set_logs', op: 'delete' },
      { table: 'exercise_blocks', op: 'delete' },
      { table: 'workout_sessions', op: 'delete' },
    ]);
  });

  it('resets a mesocycle session back to planned instead of deleting it', async () => {
    const result = await discardWorkoutSession('session-1', 'meso-1', ['block-1']);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { table: 'amrap_calibrations', op: 'delete' },
      { table: 'set_logs', op: 'delete' },
      { table: 'workout_sessions', op: 'update' },
    ]);
  });

  it('returns ok: false with the error message when client creation throws', async () => {
    mockCreateClient.mockImplementation(async () => {
      throw new Error('no cookies outside request scope');
    });

    const result = await discardWorkoutSession('session-1', null, []);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['no cookies outside request scope']);
  });
});
