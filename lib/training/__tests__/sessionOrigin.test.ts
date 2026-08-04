import { insertWorkoutSessions } from '@/lib/training/sessionOrigin';
import type { SupabaseClient } from '@supabase/supabase-js';

interface InsertCall {
  rows: Record<string, unknown>[];
}

/**
 * Fake Supabase whose first insert fails with `firstError` and whose second
 * (retry) succeeds. Records every insert's rows so we can assert which columns
 * were stripped on the retry.
 */
function fakeSupabase(firstError: { code?: string; message?: string } | null) {
  const inserts: InsertCall[] = [];
  let attempt = 0;
  const client = {
    from() {
      return {
        insert(rows: Record<string, unknown>[]) {
          inserts.push({ rows });
          attempt++;
          const error = attempt === 1 ? firstError : null;
          return {
            select() {
              return Promise.resolve({
                data: error ? null : [{ id: 'sess-1' }],
                error,
              });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, inserts };
}

const ROW = {
  user_id: 'u1',
  planned_date: '2026-07-11',
  origin: 'empty' as const,
  location_id: 'gymA',
};

describe('insertWorkoutSessions — migration-gated column stripping', () => {
  it('keeps origin + location_id when the columns exist', async () => {
    const { client, inserts } = fakeSupabase(null);
    const { data, error } = await insertWorkoutSessions(client, [ROW]);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'sess-1' }]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].rows[0]).toMatchObject({ origin: 'empty', location_id: 'gymA' });
  });

  it.each([
    ['undefined column (Postgres)', '42703'],
    ['schema cache miss (PostgREST)', 'PGRST204'],
  ])('retries without origin + location_id on %s', async (_label, code) => {
    const { client, inserts } = fakeSupabase({ code });
    const { data, error } = await insertWorkoutSessions(client, [ROW]);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'sess-1' }]);
    expect(inserts).toHaveLength(2);
    // Retry row keeps the core columns but drops the migration-gated ones.
    expect(inserts[1].rows[0]).toMatchObject({ user_id: 'u1', planned_date: '2026-07-11' });
    expect(inserts[1].rows[0]).not.toHaveProperty('origin');
    expect(inserts[1].rows[0]).not.toHaveProperty('location_id');
  });

  it('downgrades an origin the check constraint rejects (pre-widening database)', async () => {
    const { client, inserts } = fakeSupabase({
      code: '23514',
      message: 'new row violates check constraint "workout_sessions_origin_check"',
    });
    const { data, error } = await insertWorkoutSessions(client, [
      { ...ROW, origin: 'template' as const },
    ]);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'sess-1' }]);
    expect(inserts).toHaveLength(2);
    // Retried as the closest legacy bucket, keeping the rest of the row.
    expect(inserts[1].rows[0]).toMatchObject({ origin: 'empty', location_id: 'gymA' });
  });

  it('does not retry a check violation from an unrelated constraint', async () => {
    const { client, inserts } = fakeSupabase({
      code: '23514',
      message: 'new row violates check constraint "workout_sessions_completion_percent_check"',
    });
    const { error } = await insertWorkoutSessions(client, [ROW]);

    expect((error as { code?: string }).code).toBe('23514');
    expect(inserts).toHaveLength(1);
  });

  it('does not retry on an unrelated error (RLS, network, …)', async () => {
    const { client, inserts } = fakeSupabase({ code: '42501' }); // insufficient_privilege
    const { error } = await insertWorkoutSessions(client, [ROW]);

    expect((error as { code?: string }).code).toBe('42501');
    expect(inserts).toHaveLength(1);
  });
});
