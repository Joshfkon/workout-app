import {
  DEFAULT_PROGRESS_RANGE,
  PROGRESS_RANGES,
  progressRange,
  progressRangeStart,
  rangePhrase,
} from '../progressRange';
import { LIFT_TREND_WINDOW_DAYS } from '@/app/(dashboard)/dashboard/_lib/liftTrends';

describe('progressRange', () => {
  it('defaults to the lift-trend window, so Progress and the Home lift tile agree', () => {
    expect(progressRange(DEFAULT_PROGRESS_RANGE).days).toBe(LIFT_TREND_WINDOW_DAYS);
  });

  it('words every range plainly', () => {
    expect(PROGRESS_RANGES.map((r) => rangePhrase(r.days))).toEqual([
      'over the last 4 weeks',
      'over the last 12 weeks',
      'over the last 6 months',
      'over the last year',
    ]);
    expect(rangePhrase(30)).toBe('over the last 30 days');
  });

  it('starts at local midnight and covers whole days including today', () => {
    const start = progressRangeStart(28, new Date('2026-11-24T20:30:00'));
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(28);
    expect(start.getMonth()).toBe(9); // Oct 28 .. Nov 24 = 28 days
  });
});
