/**
 * Tests for the extracted set-write path (lib/training/logSet).
 *
 * This logic was lifted out of the workout page verbatim, so the job here is to
 * pin the behaviour that used to be untestable — the branches that only fired
 * offline, mid-migration, or on a rejected insert — and the ordering guarantees
 * the UI depends on (optimistic state before the network, unwound only on a
 * real rejection).
 */
import {
  classifySetQuality,
  resolveSetNumber,
  buildSetLog,
  buildSetEditPatch,
  renumberBlockSets,
  nextSetNumberForBlock,
  logSet,
  persistSetEdit,
  persistSetDelete,
  type SetWriteClient,
} from '@/lib/training/logSet';
import { __setDriverForTests, listOutbox, type OutboxEntry } from '@/lib/offline/setOutbox';
import { resetClock, setClock } from '@/lib/clock';
import { createTestClock } from '@/test-utils/clock';
import type { SetLog } from '@/types/schema';

function memoryDriver() {
  const map = new Map<string, OutboxEntry>();
  return {
    put: async (e: OutboxEntry) => { map.set(e.id, { ...e }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => { map.delete(id); },
    get: async (id: string) => map.get(id),
  };
}

/**
 * Supabase stub. `insertError` / `maxSetNumber` drive the branches; every call
 * is recorded so ordering can be asserted.
 */
function stubClient(opts: {
  maxSetNumber?: number | null;
  insertError?: { message: string; code?: string } | null;
  /** Errors to return in sequence from insert (for the migration-retry path). */
  insertErrors?: ({ message: string; code?: string } | null)[];
  updateError?: { message: string } | null;
  deleteError?: { message: string } | null;
  probeThrows?: boolean;
} = {}) {
  const calls: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const errors = opts.insertErrors ? [...opts.insertErrors] : null;

  const client = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  single: async () => {
                    calls.push('probe');
                    if (opts.probeThrows) throw new Error('network down');
                    return { data: opts.maxSetNumber == null ? null : { set_number: opts.maxSetNumber } };
                  },
                }),
              }),
            }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          calls.push(`insert:${table}`);
          inserted.push(row);
          const error = errors ? errors.shift() ?? null : opts.insertError ?? null;
          return { error };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            calls.push(`update:${table}:${Object.keys(patch).join(',')}`);
            updated.push(patch);
            return { error: opts.updateError ?? null };
          },
        }),
        delete: () => ({
          eq: async () => {
            calls.push(`delete:${table}`);
            return { error: opts.deleteError ?? null };
          },
        }),
      };
    },
  };
  return { client: client as unknown as SetWriteClient, calls, inserted, updated };
}

const baseInput = {
  exerciseBlockId: 'b1',
  localNextSetNumber: 3,
  weightKg: 100,
  reps: 8,
  rpe: 8,
  setType: 'normal' as const,
  blockWorkingSets: [{ weightKg: 100 }, { weightKg: 100 }],
};

beforeEach(() => __setDriverForTests(memoryDriver()));
afterEach(() => {
  __setDriverForTests(null);
  resetClock();
});

describe('classifySetQuality', () => {
  it('bands by RPE', () => {
    expect(classifySetQuality({ rpe: 8 }).quality).toBe('stimulative');
    expect(classifySetQuality({ rpe: 7.5 }).quality).toBe('stimulative');
    expect(classifySetQuality({ rpe: 9.5 }).quality).toBe('stimulative');
    expect(classifySetQuality({ rpe: 5 }).quality).toBe('junk');
    expect(classifySetQuality({ rpe: 10 }).quality).toBe('effective');
    expect(classifySetQuality({ rpe: 6 }).quality).toBe('effective');
  });

  it('ugly form outranks a stimulative RPE', () => {
    expect(classifySetQuality({ rpe: 8, form: 'ugly' })).toEqual({
      quality: 'junk',
      qualityReason: 'Form breakdown',
    });
  });

  it('labels the reason from form, and leaves it empty without feedback', () => {
    expect(classifySetQuality({ rpe: 8, form: 'clean' }).qualityReason).toBe('Clean form');
    expect(classifySetQuality({ rpe: 8, form: 'some_breakdown' }).qualityReason).toBe(
      'Some form breakdown'
    );
    expect(classifySetQuality({ rpe: 8 }).qualityReason).toBe('');
  });
});

describe('resolveSetNumber', () => {
  it('uses the DB max when it is ahead (another tab logged sets)', () => {
    expect(resolveSetNumber(3, 5)).toBe(6);
  });

  it('floors at the local number so a queued set cannot have its number reused', () => {
    // The classic offline case: local is at 4 because set 3 is in the outbox,
    // but the DB has only ever seen 2. Taking the DB max would re-issue 3 and
    // collide on UNIQUE(exercise_block_id, set_number) when the queue flushes.
    expect(resolveSetNumber(4, 2)).toBe(4);
  });

  it('falls back to local numbering when the probe returned nothing', () => {
    expect(resolveSetNumber(3, null)).toBe(3);
  });
});

describe('buildSetLog', () => {
  const built = () =>
    buildSetLog({
      ...baseInput,
      setId: 's1',
      setNumber: 3,
      loggedAt: '2026-05-01T10:00:00.000Z',
      locationId: 'loc1',
      feedback: { repsInTank: 2, form: 'clean' } as SetLog['feedback'],
    });

  it('keeps the row and the SetLog in agreement', () => {
    const { row, set } = built();
    expect(row.id).toBe(set.id);
    expect(row.set_number).toBe(set.setNumber);
    expect(row.weight_kg).toBe(set.weightKg);
    expect(row.quality).toBe(set.quality);
    expect(row.set_role).toBe(set.setRole);
    expect(row.logged_at).toBe(set.loggedAt);
  });

  it('serialises feedback for the row but keeps the object in the SetLog', () => {
    const { row, set } = built();
    expect(typeof row.feedback).toBe('string');
    expect(set.feedback).toEqual({ repsInTank: 2, form: 'clean' });
  });

  it('labels a set at the block top as working', () => {
    expect(built().set.setRole).toBe('working');
  });

  it('labels a clearly lighter set as a ramp so it is not graded as junk volume', () => {
    const { set } = buildSetLog({
      ...baseInput,
      weightKg: 50,
      blockWorkingSets: [{ weightKg: 100 }],
      setId: 's2',
      setNumber: 1,
      loggedAt: '2026-05-01T10:00:00.000Z',
    });
    expect(set.setRole).toBe('ramp');
  });

  it('treats a zero-load set as working rather than inferring a role from 0', () => {
    const { set } = buildSetLog({
      ...baseInput,
      weightKg: 0,
      blockWorkingSets: [],
      setId: 's3',
      setNumber: 1,
      loggedAt: '2026-05-01T10:00:00.000Z',
    });
    expect(set.setRole).toBe('working');
  });
});

describe('logSet — online', () => {
  it('probes the DB for the set number, then inserts', async () => {
    const { client, calls, inserted } = stubClient({ maxSetNumber: 5 });
    const result = await logSet({ supabase: client }, { ...baseInput, setId: 's1' });

    expect(calls).toEqual(['probe', 'insert:set_logs']);
    expect(inserted[0].set_number).toBe(6);
    expect(result.status).toBe('saved');
  });

  it('applies optimistic state BEFORE the insert', async () => {
    const { client, calls } = stubClient({ maxSetNumber: null });
    await logSet(
      {
        supabase: client,
        applyOptimistic: () => calls.push('optimistic'),
      },
      { ...baseInput, setId: 's1' }
    );
    expect(calls.indexOf('optimistic')).toBeLessThan(calls.indexOf('insert:set_logs'));
  });

  it('uses the caller-supplied set id as the operation id', async () => {
    const { client, inserted } = stubClient();
    await logSet({ supabase: client }, { ...baseInput, setId: 'chosen-id' });
    expect(inserted[0].id).toBe('chosen-id');
  });

  it('stamps logged_at from the application clock when not supplied', async () => {
    setClock(createTestClock('2026-05-01T10:00:00Z'));
    const { client, inserted } = stubClient();
    await logSet({ supabase: client }, { ...baseInput, setId: 's1' });
    expect(inserted[0].logged_at).toBe('2026-05-01T10:00:00.000Z');
  });

  it('survives a failed numbering probe by falling back to local numbering', async () => {
    const { client, inserted } = stubClient({ probeThrows: true });
    const result = await logSet({ supabase: client }, { ...baseInput, setId: 's1' });
    expect(inserted[0].set_number).toBe(3);
    expect(result.status).toBe('saved');
  });

  it('retries without the migration-gated columns on a schema-cache miss', async () => {
    const { client, inserted } = stubClient({
      insertErrors: [{ message: 'Could not find the set_role column in the schema cache' }, null],
    });
    const result = await logSet({ supabase: client }, { ...baseInput, setId: 's1' });

    expect(result.status).toBe('saved');
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toHaveProperty('set_role');
    // The retry drops the optional columns so the core set still lands.
    expect(inserted[1]).not.toHaveProperty('set_role');
    expect(inserted[1]).not.toHaveProperty('suggestion_engine_version');
    expect(inserted[1]).not.toHaveProperty('location_id');
    expect(inserted[1].weight_kg).toBe(100);
  });
});

describe('logSet — rejection', () => {
  it('rolls the optimistic set back and reports the error', async () => {
    const rolledBack: string[] = [];
    const { client } = stubClient({ insertError: { message: 'violates check constraint', code: '23514' } });

    const result = await logSet(
      { supabase: client, rollbackOptimistic: (set) => rolledBack.push(set.id) },
      { ...baseInput, setId: 's1' }
    );

    expect(result.status).toBe('rejected');
    expect(rolledBack).toEqual(['s1']);
    expect(await listOutbox()).toHaveLength(0); // a real rejection is NOT queued
  });

  it('does not roll back a set that was merely queued', async () => {
    const rolledBack: string[] = [];
    const { client } = stubClient({ insertError: { message: 'Failed to fetch' } });

    const result = await logSet(
      { supabase: client, rollbackOptimistic: (set) => rolledBack.push(set.id) },
      { ...baseInput, setId: 's1' }
    );

    expect(result.status).toBe('queued');
    expect(rolledBack).toEqual([]);
  });
});

describe('logSet — offline', () => {
  it('queues without probing or inserting, and keeps the optimistic set', async () => {
    const { client, calls } = stubClient();
    const applied: string[] = [];

    const result = await logSet(
      { supabase: client, online: false, applyOptimistic: (s) => applied.push(s.id) },
      { ...baseInput, setId: 's1' }
    );

    expect(calls).toEqual([]); // no probe, no insert
    expect(result.status).toBe('queued');
    expect(applied).toEqual(['s1']);

    const queued = await listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).toBe('s1');
    expect(queued[0].row.set_number).toBe(3); // local numbering
  });

  it('a lost connection mid-write queues the row rather than losing it', async () => {
    const { client } = stubClient({ insertError: { message: 'network error' } });
    const result = await logSet({ supabase: client }, { ...baseInput, setId: 's1' });

    expect(result.status).toBe('queued');
    expect((await listOutbox()).map((e) => e.id)).toEqual(['s1']);
  });

  it('reports sync state transitions in order', async () => {
    const states: string[] = [];
    const { client } = stubClient();
    await logSet(
      { supabase: client, onSyncState: (_id, s) => states.push(s) },
      { ...baseInput, setId: 's1' }
    );
    expect(states).toEqual(['saving', 'saved']);
  });
});

describe('buildSetEditPatch', () => {
  const withFeedback = (repsInTank: 0 | 1 | 2 | 3 | 4) =>
    ({ feedback: { repsInTank, form: 'clean' } } as unknown as Parameters<typeof buildSetEditPatch>[0]);

  it('stores an explicit RIR chip exactly', () => {
    const { feedback } = buildSetEditPatch(withFeedback(2), {
      weightKg: 100, reps: 8, rpe: 8, repsInTank: 0,
    });
    expect(feedback?.repsInTank).toBe(0);
  });

  it('leaves RIR untouched when the edited RPE still matches it', () => {
    // rirToRpe(2) === 7.5, so a weight-only edit that carries the set's own
    // RPE forward must not touch feedback at all.
    const { feedback } = buildSetEditPatch(withFeedback(2), {
      weightKg: 105, reps: 8, rpe: 7.5,
    });
    expect(feedback).toBeUndefined();
  });

  it('does not corrupt RIR when the RPE scale is asymmetric', () => {
    // The lossy direction: stored RIR 2 maps to RPE 7.5, so an edit that sets
    // RPE 8 counts as a disagreement and re-derives RIR. round(10 - 8) = 2 —
    // the SAME value, which is the property that matters. An implementation
    // that resynced through rirToRpe's non-linear table would land on 3 here
    // and silently change the recorded effort.
    const { feedback } = buildSetEditPatch(withFeedback(2), {
      weightKg: 100, reps: 8, rpe: 8,
    });
    expect(feedback?.repsInTank).toBe(2);
  });

  it('resyncs RIR from RPE only when the two actually disagree', () => {
    const { feedback } = buildSetEditPatch(withFeedback(4), {
      weightKg: 100, reps: 8, rpe: 10,
    });
    expect(feedback?.repsInTank).toBe(0);
  });

  it('recomputes quality from the edited RPE', () => {
    expect(buildSetEditPatch(undefined, { weightKg: 100, reps: 8, rpe: 4 }).quality).toBe('junk');
    expect(buildSetEditPatch(undefined, { weightKg: 100, reps: 8, rpe: 8 }).quality).toBe(
      'stimulative'
    );
  });

  it('omits optional columns from the patch when there is nothing to write', () => {
    const { patch } = buildSetEditPatch(undefined, { weightKg: 100, reps: 8, rpe: 8 });
    expect(Object.keys(patch).sort()).toEqual(['quality', 'reps', 'rpe', 'weight_kg']);
  });
});

describe('persistSetEdit', () => {
  it('patches a still-queued set in place instead of hitting the network', async () => {
    const driver = memoryDriver();
    __setDriverForTests(driver);
    await driver.put({
      id: 's1', table: 'set_logs', row: { id: 's1', weight_kg: 100 }, enqueuedAt: 1, attempts: 0,
    });

    const { client, calls } = stubClient();
    const result = await persistSetEdit({ supabase: client }, { setId: 's1', patch: { weight_kg: 105 } });

    expect(result.queued).toBe(true);
    expect(calls).toEqual([]);
    expect((await listOutbox())[0].row.weight_kg).toBe(105);
  });

  it('updates the row and then stamps edited_at separately', async () => {
    const { client, calls } = stubClient();
    const result = await persistSetEdit({ supabase: client }, { setId: 's1', patch: { reps: 9 } });

    expect(result.queued).toBe(false);
    expect(calls).toEqual(['update:set_logs:reps', 'update:set_logs:edited_at']);
  });

  it('does not stamp edited_at when the edit itself failed', async () => {
    const { client, calls } = stubClient({ updateError: { message: 'nope' } });
    const result = await persistSetEdit({ supabase: client }, { setId: 's1', patch: { reps: 9 } });

    expect(result.error?.message).toBe('nope');
    expect(calls).toEqual(['update:set_logs:reps']);
  });
});

describe('persistSetDelete', () => {
  it('drops a still-queued set from the outbox without touching the network', async () => {
    const driver = memoryDriver();
    __setDriverForTests(driver);
    await driver.put({ id: 's1', table: 'set_logs', row: { id: 's1' }, enqueuedAt: 1, attempts: 0 });

    const { client, calls } = stubClient();
    expect(await persistSetDelete({ supabase: client }, 's1')).toEqual({ queued: true });
    expect(calls).toEqual([]);
    expect(await listOutbox()).toHaveLength(0);
  });

  it('hard-deletes a synced set — set_logs has no soft-delete', async () => {
    const { client, calls } = stubClient();
    expect(await persistSetDelete({ supabase: client }, 's1')).toEqual({ queued: false });
    expect(calls).toEqual(['delete:set_logs']);
  });

  it('surfaces a delete error', async () => {
    const { client } = stubClient({ deleteError: { message: 'denied' } });
    const result = await persistSetDelete({ supabase: client }, 's1');
    expect(result.error?.message).toBe('denied');
  });
});

describe('renumberBlockSets', () => {
  const set = (id: string, blockId: string, setNumber: number, isWarmup = false): SetLog =>
    ({ id, exerciseBlockId: blockId, setNumber, isWarmup, setType: isWarmup ? 'warmup' : 'normal' } as SetLog);

  it('renumbers the affected block densely from 1', () => {
    const result = renumberBlockSets([set('a', 'b1', 1), set('c', 'b1', 3)], 'b1');
    expect(result.map((s) => s.setNumber)).toEqual([1, 2]);
  });

  it('leaves other blocks alone', () => {
    const result = renumberBlockSets([set('a', 'b1', 1), set('x', 'b2', 7)], 'b1');
    expect(result.find((s) => s.id === 'x')!.setNumber).toBe(7);
  });

  it('skips warmups', () => {
    const result = renumberBlockSets([set('w', 'b1', 9, true), set('a', 'b1', 2)], 'b1');
    expect(result.find((s) => s.id === 'w')!.setNumber).toBe(9);
    expect(result.find((s) => s.id === 'a')!.setNumber).toBe(1);
  });
});

describe('nextSetNumberForBlock', () => {
  const set = (id: string, blockId: string, setNumber: number, isWarmup = false): SetLog =>
    ({ id, exerciseBlockId: blockId, setNumber, isWarmup, setType: isWarmup ? 'warmup' : 'normal' } as SetLog);

  it('counts the block rather than continuing from the highest number', () => {
    // The distinction the workout page got wrong. These sets are numbered
    // 1 and 3 — a stale numbering the compaction has not reached yet — and the
    // answer is still 3, because the block holds two sets. Reading "one past
    // the highest" would say 4 and preserve the hole forever.
    expect(nextSetNumberForBlock([set('a', 'b1', 1), set('c', 'b1', 3)], 'b1')).toBe(3);
  });

  it('starts at 1 for an untouched block', () => {
    expect(nextSetNumberForBlock([], 'b1')).toBe(1);
    expect(nextSetNumberForBlock([set('x', 'b2', 4)], 'b1')).toBe(1);
  });

  it('ignores warmups and other blocks', () => {
    const sets = [set('w', 'b1', 1, true), set('a', 'b1', 1), set('x', 'b2', 9)];
    expect(nextSetNumberForBlock(sets, 'b1')).toBe(2);
  });
});
