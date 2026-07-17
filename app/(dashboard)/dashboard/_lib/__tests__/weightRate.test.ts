import { computeWeightRate, goalTargetRate } from '../weightRate';

describe('computeWeightRate', () => {
  it('returns null with fewer than two entries', () => {
    expect(computeWeightRate([], 'lb', 'bulk')).toBeNull();
    expect(computeWeightRate([{ date: '2026-06-01', weight: 176, unit: 'lb' }], 'lb', 'bulk')).toBeNull();
  });

  it('computes a weekly gain rate with the goal target on a bulk', () => {
    // +0.5 lb per week over three weeks
    const history = [
      { date: '2026-06-01', weight: 176.0, unit: 'lb' },
      { date: '2026-06-08', weight: 176.5, unit: 'lb' },
      { date: '2026-06-15', weight: 177.0, unit: 'lb' },
      { date: '2026-06-22', weight: 177.5, unit: 'lb' },
    ];

    const rate = computeWeightRate(history, 'lb', 'bulk')!;

    expect(rate.perWeek).toBeCloseTo(0.5, 1);
    expect(rate.target).toBe(0.5);
  });

  it('scopes the regression to windowDays so the rate follows the chart range', () => {
    // Flat for weeks, then a sharp gain in the last 7 days.
    const history = [
      { date: '2026-06-01', weight: 176.0, unit: 'lb' },
      { date: '2026-06-08', weight: 176.0, unit: 'lb' },
      { date: '2026-06-15', weight: 176.0, unit: 'lb' },
      { date: '2026-06-22', weight: 176.0, unit: 'lb' },
      { date: '2026-06-29', weight: 178.0, unit: 'lb' },
    ];

    const wide = computeWeightRate(history, 'lb', 'bulk', 90)!;
    const narrow = computeWeightRate(history, 'lb', 'bulk', 7)!;

    // The 7d window sees only the +2 lb jump; the 90d window dilutes it.
    expect(narrow.perWeek).toBeCloseTo(2.0, 1);
    expect(narrow.perWeek).toBeGreaterThan(wide.perWeek);
  });

  it('falls back to the last two entries when the window is sparse', () => {
    const history = [
      { date: '2026-05-01', weight: 175.0, unit: 'lb' },
      { date: '2026-06-29', weight: 176.0, unit: 'lb' },
    ];

    // 7-day window contains one entry — falls back to the last two.
    const rate = computeWeightRate(history, 'lb', 'bulk', 7)!;
    expect(rate.perWeek).toBeCloseTo((1.0 / 59) * 7, 1);
  });

  it('has no target rate on maintenance', () => {
    const history = [
      { date: '2026-06-15', weight: 80, unit: 'kg' },
      { date: '2026-06-22', weight: 80.2, unit: 'kg' },
    ];

    const rate = computeWeightRate(history, 'kg', 'maintenance')!;

    expect(rate.target).toBeNull();
  });

  it('exposes the same goal targets the tile shows', () => {
    expect(goalTargetRate('bulk', 'lb')).toBe(0.5);
    expect(goalTargetRate('cut', 'lb')).toBe(-1.0);
    expect(goalTargetRate('cut', 'kg')).toBe(-0.45);
    expect(goalTargetRate('recomp', 'lb')).toBeNull();
  });
});
