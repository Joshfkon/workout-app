/**
 * postFinishQueue — durable "this session still owes post-processing" markers.
 *
 * WHY THIS EXISTS
 * ---------------
 * Finishing a workout queues a completion patch in the set outbox and responds
 * to the UI immediately. Some work can only run once that patch is visible in
 * the database — the mesocycle week advance recounts completed sessions, the
 * deload check reads the completed row, the calorie estimate needs the session.
 *
 * The old flow decided whether to run that work from the FlushResult of its own
 * `flushSetOutbox` call. That is a fact about which flush happened to carry the
 * write, not a fact about whether the write landed: any of the other flush
 * paths (dashboard mount, `online` listener, the workout page's 5 s poll) can
 * drain the completion first, and overlapping calls share one in-flight promise
 * whose result describes a different queue snapshot. The finish then succeeded
 * while its caller concluded it hadn't, and the post-processing was skipped for
 * good — nobody else was looking for it.
 *
 * So the work item is made DURABLE instead of caller-bound. `submitFinish`
 * writes a marker next to the completion patch; whichever flush path ends up
 * draining the completion also settles the marker on its next pass. The
 * original caller disappearing (navigation, tab close, app kill) no longer
 * decides whether the work happens.
 *
 * AT-LEAST-ONCE, DELIBERATELY. Every operation behind a marker converges when
 * repeated — `current_week` is an advance-only write, the weekly fatigue log is
 * a find-then-upsert of derived values, the deload check re-derives from stored
 * rows, the calorie estimate recomputes and overwrites. Guaranteeing "at least
 * once" over an idempotent body is far cheaper, and far harder to get wrong,
 * than guaranteeing "exactly once".
 */
import { resolveOfflineStore, POST_FINISH_STORE, type OfflineStore } from './setOutbox';
import { now as clockNow } from '@/lib/clock';
import type { Rating } from '@/types/schema';

/**
 * Everything `runPostSessionMesoUpdates` and the calorie estimate need, frozen
 * at finish time. Self-contained on purpose: a drain running days later, in a
 * different tab, after an app restart, must not need the finishing component's
 * props to still exist.
 */
export interface PostFinishWork {
  /** `postfinish:<sessionId>` — see `postFinishEntryId`. */
  id: string;
  sessionId: string;
  userId: string;
  /**
   * Null for an ad-hoc session. A later "count it toward my plan" claim
   * re-writes the marker with the mesocycle it was claimed for.
   */
  mesocycleId: string | null;
  sessionRpe: number | null;
  checkIn: {
    readinessScore?: number;
    sleepQuality?: Rating | null;
    stressLevel?: Rating | null;
  } | null;
  /** Needed by the calorie estimate; null when the session had no planned date. */
  plannedDate: string | null;
  enqueuedAt: number;
  /**
   * Settle attempts so far. At-least-once must still be BOUNDED — an item the
   * work throws on every time would otherwise be retried by every flush for
   * the life of the install. Absent on items written before this field.
   */
  attempts?: number;
}

export function postFinishEntryId(sessionId: string): string {
  return `postfinish:${sessionId}`;
}

let store: OfflineStore<PostFinishWork> | null = null;
function getStore(): OfflineStore<PostFinishWork> {
  if (!store) store = resolveOfflineStore<PostFinishWork>(POST_FINISH_STORE);
  return store;
}

/** Test seam: force a specific store (e.g. in-memory) and reset state. */
export function __setPostFinishStoreForTests(s: OfflineStore<PostFinishWork> | null): void {
  store = s;
}

/**
 * Record that `sessionId` owes post-processing. Keyed by session, so
 * re-finishing (or claiming) replaces rather than duplicates.
 */
export async function enqueuePostFinishWork(
  work: Omit<PostFinishWork, 'id' | 'enqueuedAt'>
): Promise<void> {
  await getStore().put({
    ...work,
    id: postFinishEntryId(work.sessionId),
    enqueuedAt: clockNow().getTime(),
  });
}

/**
 * Merge a patch into an existing marker. Used by the claim flow, which learns
 * the mesocycle id only after the finish was already queued. A no-op when no
 * marker exists — the finish either never queued (broken IndexedDB, which runs
 * its own direct path) or has already been settled.
 */
export async function patchPostFinishWork(
  sessionId: string,
  patch: Partial<Omit<PostFinishWork, 'id' | 'sessionId'>>
): Promise<boolean> {
  const s = getStore();
  const existing = await s.get(postFinishEntryId(sessionId));
  if (!existing) return false;
  await s.put({ ...existing, ...patch });
  return true;
}

export function getPostFinishWork(sessionId: string): Promise<PostFinishWork | undefined> {
  return getStore().get(postFinishEntryId(sessionId));
}

/** Oldest first, so a backlog settles in the order the sessions finished. */
export async function listPostFinishWork(): Promise<PostFinishWork[]> {
  const all = await getStore().getAll();
  return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

export async function removePostFinishWork(sessionId: string): Promise<void> {
  await getStore().delete(postFinishEntryId(sessionId));
}
