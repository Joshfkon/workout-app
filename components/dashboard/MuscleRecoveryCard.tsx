'use client';

import { useMemo, useState, memo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { useDashboardMuscleReadiness } from '@/hooks/useMuscleReadiness';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { readinessRowsToMapData } from '@/lib/muscleMap/adapters';
import {
  MuscleGroupList,
  useMuscleRowExpansion,
  withVisibleChildren,
} from '@/components/muscle/MuscleGroupList';
import type {
  ReadinessRow,
  ReadinessChild,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import type { MuscleRecoveryResult } from '@/services/muscleRecovery';

/**
 * MuscleRecoveryCard — the analytics-page recovery overview. Renders the SAME
 * unified readiness rows (and the same recovery heuristic, muscle map and
 * status vocabulary) as the in-workout Muscle Readiness sheet, minus the live
 * session — so this card can never disagree with the sheet or the map about a
 * muscle's status. The history fetch shares the sheet's React Query key, and
 * the muscle hierarchy renders through the shared MuscleGroupList: one coarse
 * row per group (status = its LEAST-recovered member, per buildReadinessRows),
 * fine members behind the chevron with their own timers, divergent parents
 * self-revealing.
 */

/** Same color families as the readiness badges + map's RECOVERY_FILL. */
const STATUS_PRESENTATION: Record<
  MuscleRecoveryResult['status'],
  { label: string; textClass: string; barClass: string }
> = {
  fresh: { label: 'Fresh', textClass: 'text-success-400', barClass: 'bg-success-500' },
  recovering: { label: 'Recovering', textClass: 'text-warning-400', barClass: 'bg-warning-500' },
  fatigued: { label: 'Fatigued', textClass: 'text-surface-400', barClass: 'bg-surface-600' },
};

/** "~2h" / "~2d" — time until Fresh, matching the sheet's ETA vocabulary. */
function formatReadyIn(hours: number): string {
  if (hours <= 0) return '';
  if (hours < 1) return 'ready in <1h';
  if (hours < 24) return `ready in ~${Math.round(hours)}h`;
  return `ready in ~${Math.round(hours / 24)}d`;
}

/** Recovery progress toward Fresh (100 = fully recovered / no estimate). */
function recoveryPercent(recovery: MuscleRecoveryResult): number {
  if (recovery.lastTrainedAt === null || !recovery.windowHours) return 100;
  if (recovery.status === 'fresh') return 100;
  return Math.min(
    100,
    Math.round(((recovery.hoursSinceLast ?? 0) / recovery.windowHours) * 100)
  );
}

/** Coarse-row content: group name, aggregate (least-recovered) status, bar. */
function RecoveryRowContent({ row }: { row: ReadinessRow }) {
  const { recovery } = row;
  const noData = recovery.lastTrainedAt === null;
  const presentation = STATUS_PRESENTATION[recovery.status];
  const percent = recoveryPercent(recovery);
  const readyIn =
    noData || recovery.status === 'fresh' ? '' : formatReadyIn(recovery.hoursUntilReady);

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline text-sm">
        <span className="text-surface-300">{row.displayName}</span>
        <span
          className={`font-medium ${noData ? 'text-surface-500' : presentation.textClass}`}
          data-testid={`recovery-status-${row.muscle}`}
        >
          {noData ? 'No recent data' : presentation.label}
          {readyIn && <span className="text-xs text-surface-500 ml-1">({readyIn})</span>}
        </span>
      </div>
      <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${noData ? 'bg-surface-700' : presentation.barClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Fine-member content: the member's OWN status and timer (not the parent's). */
function RecoveryChildContent({ child }: { child: ReadinessChild }) {
  const { recovery } = child;
  const noData = recovery.lastTrainedAt === null;
  const presentation = STATUS_PRESENTATION[recovery.status];
  const percent = recoveryPercent(recovery);
  const readyIn =
    noData || recovery.status === 'fresh' ? '' : formatReadyIn(recovery.hoursUntilReady);

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline text-xs">
        <span className="text-surface-400">{child.displayName}</span>
        <span
          className={noData ? 'text-surface-500' : presentation.textClass}
          data-testid={`recovery-status-${child.muscle}`}
        >
          {noData ? 'No recent data' : presentation.label}
          {readyIn && <span className="text-[10px] text-surface-500 ml-1">({readyIn})</span>}
        </span>
      </div>
      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${noData ? 'bg-surface-700' : presentation.barClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface MuscleRecoveryCardProps {
  /** Maximum muscle rows shown before the "Show All" toggle. */
  limit?: number;
}

export const MuscleRecoveryCard = memo(function MuscleRecoveryCard({
  limit = 6,
}: MuscleRecoveryCardProps) {
  // Stamp the clock once per mount so every muscle (and the map) is evaluated
  // against the same instant, mirroring the readiness sheet.
  const [now] = useState(() => new Date());
  const { rows, isLoading, error, refetch } = useDashboardMuscleReadiness(now);
  const [showAll, setShowAll] = useState(false);

  // Recovery-first order (unlike the sheet's train-this-next sort): muscles
  // still recovering come first, soonest-ready on top, then Fresh, then the
  // no-estimate rows.
  const sortedRows = useMemo(() => {
    const recovering = rows
      .filter((r) => r.recovery.lastTrainedAt !== null && r.recovery.status !== 'fresh')
      .sort((a, b) => a.recovery.hoursUntilReady - b.recovery.hoursUntilReady);
    const fresh = rows.filter(
      (r) => r.recovery.lastTrainedAt !== null && r.recovery.status === 'fresh'
    );
    const noData = rows.filter((r) => r.recovery.lastTrainedAt === null);
    return [...recovering, ...fresh, ...noData];
  }, [rows]);

  // Headline: coarse groups only — fine members inform their parent's status
  // (least-recovered wins) but never inflate the denominator. A never-trained
  // group counts as ready (there's nothing to recover from).
  const readyCount = useMemo(
    () => rows.filter((r) => r.recovery.status === 'fresh').length,
    [rows]
  );

  // Shared hierarchy expansion (persisted per user for this surface).
  // Divergent parents (e.g. Shoulders Fatigued off the side delts while
  // front/rear are Fresh) self-reveal via the rows' autoExpand flag.
  const expansion = useMuscleRowExpansion('recovery-card', sortedRows);

  // The map paints from the same rows the list shows — fine-member overrides
  // only for members actually visible (expanded parents).
  const mapRows = useMemo(
    () => withVisibleChildren(sortedRows, expansion.expanded),
    [sortedRows, expansion.expanded]
  );
  const mapData = useMemo(() => readinessRowsToMapData(mapRows), [mapRows]);

  const displayRows = showAll ? sortedRows : sortedRows.slice(0, limit);
  const hasMore = sortedRows.length > limit;

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="animate-pulse space-y-4" data-testid="muscle-recovery-loading">
          <div className="h-5 bg-surface-800 rounded w-1/3" />
          <div className="h-40 bg-surface-800 rounded" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 bg-surface-800 rounded w-1/2" />
                <div className="h-2 bg-surface-800 rounded" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-5">
        <div className="text-center py-4">
          <p className="text-danger-400 text-sm mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card data-testid="muscle-recovery-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Muscle Recovery</CardTitle>
          <span
            className={`text-xs ${readyCount < rows.length ? 'text-surface-500' : 'text-success-400'}`}
            data-testid="muscle-recovery-headline"
          >
            {readyCount} of {rows.length} ready
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {/* Front + back body map, painted from the same rows as the list. */}
        <MuscleMap
          data={mapData}
          mode="recovery"
          view="both"
          className="h-40 mb-4"
          data-testid="muscle-recovery-map"
        />

        <div className="space-y-3">
          <MuscleGroupList
            rows={displayRows}
            expansion={expansion}
            renderRow={(row) => <RecoveryRowContent row={row} />}
            renderChild={(child) => <RecoveryChildContent child={child} />}
            testIdPrefix="recovery-row"
            childrenClassName="mt-2 space-y-2 pl-3 ml-5 border-l border-surface-800/80"
          />
        </div>

        {hasMore && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-4 w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
            data-testid="muscle-recovery-toggle"
          >
            {showAll ? 'Show Less' : `Show All (${sortedRows.length})`}
          </button>
        )}
      </CardContent>
    </Card>
  );
});
