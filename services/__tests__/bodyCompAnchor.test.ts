import {
  buildAnchoredBodyCompTrend,
  rescaleSegment,
  type ScanAnchor,
  type WeightPoint,
} from '@/services/bodyCompAnchor';

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
