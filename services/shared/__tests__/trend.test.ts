/**
 * computeTrend — the canonical robust trend estimator.
 *
 * Fixtures mirror the real Progress-tab failures that motivated the module
 * (see the trend-robustness task): the Cable Fly zero + equipment shift, the
 * chest tape outlier, the index-vs-date regression corruption, and the
 * 1M-vs-12M window divergence.
 */

import { computeTrend, uniformSeriesSlope } from '@/services/shared/trend';

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
afterAll(() => warnSpy.mockRestore());
beforeEach(() => warnSpy.mockClear());

/** Cable Fly e1RM series (kg-agnostic): the real repro. */
const CABLE_FLY = [
  { date: '2026-06-29', value: 57.5 }, // old machine (different stack labeling)
  { date: '2026-07-04', value: 0 },    // corrupt: e1RM of 0 is not an outcome
  { date: '2026-07-14', value: 40 },   // correct machine from here on
  { date: '2026-07-21', value: 40 },
  { date: '2026-07-27', value: 42.5 },
];

describe('computeTrend — hard rejection of impossible values', () => {
  it('rejects zero values before fitting and reports them as invalid, not outliers', () => {
    const r = computeTrend(CABLE_FLY, { lowConfidenceSpanDays: 10 });
    expect(r.invalidIndices).toEqual([1]);
    expect(r.nInvalid).toBe(1);
    expect(r.excludedIndices).not.toContain(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('rejects negative and non-finite values', () => {
    const r = computeTrend([
      { date: '2026-07-01', value: -5 },
      { date: '2026-07-08', value: NaN },
      { date: '2026-07-15', value: 100 },
      { date: '2026-07-22', value: 101 },
      { date: '2026-07-29', value: 102 },
    ]);
    expect(r.invalidIndices).toEqual([0, 1]);
    expect(r.nPoints).toBe(3);
    expect(r.slopePerDay).toBeGreaterThan(0);
  });

  it('keeps zeros when the caller opts out (series where 0 is meaningful)', () => {
    const r = computeTrend(
      [
        { date: '2026-07-01', value: 0 },
        { date: '2026-07-08', value: 1 },
        { date: '2026-07-15', value: 2 },
      ],
      { rejectNonPositive: false }
    );
    expect(r.nInvalid).toBe(0);
    expect(r.slopePerDay).toBeCloseTo(1 / 7, 5);
  });
});

describe('computeTrend — equipment-change discontinuity (Cable Fly repro)', () => {
  it('anchors the fit to the post-shift segment and reports a mildly positive trend', () => {
    const r = computeTrend(CABLE_FLY, { lowConfidenceSpanDays: 10 });
    // Level shift 57.5 → 40 (>25%) persists on the following session.
    expect(r.discontinuityAt).toBeDefined();
    expect(r.discontinuityAt!.getFullYear()).toBe(2026);
    expect(r.discontinuityAt!.getMonth()).toBe(6); // July
    expect(r.discontinuityAt!.getDate()).toBe(14);
    // Fit uses ONLY Jul 14 / 21 / 27.
    expect(r.usedIndices).toEqual([2, 3, 4]);
    expect(r.nPoints).toBe(3);
    // ~+1.3/wk on 42.5 ≈ +3%/wk — NOT the −24.9%/wk the raw OLS reported.
    expect(r.slopePerWeek).toBeGreaterThan(0);
    expect((r.slopePerWeek / 42.5) * 100).toBeGreaterThan(1);
    expect((r.slopePerWeek / 42.5) * 100).toBeLessThan(6);
  });

  it('does NOT segment on a one-off bad day that reverts next session', () => {
    const r = computeTrend([
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-08', value: 70 }, // bad day
      { date: '2026-06-15', value: 100 },
      { date: '2026-06-22', value: 101 },
      { date: '2026-06-29', value: 102 },
    ]);
    expect(r.discontinuityAt).toBeUndefined();
    // The bad day is handled by the outlier pass instead.
    expect(r.excludedIndices).toEqual([1]);
    expect(r.slopePerDay).toBeGreaterThan(0);
  });

  it('segments on a persistent downward shift', () => {
    const r = computeTrend([
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-08', value: 100 },
      { date: '2026-06-15', value: 60 },
      { date: '2026-06-22', value: 61 },
      { date: '2026-06-29', value: 62 },
    ]);
    expect(r.discontinuityAt).toBeDefined();
    expect(r.usedIndices).toEqual([2, 3, 4]);
    expect(r.slopePerDay).toBeGreaterThan(0);
  });

  it('reports insufficient confidence when too few points follow the shift', () => {
    const r = computeTrend([
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-08', value: 101 },
      { date: '2026-06-15', value: 60 },
      { date: '2026-06-22', value: 61 },
    ]);
    expect(r.discontinuityAt).toBeDefined();
    expect(r.confidence).toBe('insufficient');
    expect(r.slopePerDay).toBe(0);
  });

  it('honors caller-known boundaries (user marked "different equipment")', () => {
    const r = computeTrend(
      [
        { date: '2026-06-01', value: 80 },
        { date: '2026-06-08', value: 82 },
        { date: '2026-07-01', value: 70 }, // new gym from here — only −15%,
        { date: '2026-07-08', value: 71 }, // below the heuristic threshold
        { date: '2026-07-15', value: 72 },
      ],
      { knownDiscontinuities: ['2026-07-01'] }
    );
    expect(r.usedIndices).toEqual([2, 3, 4]);
    expect(r.discontinuityAt).toBeDefined();
    expect(r.slopePerDay).toBeCloseTo(1 / 7, 3);
  });
});

describe('computeTrend — MAD outlier rejection (chest tape repro)', () => {
  it('excludes the −1.6" single-week drop and reports a non-negative slope', () => {
    const r = computeTrend(
      [
        { date: '2026-07-09', value: 43.7 },
        { date: '2026-07-16', value: 43.7 },
        { date: '2026-07-19', value: 44.0 },
        { date: '2026-07-26', value: 42.4 }, // tape error during a gain phase
      ],
      { lowConfidenceSpanDays: 21 }
    );
    expect(r.excludedIndices).toEqual([3]);
    expect(r.nExcluded).toBe(1);
    expect(r.slopePerDay).toBeGreaterThanOrEqual(0); // "Down" clears
  });

  it('never rejects outliers from 3 or fewer points', () => {
    const r = computeTrend([
      { date: '2026-07-14', value: 40 },
      { date: '2026-07-21', value: 40 },
      { date: '2026-07-27', value: 42.5 },
    ]);
    expect(r.nExcluded).toBe(0);
    expect(r.nPoints).toBe(3);
  });

  it('caps exclusions so the pass cannot eat the series', () => {
    const noisy = [
      { date: '2026-06-01', value: 100 },
      { date: '2026-06-08', value: 130 },
      { date: '2026-06-15', value: 70 },
      { date: '2026-06-22', value: 135 },
      { date: '2026-06-29', value: 65 },
      { date: '2026-07-06', value: 100 },
    ];
    const r = computeTrend(noisy);
    expect(r.nExcluded).toBeLessThanOrEqual(Math.floor(noisy.length * 0.25));
  });
});

describe('computeTrend — regresses on elapsed days, never array index', () => {
  it('a 6-month gap is 180 days of x, not one index step', () => {
    const points = [
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-02', value: 10.5 },
      { date: '2026-01-03', value: 11 },
      { date: '2026-06-30', value: 20 }, // 180 days later
    ];
    const r = computeTrend(points, { lowConfidenceSpanDays: 0, lowConfidenceGapDays: 400 });
    // The old index-based OLS (the corrupted x the migration removes) reports
    // ~3 units per "step"; the date-based slope must be bounded by the
    // fastest observed daily change (0.5/day).
    const ys = points.map((p) => p.value);
    const n = ys.length;
    const sumX = ys.reduce((a, _, i) => a + i, 0);
    const sumY = ys.reduce((a, y) => a + y, 0);
    const sumXY = ys.reduce((a, y, i) => a + i * y, 0);
    const sumXX = ys.reduce((a, _, i) => a + i * i, 0);
    const indexBased = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    expect(indexBased).toBeGreaterThan(1);
    expect(r.slopePerDay).toBeLessThan(0.6);
    expect(r.slopePerDay).toBeGreaterThan(0);
    expect(r.spanDays).toBeCloseTo(180, 0);
    expect(r.maxGapDays).toBeCloseTo(178, 0);
  });

  it('flags a months-long gap as low confidence', () => {
    const r = computeTrend([
      { date: '2025-12-29', value: 43.5 },
      { date: '2026-07-09', value: 43.7 },
      { date: '2026-07-16', value: 43.7 },
      { date: '2026-07-19', value: 44.0 },
    ]);
    expect(r.maxGapDays).toBeGreaterThan(45);
    expect(r.confidence).toBe('low');
  });
});

describe('computeTrend — confidence gating', () => {
  it('returns insufficient below minPoints and callers get no rate', () => {
    const r = computeTrend([
      { date: '2026-07-01', value: 100 },
      { date: '2026-07-08', value: 105 },
    ]);
    expect(r.confidence).toBe('insufficient');
    expect(r.slopePerDay).toBe(0);
    expect(r.slopePerWeek).toBe(0);
    expect(r.slopePerMonth).toBe(0);
  });

  it('flags a short span as low confidence with the honest observed delta', () => {
    // 3 entries over 17 days: a per-month rate would be a 1.8× extrapolation.
    const r = computeTrend(
      [
        { date: '2026-07-09', value: 43.1 },
        { date: '2026-07-19', value: 43.6 },
        { date: '2026-07-26', value: 44.0 },
      ],
      { lowConfidenceSpanDays: 21 }
    );
    expect(r.confidence).toBe('low');
    expect(r.spanDays).toBe(17);
    expect(r.observedDelta).toBeCloseTo(0.9, 5);
  });

  it('windowed sub-series stay consistent in sign and magnitude with the full series', () => {
    // Hips repro: 1M and 12M views must not diverge 33× once the outlier is
    // handled and x is elapsed days.
    const yearOfEntries = [
      { date: '2025-08-01', value: 40.0 },
      { date: '2025-10-01', value: 40.0 },
      { date: '2025-12-01', value: 40.1 },
      { date: '2026-02-01', value: 40.0 },
      { date: '2026-04-01', value: 40.1 },
      { date: '2026-06-28', value: 40.0 },
      { date: '2026-07-05', value: 40.1 },
      { date: '2026-07-12', value: 40.0 },
      { date: '2026-07-19', value: 40.1 },
      { date: '2026-07-26', value: 39.2 }, // tape error
    ];
    const monthCutoff = '2026-06-27';
    const full = computeTrend(yearOfEntries);
    const lastMonth = computeTrend(yearOfEntries.filter((p) => p.date >= monthCutoff));
    // Both windows exclude the corrupt entry and read ~flat.
    expect(Math.abs(full.slopePerMonth)).toBeLessThan(0.15);
    expect(Math.abs(lastMonth.slopePerMonth)).toBeLessThan(0.35);
  });
});

describe('computeTrend — degenerate inputs', () => {
  it('handles an empty series', () => {
    const r = computeTrend([]);
    expect(r.confidence).toBe('insufficient');
    expect(r.nPoints).toBe(0);
  });

  it('handles all-invalid series', () => {
    const r = computeTrend([
      { date: '2026-07-01', value: 0 },
      { date: '2026-07-08', value: -1 },
    ]);
    expect(r.confidence).toBe('insufficient');
    expect(r.nInvalid).toBe(2);
  });

  it('handles same-day duplicate entries without dividing by zero', () => {
    const r = computeTrend([
      { date: '2026-07-01', value: 100 },
      { date: '2026-07-01', value: 102 },
      { date: '2026-07-08', value: 104 },
      { date: '2026-07-15', value: 106 },
    ]);
    expect(Number.isFinite(r.slopePerDay)).toBe(true);
    expect(r.slopePerDay).toBeGreaterThan(0);
  });

  it('accepts Date objects and date strings interchangeably', () => {
    const asStrings = computeTrend([
      { date: '2026-07-01', value: 100 },
      { date: '2026-07-08', value: 102 },
      { date: '2026-07-15', value: 104 },
    ]);
    const asDates = computeTrend([
      { date: new Date(2026, 6, 1), value: 100 },
      { date: new Date(2026, 6, 8), value: 102 },
      { date: new Date(2026, 6, 15), value: 104 },
    ]);
    expect(asDates.slopePerDay).toBeCloseTo(asStrings.slopePerDay, 10);
  });
});

describe('uniformSeriesSlope', () => {
  it('returns the per-step slope of a uniform series', () => {
    expect(uniformSeriesSlope([0, 1, 2, 3])).toBeCloseTo(1, 5);
    expect(uniformSeriesSlope([10, 8, 6, 4])).toBeCloseTo(-2, 5);
    expect(uniformSeriesSlope([5])).toBe(0);
  });

  it('is robust to a single corrupt entry', () => {
    // OLS over [10, 11, 0, 13, 14] reports a shallower (even negative-ish)
    // slope; Theil–Sen holds ~+1/step.
    expect(uniformSeriesSlope([10, 11, 0, 13, 14])).toBeCloseTo(1, 1);
  });
});
