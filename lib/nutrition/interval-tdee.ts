/**
 * Interval-based Adaptive TDEE Estimation (sparse weigh-in friendly)
 *
 * The physics of energy balance over an interval between two weigh-ins:
 *
 *   TDEE ≈ mean_daily_intake − (ΔWeight_lb × 3500) / interval_days
 *
 * Daily weigh-ins only reduce noise; they are NOT required. What IS required
 * is reasonably complete *intake* logging over the interval. A user who logs
 * food every day and steps on the scale 2–3×/week can be estimated with high
 * confidence — the old daily-paired-regression approach could not.
 *
 * Design principles baked into this module:
 * - **A useful answer from day zero.** With no data we return the formula TDEE
 *   at full weight. We never return null and never gate behind a threshold.
 * - **Bayesian blend, never a hard switch.** The posterior is a
 *   precision-weighted blend of the formula prior and observed interval
 *   estimates. The prior's weight decays smoothly as usable interval-days
 *   accumulate, so the number drifts from formula toward measured reality with
 *   no discontinuity.
 * - **Trend weight, not raw weigh-ins.** A time-aware EWMA smooths out the
 *   ±1–2 lb of water/glycogen noise before deltas are computed.
 * - **Phase-transition aware.** Intervals spanning a cut→bulk boundary (the
 *   first ~2 weeks are corrupted by glycogen/water) are excluded so a water
 *   jump is never read as a metabolic crash.
 *
 * This is a PURE module: `now` and all data are passed in as parameters so it
 * is fully unit-testable with synthetic data.
 */

// === CONSTANTS ===

/** Calories per lb of body-weight change (classic 3500 approximation). */
const CALORIES_PER_LB = 3500;

/** Minimum span (days) for an interval to be usable. Shorter intervals are
 *  dominated by water noise relative to real tissue change. */
const MIN_INTERVAL_DAYS = 5;

/** Fraction of days within an interval that must have logged intake. */
const INTAKE_COMPLETENESS_MIN = 0.85;

/** Time constant (days) for the exponentially-weighted trend weight. Larger =
 *  smoother / slower to react. ~10 days ≈ a typical "trend weight" feel. */
const TREND_TAU_DAYS = 10;

/** Recency time constant (days). Recent intervals are weighted more because
 *  metabolism adapts; an interval this many days old counts ~1/e as much. */
const RECENCY_TAU_DAYS = 28;

/** The prior (formula) carries the weight of this many "usable interval-days".
 *  priorWeight = K / (K + usableIntervalDays), so after K usable interval-days
 *  the blend is 50/50, and it decays smoothly from there. */
const PRIOR_EQUIVALENT_DAYS = 14;

/** Days after a phase change that are corrupted by glycogen/water shifts.
 *  Intervals overlapping this window are excluded. */
const PHASE_BOUNDARY_DAYS = 14;

// --- Data-driven phase-boundary detection ---
// A phase boundary shows up as an ABRUPT, PERSISTENT weight step that implies a
// physiologically impossible burn rate over the jump. That triple signature is
// what separates a real cut→bulk water shift from (a) random scale noise, which
// reverts, and (b) a genuinely low/high metabolism, which moves gradually.

/** Implied burn rate (cal/lb) below/above which an interval is "impossible" and
 *  therefore a water/glycogen artifact rather than metabolism. Wider than the
 *  reporting clamp so only true artifacts trip it. */
const ANOMALY_BURN_MIN = 6;
const ANOMALY_BURN_MAX = 26;

/** Minimum abrupt step (lb) over a single weigh-in gap to be a boundary
 *  candidate. Above the reach of typical ±1–2 lb daily water noise. */
const MIN_STEP_LB = 3.0;

/** A boundary jump must occur over a gap no longer than this (days); longer
 *  gaps describe gradual change, not an abrupt water shift. */
const MAX_RAPID_GAP_DAYS = 8;

/** Window (days) over which the post-jump level must persist to confirm the
 *  step is a real level change and not reverting noise. */
const PERSIST_WINDOW_DAYS = 14;

/** Fraction of the jump that must be retained afterward to count as persistent. */
const PERSIST_RATIO = 0.6;

/** Default analysis window in days (matches the data-fetch window). */
const DEFAULT_WINDOW_DAYS = 35;

/** Warn about a stale weigh-in once the most recent one is older than this. */
const STALE_WEIGHIN_DAYS = 8;

/** Plausible burn-rate bounds (cal per lb of body weight). */
const BURN_RATE_MIN = 9;
const BURN_RATE_MAX = 20;

// === TYPES ===

export interface WeighIn {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Body weight in lbs. */
  weightLb: number;
}

export interface IntakeDay {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Total calories logged for the day. */
  calories: number;
}

export interface IntervalTDEEInput {
  /** Reference "today". Passed in for testability. */
  now: Date | string;
  /** All weigh-ins within the window (any cadence, sparse is fine). */
  weighIns: WeighIn[];
  /** All days that have logged intake (calories > 0). */
  intakeDays: IntakeDay[];
  /** Formula-based TDEE used as the Bayesian prior mean. */
  formulaTDEE: number;
  /** Current body weight (lbs) for burn-rate reporting. Falls back to the
   *  latest weigh-in, then to formulaWeightLb. */
  currentWeightLb?: number;
  /** Body weight (lbs) the formula TDEE was computed at (for burn rate). */
  formulaWeightLb?: number;
  /** ISO dates on which the caloric phase changed (cut↔bulk↔maintenance).
   *  Sourced from the user's phase setting when available. */
  phaseChanges?: string[];
  options?: {
    windowDays?: number;
    minIntervalDays?: number;
    intakeCompletenessMin?: number;
    /** Infer phase boundaries from abrupt, persistent weight steps when the
     *  phase setting doesn't record one (default: true). */
    detectPhaseChangesFromData?: boolean;
  };
}

export type TDEEWarningKind = 'missing_calories' | 'missing_weight' | 'phase_transition';

export interface TDEEWarning {
  kind: TDEEWarningKind;
  message: string;
}

export interface IntervalDetail {
  startDate: string;
  endDate: string;
  intervalDays: number;
  meanIntake: number;
  trendWeightChangeLb: number;
  intervalTDEE: number;
  intakeCompleteness: number;
  weight: number; // combined length × recency weight used in the blend
  excludedReason?: 'short' | 'incomplete_intake' | 'phase_boundary';
}

export interface IntervalTDEEResult {
  /** Posterior TDEE estimate (cal/day). Always populated. */
  estimatedTDEE: number;
  /** Burn rate implied by the estimate at current weight (cal/lb). */
  burnRatePerLb: number;
  /** 0–100 statement of how personalized the current number is. */
  confidenceScore: number;
  confidence: 'unstable' | 'stabilizing' | 'stable';
  /** 'formula' when prior-only, 'blended' once any usable data exists. */
  source: 'formula' | 'blended';
  /** Subtitle copy for the card ("Formula estimate" → "Based on N weeks of your data"). */
  personalizationLabel: string;
  /** Fraction (0–1) of the posterior contributed by the formula prior. */
  priorWeight: number;
  /** Observed (data-only) TDEE before blending, or null if no usable intervals. */
  observedTDEE: number | null;
  /** Sum of usable interval lengths (days). Drives the blend and confidence. */
  usableIntervalDays: number;
  /** Number of usable (non-excluded) intervals. */
  intervalsUsed: number;
  /** Number of weigh-ins considered. */
  weighInCount: number;
  /** Overall intake completeness across the analysis window (0–1). */
  intakeCompleteness: number;
  /** Actionable, correctly-attributed warnings. */
  warnings: TDEEWarning[];
  /** Per-interval breakdown (usable + excluded) for debugging / display. */
  intervals: IntervalDetail[];
  /** Phase-change dates inferred from the weight data (in addition to any from
   *  the user's phase setting). Empty when none were detected. */
  inferredPhaseChanges: string[];
  /** Current weight used for the burn-rate figure. */
  currentWeight: number;
}

// === DATE HELPERS ===

function toDate(d: Date | string): Date {
  if (d instanceof Date) return d;
  // Treat bare YYYY-MM-DD as a local date to avoid UTC off-by-one.
  return new Date(`${d}T00:00:00`);
}

function toDateStr(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const ms = toDate(b).getTime() - toDate(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// === TREND WEIGHT (time-aware EWMA) ===

interface TrendPoint {
  date: string;
  raw: number;
  trend: number;
}

/**
 * Compute a time-aware exponentially-weighted trend weight. Unlike a fixed-α
 * EWMA, the smoothing factor grows with the gap between weigh-ins, so sparse
 * points still track reality while dense points get heavy noise reduction.
 *
 * trend_i = trend_{i-1} + (1 − e^{−Δt/τ}) · (raw_i − trend_{i-1})
 */
export function computeTrendWeights(
  weighIns: WeighIn[],
  tauDays: number = TREND_TAU_DAYS
): TrendPoint[] {
  const sorted = [...weighIns]
    .filter((w) => w.weightLb > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let prevDate: string | null = null;

  for (const w of sorted) {
    if (trend === null || prevDate === null) {
      trend = w.weightLb;
    } else {
      const dt = Math.max(1, daysBetween(prevDate, w.date));
      const alpha = 1 - Math.exp(-dt / tauDays);
      trend = trend + alpha * (w.weightLb - trend);
    }
    out.push({ date: w.date, raw: w.weightLb, trend });
    prevDate = w.date;
  }

  return out;
}

/** Linearly interpolate the trend weight at an exact date from trend points. */
function trendAt(trend: TrendPoint[], date: string): number | null {
  if (trend.length === 0) return null;
  // Exact / boundary handling.
  if (date <= trend[0].date) return trend[0].trend;
  if (date >= trend[trend.length - 1].date) return trend[trend.length - 1].trend;

  for (let i = 1; i < trend.length; i++) {
    if (trend[i].date >= date) {
      const t0 = trend[i - 1];
      const t1 = trend[i];
      const span = daysBetween(t0.date, t1.date);
      if (span === 0) return t1.trend;
      const frac = daysBetween(t0.date, date) / span;
      return t0.trend + frac * (t1.trend - t0.trend);
    }
  }
  return trend[trend.length - 1].trend;
}

// === INTERVAL SEGMENTATION ===

/**
 * Greedily segment weigh-ins into consecutive, non-overlapping intervals each
 * spanning at least `minSpan` days. Weigh-ins closer together than the minimum
 * are merged into one interval (their endpoints anchor a ≥minSpan window),
 * which is exactly what lets a 3–4×/week cadence produce usable intervals.
 */
function segmentIntervals(
  trend: TrendPoint[],
  minSpan: number
): Array<{ start: TrendPoint; end: TrendPoint }> {
  const intervals: Array<{ start: TrendPoint; end: TrendPoint }> = [];
  let i = 0;
  while (i < trend.length - 1) {
    let j = i + 1;
    while (j < trend.length && daysBetween(trend[i].date, trend[j].date) < minSpan) {
      j++;
    }
    if (j >= trend.length) break; // ran out before reaching minSpan
    intervals.push({ start: trend[i], end: trend[j] });
    i = j;
  }
  return intervals;
}

// === MAIN ===

export function estimateIntervalTDEE(input: IntervalTDEEInput): IntervalTDEEResult {
  const {
    now,
    weighIns,
    intakeDays,
    formulaTDEE,
    phaseChanges = [],
    options = {},
  } = input;

  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minIntervalDays = options.minIntervalDays ?? MIN_INTERVAL_DAYS;
  const completenessMin = options.intakeCompletenessMin ?? INTAKE_COMPLETENESS_MIN;

  const nowStr = toDateStr(now);
  const windowStartStr = toDateStr(addDays(toDate(nowStr), -windowDays));

  // --- Filter to window ---
  const winWeighIns = weighIns
    .filter((w) => w.weightLb > 0 && w.date >= windowStartStr && w.date <= nowStr)
    .sort((a, b) => a.date.localeCompare(b.date));
  const winIntake = intakeDays
    .filter((d) => d.calories > 0 && d.date >= windowStartStr && d.date <= nowStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  const intakeByDate = new Map<string, number>();
  for (const d of winIntake) intakeByDate.set(d.date, d.calories);

  // --- Current weight for burn-rate reporting ---
  const latestWeighIn = winWeighIns.length > 0 ? winWeighIns[winWeighIns.length - 1] : null;
  const currentWeight =
    input.currentWeightLb ??
    latestWeighIn?.weightLb ??
    input.formulaWeightLb ??
    0;

  // --- Phase boundaries: explicit (from setting) + data-inferred ---
  const detectFromData = options.detectPhaseChangesFromData ?? true;
  const inferredPhaseChanges = detectFromData
    ? detectPhaseBoundaries(winWeighIns, intakeByDate, currentWeight, completenessMin)
    : [];
  const allPhaseChanges = [...phaseChanges, ...inferredPhaseChanges];

  // --- Trend weights + interval segmentation ---
  const trend = computeTrendWeights(winWeighIns);
  const segments = trend.length >= 2 ? segmentIntervals(trend, minIntervalDays) : [];

  const details: IntervalDetail[] = [];
  const usable: IntervalDetail[] = [];

  for (const seg of segments) {
    const intervalDays = daysBetween(seg.start.date, seg.end.date);

    // Days inside [start, end) — attribute intake to the days it was consumed.
    let loggedDays = 0;
    let intakeSum = 0;
    for (let k = 0; k < intervalDays; k++) {
      const dStr = toDateStr(addDays(toDate(seg.start.date), k));
      const cals = intakeByDate.get(dStr);
      if (cals !== undefined && cals > 0) {
        loggedDays++;
        intakeSum += cals;
      }
    }
    const intakeCompleteness = intervalDays > 0 ? loggedDays / intervalDays : 0;
    const meanIntake = loggedDays > 0 ? intakeSum / loggedDays : 0;
    const trendChange = seg.end.trend - seg.start.trend;
    const intervalTDEE = meanIntake - (trendChange * CALORIES_PER_LB) / intervalDays;

    const detail: IntervalDetail = {
      startDate: seg.start.date,
      endDate: seg.end.date,
      intervalDays,
      meanIntake: Math.round(meanIntake),
      trendWeightChangeLb: Math.round(trendChange * 100) / 100,
      intervalTDEE: Math.round(intervalTDEE),
      intakeCompleteness: Math.round(intakeCompleteness * 100) / 100,
      weight: 0,
    };

    // Exclusion checks.
    if (intervalDays < minIntervalDays) {
      detail.excludedReason = 'short';
    } else if (intakeCompleteness < completenessMin) {
      detail.excludedReason = 'incomplete_intake';
    } else if (spansPhaseBoundary(seg.start.date, seg.end.date, allPhaseChanges)) {
      detail.excludedReason = 'phase_boundary';
    } else if (meanIntake <= 0) {
      detail.excludedReason = 'incomplete_intake';
    }

    if (!detail.excludedReason) {
      // Combined weight: length (more days = less water-noise) × recency.
      const ageDays = daysBetween(seg.end.date, nowStr);
      const recency = Math.exp(-Math.max(0, ageDays) / RECENCY_TAU_DAYS);
      detail.weight = intervalDays * recency;
      usable.push(detail);
    }
    details.push(detail);
  }

  // --- Observed estimate (weighted mean of usable intervals) ---
  let observedTDEE: number | null = null;
  let usableIntervalDays = 0;
  if (usable.length > 0) {
    const wSum = usable.reduce((s, d) => s + d.weight, 0);
    const weighted = usable.reduce((s, d) => s + d.weight * d.intervalTDEE, 0);
    observedTDEE = wSum > 0 ? weighted / wSum : null;
    usableIntervalDays = usable.reduce((s, d) => s + d.intervalDays, 0);
  }

  // --- Bayesian blend with the formula prior ---
  const priorWeight =
    observedTDEE === null
      ? 1
      : PRIOR_EQUIVALENT_DAYS / (PRIOR_EQUIVALENT_DAYS + usableIntervalDays);
  const posterior =
    observedTDEE === null
      ? formulaTDEE
      : priorWeight * formulaTDEE + (1 - priorWeight) * observedTDEE;

  const estimatedTDEE = Math.round(posterior);
  const burnRatePerLb =
    currentWeight > 0
      ? clamp(estimatedTDEE / currentWeight, BURN_RATE_MIN, BURN_RATE_MAX)
      : 0;

  // --- Overall intake completeness across the window ---
  const intakeCompleteness = computeWindowIntakeCompleteness(
    winWeighIns,
    winIntake,
    windowStartStr,
    nowStr
  );

  // --- Confidence ---
  const confidenceScore = computeConfidenceScore({
    usableIntervalDays,
    weighInCount: winWeighIns.length,
    intakeCompleteness,
    intervalEstimates: usable.map((d) => d.intervalTDEE),
    observedTDEE,
  });
  const confidence: IntervalTDEEResult['confidence'] =
    confidenceScore >= 70 ? 'stable' : confidenceScore >= 40 ? 'stabilizing' : 'unstable';

  // --- Warnings (correctly attributed) ---
  const warnings = buildWarnings({
    winWeighIns,
    intakeCompleteness,
    windowStartStr,
    nowStr,
    usableCount: usable.length,
    hasPhaseExclusion: details.some((d) => d.excludedReason === 'phase_boundary'),
    intervalDetails: details,
  });

  // --- Personalization subtitle ---
  const personalizationLabel = buildPersonalizationLabel(usableIntervalDays);

  return {
    estimatedTDEE,
    burnRatePerLb: Math.round(burnRatePerLb * 10) / 10,
    confidenceScore,
    confidence,
    source: observedTDEE === null ? 'formula' : 'blended',
    personalizationLabel,
    priorWeight: Math.round(priorWeight * 100) / 100,
    observedTDEE: observedTDEE === null ? null : Math.round(observedTDEE),
    usableIntervalDays,
    intervalsUsed: usable.length,
    weighInCount: winWeighIns.length,
    intakeCompleteness: Math.round(intakeCompleteness * 100) / 100,
    warnings,
    intervals: details,
    inferredPhaseChanges,
    currentWeight: Math.round(currentWeight * 10) / 10,
  };
}

// === CONFIDENCE ===

function computeConfidenceScore(args: {
  usableIntervalDays: number;
  weighInCount: number;
  intakeCompleteness: number;
  intervalEstimates: number[];
  observedTDEE: number | null;
}): number {
  const { usableIntervalDays, weighInCount, intakeCompleteness, intervalEstimates, observedTDEE } =
    args;

  // Formula-only: low but non-zero — "this is mostly the formula so far".
  if (observedTDEE === null || usableIntervalDays === 0) {
    return 12;
  }

  // Quantity of usable interval-days (saturates ~28 days) — up to 50.
  const dataDaysScore = Math.min(usableIntervalDays / 28, 1) * 50;

  // Number of weigh-ins bracketing intervals (saturates at 6) — up to 20.
  const weighInScore = Math.min(weighInCount / 6, 1) * 20;

  // Intake logging completeness — up to 15.
  const completenessScore = intakeCompleteness * 15;

  // Consistency of interval estimates (low coefficient of variation) — up to 15.
  let consistencyScore = 15;
  if (intervalEstimates.length >= 2 && observedTDEE > 0) {
    const sd = Math.sqrt(varianceOf(intervalEstimates));
    const cv = sd / Math.abs(observedTDEE);
    consistencyScore = (1 - Math.min(cv / 0.15, 1)) * 15;
  }

  const score = dataDaysScore + weighInScore + completenessScore + consistencyScore;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// === WARNINGS ===

function buildWarnings(args: {
  winWeighIns: WeighIn[];
  intakeCompleteness: number;
  windowStartStr: string;
  nowStr: string;
  usableCount: number;
  hasPhaseExclusion: boolean;
  intervalDetails: IntervalDetail[];
}): TDEEWarning[] {
  const {
    winWeighIns,
    windowStartStr,
    nowStr,
    usableCount,
    hasPhaseExclusion,
    intervalDetails,
  } = args;
  const warnings: TDEEWarning[] = [];

  // 1. Missing CALORIES is the costly gap — it excludes intervals.
  const missingCalorieDays = intervalDetails
    .filter((d) => d.excludedReason === 'incomplete_intake')
    .reduce((s, d) => s + Math.round(d.intervalDays * (1 - d.intakeCompleteness)), 0);
  if (missingCalorieDays > 0) {
    warnings.push({
      kind: 'missing_calories',
      message: `${missingCalorieDays} day${missingCalorieDays === 1 ? '' : 's'} without food logs — these gaps exclude intervals from your estimate.`,
    });
  }

  // 2. Missing WEIGHT — only warn if it's actually gating the estimate.
  //    Either no closed interval yet, or the most recent weigh-in is stale.
  const daysSinceWeighIn =
    winWeighIns.length > 0
      ? daysBetween(winWeighIns[winWeighIns.length - 1].date, nowStr)
      : daysBetween(windowStartStr, nowStr);

  if (winWeighIns.length < 2) {
    warnings.push({
      kind: 'missing_weight',
      message:
        winWeighIns.length === 0
          ? 'No weigh-ins yet — step on the scale to start personalizing your estimate.'
          : 'Only one weigh-in so far — add another to close out your first interval.',
    });
  } else if (usableCount === 0 && !hasPhaseExclusion && missingCalorieDays === 0) {
    warnings.push({
      kind: 'missing_weight',
      message: `No weigh-in for ${daysSinceWeighIn} days — step on the scale to close out this interval.`,
    });
  } else if (daysSinceWeighIn >= STALE_WEIGHIN_DAYS) {
    warnings.push({
      kind: 'missing_weight',
      message: `No weigh-in for ${daysSinceWeighIn} days — step on the scale to close out this interval.`,
    });
  }

  // 3. Phase transition note.
  if (hasPhaseExclusion) {
    warnings.push({
      kind: 'phase_transition',
      message:
        'Recent phase change detected — the first ~2 weeks of water/glycogen shifts are excluded so your estimate stays accurate.',
    });
  }

  return warnings;
}

// === LABEL ===

function buildPersonalizationLabel(usableIntervalDays: number): string {
  if (usableIntervalDays <= 0) return 'Formula estimate';
  if (usableIntervalDays < 21) return `Formula + ${usableIntervalDays} days of your data`;
  const weeks = Math.round(usableIntervalDays / 7);
  return `Based on ${weeks} weeks of your data`;
}

// === PHASE + INTAKE HELPERS ===

/**
 * Infer phase-change dates from the weight data when the phase setting doesn't
 * record one (e.g. a bulk started after a long cut — the app only persists a
 * start date for aggressive cuts). A boundary is flagged only when all three
 * hold for a single weigh-in gap, which is what a glycogen/water shift looks
 * like and random noise / gradual metabolism do not:
 *
 *   1. Abrupt: a raw step of ≥ MIN_STEP_LB over a gap ≤ MAX_RAPID_GAP_DAYS.
 *   2. Impossible: the step implies a burn rate outside [MIN, MAX] cal/lb once
 *      intake over the gap is accounted for (so it can't be real tissue change).
 *   3. Persistent: the new level holds over the following weeks rather than
 *      reverting (which is what separates a phase shift from scale noise).
 *
 * Requires reasonably complete intake over the gap so the implied burn rate is
 * trustworthy, and at least one subsequent weigh-in to confirm persistence.
 */
export function detectPhaseBoundaries(
  weighIns: WeighIn[],
  intakeByDate: Map<string, number>,
  currentWeight: number,
  completenessMin: number
): string[] {
  const boundaries: string[] = [];
  const w = [...weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const refWeight = currentWeight > 0 ? currentWeight : 180;

  for (let i = 0; i < w.length - 1; i++) {
    const gapDays = daysBetween(w[i].date, w[i + 1].date);
    if (gapDays < 1 || gapDays > MAX_RAPID_GAP_DAYS) continue;

    const step = w[i + 1].weightLb - w[i].weightLb;
    if (Math.abs(step) < MIN_STEP_LB) continue; // 1. abrupt enough?

    // Intake over the gap [date_i, date_{i+1}) — must be reliable.
    let logged = 0;
    let intakeSum = 0;
    for (let k = 0; k < gapDays; k++) {
      const dStr = toDateStr(addDays(toDate(w[i].date), k));
      const cals = intakeByDate.get(dStr);
      if (cals !== undefined && cals > 0) {
        logged++;
        intakeSum += cals;
      }
    }
    if (logged === 0 || logged / gapDays < completenessMin) continue;
    const meanIntake = intakeSum / logged;

    // 2. Does the step imply a physiologically impossible burn rate?
    const impliedTDEE = meanIntake - (step * CALORIES_PER_LB) / gapDays;
    const impliedBurn = impliedTDEE / refWeight;
    if (impliedBurn >= ANOMALY_BURN_MIN && impliedBurn <= ANOMALY_BURN_MAX) continue;

    // 3. Does the new level persist (vs. reverting noise)?
    const postEndStr = toDateStr(addDays(toDate(w[i + 1].date), PERSIST_WINDOW_DAYS));
    const post = w.filter((x) => x.date > w[i + 1].date && x.date <= postEndStr);
    if (post.length === 0) continue; // can't confirm — stay conservative
    const postMean = post.reduce((s, x) => s + x.weightLb, 0) / post.length;
    const persistRatio = step !== 0 ? (postMean - w[i].weightLb) / step : 0;
    if (persistRatio >= PERSIST_RATIO) {
      boundaries.push(w[i].date);
    }
  }

  return boundaries;
}

function spansPhaseBoundary(
  startDate: string,
  endDate: string,
  phaseChanges: string[]
): boolean {
  for (const change of phaseChanges) {
    // Corrupted window is [change, change + PHASE_BOUNDARY_DAYS].
    const boundaryEnd = toDateStr(addDays(toDate(change), PHASE_BOUNDARY_DAYS));
    // Overlap test between [startDate, endDate] and [change, boundaryEnd].
    if (startDate <= boundaryEnd && endDate >= change) {
      return true;
    }
  }
  return false;
}

function computeWindowIntakeCompleteness(
  winWeighIns: WeighIn[],
  winIntake: IntakeDay[],
  windowStartStr: string,
  nowStr: string
): number {
  // Only assess completeness from when the user actually started using the app
  // (first weigh-in or intake), so we don't penalize pre-signup days.
  const firstDates: string[] = [];
  if (winWeighIns.length > 0) firstDates.push(winWeighIns[0].date);
  if (winIntake.length > 0) firstDates.push(winIntake[0].date);
  if (firstDates.length === 0) return 0;

  const start = firstDates.sort()[0];
  const effectiveStart = start > windowStartStr ? start : windowStartStr;
  const totalDays = daysBetween(effectiveStart, nowStr) + 1;
  if (totalDays <= 0) return 0;

  const loggedInRange = winIntake.filter((d) => d.date >= effectiveStart && d.date <= nowStr).length;
  return Math.min(1, loggedInRange / totalDays);
}

// === MATH HELPERS ===

function varianceOf(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}
