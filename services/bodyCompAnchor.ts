/**
 * bodyCompAnchor
 *
 * Builds the Body hub's continuous BF% / lean-mass trend from two sources of
 * truth with very different reliability:
 *
 *   - daily bodyweight entries (frequent, but say nothing about composition)
 *   - DEXA scans (sparse, authoritative observations)
 *
 * Between scans the trend is an ESTIMATE: weight changes are partitioned into
 * lean/fat via a p-ratio (fraction of weight change that is lean mass), then
 * the whole estimated segment between two consecutive scans is linearly
 * rescaled (affine correction growing from 0 at the earlier scan to the full
 * residual at the later one) so the trend passes through BOTH scan values
 * exactly. After the latest scan (and before the first), estimates project
 * from the nearest scan with no correction available.
 *
 * Deliberately simple — piecewise rescale, per the product spec. No Kalman
 * filter, no fusion of tape estimates.
 *
 * Pure functions only: NO database calls.
 */

import { leanMassIncludesBone } from '@/services/bodyCompEngine';

// ============================================================
// Types
// ============================================================

export interface WeightPoint {
  /** YYYY-MM-DD (local) */
  date: string;
  weightKg: number;
}

/** The slice of a DEXA scan the anchoring needs. */
export interface ScanAnchor {
  /** YYYY-MM-DD */
  date: string;
  bodyFatPercent: number;
  leanMassKg: number;
  fatMassKg: number;
  /**
   * The scan's recorded total weight. Bodyweight deltas anchor to THIS value
   * — lean + fat alone understates it by the bone mass, which would make a
   * weigh-in equal to the scan weight read as a spurious gain. Falls back to
   * lean + fat when absent.
   */
  weightKg?: number;
  /**
   * Bone mineral content in kg when the scan logged it. Feeds the trend's
   * per-day FFM (= lean + BMC) for FFMI; BMC is nearly constant so it is
   * linearly interpolated between scans and held flat beyond the ends.
   */
  boneMassKg?: number | null;
}

export interface AnchoredTrendPoint {
  date: string;
  bodyFatPercent: number;
  leanMassKg: number;
  fatMassKg: number;
  weightKg: number;
  /**
   * Interpolated bone mineral content (kg), or null when no scan logged bone
   * mass. Consumers computing FFMI pass this straight to
   * bodyCompEngine.computeFFMI so lean-only vs lean+BMC stays one decision.
   */
  boneMassKg: number | null;
  /** 'dexa' = authoritative anchor (render as a distinct marker). */
  kind: 'dexa' | 'estimated';
}

export interface BuildAnchoredTrendOptions {
  /**
   * Fraction of a bodyweight change attributed to lean mass in the BASE
   * estimate (0..1). Between two scans the rescale makes the endpoints exact
   * regardless of this value — it only shapes the interior and the
   * projection beyond the newest scan. Default 0.5.
   */
  pRatio?: number;
  /**
   * Optional morning-waist EWMA trend (inches). When supplied and it spans a
   * between-scan segment, the fat estimate's INTERIOR follows the waist trend
   * shape instead of the weight-proportional split — so the BF% line "bends"
   * with observed waist rather than running straight. The rescale still pins
   * both scan endpoints exactly, so this never changes an absolute anchored
   * value — waist informs the RATE/shape only, never an absolute BF%.
   */
  waistTrend?: WaistTrendInput[];
}

export interface WaistTrendInput {
  /** YYYY-MM-DD */
  date: string;
  /** EWMA trend value in inches. */
  trendIn: number;
}

// ============================================================
// Internals
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime() / DAY_MS;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BasePoint {
  date: string;
  day: number;
  weightKg: number;
  leanEst: number;
  fatEst: number;
}

/**
 * Base lean/fat estimate for a run of weight points, projected from an
 * anchor scan: delta weight from the anchor is split pRatio lean /
 * (1 - pRatio) fat. Works in both directions (dates before the anchor get
 * the same split applied to a negative delta).
 */
function projectFromAnchor(
  points: { date: string; day: number; weightKg: number }[],
  anchor: ScanAnchor,
  anchorWeightKg: number,
  pRatio: number
): BasePoint[] {
  return points.map((p) => {
    const deltaW = p.weightKg - anchorWeightKg;
    return {
      ...p,
      leanEst: anchor.leanMassKg + pRatio * deltaW,
      fatEst: anchor.fatMassKg + (1 - pRatio) * deltaW,
    };
  });
}

/** BF% consistent with how a scan reports it: fat mass over scan weight. */
function bfPercent(fatKg: number, weightKg: number): number {
  return weightKg > 0 ? (fatKg / weightKg) * 100 : 0;
}

/**
 * Linearly interpolate a waist trend (inches) at an arbitrary day, clamped
 * flat beyond its ends. Returns null when the trend does not actually bracket
 * the day — callers fall back to the weight-proportional estimate so a sparse
 * or non-overlapping waist trend never distorts a segment.
 */
function waistTrendInterpolator(
  waistTrend: WaistTrendInput[] | undefined
): { spans: (dayA: number, dayB: number) => boolean; at: (day: number) => number } | null {
  if (!waistTrend || waistTrend.length < 2) return null;
  const pts = waistTrend
    .filter((w) => Number.isFinite(w.trendIn))
    .map((w) => ({ day: dayNumber(w.date), value: w.trendIn }))
    .sort((a, b) => a.day - b.day);
  if (pts.length < 2) return null;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const at = (day: number): number => {
    if (day <= first.day) return first.value;
    if (day >= last.day) return last.value;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].day >= day) {
        const lo = pts[i - 1];
        const hi = pts[i];
        if (hi.day === lo.day) return lo.value;
        const t = (day - lo.day) / (hi.day - lo.day);
        return lo.value + t * (hi.value - lo.value);
      }
    }
    return last.value;
  };
  // Only shape a segment the trend meaningfully overlaps (its coverage must
  // reach the segment interior on both ends).
  const spans = (dayA: number, dayB: number) => first.day <= dayB && last.day >= dayA;
  return { spans, at };
}

// ============================================================
// Public API
// ============================================================

/**
 * Linearly rescale an estimated series so it passes exactly through two
 * endpoint observations. The correction is affine in time: zero at the start
 * anchor, the full residual at the end anchor — i.e. the estimated segment
 * is "stretched" onto the observed endpoints without distorting its shape.
 *
 * Exported separately so the rescale math is unit-testable in isolation.
 */
export function rescaleSegment(
  values: { day: number; value: number }[],
  start: { day: number; value: number },
  end: { day: number; value: number }
): number[] {
  const span = end.day - start.day;
  if (values.length === 0) return [];
  if (span <= 0) return values.map((v) => v.value);

  // Residuals between what the estimate says at the endpoints and what was
  // actually observed there, read off the series by linear interpolation
  // (clamped outside its range).
  const sorted = [...values].sort((a, b) => a.day - b.day);
  const estimateAt = (day: number): number => {
    if (day <= sorted[0].day) return sorted[0].value;
    const last = sorted[sorted.length - 1];
    if (day >= last.day) return last.value;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].day >= day) {
        const lo = sorted[i - 1];
        const hi = sorted[i];
        if (hi.day === lo.day) return lo.value;
        const t = (day - lo.day) / (hi.day - lo.day);
        return lo.value + t * (hi.value - lo.value);
      }
    }
    return last.value;
  };

  const startResidual = start.value - estimateAt(start.day);
  const endResidual = end.value - estimateAt(end.day);

  return values.map((v) => {
    const t = Math.min(1, Math.max(0, (v.day - start.day) / span));
    return v.value + startResidual + t * (endResidual - startResidual);
  });
}

/**
 * Build the anchored BF% / lean-mass trend.
 *
 * - Returns [] when there are no scans (weight alone can't estimate
 *   composition — the hub falls back to the weight chart).
 * - Scan dates always appear in the output with the scan's exact values and
 *   kind 'dexa'.
 * - Weight entries between two scans are estimated then rescaled to fit both
 *   scan endpoints; entries before the first / after the last scan project
 *   from the nearest scan.
 * - Deterministic: same inputs, same output; output sorted by date.
 */
export function buildAnchoredBodyCompTrend(
  weights: WeightPoint[],
  scans: ScanAnchor[],
  options: BuildAnchoredTrendOptions = {}
): AnchoredTrendPoint[] {
  const pRatio = Math.min(1, Math.max(0, options.pRatio ?? 0.5));
  const waist = waistTrendInterpolator(options.waistTrend);

  const sortedScans = [...scans]
    .filter((s) => s.leanMassKg > 0 && s.fatMassKg >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sortedScans.length === 0) return [];

  // Anchor weight: the scan's recorded total when available (includes bone),
  // else fat + lean. Using fat + lean when a real total exists would bias
  // every subsequent bodyweight delta by the bone mass.
  const scanWeight = (s: ScanAnchor) =>
    s.weightKg != null && s.weightKg > 0 ? s.weightKg : s.leanMassKg + s.fatMassKg;

  // Deduplicate weights by date (last write wins) and drop entries that
  // collide with a scan date — the scan is authoritative there.
  const scanDays = new Map(sortedScans.map((s) => [s.date, s]));
  const weightByDate = new Map<string, number>();
  [...weights]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((w) => {
      if (w.weightKg > 0 && !scanDays.has(w.date)) weightByDate.set(w.date, w.weightKg);
    });

  const weightPoints = Array.from(weightByDate.entries()).map(([date, weightKg]) => ({
    date,
    day: dayNumber(date),
    weightKg,
  }));

  // Bone a scan can contribute to the FFM series: its logged BMC, unless the
  // scan's lean already contains bone (calculated-entry shape: lean = weight
  // − fat) — adding BMC on top of such a lean would double-count it in FFMI.
  const contributableBone = (s: ScanAnchor): number | null =>
    s.boneMassKg != null && s.boneMassKg > 0 && !leanMassIncludesBone(s)
      ? s.boneMassKg
      : null;

  // BMC per day for FFMI: linearly interpolated between scans that logged
  // bone mass (BMC is nearly constant), held flat beyond their range, null
  // when no scan logged bone at all.
  const boneScans = sortedScans
    .map((s) => ({ day: dayNumber(s.date), value: contributableBone(s) }))
    .filter((s): s is { day: number; value: number } => s.value != null);
  const boneAt = (day: number): number | null => {
    if (boneScans.length === 0) return null;
    if (day <= boneScans[0].day) return round2(boneScans[0].value);
    const last = boneScans[boneScans.length - 1];
    if (day >= last.day) return round2(last.value);
    for (let i = 1; i < boneScans.length; i++) {
      if (boneScans[i].day >= day) {
        const lo = boneScans[i - 1];
        const hi = boneScans[i];
        if (hi.day === lo.day) return round2(lo.value);
        const t = (day - lo.day) / (hi.day - lo.day);
        return round2(lo.value + t * (hi.value - lo.value));
      }
    }
    return round2(last.value);
  };

  const result: AnchoredTrendPoint[] = [];

  // Scan anchors themselves — exact values, distinct kind.
  for (const scan of sortedScans) {
    result.push({
      date: scan.date,
      bodyFatPercent: round1(scan.bodyFatPercent),
      leanMassKg: round1(scan.leanMassKg),
      fatMassKg: round1(scan.fatMassKg),
      weightKg: round1(scanWeight(scan)),
      // A bone-in-lean scan gets NO bone here (its lean is already fat-free
      // mass); interpolation only fills scans that merely didn't log bone.
      boneMassKg: leanMassIncludesBone(scan)
        ? null
        : contributableBone(scan) != null
          ? round2(contributableBone(scan) as number)
          : boneAt(dayNumber(scan.date)),
      kind: 'dexa',
    });
  }

  // Non-soft-tissue offset carried by an anchor (bone etc.): the part of the
  // scan's weight that isn't lean or fat, kept in the BF% denominator so
  // estimates report BF% the same way the scan does (fat / total weight).
  const boneOffset = (s: ScanAnchor) => scanWeight(s) - s.leanMassKg - s.fatMassKg;

  const firstScan = sortedScans[0];
  const lastScan = sortedScans[sortedScans.length - 1];
  const firstDay = dayNumber(firstScan.date);
  const lastDay = dayNumber(lastScan.date);

  // Before the first scan: backcast from it.
  const before = weightPoints.filter((p) => p.day < firstDay);
  projectFromAnchor(before, firstScan, scanWeight(firstScan), pRatio).forEach((p) => {
    result.push(toEstimated(p, boneOffset(firstScan)));
  });

  // After the last scan: project forward from it.
  const after = weightPoints.filter((p) => p.day > lastDay);
  projectFromAnchor(after, lastScan, scanWeight(lastScan), pRatio).forEach((p) => {
    result.push(toEstimated(p, boneOffset(lastScan)));
  });

  // Between each consecutive scan pair: estimate from the earlier scan, then
  // rescale lean and fat independently so both endpoints are exact.
  for (let i = 0; i < sortedScans.length - 1; i++) {
    const a = sortedScans[i];
    const b = sortedScans[i + 1];
    const dayA = dayNumber(a.date);
    const dayB = dayNumber(b.date);
    const segment = weightPoints.filter((p) => p.day > dayA && p.day < dayB);
    if (segment.length === 0) continue;

    // Shape the fat interior with the waist trend when it overlaps this
    // segment; otherwise keep the weight-proportional split. Either way the
    // rescale below pins both scan endpoints exactly, so only the interior
    // curvature differs — waist bends the shape, never an anchored value.
    const useWaist = waist != null && waist.spans(dayA, dayB);
    const waistAtA = useWaist ? waist!.at(dayA) : 0;

    const shapePoint = (
      p: { date: string; day: number; weightKg: number }
    ): BasePoint => {
      const deltaW = p.weightKg - scanWeight(a);
      if (useWaist) {
        // Fat proxy = cumulative waist-trend rise since the segment start
        // (inches; scale is arbitrary because the rescale renormalizes to the
        // fat endpoints). Lean carries the remaining weight so lean + fat
        // still equals the point's soft-tissue weight.
        const fatEst = a.fatMassKg + (waist!.at(p.day) - waistAtA);
        const leanEst = a.leanMassKg + a.fatMassKg + deltaW - fatEst;
        return { ...p, leanEst, fatEst };
      }
      return {
        ...p,
        leanEst: a.leanMassKg + pRatio * deltaW,
        fatEst: a.fatMassKg + (1 - pRatio) * deltaW,
      };
    };

    const base = segment.map(shapePoint);

    // Endpoint-inclusive series for residual measurement: the estimate is
    // exact at A by construction; at B it carries the accumulated error the
    // rescale removes.
    const baseAtB = shapePoint({ date: b.date, day: dayB, weightKg: scanWeight(b) });

    const leanSeries = [
      { day: dayA, value: a.leanMassKg },
      ...base.map((p) => ({ day: p.day, value: p.leanEst })),
      { day: dayB, value: baseAtB.leanEst },
    ];
    const fatSeries = [
      { day: dayA, value: a.fatMassKg },
      ...base.map((p) => ({ day: p.day, value: p.fatEst })),
      { day: dayB, value: baseAtB.fatEst },
    ];

    const leanRescaled = rescaleSegment(
      leanSeries,
      { day: dayA, value: a.leanMassKg },
      { day: dayB, value: b.leanMassKg }
    );
    const fatRescaled = rescaleSegment(
      fatSeries,
      { day: dayA, value: a.fatMassKg },
      { day: dayB, value: b.fatMassKg }
    );

    base.forEach((p, idx) => {
      const lean = leanRescaled[idx + 1]; // offset for the injected A endpoint
      const fat = fatRescaled[idx + 1];
      // Bone offset interpolates between the two anchors, like the rescale.
      const t = (p.day - dayA) / (dayB - dayA);
      const bone = boneOffset(a) + t * (boneOffset(b) - boneOffset(a));
      result.push({
        date: p.date,
        bodyFatPercent: round1(bfPercent(fat, lean + fat + bone)),
        leanMassKg: round1(lean),
        fatMassKg: round1(fat),
        weightKg: round1(p.weightKg),
        boneMassKg: boneAt(p.day),
        kind: 'estimated',
      });
    });
  }

  return result.sort((x, y) => x.date.localeCompare(y.date));

  function toEstimated(p: BasePoint, boneOffsetKg: number): AnchoredTrendPoint {
    return {
      date: p.date,
      bodyFatPercent: round1(bfPercent(p.fatEst, p.leanEst + p.fatEst + boneOffsetKg)),
      leanMassKg: round1(p.leanEst),
      fatMassKg: round1(p.fatEst),
      weightKg: round1(p.weightKg),
      boneMassKg: boneAt(p.day),
      kind: 'estimated',
    };
  }
}

// ============================================================
// Low-confidence gaps
// ============================================================

/**
 * A trend point spacing beyond this many days means the estimate line is
 * interpolating with no underlying weigh-ins — render it as low-confidence
 * (dashed / reduced opacity) rather than indistinguishable from
 * densely-supported estimates.
 */
export const LOW_CONFIDENCE_GAP_DAYS = 14;

export interface TrendGap {
  /** Index of the last supported point before the gap. */
  fromIndex: number;
  /** Index of the first supported point after the gap. */
  toIndex: number;
  fromDate: string;
  toDate: string;
  gapDays: number;
}

/**
 * Find gaps between consecutive trend points longer than `maxGapDays`.
 * `dates` must be sorted ascending (as buildAnchoredBodyCompTrend returns).
 */
export function findLowConfidenceGaps(
  dates: string[],
  maxGapDays: number = LOW_CONFIDENCE_GAP_DAYS
): TrendGap[] {
  const gaps: TrendGap[] = [];
  for (let i = 1; i < dates.length; i++) {
    const gapDays = dayNumber(dates[i]) - dayNumber(dates[i - 1]);
    if (gapDays > maxGapDays) {
      gaps.push({
        fromIndex: i - 1,
        toIndex: i,
        fromDate: dates[i - 1],
        toDate: dates[i],
        gapDays,
      });
    }
  }
  return gaps;
}
