/**
 * setOutbox — offline write queue for set logs (P0-2 in the UX audit).
 *
 * Sets logged while offline (or when the insert fails on a network error)
 * are persisted here and flushed to Supabase when connectivity returns.
 * Storage is IndexedDB so queued sets survive tab closes and PWA restarts;
 * a Map-based driver stands in when IndexedDB is unavailable (SSR, some
 * webviews, unit tests) — queued sets then survive only the page's life,
 * which still beats dropping them.
 *
 * Dedupe strategy: set ids are generated CLIENT-side (crypto.randomUUID)
 * before the first insert attempt, and flushes insert with
 * `ignoreDuplicates` upsert semantics — so a retry after a half-failed
 * flush (row inserted, ack lost) cannot double-log a set.
 */

export interface OutboxEntry {
  /** Client-generated set_logs.id (uuid) — also the dedupe key. */
  id: string;
  /** Table the row belongs to (only set_logs today, but keep it explicit). */
  table: 'set_logs';
  /** Exact row payload for insert, snake_case column names. */
  row: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
}

interface OutboxDriver {
  put(entry: OutboxEntry): Promise<void>;
  getAll(): Promise<OutboxEntry[]>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<OutboxEntry | undefined>;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

const DB_NAME = 'hypertrack-offline';
const DB_VERSION = 1;
const STORE = 'set-outbox';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(makeReq: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = makeReq(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

const idbDriver: OutboxDriver = {
  put: (entry) => idbRequest((s) => s.put(entry), 'readwrite').then(() => undefined),
  getAll: () => idbRequest((s) => s.getAll(), 'readonly') as Promise<OutboxEntry[]>,
  delete: (id) => idbRequest((s) => s.delete(id), 'readwrite').then(() => undefined),
  get: (id) => idbRequest((s) => s.get(id), 'readonly') as Promise<OutboxEntry | undefined>,
};

/** In-memory fallback (SSR / tests / no-IDB webviews). */
function createMemoryDriver(): OutboxDriver {
  const map = new Map<string, OutboxEntry>();
  return {
    put: async (entry) => { map.set(entry.id, { ...entry }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id) => { map.delete(id); },
    get: async (id) => map.get(id),
  };
}

let driver: OutboxDriver | null = null;
function getDriver(): OutboxDriver {
  if (!driver) {
    driver =
      typeof indexedDB !== 'undefined' ? idbDriver : createMemoryDriver();
  }
  return driver;
}

/** Test seam: force a specific driver (e.g. in-memory) and reset state. */
export function __setDriverForTests(d: OutboxDriver | null): void {
  driver = d;
  flushInFlight = null;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export async function enqueueSetInsert(id: string, row: Record<string, unknown>): Promise<void> {
  await getDriver().put({ id, table: 'set_logs', row, enqueuedAt: Date.now(), attempts: 0 });
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const all = await getDriver().getAll();
  return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

export async function outboxCount(): Promise<number> {
  return (await getDriver().getAll()).length;
}

/** Merge a patch into a queued row (edit-before-sync). True if it was queued. */
export async function updateQueuedSet(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const d = getDriver();
  const entry = await d.get(id);
  if (!entry) return false;
  await d.put({ ...entry, row: { ...entry.row, ...patch } });
  return true;
}

/** Drop a queued row (delete-before-sync). True if it was queued. */
export async function removeQueuedSet(id: string): Promise<boolean> {
  const d = getDriver();
  const entry = await d.get(id);
  if (!entry) return false;
  await d.delete(id);
  return true;
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

/** Minimal shape of the supabase client the flush needs (eases testing). */
export interface OutboxSupabase {
  from(table: string): {
    upsert(
      values: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean }
    ): PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
}

export interface FlushResult {
  flushedIds: string[];
  failedIds: string[];
}

/** True for connectivity-shaped failures (retry later), false for real rejections. */
export function isNetworkError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && /^\d/.test(err.code)) return false; // PostgREST/SQLSTATE codes = server answered
  return /fetch|network|load failed|timed? ?out|abort|offline/i.test(err.message ?? '');
}

let flushInFlight: Promise<FlushResult> | null = null;

/**
 * Push every queued set to the database. Concurrency-safe: overlapping calls
 * (online event + page mount firing together) share one in-flight flush, so
 * double-flush cannot double-insert even before the upsert dedupe kicks in.
 */
export function flushSetOutbox(supabase: OutboxSupabase): Promise<FlushResult> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = doFlush(supabase).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function doFlush(supabase: OutboxSupabase): Promise<FlushResult> {
  const d = getDriver();
  const entries = await listOutbox();
  const flushedIds: string[] = [];
  const failedIds: string[] = [];

  for (const entry of entries) {
    try {
      // ignoreDuplicates upsert: a row that already landed (retry after a
      // lost ack) is a silent no-op instead of a duplicate-key error.
      const { error } = await supabase
        .from(entry.table)
        .upsert(entry.row, { onConflict: 'id', ignoreDuplicates: true });

      if (!error) {
        await d.delete(entry.id);
        flushedIds.push(entry.id);
      } else if (isNetworkError(error)) {
        // Still offline (or flapping) — keep the entry, stop hammering.
        await d.put({ ...entry, attempts: entry.attempts + 1 });
        failedIds.push(entry.id);
        break;
      } else {
        // Server rejected the row (RLS, constraint, deleted parent block…).
        // Retrying forever would wedge the queue: give up after 5 attempts.
        if (entry.attempts + 1 >= 5) {
          await d.delete(entry.id);
        } else {
          await d.put({ ...entry, attempts: entry.attempts + 1 });
        }
        failedIds.push(entry.id);
      }
    } catch (e) {
      await d.put({ ...entry, attempts: entry.attempts + 1 });
      failedIds.push(entry.id);
      if (isNetworkError(e as Error)) break;
    }
  }

  return { flushedIds, failedIds };
}
