import { renderHook, waitFor, act } from '@testing-library/react';
import { useActivityFeed } from '../useActivityFeed';
import { resetBlockedUsersStore } from '@/lib/moderation';

type AuthState = { user: { id: string } | null; isLoading: boolean; error: null };
let mockAuth: AuthState = { user: null, isLoading: true, error: null };

jest.mock('@/hooks/useAuthUser', () => ({
  useAuthUser: () => mockAuth,
}));

jest.mock('@/lib/profiles', () => ({
  fetchUserProfiles: jest.fn(async (_client: unknown, userIds: string[]) => {
    const map = new Map<string, unknown>();
    userIds
      .filter((id) => id !== 'no-profile')
      .forEach((id) =>
        map.set(id, {
          id: `p-${id}`,
          user_id: id,
          username: id,
          display_name: null,
          avatar_url: null,
          bio: null,
          profile_visibility: 'public',
          follower_count: 0,
          following_count: 0,
          workout_count: 0,
        })
      );
    return map;
  }),
}));

type Query = { table: string; calls: [string, ...unknown[]][] };
const queries: Query[] = [];
let tableData: Record<string, unknown[]> = {};

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'limit', 'eq', 'in', 'not', 'or', 'lt']) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: tableData[table] ?? [], error: null }).then(resolve);
      return builder;
    },
  }),
}));

const activity = (id: string, userId: string, createdAt = '2026-01-01T00:00:00+00:00') => ({
  id,
  user_id: userId,
  activity_type: 'workout_completed',
  activity_data: {},
  visibility: 'public',
  reaction_count: 0,
  comment_count: 0,
  created_at: createdAt,
});

const activityQueries = () => queries.filter((q) => q.table === 'activities');
const has = (q: Query, method: string, ...args: unknown[]) =>
  q.calls.some((c) => c[0] === method && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

describe('useActivityFeed', () => {
  beforeEach(() => {
    queries.length = 0;
    tableData = {};
    mockAuth = { user: null, isLoading: true, error: null };
    resetBlockedUsersStore();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not load the public feed for the Following tab while auth is resolving', async () => {
    tableData = {
      activities: [activity('a1', 'friend')],
      follows: [{ following_id: 'friend' }],
      blocked_users: [],
      activity_reactions: [],
    };

    const { result, rerender } = renderHook(() => useActivityFeed({ feedType: 'following' }));

    // Auth not resolved yet: nothing fetched, still loading.
    expect(activityQueries()).toHaveLength(0);
    expect(result.current.isLoading).toBe(true);

    mockAuth = { user: { id: 'me' }, isLoading: false, error: null };
    rerender();

    await waitFor(() => expect(result.current.activities).toHaveLength(1));

    // Exactly one activities query, scoped to followed users — never the
    // public (`visibility = public`) fallback.
    expect(activityQueries()).toHaveLength(1);
    const q = activityQueries()[0];
    expect(has(q, 'in', 'user_id', ['friend', 'me'])).toBe(true);
    expect(has(q, 'eq', 'visibility', 'public')).toBe(false);
  });

  it('excludes blocked users in the query and hides them from the result', async () => {
    mockAuth = { user: { id: 'me' }, isLoading: false, error: null };
    tableData = {
      activities: [activity('a1', 'friend'), activity('a2', 'blocked')],
      blocked_users: [{ blocked_id: 'blocked' }],
      activity_reactions: [],
    };

    const { result } = renderHook(() => useActivityFeed({ feedType: 'discover' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(has(activityQueries()[0], 'not', 'user_id', 'in', '(blocked)')).toBe(true);
    expect(result.current.activities.map((a) => a.id)).toEqual(['a1']);
  });

  it('keeps paginating when a row is dropped for a missing profile, using a (created_at, id) cursor', async () => {
    mockAuth = { user: null, isLoading: false, error: null };
    tableData = {
      activities: [activity('a2', 'friend'), activity('a1', 'no-profile')],
    };

    const { result } = renderHook(() => useActivityFeed({ feedType: 'discover', limit: 2 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 2 raw rows == limit, so there may be more even though only 1 is shown.
    expect(result.current.activities.map((a) => a.id)).toEqual(['a2']);
    expect(result.current.hasMore).toBe(true);
    expect(has(activityQueries()[0], 'order', 'id', { ascending: false })).toBe(true);

    tableData = { activities: [] };
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.hasMore).toBe(false));

    const next = activityQueries()[1];
    expect(
      has(
        next,
        'or',
        'created_at.lt."2026-01-01T00:00:00+00:00",and(created_at.eq."2026-01-01T00:00:00+00:00",id.lt."a1")'
      )
    ).toBe(true);
  });

  it('does not decrement the count when removing a reaction that was never set', async () => {
    mockAuth = { user: null, isLoading: false, error: null };
    tableData = { activities: [{ ...activity('a1', 'friend'), reaction_count: 2 }] };

    const { result } = renderHook(() => useActivityFeed({ feedType: 'discover' }));
    await waitFor(() => expect(result.current.activities).toHaveLength(1));

    act(() => result.current.updateActivityReaction('a1', undefined));
    expect(result.current.activities[0].reaction_count).toBe(2);
  });
});
