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

import type { EarlyLift, LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { nextTrendHint } from '@/components/analytics/liftTrendFormat';
import {
  weighInsInWindow,
  weightTrendLine,
  type WeighInEntry,
} from '@/components/analytics/weightTrend';

/** Same window the weight chart opens on (its default 30d range). */
export const SUMMARY_WEIGHT_WINDOW_DAYS = 30;

export interface ProgressSummaryInput {
  weighIns: readonly WeighInEntry[];
  /** null/undefined = lift trends not known (loading / signed out). */
  liftTrends: LiftTrendsSummary | null | undefined;
  units: 'lb' | 'kg';
  now: Date;
}

export interface ProgressSummary {
  /** e.g. "Weight is down 1.6 lb over the last 30 days." */
  weight: string | null;
  /** e.g. "Over the last 12 weeks, 2 of your 3 tracked lifts are going up and none are slipping." */
  strength: string | null;
}

export function weightSentence(
  weighIns: readonly WeighInEntry[],
  units: 'lb' | 'kg',
  now: Date
): string | null {
  const points = weighInsInWindow(weighIns, units, SUMMARY_WEIGHT_WINDOW_DAYS, now);
  const trend = weightTrendLine(points);
  if (!trend) return null;
  const change = trend.fitEnd - trend.fitStart;
  const amount = Math.abs(change).toFixed(1);
  const span = `over the last ${SUMMARY_WEIGHT_WINDOW_DAYS} days`;
  if ((!trend.isNegative && !trend.isPositive) || amount === '0.0') return `Weight is steady ${span}.`;
  return `Weight is ${change < 0 ? 'down' : 'up'} ${amount} ${units} ${span}.`;
}

export function strengthSentence(summary: LiftTrendsSummary | null | undefined): string | null {
  if (!summary) return null;
  const { rising, flat, down, rebuilding } = summary;
  const confident = rising + flat + down;
  const weeks = Math.round(summary.windowDays / 7);
  const lead = `Over the last ${weeks} weeks,`;

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

  const lifted = summary.lifts.length > 0 || summary.insufficientData > 0 || (summary.earlyLifts?.length ?? 0) > 0;
  if (!lifted) return null;
  const hint = nextTrendHint(summary.earlyLifts);
  // Say what the first workouts already show, so "no trend" isn't an empty
  // answer (the panel compared first and latest sets by hand).
  const early = earlyComparison(summary.earlyLifts);
  const soFar = early
    ? ` So far, ${early.better} of your ${early.compared} lift${early.compared === 1 ? '' : 's'} ${early.compared === 1 ? (early.better === 1 ? 'beats' : "doesn't beat") : early.better === 1 ? 'beats' : 'beat'} ${early.compared === 1 ? 'its' : 'their'} first workout (heavier, or more reps).`
    : '';
  const base = `Not enough lifting data for a strength trend yet.${soFar}`;
  return hint ? `${base} ${hint}` : base;
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

/** Null when there is nothing to say on either side. */
export function buildProgressSummary({ weighIns, liftTrends, units, now }: ProgressSummaryInput): ProgressSummary | null {
  const weight = weightSentence(weighIns, units, now);
  const strength = strengthSentence(liftTrends);
  if (!weight && !strength) return null;
  return { weight, strength };
}
