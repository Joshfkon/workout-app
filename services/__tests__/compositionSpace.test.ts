/**
 * compositionSpace — geometry for the Composition Map:
 *
 *  - (FMI, FFMI) points with the FMI + FFMI = BMI decomposition identity
 *    holding at every scan point (imperial and metric profiles),
 *  - the goal-vector progress scalar (projection), including negative and
 *    >100% cases, degenerate vectors, and off-axis drift notes,
 *  - scan-pair p-ratios with |Δweight| < 3 lb suppression and DEXA
 *    noise-floor labeling,
 *  - prominence/layout gating by scan count,
 *  - map viewport helpers (domains, iso-BMI clipping).
 */

import {
  toCompositionPoint,
  buildCompositionPath,
  normalizeTargetPoint,
  computeGoalVectorProgress,
  selectStartPoint,
  computeScanPairPRatios,
  classifyPartitioning,
  getBodyCompLayout,
  computeMapDomain,
  computeCompositionForecast,
  computeSuggestedTarget,
  athleticZonePolygon,
  zoneOverlapsDomain,
  zoneDirectionArrow,
  fmiAtBf,
  ATHLETIC_ZONE_MALE,
  ATHLETIC_ZONE_FEMALE,
  SUGGESTED_BULK_BF_CAP_PERCENT,
  FORECAST_HORIZON_WEEKS,
  FORECAST_NOISE_RADIUS,
  isoBmiSegment,
  visibleIsoBmiSegments,
  LB_TO_KG,
  P_RATIO_MIN_WEIGHT_DELTA_KG,
  NOISE_FLOOR_LEAN_KG,
  DEGENERATE_GOAL_EPSILON,
  OFF_AXIS_NOTE_THRESHOLD,
  MIN_SCANS_FOR_COMPOSITION_MAP,
  type CompositionObservation,
  type CompositionPoint,
} from '@/services/compositionSpace';
import { computeFFMI } from '@/services/bodyCompEngine';

// ============ composition points & the BMI identity ============

describe('toCompositionPoint / buildCompositionPath', () => {
  // Metric profile: 180 cm, real-DEXA shape (lean excludes bone).
  const metricScans: CompositionObservation[] = [
    { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, boneMassKg: 3 },
    { date: '2026-03-10', leanMassKg: 62, fatMassKg: 13.5, weightKg: 78.5, boneMassKg: 3 },
    { date: '2026-06-01', leanMassKg: 63.4, fatMassKg: 16.6, weightKg: 83, boneMassKg: 3 },
  ];

  // Imperial profile entered in lb/in, converted at the edges (as the app
  // stores everything): 70.5 in = 179.07 cm; masses from lb.
  const imperialHeightCm = 70.5 * 2.54;
  const imperialScans: CompositionObservation[] = [
    {
      date: '2026-01-05',
      leanMassKg: 135 * LB_TO_KG,
      fatMassKg: 30 * LB_TO_KG,
      weightKg: 175 * LB_TO_KG,
      boneMassKg: 7 * LB_TO_KG,
    },
    {
      date: '2026-04-20',
      leanMassKg: 139 * LB_TO_KG,
      fatMassKg: 27 * LB_TO_KG,
      weightKg: 175.5 * LB_TO_KG,
      boneMassKg: 7 * LB_TO_KG,
    },
  ];

  it('holds FMI + FFMI = BMI at every scan point (metric profile)', () => {
    const points = buildCompositionPath(metricScans, 180);
    expect(points).toHaveLength(3);
    for (const p of points) {
      expect(p.fmi + p.ffmi).toBeCloseTo(p.bmi, 2);
    }
  });

  it('holds FMI + FFMI = BMI at every scan point (imperial profile)', () => {
    const points = buildCompositionPath(imperialScans, imperialHeightCm);
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(p.fmi + p.ffmi).toBeCloseTo(p.bmi, 2);
    }
  });

  it('uses the same FFM definition as computeFFMI (lean + bone)', () => {
    const p = toCompositionPoint(metricScans[0], 180)!;
    const gauge = computeFFMI(60, 3, 180);
    expect(Math.round(p.ffmi * 10) / 10).toBe(gauge.ffmi);
    // FFM = 63 kg over 3.24 m²
    expect(p.ffmi).toBeCloseTo(63 / 3.24, 2);
    expect(p.fmi).toBeCloseTo(15 / 3.24, 2);
  });

  it('does not double-count bone for calculated-entry scans (lean includes bone)', () => {
    // lean + fat == weight → lean already spans bone; logged bone ignored.
    const p = toCompositionPoint(
      { date: '2026-01-05', leanMassKg: 65, fatMassKg: 15, weightKg: 80, boneMassKg: 3 },
      180
    )!;
    expect(p.ffmi).toBeCloseTo(65 / 3.24, 2);
    expect(p.fmi + p.ffmi).toBeCloseTo(p.bmi, 2);
  });

  it('sorts the path by date ascending regardless of input order', () => {
    const shuffled = [metricScans[2], metricScans[0], metricScans[1]];
    const points = buildCompositionPath(shuffled, 180);
    expect(points.map((p) => p.date)).toEqual([
      '2026-01-05',
      '2026-03-10',
      '2026-06-01',
    ]);
  });

  it('returns null without a height or with unusable masses', () => {
    expect(toCompositionPoint(metricScans[0], 0)).toBeNull();
    expect(
      toCompositionPoint({ date: '2026-01-05', leanMassKg: 0, fatMassKg: 10 }, 180)
    ).toBeNull();
  });
});

// ============ target normalization ============

describe('normalizeTargetPoint', () => {
  it('normalizes target BF% + target weight', () => {
    // 80 kg at 15% BF, 180 cm: fat 12 kg, ffm 68 kg.
    const point = normalizeTargetPoint(
      { targetWeightKg: 80, targetBodyFatPercent: 15 },
      180
    )!;
    expect(point.fmi).toBeCloseTo(12 / 3.24, 2);
    expect(point.ffmi).toBeCloseTo(68 / 3.24, 2);
  });

  it('normalizes target FFMI + BF% to the same point as the equivalent weight form', () => {
    // FFMI 20.99 at 15% BF ≈ the 80 kg case above.
    const viaWeight = normalizeTargetPoint(
      { targetWeightKg: 80, targetBodyFatPercent: 15 },
      180
    )!;
    const viaFfmi = normalizeTargetPoint(
      { targetFfmi: 68 / 3.24, targetBodyFatPercent: 15 },
      180
    )!;
    expect(viaFfmi.fmi).toBeCloseTo(viaWeight.fmi, 1);
    expect(viaFfmi.ffmi).toBeCloseTo(viaWeight.ffmi, 1);
  });

  it('returns null when the target is not expressible as a point', () => {
    expect(normalizeTargetPoint({ targetWeightKg: 80 }, 180)).toBeNull(); // no BF%
    expect(normalizeTargetPoint({ targetBodyFatPercent: 15 }, 180)).toBeNull(); // no scale
    expect(
      normalizeTargetPoint({ targetWeightKg: 80, targetBodyFatPercent: 15 }, 0)
    ).toBeNull(); // no height
    expect(
      normalizeTargetPoint({ targetWeightKg: 80, targetBodyFatPercent: 120 }, 180)
    ).toBeNull(); // nonsense BF%
  });
});

// ============ goal-vector progress scalar ============

describe('computeGoalVectorProgress', () => {
  const start = { fmi: 6, ffmi: 20 };
  const target = { fmi: 4, ffmi: 22 };

  it('reports 50% halfway along the goal vector with no drift', () => {
    const p = computeGoalVectorProgress(start, { fmi: 5, ffmi: 21 }, target);
    expect(p.status).toBe('progress');
    expect(p.progressPercent).toBe(50);
    expect(p.displayPercent).toBe(50);
    expect(p.perpendicularDistance).toBe(0);
    expect(p.offAxisNote).toBeNull();
  });

  it('reports negative progress honestly when moving away', () => {
    const p = computeGoalVectorProgress(start, { fmi: 7, ffmi: 19 }, target);
    expect(p.status).toBe('progress');
    expect(p.progressPercent).toBe(-50);
    expect(p.displayPercent).toBe(-50);
  });

  it('flags target reached and caps the display at 100% when past the target', () => {
    const p = computeGoalVectorProgress(start, { fmi: 3, ffmi: 23 }, target);
    expect(p.status).toBe('target_reached');
    expect(p.progressPercent).toBe(150);
    expect(p.displayPercent).toBe(100);
  });

  it('hides the scalar for a degenerate vector (start ≈ target)', () => {
    const p = computeGoalVectorProgress(
      start,
      { fmi: 5, ffmi: 21 },
      { fmi: start.fmi + DEGENERATE_GOAL_EPSILON / 2, ffmi: start.ffmi }
    );
    expect(p.status).toBe('degenerate');
    expect(p.progressPercent).toBeNull();
    expect(p.displayPercent).toBeNull();
    expect(p.offAxisNote).toBeNull();
  });

  it('notes a fatter-than-planned path when drifting to the high-BF side', () => {
    // On-plan at t=0.25 is (5.5, 20.5); current carries more fat.
    const p = computeGoalVectorProgress(start, { fmi: 6, ffmi: 21 }, target);
    expect(p.progressPercent).toBe(25);
    expect(p.perpendicularDistance).toBeGreaterThan(OFF_AXIS_NOTE_THRESHOLD);
    expect(p.offAxisDirection).toBe('fatter');
    expect(p.offAxisNote).toBe('on track, slightly fatter path than planned');
  });

  it('reads lean-mass loss during a pure fat-loss goal as a fatter path', () => {
    // Horizontal goal vector (fat loss only): the perpendicular is entirely
    // FFMI. Losing lean means higher BF% than planned → "fatter", even
    // though the FMI component of the drift is zero.
    const p = computeGoalVectorProgress(
      { fmi: 6, ffmi: 20 },
      { fmi: 5, ffmi: 19.2 },
      { fmi: 4, ffmi: 20 }
    );
    expect(p.progressPercent).toBe(50);
    expect(p.offAxisDirection).toBe('fatter');
  });

  it('reads muscle gain beyond the plan as a leaner path', () => {
    const p = computeGoalVectorProgress(
      { fmi: 6, ffmi: 20 },
      { fmi: 5, ffmi: 21 },
      { fmi: 4, ffmi: 20 }
    );
    expect(p.offAxisDirection).toBe('leaner');
    expect(p.offAxisNote).toBe('on track, slightly leaner path than planned');
  });
});

describe('selectStartPoint', () => {
  const points = buildCompositionPath(
    [
      { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78 },
      { date: '2026-03-10', leanMassKg: 61, fatMassKg: 14, weightKg: 78 },
      { date: '2026-06-01', leanMassKg: 62, fatMassKg: 13, weightKg: 78 },
    ],
    180
  );

  it('defaults to the first scan of the current phase', () => {
    expect(selectStartPoint(points, 'phase', '2026-02-15')?.date).toBe('2026-03-10');
  });

  it('falls back to the first scan ever when no scan falls in the phase', () => {
    expect(selectStartPoint(points, 'phase', '2026-07-01')?.date).toBe('2026-01-05');
  });

  it('uses the first scan ever in all-time mode', () => {
    expect(selectStartPoint(points, 'all-time', '2026-02-15')?.date).toBe('2026-01-05');
  });

  it('returns null with no scans', () => {
    expect(selectStartPoint([], 'phase', '2026-02-15')).toBeNull();
  });
});

// ============ p-ratio between scans ============

describe('computeScanPairPRatios', () => {
  it('suppresses the p-ratio when |Δweight| < 3 lb', () => {
    const pairs = computeScanPairPRatios(
      [
        { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19.2 },
        // +1 kg total (< 1.36 kg = 3 lb): denominator is noise.
        { date: '2026-03-10', leanMassKg: 61, fatMassKg: 14.5, weightKg: 79, bodyFatPercent: 18.4 },
      ],
      180
    );
    expect(pairs).toHaveLength(1);
    expect(Math.abs(pairs[0].deltaWeightKg)).toBeLessThan(P_RATIO_MIN_WEIGHT_DELTA_KG);
    expect(pairs[0].suppressed).toBe(true);
    expect(pairs[0].leanFraction).toBeNull();
    expect(pairs[0].fatFraction).toBeNull();
  });

  it('computes lean/fat fractions for a clear weight change', () => {
    const pairs = computeScanPairPRatios(
      [
        { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19.0 },
        // +5 kg total: +3.4 lean, +1.6 fat.
        { date: '2026-06-01', leanMassKg: 63.4, fatMassKg: 16.6, weightKg: 83, bodyFatPercent: 21.0 },
      ],
      180
    );
    expect(pairs[0].suppressed).toBe(false);
    expect(pairs[0].withinNoise).toBe(false);
    expect(pairs[0].leanFraction).toBeCloseTo(0.68, 2);
    expect(pairs[0].fatFraction).toBeCloseTo(0.32, 2);
  });

  it('flags a flat lean component without blanket-suppressing the segment', () => {
    const pairs = computeScanPairPRatios(
      [
        { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19.0 },
        // Big Δweight, Δlean 0.5 kg < 1.5 lb floor, fat clearly up: the
        // change is attributable (essentially all fat), NOT noise.
        { date: '2026-06-01', leanMassKg: 60.5, fatMassKg: 18.5, weightKg: 82, bodyFatPercent: 22.5 },
      ],
      180
    );
    expect(Math.abs(pairs[0].deltaLeanKg)).toBeLessThan(NOISE_FLOOR_LEAN_KG);
    expect(pairs[0].leanWithinNoise).toBe(true);
    expect(pairs[0].fatWithinNoise).toBe(false);
    expect(pairs[0].withinNoise).toBe(false);
  });

  it('flags a flat fat component symmetrically (essentially all lean)', () => {
    const pairs = computeScanPairPRatios(
      [
        { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19.2 },
        { date: '2026-06-01', leanMassKg: 63.5, fatMassKg: 15.2, weightKg: 81.7, bodyFatPercent: 18.6 },
      ],
      180
    );
    expect(pairs[0].leanWithinNoise).toBe(false);
    expect(pairs[0].fatWithinNoise).toBe(true);
    expect(pairs[0].withinNoise).toBe(false);
  });

  it('blankets as noise only when BOTH components are inside the floors', () => {
    const pairs = computeScanPairPRatios(
      [
        { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19.2 },
        // Δweight 1.5 kg (just over 3 lb, not suppressed) but lean and fat
        // each moved < 1.5 lb — the split is unresolvable.
        { date: '2026-06-01', leanMassKg: 60.5, fatMassKg: 15.5, weightKg: 79.5, bodyFatPercent: 19.5 },
      ],
      180
    );
    expect(pairs[0].suppressed).toBe(false);
    expect(pairs[0].leanWithinNoise).toBe(true);
    expect(pairs[0].fatWithinNoise).toBe(true);
    expect(pairs[0].withinNoise).toBe(true);
  });

  it('resolves the Dec→Mar −7.5 lb cut with flat lean as attributable fat loss', () => {
    // The live-feedback case: "Dec 3 → Mar 15, −7.5 lb" must not read as
    // blanket measurement noise when the loss was essentially all fat.
    const pairs = computeScanPairPRatios(
      [
        { date: '2025-12-03', leanMassKg: 63, fatMassKg: 17, weightKg: 83.4, bodyFatPercent: 20.4 },
        { date: '2026-03-15', leanMassKg: 62.8, fatMassKg: 13.8, weightKg: 80, bodyFatPercent: 17.3 },
      ],
      180
    );
    expect(pairs[0].deltaWeightKg).toBeCloseTo(-3.4, 2); // ≈ −7.5 lb
    expect(pairs[0].leanWithinNoise).toBe(true);
    expect(pairs[0].withinNoise).toBe(false);
    expect(pairs[0].fatFraction).toBeCloseTo(0.94, 2);
  });

  it('normalizes lean deltas across mixed scan conventions (no false lean loss)', () => {
    const pairs = computeScanPairPRatios(
      [
        // Calculated-entry scan: stored lean = weight − fat (bone inside).
        { date: '2026-01-05', leanMassKg: 65, fatMassKg: 15, weightKg: 80 },
        // Real DEXA scan: lean excludes bone, bone logged separately.
        { date: '2026-06-01', leanMassKg: 64.4, fatMassKg: 15.6, weightKg: 83, boneMassKg: 3 },
      ],
      180
    );
    // Raw stored lean would read −0.6 kg (a false loss — just the bone
    // moving out of the lean column). Under the shared FFM convention the
    // change is +2.4 kg, matching the plotted points.
    expect(pairs[0].deltaLeanKg).toBeCloseTo(2.4, 2);
    expect(pairs[0].leanFraction).toBeCloseTo(0.8, 2);
  });

  it('produces one pair per consecutive scan couple, in date order', () => {
    const pairs = computeScanPairPRatios(
      [
        { date: '2026-06-01', leanMassKg: 63.4, fatMassKg: 16.6, weightKg: 83, bodyFatPercent: 21 },
        { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19 },
        { date: '2026-09-01', leanMassKg: 62.5, fatMassKg: 12.5, weightKg: 78, bodyFatPercent: 16.5 },
      ],
      180
    );
    expect(pairs.map((p) => `${p.fromDate}→${p.toDate}`)).toEqual([
      '2026-01-05→2026-06-01',
      '2026-06-01→2026-09-01',
    ]);
  });
});

describe('classifyPartitioning', () => {
  const bulkPair = computeScanPairPRatios(
    [
      { date: '2026-01-05', leanMassKg: 60, fatMassKg: 15, weightKg: 78, bodyFatPercent: 19 },
      { date: '2026-06-01', leanMassKg: 63.4, fatMassKg: 16.6, weightKg: 83, bodyFatPercent: 21 },
    ],
    180
  )[0];

  const cutPair = computeScanPairPRatios(
    [
      { date: '2026-01-05', leanMassKg: 63, fatMassKg: 17, weightKg: 83, bodyFatPercent: 20.5 },
      // −5 kg: −0.75 lean… no — −5 kg total: −4.25 fat, −0.75 lean.
      { date: '2026-06-01', leanMassKg: 62.25, fatMassKg: 12.75, weightKg: 78, bodyFatPercent: 16.3 },
    ],
    180
  )[0];

  it('gives no verdict below 2 scan pairs (confidence gating)', () => {
    expect(classifyPartitioning(bulkPair, 'bulk', 1)).toBeNull();
  });

  it('grades a bulk gain by its lean fraction', () => {
    expect(classifyPartitioning(bulkPair, 'bulk', 2)).toBe('excellent'); // 68% lean
  });

  it('grades a cut loss by its fat fraction', () => {
    expect(classifyPartitioning(cutPair, 'cut', 2)).toBe('excellent'); // 85% fat
  });

  it('gives no verdict for maintenance, suppressed, or noise pairs', () => {
    expect(classifyPartitioning(bulkPair, 'maintenance', 3)).toBeNull();
    expect(classifyPartitioning({ ...bulkPair, suppressed: true }, 'bulk', 3)).toBeNull();
    expect(classifyPartitioning({ ...bulkPair, withinNoise: true }, 'bulk', 3)).toBeNull();
  });

  it('gives no verdict when the weight moved against the phase', () => {
    // Weight LOSS during a bulk has no lean-fraction-of-gain framing.
    expect(classifyPartitioning(cutPair, 'bulk', 3)).toBeNull();
  });
});

// ============ athletic zone & suggested target ============

describe('athleticZonePolygon', () => {
  it('places vertices on the constant-BF% rays (male profile)', () => {
    const poly = athleticZonePolygon(ATHLETIC_ZONE_MALE);
    expect(poly).toHaveLength(4);
    expect(poly[0]).toEqual({ fmi: fmiAtBf(20, 10), ffmi: 20 });
    expect(poly[2]).toEqual({ fmi: fmiAtBf(22, 15), ffmi: 22 });
    // BF-ray slope: ffmi/fmi = (1 − bf)/bf. Low-BF edge (10%) → slope 9;
    // high-BF edge (15%) → slope 85/15.
    expect(poly[0].ffmi / poly[0].fmi).toBeCloseTo(90 / 10, 1);
    expect(poly[3].ffmi / poly[3].fmi).toBeCloseTo(90 / 10, 1);
    expect(poly[1].ffmi / poly[1].fmi).toBeCloseTo(85 / 15, 1);
    expect(poly[2].ffmi / poly[2].fmi).toBeCloseTo(85 / 15, 1);
  });

  it('places vertices on the constant-BF% rays (female profile)', () => {
    const poly = athleticZonePolygon(ATHLETIC_ZONE_FEMALE);
    expect(poly[0].ffmi / poly[0].fmi).toBeCloseTo(82 / 18, 1);
    expect(poly[1].ffmi / poly[1].fmi).toBeCloseTo(75 / 25, 1);
    expect(poly.map((p) => p.ffmi)).toEqual([16, 16, 18, 18]);
  });
});

describe('zoneOverlapsDomain / zoneDirectionArrow', () => {
  it('detects overlap with the viewport', () => {
    expect(
      zoneOverlapsDomain(ATHLETIC_ZONE_MALE, { x: [2, 8], y: [16, 24] })
    ).toBe(true);
    // Viewport entirely fatter and less muscular than the zone.
    expect(
      zoneOverlapsDomain(ATHLETIC_ZONE_MALE, { x: [5, 9], y: [15, 19] })
    ).toBe(false);
  });

  it('points from the viewport center toward the zone (leaner + more muscle = ↖)', () => {
    expect(zoneDirectionArrow(ATHLETIC_ZONE_MALE, { x: [5, 9], y: [15, 19] })).toBe('↖');
  });
});

describe('computeSuggestedTarget', () => {
  // Live-feedback seed: FFMI 16.9 at 19% BF → fmi = 16.9·19/81.
  const current = { fmi: fmiAtBf(16.9, 19), ffmi: 16.9 };

  it('suggests a conservative first-bulk milestone (novice: +1.5 FFMI, BF ≤ 24%)', () => {
    const s = computeSuggestedTarget({ current, phase: 'bulk', experience: 'novice', sex: 'male' })!;
    expect(s.ffmi).toBeGreaterThanOrEqual(18);
    expect(s.ffmi).toBeLessThanOrEqual(18.4);
    expect(s.bodyFatPercent).toBeLessThanOrEqual(SUGGESTED_BULK_BF_CAP_PERCENT);
    expect(s.bodyFatPercent).toBeCloseTo(23, 1); // current 19 + 4
    // The point sits on its own BF ray.
    expect(s.fmi).toBeCloseTo(fmiAtBf(s.ffmi, s.bodyFatPercent), 1);
  });

  it('scales the bulk milestone down with training age', () => {
    const novice = computeSuggestedTarget({ current, phase: 'bulk', experience: 'novice', sex: 'male' })!;
    const advanced = computeSuggestedTarget({ current, phase: 'bulk', experience: 'advanced', sex: 'male' })!;
    expect(advanced.ffmi).toBeLessThan(novice.ffmi);
    expect(advanced.ffmi).toBeCloseTo(17.4, 1);
  });

  it('caps the bulk BF ceiling at 24%', () => {
    const fat = { fmi: fmiAtBf(18, 22), ffmi: 18 }; // 22% BF now
    const s = computeSuggestedTarget({ current: fat, phase: 'bulk', experience: 'novice', sex: 'male' })!;
    expect(s.bodyFatPercent).toBe(SUGGESTED_BULK_BF_CAP_PERCENT);
  });

  it('suggests a lower-BF milestone for a cut (small expected lean cost)', () => {
    const s = computeSuggestedTarget({ current, phase: 'cut', sex: 'male' })!;
    expect(s.bodyFatPercent).toBe(13);
    expect(s.ffmi).toBeCloseTo(16.7, 1);
  });

  it('offers no cut milestone when already at/below the target BF', () => {
    const lean = { fmi: fmiAtBf(20, 12), ffmi: 20 };
    expect(computeSuggestedTarget({ current: lean, phase: 'cut', sex: 'male' })).toBeNull();
  });

  it('offers no suggestion for maintenance (the zone carries the context)', () => {
    expect(computeSuggestedTarget({ current, phase: 'maintenance', sex: 'male' })).toBeNull();
  });
});

// ============ trend forecast ============

describe('computeCompositionForecast', () => {
  const point = (date: string, fmi: number, ffmi: number): CompositionPoint => ({
    date,
    fmi,
    ffmi,
    bmi: fmi + ffmi,
    bodyFatPercent: (fmi / (fmi + ffmi)) * 100,
    weightKg: 80,
  });

  // Cutting: −0.2 FMI, +0.1 FFMI per week over the last scan pair (4 weeks).
  const scans = [point('2026-01-01', 7.6, 19.2), point('2026-01-29', 6.8, 19.6)];
  const anchor = { fmi: 6.8, ffmi: 19.6 };

  it('extrapolates linearly from the last scan pair', () => {
    const f = computeCompositionForecast(scans, anchor, null);
    expect(f.status).toBe('ok');
    expect(f.velocity.fmi).toBeCloseTo(-0.2, 5);
    expect(f.velocity.ffmi).toBeCloseTo(0.1, 5);
    expect(f.path).toHaveLength(FORECAST_HORIZON_WEEKS);
    expect(f.path[4]).toMatchObject({ weeks: 5, fmi: 5.8, ffmi: 20.1 });
  });

  it('widens the uncertainty radius with time, from the DEXA noise floor', () => {
    const f = computeCompositionForecast(scans, anchor, null);
    expect(f.path[0].radius).toBeGreaterThan(FORECAST_NOISE_RADIUS);
    for (let i = 1; i < f.path.length; i++) {
      expect(f.path[i].radius).toBeGreaterThan(f.path[i - 1].radius);
    }
  });

  it('reports an ETA when the trend passes through the goal', () => {
    // Goal sits exactly 10 weeks down the trend line.
    const f = computeCompositionForecast(scans, anchor, { fmi: 4.8, ffmi: 20.6 });
    expect(f.goalEtaWeeks).toBe(10);
  });

  it('reports no ETA when the trend heads away from the goal', () => {
    // Goal behind the direction of travel: closest approach is t ≤ 0.
    const f = computeCompositionForecast(scans, anchor, { fmi: 7.8, ffmi: 19.4 });
    expect(f.goalEtaWeeks).toBeNull();
  });

  it('reports no ETA when the trend misses the goal by more than the hit radius', () => {
    const f = computeCompositionForecast(scans, anchor, { fmi: 4.8, ffmi: 23.0 });
    expect(f.goalEtaWeeks).toBeNull();
  });

  it('declines to forecast a flat trend (projecting noise)', () => {
    const flat = [point('2026-01-01', 6.8, 19.6), point('2026-01-29', 6.8, 19.6)];
    expect(computeCompositionForecast(flat, anchor, null).status).toBe('flat');
  });

  it('declines to forecast under 2 scans', () => {
    expect(computeCompositionForecast([scans[0]], anchor, null).status).toBe('insufficient');
  });
});

// ============ prominence / layout gating ============

describe('getBodyCompLayout', () => {
  it.each([0, 1])('keeps the existing layout with a scan prompt at %d scans', (count) => {
    const layout = getBodyCompLayout(count);
    expect(layout.trendFirst).toBe(false);
    expect(layout.showScanPrompt).toBe(true);
    expect(layout.showCompositionMap).toBe(false);
    expect(layout.showHomeCard).toBe(false);
  });

  it.each([2, 5])('promotes the trend module and unlocks the map at %d scans', (count) => {
    const layout = getBodyCompLayout(count);
    expect(layout.trendFirst).toBe(true);
    expect(layout.showScanPrompt).toBe(false);
    expect(layout.showCompositionMap).toBe(true);
    expect(layout.showHomeCard).toBe(true);
  });

  it('gates exactly at MIN_SCANS_FOR_COMPOSITION_MAP', () => {
    expect(getBodyCompLayout(MIN_SCANS_FOR_COMPOSITION_MAP - 1).showCompositionMap).toBe(false);
    expect(getBodyCompLayout(MIN_SCANS_FOR_COMPOSITION_MAP).showCompositionMap).toBe(true);
  });
});

// ============ map viewport helpers ============

describe('computeMapDomain', () => {
  it('covers all points and the target with padding', () => {
    const domain = computeMapDomain(
      [
        { fmi: 4.6, ffmi: 19.4 },
        { fmi: 5.1, ffmi: 20.2 },
      ],
      { fmi: 3.7, ffmi: 21 }
    );
    expect(domain.x[0]).toBeLessThan(3.7);
    expect(domain.x[1]).toBeGreaterThan(5.1);
    expect(domain.y[0]).toBeLessThan(19.4);
    expect(domain.y[1]).toBeGreaterThan(21);
  });

  it('enforces a minimum span and never goes below FMI 0', () => {
    const domain = computeMapDomain([{ fmi: 0.4, ffmi: 20 }]);
    expect(domain.x[0]).toBeGreaterThanOrEqual(0);
    expect(domain.x[1] - domain.x[0]).toBeGreaterThanOrEqual(2);
    expect(domain.y[1] - domain.y[0]).toBeGreaterThanOrEqual(3);
  });
});

describe('isoBmiSegment', () => {
  const domain = { x: [2, 8] as [number, number], y: [16, 24] as [number, number] };

  it('clips the diagonal fmi + ffmi = bmi to the viewport', () => {
    const seg = isoBmiSegment(25, domain)!;
    expect(seg).toMatchObject({ x1: 2, y1: 23, x2: 8, y2: 17 });
    // Both endpoints satisfy the identity.
    expect(seg.x1 + seg.y1).toBeCloseTo(25, 6);
    expect(seg.x2 + seg.y2).toBeCloseTo(25, 6);
  });

  it('returns null for diagonals outside the viewport', () => {
    expect(isoBmiSegment(40, domain)).toBeNull();
    expect(isoBmiSegment(10, domain)).toBeNull();
  });

  it('only offers visible levels', () => {
    const segments = visibleIsoBmiSegments(domain);
    // 18.5 clips a corner sliver; 35 misses the viewport entirely.
    expect(segments.map((s) => s.bmi)).toEqual([18.5, 22, 25, 28, 30]);
  });
});
