import { fetchLifetimeSetStats } from '../lifetimeSetStats';

/** Minimal PostgREST-ish fake: an RPC result plus a pageable set_logs table. */
function fakeClient(opts: {
  rpc: { data: unknown; error: unknown } | 'throws';
  rows?: { weight_kg: number | null; reps: number | null }[];
}) {
  const ranges: [number, number][] = [];
  const client = {
    rpc: jest.fn(async () => {
      if (opts.rpc === 'throws') throw new Error('network');
      return opts.rpc;
    }),
    from: jest.fn(() => {
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
      builder.range = async (from: number, to: number) => {
        ranges.push([from, to]);
        return { data: (opts.rows ?? []).slice(from, to + 1), error: null };
      };
      return builder;
    }),
  };
  return { client, ranges };
}

describe('fetchLifetimeSetStats', () => {
  it('uses the aggregate RPC and never reads set rows', async () => {
    const { client } = fakeClient({
      rpc: { data: [{ total_sets: 4321, total_volume_kg: '987654.5' }], error: null },
    });
    await expect(fetchLifetimeSetStats(client, 'u1')).resolves.toEqual({
      totalSets: 4321,
      totalVolumeKg: 987654.5,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('falls back to a paged read that counts past the 1000-row cap', async () => {
    const rows = Array.from({ length: 2300 }, () => ({ weight_kg: 100, reps: 5 }));
    const { client, ranges } = fakeClient({
      rpc: { data: null, error: { code: 'PGRST202', message: 'function not found' } },
      rows,
    });
    await expect(fetchLifetimeSetStats(client, 'u1')).resolves.toEqual({
      totalSets: 2300,
      totalVolumeKg: 2300 * 500,
    });
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('falls back when the RPC throws, and treats null weight/reps as zero', async () => {
    const { client } = fakeClient({
      rpc: 'throws',
      rows: [
        { weight_kg: 50, reps: 10 },
        { weight_kg: null, reps: 8 },
        { weight_kg: 20, reps: null },
      ],
    });
    await expect(fetchLifetimeSetStats(client, 'u1')).resolves.toEqual({
      totalSets: 3,
      totalVolumeKg: 500,
    });
  });
});
