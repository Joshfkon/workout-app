/**
 * Canonical robust trend estimator — THE single source of truth for every
 * trend/slope the app fits over a time series.
 *
 * Same consolidation story as ./e1rm.ts: multiple divergent least-squares
 * implementations (plateauDetector, measurementTrends, weightRate,
 * phaseAssessment, adaptive-volume's index-based variant) each regressed raw
 * series with no outlier rejection and no discontinuity detection, so a
 * single corrupt point (an e1RM of 0, a fat-fingered tape entry) dominated
 * user-facing verdicts ("Down", "Behind pace", "No progress in 4 weeks").
 * Every slope shown anywhere must come from {@link computeTrend} (directly
 * or through a delegating wrapper).
 *
 * Estimator: Theil–Sen (median of pairwise slopes) over ELAPSED DAYS — never
 * array index. Breakdown point ~29% vs OLS's 0%: a single bad entry cannot
 * dominate the fit. Naive O(n²) on purpose — series here are tens of points,
 * and no dependency is worth avoiding ~30 lines of median math.
 *
 * Pipeline, in order:
 *  1. HARD-REJECT impossible values (non-finite; ≤ 0 unless the caller opts
 *     out). These are data-integrity failures, not outliers — they never
 *     reach the estimator. Logged so the corruption is visible upstream.
 *  2. SEGMENT on discontinuities: caller-known boundaries (user marked
 *     "different equipment") and detected persistent level shifts (a
 *     single-step change beyond ~25% that does NOT revert next point — a
 *     one-off bad day reverts, an equipment change persists). The fit is
 *     anchored to the segment containing the newest point; smoothing a
 *     57.5 → 40 stack-relabel into "−24.9%/wk" is not a training signal.
 *  3. FIT Theil–Sen, then reject outliers whose residual deviates from the
 *     fit by more than `outlierMadMultiplier` × MAD (leave-worst-out,
 *     iterative, capped at ~25% of the segment). Excluded indices are
 *     returned so the UI can SHOW the exclusion — silently dropping data is
 *     worse than a visible outlier.
 *  4. GATE confidence: 'insufficient' below `minPoints` (callers must not
 *     render a rate at all), 'low' when the observed span is short relative
 *     to the reported rate unit or the series has a gap beyond
 *     `lowConfidenceGapDays` (callers render the raw delta, a dashed line,
 *     or a "calibrating" state instead of a confident rate).
 *
 * Pure, no side effects beyond console.warn on hard-rejected values.
 * Unit-agnostic: value unit in → value-per-day/week/month out.
 */

export type TrendConfidence = 'high' | 'low' | 'insufficient';

export interface TrendPoint {
  /** Point date: Date, or local YYYY-MM-DD / ISO string (house style). */
  date: Date | string;
  value: number;
}

export interface TrendOptions {
  /** Points (post-rejection) required to fit at all. Default 3. */
  minPoints?: number;
  /**
   * Hard-reject values ≤ 0 before fitting (zero/negative e1RM or
   * circumference is corrupt data, not an observation). Default true —
   * series where 0 is meaningful (rate-of-change series) opt out.
   */
  rejectNonPositive?: boolean;
  /** Residual deviation beyond this × MAD flags an outlier. Default 3. */
  outlierMadMultiplier?: number;
  /**
   * Floor for the outlier scale as a fraction of the series' typical value,
   * i.e. the ordinary point-to-point noise of the DOMAIN: below it, nothing
   * is an outlier no matter how tight the rest of the fit is. Tape series
   * keep the small default (0.005 — tape barely moves week to week); e1RM
   * series need ~0.03 so a strong +8% session doesn't read as corrupt.
   */
  minResidualFraction?: number;
  /** Outlier rejection needs at least this many segment points. Default 4. */
  minPointsForOutlierRejection?: number;
  /** Max fraction of segment points the outlier pass may remove. Default 0.25. */
  maxOutlierShare?: number;
  /** Detect persistent level shifts and anchor to the newest segment. Default true. */
  detectDiscontinuity?: boolean;
  /** Single-step fractional change that counts as a level shift. Default 0.25. */
  discontinuityThreshold?: number;
  /**
   * Caller-known segment boundaries (e.g. a session the user explicitly
   * marked "different equipment"). A boundary date starts a new segment at
   * the first point ON or AFTER it; the fit anchors to the newest segment.
   * More reliable than the heuristic and always honored.
   */
  knownDiscontinuities?: Array<Date | string>;
  /**
   * Span (days) below which a fitted rate is 'low' confidence. Pick per the
   * unit you report: a per-week rate needs ~14 observed days, a per-month
   * rate ~21+ — reporting "+1.5 in/mo" off a 17-day span is extrapolation
   * dressed as measurement. Default 14.
   */
  lowConfidenceSpanDays?: number;
  /** Largest between-point gap (days) tolerated at 'high' confidence. Default 45. */
  lowConfidenceGapDays?: number;
  /** Label for the hard-reject warning so corrupt data is traceable. */
  label?: string;
}

export interface TrendResult {
  /** Robust slope in value units per day (0 when confidence is 'insufficient'). */
  slopePerDay: number;
  slopePerWeek: number;
  /** Per 30 days. */
  slopePerMonth: number;
  /** Fitted value at the first USED point (x = 0). */
  intercept: number;
  confidence: TrendConfidence;
  /** Points the reported slope was actually fitted on. */
  nPoints: number;
  /** Points rejected as statistical outliers (NOT hard-rejected invalids). */
  nExcluded: number;
  /** Indices (into the input array) of outlier-rejected points. */
  excludedIndices: number[];
  /** Hard-rejected impossible values (zero/negative/non-finite). */
  nInvalid: number;
  /** Indices (into the input array) of hard-rejected points. */
  invalidIndices: number[];
  /** Observed days between first and last used point. */
  spanDays: number;
  /** Largest gap (days) between consecutive used points. */
  maxGapDays: number;
  /** Set when a level shift was detected/known; the fit starts here. */
  discontinuityAt?: Date;
  /** Index (into the input array) of the first point of the fitted segment. */
  discontinuityIndex?: number;
  /** Indices (into the input array) the fit used, ascending by date. */
  usedIndices: number[];
  /**
   * First−to−last observed change across the used points, in value units.
   * The honest thing to show when confidence is 'low' ("+0.9 in over 17
   * days") instead of extrapolating a rate past the observation window.
   */
  observedDelta: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Consistency constant: 1.4826 × MAD estimates σ for normal residuals. */
const MAD_SIGMA_SCALE = 1.4826;

/**
 * Floor for the outlier scale as a fraction of the segment's median |value|,
 * so a run of identical values (MAD = 0) doesn't flag every microscopic
 * wobble as an outlier.
 */
const RELATIVE_SCALE_FLOOR = 0.005;

function toTime(date: Date | string): number {
  if (date instanceof Date) return date.getTime();
  // Date-only strings parse as LOCAL midnight (house convention — see
  // lib/utils.getLocalDateString); bare Date() parsing would shift them a
  // day in UTC-negative zones.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T00:00:00`).getTime();
  return new Date(date).getTime();
}

function median(sortedOrNot: number[]): number {
  if (sortedOrNot.length === 0) return NaN;
  const s = [...sortedOrNot].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface XY {
  x: number; // elapsed days from the first valid point
  y: number;
  index: number; // index into the caller's input array
}

/** Theil–Sen: median pairwise slope; intercept = median(y − slope·x). */
function theilSen(points: XY[]): { slope: number; intercept: number } {
  if (points.length === 1) return { slope: 0, intercept: points[0].y };
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  // All points share one x (same-day entries): no slope is estimable.
  if (slopes.length === 0) return { slope: 0, intercept: median(points.map((p) => p.y)) };
  const slope = median(slopes);
  const intercept = median(points.map((p) => p.y - slope * p.x));
  return { slope, intercept };
}

/**
 * Compute the robust trend of a time series. See module doc for pipeline.
 * Input order does not matter; points are sorted by date internally.
 */
export function computeTrend(points: TrendPoint[], opts: TrendOptions = {}): TrendResult {
  const {
    minPoints = 3,
    rejectNonPositive = true,
    outlierMadMultiplier = 3,
    minResidualFraction = RELATIVE_SCALE_FLOOR,
    minPointsForOutlierRejection = 4,
    maxOutlierShare = 0.25,
    detectDiscontinuity = true,
    discontinuityThreshold = 0.25,
    knownDiscontinuities = [],
    lowConfidenceSpanDays = 14,
    lowConfidenceGapDays = 45,
    label,
  } = opts;

  // ---- 1. Hard-reject impossible values -------------------------------
  const invalidIndices: number[] = [];
  const valid: Array<{ time: number; y: number; index: number }> = [];
  points.forEach((p, index) => {
    const time = toTime(p.date);
    const bad =
      !Number.isFinite(p.value) ||
      !Number.isFinite(time) ||
      (rejectNonPositive && p.value <= 0);
    if (bad) invalidIndices.push(index);
    else valid.push({ time, y: p.value, index });
  });
  if (invalidIndices.length > 0) {
    // Data-integrity failure, not a statistical outlier — make it traceable.
    console.warn(
      `computeTrend${label ? `(${label})` : ''}: hard-rejected ${invalidIndices.length} ` +
        `impossible value(s) (zero/negative/non-finite) at input indices [${invalidIndices.join(', ')}]`
    );
  }

  valid.sort((a, b) => a.time - b.time);

  const empty = (confidence: TrendConfidence): TrendResult => ({
    slopePerDay: 0,
    slopePerWeek: 0,
    slopePerMonth: 0,
    intercept: valid.length > 0 ? valid[valid.length - 1].y : 0,
    confidence,
    nPoints: valid.length,
    nExcluded: 0,
    excludedIndices: [],
    nInvalid: invalidIndices.length,
    invalidIndices,
    spanDays: 0,
    maxGapDays: 0,
    usedIndices: valid.map((v) => v.index),
    observedDelta:
      valid.length >= 2 ? valid[valid.length - 1].y - valid[0].y : 0,
  });

  if (valid.length < Math.max(2, minPoints)) return empty('insufficient');

  const t0 = valid[0].time;
  let xy: XY[] = valid.map((v) => ({ x: (v.time - t0) / MS_PER_DAY, y: v.y, index: v.index }));

  // ---- 2. Segment on discontinuities -----------------------------------
  let segmentStart = 0; // index into xy
  let discontinuityAt: Date | undefined;

  // Caller-known boundaries always win: the newest boundary at/before the
  // last point starts the fitted segment.
  const boundaryTimes = knownDiscontinuities
    .map(toTime)
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  for (const bt of boundaryTimes) {
    const firstAtOrAfter = valid.findIndex((v) => v.time >= bt);
    if (firstAtOrAfter > 0) {
      segmentStart = Math.max(segmentStart, firstAtOrAfter);
      discontinuityAt = new Date(valid[firstAtOrAfter].time);
    }
  }

  if (detectDiscontinuity) {
    // Persistent level shift: a step beyond the threshold where the NEXT
    // point sits closer to the new level than the old one. A one-off bad
    // day reverts (next point returns toward the old level) and is left for
    // the outlier pass instead. The last confirmed shift wins.
    for (let i = Math.max(1, segmentStart + 1); i < xy.length - 1; i++) {
      const prev = xy[i - 1].y;
      if (prev === 0) continue; // fractional step undefined off a zero level
      const step = Math.abs(xy[i].y - prev) / Math.abs(prev);
      if (step <= discontinuityThreshold) continue;
      // The pre-step level must itself be ESTABLISHED (consistent with its
      // own predecessor) — otherwise the "shift" is just the recovery from a
      // one-off dip, which belongs to the outlier pass.
      if (i >= 2) {
        const prevPrev = xy[i - 2].y;
        if (
          prevPrev !== 0 &&
          Math.abs(prev - prevPrev) / Math.abs(prevPrev) > discontinuityThreshold
        ) {
          continue;
        }
      }
      const next = xy[i + 1].y;
      const persists = Math.abs(next - xy[i].y) < Math.abs(next - prev);
      if (persists) {
        segmentStart = i;
        discontinuityAt = new Date(valid[i].time);
      }
    }
  }

  const segment = xy.slice(segmentStart);

  if (segment.length < Math.max(2, minPoints)) {
    // Too little data since the shift: report the shift so callers can show
    // "calibrating", but fit nothing.
    const r = empty('insufficient');
    r.nPoints = segment.length;
    r.usedIndices = segment.map((p) => p.index);
    r.discontinuityAt = discontinuityAt;
    r.discontinuityIndex = discontinuityAt ? segment[0]?.index : undefined;
    r.observedDelta =
      segment.length >= 2 ? segment[segment.length - 1].y - segment[0].y : 0;
    return r;
  }

  // ---- 3. Fit + iterative MAD outlier rejection ------------------------
  let inliers = segment;
  const excludedIndices: number[] = [];
  const maxExclusions = Math.floor(segment.length * maxOutlierShare);

  let fit = theilSen(inliers);
  while (
    inliers.length > Math.max(minPoints, minPointsForOutlierRejection - 1) &&
    inliers.length >= minPointsForOutlierRejection &&
    excludedIndices.length < maxExclusions
  ) {
    const resid = inliers.map((p) => p.y - (fit.intercept + fit.slope * p.x));
    const medResid = median(resid);
    let worst = 0;
    for (let i = 1; i < inliers.length; i++) {
      if (Math.abs(resid[i] - medResid) > Math.abs(resid[worst] - medResid)) worst = i;
    }
    // Leave-worst-out test: refit without the candidate and measure its
    // deviation against the CLEAN fit's spread — a gross outlier inflates
    // the MAD of any fit that includes it, hiding itself.
    const rest = inliers.filter((_, i) => i !== worst);
    const restFit = theilSen(rest);
    // A candidate far outside the remaining points' time range can't be
    // judged — the test would extrapolate the rest-fit way past its own
    // span (a 2-day fit says nothing about a point 178 days later). Across
    // such a gap "outlier" and "real change" are indistinguishable; keep it.
    const restMinX = rest[0].x;
    const restMaxX = rest[rest.length - 1].x;
    const restSpan = Math.max(restMaxX - restMinX, 1);
    const candidateX = inliers[worst].x;
    const extrapolation =
      candidateX < restMinX ? restMinX - candidateX : candidateX > restMaxX ? candidateX - restMaxX : 0;
    if (extrapolation > restSpan * 2) break;
    const restResid = rest.map((p) => p.y - (restFit.intercept + restFit.slope * p.x));
    const restMed = median(restResid);
    const mad = median(restResid.map((r) => Math.abs(r - restMed)));
    const floor = minResidualFraction * Math.abs(median(rest.map((p) => Math.abs(p.y))));
    const scale = Math.max(MAD_SIGMA_SCALE * mad, floor);
    const candidate = inliers[worst];
    const candidateDev = Math.abs(
      candidate.y - (restFit.intercept + restFit.slope * candidate.x) - restMed
    );
    if (scale > 0 && candidateDev > outlierMadMultiplier * scale) {
      excludedIndices.push(candidate.index);
      inliers = rest;
      fit = restFit;
    } else {
      break;
    }
  }

  // ---- 4. Result + confidence gate --------------------------------------
  const spanDays = inliers[inliers.length - 1].x - inliers[0].x;
  let maxGapDays = 0;
  for (let i = 1; i < inliers.length; i++) {
    maxGapDays = Math.max(maxGapDays, inliers[i].x - inliers[i - 1].x);
  }

  let confidence: TrendConfidence = 'high';
  if (inliers.length < minPoints) confidence = 'insufficient';
  else if (spanDays < lowConfidenceSpanDays || maxGapDays > lowConfidenceGapDays) {
    confidence = 'low';
  }

  const slopePerDay = confidence === 'insufficient' ? 0 : fit.slope;

  return {
    slopePerDay,
    slopePerWeek: slopePerDay * 7,
    slopePerMonth: slopePerDay * 30,
    intercept: fit.intercept + fit.slope * inliers[0].x,
    confidence,
    nPoints: inliers.length,
    nExcluded: excludedIndices.length,
    excludedIndices: excludedIndices.sort((a, b) => a - b),
    nInvalid: invalidIndices.length,
    invalidIndices,
    spanDays,
    maxGapDays,
    discontinuityAt,
    discontinuityIndex: discontinuityAt ? segment[0].index : undefined,
    usedIndices: inliers.map((p) => p.index),
    observedDelta: inliers[inliers.length - 1].y - inliers[0].y,
  };
}

/**
 * Slope of a UNIFORMLY-SPACED series (one value per week/day at a fixed
 * step), in value units PER STEP. The one legitimate "index" regression:
 * when the series is aggregated onto a uniform grid, index IS elapsed time.
 * Never call this with per-session or per-entry data — those are irregular
 * and must go through {@link computeTrend} with real dates.
 */
export function uniformSeriesSlope(values: number[], opts?: Pick<TrendOptions, 'rejectNonPositive' | 'outlierMadMultiplier' | 'label'>): number {
  if (values.length < 2) return 0;
  const base = Date.UTC(2000, 0, 1);
  const points: TrendPoint[] = values.map((value, i) => ({
    date: new Date(base + i * MS_PER_DAY),
    value,
  }));
  const result = computeTrend(points, {
    minPoints: 2,
    // Aggregate series (weekly rates, form scores) legitimately contain 0s.
    rejectNonPositive: opts?.rejectNonPositive ?? false,
    outlierMadMultiplier: opts?.outlierMadMultiplier,
    // Uniform grids are synthetic time — span/gap gates don't apply.
    lowConfidenceSpanDays: 0,
    lowConfidenceGapDays: Number.POSITIVE_INFINITY,
    detectDiscontinuity: false,
    label: opts?.label,
  });
  return result.slopePerDay;
}
