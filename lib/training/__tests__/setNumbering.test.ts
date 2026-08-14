/**
 * B1 — delete → renumber → log another set.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM logSet.test.ts. Every other test of the
 * set-write path runs against a permissive stub: it records what was sent and
 * answers `{ error: null }`. That is fine for "did we send the right row", and
 * useless for B1, whose whole failure mode is a database CONSTRAINT the app
 * violates. The stub below is deliberately hostile — it models the primary key
 * on `id` and, crucially,
 *
 *     UNIQUE (exercise_block_id, set_number)   -- 20250101000001_initial_schema
 *
 * and rejects violations the way PostgREST does, with SQLSTATE 23505. It is
 * the smallest thing that can tell the truth about this bug; a real
 * local-Supabase suite (Layer 2) would subsume it, but pulling that forward
 * just to reproduce one constraint is not worth it.
 *
 * WHAT THE STUB IS NOT. It is not a database. It models exactly two
 * constraints and the four verbs this path uses. If a future test needs
 * transactions, triggers or RLS, that is Layer 2's job, not this file's.
 */
import {
  logSet,
  persistSetDelete,
  persistSetRenumber,
  planBlockRenumber,
  type SetNumberChange,
  type SetWriteClient,
} from '../logSet';
import {
  __setDriverForTests,
  flushSetOutbox,
  outboxCount,
  type OutboxEntry,
} from '@/lib/offline/setOutbox';
import { setClock, resetClock } from '@/lib/clock';
import { ControllableClock } from '@/test-utils/clock';
import type { SetLog } from '@/types/schema';

// ---------------------------------------------------------------------------
// A set_logs table that enforces its constraints
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  exercise_block_id: string;
  set_number: number;
  is_warmup?: boolean;
  [key: string]: unknown;
}

const UNIQUE_VIOLATION = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "set_logs_exercise_block_id_set_number_key"',
};

function constrainedSetLogs() {
  const rows: Row[] = [];

  /** The real constraint: (exercise_block_id, set_number) is unique. */
  const collides = (candidate: Row, ignoreId?: string) =>
    rows.some(
      (r) =>
        r.id !== ignoreId &&
        r.exercise_block_id === candidate.exercise_block_id &&
        r.set_number === candidate.set_number
    );

  const client = {
    from: (table: string) => {
      if (table !== 'set_logs') throw new Error(`constrainedSetLogs: unexpected table ${table}`);
      return {
        // The outbox flushes with upsert(row, { onConflict: 'id',
        // ignoreDuplicates: true }) — note that ignoring duplicates on `id`
        // does NOT excuse a (block, set_number) collision.
        upsert: async (row: Row, opts?: { ignoreDuplicates?: boolean }) => {
          if (rows.some((r) => r.id === row.id)) {
            return opts?.ignoreDuplicates ? { error: null } : { error: UNIQUE_VIOLATION };
          }
          if (collides(row)) return { error: UNIQUE_VIOLATION };
          rows.push({ ...row });
          return { error: null };
        },
        insert: async (row: Row) => {
          if (rows.some((r) => r.id === row.id)) return { error: UNIQUE_VIOLATION };
          if (collides(row)) return { error: UNIQUE_VIOLATION };
          rows.push({ ...row });
          return { error: null };
        },
        update: (patch: Partial<Row>) => ({
          eq: async (column: string, value: string) => {
            const target = rows.find((r) => (r as Record<string, unknown>)[column] === value);
            if (!target) return { error: null }; // no rows matched — not an error in PostgREST
            const next = { ...target, ...patch };
            if (collides(next, target.id)) return { error: UNIQUE_VIOLATION };
            Object.assign(target, patch);
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async (column: string, value: string) => {
            const i = rows.findIndex((r) => (r as Record<string, unknown>)[column] === value);
            if (i >= 0) rows.splice(i, 1);
            return { error: null };
          },
        }),
        // Only the shape probeMaxSetNumber uses: highest set_number for a
        // block, working sets only.
        select: () => {
          const filters: [string, unknown][] = [];
          const q = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return q;
            },
            order() {
              return q;
            },
            limit() {
              return q;
            },
            async single() {
              const matched = rows.filter((r) =>
                filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)
              );
              if (matched.length === 0) return { data: null, error: { message: 'no rows' } };
              const top = matched.reduce((m, r) => (r.set_number > m.set_number ? r : m));
              return { data: { set_number: top.set_number }, error: null };
            },
          };
          return q;
        },
      };
    },
  };

  return {
    client: client as unknown as SetWriteClient,
    /** Persisted (id, set_number) for a block, ordered by set_number. */
    numbering: (blockId: string) =>
      rows
        .filter((r) => r.exercise_block_id === blockId && !r.is_warmup)
        .sort((a, b) => a.set_number - b.set_number)
        .map((r) => ({ id: r.id, setNumber: r.set_number })),
    rows,
  };
}

/** Page-lifetime outbox, so the offline case doesn't need IndexedDB. */
function memoryOutbox() {
  const map = new Map<string, OutboxEntry>();
  return {
    put: async (entry: OutboxEntry) => { map.set(entry.id, { ...entry }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => { map.delete(id); },
    get: async (id: string) => map.get(id),
  };
}

// ---------------------------------------------------------------------------
// A session's local state, driven the way the workout page drives it
// ---------------------------------------------------------------------------

const BLOCK = 'block-1';

function localState() {
  let sets: SetLog[] = [];
  return {
    get sets() {
      return sets;
    },
    apply: (set: SetLog) => {
      sets = [...sets, set];
    },
    rollback: (set: SetLog) => {
      sets = sets.filter((s) => s.id !== set.id);
    },
    /** Exactly what handleDeleteSet does locally: drop, then renumber. */
    deleteAndRenumber: (setId: string): SetNumberChange[] => {
      const plan = planBlockRenumber(
        sets.filter((s) => s.id !== setId),
        BLOCK
      );
      sets = plan.sets;
      return plan.changes;
    },
    numbering: () =>
      sets
        .filter((s) => s.exerciseBlockId === BLOCK && !s.isWarmup)
        .map((s) => ({ id: s.id, setNumber: s.setNumber })),
  };
}

describe('B1 — delete, renumber, log another set', () => {
  let clock: ControllableClock;

  beforeEach(() => {
    clock = new ControllableClock('2026-08-14T09:00:00');
    setClock(clock);
    // No IndexedDB in this suite: nothing here goes through the outbox except
    // where a test says so, and a shared Map keeps that explicit.
    __setDriverForTests(null);
  });

  afterEach(() => {
    resetClock();
    __setDriverForTests(null);
  });

  const log = async (db: ReturnType<typeof constrainedSetLogs>, local: ReturnType<typeof localState>, id: string, weightKg: number) => {
    clock.advanceMinutes(3);
    return logSet(
      { supabase: db.client, online: true, applyOptimistic: local.apply, rollbackOptimistic: local.rollback },
      {
        setId: id,
        exerciseBlockId: BLOCK,
        localNextSetNumber: local.numbering().length + 1,
        weightKg,
        reps: 10,
        rpe: 8,
        setType: 'normal',
        blockWorkingSets: local.sets.map((s) => ({ weightKg: s.weightKg })),
      }
    );
  };

  it('keeps database and local numbering identical across the whole sequence', async () => {
    const db = constrainedSetLogs();
    const local = localState();

    // 1-3. Log sets 1, 2, 3.
    const ids = ['s1', 's2', 's3'];
    for (let i = 0; i < ids.length; i++) {
      const result = await log(db, local, ids[i], 100 + i);
      expect(result.status).toBe('saved');
    }
    expect(local.numbering()).toEqual([
      { id: 's1', setNumber: 1 },
      { id: 's2', setNumber: 2 },
      { id: 's3', setNumber: 3 },
    ]);
    expect(db.numbering(BLOCK)).toEqual(local.numbering());

    // 4. Delete the MIDDLE set.
    const changes = local.deleteAndRenumber('s2');
    const del = await persistSetDelete({ supabase: db.client }, 's2');
    expect(del.error).toBeUndefined();
    expect(await persistSetRenumber({ supabase: db.client }, changes)).toEqual({});

    // 5. Surviving local sets are renumbered 1, 2.
    expect(local.numbering()).toEqual([
      { id: 's1', setNumber: 1 },
      { id: 's3', setNumber: 2 },
    ]);

    // 6. The database agrees. This is the assertion B1 fails: production
    //    renumbers local state only, so the row for s3 keeps set_number 3.
    expect(db.numbering(BLOCK)).toEqual(local.numbering());

    // 7. Log another set.
    const fourth = await log(db, local, 's4', 130);

    // 8. No uniqueness violation, and no user-visible rollback.
    expect(fourth.status).toBe('saved');
    expect(local.sets.map((s) => s.id)).toContain('s4');

    // 9. It becomes set 3, and both sides still agree.
    expect(local.numbering()).toEqual([
      { id: 's1', setNumber: 1 },
      { id: 's3', setNumber: 2 },
      { id: 's4', setNumber: 3 },
    ]);
    expect(db.numbering(BLOCK)).toEqual(local.numbering());
  });

  it('applies a multi-row compaction in an order the constraint permits', async () => {
    // With four sets, deleting the second moves TWO rows: 3→2 and 4→3. The
    // order is load-bearing — 4→3 first would land on the row still sitting at
    // 3 and be refused by UNIQUE (exercise_block_id, set_number). A single
    // deletion from three sets moves only one row and cannot show this.
    const db = constrainedSetLogs();
    const local = localState();
    const ids = ['s1', 's2', 's3', 's4'];
    for (let i = 0; i < ids.length; i++) await log(db, local, ids[i], 100 + i);

    const changes = local.deleteAndRenumber('s2');
    expect(changes).toEqual([
      { id: 's3', setNumber: 2 },
      { id: 's4', setNumber: 3 },
    ]);

    await persistSetDelete({ supabase: db.client }, 's2');
    expect(await persistSetRenumber({ supabase: db.client }, changes)).toEqual({});

    expect(db.numbering(BLOCK)).toEqual([
      { id: 's1', setNumber: 1 },
      { id: 's3', setNumber: 2 },
      { id: 's4', setNumber: 3 },
    ]);
    expect(db.numbering(BLOCK)).toEqual(local.numbering());
  });

  it('the stub really does enforce the constraint', () => {
    // Guards the test above: if the stub accepted anything, step 8 would pass
    // for the wrong reason and this file would prove nothing.
    const db = constrainedSetLogs();
    return (async () => {
      const row = { id: 'a', exercise_block_id: BLOCK, set_number: 1, is_warmup: false };
      expect((await db.client.from('set_logs').insert(row as never)).error).toBeNull();
      const clash = { id: 'b', exercise_block_id: BLOCK, set_number: 1, is_warmup: false };
      expect((await db.client.from('set_logs').insert(clash as never)).error).toMatchObject({
        code: '23505',
      });
    })();
  });
});

/**
 * The sharper half of B1: offline, the divergence does not merely look wrong,
 * it LOSES a set.
 *
 * A set logged offline takes its number from local state and never probes the
 * database. If local numbering has been compacted and the database's has not,
 * the queued row carries a `set_number` the database still holds. The outbox
 * flushes with `ignoreDuplicates` on `id`, which says nothing about
 * `(exercise_block_id, set_number)` — so the write is REFUSED, retried, and
 * dropped after five attempts. The user logged a set, saw it, and it is gone.
 */
describe('B1 — a set logged offline after a delete still lands', () => {
  let clock: ControllableClock;

  beforeEach(() => {
    clock = new ControllableClock('2026-08-14T09:00:00');
    setClock(clock);
    __setDriverForTests(memoryOutbox() as never);
  });

  afterEach(() => {
    resetClock();
    __setDriverForTests(null);
  });

  it('flushes without a uniqueness violation, and is not dropped', async () => {
    const db = constrainedSetLogs();
    const local = localState();

    const logOnline = (id: string, weightKg: number) => {
      clock.advanceMinutes(3);
      return logSet(
        { supabase: db.client, online: true, applyOptimistic: local.apply },
        {
          setId: id,
          exerciseBlockId: BLOCK,
          localNextSetNumber: local.numbering().length + 1,
          weightKg,
          reps: 10,
          rpe: 8,
          setType: 'normal',
          blockWorkingSets: [],
        }
      );
    };

    const ids = ['s1', 's2', 's3'];
    for (let i = 0; i < ids.length; i++) await logOnline(ids[i], 100 + i);
    expect(db.numbering(BLOCK)).toHaveLength(3);

    // Delete the middle set, renumbering BOTH sides.
    const changes = local.deleteAndRenumber('s2');
    await persistSetDelete({ supabase: db.client }, 's2');
    await persistSetRenumber({ supabase: db.client }, changes);

    // Now go offline and log another set. No probe happens; the number comes
    // straight from local state.
    clock.advanceMinutes(3);
    const queued = await logSet(
      { supabase: db.client, online: false, applyOptimistic: local.apply },
      {
        setId: 's4',
        exerciseBlockId: BLOCK,
        localNextSetNumber: local.numbering().length + 1,
        weightKg: 130,
        reps: 10,
        rpe: 8,
        setType: 'normal',
        blockWorkingSets: [],
      }
    );
    expect(queued.status).toBe('queued');
    expect(queued.set.setNumber).toBe(3);

    // Connectivity returns.
    const result = await flushSetOutbox(db.client as never);

    expect(result.rejectedIds).toEqual([]);
    expect(result.flushedIds).toEqual(['s4']);
    expect(await outboxCount()).toBe(0);
    expect(db.numbering(BLOCK)).toEqual([
      { id: 's1', setNumber: 1 },
      { id: 's3', setNumber: 2 },
      { id: 's4', setNumber: 3 },
    ]);
    expect(db.numbering(BLOCK)).toEqual(local.numbering());
  });
});
