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
 * from().update().eq. Records every terminal call in order.
 */
function createMockClient(failTables: Set<string> = new Set()) {
  const calls: RecordedCall[] = [];

  const resultFor = (table: string) =>
    failTables.has(table)
      ? { error: { message: `${table} write failed` } }
      : { error: null };

  const client = {
    from(table: string) {
      return {
        delete() {
          return {
            eq(column: string, value: unknown) {
              calls.push({ table, op: 'delete', method: 'eq', column, value });
              return Promise.resolve(resultFor(table));
            },
            in(column: string, value: unknown) {
              calls.push({ table, op: 'delete', method: 'in', column, value });
              return Promise.resolve(resultFor(table));
            },
          };
        },
        update(payload: unknown) {
          return {
            eq(column: string, value: unknown) {
              calls.push({ table, op: 'update', method: 'eq', column, value, payload });
              return Promise.resolve(resultFor(table));
            },
          };
        },
      };
    },
  };

  return { client: client as any, calls };
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

  it('surfaces write errors without aborting the remaining cleanup', async () => {
    const { client, calls } = createMockClient(new Set(['amrap_calibrations']));

    const result = await cancelWorkoutSession(client, {
      sessionId,
      mesocycleId: null,
      blockIds,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['amrap_calibrations write failed']);
    // The session delete still ran.
    expect(
      calls.some((c) => c.table === 'workout_sessions' && c.op === 'delete')
    ).toBe(true);
  });

  it('times out an operation that never settles instead of hanging forever', async () => {
    // A dead radio / hung proxy: the set_logs delete never resolves. Without
    // the per-op timeout the returned promise stays pending and the calling
    // UI is wedged on "Discarding..." with its buttons disabled.
    const { client, calls } = createMockClient();
    const base = client as { from: (table: string) => unknown };
    const hangingClient = {
      from(table: string) {
        if (table === 'set_logs') {
          return {
            delete: () => ({
              in: () => new Promise(() => {}), // never settles
            }),
          };
        }
        return base.from(table);
      },
    };

    const result = await cancelWorkoutSession(
      hangingClient as any,
      { sessionId, mesocycleId: null, blockIds },
      { timeoutMs: 20 }
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['request timed out after 20ms']);
    // The remaining cleanup still ran after the timeout.
    expect(
      calls.some((c) => c.table === 'workout_sessions' && c.op === 'delete')
    ).toBe(true);
  });

  it('converts a rejected operation into an error result instead of throwing', async () => {
    const { client, calls } = createMockClient();
    const base = client as { from: (table: string) => unknown };
    const rejectingClient = {
      from(table: string) {
        if (table === 'amrap_calibrations') {
          return {
            delete: () => ({
              eq: () => Promise.reject(new Error('fetch failed')),
            }),
          };
        }
        return base.from(table);
      },
    };

    const result = await cancelWorkoutSession(rejectingClient as any, {
      sessionId,
      mesocycleId: null,
      blockIds,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['fetch failed']);
    expect(
      calls.some((c) => c.table === 'workout_sessions' && c.op === 'delete')
    ).toBe(true);
  });
});
