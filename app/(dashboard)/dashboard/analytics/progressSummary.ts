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

import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
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
  return hint ? `Not enough lifting data for a strength trend yet. ${hint}` : 'Not enough lifting data for a strength trend yet.';
}

/** Null when there is nothing to say on either side. */
export function buildProgressSummary({ weighIns, liftTrends, units, now }: ProgressSummaryInput): ProgressSummary | null {
  const weight = weightSentence(weighIns, units, now);
  const strength = strengthSentence(liftTrends);
  if (!weight && !strength) return null;
  return { weight, strength };
}
