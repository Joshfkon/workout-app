/**
 * Unit tests for the offline set outbox (P0-2).
 * Runs against the in-memory driver (jsdom has no IndexedDB); the IDB driver
 * shares all queue/flush logic, differing only in storage primitives.
 */

import {
  __setDriverForTests,
  enqueueSetInsert,
  listOutbox,
  outboxCount,
  updateQueuedSet,
  removeQueuedSet,
  flushSetOutbox,
  isNetworkError,
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

/** Supabase stub whose upsert behavior is scripted per call. */
function makeSupabase(script: Array<{ error: { message: string; code?: string } | null; delayMs?: number }>) {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  let i = 0;
  const client: OutboxSupabase = {
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        calls.push({ table, row });
        const step = script[Math.min(i, script.length - 1)];
        i += 1;
        type UpsertResult = { error: { message: string; code?: string } | null };
        const result: UpsertResult = { error: step?.error ?? null };
        if (step?.delayMs) {
          return new Promise<UpsertResult>((resolve) => setTimeout(() => resolve(result), step.delayMs));
        }
        return Promise.resolve(result);
      },
    }),
  };
  return { client, calls };
}

const NETWORK_ERROR = { message: 'TypeError: Failed to fetch' };
const RLS_ERROR = { message: 'new row violates row-level security policy', code: '42501' };

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

    it('drops a server-rejected entry after 5 attempts instead of wedging the queue', async () => {
      await enqueueSetInsert('a', { id: 'a' });
      for (let attempt = 1; attempt <= 5; attempt++) {
        const { client } = makeSupabase([{ error: RLS_ERROR }]);
        await flushSetOutbox(client);
      }
      expect(await outboxCount()).toBe(0);
    });

    it('server rejection does not block later entries', async () => {
      await enqueueSetInsert('bad', { id: 'bad' });
      await enqueueSetInsert('good', { id: 'good' });
      const { client } = makeSupabase([{ error: RLS_ERROR }, { error: null }]);

      const result = await flushSetOutbox(client);
      expect(result.failedIds).toEqual(['bad']);
      expect(result.flushedIds).toEqual(['good']);
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
      const client: OutboxSupabase = {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            // Server-side apply happens FIRST (the commit)…
            committed.add(row.id as string);
            // …then the response may be lost on the wire.
            if (dropNextResponses > 0) {
              dropNextResponses -= 1;
              return Promise.resolve({ error: { message: 'TypeError: Failed to fetch' } });
            }
            return Promise.resolve({ error: null });
          },
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
});
