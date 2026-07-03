import {
  isStaleEmptyAdhocSession,
  discardStaleSession,
  STALE_ADHOC_AGE_MS,
} from '../adhocSession';

describe('isStaleEmptyAdhocSession — stale ad-hoc auto-discard guard (P0-1)', () => {
  const NOW = 1_700_000_000_000;
  const old = new Date(NOW - STALE_ADHOC_AGE_MS - 60_000).toISOString(); // 4h1m ago
  const fresh = new Date(NOW - 60_000).toISOString(); // 1m ago
  const base = { state: 'in_progress', mesocycleId: null as string | null, startedAt: old };

  it('fires only when ALL of: in_progress + ad-hoc + 0 blocks + 0 sets + >4h', () => {
    expect(isStaleEmptyAdhocSession(base, 0, 0, NOW)).toBe(true);
  });

  it('does NOT fire with any exercise blocks present', () => {
    expect(isStaleEmptyAdhocSession(base, 1, 0, NOW)).toBe(false);
  });

  it('does NOT fire with any logged sets present', () => {
    expect(isStaleEmptyAdhocSession(base, 0, 1, NOW)).toBe(false);
  });

  it('does NOT fire when younger than 4h', () => {
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: fresh }, 0, 0, NOW)).toBe(false);
  });

  it('does NOT fire for mesocycle (programmed) sessions', () => {
    expect(isStaleEmptyAdhocSession({ ...base, mesocycleId: 'meso-1' }, 0, 0, NOW)).toBe(false);
  });

  it.each(['planned', 'completed', 'skipped', 'auto_discarded'])('does NOT fire when state is %s', (state) => {
    expect(isStaleEmptyAdhocSession({ ...base, state }, 0, 0, NOW)).toBe(false);
  });

  it('does NOT fire when startedAt is null (never started)', () => {
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: null }, 0, 0, NOW)).toBe(false);
  });

  it('boundary: exactly 4h old does NOT fire (strictly greater-than)', () => {
    const exactly = new Date(NOW - STALE_ADHOC_AGE_MS).toISOString();
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: exactly }, 0, 0, NOW)).toBe(false);
  });

  it('boundary: one ms past 4h fires', () => {
    const justPast = new Date(NOW - STALE_ADHOC_AGE_MS - 1).toISOString();
    expect(isStaleEmptyAdhocSession({ ...base, startedAt: justPast }, 0, 0, NOW)).toBe(true);
  });
});

describe('discardStaleSession — soft delete with pre-migration fallback', () => {
  type Call = { table: string; op: 'update' | 'delete'; values?: Record<string, unknown>; id?: string };

  function fakeSupabase(opts: {
    updateError?: { code?: string; message?: string } | null;
    deleteError?: { code?: string; message?: string } | null;
  }) {
    const calls: Call[] = [];
    const client = {
      from: (table: string) => ({
        update: (values: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            calls.push({ table, op: 'update', values, id });
            return { error: opts.updateError ?? null };
          },
        }),
        delete: () => ({
          eq: async (_col: string, id: string) => {
            calls.push({ table, op: 'delete', id });
            return { error: opts.deleteError ?? null };
          },
        }),
      }),
    };
    // Structural stand-in for the untyped Supabase client
    return { client: client as never, calls };
  }

  it('archives (update to auto_discarded) and does NOT delete when the migration is applied', async () => {
    const { client, calls } = fakeSupabase({});

    await expect(discardStaleSession(client, 'sess-1')).resolves.toBe('archived');

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('update');
    expect(calls[0].id).toBe('sess-1');
    expect(calls[0].values).toMatchObject({ state: 'auto_discarded' });
    expect(typeof calls[0].values?.auto_discarded_at).toBe('string');
  });

  it.each([
    ['enum value missing', '22P02'],
    ['column missing', '42703'],
  ])('falls back to hard delete pre-migration (%s, code %s)', async (_label, code) => {
    const { client, calls } = fakeSupabase({ updateError: { code } });

    await expect(discardStaleSession(client, 'sess-1')).resolves.toBe('deleted');

    expect(calls.map((c) => c.op)).toEqual(['update', 'delete']);
    expect(calls[1].id).toBe('sess-1');
  });

  it('does NOT delete on an unrelated update error (network, RLS, …)', async () => {
    const { client, calls } = fakeSupabase({ updateError: { code: '57014', message: 'timeout' } });

    await expect(discardStaleSession(client, 'sess-1')).resolves.toBe('failed');

    expect(calls.map((c) => c.op)).toEqual(['update']);
  });

  it('reports failure when the fallback delete also fails', async () => {
    const { client } = fakeSupabase({
      updateError: { code: '42703' },
      deleteError: { code: '57014' },
    });

    await expect(discardStaleSession(client, 'sess-1')).resolves.toBe('failed');
  });
});
