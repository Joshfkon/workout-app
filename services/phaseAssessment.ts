/**
 * Phase Assessment Engine
 *
 * Rules-based verdict for the Body tab: given the ACTIVE training phase and
 * the in-phase weight / DEXA / waist data, produce a one-line headline, a
 * status, up to 4 supporting details, and at most one conservative suggestion.
 *
 * Design constraints (deliberate, do not relax):
 * - Pure and deterministic. No network, no LLM, no clock reads — `today` is an
 *   input. Every branch is unit-testable.
 * - Every trend is computed ONLY inside the active phase's date range. Data
 *   from before startDay never leaks into a rate, which is the whole reason
 *   phases exist (a cut's scans must not drag down a bulk's lean trend).
 * - All day math goes through lib/date/localDay string helpers — never raw
 *   Date parsing of 'YYYY-MM-DD' (that's UTC midnight and shifts a day in
 *   negative-offset timezones).
 * - Tone: terse and factual. State the number, state the comparison, stop.
 */

import type { DexaScan, TrainingPhase, PhaseType } from '@/types/schema';
import { computeTrendWeights, type WeighIn } from '@/lib/nutrition/interval-tdee';
import { addLocalDays, localDaysBetweenDays, parseLocalDay } from '@/lib/date/localDay';
import { computeTrend } from '@/services/shared/trend';

// === TYPES ===

export type AssessmentStatus =
  | 'on_track'
  | 'attention'
  | 'off_track'
  | 'insufficient_data'
  | 'no_phase';

export interface AssessmentDetail {
  /** Short metric label, e.g. 'Rate', 'Lean mass', 'Waist'. */
  metric: string;
  /** One terse sentence. */
  text: string;
}

export interface Assessment {
  /** One sentence, e.g. "Bulk, week 18: gaining faster than target". */
  headline: string;
  status: AssessmentStatus;
  /** 0–4 supporting bullets. */
  details: AssessmentDetail[];
  /** At most ONE concrete, conservative action. */
  suggestion?: string;
}

export interface WaistEntry {
  /** localDay YYYY-MM-DD. */
  day: string;
  /** Waist circumference in inches. */
  waistIn: number;
}

export interface AssessProgressInput {
  /** The active phase, or null when none is set. */
  phase: TrainingPhase | null;
  /** Reference "today" as a localDay string. Passed in for determinism. */
  today: string;
  /** Daily weigh-ins (lb). May span any range; filtered to the phase here. */
  weighIns: WeighIn[];
  /** DEXA scans. May span any range; filtered to the phase here. */
  scans: DexaScan[];
  /** Waist tape entries (inches). Optional. */
  waist?: WaistEntry[];
}

// === CONSTANTS (rule thresholds from the spec) ===

/** Rate band around target that still counts as on-track (lb/wk). */
export const RATE_TOLERANCE_LB_PER_WK = 0.25;
/** Weigh-in sufficiency: need this many in the trailing window. */
const MIN_WEIGH_INS = 7;
const WEIGH_IN_WINDOW_DAYS = 21;
/** Minimum in-phase span (days) before a weekly rate is meaningful. */
const MIN_RATE_SPAN_DAYS = 7;
/** Bulk partition floor: lean share of total gain below this is poor. */
const BULK_LEAN_SHARE_FLOOR = 0.3;
/** Waist growth above this (in/month) corroborates fat gain. */
const WAIST_RATE_LIMIT_IN_PER_MONTH = 0.25;
/** Cut: lean loss above this share of total loss draws attention. */
const CUT_LEAN_LOSS_SHARE = 0.25;
/** Cut: losing faster than this % of bodyweight per week is off-track. */
const CUT_MAX_PCT_BW_PER_WK = 1.5;
/** Recomp/maintenance: weight drift tolerance vs phase start (%). */
const MAINTENANCE_DRIFT_PCT = 1;
/**
 * Fallback targets when a bulk/cut phase has no stored target rate (the
 * editor asks for one, but old rows may lack it). Matches the app's lean-bulk
 * / moderate-cut defaults.
 */
const DEFAULT_TARGET_LB_PER_WK: Record<'bulk' | 'cut', number> = {
  bulk: 0.5,
  cut: -1.0,
};

const KG_TO_LB = 2.20462;
/** Float-compare slack so "exactly target ± 0.25" lands on_track. */
const EPS = 1e-9;
/** Average days per month, shared with bodyCompEngine's monthly rates. */
const DAYS_PER_MONTH = 30.44;

export const PHASE_LABEL: Record<PhaseType, string> = {
  bulk: 'Bulk',
  cut: 'Cut',
  recomp: 'Recomp',
  maintenance: 'Maintenance',
};

// === SMALL HELPERS ===

const maxDay = (a: string, b: string): string => (a >= b ? a : b);

function fmtSigned(value: number, decimals = 1): string {
  const rounded = Number(value.toFixed(decimals));
  // Normalize -0.0 to +0.0 so boundary cases read cleanly.
  const v = Object.is(rounded, -0) ? 0 : rounded;
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(decimals)}`;
}

function fmtShortDay(day: string): string {
  return parseLocalDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TrendPoint {
  date: string;
  raw: number;
  trend: number;
}

/** Linear interpolation of the trend weight at `day`, clamped to endpoints. */
function trendAt(points: TrendPoint[], day: string): number | null {
  if (points.length === 0) return null;
  if (day <= points[0].date) return points[0].trend;
  const last = points[points.length - 1];
  if (day >= last.date) return last.trend;
  for (let i = 1; i < points.length; i++) {
    if (points[i].date >= day) {
      const a = points[i - 1];
      const b = points[i];
      const span = localDaysBetweenDays(a.date, b.date);
      if (span === 0) return b.trend;
      const frac = localDaysBetweenDays(a.date, day) / span;
      return a.trend + frac * (b.trend - a.trend);
    }
  }
  return last.trend;
}

/**
 * Weekly weight rate (lb/wk) over the trailing `windowDays` ending at `end`:
 * the least-squares slope of the raw weigh-ins inside the window — the same
 * estimator the weight chart shows, so the verdict card can never contradict
 * the chart the user is looking at. The window is clamped to `phaseStart` AND
 * to the first actual weigh-in, and `spanDays` reports the real data span
 * used (a 30d window with 22 days of weigh-ins reads "over 22d", not "over
 * 30d"). Null when the usable span is too short to call a weekly rate.
 *
 * Deliberately NOT the difference of EWMA trend endpoints: after a step
 * change (e.g. the glycogen/water jump in a bulk's first week) the EWMA lags
 * for weeks, and its catch-up bleeds into every later window — a 14d window
 * would read "hot" long after the actual last-14-days slope is on target.
 */
function rateOverTrailing(
  points: TrendPoint[],
  end: string,
  windowDays: number,
  phaseStart: string
): { rate: number; spanDays: number } | null {
  if (points.length === 0) return null;
  const winStart = maxDay(maxDay(phaseStart, addLocalDays(end, -windowDays)), points[0].date);
  const inWin = points.filter((p) => p.date >= winStart && p.date <= end);
  if (inWin.length < 2) return null;
  const first = inWin[0];
  const spanDays = localDaysBetweenDays(first.date, inWin[inWin.length - 1].date);
  if (spanDays < MIN_RATE_SPAN_DAYS) return null;
  // Canonical robust slope (services/shared/trend): Theil–Sen over elapsed
  // days, single corrupt weigh-ins MAD-excluded. Discontinuity segmentation
  // is off — within a phase window a persistent weight step IS the signal.
  const result = computeTrend(
    inWin.map((p) => ({ date: p.date, value: p.raw })),
    {
      minPoints: 2,
      detectDiscontinuity: false,
      lowConfidenceSpanDays: 0,
      lowConfidenceGapDays: Number.POSITIVE_INFINITY,
      label: 'phaseAssessment',
    }
  );
  if (result.confidence === 'insufficient') return null;
  return { rate: result.slopePerWeek, spanDays };
}

/** DEXA scans inside [start, end], sorted ascending by scan date. */
export function scansInPhase(scans: DexaScan[], start: string, end: string): DexaScan[] {
  return scans
    .filter((s) => {
      const day = s.scanDate.slice(0, 10);
      return day >= start && day <= end;
    })
    .sort((a, b) => a.scanDate.localeCompare(b.scanDate));
}

interface WaistTrend {
  firstDay: string;
  lastDay: string;
  deltaIn: number;
  ratePerMonth: number;
}

/** In-phase waist trend from first to last entry; null below 14 days of span. */
function waistTrendInPhase(
  waist: WaistEntry[] | undefined,
  start: string,
  end: string
): WaistTrend | null {
  if (!waist || waist.length === 0) return null;
  const inPhase = waist
    .filter((w) => w.day >= start && w.day <= end)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (inPhase.length < 2) return null;
  const first = inPhase[0];
  const last = inPhase[inPhase.length - 1];
  const spanDays = localDaysBetweenDays(first.day, last.day);
  if (spanDays < 14) return null;
  const deltaIn = last.waistIn - first.waistIn;
  return {
    firstDay: first.day,
    lastDay: last.day,
    deltaIn,
    ratePerMonth: (deltaIn / spanDays) * DAYS_PER_MONTH,
  };
}

/** Escalation order — a status may only ever move toward off_track. */
const SEVERITY: Record<'on_track' | 'attention' | 'off_track', number> = {
  on_track: 0,
  attention: 1,
  off_track: 2,
};

function escalate(
  current: 'on_track' | 'attention' | 'off_track',
  next: 'on_track' | 'attention' | 'off_track'
): 'on_track' | 'attention' | 'off_track' {
  return SEVERITY[next] > SEVERITY[current] ? next : current;
}

// === MAIN ENTRY ===

export function assessProgress(input: AssessProgressInput): Assessment {
  const { phase, today } = input;

  if (!phase) {
    return {
      status: 'no_phase',
      headline: 'No active phase set. Set one to get phase-aware progress checks.',
      details: [],
    };
  }

  const start = phase.startDay;
  // Assessment normally runs on the active phase (endDay null); clamp anyway
  // so a just-ended phase reads its own span, not days after it.
  const end = phase.endDay && phase.endDay < today ? phase.endDay : today;
  const week = Math.floor(localDaysBetweenDays(start, end) / 7) + 1;
  const label = PHASE_LABEL[phase.phaseType];
  const prefix = `${label}, week ${week}`;

  // In-phase weigh-ins only — a trend must never cross the phase boundary.
  const weighIns = input.weighIns
    .filter((w) => {
      const day = w.date.slice(0, 10);
      return w.weightLb > 0 && day >= start && day <= end;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const windowStart = addLocalDays(end, -(WEIGH_IN_WINDOW_DAYS - 1));
  const recentCount = weighIns.filter((w) => w.date.slice(0, 10) >= windowStart).length;
  if (recentCount < MIN_WEIGH_INS) {
    return {
      status: 'insufficient_data',
      headline: `${prefix}: not enough weigh-ins to assess`,
      details: [
        {
          metric: 'Weigh-ins',
          text: `${recentCount} in-phase weigh-in${recentCount === 1 ? '' : 's'} in the last ${WEIGH_IN_WINDOW_DAYS} days; ${MIN_WEIGH_INS} needed for a trend.`,
        },
      ],
    };
  }

  const trendPoints = computeTrendWeights(weighIns) as TrendPoint[];
  const trendNow = trendPoints[trendPoints.length - 1].trend;
  const rate30 = rateOverTrailing(trendPoints, end, 30, start);
  const rate14 = rateOverTrailing(trendPoints, end, 14, start);

  if (!rate30) {
    // Enough weigh-ins but they span under a week (phase just started, or
    // the user only recently began weighing in).
    return {
      status: 'insufficient_data',
      headline: `${prefix}: too new to assess`,
      details: [
        {
          metric: 'Span',
          text: `Phase started ${fmtShortDay(start)}; a weekly rate needs weigh-ins spanning at least ${MIN_RATE_SPAN_DAYS} in-phase days.`,
        },
      ],
    };
  }

  const phaseScans = scansInPhase(input.scans, start, end);
  const waist = waistTrendInPhase(input.waist, start, end);

  if (phase.phaseType === 'bulk' || phase.phaseType === 'cut') {
    return assessRatePhase(phase.phaseType, {
      prefix,
      trendNow,
      target: phase.targetRateLbsPerWeek ?? DEFAULT_TARGET_LB_PER_WK[phase.phaseType],
      rate30,
      rate14,
      phaseScans,
      waist,
    });
  }

  return assessSteadyPhase(phase.phaseType, {
    prefix,
    start,
    trendPoints,
    trendNow,
    phaseScans,
    waist,
  });
}

// === BULK / CUT ===

interface RatePhaseData {
  prefix: string;
  trendNow: number;
  target: number;
  rate30: { rate: number; spanDays: number };
  rate14: { rate: number; spanDays: number } | null;
  phaseScans: DexaScan[];
  waist: WaistTrend | null;
}

function assessRatePhase(kind: 'bulk' | 'cut', data: RatePhaseData): Assessment {
  const { prefix, trendNow, target, rate30, rate14, phaseScans, waist } = data;
  const details: AssessmentDetail[] = [];
  let status: 'on_track' | 'attention' | 'off_track' = 'on_track';
  let verb: string;
  let suggestion: string | undefined;

  const diff30 = rate30.rate - target;
  const diff14 = rate14 ? rate14.rate - target : null;

  details.push({
    metric: 'Rate',
    text: `Trend ${fmtSigned(rate30.rate)} lb/wk vs ${fmtSigned(target)} target over ${rate30.spanDays}d.`,
  });

  if (Math.abs(diff30) <= RATE_TOLERANCE_LB_PER_WK + EPS) {
    verb = kind === 'bulk' ? 'gaining on target' : 'losing on target';
  } else if (kind === 'bulk' ? diff30 > 0 : diff30 < 0) {
    // Bulk over target / cut under (more negative than) target: too fast.
    status = 'attention';
    verb = kind === 'bulk' ? 'gaining faster than target' : 'losing faster than target';
    // Only suggest a calorie change when the overshoot holds across BOTH the
    // 14d and 30d windows — a one-window spike is noise.
    const persists =
      diff14 != null &&
      (kind === 'bulk'
        ? diff14 > RATE_TOLERANCE_LB_PER_WK + EPS
        : diff14 < -RATE_TOLERANCE_LB_PER_WK - EPS);
    if (persists) {
      suggestion =
        kind === 'bulk'
          ? 'Reduce intake by 100-200 cal; the overshoot holds across both 14d and 30d windows.'
          : 'Add 100-200 cal; the overshoot holds across both 14d and 30d windows.';
    }
  } else {
    status = 'attention';
    verb = kind === 'bulk' ? 'gaining slower than target' : 'losing slower than target';
  }

  // Cut hard ceiling: faster than 1.5% BW/wk is off-track regardless of target.
  if (kind === 'cut' && trendNow > 0) {
    const pctPerWk = (rate30.rate / trendNow) * 100;
    if (pctPerWk < -(CUT_MAX_PCT_BW_PER_WK + EPS)) {
      status = 'off_track';
      verb = 'losing too fast';
      details.push({
        metric: 'Pace',
        text: `${fmtSigned(pctPerWk)}%/wk of bodyweight; the ceiling is -${CUT_MAX_PCT_BW_PER_WK}%/wk.`,
      });
    }
  }

  // DEXA partition rules need >= 2 in-phase scans.
  if (phaseScans.length >= 2) {
    const first = phaseScans[0];
    const last = phaseScans[phaseScans.length - 1];
    const leanLb = (last.leanMassKg - first.leanMassKg) * KG_TO_LB;
    const fatLb = (last.fatMassKg - first.fatMassKg) * KG_TO_LB;
    const totalLb = leanLb + fatLb;
    const span = `${fmtShortDay(first.scanDate.slice(0, 10))} to ${fmtShortDay(last.scanDate.slice(0, 10))}`;

    if (kind === 'bulk') {
      if (leanLb < 0) {
        // Negative in-phase lean: scan-conditions caveat BEFORE diet advice.
        status = escalate(status, 'attention');
        details.push({
          metric: 'Lean mass',
          text: `Lean ${fmtSigned(leanLb)} lb across ${phaseScans.length} scans (${span}). Check scan conditions (hydration, time of day) before changing diet.`,
        });
        suggestion = 'Recheck scan conditions (hydration, time of day) before changing your diet.';
      } else if (totalLb > 0) {
        const leanShare = leanLb / totalLb;
        if (leanShare < BULK_LEAN_SHARE_FLOOR) {
          status = escalate(status, 'attention');
          details.push({
            metric: 'Partition',
            text: `Lean is ${Math.round(leanShare * 100)}% of ${fmtSigned(totalLb)} lb gained (${span}); target is 30%+.`,
          });
          if (waist && waist.ratePerMonth > WAIST_RATE_LIMIT_IN_PER_MONTH + EPS) {
            status = 'off_track';
          }
        }
      }
    } else {
      // Cut: lean loss share of total loss.
      if (totalLb < 0 && leanLb < 0 && Math.abs(leanLb) > CUT_LEAN_LOSS_SHARE * Math.abs(totalLb) + EPS) {
        status = escalate(status, 'attention');
        details.push({
          metric: 'Lean mass',
          text: `Lean ${fmtSigned(leanLb)} lb of ${fmtSigned(totalLb)} lb lost (${span}); over ${Math.round(CUT_LEAN_LOSS_SHARE * 100)}% of the loss.`,
        });
        if (!suggestion) {
          suggestion = 'Check protein intake and training volume.';
        }
      }
    }
  }

  if (waist) {
    details.push({
      metric: 'Waist',
      text: `Waist ${fmtSigned(waist.deltaIn)} in since ${fmtShortDay(waist.firstDay)}.`,
    });
  }

  return {
    status,
    headline: `${prefix}: ${verb}`,
    details: details.slice(0, 4),
    ...(suggestion ? { suggestion } : {}),
  };
}

// === RECOMP / MAINTENANCE ===

interface SteadyPhaseData {
  prefix: string;
  start: string;
  trendPoints: TrendPoint[];
  trendNow: number;
  phaseScans: DexaScan[];
  waist: WaistTrend | null;
}

function assessSteadyPhase(kind: 'recomp' | 'maintenance', data: SteadyPhaseData): Assessment {
  const { prefix, start, trendPoints, trendNow, phaseScans, waist } = data;
  const details: AssessmentDetail[] = [];

  const startWeight = trendAt(trendPoints, start) ?? trendPoints[0].trend;
  const driftPct = startWeight > 0 ? ((trendNow - startWeight) / startWeight) * 100 : 0;
  const weightStable = Math.abs(driftPct) <= MAINTENANCE_DRIFT_PCT + EPS;

  let status: 'on_track' | 'attention' = weightStable ? 'on_track' : 'attention';

  details.push({
    metric: 'Weight',
    text: `Trend ${trendNow.toFixed(1)} lb, ${fmtSigned(driftPct)}% vs phase start (${startWeight.toFixed(1)} lb).`,
  });

  let compSignal: 'good' | 'bad' | null = null;

  if (waist) {
    details.push({
      metric: 'Waist',
      text: `Waist ${fmtSigned(waist.deltaIn)} in since ${fmtShortDay(waist.firstDay)}.`,
    });
    if (waist.ratePerMonth > WAIST_RATE_LIMIT_IN_PER_MONTH + EPS) {
      compSignal = 'bad';
      status = 'attention';
    } else if (waist.deltaIn < 0) {
      compSignal = 'good';
    }
  }

  if (phaseScans.length >= 2) {
    const first = phaseScans[0];
    const last = phaseScans[phaseScans.length - 1];
    const leanLb = (last.leanMassKg - first.leanMassKg) * KG_TO_LB;
    const fatLb = (last.fatMassKg - first.fatMassKg) * KG_TO_LB;
    details.push({
      metric: 'DEXA',
      text: `Lean ${fmtSigned(leanLb)} lb, fat ${fmtSigned(fatLb)} lb across ${phaseScans.length} scans.`,
    });
    if (leanLb > 0 && fatLb < 0) {
      compSignal = 'good';
    } else if (fatLb > 0 && leanLb <= 0) {
      compSignal = 'bad';
      status = 'attention';
    }
  }

  // Honest headline: recomp is slow to detect — say so instead of
  // manufacturing a verdict when there's no waist/DEXA signal yet.
  let verdict: string;
  if (compSignal === 'good') {
    verdict = waist && waist.deltaIn < 0 ? 'waist trending down' : 'composition trending the right way';
  } else if (compSignal === 'bad') {
    verdict = waist && waist.ratePerMonth > WAIST_RATE_LIMIT_IN_PER_MONTH ? 'waist trending up' : 'composition trending the wrong way';
  } else if (kind === 'recomp') {
    verdict = weightStable
      ? 'weight steady; recomp is slow to detect, no verdict yet'
      : `weight drifting ${driftPct > 0 ? 'up' : 'down'}`;
  } else {
    verdict = weightStable ? 'holding steady' : `weight drifting ${driftPct > 0 ? 'up' : 'down'}`;
  }

  return {
    status,
    headline: `${prefix}: ${verdict}`,
    details: details.slice(0, 4),
  };
}
