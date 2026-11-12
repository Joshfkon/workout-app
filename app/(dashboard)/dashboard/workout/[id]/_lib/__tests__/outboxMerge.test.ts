/**
 * Reload restores what is still in the outbox (workout review finding 4):
 * sets logged offline, edits and deletes made offline must be on screen after
 * the app is killed and reopened, not just in IndexedDB.
 */
import { mergeOutboxIntoSets, setIdForOutboxEntry, applySetPatch } from '../outboxMerge';
import type { OutboxEntry } from '@/lib/offline/setOutbox';
import type { SetLog } from '@/types/schema';

const set = (id: string, setNumber: number, over: Partial<SetLog> = {}): SetLog => ({
  id,
  exerciseBlockId: 'b1',
  setNumber,
  weightKg: 100,
  reps: 8,
  rpe: 8,
  restSeconds: null,
  isWarmup: false,
  setType: 'normal',
  parentSetId: null,
  quality: 'stimulative',
  qualityReason: '',
  note: null,
  loggedAt: '2026-05-01T10:00:00.000Z',
  ...over,
});

const insertEntry = (id: string, setNumber: number, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id,
  table: 'set_logs',
  row: {
    id,
    exercise_block_id: 'b1',
    set_number: setNumber,
    weight_kg: 60,
    reps: 10,
    rpe: 7.5,
    is_warmup: false,
    set_type: 'normal',
    quality: 'stimulative',
    quality_reason: 'Clean form',
    note: null,
    logged_at: '2026-05-01T10:05:00.000Z',
    feedback: JSON.stringify({ repsInTank: 2, form: 'clean' }),
    bodyweight_data: null,
    parent_set_id: null,
  },
  enqueuedAt: setNumber,
  attempts: 0,
  ...over,
});

const BLOCKS = new Set(['b1']);

describe('mergeOutboxIntoSets', () => {
  it('adds sets that are still queued, so the logger does not restart at "Set 1"', () => {
    const { sets, queuedIds } = mergeOutboxIntoSets(
      [set('s1', 1)],
      [insertEntry('s2', 2), insertEntry('s3', 3)],
      BLOCKS
    );
    expect(sets.map((s) => [s.id, s.setNumber])).toEqual([['s1', 1], ['s2', 2], ['s3', 3]]);
    expect(queuedIds).toEqual(['s2', 's3']);
    expect(sets[1]).toMatchObject({
      weightKg: 60,
      reps: 10,
      rpe: 7.5,
      restSeconds: null,
      feedback: { repsInTank: 2, form: 'clean' },
    });
  });

  it('ignores queued sets that belong to another session', () => {
    const other = insertEntry('x1', 1);
    other.row.exercise_block_id = 'other-block';
    expect(mergeOutboxIntoSets([], [other], BLOCKS).sets).toEqual([]);
  });

  it('does not duplicate a set that landed but is still queued (lost ack), and prefers the queued values', () => {
    const edited = insertEntry('s1', 1, { dirty: true });
    edited.row.weight_kg = 90;
    const { sets } = mergeOutboxIntoSets([set('s1', 1, { weightKg: 100 })], [edited], BLOCKS);
    expect(sets).toHaveLength(1);
    expect(sets[0].weightKg).toBe(90);
  });

  it('applies a queued edit of a synced set', () => {
    const edit: OutboxEntry = {
      id: 'set-edit:s1',
      table: 'set_logs',
      op: 'update',
      matchId: 's1',
      row: { weight_kg: 95, reps: 6, set_number: 2 },
      enqueuedAt: 1,
      attempts: 0,
    };
    const { sets, queuedIds } = mergeOutboxIntoSets([set('s1', 1)], [edit], BLOCKS);
    expect(sets[0]).toMatchObject({ weightKg: 95, reps: 6, setNumber: 2 });
    expect(queuedIds).toEqual(['s1']);
  });

  it('removes a set whose delete is still queued', () => {
    const tombstone: OutboxEntry = {
      id: 's1', table: 'set_logs', op: 'delete', matchId: 's1', row: {}, enqueuedAt: 1, attempts: 0,
    };
    const { sets, queuedIds } = mergeOutboxIntoSets([set('s1', 1), set('s2', 2)], [tombstone], BLOCKS);
    expect(sets.map((s) => s.id)).toEqual(['s2']);
    expect(queuedIds).toEqual([]);
  });

  it('reports a parked (server-refused) set as failed, never as queued', () => {
    const { queuedIds, failedIds } = mergeOutboxIntoSets(
      [],
      [insertEntry('s1', 1, { parked: true }), insertEntry('s2', 2)],
      BLOCKS
    );
    expect(failedIds).toEqual(['s1']);
    expect(queuedIds).toEqual(['s2']);
  });

  it('ignores other tables and orders the result by set number', () => {
    const finish: OutboxEntry = {
      id: 'finish:x', table: 'workout_sessions', op: 'update', matchId: 'x', row: { state: 'completed' },
      enqueuedAt: 0, attempts: 0,
    };
    const { sets } = mergeOutboxIntoSets(
      [set('s3', 3)],
      [finish, insertEntry('s2', 2), insertEntry('s1', 1)],
      BLOCKS
    );
    expect(sets.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });
});

describe('setIdForOutboxEntry', () => {
  it('maps insert, edit and delete entries back to their set', () => {
    expect(setIdForOutboxEntry(insertEntry('s1', 1))).toBe('s1');
    expect(
      setIdForOutboxEntry({ id: 'set-edit:s9', table: 'set_logs', op: 'update', row: {}, enqueuedAt: 0, attempts: 0 })
    ).toBe('s9');
    expect(
      setIdForOutboxEntry({ id: 'finish:x', table: 'workout_sessions', op: 'update', matchId: 'x', row: {}, enqueuedAt: 0, attempts: 0 })
    ).toBeNull();
  });
});

describe('applySetPatch', () => {
  it('parses a serialised feedback patch and leaves untouched fields alone', () => {
    const next = applySetPatch(set('s1', 1), {
      feedback: JSON.stringify({ repsInTank: 1, form: 'some_breakdown' }),
      quality: 'effective',
    });
    expect(next.feedback).toEqual({ repsInTank: 1, form: 'some_breakdown' });
    expect(next.quality).toBe('effective');
    expect(next.weightKg).toBe(100);
  });
});
