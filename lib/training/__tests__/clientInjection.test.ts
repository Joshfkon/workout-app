/**
 * The two production paths that used to build their own Supabase client now
 * accept one, so a caller (the finish flow today, a headless simulation
 * tomorrow) can point them at its own database:
 *
 *   - ProgramEngine — reached in production only via
 *     deloadRecommendation.recordDeloadRecommendationIfTriggered →
 *     workoutIntegration.checkShouldDeload → ProgramEngine.checkDeloadTriggers.
 *   - _lib/suggestions.fetchExerciseHistory.
 *
 * The assertion that matters is NOT "a client was used" but "the MODULE
 * SINGLETON was never constructed" — an injected client that silently falls
 * back to the singleton would look fine in every other test and would quietly
 * read the wrong database at runtime. So `createUntypedClient` is mocked to
 * throw: any code path that reaches for the singleton fails loudly here.
 */
import { ProgramEngine } from '@/lib/training/programEngine';
import { checkShouldDeload } from '@/lib/training/workoutIntegration';
import { recordDeloadRecommendationIfTriggered } from '@/lib/training/deloadRecommendation';
import { fetchExerciseHistory } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/suggestions';

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: jest.fn(() => {
    throw new Error('module-singleton Supabase client constructed');
  }),
  createClient: jest.fn(() => {
    throw new Error('module-singleton Supabase client constructed');
  }),
}));

/**
 * A chainable query-builder stub: every method returns the builder, and
 * awaiting it yields `rows`. Shape-agnostic on purpose — the point is to
 * record which tables were touched through THIS client, not to re-implement
 * PostgREST.
 */
function stubClient(rowsByTable: Record<string, unknown[]> = {}) {
  const tables: string[] = [];

  const builder = (table: string): unknown => {
    const rows = rowsByTable[table] ?? [];
    const result = { data: rows.length ? rows : null, error: null, count: rows.length };
    const one = { data: rows[0] ?? null, error: null };

    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          // Symbols (inspection, toPrimitive, async iteration) must not look
          // like builder methods or the promise machinery misbehaves.
          if (typeof prop === 'symbol') return undefined;
          // Thenable, so `await supabase.from(x).select(...)...` resolves.
          if (prop === 'then') {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(result).then(res, rej);
          }
          if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(one);
          // Any other builder method (select/eq/gte/order/limit/in/is/not/…)
          // chains back to the same builder.
          return () => proxy;
        },
      }
    );
    return proxy;
  };

  return {
    tables,
    client: {
      from: (table: string) => {
        tables.push(table);
        return builder(table);
      },
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    } as never,
  };
}

describe('ProgramEngine accepts an injected client', () => {
  it('reads through the supplied client and never builds the singleton', async () => {
    const { client, tables } = stubClient();
    const engine = await ProgramEngine.create('u1', client);

    expect(engine).toBeInstanceOf(ProgramEngine);
    // loadUserData fans out across the engine's four inputs.
    expect(tables).toEqual(expect.arrayContaining(['users', 'dexa_scans']));
  });

  it('constructing without a client still reaches for the singleton', () => {
    // The mirror image: proves the previous test isn't passing because the
    // engine stopped touching Supabase altogether.
    expect(() => new ProgramEngine('u1')).toThrow(/module-singleton/);
  });

  it('checkShouldDeload threads its client into the engine', async () => {
    const { client, tables } = stubClient();
    const result = await checkShouldDeload('u1', 'm1', client);

    expect(tables).toEqual(expect.arrayContaining(['users']));
    // No fatigue data in the stub, so no deload — the point is that it ran
    // through the injected client rather than throwing on the singleton.
    expect(result.shouldDeload).toBe(false);
  });
});

describe('the finish-flow path is injectable end to end', () => {
  it('recordDeloadRecommendationIfTriggered reaches the engine on its own client', async () => {
    const { client, tables } = stubClient({
      // No pending recommendation, so it proceeds to the trigger check.
      mesocycles: [{ deload_recommended_at: null }],
    });

    await expect(
      recordDeloadRecommendationIfTriggered(client, 'u1', 'm1')
    ).resolves.toBe(false);

    // 'mesocycles' is this function's own read; 'users' can only have been
    // reached by ProgramEngine — i.e. the client was threaded all the way in.
    expect(tables).toEqual(expect.arrayContaining(['mesocycles', 'users']));
  });

  it('an already-pending recommendation short-circuits before the engine', async () => {
    const { client, tables } = stubClient({
      mesocycles: [{ deload_recommended_at: '2026-05-01T00:00:00.000Z' }],
    });

    await expect(
      recordDeloadRecommendationIfTriggered(client, 'u1', 'm1')
    ).resolves.toBe(false);
    expect(tables).toEqual(['mesocycles']);
  });
});

describe('fetchExerciseHistory accepts an injected client', () => {
  it('reads through the supplied client and never builds the singleton', async () => {
    const { client, tables } = stubClient();
    const history = await fetchExerciseHistory('e1', 'u1', undefined, undefined, client);

    expect(tables).toEqual(['exercise_blocks']);
    // No rows in the stub -> the documented empty-history result.
    expect(history).toBeNull();
  });

  it('omitting the client still reaches for the singleton', async () => {
    await expect(fetchExerciseHistory('e1', 'u1')).rejects.toThrow(/module-singleton/);
  });
});
