/**
 * volumeProjection — the rolling 7-day volume DECAY forecast.
 *
 * The weekly volume every surface shows is a trailing 7-local-day window, so a
 * muscle's number doesn't just grow as you train — it falls as sessions age out
 * of the window. This module answers "when will it fall off?": it buckets the
 * SAME credited group sets the coarse rows count by local day, then projects
 * the rolling total forward assuming no further training, so the UI can show
 * the day a muscle slips below its zone floor.
 *
 * Crediting goes through the canonical per-set math (services/shared/
 * volumeCredit — weighted primary split, 0.5 secondary, within-group cap), so
 * the projection's day-0 value always reconciles with the coarse row header it
 * renders under. Day bucketing goes through lib/date/localDay, so "a day"
 * means the same local calendar day as the window's own lower bound.
 *
 * Pure functions — no React, no Supabase. `now` is a defaulted parameter per
 * the @/lib/clock convention.
 */

import { now as clockNow } from '@/lib/clock';
import { localDaysBetween } from '@/lib/date/localDay';
import { perSetGroupCredits } from '@/services/shared/volumeCredit';
import type { CoarseMuscle } from '@/services/volumeBands';

/** Window length of the rolling weekly-volume count (trailing local days,
 *  including today) — must match WEEKLY_VOLUME_WINDOW_DAYS in the shared
 *  weekly-volume pipeline. */
export const ROLLING_WINDOW_DAYS = 7;

/** How many future days the forecast projects. At +7 every currently-counted
 *  set has aged out of a 7-day window, so the projection always reaches its
 *  no-training floor of 0 — the horizon and the window move together. */
export const FORECAST_HORIZON_DAYS = 7;

/** One dated exercise block: when it was completed, its muscle tags, and how
 *  many WORKING sets it contained (warm-ups excluded by the caller). */
export interface DatedVolumeBlock {
  /** Completion timestamp (ISO). Null/invalid rows are skipped. */
  completedAt: string | null;
  primaryMuscle: string | null;
  secondaryMuscles: string[];
  workingSets: number;
}

/**
 * Credited group sets per local day, keyed by coarse muscle. Each array has
 * ROLLING_WINDOW_DAYS entries indexed by DAYS AGO: [0] = today, [1] =
 * yesterday, … [6] = the oldest day still inside the window. Full precision —
 * rounding happens once, when a projection is emitted.
 */
export type DailyGroupSets = Partial<Record<CoarseMuscle, number[]>>;

// Round once at emission, drift-guarded like the shared pipeline: thirds and
// halves of credit accumulate IEEE-754 dust that would otherwise round the
// wrong way (23.499999999999996 for a true 23.5).
const ROUNDING_EPSILON = 1e-9;
const round1 = (value: number): number => Math.round((value + ROUNDING_EPSILON) * 10) / 10;

/**
 * Bucket dated blocks into per-day credited group sets. Uses the SAME capped
 * per-set group credit as the coarse row totals, so summing a muscle's daily
 * buckets reproduces its row header (every set of a block carries the same
 * tags, so per-set capping and the row model's per-segment scaling are exactly
 * equivalent — see groupCapScale in services/shared/volumeCredit).
 */
export function computeDailyGroupSets(
  blocks: readonly DatedVolumeBlock[],
  now: Date = clockNow()
): DailyGroupSets {
  const out: DailyGroupSets = {};
  for (const block of blocks) {
    if (!block.completedAt || !block.primaryMuscle || block.workingSets <= 0) continue;
    const completed = new Date(block.completedAt);
    if (Number.isNaN(completed.getTime())) continue;
    const daysAgo = localDaysBetween(completed, now);
    if (daysAgo < 0 || daysAgo >= ROLLING_WINDOW_DAYS) continue;
    for (const { group, credit } of perSetGroupCredits(
      block.primaryMuscle,
      block.secondaryMuscles
    )) {
      const days = out[group] ?? (out[group] = new Array<number>(ROLLING_WINDOW_DAYS).fill(0));
      days[daysAgo] += block.workingSets * credit;
    }
  }
  return out;
}

/**
 * Project a muscle's rolling window forward assuming NO further training:
 * entry [d] is the rolling total at the end of local day today+d, i.e. the sum
 * of the daily buckets still inside that day's trailing window ([0] is the
 * current total). Each future day, the oldest bucket ages out — the projection
 * is monotonically non-increasing and reaches 0 at the horizon. Values are
 * rounded to one decimal at emission, matching the row headers.
 */
export function projectRollingSets(
  daily: readonly number[],
  horizonDays: number = FORECAST_HORIZON_DAYS
): number[] {
  const projection: number[] = [];
  for (let d = 0; d <= horizonDays; d++) {
    let total = 0;
    // On future day +d the window covers local days [d-6, d]; a bucket at
    // `daysAgo` is still inside it while daysAgo ≤ (window-1) − d.
    const oldestCounted = ROLLING_WINDOW_DAYS - 1 - d;
    for (let daysAgo = 0; daysAgo <= Math.min(oldestCounted, daily.length - 1); daysAgo++) {
      total += daily[daysAgo] ?? 0;
    }
    projection.push(round1(total));
  }
  return projection;
}

/**
 * First day offset at which the projection sits below `threshold` (0 = already
 * below today), or null if it never does within the horizon. Feed it a
 * projection and a band's MEV to caption "falls below the zone floor on …".
 */
export function firstDayBelow(
  projection: readonly number[],
  threshold: number
): number | null {
  for (let d = 0; d < projection.length; d++) {
    if (projection[d] < threshold) return d;
  }
  return null;
}
