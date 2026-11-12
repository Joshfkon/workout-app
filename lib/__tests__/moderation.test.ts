import {
  blockUser,
  unblockUser,
  getBlockedUserIds,
  loadBlockedUserIds,
  resetBlockedUsersStore,
  submitContentReport,
  subscribeBlockedUsers,
  toPostgrestInList,
} from '../moderation';

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

/** Minimal chainable fake: records calls, resolves to a canned result. */
function fakeSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Call[] = [];
  const client = {
    calls,
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        delete: () => {
          call.op = 'delete';
          return builder;
        },
        eq: (col: string, value: unknown) => {
          call.filters.push([col, value]);
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve),
      };
      return builder;
    },
  };
  return client;
}

describe('moderation', () => {
  beforeEach(() => {
    resetBlockedUsersStore();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('blocked users store', () => {
    it('loads the ids the user has blocked and caches them per user', async () => {
      const supabase = fakeSupabase({ data: [{ blocked_id: 'u2' }, { blocked_id: 'u3' }] });
      const ids = await loadBlockedUserIds(supabase, 'u1');
      expect(Array.from(ids).sort()).toEqual(['u2', 'u3']);
      expect(supabase.calls[0]).toMatchObject({ table: 'blocked_users', filters: [['blocker_id', 'u1']] });

      await loadBlockedUserIds(supabase, 'u1');
      expect(supabase.calls).toHaveLength(1);

      await loadBlockedUserIds(supabase, 'u1', { force: true });
      expect(supabase.calls).toHaveLength(2);
    });

    it('shares one request between concurrent callers', async () => {
      const supabase = fakeSupabase({ data: [] });
      await Promise.all([loadBlockedUserIds(supabase, 'u1'), loadBlockedUserIds(supabase, 'u1')]);
      expect(supabase.calls).toHaveLength(1);
    });

    it('does not throw when the read fails', async () => {
      const supabase = fakeSupabase({ error: { message: 'relation does not exist' } });
      const ids = await loadBlockedUserIds(supabase, 'u1');
      expect(ids.size).toBe(0);
    });

    it('block adds to the store and notifies subscribers; unblock removes', async () => {
      const listener = jest.fn();
      const unsubscribe = subscribeBlockedUsers(listener);
      const supabase = fakeSupabase();

      expect(await blockUser(supabase, 'u1', 'u2')).toEqual({ success: true });
      expect(supabase.calls[0]).toMatchObject({
        table: 'blocked_users',
        op: 'insert',
        payload: { blocker_id: 'u1', blocked_id: 'u2' },
      });
      expect(getBlockedUserIds().has('u2')).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      expect(await unblockUser(supabase, 'u1', 'u2')).toEqual({ success: true });
      expect(supabase.calls[1]).toMatchObject({
        op: 'delete',
        filters: [['blocker_id', 'u1'], ['blocked_id', 'u2']],
      });
      expect(getBlockedUserIds().has('u2')).toBe(false);
      unsubscribe();
    });

    it('treats an existing block as success', async () => {
      const supabase = fakeSupabase({ error: { code: '23505', message: 'duplicate' } });
      expect(await blockUser(supabase, 'u1', 'u2')).toEqual({ success: true });
      expect(getBlockedUserIds().has('u2')).toBe(true);
    });

    it('refuses self-blocks and leaves the store alone on failure', async () => {
      const supabase = fakeSupabase({ error: { code: '42501', message: 'denied' } });
      expect(await blockUser(supabase, 'u1', 'u1')).toEqual({ success: false, error: 'You cannot block yourself' });
      expect(supabase.calls).toHaveLength(0);

      expect(await blockUser(supabase, 'u1', 'u2')).toEqual({ success: false, error: 'denied' });
      expect(getBlockedUserIds().size).toBe(0);
    });
  });

  describe('submitContentReport', () => {
    const base = {
      reporterId: 'u1',
      targetType: 'comment' as const,
      targetId: 'c1',
      targetUserId: 'u2',
      reason: 'harassment' as const,
    };

    it('inserts the report as the reporter', async () => {
      const supabase = fakeSupabase();
      expect(await submitContentReport(supabase, { ...base, note: '  rude  ' })).toEqual({ success: true });
      expect(supabase.calls[0]).toMatchObject({
        table: 'content_reports',
        op: 'insert',
        payload: {
          reporter_id: 'u1',
          target_type: 'comment',
          target_id: 'c1',
          target_user_id: 'u2',
          reason: 'harassment',
          note: 'rude',
        },
      });
    });

    it('stores an empty note as null and treats a duplicate report as success', async () => {
      const supabase = fakeSupabase({ error: { code: '23505', message: 'duplicate' } });
      expect(await submitContentReport(supabase, { ...base, note: '   ' })).toEqual({ success: true });
      expect((supabase.calls[0].payload as { note: unknown }).note).toBeNull();
    });

    it('rejects a missing reporter, unknown reason or over-long note without a request', async () => {
      const supabase = fakeSupabase();
      expect((await submitContentReport(supabase, { ...base, reporterId: '' })).success).toBe(false);
      expect((await submitContentReport(supabase, { ...base, reason: 'nope' as never })).success).toBe(false);
      expect((await submitContentReport(supabase, { ...base, note: 'x'.repeat(1001) })).success).toBe(false);
      expect(supabase.calls).toHaveLength(0);
    });

    it('surfaces a database error', async () => {
      const supabase = fakeSupabase({ error: { code: '42501', message: 'denied' } });
      expect(await submitContentReport(supabase, base)).toEqual({ success: false, error: 'denied' });
    });
  });

  it('formats a PostgREST in-list', () => {
    expect(toPostgrestInList(new Set(['a', 'b']))).toBe('(a,b)');
  });
});
