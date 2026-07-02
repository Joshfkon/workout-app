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
