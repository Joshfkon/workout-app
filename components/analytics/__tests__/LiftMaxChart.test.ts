/**
 * The per-lift "estimated max over time" chart's data (UX panel r20: "No
 * per-lift strength chart … can't see the trajectory").
 */

import { liftChartData, liftChartDomain } from '../LiftMaxChart';

describe('liftChartData', () => {
  it('one point per workout, oldest first, in the display unit, with the set it came from', () => {
    const data = liftChartData(
      [
        { date: '2026-11-08', e1rmKg: 105, topSetWeightKg: 87.5, topSetReps: 6 },
        { date: '2026-11-01', e1rmKg: 100, topSetWeightKg: 80, topSetReps: 8 },
      ],
      'lb'
    );
    expect(data.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-08']);
    expect(data[0].max).toBeCloseTo(220.5, 1);
    expect(data[0].maxKg).toBe(100);
    expect(data[1].set).toBe('192.9 lbs × 6');
    // Spaced by real time: a week apart.
    expect(Math.round((data[1].t - data[0].t) / 86_400_000)).toBe(7);
  });

  it('drops points without an estimate', () => {
    expect(liftChartData([{ date: '2026-11-01', e1rmKg: 0, topSetWeightKg: 0, topSetReps: 0 }], 'kg')).toEqual([]);
  });
});

describe('liftChartDomain', () => {
  it('pads the range and never zooms in past a couple of plates', () => {
    const [lo, hi] = liftChartDomain([100, 101], 'kg');
    expect(hi - lo).toBeGreaterThanOrEqual(10);
    expect(lo).toBeLessThanOrEqual(100);
    expect(hi).toBeGreaterThanOrEqual(101);
    expect(liftChartDomain([], 'lb')).toEqual([0, 100]);
  });
});
