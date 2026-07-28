import {
  updateExerciseRow,
  type UpdateExerciseSupabase,
} from '@/lib/exercises/updateExerciseRow';

function makeClient(opts: {
  updateResult: {
    data: Array<Record<string, unknown>> | null;
    error: { message: string } | null;
  };
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: UpdateExerciseSupabase = {
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => Promise.resolve(opts.updateResult),
        }),
      }),
    }),
    ...(opts.rpcResult
      ? {
          rpc: (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args });
            return Promise.resolve(opts.rpcResult!);
          },
        }
      : {}),
  };
  return { client, rpcCalls };
}

describe('updateExerciseRow', () => {
  it('returns updated when the direct write lands on a row (no RPC needed)', async () => {
    const { client, rpcCalls } = makeClient({
      updateResult: { data: [{ id: 'ex-1' }], error: null },
      rpcResult: { data: null, error: null },
    });
    const result = await updateExerciseRow(client, 'ex-1', {
      secondary_muscles: ['quads'],
    });
    expect(result).toEqual({ ok: true, outcome: 'updated' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('falls back to the audited catalog RPC on a zero-row "success" (stock row)', async () => {
    const { client, rpcCalls } = makeClient({
      updateResult: { data: [], error: null },
      rpcResult: { data: { id: 'ex-1', updated: true }, error: null },
    });
    const result = await updateExerciseRow(client, 'ex-1', {
      secondary_muscles: ['quads'],
    });
    expect(result).toEqual({ ok: true, outcome: 'updated_catalog' });
    expect(rpcCalls).toEqual([
      {
        fn: 'update_catalog_exercise',
        args: { p_exercise_id: 'ex-1', p_patch: { secondary_muscles: ['quads'] } },
      },
    ]);
  });

  it('surfaces an RPC rejection as an error, never as success', async () => {
    const { client } = makeClient({
      updateResult: { data: [], error: null },
      rpcResult: { data: null, error: { message: 'column "is_custom" is not editable' } },
    });
    const result = await updateExerciseRow(client, 'ex-1', { is_custom: true });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('error');
    expect(result.message).toMatch(/is_custom/);
  });

  it('maps zero rows with no RPC available to blocked, not ok', async () => {
    const { client } = makeClient({ updateResult: { data: [], error: null } });
    const result = await updateExerciseRow(client, 'ex-1', {
      secondary_muscles: ['quads'],
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('blocked');
    expect(result.message).toBeTruthy();
  });

  it('surfaces direct-update request errors with the DB message', async () => {
    const { client } = makeClient({
      updateResult: { data: null, error: { message: 'reps out of range' } },
    });
    const result = await updateExerciseRow(client, 'ex-1', {
      default_rep_range: [1, 5000],
    });
    expect(result).toEqual({ ok: false, outcome: 'error', message: 'reps out of range' });
  });
});
