import {
  mergeAsLocationVariant,
  type MergeSupabase,
} from '@/lib/actions/mergeExercise';

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  column: string;
  value?: string;
  values?: string[];
  patch?: Record<string, unknown>;
}

/**
 * Fake Supabase recording every select/update. `duplicateBlocks` is what the
 * exercise_blocks lookup for the duplicate returns.
 */
function fakeSupabase(duplicateBlocks: string[]): {
  client: MergeSupabase;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client: MergeSupabase = {
    from(table: string) {
      return {
        select(_columns: string) {
          return {
            eq(column: string, value: string) {
              calls.push({ table, op: 'select', column, value });
              return Promise.resolve({
                data: duplicateBlocks.map((id) => ({ id })),
                error: null,
              });
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            in(column: string, values: string[]) {
              calls.push({ table, op: 'update', column, values, patch });
              return Promise.resolve({ error: null });
            },
            eq(column: string, value: string) {
              calls.push({ table, op: 'update', column, value, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('mergeAsLocationVariant', () => {
  const NOW = '2026-07-11T00:00:00.000Z';

  it('stamps location on the duplicate history, repoints it, and soft-deletes the duplicate', async () => {
    const { client, calls } = fakeSupabase(['blk-1', 'blk-2']);

    const result = await mergeAsLocationVariant(
      client,
      { survivorId: 'survivor', duplicateId: 'dup', locationId: 'gymA' },
      NOW
    );

    expect(result.ok).toBe(true);
    expect(result.blocksRepointed).toBe(2);
    expect(result.setsStamped).toBe(2);

    // 1. Looked up the DUPLICATE's blocks only (never the survivor's) — so the
    //    survivor's own-location trend is untouched.
    const selects = calls.filter((c) => c.op === 'select');
    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatchObject({ table: 'exercise_blocks', value: 'dup' });

    // 2. Stamped location_id on set_logs for the duplicate's blocks.
    const stamp = calls.find((c) => c.table === 'set_logs');
    expect(stamp).toMatchObject({
      op: 'update',
      column: 'exercise_block_id',
      values: ['blk-1', 'blk-2'],
      patch: { location_id: 'gymA' },
    });

    // 3. Repointed the duplicate's blocks to the survivor.
    const repoint = calls.find(
      (c) => c.table === 'exercise_blocks' && c.op === 'update'
    );
    expect(repoint).toMatchObject({
      column: 'exercise_id',
      value: 'dup',
      patch: { exercise_id: 'survivor' },
    });

    // 4. Soft-deleted the duplicate.
    const softDelete = calls.find((c) => c.table === 'exercises');
    expect(softDelete).toMatchObject({
      op: 'update',
      column: 'id',
      value: 'dup',
      patch: { deleted_at: NOW },
    });

    // Stamp happens before repoint (targets the duplicate's history).
    const stampIdx = calls.indexOf(stamp!);
    const repointIdx = calls.indexOf(repoint!);
    expect(stampIdx).toBeLessThan(repointIdx);
  });

  it('soft-deletes even when the duplicate has no history to repoint', async () => {
    const { client, calls } = fakeSupabase([]);

    const result = await mergeAsLocationVariant(client, {
      survivorId: 'survivor',
      duplicateId: 'dup',
      locationId: 'gymA',
    });

    expect(result.ok).toBe(true);
    expect(result.blocksRepointed).toBe(0);
    expect(result.setsStamped).toBe(0);
    // No set_logs / block-repoint writes, but still soft-deleted.
    expect(calls.some((c) => c.table === 'set_logs')).toBe(false);
    expect(calls.find((c) => c.table === 'exercises')).toMatchObject({
      patch: { deleted_at: expect.any(String) },
    });
  });

  it('refuses to merge an exercise into itself', async () => {
    const { client, calls } = fakeSupabase(['blk-1']);
    const result = await mergeAsLocationVariant(client, {
      survivorId: 'same',
      duplicateId: 'same',
      locationId: 'gymA',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/differ/);
    expect(calls).toHaveLength(0);
  });
});
