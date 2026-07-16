import {
  computeEwmaTrend,
  computeWaistTrend,
  latestWaistTrendIn,
  waistDataDaysInWindow,
  hasEnoughWaistData,
  classifyPartitionBand,
  leanFractionFromRatio,
  computePartitionAnchor,
  resolvePartition,
  evaluatePaceCheck,
  WAIST_PARTITION,
  type WaistEntry,
  type WeightEntry,
} from '@/services/waistTrend';

// ============================================================
// Fixture helpers — deterministic daily ramps so the EWMA trend
// deltas are predictable to within its lag.
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** N consecutive daily dates ending at `end` (YYYY-MM-DD), ascending. */
function dailyDates(end: string, n: number): string[] {
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) =>
    new Date(endMs - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );
}

function waistRamp(end: string, n: number, startIn: number, perDayIn: number): WaistEntry[] {
  return dailyDates(end, n).map((date, i) => ({ date, waistIn: startIn + perDayIn * i }));
}

function weightRamp(end: string, n: number, startLb: number, perDayLb: number): WeightEntry[] {
  return dailyDates(end, n).map((date, i) => ({ date, weightLb: startLb + perDayLb * i }));
}

// ============================================================
// computeEwmaTrend
// ============================================================

describe('computeEwmaTrend', () => {
  it('seeds on the first entry and smooths toward later values', () => {
    const out = computeEwmaTrend([
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: 110 },
    ]);
    expect(out[0].trend).toBe(100); // seed = first raw
    // One day, tau=10 → alpha = 1 - e^-0.1 ≈ 0.0952; trend moves ~1 toward 110.
    expect(out[1].trend).toBeGreaterThan(100);
    expect(out[1].trend).toBeLessThan(110);
  });

  it('grows alpha with the gap between entries (sparse points track faster)', () => {
    const near = computeEwmaTrend([
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: 110 },
    ]);
    const far = computeEwmaTrend([
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-21', value: 110 },
    ]);
    expect(far[1].trend).toBeGreaterThan(near[1].trend);
  });

  it('flags and excludes an outlier without moving the trend', () => {
    const out = computeEwmaTrend(
      [
        { date: '2026-01-01', value: 34 },
        { date: '2026-01-02', value: 34.1 },
        { date: '2026-01-03', value: 36.2 }, // +2.1 jump → outlier
        { date: '2026-01-04', value: 34.2 },
      ],
      10,
      1.5
    );
    const jump = out.find((p) => p.date === '2026-01-03')!;
    expect(jump.isOutlier).toBe(true);
    // Trend held flat across the outlier (equals the prior point's trend).
    const prior = out.find((p) => p.date === '2026-01-02')!;
    expect(jump.trend).toBeCloseTo(prior.trend, 6);
  });
});

// ============================================================
// computeWaistTrend — outlier guard (verification: +2" jump excluded)
// ============================================================

describe('computeWaistTrend outlier guard', () => {
  it('flags an entry >1.5" from trend and excludes it from the trend', () => {
    const entries: WaistEntry[] = [
      { date: '2026-01-01', waistIn: 34.0 },
      { date: '2026-01-02', waistIn: 34.1 },
      { date: '2026-01-03', waistIn: 34.0 },
      { date: '2026-01-04', waistIn: 36.0 }, // +2" jump
      { date: '2026-01-05', waistIn: 34.1 },
    ];
    const trend = computeWaistTrend(entries);
    const flagged = trend.find((p) => p.date === '2026-01-04')!;
    expect(flagged.isOutlier).toBe(true);
    // The excluded entry must not drag the latest trend up near 36.
    expect(latestWaistTrendIn(trend)!).toBeLessThan(34.5);
  });
});

// ============================================================
// Hard gate (verification: 8 days → no signals; ≥10 → signals)
// ============================================================

describe('hard 10-of-28 gate', () => {
  it('reports enough data at 14 days but not at 8', () => {
    const eight = computeWaistTrend(waistRamp('2026-02-14', 8, 34, 0.001));
    const fourteen = computeWaistTrend(waistRamp('2026-02-14', 14, 34, 0.001));
    expect(hasEnoughWaistData(eight, '2026-02-14')).toBe(false);
    expect(hasEnoughWaistData(fourteen, '2026-02-14')).toBe(true);
  });

  it('only counts valid days within the trailing 28', () => {
    const trend = computeWaistTrend(waistRamp('2026-02-28', 20, 34, 0.001));
    expect(waistDataDaysInWindow(trend, '2026-02-28')).toBe(20);
    // Two months later the window is empty.
    expect(waistDataDaysInWindow(trend, '2026-05-01')).toBe(0);
  });

  it('returns NO partition anchor with only 8 days of data', () => {
    const waist = waistRamp('2026-02-14', 8, 34, 0.002);
    const weight = weightRamp('2026-02-14', 8, 180, 0.2);
    expect(computePartitionAnchor({ waist, weight })).toBeNull();
  });
});

// ============================================================
// Banding + lean-fraction mapping
// ============================================================

describe('classifyPartitionBand', () => {
  it('applies the documented edges', () => {
    expect(classifyPartitionBand(0.0)).toBe('lean-dominant');
    expect(classifyPartitionBand(WAIST_PARTITION.BANDS.LEAN_MAX)).toBe('lean-dominant');
    expect(classifyPartitionBand(0.1)).toBe('mixed');
    expect(classifyPartitionBand(WAIST_PARTITION.BANDS.FAT_MIN)).toBe('mixed');
    expect(classifyPartitionBand(0.2)).toBe('fat-dominant');
  });
});

describe('leanFractionFromRatio', () => {
  it('is monotonic decreasing and clamps at the band anchors', () => {
    expect(leanFractionFromRatio(0)).toBe(WAIST_PARTITION.LEAN_FRACTION_AT.LEAN);
    expect(leanFractionFromRatio(1)).toBe(WAIST_PARTITION.LEAN_FRACTION_AT.FAT);
    const mid = leanFractionFromRatio(0.085); // midway between edges
    expect(mid).toBeLessThan(WAIST_PARTITION.LEAN_FRACTION_AT.LEAN);
    expect(mid).toBeGreaterThan(WAIST_PARTITION.LEAN_FRACTION_AT.FAT);
  });
});

// ============================================================
// Partition anchor + resolvePartition
// (verification: 14d, weight up, tiny waist gain → lean-dominant;
//  projection uses observed ratio and labels it)
// ============================================================

describe('computePartitionAnchor', () => {
  it('lean-dominant when waist is ~flat while weight climbs, and resolves to observed+labeled', () => {
    // 28 days of history so the EWMA is converged; measure the trailing window.
    const waist = waistRamp('2026-03-28', 28, 34, 0.0006); // ~0.017" over 28d — flat
    const weight = weightRamp('2026-03-28', 28, 180, 0.12); // ~+3.4 lb trend
    const anchor = computePartitionAnchor({ waist, weight });
    expect(anchor).not.toBeNull();
    expect(anchor!.deltaWeightLb).toBeGreaterThan(1);
    expect(anchor!.ratioInPerLb).toBeLessThanOrEqual(WAIST_PARTITION.BANDS.LEAN_MAX);
    expect(anchor!.band).toBe('lean-dominant');

    const resolved = resolvePartition(anchor, 0.4);
    expect(resolved.source).toBe('waist');
    expect(resolved.label).toBe('partition from your waist trend');
    expect(resolved.leanFractionOfGain).toBe(WAIST_PARTITION.LEAN_FRACTION_AT.LEAN);
  });

  it('fat-dominant when the waist trend outruns the weight trend', () => {
    const waist = waistRamp('2026-03-28', 28, 34, 0.04); // steep waist rise
    const weight = weightRamp('2026-03-28', 28, 180, 0.12);
    const anchor = computePartitionAnchor({ waist, weight });
    expect(anchor).not.toBeNull();
    expect(anchor!.ratioInPerLb).toBeGreaterThan(WAIST_PARTITION.BANDS.FAT_MIN);
    expect(anchor!.band).toBe('fat-dominant');
  });

  it('returns null when the weight trend change is within noise', () => {
    const waist = waistRamp('2026-03-28', 28, 34, 0.01);
    const weight = weightRamp('2026-03-28', 28, 180, 0.0); // flat weight
    expect(computePartitionAnchor({ waist, weight })).toBeNull();
  });
});

describe('resolvePartition fallback', () => {
  it('uses the fixed assumption and the "assumed" label when there is no anchor', () => {
    const resolved = resolvePartition(null, 0.4);
    expect(resolved.source).toBe('assumed');
    expect(resolved.label).toBe('assumed partition');
    expect(resolved.leanFractionOfGain).toBe(0.4);
    expect(resolved.anchor).toBeNull();
  });
});

// ============================================================
// Bulk pace check (derived signal 2)
// ============================================================

describe('evaluatePaceCheck', () => {
  const fatAnchor = {
    ratioInPerLb: 0.17,
    band: 'fat-dominant' as const,
    windowDays: 14,
    deltaWaistIn: 0.4,
    deltaWeightLb: 2.4,
    waistDataDays: 14,
    leanFractionOfGain: 0.2,
  };
  const NOW = new Date('2026-04-01T12:00:00Z').getTime();

  it('fires on a bulk with a fat-dominant ratio while gaining at/above target, with numbers', () => {
    const sig = evaluatePaceCheck({
      anchor: fatAnchor,
      weightRateLbPerWeek: 1.2,
      targetRateLbPerWeek: 1.0,
      phase: 'bulk',
      nowMs: NOW,
    });
    expect(sig).not.toBeNull();
    expect(sig!.message).toContain('+0.40"');
    expect(sig!.message).toContain('14 days');
    expect(sig!.message).toContain('+2.4 lb');
    expect(sig!.message.toLowerCase()).toContain('fat-dominant');
  });

  it('never fires on a cut (mirror signal is out of scope for v1)', () => {
    expect(
      evaluatePaceCheck({
        anchor: fatAnchor,
        weightRateLbPerWeek: -1.0,
        targetRateLbPerWeek: -1.0,
        phase: 'cut',
        nowMs: NOW,
      })
    ).toBeNull();
  });

  it('does not fire when gaining below target', () => {
    expect(
      evaluatePaceCheck({
        anchor: fatAnchor,
        weightRateLbPerWeek: 0.3,
        targetRateLbPerWeek: 1.0,
        phase: 'bulk',
        nowMs: NOW,
      })
    ).toBeNull();
  });

  it('does not fire without an anchor (gate not met)', () => {
    expect(
      evaluatePaceCheck({
        anchor: null,
        weightRateLbPerWeek: 1.2,
        targetRateLbPerWeek: 1.0,
        phase: 'bulk',
        nowMs: NOW,
      })
    ).toBeNull();
  });

  it('fires at most once per week (respects a recent fire or dismissal)', () => {
    const base = {
      anchor: fatAnchor,
      weightRateLbPerWeek: 1.2,
      targetRateLbPerWeek: 1.0,
      phase: 'bulk' as const,
      nowMs: NOW,
    };
    // Fired 3 days ago → suppressed.
    expect(
      evaluatePaceCheck({ ...base, lastFiredAtMs: NOW - 3 * DAY_MS })
    ).toBeNull();
    // Dismissed 2 days ago → suppressed.
    expect(
      evaluatePaceCheck({ ...base, lastDismissedAtMs: NOW - 2 * DAY_MS })
    ).toBeNull();
    // Fired 8 days ago → allowed again.
    expect(
      evaluatePaceCheck({ ...base, lastFiredAtMs: NOW - 8 * DAY_MS })
    ).not.toBeNull();
  });

  it('does not fire on a mixed-band bulk', () => {
    expect(
      evaluatePaceCheck({
        anchor: { ...fatAnchor, band: 'mixed', ratioInPerLb: 0.08 },
        weightRateLbPerWeek: 1.2,
        targetRateLbPerWeek: 1.0,
        phase: 'bulk',
        nowMs: NOW,
      })
    ).toBeNull();
  });
});
