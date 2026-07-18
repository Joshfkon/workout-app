import {
  buildAnchoredBodyCompTrend,
  computeTrendChangesSince,
  findLowConfidenceGaps,
  rescaleSegment,
  LOW_CONFIDENCE_GAP_DAYS,
  type AnchoredTrendPoint,
  type ScanAnchor,
  type WeightPoint,
} from '@/services/bodyCompAnchor';
import { computeFFMI } from '@/services/bodyCompEngine';

// ============================================================
// rescaleSegment — the core "estimated segment fitted to both
// endpoints" math (spec: unit test on the rescale math)
// ============================================================

describe('rescaleSegment', () => {
  it('leaves a series alone when it already passes through both endpoints', () => {
    const values = [
      { day: 0, value: 10 },
      { day: 5, value: 12 },
      { day: 10, value: 14 },
    ];
    const out = rescaleSegment(values, { day: 0, value: 10 }, { day: 10, value: 14 });
    expect(out).toEqual([10, 12, 14]);
  });

  it('applies the full endpoint residual at the end and none at the start', () => {
    // Estimate drifted +2 by day 10; observation says 14, estimate says 16.
    const values = [
      { day: 0, value: 10 },
      { day: 10, value: 16 },
    ];
    const out = rescaleSegment(values, { day: 0, value: 10 }, { day: 10, value: 14 });
    expect(out[0]).toBe(10); // start anchored exactly
    expect(out[1]).toBe(14); // end anchored exactly
  });

  it('distributes the correction linearly in time (midpoint gets half)', () => {
    const values = [
      { day: 0, value: 10 },
      { day: 5, value: 10 }, // estimate says flat
      { day: 10, value: 10 },
    ];
    // Observation: it actually rose to 14 → residual +4 at the end.
    const out = rescaleSegment(values, { day: 0, value: 10 }, { day: 10, value: 14 });
    expect(out).toEqual([10, 12, 14]); // midpoint corrected by half the residual
  });

  it('corrects a start-side residual too (segment shifted onto both anchors)', () => {
    // Estimate is uniformly 2 too high at the start and exact at the end.
    const values = [
      { day: 0, value: 12 },
      { day: 10, value: 14 },
    ];
    const out = rescaleSegment(values, { day: 0, value: 10 }, { day: 10, value: 14 });
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(14);
  });

  it('preserves the shape of the interior (correction is affine, not smoothing)', () => {
    // A zig-zag stays a zig-zag, just tilted onto the anchors.
    const values = [
      { day: 0, value: 0 },
      { day: 2, value: 5 },
      { day: 4, value: 1 },
      { day: 6, value: 6 },
      { day: 8, value: 2 },
      { day: 10, value: 0 },
    ];
    const out = rescaleSegment(values, { day: 0, value: 0 }, { day: 10, value: 10 });
    // Endpoints exact.
    expect(out[0]).toBe(0);
    expect(out[5]).toBe(10);
    // Interior differences between neighbors change by exactly the per-day
    // tilt (residual 10 over 10 days = +1/day → +2 per 2-day step).
    for (let i = 1; i < values.length; i++) {
      const baseStep = values[i].value - values[i - 1].value;
      const outStep = out[i] - out[i - 1];
      expect(outStep - baseStep).toBeCloseTo(2, 10);
    }
  });

  it('handles an empty series and a zero-length span gracefully', () => {
    expect(rescaleSegment([], { day: 0, value: 1 }, { day: 5, value: 2 })).toEqual([]);
    const same = rescaleSegment(
      [{ day: 3, value: 7 }],
      { day: 3, value: 1 },
      { day: 3, value: 2 }
    );
    expect(same).toEqual([7]);
  });
});

// ============================================================
// buildAnchoredBodyCompTrend
// ============================================================

/** Two scans 20 days apart with a clean, consistent story. */
const scanA: ScanAnchor = {
  date: '2026-06-01',
  bodyFatPercent: 20,
  leanMassKg: 64,
  fatMassKg: 16, // 16 / 80 = 20%
};
const scanB: ScanAnchor = {
  date: '2026-06-21',
  bodyFatPercent: 17.5,
  leanMassKg: 66,
  fatMassKg: 14, // 14 / 80 = 17.5% — same implied weight as scan A
};

describe('buildAnchoredBodyCompTrend', () => {
  it('returns nothing without scans (weight alone cannot estimate composition)', () => {
    const weights: WeightPoint[] = [{ date: '2026-06-01', weightKg: 80 }];
    expect(buildAnchoredBodyCompTrend(weights, [])).toEqual([]);
  });

  it('emits scan dates as exact dexa anchor points', () => {
    const trend = buildAnchoredBodyCompTrend([], [scanA, scanB]);
    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({
      date: scanA.date,
      kind: 'dexa',
      bodyFatPercent: 20,
      leanMassKg: 64,
      fatMassKg: 16,
    });
    expect(trend[1]).toMatchObject({ date: scanB.date, kind: 'dexa', leanMassKg: 66 });
  });

  it('passes exactly through both scans with estimated points in between', () => {
    const weights: WeightPoint[] = [
      { date: '2026-06-06', weightKg: 80.2 },
      { date: '2026-06-11', weightKg: 80.3 },
      { date: '2026-06-16', weightKg: 80.5 },
    ];
    const trend = buildAnchoredBodyCompTrend(weights, [scanA, scanB]);

    const anchors = trend.filter((p) => p.kind === 'dexa');
    const estimates = trend.filter((p) => p.kind === 'estimated');
    expect(anchors.map((p) => p.date)).toEqual([scanA.date, scanB.date]);
    expect(estimates).toHaveLength(3);

    // Anchors carry the scans' exact values.
    expect(anchors[0].leanMassKg).toBe(64);
    expect(anchors[1].leanMassKg).toBe(66);
    expect(anchors[1].fatMassKg).toBe(14);

    // Estimates land between the endpoints and move monotonically toward B
    // for this monotone weight series.
    const leans = estimates.map((p) => p.leanMassKg);
    expect(Math.min(...leans)).toBeGreaterThanOrEqual(64);
    expect(Math.max(...leans)).toBeLessThanOrEqual(66);
    expect([...leans].sort((a, b) => a - b)).toEqual(leans);
  });

  it('rescales the interior linearly: a flat-weight midpoint gets half the residual', () => {
    // Weight never moves (both scans imply 80 kg), so the base estimate stays
    // at scan A's values and the entire A→B recomposition is residual,
    // distributed linearly in time — the midpoint gets exactly half.
    const midpoint: WeightPoint[] = [{ date: '2026-06-11', weightKg: 80 }];
    const trend = buildAnchoredBodyCompTrend(midpoint, [scanA, scanB]);
    const mid = trend.find((p) => p.date === '2026-06-11');
    expect(mid).toBeDefined();
    expect(mid!.kind).toBe('estimated');
    expect(mid!.leanMassKg).toBeCloseTo(65, 1); // halfway 64 → 66
    expect(mid!.fatMassKg).toBeCloseTo(15, 1); // halfway 16 → 14
  });

  it('projects forward from the latest scan using the p-ratio', () => {
    const after: WeightPoint[] = [{ date: '2026-07-01', weightKg: 82 }]; // +2 vs scan B weight (80)
    const trend = buildAnchoredBodyCompTrend(after, [scanA, scanB], { pRatio: 0.5 });
    const proj = trend.find((p) => p.date === '2026-07-01');
    expect(proj).toBeDefined();
    expect(proj!.kind).toBe('estimated');
    expect(proj!.leanMassKg).toBeCloseTo(67, 1); // 66 + 0.5 * 2
    expect(proj!.fatMassKg).toBeCloseTo(15, 1); // 14 + 0.5 * 2
  });

  it('backcasts before the first scan from that scan', () => {
    const before: WeightPoint[] = [{ date: '2026-05-22', weightKg: 78 }]; // -2 vs scan A weight (80)
    const trend = buildAnchoredBodyCompTrend(before, [scanA, scanB], { pRatio: 0.5 });
    const back = trend.find((p) => p.date === '2026-05-22');
    expect(back).toBeDefined();
    expect(back!.leanMassKg).toBeCloseTo(63, 1);
    expect(back!.fatMassKg).toBeCloseTo(15, 1);
  });

  it('anchors deltas to the recorded scan weight, not lean + fat (bone offset)', () => {
    // Scan reports total 82 kg: 64 lean + 16 fat + 2 bone. A later weigh-in
    // of exactly 82 kg is NOT a gain — the projection must stay at the
    // scan's composition instead of splitting a phantom +2 kg.
    const scanWithBone: ScanAnchor = {
      date: '2026-06-01',
      bodyFatPercent: 19.5, // 16 / 82
      leanMassKg: 64,
      fatMassKg: 16,
      weightKg: 82,
    };
    const trend = buildAnchoredBodyCompTrend(
      [{ date: '2026-06-08', weightKg: 82 }],
      [scanWithBone]
    );

    const anchor = trend.find((p) => p.kind === 'dexa');
    expect(anchor!.weightKg).toBe(82); // recorded total, not 80

    const proj = trend.find((p) => p.date === '2026-06-08');
    expect(proj!.leanMassKg).toBeCloseTo(64, 1);
    expect(proj!.fatMassKg).toBeCloseTo(16, 1);
    // BF% keeps the scan's fat-over-total-weight convention (16/82, not 16/80).
    expect(proj!.bodyFatPercent).toBeCloseTo(19.5, 1);
  });

  it('interpolates bone mass linearly between scans and clamps beyond the ends', () => {
    const withBoneA: ScanAnchor = { ...scanA, boneMassKg: 3.0 };
    const withBoneB: ScanAnchor = { ...scanB, boneMassKg: 3.2 };
    const weights: WeightPoint[] = [
      { date: '2026-05-22', weightKg: 79 }, // before first scan
      { date: '2026-06-11', weightKg: 80 }, // exact midpoint of the 20-day span
      { date: '2026-07-01', weightKg: 81 }, // after last scan
    ];
    const trend = buildAnchoredBodyCompTrend(weights, [withBoneA, withBoneB]);

    const at = (date: string) => trend.find((p) => p.date === date)!;
    expect(at(scanA.date).boneMassKg).toBe(3.0); // scan's own logged value
    expect(at(scanB.date).boneMassKg).toBe(3.2);
    expect(at('2026-06-11').boneMassKg).toBeCloseTo(3.1, 2); // midpoint
    expect(at('2026-05-22').boneMassKg).toBe(3.0); // clamped before first
    expect(at('2026-07-01').boneMassKg).toBe(3.2); // clamped after last
  });

  it('reports null bone mass when no scan logged it, and fills a bone-less scan from neighbors', () => {
    const noBone = buildAnchoredBodyCompTrend(
      [{ date: '2026-06-11', weightKg: 80 }],
      [scanA, scanB]
    );
    expect(noBone.every((p) => p.boneMassKg === null)).toBe(true);

    // A scan without bone between two scans with bone gets the interpolated
    // BMC (it's nearly constant), not null.
    const scanMid: ScanAnchor = {
      date: '2026-06-11',
      bodyFatPercent: 19,
      leanMassKg: 65,
      fatMassKg: 15,
    };
    const mixed = buildAnchoredBodyCompTrend(
      [],
      [{ ...scanA, boneMassKg: 3.0 }, scanMid, { ...scanB, boneMassKg: 3.2 }]
    );
    const mid = mixed.find((p) => p.date === scanMid.date)!;
    expect(mid.boneMassKg).toBeCloseTo(3.1, 2);
  });

  it('FFMI computed from trend anchors matches FFMI computed directly from each scan', () => {
    // The FFMI series must pass exactly through FFMI at every DEXA point —
    // anchor points carry the scans' exact lean + bone, so the shared
    // computeFFMI yields identical results from either source.
    const heightCm = 179;
    const withBoneA: ScanAnchor = { ...scanA, boneMassKg: 3.0 };
    const withBoneB: ScanAnchor = { ...scanB, boneMassKg: 3.2 };
    const weights: WeightPoint[] = [
      { date: '2026-06-06', weightKg: 80.2 },
      { date: '2026-06-16', weightKg: 80.5 },
    ];
    const trend = buildAnchoredBodyCompTrend(weights, [withBoneA, withBoneB]);

    for (const scan of [withBoneA, withBoneB]) {
      const anchor = trend.find((p) => p.date === scan.date)!;
      expect(anchor.kind).toBe('dexa');
      expect(
        computeFFMI(anchor.leanMassKg, anchor.boneMassKg, heightCm)
      ).toEqual(computeFFMI(scan.leanMassKg, scan.boneMassKg, heightCm));
    }
  });

  it('drops logged bone for calculated-entry scans whose lean already contains it', () => {
    // Calculated-mode entry: lean = weight − fat (85 = 68 + 17), so the lean
    // is already fat-free mass; the logged 3 kg BMC must NOT be added again
    // (nor leak into interpolation for other points).
    const calculatedScan: ScanAnchor = {
      date: '2026-06-01',
      bodyFatPercent: 20,
      leanMassKg: 68,
      fatMassKg: 17,
      weightKg: 85,
      boneMassKg: 3,
    };
    const trend = buildAnchoredBodyCompTrend(
      [{ date: '2026-06-08', weightKg: 85 }],
      [calculatedScan]
    );

    expect(trend.find((p) => p.kind === 'dexa')!.boneMassKg).toBeNull();
    expect(trend.find((p) => p.date === '2026-06-08')!.boneMassKg).toBeNull();

    // A genuine DEXA report (lean + fat + bone ≈ weight) keeps its bone.
    const genuineScan: ScanAnchor = { ...calculatedScan, leanMassKg: 65, weightKg: 85 };
    const genuine = buildAnchoredBodyCompTrend([], [genuineScan]);
    expect(genuine[0].boneMassKg).toBe(3);
  });

  it('gauge value equals the last point of the FFMI trend series', () => {
    // The Analytics gauge reads FFMI from the trend's last point through the
    // same computeFFMI the chart uses; projecting forward from scan B
    // (weight 80 → 82, pRatio 0.5) the last point is lean 67, bone 3.2.
    const heightCm = 179;
    const withBoneB: ScanAnchor = { ...scanB, boneMassKg: 3.2 };
    const trend = buildAnchoredBodyCompTrend(
      [{ date: '2026-07-01', weightKg: 82 }],
      [{ ...scanA, boneMassKg: 3.0 }, withBoneB],
      { pRatio: 0.5 }
    );

    const last = trend[trend.length - 1];
    expect(last.date).toBe('2026-07-01');
    const gaugeValue = computeFFMI(last.leanMassKg, last.boneMassKg, heightCm);
    // (67 + 3.2) / 1.79² = 70.2 / 3.2041 = 21.91 → 21.9
    expect(gaugeValue.ffmi).toBeCloseTo(21.9, 1);
  });

  it('prefers the scan over a same-day weight entry and stays deterministic', () => {
    const weights: WeightPoint[] = [
      { date: scanB.date, weightKg: 99 }, // conflicting same-day weigh-in
      { date: '2026-06-11', weightKg: 80 },
    ];
    const a = buildAnchoredBodyCompTrend(weights, [scanA, scanB]);
    const b = buildAnchoredBodyCompTrend(weights, [scanA, scanB]);
    expect(a).toEqual(b);

    const scanPoint = a.find((p) => p.date === scanB.date);
    expect(scanPoint!.kind).toBe('dexa');
    expect(scanPoint!.leanMassKg).toBe(66); // scan wins over the weigh-in

    // Output sorted by date.
    const dates = a.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

// ============================================================
// findLowConfidenceGaps — low-confidence spans for the trend chart
// ============================================================

describe('findLowConfidenceGaps', () => {
  it('finds no gaps in a densely-supported series', () => {
    const dates = ['2026-06-01', '2026-06-05', '2026-06-12', '2026-06-15'];
    expect(findLowConfidenceGaps(dates)).toEqual([]);
  });

  it('flags a months-long void between weigh-ins as a single gap', () => {
    // Dense December cluster, then nothing from Mar 1 to Jul 6 — the classic
    // "4 months rendered as wide as 2 weeks" case the time axis fix targets.
    const dates = [
      '2025-12-15',
      '2025-12-22',
      '2025-12-28',
      '2026-03-01',
      '2026-07-06',
    ];
    const gaps = findLowConfidenceGaps(dates);

    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({
      fromIndex: 2,
      toIndex: 3,
      fromDate: '2025-12-28',
      toDate: '2026-03-01',
      gapDays: 63,
    });
    expect(gaps[1]).toMatchObject({
      fromDate: '2026-03-01',
      toDate: '2026-07-06',
      gapDays: 127,
    });
  });

  it('treats exactly the threshold as supported, one day past it as a gap', () => {
    expect(LOW_CONFIDENCE_GAP_DAYS).toBe(14);
    expect(findLowConfidenceGaps(['2026-06-01', '2026-06-15'])).toEqual([]); // 14 days
    expect(findLowConfidenceGaps(['2026-06-01', '2026-06-16'])).toHaveLength(1); // 15 days
  });

  it('respects a custom threshold', () => {
    const dates = ['2026-06-01', '2026-06-08'];
    expect(findLowConfidenceGaps(dates, 6)).toHaveLength(1);
    expect(findLowConfidenceGaps(dates, 7)).toEqual([]);
  });

  it('handles empty and single-point series', () => {
    expect(findLowConfidenceGaps([])).toEqual([]);
    expect(findLowConfidenceGaps(['2026-06-01'])).toEqual([]);
  });
});

// ============================================================
// Waist-trend shaping — the BF% interior "bends" with observed
// waist while both DEXA endpoints stay pinned exactly.
// ============================================================

describe('buildAnchoredBodyCompTrend waist shaping', () => {
  // Two scans one month apart with identical fat mass, and a bodyweight that
  // rises then falls back so weight-driven interior fat is ~flat. A waist
  // trend that bulges upward mid-segment should push interior fat ABOVE the
  // straight line — while both scan points remain exact.
  const scans: ScanAnchor[] = [
    { date: '2026-01-01', bodyFatPercent: 20, leanMassKg: 60, fatMassKg: 20, weightKg: 80 },
    { date: '2026-01-31', bodyFatPercent: 20, leanMassKg: 60, fatMassKg: 20, weightKg: 80 },
  ];
  const weights: WeightPoint[] = [
    { date: '2026-01-11', weightKg: 80 },
    { date: '2026-01-21', weightKg: 80 },
  ];

  it('keeps both scan endpoints exact with a waist trend applied', () => {
    const waistTrend = [
      { date: '2026-01-01', trendIn: 33 },
      { date: '2026-01-16', trendIn: 34 }, // bulge
      { date: '2026-01-31', trendIn: 33 },
    ];
    const trend = buildAnchoredBodyCompTrend(weights, scans, { waistTrend });
    const first = trend.find((p) => p.date === '2026-01-01')!;
    const last = trend.find((p) => p.date === '2026-01-31')!;
    expect(first.kind).toBe('dexa');
    expect(last.kind).toBe('dexa');
    expect(first.fatMassKg).toBe(20);
    expect(last.fatMassKg).toBe(20);
  });

  it('bends interior fat away from the straight-line estimate', () => {
    const straight = buildAnchoredBodyCompTrend(weights, scans);
    const bent = buildAnchoredBodyCompTrend(weights, scans, {
      waistTrend: [
        { date: '2026-01-01', trendIn: 33 },
        { date: '2026-01-16', trendIn: 34.5 }, // strong mid-segment bulge
        { date: '2026-01-31', trendIn: 33 },
      ],
    });
    const mid = '2026-01-11';
    const straightMid = straight.find((p) => p.date === mid)!;
    const bentMid = bent.find((p) => p.date === mid)!;
    // Waist bulged up over the first third → interior fat is pushed higher.
    expect(bentMid.fatMassKg).toBeGreaterThan(straightMid.fatMassKg);
  });

  it('ignores a waist trend that does not overlap the segment (falls back)', () => {
    const straight = buildAnchoredBodyCompTrend(weights, scans);
    const nonOverlapping = buildAnchoredBodyCompTrend(weights, scans, {
      waistTrend: [
        { date: '2025-06-01', trendIn: 33 },
        { date: '2025-06-15', trendIn: 35 },
      ],
    });
    expect(nonOverlapping).toEqual(straight);
  });
});

// ============================================================
// computeTrendChangesSince — stat-card deltas measured from a
// user-chosen reference date (e.g. bulk start)
// ============================================================

describe('computeTrendChangesSince', () => {
  const point = (
    date: string,
    weightKg: number,
    bodyFatPercent: number,
    leanMassKg: number,
    kind: AnchoredTrendPoint['kind'] = 'estimated'
  ): AnchoredTrendPoint => ({
    date,
    weightKg,
    bodyFatPercent,
    leanMassKg,
    fatMassKg: weightKg - leanMassKg,
    boneMassKg: null,
    kind,
  });

  const trend: AnchoredTrendPoint[] = [
    point('2026-05-01', 78, 19, 62, 'dexa'),
    point('2026-06-01', 79, 19.5, 62.4),
    point('2026-07-01', 80, 20, 62.8),
    point('2026-07-18', 80.5, 20.3, 63, 'dexa'),
  ];

  it('measures deltas from the point on the reference date to the latest point', () => {
    const changes = computeTrendChangesSince(trend, '2026-06-01', null);
    expect(changes).not.toBeNull();
    expect(changes!.referenceDate).toBe('2026-06-01');
    expect(changes!.latestDate).toBe('2026-07-18');
    expect(changes!.weightDeltaKg).toBeCloseTo(1.5, 5);
    expect(changes!.bodyFatDelta).toBeCloseTo(0.8, 5);
    expect(changes!.leanMassDeltaKg).toBeCloseTo(0.6, 5);
    expect(changes!.ffmiDelta).toBeNull();
  });

  it('uses the last point at or before the reference date when no point falls on it', () => {
    const changes = computeTrendChangesSince(trend, '2026-06-15', null);
    expect(changes!.referenceDate).toBe('2026-06-01');
  });

  it('falls back to the first point when the reference date predates the trend', () => {
    const changes = computeTrendChangesSince(trend, '2026-01-01', null);
    expect(changes!.referenceDate).toBe('2026-05-01');
    expect(changes!.weightDeltaKg).toBeCloseTo(2.5, 5);
  });

  it('returns null when the reference date is at or after the latest point', () => {
    expect(computeTrendChangesSince(trend, '2026-07-18', null)).toBeNull();
    expect(computeTrendChangesSince(trend, '2026-08-01', null)).toBeNull();
  });

  it('returns null when the trend has fewer than two points', () => {
    expect(computeTrendChangesSince([], '2026-06-01', null)).toBeNull();
    expect(computeTrendChangesSince([trend[0]], '2026-04-01', null)).toBeNull();
  });

  it('computes the FFMI delta with the same bone-aware function as the gauge', () => {
    const heightCm = 180;
    const changes = computeTrendChangesSince(trend, '2026-05-01', heightCm);
    const expected =
      computeFFMI(63, null, heightCm).ffmi - computeFFMI(62, null, heightCm).ffmi;
    expect(changes!.ffmiDelta).toBeCloseTo(Math.round(expected * 10) / 10, 5);
  });
});
