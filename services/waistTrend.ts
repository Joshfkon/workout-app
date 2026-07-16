/**
 * waistTrend
 *
 * Morning-waist trend handling and the composition "partition anchor" derived
 * from it. Daily waist is noisy (food volume, hydration, sodium), so NOTHING
 * here works off a raw day-over-day delta — every signal reads a time-aware
 * EWMA trend, the same smoothing the body-weight trend uses.
 *
 * The payoff: over a trailing window, `partitionRatio = Δtrend_waist(in) /
 * Δtrend_weight(lb)` tells us how much of a weight change is waist-expanding.
 * A bigger waist-per-pound means more of the change is fat. We use this to
 *   - replace the FIXED lean/fat partitioning assumption in the weight
 *     projection with an OBSERVED one, and
 *   - bend the interpolated BF% line between DEXA scans.
 *
 * FIREWALL — waist informs the RATE of fat change ONLY. It NEVER produces an
 * absolute BF% or lean mass (DEXA remains the only source of absolute truth),
 * and it NEVER touches TDEE / calorie math (same firewall as steps: activity
 * and composition data never feed the observed-TDEE posterior).
 *
 * Pure functions only: NO database calls.
 */

// ============================================================
// Constants (single documented object — tuned later against DEXA)
// ============================================================

/**
 * Every tunable that shapes the waist-derived signals. Kept in ONE place so
 * the eventual DEXA calibration is a single edit. Bands are expressed in
 * inches of waist trend per pound of bodyweight trend.
 */
export const WAIST_PARTITION = {
  /** EWMA time constant (days). Matches the body-weight trend's tau. */
  TREND_TAU_DAYS: 10,

  /**
   * Outlier guard: a raw entry this many inches from the running trend is
   * flagged and excluded from the trend until confirmed. Reuses the tape
   * outlier idea from the Progress redesign, scaled for a single site.
   */
  OUTLIER_INCHES: 1.5,

  /** Trailing window over which the partition ratio is measured. */
  WINDOW_MIN_DAYS: 14,
  WINDOW_MAX_DAYS: 28,

  /**
   * Hard gate: no derived signal renders with fewer than this many days of
   * waist data in the trailing GATE_LOOKBACK_DAYS.
   */
  MIN_DATA_DAYS: 10,
  GATE_LOOKBACK_DAYS: 28,

  /**
   * Below this |Δtrend_weight| (lb) the ratio's denominator is noise, so no
   * partition ratio is reported. Lower than compositionSpace's 3 lb
   * scan-to-scan p-ratio floor on purpose: this is a multi-WEEK trend delta,
   * where ~1 lb is already a real, above-noise movement.
   */
  MIN_WEIGHT_DELTA_LB: 1,

  /** Band edges (in/lb). ≤LEAN_MAX lean-dominant; >FAT_MIN fat-dominant. */
  BANDS: {
    /** ≤0.02 in/lb → the gain is lean-dominant. */
    LEAN_MAX: 0.02,
    /** >0.15 in/lb → the gain is fat-dominant. Between the two → mixed. */
    FAT_MIN: 0.15,
  },

  /**
   * Observed-ratio → lean fraction of the weight CHANGE, used to replace the
   * fixed partitioning assumption in the projection. Monotonic decreasing:
   * more waist-per-pound ⇒ less of the change is lean. Anchor points are
   * per-band and interpolated linearly; deliberately coarse until DEXA
   * calibration. This partitions the RATE of change only — never an absolute.
   */
  LEAN_FRACTION_AT: {
    /** At/below the lean band edge. */
    LEAN: 0.7,
    /** At the fat band edge. */
    FAT: 0.2,
  },
} as const;

// ============================================================
// Types
// ============================================================

/** A raw morning-waist entry. `waistIn` is inches (the canonical unit here). */
export interface WaistEntry {
  /** YYYY-MM-DD (local day). */
  date: string;
  waistIn: number;
}

/** A raw weigh-in in pounds (the unit the ratio is expressed against). */
export interface WeightEntry {
  date: string;
  weightLb: number;
}

export interface WaistTrendPoint {
  date: string;
  /** The raw entry as logged. */
  rawIn: number;
  /**
   * The EWMA trend value AT this date. For an outlier the trend is carried
   * forward unchanged (the outlier does not move it).
   */
  trendIn: number;
  /** True when the raw entry was >OUTLIER_INCHES from trend and excluded. */
  isOutlier: boolean;
}

export type PartitionBand = 'lean-dominant' | 'mixed' | 'fat-dominant';

export interface PartitionAnchor {
  /** Δtrend_waist(in) / Δtrend_weight(lb) over the window. */
  ratioInPerLb: number;
  band: PartitionBand;
  /** Actual number of days spanned by the window used. */
  windowDays: number;
  deltaWaistIn: number;
  deltaWeightLb: number;
  /** Count of valid (non-outlier) waist days in the trailing gate window. */
  waistDataDays: number;
  /**
   * Fraction of the weight change attributable to lean mass, derived from the
   * observed ratio. Rate-of-change only — NOT an absolute lean mass.
   */
  leanFractionOfGain: number;
}

/** Which partitioning is driving a projection surface, for honest labeling. */
export interface ResolvedPartition {
  leanFractionOfGain: number;
  source: 'waist' | 'assumed';
  /** Card label: "partition from your waist trend" vs "assumed partition". */
  label: string;
  /** The anchor when source === 'waist' (for evidence copy); else null. */
  anchor: PartitionAnchor | null;
}

// ============================================================
// Date helpers (UTC-noon arithmetic; dates are already local-day strings)
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string): number {
  return Math.round(new Date(`${date}T00:00:00Z`).getTime() / DAY_MS);
}

function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ============================================================
// EWMA trend (time-aware, with optional outlier exclusion)
// ============================================================

/**
 * Time-aware EWMA over dated values. The smoothing factor grows with the gap
 * between entries, so sparse points still track while dense points get heavy
 * noise reduction:  trend_i = trend_{i-1} + (1 − e^{−Δt/τ})·(x_i − trend_{i-1}).
 *
 * When `outlierThreshold` is set, an entry that far from the running trend is
 * flagged and does NOT move the trend (carried forward) — it is excluded
 * until confirmed. The first non-outlier entry seeds the trend.
 */
export function computeEwmaTrend(
  points: Array<{ date: string; value: number }>,
  tauDays: number = WAIST_PARTITION.TREND_TAU_DAYS,
  outlierThreshold?: number
): Array<{ date: string; raw: number; trend: number; isOutlier: boolean }> {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  const out: Array<{ date: string; raw: number; trend: number; isOutlier: boolean }> = [];
  let trend: number | null = null;
  let prevDate: string | null = null;

  for (const p of sorted) {
    if (trend === null || prevDate === null) {
      // Seed on the first (non-outlier by definition) entry.
      trend = p.value;
      out.push({ date: p.date, raw: p.value, trend, isOutlier: false });
      prevDate = p.date;
      continue;
    }

    const isOutlier =
      outlierThreshold !== undefined && Math.abs(p.value - trend) > outlierThreshold;

    if (isOutlier) {
      // Exclude: trend held flat, point emitted flagged. prevDate is NOT
      // advanced so the next valid entry's Δt is measured from the last point
      // that actually moved the trend.
      out.push({ date: p.date, raw: p.value, trend, isOutlier: true });
      continue;
    }

    const dt = Math.max(1, daysBetween(prevDate, p.date));
    const alpha = 1 - Math.exp(-dt / tauDays);
    trend = trend + alpha * (p.value - trend);
    out.push({ date: p.date, raw: p.value, trend, isOutlier: false });
    prevDate = p.date;
  }

  return out;
}

/** Waist-specific trend: inches, with the 1.5" outlier guard applied. */
export function computeWaistTrend(
  entries: WaistEntry[],
  tauDays: number = WAIST_PARTITION.TREND_TAU_DAYS
): WaistTrendPoint[] {
  return computeEwmaTrend(
    entries.map((e) => ({ date: e.date, value: e.waistIn })),
    tauDays,
    WAIST_PARTITION.OUTLIER_INCHES
  ).map((p) => ({ date: p.date, rawIn: p.raw, trendIn: p.trend, isOutlier: p.isOutlier }));
}

/** Latest waist trend value (inches), ignoring outliers. Null when empty. */
export function latestWaistTrendIn(points: WaistTrendPoint[]): number | null {
  const valid = points.filter((p) => !p.isOutlier);
  return valid.length ? valid[valid.length - 1].trendIn : null;
}

/**
 * Trend value at (or just before) `date` by carrying the last known trend
 * forward. A date before the first valid point clamps to that first value
 * (the seed), so a window that reaches back past the data uses the earliest
 * trend rather than failing. Null only when there is no valid point at all.
 */
function trendValueAt(
  points: Array<{ date: string; trend: number; isOutlier: boolean }>,
  date: string
): number | null {
  let val: number | null = null;
  let firstValid: number | null = null;
  for (const p of points) {
    if (p.isOutlier) continue;
    if (firstValid === null) firstValid = p.trend;
    if (p.date <= date) val = p.trend;
    else break;
  }
  return val ?? firstValid;
}

/** Earliest valid (non-outlier) date in a trend series, or null. */
function firstValidDate(
  points: Array<{ date: string; isOutlier: boolean }>
): string | null {
  for (const p of points) if (!p.isOutlier) return p.date;
  return null;
}

// ============================================================
// Gate + banding
// ============================================================

/** Count of valid (non-outlier) waist days within the trailing gate window. */
export function waistDataDaysInWindow(
  points: WaistTrendPoint[],
  asOf: string,
  lookbackDays: number = WAIST_PARTITION.GATE_LOOKBACK_DAYS
): number {
  const days = new Set<string>();
  for (const p of points) {
    if (p.isOutlier) continue;
    const age = daysBetween(p.date, asOf);
    if (age >= 0 && age < lookbackDays) days.add(p.date);
  }
  return days.size;
}

/** True once there is enough waist data for ANY derived signal to render. */
export function hasEnoughWaistData(points: WaistTrendPoint[], asOf: string): boolean {
  return waistDataDaysInWindow(points, asOf) >= WAIST_PARTITION.MIN_DATA_DAYS;
}

export function classifyPartitionBand(ratioInPerLb: number): PartitionBand {
  if (ratioInPerLb <= WAIST_PARTITION.BANDS.LEAN_MAX) return 'lean-dominant';
  if (ratioInPerLb > WAIST_PARTITION.BANDS.FAT_MIN) return 'fat-dominant';
  return 'mixed';
}

/**
 * Observed ratio → lean fraction of the weight change. Monotonic decreasing,
 * clamped to the two documented anchor points and extrapolated flat beyond
 * them. Rate-of-change partition only.
 */
export function leanFractionFromRatio(ratioInPerLb: number): number {
  const { LEAN_MAX, FAT_MIN } = WAIST_PARTITION.BANDS;
  const { LEAN, FAT } = WAIST_PARTITION.LEAN_FRACTION_AT;
  if (ratioInPerLb <= LEAN_MAX) return LEAN;
  if (ratioInPerLb >= FAT_MIN) return FAT;
  const t = (ratioInPerLb - LEAN_MAX) / (FAT_MIN - LEAN_MAX);
  return round(LEAN + t * (FAT - LEAN), 3);
}

// ============================================================
// Partition anchor (derived signal 1)
// ============================================================

export interface PartitionAnchorInput {
  waist: WaistEntry[];
  weight: WeightEntry[];
  /** "Today" (local day). Defaults to the latest waist entry's date. */
  asOf?: string;
  /** Preferred window length; clamped to [WINDOW_MIN, WINDOW_MAX]. */
  windowDays?: number;
}

/**
 * Compute the partition anchor over a trailing window, or null when the hard
 * gate fails or the weight change is within noise. Both waist and weight are
 * read as TRENDS — never raw endpoints.
 */
export function computePartitionAnchor(input: PartitionAnchorInput): PartitionAnchor | null {
  const waistPoints = computeWaistTrend(input.waist);
  const validWaist = waistPoints.filter((p) => !p.isOutlier);
  if (validWaist.length === 0) return null;

  const asOf = input.asOf ?? validWaist[validWaist.length - 1].date;

  // Hard gate first — no signal below the data floor.
  const waistDataDays = waistDataDaysInWindow(waistPoints, asOf);
  if (waistDataDays < WAIST_PARTITION.MIN_DATA_DAYS) return null;

  const requestedWindow = clamp(
    input.windowDays ?? WAIST_PARTITION.WINDOW_MAX_DAYS,
    WAIST_PARTITION.WINDOW_MIN_DAYS,
    WAIST_PARTITION.WINDOW_MAX_DAYS
  );
  const desiredStart = shiftDate(asOf, -requestedWindow);

  const weightPoints = computeEwmaTrend(
    input.weight.map((e) => ({ date: e.date, value: e.weightLb }))
  );

  // Clamp the window start to where BOTH series actually have data, so a
  // window reaching past the history shrinks instead of failing. windowDays is
  // then reported as the ACTUAL span measured.
  const waistTrendable = waistPoints.map((p) => ({
    date: p.date,
    trend: p.trendIn,
    isOutlier: p.isOutlier,
  }));
  const weightTrendable = weightPoints.map((p) => ({
    date: p.date,
    trend: p.trend,
    isOutlier: p.isOutlier,
  }));
  const commonEarliest = [firstValidDate(waistTrendable), firstValidDate(weightTrendable)]
    .filter((d): d is string => d != null)
    .sort()
    .pop();
  if (commonEarliest == null) return null;
  const windowStart = desiredStart < commonEarliest ? commonEarliest : desiredStart;

  const waistStart = trendValueAt(waistTrendable, windowStart);
  const waistEnd = latestWaistTrendIn(waistPoints);
  const weightStart = trendValueAt(weightTrendable, windowStart);
  const weightEnd = weightPoints.length ? weightPoints[weightPoints.length - 1].trend : null;

  if (waistStart == null || waistEnd == null || weightStart == null || weightEnd == null) {
    return null;
  }

  const windowDays = daysBetween(windowStart, asOf);
  const deltaWaistIn = waistEnd - waistStart;
  const deltaWeightLb = weightEnd - weightStart;

  // Denominator noise floor: a ratio over a sub-noise weight change is
  // meaningless. Also undefined for weight LOSS — the bands describe a gain.
  if (deltaWeightLb < WAIST_PARTITION.MIN_WEIGHT_DELTA_LB) return null;

  const ratioInPerLb = deltaWaistIn / deltaWeightLb;
  const band = classifyPartitionBand(ratioInPerLb);

  return {
    ratioInPerLb: round(ratioInPerLb, 4),
    band,
    windowDays,
    deltaWaistIn: round(deltaWaistIn, 2),
    deltaWeightLb: round(deltaWeightLb, 2),
    waistDataDays,
    leanFractionOfGain: leanFractionFromRatio(ratioInPerLb),
  };
}

/**
 * Resolve which partitioning a projection surface should use: the observed
 * waist anchor when the gate passed, otherwise the caller's fixed assumption.
 * The label is the copy the card must show so the user knows which is in play.
 */
export function resolvePartition(
  anchor: PartitionAnchor | null,
  fallbackLeanFraction: number
): ResolvedPartition {
  if (anchor) {
    return {
      leanFractionOfGain: anchor.leanFractionOfGain,
      source: 'waist',
      label: 'partition from your waist trend',
      anchor,
    };
  }
  return {
    leanFractionOfGain: clamp(fallbackLeanFraction, 0, 1),
    source: 'assumed',
    label: 'assumed partition',
    anchor: null,
  };
}

// ============================================================
// Bulk pace check (derived signal 2)
// ============================================================

export interface PaceCheckInput {
  /** 14-day partition anchor (null when the gate failed). */
  anchor: PartitionAnchor | null;
  /** Body-weight trend rate, lb/week (positive = gaining). */
  weightRateLbPerWeek: number;
  /** The user's target gain rate, lb/week. */
  targetRateLbPerWeek: number;
  phase: 'bulk' | 'cut' | 'maintain' | 'recomp' | string;
  /** Epoch ms of the last time this signal fired (persisted). Null if never. */
  lastFiredAtMs?: number | null;
  /** Epoch ms of the last dismissal (persisted). Null if never. */
  lastDismissedAtMs?: number | null;
  /** "Now" as epoch ms (injected — services never read the clock). */
  nowMs: number;
}

export interface PaceCheckSignal {
  /** Evidence-first line for the Home weight/phase card. */
  message: string;
  deltaWaistIn: number;
  deltaWeightLb: number;
  windowDays: number;
}

const WEEK_MS = 7 * DAY_MS;

/**
 * Bulk-only pace advisory. Fires at most once per week and never off a single
 * day's entry (the anchor already enforces the ≥10-day gate). It states the
 * numbers and the window and stops there — no verdict about the user.
 *
 * NOTE: the cut-phase mirror ("waist not moving on a cut → you may be able to
 * push harder") is explicitly OUT OF SCOPE for v1. Do not add it here without
 * its own spec — a cut has different noise and different failure modes.
 */
export function evaluatePaceCheck(input: PaceCheckInput): PaceCheckSignal | null {
  const { anchor } = input;
  if (!anchor) return null; // gate already failed
  if (input.phase !== 'bulk') return null;
  if (anchor.band !== 'fat-dominant') return null;

  // Weight must be gaining AND at/above the target pace — a fat-dominant ratio
  // while gaining slowly isn't the surplus's fault.
  if (input.targetRateLbPerWeek <= 0) return null;
  if (input.weightRateLbPerWeek < input.targetRateLbPerWeek) return null;

  // Once-per-week cadence, respecting both a prior fire and a dismissal.
  const lastEvent = Math.max(input.lastFiredAtMs ?? 0, input.lastDismissedAtMs ?? 0);
  if (lastEvent && input.nowMs - lastEvent < WEEK_MS) return null;

  const waistStr = `${anchor.deltaWaistIn >= 0 ? '+' : ''}${anchor.deltaWaistIn.toFixed(2)}"`;
  const weightStr = `${anchor.deltaWeightLb >= 0 ? '+' : ''}${anchor.deltaWeightLb.toFixed(1)} lb`;

  return {
    message: `Waist trend ${waistStr} over ${anchor.windowDays} days at ${weightStr} — fat-dominant for this rate. Consider trimming the surplus ~10%.`,
    deltaWaistIn: anchor.deltaWaistIn,
    deltaWeightLb: anchor.deltaWeightLb,
    windowDays: anchor.windowDays,
  };
}

// ============================================================
// Small date shim
// ============================================================

function shiftDate(date: string, days: number): string {
  const ms = dayNumber(date) * DAY_MS + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}
