/**
 * Unit tests for the offline set outbox (P0-2).
 * Runs against the in-memory driver (jsdom has no IndexedDB); the IDB driver
 * shares all queue/flush logic, differing only in storage primitives.
 */

import {
  __setDriverForTests,
  enqueueSetInsert,
  enqueueRowUpdate,
  enqueueRowUpsert,
  listOutbox,
  outboxCount,
  updateQueuedSet,
  removeQueuedSet,
  flushSetOutbox,
  isNetworkError,
  isPermanentRejection,
  isMissingColumnError,
  enqueueRowDelete,
  getQueuedEntry,
  unparkOutboxEntries,
  removeQueuedEntryIfUnchanged,
  trackDirectWrite,
  withoutOptionalSetLogColumns,
  type OutboxEntry,
  type OutboxSupabase,
} from '../setOutbox';

function memoryDriver() {
  const map = new Map<string, OutboxEntry>();
  return {
    map,
    put: async (entry: OutboxEntry) => { map.set(entry.id, { ...entry }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => { map.delete(id); },
    get: async (id: string) => map.get(id),
  };
}

/** Supabase stub whose upsert/update behavior is scripted per call. */
function makeSupabase(script: Array<{ error: { message: string; code?: string } | null; delayMs?: number }>) {
  const calls: Array<{ table: string; op: 'upsert' | 'update'; row: Record<string, unknown>; matchId?: string }> = [];
  let i = 0;
  type OpResult = { error: { message: string; code?: string } | null };
  const nextResult = (): PromiseLike<OpResult> => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    const result: OpResult = { error: step?.error ?? null };
    if (step?.delayMs != null) {
      // delayMs: -1 = never settles (dead connection)
      if (step.delayMs < 0) return new Promise<OpResult>(() => {});
      return new Promise<OpResult>((resolve) => setTimeout(() => resolve(result), step.delayMs));
    }
    return Promise.resolve(result);
  };
  const client: OutboxSupabase = {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        calls.push({ table, op: 'upsert', row });
        return nextResult();
      },
      update: (row: Record<string, unknown>) => ({
        eq: (_column: string, value: string) => {
          calls.push({ table, op: 'update', row, matchId: value });
          return nextResult();
        },
      }),
    }),
  };
  return { client, calls };
}

const NETWORK_ERROR = { message: 'TypeError: Failed to fetch' };
const RLS_ERROR = { message: 'new row violates row-level security policy', code: '42501' };
const MISSING_COLUMN_ERROR = {
  message: "Could not find the 'set_role' column of 'set_logs' in the schema cache",
  code: 'PGRST204',
};

describe('setOutbox', () => {
  beforeEach(() => {
    __setDriverForTests(memoryDriver());
  });

  afterEach(() => {
    __setDriverForTests(null);
  });

  describe('enqueue / list / edit / remove', () => {
    it('enqueues rows and lists them oldest-first', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8 });
      await enqueueSetInsert('b', { id: 'b', reps: 9 });
      const entries = await listOutbox();
      expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
      expect(await outboxCount()).toBe(2);
    });

    it('updateQueuedSet merges a patch into the queued row', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8, weight_kg: 100 });
      const wasQueued = await updateQueuedSet('a', { reps: 10 });
      expect(wasQueued).toBe(true);
      const [entry] = await listOutbox();
      expect(entry.row).toEqual({ id: 'a', reps: 10, weight_kg: 100 });
    });

    it('updateQueuedSet returns false for unknown ids (already synced)', async () => {
      expect(await updateQueuedSet('nope', { reps: 1 })).toBe(false);
    });

    it('removeQueuedSet drops the entry and reports whether it was queued', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      expect(await removeQueuedSet('a')).toBe(true);
      expect(await removeQueuedSet('a')).toBe(false);
      expect(await outboxCount()).toBe(0);
    });
  });

  describe('flush', () => {
    it('flushes all entries in order and empties the queue', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      await enqueueSetInsert('b', { id: 'b' });
      const { client, calls } = makeSupabase([{ error: null }]);

      const result = await flushSetOutbox(client);

      expect(result.flushedIds).toEqual(['a', 'b']);
      expect(result.failedIds).toEqual([]);
      expect(calls.map((c) => c.row.id)).toEqual(['a', 'b']);
      expect(await outboxCount()).toBe(0);
    });

    it('keeps entries and stops early on a network error (retry later)', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      await enqueueSetInsert('b', { id: 'b' });
      const { client, calls } = makeSupabase([{ error: NETWORK_ERROR }]);

      const result = await flushSetOutbox(client);

      expect(result.flushedIds).toEqual([]);
      expect(result.failedIds).toEqual(['a']); // stopped before touching b
      expect(calls).toHaveLength(1);
      const entries = await listOutbox();
      expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
      expect(entries[0].attempts).toBe(1);
    });

    it('retries a network-failed entry on the next flush and succeeds', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      const first = makeSupabase([{ error: NETWORK_ERROR }]);
      await flushSetOutbox(first.client);
      expect(await outboxCount()).toBe(1);

      const second = makeSupabase([{ error: null }]);
      const result = await flushSetOutbox(second.client);
      expect(result.flushedIds).toEqual(['a']);
      expect(await outboxCount()).toBe(0);
    });

    it('drops a server-rejected NON-critical entry after 5 rejections instead of retrying forever', async () => {
      await enqueueRowUpdate('block-target-sets:b1', 'exercise_blocks', 'b1', { target_sets: 3 });
      for (let attempt = 1; attempt <= 5; attempt++) {
        const { client } = makeSupabase([{ error: RLS_ERROR }]);
        await flushSetOutbox(client);
      }
      expect(await outboxCount()).toBe(0);
    });

    it('NEVER drops a server-rejected set: after 5 rejections it is parked, kept and reported', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8 });
      let last = await flushSetOutbox(makeSupabase([{ error: RLS_ERROR }]).client);
      for (let attempt = 2; attempt <= 5; attempt++) {
        last = await flushSetOutbox(makeSupabase([{ error: RLS_ERROR }]).client);
      }
      expect(last.rejectedIds).toEqual(['a']);
      expect(last.parkedIds).toEqual(['a']);
      const [entry] = await listOutbox();
      expect(entry).toMatchObject({ id: 'a', parked: true, rejections: 5, row: { id: 'a', reps: 8 } });
      expect(entry.lastError).toContain('42501');

      // A parked entry is skipped by ordinary flushes — no request, still there.
      const idle = makeSupabase([{ error: null }]);
      const result = await flushSetOutbox(idle.client);
      expect(idle.calls).toHaveLength(0);
      expect(result.flushedIds).toEqual([]);
      expect(await outboxCount()).toBe(1);

      // …and goes out again once released (page load / reconnect / Retry).
      expect(await unparkOutboxEntries()).toBe(1);
      const retry = await flushSetOutbox(idle.client);
      expect(retry.flushedIds).toEqual(['a']);
      expect(await outboxCount()).toBe(0);
    });

    it('a rejected finish-workout entry is parked, not dropped', async () => {
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { state: 'completed' });
      for (let attempt = 1; attempt <= 6; attempt++) {
        await flushSetOutbox(makeSupabase([{ error: { message: 'check violated', code: '23514' } }]).client);
      }
      const [entry] = await listOutbox();
      expect(entry).toMatchObject({ id: 'finish:s1', parked: true });
    });

    it.each([
      ['502 HTML body from a proxy', { message: '<html><body>502 Bad Gateway</body></html>' }],
      ['expired JWT', { message: 'JWT expired', code: 'PGRST301' }],
      ['statement timeout', { message: 'canceling statement due to statement timeout', code: '57014' }],
      ['too many connections', { message: 'sorry, too many clients already', code: '53300' }],
      ['PostgREST lost its database connection', { message: 'Could not connect', code: 'PGRST000' }],
    ])('keeps a queued set through %s, however many times it happens', async (_label, error) => {
      await enqueueSetInsert('a', { id: 'a' });
      await enqueueSetInsert('b', { id: 'b' });
      for (let attempt = 1; attempt <= 12; attempt++) {
        const { client, calls } = makeSupabase([{ error }]);
        const result = await flushSetOutbox(client);
        expect(result.rejectedIds).toEqual([]); // not a refusal
        expect(result.failedIds).toEqual(['a']);
        expect(calls).toHaveLength(1); // stopped — no hammering the rest of the queue
      }
      const entries = await listOutbox();
      expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
      expect(entries[0].parked).toBeFalsy();

      const ok = await flushSetOutbox(makeSupabase([{ error: null }]).client);
      expect(ok.flushedIds).toEqual(['a', 'b']);
    });

    it('does not resurrect an entry that was removed while its write was failing', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      const { client } = makeSupabase([{ error: NETWORK_ERROR, delayMs: 30 }]);
      const flushing = flushSetOutbox(client);
      await new Promise((r) => setTimeout(r, 5));
      await removeQueuedSet('a'); // user deleted the set mid-flight
      await flushing;
      expect(await outboxCount()).toBe(0);
    });

    it('leaves an entry alone while its direct (write-ahead) insert is on the wire', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      let settle!: () => void;
      const direct = trackDirectWrite('a', new Promise<void>((resolve) => { settle = resolve; }));
      const { client, calls } = makeSupabase([{ error: null }]);

      await flushSetOutbox(client);
      expect(calls).toHaveLength(0);
      expect(await outboxCount()).toBe(1);

      settle();
      await direct;
      await flushSetOutbox(client);
      expect(calls).toHaveLength(1);
    });

    it('server rejection does not block later entries', async () => {
      await enqueueSetInsert('bad', { id: 'bad' });
      await enqueueSetInsert('good', { id: 'good' });
      const { client } = makeSupabase([{ error: RLS_ERROR }, { error: null }]);

      const result = await flushSetOutbox(client);
      expect(result.failedIds).toEqual(['bad']);
      expect(result.flushedIds).toEqual(['good']);
      expect(result.rejectedIds).toEqual(['bad']); // server said no — callers reconcile
    });

    it('network failures are NOT reported as rejections', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      const { client } = makeSupabase([{ error: NETWORK_ERROR }]);
      const result = await flushSetOutbox(client);
      expect(result.failedIds).toEqual(['a']);
      expect(result.rejectedIds).toEqual([]);
    });

    it('a successful write keeps a same-id entry that was replaced mid-flight (newer patch wins)', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8 });
      const { client } = makeSupabase([{ error: null, delayMs: 30 }, { error: null }]);

      const flushPromise = flushSetOutbox(client);
      await new Promise((r) => setTimeout(r, 5));
      await updateQueuedSet('a', { reps: 99 }); // edit lands while the write is in flight

      await flushPromise;
      const entries = await listOutbox();
      expect(entries).toHaveLength(1); // the newer payload survived the post-write delete
      expect(entries[0].row).toEqual({ id: 'a', reps: 99 });

      const second = await flushSetOutbox(client);
      expect(second.flushedIds).toEqual(['a']);
      expect(await outboxCount()).toBe(0);
    });

    it('retries without the optional columns when the DB is missing them (migration lag)', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8, set_role: 'working', suggestion_engine_version: 2 });
      // First upsert: schema-cache column miss. Retry (stripped): succeeds.
      const { client, calls } = makeSupabase([{ error: MISSING_COLUMN_ERROR }, { error: null }]);

      const result = await flushSetOutbox(client);

      expect(result.flushedIds).toEqual(['a']);
      expect(calls).toHaveLength(2);
      expect(calls[0].row).toHaveProperty('set_role'); // first attempt kept the columns
      expect(calls[1].row).not.toHaveProperty('set_role'); // retry stripped them
      expect(calls[1].row).not.toHaveProperty('suggestion_engine_version');
      expect(calls[1].row).toMatchObject({ id: 'a', reps: 8 });
      expect(await outboxCount()).toBe(0);
    });

    it('dedupes concurrent flushes: overlapping calls share one in-flight run', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      const { client, calls } = makeSupabase([{ error: null, delayMs: 30 }]);

      const [r1, r2] = await Promise.all([flushSetOutbox(client), flushSetOutbox(client)]);

      expect(calls).toHaveLength(1); // one insert despite two flush calls
      expect(r1).toBe(r2); // same result object — same run
      expect(await outboxCount()).toBe(0);
    });

    it('sequential double-flush after success is a no-op (queue already empty)', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      const { client, calls } = makeSupabase([{ error: null }]);
      await flushSetOutbox(client);
      const again = await flushSetOutbox(client);
      expect(again.flushedIds).toEqual([]);
      expect(calls).toHaveLength(1);
    });

    it('uses ignoreDuplicates upsert so a lost-ack retry cannot double-insert', async () => {
      // Simulated lost ack: first flush hits a network error AFTER the row
      // actually landed server-side. The retry upserts the same client id;
      // ignoreDuplicates makes it a no-op rather than a duplicate.
      await enqueueSetInsert('a', { id: 'a' });
      const flaky = makeSupabase([{ error: NETWORK_ERROR }]);
      await flushSetOutbox(flaky.client);

      let upsertOptions: Record<string, unknown> | undefined;
      const client: OutboxSupabase = {
        from: () => ({
          upsert: (_row, options) => {
            upsertOptions = options as unknown as Record<string, unknown>;
            return Promise.resolve({ error: null });
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      };
      await flushSetOutbox(client);
      expect(upsertOptions).toEqual({ onConflict: 'id', ignoreDuplicates: true });
      expect(await outboxCount()).toBe(0);
    });
  });

  describe('exactly-once effect under ugly failures', () => {
    /**
     * Stateful fake Supabase: actually "commits" rows into a Set (honoring
     * ON CONFLICT DO NOTHING semantics) and can drop the RESPONSE after the
     * commit — the lost-ack case a 200-based scheme cannot survive.
     */
    function makeStatefulServer() {
      const committed = new Set<string>();
      let dropNextResponses = 0;
      const respond = () => {
        if (dropNextResponses > 0) {
          dropNextResponses -= 1;
          return Promise.resolve({ error: { message: 'TypeError: Failed to fetch' } });
        }
        return Promise.resolve({ error: null });
      };
      const client: OutboxSupabase = {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            // Server-side apply happens FIRST (the commit)…
            committed.add(row.id as string);
            // …then the response may be lost on the wire.
            return respond();
          },
          update: () => ({ eq: () => respond() }),
        }),
      };
      return { client, committed, dropResponses: (n: number) => { dropNextResponses = n; } };
    }

    it('server commits but client never sees the 200 -> retry -> exactly one row', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8 });
      const server = makeStatefulServer();

      server.dropResponses(1); // commit lands, ack lost
      const first = await flushSetOutbox(server.client);
      expect(first.flushedIds).toEqual([]); // client rightly thinks it failed
      expect(await outboxCount()).toBe(1); // entry retained for retry
      expect(server.committed.size).toBe(1); // …but the row IS on the server

      const second = await flushSetOutbox(server.client); // reconnect retry
      expect(second.flushedIds).toEqual(['a']);
      expect(await outboxCount()).toBe(0);
      expect(server.committed.size).toBe(1); // still exactly one row
    });

    it('app killed mid-flush (commit landed, queue delete never ran) -> reopen -> flush -> no dupes', async () => {
      // Simulate the post-kill state directly: the process died between the
      // server committing 'a' and the client deleting 'a' from the queue.
      // IndexedDB persisted the queue, so on reopen BOTH entries are present
      // while 'a' already exists server-side.
      const server = makeStatefulServer();
      server.committed.add('a'); // landed before the kill
      await enqueueSetInsert('a', { id: 'a', reps: 8 }); // still queued (delete never ran)
      await enqueueSetInsert('b', { id: 'b', reps: 9 }); // never attempted

      const result = await flushSetOutbox(server.client);

      expect(result.flushedIds).toEqual(['a', 'b']);
      expect(await outboxCount()).toBe(0);
      expect(server.committed.size).toBe(2); // a (once), b — no duplicate a
    });

    it('two tabs flushing the same persisted queue -> exactly one row per entry', async () => {
      // Two tabs are two module instances: the in-flight mutex does NOT span
      // them. They share IndexedDB (here: the same driver) and the same
      // server. Load a second copy of the module and race the flushes.
      const sharedDriver = memoryDriver();
      __setDriverForTests(sharedDriver);
      await enqueueSetInsert('a', { id: 'a', reps: 8 });
      await enqueueSetInsert('b', { id: 'b', reps: 9 });

      let tabB!: typeof import('../setOutbox');
      jest.isolateModules(() => {
        tabB = require('../setOutbox'); // second module instance = second tab
      });
      tabB.__setDriverForTests(sharedDriver);

      const server = makeStatefulServer();
      const [r1, r2] = await Promise.all([
        flushSetOutbox(server.client), // tab A
        tabB.flushSetOutbox(server.client), // tab B — separate mutex
      ]);

      expect(server.committed.size).toBe(2); // one row per entry, ever
      expect(await outboxCount()).toBe(0);
      // Between the two tabs every entry was flushed at least once
      const allFlushed = new Set([...r1.flushedIds, ...r2.flushedIds]);
      expect(allFlushed).toEqual(new Set(['a', 'b']));
      tabB.__setDriverForTests(null);
    });
  });

  describe('update entries and per-table semantics (finish-workout writes)', () => {
    it('flushes an update entry as .update().eq() on the matched row', async () => {
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { state: 'completed' });
      const { client, calls } = makeSupabase([{ error: null }]);

      const result = await flushSetOutbox(client);

      expect(result.flushedIds).toEqual(['finish:s1']);
      expect(calls).toEqual([
        { table: 'workout_sessions', op: 'update', row: { state: 'completed' }, matchId: 's1' },
      ]);
      expect(await outboxCount()).toBe(0);
    });

    it('re-enqueueing the same entry id replaces the payload (no duplicate work)', async () => {
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { session_rpe: 7 });
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { session_rpe: 9 });
      const entries = await listOutbox();
      expect(entries).toHaveLength(1);
      expect(entries[0].row).toEqual({ session_rpe: 9 });
    });

    it('uses the muscle-feedback conflict key for session_muscle_feedback upserts', async () => {
      await enqueueRowUpsert('feedback:s1:chest', 'session_muscle_feedback', {
        session_id: 's1',
        muscle_group: 'chest',
        pump: 2,
      });
      let seenOptions: Record<string, unknown> | undefined;
      const client: OutboxSupabase = {
        from: () => ({
          upsert: (_row, options) => {
            seenOptions = options as unknown as Record<string, unknown>;
            return Promise.resolve({ error: null });
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      };
      await flushSetOutbox(client);
      expect(seenOptions).toEqual({ onConflict: 'session_id,muscle_group', ignoreDuplicates: false });
    });

    it('a queued set flushes before a later-enqueued completion update', async () => {
      jest.useFakeTimers({ now: 1000 });
      await enqueueSetInsert('set-1', { id: 'set-1' });
      jest.setSystemTime(2000);
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { state: 'completed' });
      jest.useRealTimers();

      const { client, calls } = makeSupabase([{ error: null }]);
      await flushSetOutbox(client);
      expect(calls.map((c) => c.op)).toEqual(['upsert', 'update']);
    });

    it('a hung request times out, keeps the entry, and is treated as a network failure', async () => {
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { state: 'completed' });
      await enqueueSetInsert('later', { id: 'later' });
      // First op never settles; ordering: finish:s1 enqueued first.
      const { client, calls } = makeSupabase([{ delayMs: -1, error: null }]);

      const result = await flushSetOutbox(client, { timeoutMs: 25 });

      expect(result.flushedIds).toEqual([]);
      expect(result.failedIds).toEqual(['finish:s1']); // stopped before 'later'
      expect(calls).toHaveLength(1);
      const entries = await listOutbox();
      expect(entries.map((e) => e.id).sort()).toEqual(['finish:s1', 'later']);
      expect(entries.find((e) => e.id === 'finish:s1')?.attempts).toBe(1);
    });

    it('flushes an exercise_blocks target_sets patch (in-workout remove/add set while offline)', async () => {
      await enqueueRowUpdate('block-target-sets:b1', 'exercise_blocks', 'b1', { target_sets: 3 });
      // Adjusting again before sync replaces the queued patch (same entry id).
      await enqueueRowUpdate('block-target-sets:b1', 'exercise_blocks', 'b1', { target_sets: 2 });
      const { client, calls } = makeSupabase([{ error: null }]);

      const result = await flushSetOutbox(client);

      expect(result.flushedIds).toEqual(['block-target-sets:b1']);
      expect(calls).toEqual([
        { table: 'exercise_blocks', op: 'update', row: { target_sets: 2 }, matchId: 'b1' },
      ]);
      expect(await outboxCount()).toBe(0);
    });

    it('outboxCount(table) filters by table for the "N sets queued" banner', async () => {
      await enqueueSetInsert('set-1', { id: 'set-1' });
      await enqueueRowUpdate('finish:s1', 'workout_sessions', 's1', { state: 'completed' });
      expect(await outboxCount()).toBe(2);
      expect(await outboxCount('set_logs')).toBe(1);
      expect(await outboxCount('workout_sessions')).toBe(1);
    });
  });

  describe('edit / delete of a set that may already have landed', () => {
    /** Server with real rows, the (block, set_number) unique constraint, and lost acks. */
    function makeSetServer() {
      const rows = new Map<string, Record<string, unknown>>();
      const log: string[] = [];
      let dropNextResponses = 0;
      const respond = (error: { message: string; code?: string } | null = null) => {
        if (!error && dropNextResponses > 0) {
          dropNextResponses -= 1;
          return Promise.resolve({ error: { message: 'TypeError: Failed to fetch' } });
        }
        return Promise.resolve({ error });
      };
      const collides = (id: string, row: Record<string, unknown>) =>
        Array.from(rows.entries()).some(
          ([otherId, other]) =>
            otherId !== id &&
            other.exercise_block_id === row.exercise_block_id &&
            other.set_number === row.set_number
        );
      const UNIQUE = {
        message:
          'duplicate key value violates unique constraint "set_logs_exercise_block_id_set_number_key"',
        code: '23505',
      };
      const client = {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            const id = row.id as string;
            if (rows.has(id)) { log.push(`upsert-ignored:${id}`); return respond(); }
            if (collides(id, row)) { log.push(`upsert-refused:${id}`); return respond(UNIQUE); }
            rows.set(id, { ...row });
            log.push(`insert:${id}`);
            return respond();
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => {
              const existing = rows.get(id);
              if (!existing) { log.push(`update-miss:${id}`); return respond(); }
              const next = { ...existing, ...patch };
              if (collides(id, next)) { log.push(`update-refused:${id}`); return respond(UNIQUE); }
              rows.set(id, next);
              log.push(`update:${id}`);
              return respond();
            },
          }),
          delete: () => ({
            eq: (_c: string, id: string) => {
              log.push(`delete:${id}`);
              rows.delete(id);
              return respond();
            },
          }),
          select: () => ({
            eq: (_c: string, blockId: string) => ({
              order: () => ({
                limit: () => {
                  const max = Math.max(
                    0,
                    ...Array.from(rows.values())
                      .filter((r) => r.exercise_block_id === blockId)
                      .map((r) => r.set_number as number)
                  );
                  return Promise.resolve({ data: max ? [{ set_number: max }] : [], error: null });
                },
              }),
            }),
          }),
        }),
      };
      return {
        client: client as unknown as OutboxSupabase,
        rows,
        log,
        dropResponses: (n: number) => { dropNextResponses = n; },
      };
    }

    it('an edit made after a lost-ack insert reaches the server (not swallowed by ignoreDuplicates)', async () => {
      const server = makeSetServer();
      await enqueueSetInsert('a', { id: 'a', exercise_block_id: 'b1', set_number: 1, weight_kg: 100 });
      server.dropResponses(1);
      await flushSetOutbox(server.client); // lands, ack lost — still queued
      expect(server.rows.get('a')?.weight_kg).toBe(100);
      expect(await outboxCount()).toBe(1);

      await updateQueuedSet('a', { weight_kg: 90 }); // user corrects 100 -> 90
      expect((await getQueuedEntry('a'))?.dirty).toBe(true);

      const result = await flushSetOutbox(server.client);
      expect(result.flushedIds).toEqual(['a']);
      expect(server.rows.get('a')?.weight_kg).toBe(90);
      expect(await outboxCount()).toBe(0);
    });

    it('a delete made after a lost-ack insert removes the server row (tombstone replaces the insert)', async () => {
      const server = makeSetServer();
      await enqueueSetInsert('a', { id: 'a', exercise_block_id: 'b1', set_number: 1 });
      server.dropResponses(1);
      await flushSetOutbox(server.client);
      expect(server.rows.has('a')).toBe(true);

      await enqueueRowDelete('a', 'set_logs', 'a'); // same id: replaces the queued insert
      expect(await outboxCount()).toBe(1);
      const result = await flushSetOutbox(server.client);
      expect(result.flushedIds).toEqual(['a']);
      expect(server.rows.has('a')).toBe(false);
      expect(await outboxCount()).toBe(0);
    });

    it('a delete that replaces an insert mid-flight is kept and then served', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      const { client } = makeSupabase([{ error: null, delayMs: 30 }]);
      const flushing = flushSetOutbox(client);
      await new Promise((r) => setTimeout(r, 5));
      await enqueueRowDelete('a', 'set_logs', 'a');
      await flushing;
      expect((await getQueuedEntry('a'))?.op).toBe('delete'); // survived the post-write cleanup
    });

    it('a queued delete is not patchable, and a patched parked entry is released', async () => {
      await enqueueRowDelete('a', 'set_logs', 'a');
      expect(await updateQueuedSet('a', { reps: 5 })).toBe(false);
      await removeQueuedSet('a');

      await enqueueSetInsert('b', { id: 'b', reps: 9999 });
      for (let i = 0; i < 5; i++) {
        await flushSetOutbox(makeSupabase([{ error: { message: 'reps check', code: '23514' } }]).client);
      }
      expect((await getQueuedEntry('b'))?.parked).toBe(true);
      await updateQueuedSet('b', { reps: 12 }); // the fix
      expect(await getQueuedEntry('b')).toMatchObject({ parked: false, rejections: 0 });
    });

    it('a queued set whose number the server already holds takes the next free number instead of being lost', async () => {
      const server = makeSetServer();
      server.rows.set('x', { id: 'x', exercise_block_id: 'b1', set_number: 3 });
      await enqueueSetInsert('a', { id: 'a', exercise_block_id: 'b1', set_number: 3, reps: 8 });

      const result = await flushSetOutbox(server.client);
      expect(result.flushedIds).toEqual(['a']);
      expect(result.rejectedIds).toEqual([]);
      expect(server.rows.get('a')).toMatchObject({ set_number: 4, reps: 8 });
      expect(await outboxCount()).toBe(0);
    });

    it('a stale queued renumber is dropped, but the edit travelling with it still lands', async () => {
      const server = makeSetServer();
      server.rows.set('x', { id: 'x', exercise_block_id: 'b1', set_number: 1 });
      server.rows.set('y', { id: 'y', exercise_block_id: 'b1', set_number: 2, weight_kg: 100 });
      server.rows.set('z', { id: 'z', exercise_block_id: 'b1', set_number: 3 });
      await enqueueRowUpdate('set-edit:y', 'set_logs', 'y', { set_number: 1, weight_kg: 95 });
      await enqueueRowUpdate('set-edit:z', 'set_logs', 'z', { set_number: 1 });

      const result = await flushSetOutbox(server.client);
      expect(result.rejectedIds).toEqual([]);
      expect(server.rows.get('y')).toMatchObject({ set_number: 2, weight_kg: 95 });
      expect(server.rows.get('z')).toMatchObject({ set_number: 3 });
      expect(await outboxCount()).toBe(0);
    });

    it('removeQueuedEntryIfUnchanged only removes the exact payload', async () => {
      await enqueueSetInsert('a', { id: 'a', reps: 8 });
      expect(await removeQueuedEntryIfUnchanged('a', { id: 'a', reps: 9 })).toBe('kept');
      expect(await removeQueuedEntryIfUnchanged('a', { id: 'a', reps: 8 })).toBe('removed');
      expect(await removeQueuedEntryIfUnchanged('a', { id: 'a', reps: 8 })).toBe('absent');
    });

    it('entries enqueued in the same millisecond keep their enqueue order', async () => {
      jest.useFakeTimers({ now: 5000 });
      try {
        // ids chosen so that id order is the REVERSE of enqueue order
        await enqueueRowDelete('z', 'set_logs', 'z');
        await enqueueRowUpdate('set-edit:m', 'set_logs', 'm', { set_number: 1 });
        await enqueueRowUpdate('set-edit:a', 'set_logs', 'a', { set_number: 2 });
      } finally {
        jest.useRealTimers();
      }
      expect((await listOutbox()).map((e) => e.id)).toEqual(['z', 'set-edit:m', 'set-edit:a']);
    });

    it('restamp moves a patched entry (and motion captures that reference it) to the back', async () => {
      jest.useFakeTimers({ now: 1000 });
      try {
        await enqueueSetInsert('set-3', { id: 'set-3', set_number: 3 });
        await enqueueRowUpsert('cap-1', 'motion_captures', { id: 'cap-1', set_id: 'set-3' });
        jest.setSystemTime(2000);
        await enqueueRowDelete('set-1', 'set_logs', 'set-1');
        await updateQueuedSet('set-3', { set_number: 2 }, { restamp: true });
      } finally {
        jest.useRealTimers();
      }
      expect((await listOutbox()).map((e) => e.id)).toEqual(['set-1', 'set-3', 'cap-1']);
    });
  });

  describe('isPermanentRejection', () => {
    it.each([
      [{ message: 'unique', code: '23505' }, true],
      [{ message: 'check', code: '23514' }, true],
      [{ message: 'fk', code: '23503' }, true],
      [{ message: 'rls', code: '42501' }, true],
      [{ message: 'bad input', code: '22P02' }, true],
      [{ message: 'no column', code: 'PGRST204' }, true],
      [{ message: 'JWT expired', code: 'PGRST301' }, false],
      [{ message: 'connection', code: 'PGRST002' }, false],
      [{ message: 'timeout', code: '57014' }, false],
      [{ message: 'too many clients', code: '53300' }, false],
      [{ message: 'could not serialize', code: '40001' }, false],
      [{ message: '<html>503</html>' }, false],
      [{ message: 'Failed to fetch' }, false],
    ])('%j -> %s', (error, expected) => {
      expect(isPermanentRejection(error)).toBe(expected);
    });

    it('handles null/undefined', () => {
      expect(isPermanentRejection(null)).toBe(false);
      expect(isPermanentRejection(undefined)).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it.each([
      ['Failed to fetch', true],
      ['NetworkError when attempting to fetch resource', true],
      ['Load failed', true],
      ['The operation timed out', true],
      ['duplicate key value violates unique constraint', false],
    ])('%s -> %s', (message, expected) => {
      expect(isNetworkError({ message })).toBe(expected);
    });

    it('treats coded PostgREST errors as non-network', () => {
      expect(isNetworkError({ message: 'anything', code: '23505' })).toBe(false);
    });

    it('handles null/undefined', () => {
      expect(isNetworkError(null)).toBe(false);
      expect(isNetworkError(undefined)).toBe(false);
    });
  });

  describe('isMissingColumnError', () => {
    it('detects the PGRST204 schema-cache column miss by code', () => {
      expect(isMissingColumnError({ message: 'anything', code: 'PGRST204' })).toBe(true);
    });

    it('detects it by message when the code is absent', () => {
      expect(
        isMissingColumnError({
          message: "Could not find the 'set_role' column of 'set_logs' in the schema cache",
        })
      ).toBe(true);
    });

    it('is false for unrelated errors and null/undefined', () => {
      expect(isMissingColumnError(RLS_ERROR)).toBe(false);
      expect(isMissingColumnError(NETWORK_ERROR)).toBe(false);
      expect(isMissingColumnError(null)).toBe(false);
      expect(isMissingColumnError(undefined)).toBe(false);
    });
  });

  describe('block-order replay (performed-order / drag persistence fallback)', () => {
    // exercise_blocks."order" is UNIQUE per session, so the workout page
    // queues a failed order save as park-then-final per-block patches (see
    // persistBlockOrder). The flush replays entries one row at a time in
    // enqueue order — these tests pin that the sequence stays collision-free
    // against a constraint-enforcing stub, and that a newer queued reorder
    // replaces the older one instead of stacking.
    function makeOrderConstraintSupabase(initialOrders: Record<string, number>) {
      const orders = { ...initialOrders };
      const violations: string[] = [];
      const client: OutboxSupabase = {
        from: () => ({
          upsert: () => Promise.resolve({ error: null }),
          update: (row: Record<string, unknown>) => ({
            eq: (_column: string, id: string) => {
              const next = row.order as number;
              const taken = Object.entries(orders).some(([bid, o]) => bid !== id && o === next);
              if (taken) {
                violations.push(`${id}->${next}`);
                return Promise.resolve({
                  error: { message: 'duplicate key value violates unique constraint', code: '23505' },
                });
              }
              orders[id] = next;
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
      return { client, orders, violations };
    }

    const enqueueOrder = async (ids: string[]) => {
      for (let i = 0; i < ids.length; i++) {
        await enqueueRowUpdate(`block-order:park:${ids[i]}`, 'exercise_blocks', ids[i], {
          order: i + 1001,
        });
      }
      for (let i = 0; i < ids.length; i++) {
        await enqueueRowUpdate(`block-order:write:${ids[i]}`, 'exercise_blocks', ids[i], {
          order: i + 1,
        });
      }
    };

    it('replays park-then-final entries without unique-order collisions', async () => {
      await enqueueOrder(['b3', 'b1', 'b2']); // performed order: b3 first
      const db = makeOrderConstraintSupabase({ b1: 1, b2: 2, b3: 3 });
      const result = await flushSetOutbox(db.client);
      expect(db.violations).toEqual([]);
      expect(result.failedIds).toEqual([]);
      expect(db.orders).toEqual({ b3: 1, b1: 2, b2: 3 });
      expect(await outboxCount()).toBe(0);
    });

    it('a newer queued reorder replaces the older one (stable entry ids)', async () => {
      await enqueueOrder(['b2', 'b1']);
      await enqueueOrder(['b1', 'b2']); // user reordered again while offline
      expect(await outboxCount()).toBe(4); // replaced, not stacked
      const db = makeOrderConstraintSupabase({ b1: 1, b2: 2 });
      await flushSetOutbox(db.client);
      expect(db.violations).toEqual([]);
      expect(db.orders).toEqual({ b1: 1, b2: 2 });
    });
  });

  describe('withoutOptionalSetLogColumns', () => {
    it('strips the migration-gated columns and leaves the rest untouched', () => {
      const row = { id: 'a', reps: 8, weight_kg: 20, set_role: 'ramp', suggestion_engine_version: 2 };
      expect(withoutOptionalSetLogColumns(row)).toEqual({ id: 'a', reps: 8, weight_kg: 20 });
    });

    it('does not mutate the input row', () => {
      const row = { id: 'a', set_role: 'working' };
      withoutOptionalSetLogColumns(row);
      expect(row).toHaveProperty('set_role', 'working');
    });
  });
});
