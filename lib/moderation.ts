/**
 * User-generated-content moderation: blocking users and reporting content
 * (App Store guideline 1.2).
 *
 * - Blocks live in `blocked_users` (RLS: a user sees/creates/deletes only
 *   their own blocks). The set of ids the signed-in user has blocked is held
 *   in a tiny module-level store so every social surface (feed, comments,
 *   discover, search, profile) hides a user the moment they are blocked.
 * - Reports are inserted into `content_reports` (RLS: insert/select own only)
 *   and reviewed by a moderator with the service role.
 */

/** Where reports and moderation questions go. Shown in the UI. */
export const MODERATION_CONTACT_EMAIL = 'support@hypertrack.app';

export type ReportTargetType = 'activity' | 'comment' | 'profile' | 'shared_workout';

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate'
  | 'sexual'
  | 'violence'
  | 'self_harm'
  | 'impersonation'
  | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'sexual', label: 'Nudity or sexual content' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'self_harm', label: 'Self-harm or dangerous advice' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Something else' },
];

export const REPORT_NOTE_MAX_LENGTH = 1000;

export interface ContentReportInput {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  /** Author of the reported content, when known. */
  targetUserId?: string | null;
  reason: ReportReason;
  note?: string | null;
}

// Minimal structural client type so this module works with the typed and
// untyped Supabase clients (these tables are not in the generated types).
type SupabaseLike = { from: (table: any) => any };

type Result = { success: true } | { success: false; error: string };

const UNIQUE_VIOLATION = '23505';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message || fallback;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Blocked-user store
// ---------------------------------------------------------------------------

const EMPTY: ReadonlySet<string> = new Set<string>();

let blockedIds: ReadonlySet<string> = EMPTY;
let loadedForUserId: string | null = null;
let inFlight: { userId: string; promise: Promise<ReadonlySet<string>> } | null = null;
const listeners = new Set<() => void>();

function setBlockedIds(next: ReadonlySet<string>) {
  blockedIds = next;
  listeners.forEach((listener) => listener());
}

export function subscribeBlockedUsers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current snapshot (stable identity until the set changes). */
export function getBlockedUserIds(): ReadonlySet<string> {
  return blockedIds;
}

export function getServerBlockedUserIds(): ReadonlySet<string> {
  return EMPTY;
}

/** Test helper / sign-out reset. */
export function resetBlockedUsersStore() {
  loadedForUserId = null;
  inFlight = null;
  setBlockedIds(EMPTY);
}

/**
 * Ids the given user has blocked. Cached per user; concurrent callers share
 * one request. A failed read (e.g. table missing) resolves to the current
 * set rather than throwing, so social surfaces still render.
 */
export async function loadBlockedUserIds(
  supabase: SupabaseLike,
  userId: string,
  options: { force?: boolean } = {}
): Promise<ReadonlySet<string>> {
  if (!options.force && loadedForUserId === userId) return blockedIds;
  if (inFlight && inFlight.userId === userId) return inFlight.promise;

  const promise = (async () => {
    try {
      const { data, error } = (await supabase
        .from('blocked_users')
        .select('blocked_id')
        .eq('blocker_id', userId)) as { data: { blocked_id: string }[] | null; error: unknown };

      if (error) {
        console.error('[moderation] Failed to load blocked users:', error);
        return blockedIds;
      }

      loadedForUserId = userId;
      setBlockedIds(new Set((data ?? []).map((row) => row.blocked_id)));
      return blockedIds;
    } catch (err) {
      console.error('[moderation] Failed to load blocked users:', err);
      return blockedIds;
    } finally {
      inFlight = null;
    }
  })();

  inFlight = { userId, promise };
  return promise;
}

export async function blockUser(
  supabase: SupabaseLike,
  blockerId: string,
  blockedId: string,
  reason?: string
): Promise<Result> {
  if (!blockerId) return { success: false, error: 'Must be logged in' };
  if (blockerId === blockedId) return { success: false, error: 'You cannot block yourself' };

  try {
    const { error } = (await supabase.from('blocked_users').insert({
      blocker_id: blockerId,
      blocked_id: blockedId,
      reason: reason ?? null,
    })) as { error: { code?: string; message?: string } | null };

    // Already blocked is a success from the user's point of view.
    if (error && error.code !== UNIQUE_VIOLATION) {
      return { success: false, error: errorMessage(error, 'Failed to block user') };
    }

    const next = new Set(blockedIds);
    next.add(blockedId);
    setBlockedIds(next);
    return { success: true };
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Failed to block user') };
  }
}

export async function unblockUser(
  supabase: SupabaseLike,
  blockerId: string,
  blockedId: string
): Promise<Result> {
  if (!blockerId) return { success: false, error: 'Must be logged in' };

  try {
    const { error } = (await supabase
      .from('blocked_users')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', blockedId)) as { error: { message?: string } | null };

    if (error) {
      return { success: false, error: errorMessage(error, 'Failed to unblock user') };
    }

    const next = new Set(blockedIds);
    next.delete(blockedId);
    setBlockedIds(next);
    return { success: true };
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Failed to unblock user') };
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function submitContentReport(
  supabase: SupabaseLike,
  input: ContentReportInput
): Promise<Result> {
  if (!input.reporterId) return { success: false, error: 'Must be logged in to report' };
  if (!REPORT_REASONS.some((r) => r.value === input.reason)) {
    return { success: false, error: 'Please choose a reason' };
  }

  const note = input.note?.trim() ?? '';
  if (note.length > REPORT_NOTE_MAX_LENGTH) {
    return { success: false, error: `Note must be ${REPORT_NOTE_MAX_LENGTH} characters or less` };
  }

  try {
    const { error } = (await supabase.from('content_reports').insert({
      reporter_id: input.reporterId,
      target_type: input.targetType,
      target_id: input.targetId,
      target_user_id: input.targetUserId ?? null,
      reason: input.reason,
      note: note || null,
    })) as { error: { code?: string; message?: string } | null };

    // Reporting the same thing twice: the first report stands.
    if (error && error.code !== UNIQUE_VIOLATION) {
      return { success: false, error: errorMessage(error, 'Failed to submit report') };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: errorMessage(err, 'Failed to submit report') };
  }
}

/** PostgREST `in` list for `.not('user_id', 'in', ...)`. */
export function toPostgrestInList(ids: Iterable<string>): string {
  return `(${Array.from(ids).join(',')})`;
}
