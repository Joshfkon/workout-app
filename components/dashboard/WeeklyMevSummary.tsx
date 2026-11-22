'use client';

import { Card } from '@/components/ui/Card';
import { useWeeklyMevSummary } from '@/hooks/useWeeklyMevSummary';
import { useUserStore } from '@/stores';
import {
  buildVolumeRows,
  coarseMevTiles,
  groupZoneBandLabel,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { formatEffectiveVolume } from '@/services/effectiveVolume';

/**
 * "This week vs MEV" header for the volume page — the detail view behind the
 * home "Weekly volume" glance tile and the wk-1 ramp banner. Runs the SAME
 * coarse-row model (buildVolumeRows → coarseMevTiles) as the tile, the bars and
 * the warning, so "117/88 sets · 6 below MEV" on the dashboard is exactly what
 * this card shows — with the below-MEV groups flagged and their MEV–MRV band
 * (never n/MEV) so hitting MEV never looks like a failure.
 */
export function WeeklyMevSummary() {
  const { stats, reachable, loaded } = useWeeklyMevSummary();
  const enhanced = useUserStore((s) => s.user?.enhancedAthleteMode === true);

  if (!loaded) {
    return <Card className="p-4 mb-6 h-24 animate-pulse" aria-hidden="true"><div /></Card>;
  }
  if (stats.length === 0) return null;

  const rows = buildVolumeRows(stats, reachable, { recoveryProfile: enhanced ? 'enhanced' : 'standard' });
  const tiles = coarseMevTiles(rows);
  const below = rows.filter((r) => r.zone === 'below_mev');

  return (
    <Card id="weekly-mev" className="p-4 mb-6 scroll-mt-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-ink">This week vs MEV</h3>
        <span className="text-body text-ink-2">
          {/* Effective Volume (RIR-weighted) is the primary number; the raw
              set count rides secondary so the user still sees work done. */}
          <span className="font-semibold text-ink">
            {formatEffectiveVolume(tiles.totalEffectiveSets)} effective
          </span>
          <span className="text-ink-3"> · {tiles.totalSets} total sets</span>
        </span>
      </div>
      <p className={`text-caption mb-3 ${tiles.lowCount > 0 ? 'text-status-warn' : 'text-status-ok'}`}>
        {tiles.lowCount > 0
          ? `${tiles.lowCount} muscle${tiles.lowCount === 1 ? '' : 's'} below minimum effective volume (rolling 7 days)`
          : 'All muscles at or above minimum effective volume (rolling 7 days)'}
      </p>
      {below.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {below.map((row) => (
            <span
              key={row.muscle}
              className="inline-flex items-center gap-1 rounded-full bg-status-warn/10 border border-status-warn/20 px-2 py-0.5 text-caption text-status-warn"
            >
              {row.displayName}
              <span className="text-status-warn/70">
                {formatEffectiveVolume(row.effectiveSets)} eff · {row.sets} sets · {groupZoneBandLabel(row.band)}
              </span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
