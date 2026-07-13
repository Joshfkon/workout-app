/**
 * sleepLog — one entry per user per local day: every save is an UPSERT on
 * (user_id, local_day), so a second save for the same day edits the existing
 * row rather than creating a duplicate.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchRecentSleep, upsertSleepEntry } from '@/lib/sleep/sleepLog';

describe('upsertSleepEntry', () => {
  it('upserts on (user_id, local_day) — a second save edits, never duplicates', async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    const supabase = { from: jest.fn(() => ({ upsert })) } as unknown as SupabaseClient;

    await upsertSleepEntry(supabase, 'user-1', { localDay: '2026-07-13', hours: 6.5, quality: 'ok' });
    await upsertSleepEntry(supabase, 'user-1', { localDay: '2026-07-13', hours: 7, quality: 'good' });

    expect((supabase.from as jest.Mock).mock.calls.every(([t]) => t === 'sleep_log')).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(2);
    const calls = upsert.mock.calls as unknown as [Record<string, unknown>, { onConflict: string }][];
    for (const [row, options] of calls) {
      expect(options).toEqual({ onConflict: 'user_id,local_day' });
      expect(row).toMatchObject({ user_id: 'user-1', local_day: '2026-07-13', source: 'manual' });
    }
    // The second save carries the edited values.
    expect(calls[1][0]).toMatchObject({ hours: 7, quality: 'good' });
  });

  it('throws on a database error', async () => {
    const supabase = {
      from: () => ({ upsert: async () => ({ error: { message: 'boom' } }) }),
    } as unknown as SupabaseClient;
    await expect(
      upsertSleepEntry(supabase, 'user-1', { localDay: '2026-07-13', hours: 8, quality: 'good' })
    ).rejects.toThrow('boom');
  });
});

describe('fetchRecentSleep', () => {
  it('maps rows to entries and defends against unknown quality/source values', async () => {
    const rows = [
      { local_day: '2026-07-13', hours: '7.5', quality: 'good', source: 'manual' },
      { local_day: '2026-07-12', hours: 6, quality: 'garbage', source: 'unknown' },
    ];
    const order = jest.fn(async () => ({ data: rows, error: null }));
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ gte: () => ({ order }) }) }),
      }),
    } as unknown as SupabaseClient;

    const entries = await fetchRecentSleep(supabase, 'user-1', 14, new Date('2026-07-13T12:00:00'));
    expect(entries).toEqual([
      { localDay: '2026-07-13', hours: 7.5, quality: 'good', source: 'manual' },
      { localDay: '2026-07-12', hours: 6, quality: 'ok', source: 'manual' },
    ]);
  });
});
