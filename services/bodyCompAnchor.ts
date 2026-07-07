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
}

export interface AnchoredTrendPoint {
  date: string;
  bodyFatPercent: number;
  leanMassKg: number;
  fatMassKg: number;
  weightKg: number;
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

  const sortedScans = [...scans]
    .filter((s) => s.leanMassKg > 0 && s.fatMassKg >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sortedScans.length === 0) return [];

  // Scan weight: what the scan itself implies (fat + lean is close enough —
  // bone is a near-constant offset that cancels in the deltas).
  const scanWeight = (s: ScanAnchor) => s.leanMassKg + s.fatMassKg;

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

  const result: AnchoredTrendPoint[] = [];

  // Scan anchors themselves — exact values, distinct kind.
  for (const scan of sortedScans) {
    result.push({
      date: scan.date,
      bodyFatPercent: round1(scan.bodyFatPercent),
      leanMassKg: round1(scan.leanMassKg),
      fatMassKg: round1(scan.fatMassKg),
      weightKg: round1(scanWeight(scan)),
      kind: 'dexa',
    });
  }

  const firstScan = sortedScans[0];
  const lastScan = sortedScans[sortedScans.length - 1];
  const firstDay = dayNumber(firstScan.date);
  const lastDay = dayNumber(lastScan.date);

  // Before the first scan: backcast from it.
  const before = weightPoints.filter((p) => p.day < firstDay);
  projectFromAnchor(before, firstScan, scanWeight(firstScan), pRatio).forEach((p) => {
    result.push(toEstimated(p));
  });

  // After the last scan: project forward from it.
  const after = weightPoints.filter((p) => p.day > lastDay);
  projectFromAnchor(after, lastScan, scanWeight(lastScan), pRatio).forEach((p) => {
    result.push(toEstimated(p));
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

    const base = projectFromAnchor(segment, a, scanWeight(a), pRatio);

    // Endpoint-inclusive series for residual measurement: the estimate is
    // exact at A by construction; at B it carries the accumulated error the
    // rescale removes.
    const baseAtB = projectFromAnchor(
      [{ date: b.date, day: dayB, weightKg: scanWeight(b) }],
      a,
      scanWeight(a),
      pRatio
    )[0];

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
      result.push({
        date: p.date,
        bodyFatPercent: round1(bfPercent(fat, lean + fat)),
        leanMassKg: round1(lean),
        fatMassKg: round1(fat),
        weightKg: round1(p.weightKg),
        kind: 'estimated',
      });
    });
  }

  return result.sort((x, y) => x.date.localeCompare(y.date));

  function toEstimated(p: BasePoint): AnchoredTrendPoint {
    return {
      date: p.date,
      bodyFatPercent: round1(bfPercent(p.fatEst, p.leanEst + p.fatEst)),
      leanMassKg: round1(p.leanEst),
      fatMassKg: round1(p.fatEst),
      weightKg: round1(p.weightKg),
      kind: 'estimated',
    };
  }
}
