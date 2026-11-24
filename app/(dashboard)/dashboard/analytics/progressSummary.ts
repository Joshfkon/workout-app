/**
 * "Am I progressing?" — the short plain answer at the top of Progress
 * (pure — no I/O, no React).
 *
 * It only restates numbers the page already computes, never a new verdict:
 *  - weight: the Body tab weight chart's 30-day fitted change (same window,
 *    same fit — components/analytics/weightTrend), so the two never disagree;
 *  - strength: the Strength tab's lift-trend counts (computeLiftTrends),
 *    confident lifts only — calibrating ones carry no verdict.
 * Nothing is said about a side without data: a food-only user gets the
 * weight line alone, never a nudge to lift.
 */

import {
  MIN_SESSIONS_FOR_TREND,
  type EarlyLift,
  type LiftTrend,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { nextTrendHint, risingSlippingNames, setLabel, TREND_RULE } from '@/components/analytics/liftTrendFormat';
import {
  weighInsInWindow,
  weightTrendLine,
  type WeighInEntry,
} from '@/components/analytics/weightTrend';
import {
  CUT_STRENGTH_NOTE,
  isCutGoal,
  SHORT_WEIGHT_RULE,
  shortLiftRule,
} from '@/components/analytics/trendHelp';
import { rangePhrase } from './progressRange';
import type { VolumeRow } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * Fallback weight window when the caller passes none. The page passes its
 * shared range (./progressRange), the same window the lift trends use, so
 * weight and strength are always read over one period.
 */
export const SUMMARY_WEIGHT_WINDOW_DAYS = 30;

export interface ProgressSummaryInput {
  weighIns: readonly WeighInEntry[];
  /** null/undefined = lift trends not known (loading / signed out). */
  liftTrends: LiftTrendsSummary | null | undefined;
  units: 'lb' | 'kg';
  now: Date;
  /**
   * The page's shared range in days (./progressRange). Weight is read over
   * it; strength already is (the lift-trend query is fetched over it).
   */
  windowDays?: number;
  /**
   * This week's sets per muscle (the WeeklySetsCard rows) — null when the
   * line shouldn't show (beginner mode, food-only, no lifting).
   */
  volumeRows?: readonly VolumeRow[] | null;
  /** Completed workouts in the weekly-sets window (useWeeklyVolume.workouts). */
  volumeWorkouts?: number | null;
  /** Sessions a week the active training block plans (null without one). */
  plannedPerWeek?: number | null;
  /**
   * Target weekly weight change in the display unit (negative on a cut):
   * the current phase's own target, else the goal's default. Null = no
   * target (maintenance / no goal): no pace line.
   */
  targetRatePerWeek?: number | null;
  /**
   * The current phase, else users.goal ('cut' / 'bulk' / …). On a cut,
   * lifts holding steady is the result to hope for, and the card says so.
   */
  goal?: string | null;
}

export interface ProgressSummary {
  /** e.g. "Weight is down 1.6 lb over the last 30 days." */
  weight: string | null;
  /**
   * How the weight line was worked out (trendHelp.weightTrendRule); null with
   * no weight line. Shown once, behind the card's info toggle.
   */
  weightMethod: string | null;
  /**
   * What makes a lift rising / flat / down (trendHelp.liftStatusRule); null
   * with no tracked lift. Behind the same info toggle.
   */
  liftMethod: string | null;
  /**
   * The weight line's weekly pace against the target rate, e.g. "That's
   * −0.8 lb a week against your target of −1.0 lb a week: slower than
   * your target." Null without a target or a weight trend.
   */
  weightPace: string | null;
  /** Goal-specific reading of the strength line (on a cut: holding is good); null otherwise. */
  strengthContext: string | null;
  /** e.g. "Over the last 12 weeks, 2 of your 3 tracked lifts are going up and none are slipping." */
  strength: string | null;
  /** Which lifts the strength counts are, by name: "Rising: Bench Press, Squat." Null with nothing rising/slipping. */
  strengthNames: string | null;
  /** Each lift behind the strength sentence (expandable list). */
  lifts: LiftBreakdownRow[];
  /**
   * Weekly sets per muscle vs MEV–MRV in one line, e.g. "Sets per muscle,
   * last 7 days: 6 in range, 2 under the minimum (MEV)." Null without rows.
   */
  volume: string | null;
}

/** One lift in the strength breakdown: first vs latest best set, and its direction. */
export interface LiftBreakdownRow {
  key: string;
  name: string;
  /** Best set of the first workout in the window, e.g. "185 lbs × 8". */
  then: string;
  /** Best set of the latest workout, same format. */
  now: string;
  /** "Going up" / "Holding steady" / "Slipping" / "Rebuilding" / "Up so far" / "Too early to tell". */
  direction: string;
  tone: 'up' | 'flat' | 'down' | 'neutral';
}

const DIRECTION_WORDS: Record<LiftTrend['direction'], { label: string; tone: LiftBreakdownRow['tone'] }> = {
  rising: { label: 'Going up', tone: 'up' },
  flat: { label: 'Holding steady', tone: 'flat' },
  down: { label: 'Slipping', tone: 'down' },
};

/**
 * The lifts behind the strength sentence, one row each: the best set
 * (highest estimated max) of the first and of the latest workout in the
 * window — real weight × reps as logged — and the direction the Strength tab
 * gives it. Trended lifts first (same order as the Strength tab), then lifts
 * with 2+ workouts but no trend yet. Only data the summary already holds.
 */
export function liftBreakdown(
  summary: LiftTrendsSummary | null | undefined,
  units: 'lb' | 'kg'
): LiftBreakdownRow[] {
  if (!summary) return [];
  const rows: LiftBreakdownRow[] = [];
  for (const lift of summary.lifts) {
    const first = lift.history[0];
    const last = lift.history[lift.history.length - 1];
    if (!first || !last) continue;
    const verdict = lift.lowConfidence
      ? { label: 'Rebuilding', tone: 'neutral' as const }
      : DIRECTION_WORDS[lift.direction];
    rows.push({
      key: lift.seriesKey,
      name: lift.locationLabel ? `${lift.name} (${lift.locationLabel})` : lift.name,
      then: setLabel(first.topSetWeightKg, first.topSetReps, units),
      now: setLabel(last.topSetWeightKg, last.topSetReps, units),
      direction: verdict.label,
      tone: verdict.tone,
    });
  }
  for (const early of summary.earlyLifts ?? []) {
    const { firstWeightKg: fw, firstReps: fr, latestWeightKg: lw, latestReps: lr } = early;
    if (early.sessions < 2 || fw == null || fr == null || lw == null || lr == null) continue;
    const better = earlyComparison([early])?.better === 1;
    rows.push({
      key: `early:${early.name}`,
      name: early.name,
      then: setLabel(fw, fr, units),
      now: setLabel(lw, lr, units),
      direction: better ? 'Up so far' : 'Too early to tell',
      tone: better ? 'up' : 'neutral',
    });
  }
  return rows;
}

export function weightSentence(
  weighIns: readonly WeighInEntry[],
  units: 'lb' | 'kg',
  now: Date,
  windowDays: number = SUMMARY_WEIGHT_WINDOW_DAYS
): string | null {
  const points = weighInsInWindow(weighIns, units, windowDays, now);
  const trend = weightTrendLine(points);
  if (!trend) return null;
  const change = trend.fitEnd - trend.fitStart;
  const amount = Math.abs(change).toFixed(1);
  const span = rangePhrase(windowDays);
  if ((!trend.isNegative && !trend.isPositive) || amount === '0.0') return `Weight is steady ${span}.`;
  return `Weight is ${change < 0 ? 'down' : 'up'} ${amount} ${units} ${span}.`;
}

export function strengthSentence(summary: LiftTrendsSummary | null | undefined): string | null {
  if (!summary) return null;
  const { rising, flat, down, rebuilding } = summary;
  const confident = rising + flat + down;
  const phrase = rangePhrase(summary.windowDays);
  const lead = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)},`;

  if (confident > 0) {
    if (confident === 1) {
      const verdict = rising === 1 ? 'going up' : down === 1 ? 'slipping' : 'holding steady';
      return `${lead} your tracked lift is ${verdict}.`;
    }
    if (down === 0) {
      if (rising === confident) return `${lead} all ${confident} of your tracked lifts are going up.`;
      if (rising > 0) {
        return `${lead} ${rising} of your ${confident} tracked lifts ${rising === 1 ? 'is' : 'are'} going up and none are slipping.`;
      }
      return `${lead} your ${confident} tracked lifts are holding steady.`;
    }
    const slipping = `${down} of your ${confident} tracked lifts ${down === 1 ? 'is' : 'are'} slipping`;
    return rising > 0 ? `${lead} ${slipping} and ${rising} ${rising === 1 ? 'is' : 'are'} going up.` : `${lead} ${slipping}.`;
  }

  if (rebuilding > 0) {
    return "Your lift trends are rebuilding after a recent change, so there's no strength verdict yet.";
  }

  // Enough workouts, but too close together (or too few usable) for a real
  // rate: say what's missing rather than a verdict built on a 0.0%.
  if ((summary.tooEarly ?? 0) > 0) {
    return `Not enough data for a strength trend yet. ${TREND_RULE}`;
  }

  const lifted = summary.lifts.length > 0 || summary.insufficientData > 0 || (summary.earlyLifts?.length ?? 0) > 0;
  if (!lifted) return null;
  const hint = nextTrendHint(summary.earlyLifts);
  // Say what the first workouts already show, so "no trend" isn't an empty
  // answer (the panel compared first and latest sets by hand).
  const early = earlyComparison(summary.earlyLifts);
  const soFar = early
    ? ` So far, ${early.better} of your ${early.compared} lift${early.compared === 1 ? '' : 's'} ${early.compared === 1 ? (early.better === 1 ? 'beats' : "doesn't beat") : early.better === 1 ? 'beats' : 'beat'} ${early.compared === 1 ? 'its' : 'their'} first workout (heavier, or more reps).`
    : '';
  // Name what is needed in the user's terms (the lift, how many more times),
  // not "not enough data for a strength trend" (UX panel: vague, jargony).
  const lead2 = hint ?? `Do the same lift in ${MIN_SESSIONS_FOR_TREND} separate workouts to see if it's going up.`;
  return `${lead2}${soFar}`;
}

/**
 * Before any trend exists: how many lifts done twice or more beat their
 * first workout's top set — heavier, or the same weight for more reps. A
 * heavier-but-fewer-reps set counts as neither (no estimate is made here).
 * Null when no lift has two comparable workouts.
 */
export function earlyComparison(lifts: readonly EarlyLift[] | undefined): { better: number; compared: number } | null {
  let better = 0;
  let compared = 0;
  for (const l of lifts ?? []) {
    const { firstWeightKg: fw, firstReps: fr, latestWeightKg: lw, latestReps: lr } = l;
    if (l.sessions < 2 || fw == null || fr == null || lw == null || lr == null) continue;
    compared += 1;
    const sameLoad = Math.abs(lw - fw) < 0.01;
    if (lw > fw + 0.01 && lr >= fr) better += 1;
    else if (sameLoad && lr > fr) better += 1;
  }
  return compared > 0 ? { better, compared } : null;
}

/**
 * Weekly sets per muscle against MEV–MRV in one plain line for the summary
 * card, so an advanced lifter sees volume where he looks first (UX panel
 * r21, Vince: "No weekly sets per muscle against MEV/MRV on the Progress
 * screen"). Same rows and zones as the WeeklySetsCard it links to. Null
 * when no muscle has a set in the window (a line of zeros says nothing).
 */
export function volumeSentence(
  rows: readonly VolumeRow[] | null | undefined,
  workouts?: number | null,
  plannedPerWeek?: number | null
): string | null {
  if (!rows) return null;
  const coarse = rows.filter((r) => !r.isChild);
  if (!coarse.some((r) => r.sets > 0)) return null;
  const inRange = coarse.filter((r) => r.zone === 'in_zone' && r.sets > 0).length;
  const below = coarse.filter((r) => r.zone === 'below_mev' && r.warnable).length;
  const over = coarse.filter((r) => r.zone === 'over_mrv').length;
  const parts = [
    `${inRange} ${inRange === 1 ? 'muscle' : 'muscles'} in range`,
    below > 0 ? `${below} under the minimum (MEV)` : null,
    over > 0 ? `${over} over the max (MRV)` : null,
  ].filter(Boolean);
  // Say how many workouts the window holds (and what the plan has): "all
  // under MEV" after 2 workouts is the window, not a miscount (UX panel r22).
  const context =
    workouts != null
      ? ` (${workouts} workout${workouts === 1 ? '' : 's'}${plannedPerWeek && plannedPerWeek > 0 ? `; your plan has ${plannedPerWeek} a week` : ''})`
      : '';
  return `Sets per muscle, last 7 days${context}: ${parts.join(', ')}.`;
}

const MINUS = '\u2212';
function signedRate(n: number): string {
  const v = Math.abs(n).toFixed(1);
  return v === '0.0' ? '0.0' : `${n < 0 ? MINUS : '+'}${v}`;
}

/**
 * The weight trend's weekly rate against the target rate for a cut or a
 * bulk (UX panel r22, Dre: "a 2.4 lb loss over 12 weeks with no context for
 * cut pace or target rate"). Same fitted line as the weight sentence, so the
 * two can't disagree. "On pace" within ±0.25 lb (0.1 kg) a week, the
 * phase assessment's on-track band.
 */
export function weightPaceSentence(
  weighIns: readonly WeighInEntry[],
  units: 'lb' | 'kg',
  now: Date,
  windowDays: number,
  target: number | null | undefined
): string | null {
  if (target == null || !Number.isFinite(target) || target === 0) return null;
  const trend = weightTrendLine(weighInsInWindow(weighIns, units, windowDays, now));
  if (!trend) return null;
  const rate = trend.perWeek;
  const band = units === 'lb' ? 0.25 : 0.1;
  const verdict =
    Math.abs(rate - target) <= band
      ? 'on pace'
      : Math.sign(rate) !== Math.sign(target) || Math.abs(rate) < Math.abs(target)
        ? 'slower than your target'
        : 'faster than your target';
  return `That's ${signedRate(rate)} ${units} a week against your target of ${signedRate(target)} ${units} a week: ${verdict}.`;
}

/** Null when there is nothing to say on any side. */
export function buildProgressSummary({
  weighIns,
  liftTrends,
  units,
  now,
  windowDays = SUMMARY_WEIGHT_WINDOW_DAYS,
  volumeRows,
  volumeWorkouts,
  plannedPerWeek,
  targetRatePerWeek,
  goal,
}: ProgressSummaryInput): ProgressSummary | null {
  const weight = weightSentence(weighIns, units, now, windowDays);
  const weightPace = weight ? weightPaceSentence(weighIns, units, now, windowDays, targetRatePerWeek) : null;
  const strength = strengthSentence(liftTrends);
  const volume = volumeSentence(volumeRows, volumeWorkouts, plannedPerWeek);
  if (!weight && !strength && !volume) return null;
  const weightMethod = weight ? SHORT_WEIGHT_RULE : null;
  const strengthNames = strength && liftTrends ? risingSlippingNames(liftTrends.lifts) : null;
  const tracked = liftTrends && strength ? liftTrends.lifts.length > 0 : false;
  const confident = liftTrends ? liftTrends.rising + liftTrends.flat + liftTrends.down : 0;
  return {
    weight,
    weightPace,
    weightMethod,
    liftMethod: tracked ? shortLiftRule(units) : null,
    strength,
    strengthContext: strength && confident > 0 && isCutGoal(goal) ? CUT_STRENGTH_NOTE : null,
    strengthNames,
    lifts: strength ? liftBreakdown(liftTrends, units) : [],
    volume,
  };
}
