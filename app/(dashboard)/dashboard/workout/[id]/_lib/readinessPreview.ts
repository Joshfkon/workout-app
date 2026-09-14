/**
 * readinessPreview — the "preview tomorrow" projection of the readiness rows:
 * the SAME row model as readiness.ts, one local day ahead. Pure, like its
 * sibling: no React, no store, no Supabase.
 */

import {
  computeMuscleRecovery,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoverySession,
} from '@/services/muscleRecovery';
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
 * The same wall-clock time on the NEXT local calendar day. A calendar-day
 * move, deliberately not +24h — those differ by an hour across a DST change
 * and the volume projection buckets by local calendar day (see lib/clock).
 */
export function nextLocalDaySameTime(now: Date): Date {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
}

/**
 * Project today's readiness rows one local day forward — the "preview
 * tomorrow" toggle's data. NOT a parallel model:
 *
 *  - VOLUME is the existing rolling-decay projection (projectRollingSets over
 *    the same per-day buckets the forecast panel renders) at day +1, assuming
 *    nothing new is logged: today's oldest counted day ages out of the 7-day
 *    window. Coarse rows project from the capped group buckets, fine children
 *    from the per-head standard buckets — the same pairing as the live rows.
 *  - RECOVERY is the same pure heuristic re-evaluated at tomorrow's instant
 *    (computeMuscleRecovery takes an injected `now`); history is completed
 *    sessions only, all of which remain valid one day ahead.
 *
 * Zone, gap, score, lagging-children demotion and ordering all re-derive
 * through the shared rules, so the preview reads exactly like the live view.
 *
 * Deliberate divergences from the live rows:
 *  - Soreness overrides do NOT apply — they are same-day subjective reports
 *    ("still sore TODAY"); tomorrow the time model speaks for itself.
 *  - `exercises` is emptied on rows and children: the drill-down amounts are
 *    today's window shares, and re-attributing tomorrow's decayed totals per
 *    exercise is data we don't compute — so the preview shows no breakdown
 *    rather than a wrong one (the list renders no detail panel for them).
 */
export function buildNextDayPreviewRows(
  rows: ReadinessRow[],
  dailyGroupSets: DailyGroupSets,
  dailyStandardSets: DailyStandardSets,
  history: RecoverySession[],
  now: Date,
  config: RecoveryConfig = RECOVERY_CONFIG
): ReadinessRow[] {
  const tomorrow = nextLocalDaySameTime(now);
  // Rolling total at the end of tomorrow (rounded at emission like the row
  // headers); an absent bucket means nothing credited in the window → 0.
  const nextDaySets = (daily: readonly number[] | undefined): number =>
    daily ? projectRollingSets(daily, 1)[1] : 0;

  const preview = rows.map((row): ReadinessRow => {
    const sets = nextDaySets(dailyGroupSets[row.muscle]);
    const zone = volumeZone(sets, row.band);
    const recovery = coarseRecovery(row.muscle, history, tomorrow, config);
    const volumeGap = Math.max(0, row.band.mev - sets);

    const children: ReadinessChild[] = row.children.map((child) => {
      const childSets = nextDaySets(dailyStandardSets[child.muscle]);
      return {
        ...child,
        sets: childSets,
        zone: volumeZone(childSets, child.band),
        belowMev: childSets < child.band.mev,
        volumeGap: Math.max(0, child.band.mev - childSets),
        recovery: computeMuscleRecovery(history, child.muscle, tomorrow, config),
        exercises: [],
      };
    });

    // Same divergence rule as buildReadinessRows, over tomorrow's statuses.
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
