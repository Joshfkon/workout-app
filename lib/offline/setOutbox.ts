/**
 * setOutbox — offline write queue for workout writes (P0-2 in the UX audit).
 *
 * Sets logged while offline (or when the insert fails on a network error)
 * are persisted here and flushed to Supabase when connectivity returns.
 * The finish-workout flow reuses the same queue for its completion update
 * and per-muscle feedback rows, so finishing is durable and never blocks
 * the UI on the network.
 * Storage is IndexedDB so queued writes survive tab closes and PWA restarts;
 * a Map-based driver stands in when IndexedDB is unavailable (SSR, some
 * webviews, unit tests) — queued writes then survive only the page's life,
 * which still beats dropping them.
 *
 * Dedupe strategy: set ids are generated CLIENT-side (crypto.randomUUID)
 * before the first insert attempt, and flushes insert with
 * `ignoreDuplicates` upsert semantics — so a retry after a half-failed
 * flush (row inserted, ack lost) cannot double-log a set. Update entries
 * (session completion/claim) and feedback upserts are idempotent by
 * construction, so retries after a lost ack are safe there too.
 */

import { now as clockNow } from '@/lib/clock';

export type OutboxTable =
  | 'set_logs'
  | 'workout_sessions'
  | 'session_muscle_feedback'
  | 'exercise_blocks'
  | 'motion_captures';

export interface OutboxEntry {
  /**
   * Queue key. For set_logs this is the client-generated set id (uuid),
   * which doubles as the dedupe key; other entries use stable synthetic
   * keys (`finish:<sessionId>`, `claim:<sessionId>`, …) so re-enqueueing
   * replaces rather than duplicates.
   */
  id: string;
  /** Table the row belongs to. Entries persisted before this field allowed multiple tables are set_logs. */
  table: OutboxTable;
  /** How to apply the row. Legacy persisted entries lack it — treated as 'insert'. */
  op?: 'insert' | 'update';
  /** For op:'update' — the primary-key value the patch applies to. */
  matchId?: string;
  /** Exact row payload (insert/upsert) or patch (update), snake_case column names. */
  row: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
}

/** Upsert conflict handling per table (insert entries only). */
const UPSERT_OPTIONS: Record<OutboxTable, { onConflict: string; ignoreDuplicates: boolean }> = {
  // Retry after a lost ack must not double-log a set — ignore duplicates.
  set_logs: { onConflict: 'id', ignoreDuplicates: true },
  // Feedback rows are full-value overwrites keyed on (session, muscle);
  // re-applying the same values is a no-op, so plain upsert is idempotent.
  session_muscle_feedback: { onConflict: 'session_id,muscle_group', ignoreDuplicates: false },
  // workout_sessions rows only ever go through op:'update'.
  workout_sessions: { onConflict: 'id', ignoreDuplicates: true },
  // exercise_blocks rows only ever go through op:'update' (target_sets patches).
  exercise_blocks: { onConflict: 'id', ignoreDuplicates: true },
  // Motion captures use client-generated ids like set_logs; retry after a
  // lost ack must not double-log a capture. Enqueued AFTER their set's entry
  // (flush is enqueuedAt-ordered), so the set_id FK is satisfied by the time
  // a capture row is attempted.
  motion_captures: { onConflict: 'id', ignoreDuplicates: true },
};

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
  await getDriver().put({ id, table: 'set_logs', row, enqueuedAt: clockNow().getTime(), attempts: 0 });
}

/** Queue an upsert row for any supported table (idempotent per UPSERT_OPTIONS). */
export async function enqueueRowUpsert(
  entryId: string,
  table: OutboxTable,
  row: Record<string, unknown>
): Promise<void> {
  await getDriver().put({ id: entryId, table, op: 'insert', row, enqueuedAt: clockNow().getTime(), attempts: 0 });
}

/** Queue a patch to a single row (matched on its primary key). Idempotent. */
export async function enqueueRowUpdate(
  entryId: string,
  table: OutboxTable,
  matchId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await getDriver().put({
    id: entryId,
    table,
    op: 'update',
    matchId,
    row: patch,
    enqueuedAt: clockNow().getTime(),
    attempts: 0,
  });
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const all = await getDriver().getAll();
  return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

export async function outboxCount(table?: OutboxTable): Promise<number> {
  const all = await getDriver().getAll();
  return table ? all.filter((e) => e.table === table).length : all.length;
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
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string
      ): PromiseLike<{ error: { message: string; code?: string } | null }>;
    };
  };
}

export interface FlushResult {
  flushedIds: string[];
  failedIds: string[];
  /**
   * Subset of failedIds the SERVER rejected (RLS, constraint, deleted
   * parent…) — the write reached the database and was refused, as opposed
   * to a connectivity failure. Entries are still retried up to the attempt
   * cap, but callers holding optimistic state that assumed the write would
   * land should reconcile it against the server when an id shows up here.
   */
  rejectedIds: string[];
}

/** True for connectivity-shaped failures (retry later), false for real rejections. */
export function isNetworkError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && /^\d/.test(err.code)) return false; // PostgREST/SQLSTATE codes = server answered
  return /fetch|network|load failed|timed? ?out|abort|offline/i.test(err.message ?? '');
}

/**
 * set_logs columns added by migrations that may not yet exist in a database
 * running behind the deployed code (e.g. code shipped before the migration was
 * applied). If PostgREST rejects a write because one of these isn't in its
 * schema cache, we strip them and retry so the core set still saves — the data
 * they carry is non-critical: set_role/suggestion_engine_version are recomputed
 * on backfill (20260709000002_set_roles.sql), and a missing location_id simply
 * degrades the set to legacy null-location (unknown gym) until the location
 * calibration migration (20260711000002_location_scoped_calibration.sql) lands.
 */
export const OPTIONAL_SET_LOG_COLUMNS = ['set_role', 'suggestion_engine_version', 'location_id'] as const;

/**
 * True for a PostgREST "column not found in the schema cache" rejection
 * (code PGRST204) — the database is missing a column the write references.
 */
export function isMissingColumnError(
  err: { message?: string; code?: string } | null | undefined
): boolean {
  if (!err) return false;
  if (err.code === 'PGRST204') return true;
  return /Could not find the .*column.* in the schema cache/i.test(err.message ?? '');
}

/** A copy of `row` with the optional (migration-gated) set_logs columns removed. */
export function withoutOptionalSetLogColumns(
  row: Record<string, unknown>
): Record<string, unknown> {
  const clean = { ...row };
  for (const col of OPTIONAL_SET_LOG_COLUMNS) delete clean[col];
  return clean;
}

let flushInFlight: Promise<FlushResult> | null = null;

/**
 * A fetch that never settles (dead radio, hung proxy) must not wedge the
 * queue: cap every remote operation and treat the timeout as a network error
 * (entry retained, retried on the next flush). Late server-side success is
 * harmless — every entry kind is idempotent.
 */
const OP_TIMEOUT_MS = 10_000;

function withTimeout<T>(op: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`outbox write timed out after ${ms}ms`)),
      ms
    );
    op.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Push every queued write to the database. Concurrency-safe: overlapping
 * calls (online event + page mount firing together) share one in-flight
 * flush, so double-flush cannot double-insert even before the upsert dedupe
 * kicks in.
 */
export function flushSetOutbox(
  supabase: OutboxSupabase,
  opts?: { timeoutMs?: number }
): Promise<FlushResult> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = doFlush(supabase, opts?.timeoutMs ?? OP_TIMEOUT_MS).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function doFlush(supabase: OutboxSupabase, timeoutMs: number): Promise<FlushResult> {
  const d = getDriver();
  const entries = await listOutbox();
  const flushedIds: string[] = [];
  const failedIds: string[] = [];
  const rejectedIds: string[] = [];

  for (const entry of entries) {
    try {
      // Updates patch a single row by primary key; inserts go through
      // ignoreDuplicates/onConflict upsert so a row that already landed
      // (retry after a lost ack) is a silent no-op instead of an error.
      const upsertOptions = UPSERT_OPTIONS[entry.table] ?? UPSERT_OPTIONS.set_logs;
      const op =
        entry.op === 'update'
          ? supabase
              .from(entry.table)
              .update(entry.row)
              .eq('id', entry.matchId ?? (entry.row.id as string))
          : supabase.from(entry.table).upsert(entry.row, upsertOptions);
      let { error } = await withTimeout(op, timeoutMs);

      // Schema-cache column miss (migration lag): drop the optional columns and
      // retry once so the core write still lands instead of wedging the queue.
      if (error && entry.op !== 'update' && entry.table === 'set_logs' && isMissingColumnError(error)) {
        const retryOp = supabase
          .from(entry.table)
          .upsert(withoutOptionalSetLogColumns(entry.row), upsertOptions);
        ({ error } = await withTimeout(retryOp, timeoutMs));
      }

      if (!error) {
        // Delete only the payload we actually sent: a same-id entry may have
        // been replaced with a newer patch while this write was in flight
        // (edit-before-sync semantics) — deleting blindly would drop that
        // newer write. A kept entry goes out on the next flush.
        const current = await d.get(entry.id);
        if (!current || JSON.stringify(current.row) === JSON.stringify(entry.row)) {
          await d.delete(entry.id);
        }
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
        rejectedIds.push(entry.id);
      }
    } catch (e) {
      await d.put({ ...entry, attempts: entry.attempts + 1 });
      failedIds.push(entry.id);
      if (isNetworkError(e as Error)) break;
    }
  }

  return { flushedIds, failedIds, rejectedIds };
}
