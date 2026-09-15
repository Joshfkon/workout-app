/**
 * readinessPreview — the "look ahead" projection of the readiness rows: the
 * SAME row model as readiness.ts, evaluated N hours into the future (the
 * strip's time slider). Pure, like its sibling: no React, no store, no
 * Supabase.
 */

import {
  computeMuscleRecovery,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoverySession,
} from '@/services/muscleRecovery';
import { localDaysBetween } from '@/lib/date/localDay';
import { volumeZone } from '../../../_lib/weeklyVolume';
import {
  projectRollingSets,
  type DailyGroupSets,
  type DailyStandardSets,
} from '@/services/volumeProjection';
import {
  coarseRecovery,
  compareByActionability,
  RECOVERED_FACTOR,
  RECOVERY_RANK,
  volumeStatusForZone,
  type ReadinessChild,
  type ReadinessRow,
} from './readiness';

/**
 * How far the preview slider reaches (3 days). Covers essentially every
 * recovery window the heuristic produces, and up to three window steps of
 * rolling-volume decay — well inside the projection horizon.
 */
export const PREVIEW_MAX_HOURS = 72;

/** The instant `hoursAhead` hours from `now` — exact elapsed time, which is
 *  what the hour-based recovery heuristic wants. Calendar-day semantics (for
 *  the volume window) are derived from this instant via localDaysBetween, so
 *  a DST change shifts the midnight crossing, never the elapsed hours. */
export function futureInstant(now: Date, hoursAhead: number): Date {
  return new Date(now.getTime() + hoursAhead * 3600_000);
}

/**
 * Project today's readiness rows `hoursAhead` hours forward — the data behind
 * the strip's time slider. NOT a parallel model:
 *
 *  - VOLUME is the existing rolling-decay projection (projectRollingSets over
 *    the same per-day buckets the forecast panel renders), assuming nothing
 *    new is logged. The day offset is how many LOCAL midnights the slider
 *    position crosses (localDaysBetween), so within today the counts hold
 *    steady and each crossed midnight ages the oldest counted day out of the
 *    7-day window. Coarse rows project from the capped group buckets, fine
 *    children from the per-head standard buckets — the same pairing as the
 *    live rows.
 *  - RECOVERY is the same pure heuristic re-evaluated at the future instant
 *    (computeMuscleRecovery takes an injected `now`), so it advances by the
 *    hour; history is completed sessions only, all of which remain valid
 *    ahead of time.
 *
 * Zone, gap, score, lagging-children demotion and ordering all re-derive
 * through the shared rules, so the preview reads exactly like the live view.
 * At `hoursAhead` 0 the volume reproduces today's row headers exactly
 * (projection day 0 reconciles by construction).
 *
 * Deliberate divergences from the live rows:
 *  - Soreness overrides do NOT apply — they are same-day subjective reports
 *    ("still sore TODAY"); ahead of now the time model speaks for itself.
 *  - `exercises` is emptied on rows and children: the drill-down amounts are
 *    today's window shares, and re-attributing a future decayed total per
 *    exercise is data we don't compute — so the preview shows no breakdown
 *    rather than a wrong one (the list renders no detail panel for them).
 */
export function buildFutureReadinessRows(
  rows: ReadinessRow[],
  dailyGroupSets: DailyGroupSets,
  dailyStandardSets: DailyStandardSets,
  history: RecoverySession[],
  now: Date,
  hoursAhead: number,
  config: RecoveryConfig = RECOVERY_CONFIG
): ReadinessRow[] {
  const future = futureInstant(now, hoursAhead);
  const dayOffset = Math.max(0, localDaysBetween(now, future));
  // Rolling total at the end of the target local day (rounded at emission
  // like the row headers); an absent bucket means nothing in the window → 0.
  const setsAt = (daily: readonly number[] | undefined): number =>
    daily ? projectRollingSets(daily, dayOffset)[dayOffset] : 0;

  const preview = rows.map((row): ReadinessRow => {
    const sets = setsAt(dailyGroupSets[row.muscle]);
    const zone = volumeZone(sets, row.band);
    const recovery = coarseRecovery(row.muscle, history, future, config);
    const volumeGap = Math.max(0, row.band.mev - sets);

    const children: ReadinessChild[] = row.children.map((child) => {
      const childSets = setsAt(dailyStandardSets[child.muscle]);
      return {
        ...child,
        sets: childSets,
        zone: volumeZone(childSets, child.band),
        belowMev: childSets < child.band.mev,
        volumeGap: Math.max(0, child.band.mev - childSets),
        recovery: computeMuscleRecovery(history, child.muscle, future, config),
        exercises: [],
      };
    });

    // Same divergence rule as buildReadinessRows, over the future statuses.
    const autoExpand = children.some(
      (c) =>
        c.recovery.lastTrainedAt !== null &&
        RECOVERY_RANK[recovery.status] - RECOVERY_RANK[c.recovery.status] >= 1
    );

    return {
      ...row,
      sets,
      zone,
      belowMev: sets < row.band.mev,
      laggingChildren: children.some((c) => c.reachable && c.belowMev),
      volumeGap,
      volumeStatus: volumeStatusForZone(zone),
      recovery,
      score: volumeGap * RECOVERED_FACTOR[recovery.status],
      children,
      exercises: [],
      autoExpand,
    };
  });

  return preview.sort(compareByActionability);
}
