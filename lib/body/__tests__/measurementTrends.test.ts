/**
 * computeMeasurementTrends — per-site classification over sparse
 * body_measurements rows: direction band, waist inversion, the
 * building-history gate, and the range cutoff.
 */

import {
  computeMeasurementTrends,
  MIN_POINTS_FOR_TREND,
} from '@/lib/body/measurementTrends';

const FIELDS = [
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'neck', label: 'Neck' },
];

describe('computeMeasurementTrends', () => {
  it('classifies growth as rising and shrink as down, with waist inverted as improvement', () => {
    const rows = [
      { logged_at: '2026-05-01', chest: 100, waist: 90 },
      { logged_at: '2026-06-01', chest: 103, waist: 87 },
      { logged_at: '2026-07-01', chest: 106, waist: 84 },
    ];
    const summary = computeMeasurementTrends(rows, FIELDS);

    const chest = summary.sites.find((s) => s.site === 'chest')!;
    expect(chest.direction).toBe('rising');
    expect(chest.improving).toBe(true);
    expect(chest.monthlyChangeCm).toBeCloseTo(3, 0);
    expect(chest.currentCm).toBe(106);

    const waist = summary.sites.find((s) => s.site === 'waist')!;
    expect(waist.direction).toBe('down');
    expect(waist.improving).toBe(true);

    expect(summary.rising).toBe(1);
    expect(summary.down).toBe(1);
    expect(summary.building).toBe(0);
  });

  it('flags a shrinking non-waist site as not improving', () => {
    const rows = [
      { logged_at: '2026-05-01', chest: 106 },
      { logged_at: '2026-06-01', chest: 103 },
      { logged_at: '2026-07-01', chest: 100 },
    ];
    const chest = computeMeasurementTrends(rows, FIELDS).sites[0];
    expect(chest.direction).toBe('down');
    expect(chest.improving).toBe(false);
  });

  it('treats tiny drift as flat with no improvement verdict', () => {
    const rows = [
      { logged_at: '2026-05-01', chest: 100 },
      { logged_at: '2026-06-01', chest: 100.05 },
      { logged_at: '2026-07-01', chest: 100.1 },
    ];
    const chest = computeMeasurementTrends(rows, FIELDS).sites[0];
    expect(chest.direction).toBe('flat');
    expect(chest.improving).toBeNull();
  });

  it('leaves sites unclassified until MIN_POINTS_FOR_TREND entries', () => {
    const rows = [
      { logged_at: '2026-06-01', neck: 38 },
      { logged_at: '2026-07-01', neck: 38.4 },
    ];
    const summary = computeMeasurementTrends(rows, FIELDS);
    expect(summary.sites).toHaveLength(1);
    expect(summary.sites[0].direction).toBeNull();
    expect(summary.sites[0].improving).toBeNull();
    expect(summary.sites[0].pointCount).toBeLessThan(MIN_POINTS_FOR_TREND);
    expect(summary.building).toBe(1);
  });

  it('applies the cutoff and skips non-numeric values', () => {
    const rows = [
      { logged_at: '2025-01-01', chest: 90 },
      { logged_at: '2026-05-01', chest: 100, waist: null },
      { logged_at: '2026-06-01', chest: 103 },
      { logged_at: '2026-07-01', chest: 106 },
    ];
    const summary = computeMeasurementTrends(rows, FIELDS, '2026-01-01');
    const chest = summary.sites.find((s) => s.site === 'chest')!;
    expect(chest.pointCount).toBe(3);
    expect(chest.history[0].date).toBe('2026-05-01');
    expect(summary.sites.some((s) => s.site === 'waist')).toBe(false);
  });

  it('orders sites rising → flat → down → building', () => {
    const rows = [
      { logged_at: '2026-05-01', chest: 100, waist: 90, neck: 38 },
      { logged_at: '2026-06-01', chest: 100, waist: 91.5 },
      { logged_at: '2026-07-01', chest: 100, waist: 93 },
    ];
    const summary = computeMeasurementTrends(rows, FIELDS);
    expect(summary.sites.map((s) => s.site)).toEqual(['waist', 'chest', 'neck']);
  });
});

// ============================================
// TREND-ROBUSTNESS VERIFICATION FIXTURES
// (chest / hips repro — see the trend-robustness task)
// ============================================

describe('robust tape trends', () => {
  it('chest repro: flags the −1.6" single-week drop as an outlier and clears "Down"', () => {
    const rows = [
      { logged_at: '2026-07-09', chest: 111.0 }, // ≈43.7"
      { logged_at: '2026-07-16', chest: 111.0 },
      { logged_at: '2026-07-19', chest: 111.8 }, // ≈44.0"
      { logged_at: '2026-07-26', chest: 107.7 }, // ≈42.4" — tape error
    ];
    const chest = computeMeasurementTrends(rows, FIELDS).sites.find((s) => s.site === 'chest')!;
    expect(chest.excludedDates).toEqual(['2026-07-26']);
    expect(chest.direction).not.toBe('down'); // "Down" clears
    expect(chest.monthlyChangeCm).toBeGreaterThanOrEqual(0);
  });

  it('suppresses the per-month rate on a short span (raw delta instead)', () => {
    // 3 entries over 17 days: rendering in/mo would be a 1.8× extrapolation.
    const rows = [
      { logged_at: '2026-07-09', chest: 109.5 },
      { logged_at: '2026-07-19', chest: 110.6 },
      { logged_at: '2026-07-26', chest: 111.8 },
    ];
    const chest = computeMeasurementTrends(rows, FIELDS).sites.find((s) => s.site === 'chest')!;
    expect(chest.rateIsReliable).toBe(false);
    expect(chest.spanDays).toBe(17);
    expect(chest.observedDeltaCm).toBeCloseTo(2.3, 1);
    // Direction still classifies — only the RATE is withheld.
    expect(chest.direction).toBe('rising');
  });

  it('hips repro: 1M and 12M windows agree in sign and rough magnitude', () => {
    const rows = [
      { logged_at: '2025-08-01', waist: 101.6 },
      { logged_at: '2025-10-01', waist: 101.6 },
      { logged_at: '2025-12-01', waist: 101.9 },
      { logged_at: '2026-02-01', waist: 101.6 },
      { logged_at: '2026-04-01', waist: 101.9 },
      { logged_at: '2026-06-28', waist: 101.6 },
      { logged_at: '2026-07-05', waist: 101.9 },
      { logged_at: '2026-07-12', waist: 101.6 },
      { logged_at: '2026-07-19', waist: 101.9 },
      { logged_at: '2026-07-26', waist: 99.6 }, // tape error
    ];
    const year = computeMeasurementTrends(rows, FIELDS, '2025-08-01')
      .sites.find((s) => s.site === 'waist')!;
    const month = computeMeasurementTrends(rows, FIELDS, '2026-06-27')
      .sites.find((s) => s.site === 'waist')!;
    // The old OLS-through-the-outlier produced a 33× divergence (−3.3 vs
    // −0.1 in/mo). Robust fits over both windows must read ~flat.
    expect(Math.abs(year.monthlyChangeCm)).toBeLessThan(0.4);
    expect(Math.abs(month.monthlyChangeCm)).toBeLessThan(1.0);
  });

  it('hard-rejects an impossible zero circumference instead of trending through it', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rows = [
        { logged_at: '2026-06-01', neck: 38 },
        { logged_at: '2026-06-15', neck: 0 }, // corrupt
        { logged_at: '2026-07-01', neck: 38.4 },
        { logged_at: '2026-07-15', neck: 38.8 },
      ];
      const neck = computeMeasurementTrends(rows, FIELDS).sites.find((s) => s.site === 'neck')!;
      expect(neck.direction).toBe('rising');
      expect(neck.monthlyChangeCm).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
