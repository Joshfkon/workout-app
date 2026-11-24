import { LIFT_TRENDS_QUERY_KEY, liftTrendsQueryKey } from '@/hooks/useLiftTrends';
import { LIFT_TREND_WINDOW_DAYS } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

describe('liftTrendsQueryKey', () => {
  it('keeps the shared key at the default window (Home tile, lift screen, Train)', () => {
    expect(liftTrendsQueryKey()).toBe(LIFT_TRENDS_QUERY_KEY);
    expect(liftTrendsQueryKey(LIFT_TREND_WINDOW_DAYS)).toBe(LIFT_TRENDS_QUERY_KEY);
  });

  it('gives other windows their own key under the same prefix, so one invalidation reaches all', () => {
    const key = liftTrendsQueryKey(28);
    expect(key).toEqual([...LIFT_TRENDS_QUERY_KEY, 28]);
    expect(key.slice(0, LIFT_TRENDS_QUERY_KEY.length)).toEqual([...LIFT_TRENDS_QUERY_KEY]);
  });
});
