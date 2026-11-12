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
 * Loss policy: an entry leaves the queue because it was WRITTEN. Failures that
 * say nothing about the row (no connectivity, timeout, 5xx, expired token)
 * are retried indefinitely. Only a genuine server refusal (constraint, RLS —
 * see `isPermanentRejection`) is counted, and even then a logged set or a
 * finished workout is parked and surfaced, never deleted.
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
  | 'motion_captures'
  | 'stabilizer_warning_events'
  | 'workout_plan_review_events';

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
  op?: 'insert' | 'update' | 'delete';
  /** For op:'update' / 'delete' — the primary-key value the write applies to. */
  matchId?: string;
  /** Exact row payload (insert/upsert) or patch (update), snake_case column names. Empty for deletes. */
  row: Record<string, unknown>;
  enqueuedAt: number;
  /** Every failed delivery, whatever the cause. Informational only. */
  attempts: number;
  /**
   * How many times the SERVER permanently refused this write (constraint /
   * RLS / malformed row). Connectivity, auth and 5xx failures never count:
   * they are retried for as long as it takes.
   */
  rejections?: number;
  /**
   * Parked: the server refused the write `MAX_REJECTIONS` times and it belongs
   * to a table whose rows must never be thrown away (a logged set, a finished
   * workout). It stays in the queue, is skipped by ordinary flushes, and is
   * surfaced to the user; `unparkOutboxEntries` (page mount / reconnect /
   * explicit retry) or an edit of the row puts it back in line.
   */
  parked?: boolean;
  /** The last server refusal, for display / diagnosis. */
  lastError?: string;
  /**
   * An insert entry whose row was patched AFTER it was enqueued. The first
   * attempt may already have landed (ack lost), in which case the
   * `ignoreDuplicates` re-send is a no-op and the patch would never reach the
   * server — so a dirty entry is followed by a real UPDATE of the row.
   */
  dirty?: boolean;
}

/** Tables whose queued writes are user data that must never be auto-deleted. */
const NEVER_DROP_TABLES: ReadonlySet<OutboxTable> = new Set<OutboxTable>([
  'set_logs',
  'workout_sessions',
  'session_muscle_feedback',
]);

/** Permanent refusals tolerated before an entry is parked (or, for non-critical tables, dropped). */
const MAX_REJECTIONS = 5;

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
  // Warning events use client-generated ids; the row is upserted when shown
  // and the user's response lands later as an op:'update' patch. Overwrite on
  // conflict (not ignore) so a re-enqueued shown-row refreshes its ratios.
  stabilizer_warning_events: { onConflict: 'id', ignoreDuplicates: false },
  // Plan review decisions are written once, at Start, with client-generated
  // ids; a retry after a lost ack must not duplicate a decision.
  workout_plan_review_events: { onConflict: 'id', ignoreDuplicates: true },
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
/**
 * v2 adds the `post-finish` store (see lib/offline/postFinishQueue.ts). The
 * upgrade is additive — `set-outbox` and anything queued in it survive — so a
 * client that has been offline across the upgrade still flushes its backlog.
 */
const DB_VERSION = 2;
const STORE = 'set-outbox';
export const POST_FINISH_STORE = 'post-finish';

const STORES = [STORE, POST_FINISH_STORE];

export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(
  storeName: string,
  makeReq: (store: IDBObjectStore) => IDBRequest<T>,
  mode: IDBTransactionMode
): Promise<T> {
  return openOfflineDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = makeReq(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

/** Minimal keyed-record store, the shape every offline queue here needs. */
export interface OfflineStore<T extends { id: string }> {
  put(record: T): Promise<void>;
  getAll(): Promise<T[]>;
  delete(id: string): Promise<void>;
  get(id: string): Promise<T | undefined>;
}

export function createIdbStore<T extends { id: string }>(storeName: string): OfflineStore<T> {
  return {
    put: (record) => idbRequest(storeName, (s) => s.put(record), 'readwrite').then(() => undefined),
    getAll: () => idbRequest(storeName, (s) => s.getAll(), 'readonly') as Promise<T[]>,
    delete: (id) => idbRequest(storeName, (s) => s.delete(id), 'readwrite').then(() => undefined),
    get: (id) => idbRequest(storeName, (s) => s.get(id), 'readonly') as Promise<T | undefined>,
  };
}

/** In-memory fallback (SSR / tests / no-IDB webviews). */
export function createMemoryStore<T extends { id: string }>(): OfflineStore<T> {
  const map = new Map<string, T>();
  return {
    put: async (record) => { map.set(record.id, { ...record }); },
    getAll: async () => Array.from(map.values()),
    delete: async (id) => { map.delete(id); },
    get: async (id) => map.get(id),
  };
}

/** The idb store when IndexedDB exists, otherwise a page-lifetime map. */
export function resolveOfflineStore<T extends { id: string }>(storeName: string): OfflineStore<T> {
  return typeof indexedDB !== 'undefined' ? createIdbStore<T>(storeName) : createMemoryStore<T>();
}

type OutboxDriverImpl = OutboxDriver;

let driver: OutboxDriverImpl | null = null;
function getDriver(): OutboxDriverImpl {
  if (!driver) driver = resolveOfflineStore<OutboxEntry>(STORE);
  return driver;
}

/** Test seam: force a specific driver (e.g. in-memory) and reset state. */
export function __setDriverForTests(d: OutboxDriver | null): void {
  driver = d;
  flushInFlight = null;
  lastEnqueuedAt = 0;
  directWritesInFlight.clear();
}

/**
 * Entries whose write is ALSO being sent directly right now (write-ahead: a
 * set is queued first, then inserted; the entry is removed when the insert
 * succeeds). The flush leaves these alone so the same row is not sent twice
 * in parallel, and a delete of the row can wait for the insert to settle
 * instead of racing it to the server.
 */
const directWritesInFlight = new Map<string, Promise<unknown>>();

/** Register a direct write for a queued entry; cleared when it settles. */
export function trackDirectWrite<T>(entryId: string, write: Promise<T>): Promise<T> {
  directWritesInFlight.set(entryId, write);
  const clear = () => {
    if (directWritesInFlight.get(entryId) === write) directWritesInFlight.delete(entryId);
  };
  write.then(clear, clear);
  return write;
}

/** The direct write currently on the wire for this entry, if any. */
export function directWriteInFlight(entryId: string): Promise<unknown> | undefined {
  return directWritesInFlight.get(entryId);
}

/**
 * Enqueue stamp. The flush replays entries in `enqueuedAt` order and several
 * callers depend on that order being the order they enqueued in (a delete
 * before the renumbering it makes room for, park-then-write block orders), so
 * two entries written in the same millisecond must not tie.
 */
let lastEnqueuedAt = 0;
function nextEnqueuedAt(): number {
  const t = clockNow().getTime();
  lastEnqueuedAt = t > lastEnqueuedAt ? t : lastEnqueuedAt + 1;
  return lastEnqueuedAt;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export async function enqueueSetInsert(id: string, row: Record<string, unknown>): Promise<void> {
  await getDriver().put({ id, table: 'set_logs', row, enqueuedAt: nextEnqueuedAt(), attempts: 0 });
}

/** Queue an upsert row for any supported table (idempotent per UPSERT_OPTIONS). */
export async function enqueueRowUpsert(
  entryId: string,
  table: OutboxTable,
  row: Record<string, unknown>
): Promise<void> {
  await getDriver().put({ id: entryId, table, op: 'insert', row, enqueuedAt: nextEnqueuedAt(), attempts: 0 });
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
    enqueuedAt: nextEnqueuedAt(),
    attempts: 0,
  });
}

/**
 * Queue the deletion of a single row (matched on its primary key). Idempotent:
 * deleting a row that is already gone — or never arrived — matches nothing.
 *
 * Re-using a queued INSERT's entry id replaces that insert with its own
 * tombstone, which is how a set deleted before it synced is handled: the
 * insert may already have landed (lost ack) or be on the wire, so "forget the
 * queue entry" is not enough — the row has to be deleted for real.
 */
export async function enqueueRowDelete(
  entryId: string,
  table: OutboxTable,
  matchId: string
): Promise<void> {
  await getDriver().put({
    id: entryId,
    table,
    op: 'delete',
    matchId,
    row: {},
    enqueuedAt: nextEnqueuedAt(),
    attempts: 0,
  });
}

/** The queued entry under this id, if any. */
export async function getQueuedEntry(entryId: string): Promise<OutboxEntry | undefined> {
  return getDriver().get(entryId);
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const all = await getDriver().getAll();
  return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

/**
 * Is this entry still waiting to be written?
 *
 * The honest question to ask about a queued write, and the one callers should
 * gate on instead of "did MY flush report it". A `FlushResult` describes the
 * queue snapshot the flush that produced it happened to see — and because
 * overlapping flushes share one in-flight promise, that may not be the
 * snapshot containing your entry. An entry that is ABSENT here has left the
 * queue: `doFlush` deletes only after a successful write — or, for the
 * non-critical tables only, after the server refused it `MAX_REJECTIONS`
 * times. set_logs / workout_sessions / session_muscle_feedback entries are
 * never given up on: a refused one is PARKED and still counts as queued here.
 */
export async function hasQueuedEntry(entryId: string): Promise<boolean> {
  return (await getDriver().get(entryId)) !== undefined;
}

export async function outboxCount(table?: OutboxTable): Promise<number> {
  const all = await getDriver().getAll();
  return table ? all.filter((e) => e.table === table).length : all.length;
}

/**
 * Merge a patch into a queued row (edit-before-sync). True if it was queued.
 *
 * - A queued DELETE is not patchable (false): the row is going away.
 * - A patched INSERT is marked `dirty`, so the flush follows it with a real
 *   UPDATE in case the original insert already landed.
 * - A parked entry is put back in line: the edit may be exactly what fixes
 *   the row the server refused.
 * - `restamp` moves the entry to the BACK of the queue. Renumbering needs it:
 *   a set_number patch is only valid after the delete that vacated the slot,
 *   and that delete was enqueued later than the entry being patched. Queued
 *   motion captures that reference a restamped set are moved behind it so
 *   their set_id FK still resolves.
 */
export async function updateQueuedSet(
  id: string,
  patch: Record<string, unknown>,
  opts?: { restamp?: boolean }
): Promise<boolean> {
  const d = getDriver();
  const entry = await d.get(id);
  if (!entry || entry.op === 'delete') return false;
  const isInsert = (entry.op ?? 'insert') === 'insert';
  const next: OutboxEntry = { ...entry, row: { ...entry.row, ...patch } };
  if (isInsert) next.dirty = true;
  if (entry.parked) {
    next.parked = false;
    next.rejections = 0;
  }
  if (opts?.restamp) next.enqueuedAt = nextEnqueuedAt();
  await d.put(next);
  if (opts?.restamp && isInsert && entry.table === 'set_logs') {
    for (const other of await d.getAll()) {
      if (other.table === 'motion_captures' && other.row?.set_id === id) {
        await d.put({ ...other, enqueuedAt: nextEnqueuedAt() });
      }
    }
  }
  return true;
}

/**
 * Remove a queued entry only if it still carries exactly `row` (and has not
 * been turned into something else — patched, or replaced by a delete).
 * 'removed' | 'kept' (a newer payload is waiting) | 'absent'.
 */
export async function removeQueuedEntryIfUnchanged(
  id: string,
  row: Record<string, unknown>
): Promise<'removed' | 'kept' | 'absent'> {
  const d = getDriver();
  const current = await d.get(id);
  if (!current) return 'absent';
  if (
    current.op === 'delete' ||
    current.dirty ||
    JSON.stringify(current.row) !== JSON.stringify(row)
  ) {
    return 'kept';
  }
  await d.delete(id);
  return 'removed';
}

/**
 * Put every parked entry back in line for the next flush. Called when there
 * is a reason to think the answer may have changed — a fresh page load, a
 * reconnect (re-authenticated session), an explicit "Retry". Returns how many
 * were released.
 */
export async function unparkOutboxEntries(): Promise<number> {
  const d = getDriver();
  let released = 0;
  for (const entry of await d.getAll()) {
    if (!entry.parked) continue;
    await d.put({ ...entry, parked: false, rejections: 0 });
    released++;
  }
  return released;
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
    /** Needed only when a delete entry is queued; the real client always has it. */
    delete?(): {
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
   * to a connectivity, auth or 5xx failure. Entries are still retried up to
   * the rejection cap, but callers holding optimistic state that assumed the
   * write would land should reconcile it against the server when an id shows
   * up here.
   */
  rejectedIds: string[];
  /**
   * Subset of rejectedIds that hit the rejection cap on THIS flush and were
   * parked (kept, no longer retried automatically) rather than dropped.
   */
  parkedIds: string[];
}

/** True for connectivity-shaped failures (retry later), false for real rejections. */
export function isNetworkError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && /^\d/.test(err.code)) return false; // PostgREST/SQLSTATE codes = server answered
  return /fetch|network|load failed|timed? ?out|abort|offline/i.test(err.message ?? '');
}

/**
 * True only when the SERVER answered and refused the write in a way that
 * re-sending the same payload cannot fix: a constraint, RLS/privilege, a
 * malformed or unknown column. Everything else — no connectivity, a timeout,
 * a 502/503 HTML body from a proxy, an expired JWT (PGRST301), a statement
 * timeout (57014), too many connections (53300), a serialization failure —
 * is TRANSIENT: the entry stays queued and is retried, however long it takes.
 *
 * The distinction is the difference between "retry" and "give up", so it errs
 * toward transient: an unrecognised error is never treated as a rejection.
 */
export function isPermanentRejection(
  err: { message?: string; code?: string } | null | undefined
): boolean {
  if (!err) return false;
  const code = typeof err.code === 'string' ? err.code : '';
  // SQLSTATE: 22 data exception, 23 integrity constraint, 42 syntax / access
  // rule (42501 = RLS or missing privilege, 42703 = unknown column).
  if (/^(22|23|42)[0-9A-Z]{3}$/.test(code)) return true;
  // A RAISE from a trigger / function.
  if (code === 'P0001') return true;
  // PostgREST: PGRST1xx = unparseable/invalid request, PGRST2xx = schema
  // cache (unknown column/table/relationship). PGRST0xx (connection) and
  // PGRST3xx (JWT) are transient.
  if (/^PGRST[12]\d\d$/.test(code)) return true;
  return false;
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
export const OP_TIMEOUT_MS = 10_000;

export function withTimeout<T>(op: PromiseLike<T>, ms: number): Promise<T> {
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

type OutboxError = { message: string; code?: string };

/** Deliver one entry. Returns the server's error, or null when it landed. */
async function sendEntry(
  supabase: OutboxSupabase,
  entry: OutboxEntry,
  row: Record<string, unknown>,
  timeoutMs: number
): Promise<OutboxError | null> {
  if (entry.op === 'delete') {
    const table = supabase.from(entry.table);
    if (typeof table.delete !== 'function') {
      // Not a refusal — the entry stays queued for a client that can delete.
      return { message: 'outbox client cannot delete' };
    }
    const { error } = await withTimeout(table.delete().eq('id', entry.matchId ?? entry.id), timeoutMs);
    return error;
  }

  if (entry.op === 'update') {
    const { error } = await withTimeout(
      supabase.from(entry.table).update(row).eq('id', entry.matchId ?? (row.id as string)),
      timeoutMs
    );
    return error;
  }

  // Inserts go through ignoreDuplicates/onConflict upsert so a row that
  // already landed (retry after a lost ack) is a silent no-op, not an error.
  const upsertOptions = UPSERT_OPTIONS[entry.table] ?? UPSERT_OPTIONS.set_logs;
  const isSetLog = entry.table === 'set_logs';
  let { error } = await withTimeout(supabase.from(entry.table).upsert(row, upsertOptions), timeoutMs);

  // Schema-cache column miss (migration lag): drop the optional columns and
  // retry once so the core write still lands instead of wedging the queue.
  if (error && isSetLog && isMissingColumnError(error)) {
    ({ error } = await withTimeout(
      supabase.from(entry.table).upsert(withoutOptionalSetLogColumns(row), upsertOptions),
      timeoutMs
    ));
  }

  // A row patched after it was enqueued: if the original insert had already
  // landed, the upsert above just ignored the newer values. Write them.
  if (!error && isSetLog && entry.dirty && typeof row.id === 'string') {
    const { id, ...patch } = row;
    ({ error } = await withTimeout(
      supabase.from(entry.table).update(patch).eq('id', id as string),
      timeoutMs
    ));
    if (error && isMissingColumnError(error)) {
      ({ error } = await withTimeout(
        supabase
          .from(entry.table)
          .update(withoutOptionalSetLogColumns(patch))
          .eq('id', id as string),
        timeoutMs
      ));
    }
  }
  return error;
}

/** `UNIQUE (exercise_block_id, set_number)` refused a set_logs write. */
function isSetNumberCollision(entry: OutboxEntry, error: OutboxError): boolean {
  return (
    entry.table === 'set_logs' &&
    entry.op !== 'delete' &&
    error.code === '23505' &&
    /set_number/i.test(error.message ?? '')
  );
}

/** One past the block's highest set_number on the server, or null if unknown. */
async function probeFreeSetNumber(
  supabase: OutboxSupabase,
  blockId: string,
  timeoutMs: number
): Promise<number | null> {
  try {
    const table = supabase.from('set_logs') as unknown as {
      select?: (columns: string) => {
        eq(column: string, value: string): {
          order(column: string, opts: { ascending: boolean }): {
            limit(n: number): PromiseLike<{
              data: Array<{ set_number: number }> | null;
              error: unknown;
            }>;
          };
        };
      };
    };
    if (typeof table.select !== 'function') return null;
    const { data, error } = await withTimeout(
      table
        .select('set_number')
        .eq('exercise_block_id', blockId)
        .order('set_number', { ascending: false })
        .limit(1),
      timeoutMs
    );
    if (error) return null;
    const max = data?.[0]?.set_number;
    return typeof max === 'number' ? max + 1 : null;
  } catch {
    return null;
  }
}

/**
 * A queued set whose number the server already holds must not be lost over a
 * NUMBER. The set itself (weight, reps, effort) is the data; its position is
 * bookkeeping the next session load re-reads. So:
 *
 *  - an INSERT takes the next free number on the server and goes again;
 *  - an UPDATE drops its `set_number` (a renumbering that can no longer be
 *    applied is stale) and sends whatever else it carries — nothing, if it
 *    was a pure renumber, in which case the entry is finished.
 *
 * Returns the entry to re-send, 'done' when nothing is left to send, or null
 * when no recovery applies (the caller treats the original error as final).
 */
async function recoverSetNumberCollision(
  supabase: OutboxSupabase,
  d: OutboxDriver,
  entry: OutboxEntry,
  timeoutMs: number
): Promise<OutboxEntry | 'done' | null> {
  let row: Record<string, unknown>;
  if (entry.op === 'update') {
    const { set_number: _stale, ...rest } = entry.row;
    row = rest;
  } else {
    const blockId = entry.row.exercise_block_id;
    if (typeof blockId !== 'string') return null;
    const free = await probeFreeSetNumber(supabase, blockId, timeoutMs);
    if (free == null || free === entry.row.set_number) return null;
    row = { ...entry.row, set_number: free };
  }

  // Only rewrite the payload we actually sent — a patch that arrived while
  // the write was in flight wins, and goes out on the next flush.
  const current = await d.get(entry.id);
  if (!current || current.op !== entry.op || JSON.stringify(current.row) !== JSON.stringify(entry.row)) {
    return null;
  }
  if (entry.op === 'update' && Object.keys(row).length === 0) {
    await d.delete(entry.id);
    return 'done';
  }
  const next = { ...current, row };
  await d.put(next);
  return next;
}

async function doFlush(supabase: OutboxSupabase, timeoutMs: number): Promise<FlushResult> {
  const d = getDriver();
  const entries = await listOutbox();
  const flushedIds: string[] = [];
  const failedIds: string[] = [];
  const rejectedIds: string[] = [];
  const parkedIds: string[] = [];

  /**
   * Record a failure on the entry AS IT IS NOW. Writing back the snapshot the
   * flush started with would resurrect an entry removed while the request was
   * in flight (a deleted set coming back from the dead) and clobber a patch
   * that landed in the meantime.
   */
  const amend = async (id: string, change: (current: OutboxEntry) => OutboxEntry) => {
    const current = await d.get(id);
    if (current) await d.put(change(current));
  };

  for (const queued of entries) {
    // Parked: refused by the server and waiting for a reason to try again.
    if (queued.parked) continue;
    // Being written directly right now (write-ahead) — that write settles it.
    if (directWritesInFlight.has(queued.id)) continue;
    let entry = queued;
    try {
      let error = await sendEntry(supabase, entry, entry.row, timeoutMs);

      if (error && isSetNumberCollision(entry, error)) {
        const recovered = await recoverSetNumberCollision(supabase, d, entry, timeoutMs);
        if (recovered === 'done') {
          flushedIds.push(entry.id);
          continue;
        }
        if (recovered) {
          entry = recovered;
          error = await sendEntry(supabase, entry, entry.row, timeoutMs);
        }
      }

      if (!error) {
        // Delete only the payload we actually sent: a same-id entry may have
        // been replaced with a newer patch — or with the row's own delete —
        // while this write was in flight (edit/delete-before-sync semantics).
        // Deleting blindly would drop that newer write. A kept entry goes out
        // on the next flush.
        const current = await d.get(entry.id);
        if (
          !current ||
          ((current.op ?? 'insert') === (entry.op ?? 'insert') &&
            JSON.stringify(current.row) === JSON.stringify(entry.row))
        ) {
          await d.delete(entry.id);
        }
        flushedIds.push(entry.id);
      } else if (isPermanentRejection(error)) {
        // The server answered and refused the row (RLS, constraint, deleted
        // parent block…). Retrying forever would wedge nothing — rejections
        // don't stop the loop — but it is pointless, so cap it. What happens
        // at the cap depends on what the entry IS: a logged set or a finished
        // workout is parked (kept, surfaced, retried on demand) and never
        // thrown away; a cosmetic patch (block order, target sets, a motion
        // capture) is dropped as before.
        const rejections = (entry.rejections ?? 0) + 1;
        const capped = rejections >= MAX_REJECTIONS;
        if (capped && !NEVER_DROP_TABLES.has(entry.table)) {
          await d.delete(entry.id);
        } else {
          const lastError = [error.code, error.message].filter(Boolean).join(': ');
          await amend(entry.id, (current) => ({
            ...current,
            attempts: current.attempts + 1,
            rejections,
            lastError,
            ...(capped ? { parked: true } : {}),
          }));
          if (capped) parkedIds.push(entry.id);
        }
        failedIds.push(entry.id);
        rejectedIds.push(entry.id);
      } else {
        // Offline, flapping, a proxy 5xx, an expired token, a database that
        // is briefly out of connections: nothing about the ROW is wrong.
        // Keep the entry — for as long as it takes — and stop hammering.
        await amend(entry.id, (current) => ({ ...current, attempts: current.attempts + 1 }));
        failedIds.push(entry.id);
        break;
      }
    } catch (e) {
      await amend(entry.id, (current) => ({ ...current, attempts: current.attempts + 1 }));
      failedIds.push(entry.id);
      if (isNetworkError(e as Error)) break;
    }
  }

  return { flushedIds, failedIds, rejectedIds, parkedIds };
}
