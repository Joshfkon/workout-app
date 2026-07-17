import { cancelWorkoutSession } from '../cancelWorkout';

interface RecordedCall {
  table: string;
  op: 'delete' | 'update';
  method: 'eq' | 'in';
  column: string;
  value: unknown;
  payload?: unknown;
}

/**
 * Minimal chainable mock of the untyped supabase client covering the query
 * shapes cancelWorkoutSession uses: from().delete().eq/.in and
 * from().update().eq, each followed by .abortSignal(). Records every terminal
 * call in order.
 */
function createMockClient(failTables: Set<string> = new Set()) {
  const calls: RecordedCall[] = [];

  const resultFor = (table: string) =>
    failTables.has(table)
      ? { error: { message: `${table} write failed` } }
      : { error: null };

  const terminal = (table: string) => {
    const promise = Promise.resolve(resultFor(table));
    return {
      abortSignal: () => promise,
      then: promise.then.bind(promise),
    };
  };

  const client = {
    from(table: string) {
      return {
        delete() {
          return {
            eq(column: string, value: unknown) {
              calls.push({ table, op: 'delete', method: 'eq', column, value });
              return terminal(table);
            },
            in(column: string, value: unknown) {
              calls.push({ table, op: 'delete', method: 'in', column, value });
              return terminal(table);
            },
          };
        },
        update(payload: unknown) {
          return {
            eq(column: string, value: unknown) {
              calls.push({ table, op: 'update', method: 'eq', column, value, payload });
              return terminal(table);
            },
          };
        },
      };
    },
  };

  return { client: client as any, calls };
}

/**
 * Overlay a mock client so one table's terminal op behaves differently
 * (hangs, rejects, ...). The op receives the abort signal so tests can
 * assert the timeout actually aborts the in-flight request.
 */
function withTableOp(
  base: { from: (table: string) => any },
  table: string,
  makeOp: (signal: AbortSignal) => Promise<{ error: { message: string } | null }>
) {
  const signals: AbortSignal[] = [];
  const op = {
    abortSignal(signal: AbortSignal) {
      signals.push(signal);
      return makeOp(signal);
    },
  };
  const client = {
    from(t: string) {
      if (t !== table) return base.from(t);
      return {
        delete: () => ({ eq: () => op, in: () => op }),
        update: () => ({ eq: () => op }),
      };
    },
  };
  return { client: client as any, signals };
}

describe('cancelWorkoutSession', () => {
  const sessionId = 'session-1';
  const blockIds = ['block-1', 'block-2'];

  it('discards an ad-hoc session: calibrations, set logs, blocks, then the session', async () => {
    const { client, calls } = createMockClient();

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: null,
      blockIds,
    });

    expect(result).toEqual({ ok: true, errors: [] });
    expect(calls).toEqual([
      {
        table: 'amrap_calibrations',
        op: 'delete',
        method: 'eq',
        column: 'workout_session_id',
        value: sessionId,
      },
      {
        table: 'set_logs',
        op: 'delete',
        method: 'in',
        column: 'exercise_block_id',
        value: blockIds,
      },
      { table: 'exercise_blocks', op: 'delete', method: 'in', column: 'id', value: blockIds },
      { table: 'workout_sessions', op: 'delete', method: 'eq', column: 'id', value: sessionId },
    ]);
  });

  it('deletes amrap_calibrations BEFORE the session row (SET NULL FKs would orphan them)', async () => {
    const { client, calls } = createMockClient();

    await cancelWorkoutSession(client, { sessionId, mesocycleId: null, blockIds });

    const calibrationIdx = calls.findIndex((c) => c.table === 'amrap_calibrations');
    const sessionDeleteIdx = calls.findIndex(
      (c) => c.table === 'workout_sessions' && c.op === 'delete'
    );
    const setLogDeleteIdx = calls.findIndex((c) => c.table === 'set_logs');
    expect(calibrationIdx).toBeGreaterThanOrEqual(0);
    expect(calibrationIdx).toBeLessThan(sessionDeleteIdx);
    expect(calibrationIdx).toBeLessThan(setLogDeleteIdx);
  });

  it('resets a mesocycle session to planned, keeping blocks but removing calibrations and set logs', async () => {
    const { client, calls } = createMockClient();

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: 'meso-1',
      blockIds,
    });

    expect(result).toEqual({ ok: true, errors: [] });
    expect(calls).toEqual([
      {
        table: 'amrap_calibrations',
        op: 'delete',
        method: 'eq',
        column: 'workout_session_id',
        value: sessionId,
      },
      {
        table: 'set_logs',
        op: 'delete',
        method: 'in',
        column: 'exercise_block_id',
        value: blockIds,
      },
      {
        table: 'workout_sessions',
        op: 'update',
        method: 'eq',
        column: 'id',
        value: sessionId,
        payload: { state: 'planned', started_at: null, pre_workout_check_in: null },
      },
    ]);
  });

  it('still deletes calibrations and the session when there are no blocks', async () => {
    const { client, calls } = createMockClient();

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: null,
      blockIds: [],
    });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.table)).toEqual(['amrap_calibrations', 'workout_sessions']);
  });

  it('ad-hoc: surfaces write errors without aborting the remaining teardown', async () => {
    const { client, calls } = createMockClient(new Set(['amrap_calibrations']));

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: null,
      blockIds,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['amrap_calibrations write failed']);
    // The session delete still ran — an ad-hoc restart gets fresh ids, so
    // finishing the teardown can't endanger a future workout's rows.
    expect(
      calls.some((c) => c.table === 'workout_sessions' && c.op === 'delete')
    ).toBe(true);
  });

  it('mesocycle: does NOT reset the session to planned when a delete failed', async () => {
    // The session keeps its id and blocks across the reset. If the set_logs
    // delete failed (e.g. timed out), resetting to planned would invite a
    // restart whose new sets a late-landing delete could destroy — so the
    // reset must be skipped and the failure surfaced instead.
    const { client, calls } = createMockClient(new Set(['set_logs']));

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: 'meso-1',
      blockIds,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['set_logs write failed']);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('times out a hanging operation, aborting the in-flight request', async () => {
    // A dead radio / hung proxy: the set_logs delete never settles on its
    // own. Without the per-op timeout the returned promise stays pending and
    // the calling UI is wedged on "Discarding..." with its buttons disabled.
    const base = createMockClient();
    const { client, signals } = withTableOp(
      base.client,
      'set_logs',
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );

    const result = await cancelWorkoutSession(
      client,
      { sessionId, mesocycleId: null, blockIds },
      { timeoutMs: 20 }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['request timed out after 20ms']);
    // The timeout must actually cancel the request, not just abandon it — an
    // un-aborted delete could land long after the discard flow moved on.
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    // Ad-hoc teardown still completed after the timeout.
    expect(
      base.calls.some((c) => c.table === 'workout_sessions' && c.op === 'delete')
    ).toBe(true);
  });

  it('settles via the backstop even if the operation ignores the abort signal', async () => {
    const base = createMockClient();
    const { client } = withTableOp(
      base.client,
      'set_logs',
      () => new Promise(() => {}) // never settles, ignores abort
    );

    const result = await cancelWorkoutSession(
      client,
      { sessionId, mesocycleId: null, blockIds },
      { timeoutMs: 20 }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['request timed out after 20ms']);
  });

  it('converts a rejected operation into an error result instead of throwing', async () => {
    const base = createMockClient();
    const { client } = withTableOp(base.client, 'amrap_calibrations', () =>
      Promise.reject(new Error('fetch failed'))
    );

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: null,
      blockIds,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['fetch failed']);
    expect(
      base.calls.some((c) => c.table === 'workout_sessions' && c.op === 'delete')
    ).toBe(true);
  });
});
