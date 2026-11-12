/**
 * Outbox → loaded-session merge.
 *
 * A session read from the database is only half the truth while writes are
 * still waiting in the offline outbox: a set logged offline has no row yet, an
 * edit made offline has not reached its row, a delete made offline has not
 * removed it. Showing the database's answer alone drops those sets from the
 * screen after a reload — the logger falls back to "Set 1", the user re-logs,
 * and the eventual flush produces duplicates.
 *
 * `mergeOutboxIntoSets` overlays what is queued onto what was loaded, so the
 * reopened workout shows what the user actually did. Pure: the caller reads
 * the outbox and the database; this only reconciles them.
 */
import type { SetLog, SetFeedback, BodyweightData, SetQuality } from '@/types/schema';
import type { OutboxEntry } from '@/lib/offline/setOutbox';
import { mapSetLogRow, type SetLogRow } from './sessionMapping';

const SET_EDIT_PREFIX = 'set-edit:';

/** The set a queued set_logs entry is about, or null when it isn't about one. */
export function setIdForOutboxEntry(entry: OutboxEntry): string | null {
  if (entry.table !== 'set_logs') return null;
  if (entry.op === 'update' || entry.op === 'delete') {
    if (entry.matchId) return entry.matchId;
    return entry.id.startsWith(SET_EDIT_PREFIX) ? entry.id.slice(SET_EDIT_PREFIX.length) : entry.id;
  }
  return typeof entry.row?.id === 'string' ? entry.row.id : entry.id;
}

function parseJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Apply a queued set_logs patch (snake_case columns) to a loaded set. */
export function applySetPatch(set: SetLog, patch: Record<string, unknown>): SetLog {
  const next: SetLog = { ...set };
  if (typeof patch.weight_kg === 'number') next.weightKg = patch.weight_kg;
  if (typeof patch.reps === 'number') next.reps = patch.reps;
  if (typeof patch.rpe === 'number') next.rpe = patch.rpe;
  if (typeof patch.set_number === 'number') next.setNumber = patch.set_number;
  if (typeof patch.quality === 'string') next.quality = patch.quality as SetQuality;
  if (typeof patch.quality_reason === 'string') next.qualityReason = patch.quality_reason;
  if ('note' in patch) next.note = (patch.note as string | null) ?? null;
  if (patch.feedback != null) {
    const feedback = parseJson<SetFeedback>(patch.feedback);
    if (feedback) next.feedback = feedback;
  }
  if (patch.bodyweight_data != null) {
    const bodyweightData = parseJson<BodyweightData>(patch.bodyweight_data);
    if (bodyweightData) next.bodyweightData = bodyweightData;
  }
  return next;
}

export interface OutboxMergeResult {
  /** Loaded sets with queued inserts added, queued edits applied and queued deletes removed, by set_number. */
  sets: SetLog[];
  /** Sets (present in `sets`) with a write still waiting in the outbox. */
  queuedIds: string[];
  /** Subset-disjoint from queuedIds: sets whose waiting write the server has refused (parked). */
  failedIds: string[];
}

/**
 * Overlay queued set_logs writes onto the sets loaded for a session.
 *
 * `entries` is the outbox in flush order (`listOutbox`); `blockIds` are the
 * session's blocks — queued sets for other sessions are ignored.
 */
export function mergeOutboxIntoSets(
  loaded: SetLog[],
  entries: OutboxEntry[],
  blockIds: ReadonlySet<string>
): OutboxMergeResult {
  const byId = new Map<string, SetLog>(loaded.map((s) => [s.id, s]));
  const order: string[] = loaded.map((s) => s.id);
  const status = new Map<string, 'queued' | 'failed'>();
  const mark = (id: string, entry: OutboxEntry) => {
    if (entry.parked) status.set(id, 'failed');
    else if (!status.has(id)) status.set(id, 'queued');
  };

  for (const entry of entries) {
    if (entry.table !== 'set_logs') continue;
    const setId = setIdForOutboxEntry(entry);
    if (!setId) continue;

    if (entry.op === 'delete') {
      byId.delete(setId);
      status.delete(setId);
      continue;
    }

    if (entry.op === 'update') {
      const existing = byId.get(setId);
      if (!existing) continue;
      byId.set(setId, applySetPatch(existing, entry.row));
      mark(setId, entry);
      continue;
    }

    // Queued insert. The queue row is the newest version of the set — also
    // when the row already landed (lost ack) and was edited afterwards.
    const blockId = entry.row?.exercise_block_id;
    if (typeof blockId !== 'string' || !blockIds.has(blockId)) continue;
    if (typeof entry.row.weight_kg !== 'number' || typeof entry.row.reps !== 'number') continue;
    const existing = byId.get(setId);
    const mapped = mapSetLogRow({
      rest_seconds: null,
      ...(entry.row as Record<string, unknown>),
      id: setId,
    } as unknown as SetLogRow);
    byId.set(setId, existing ? { ...existing, ...mapped, restSeconds: existing.restSeconds } : mapped);
    if (!existing) order.push(setId);
    mark(setId, entry);
  }

  const sets = order
    .map((id) => byId.get(id))
    .filter((s): s is SetLog => Boolean(s))
    // Stable: the loader orders by set_number, and so must the merged list.
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.setNumber - b.s.setNumber || a.i - b.i)
    .map(({ s }) => s);

  const present = new Set(sets.map((s) => s.id));
  const queuedIds: string[] = [];
  const failedIds: string[] = [];
  for (const [id, state] of Array.from(status.entries())) {
    if (!present.has(id)) continue;
    (state === 'failed' ? failedIds : queuedIds).push(id);
  }
  return { sets, queuedIds, failedIds };
}
