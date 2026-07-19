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
