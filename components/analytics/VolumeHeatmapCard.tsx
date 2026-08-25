'use client';

import { useCallback, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { heatmapRowsToMapData } from '@/lib/muscleMap/adapters';
import type { MuscleId } from '@/lib/muscleMap/taxonomy';
import { useVolumeHeatmap } from '@/hooks/useVolumeHeatmap';
import {
  formatHeatmapSets,
  heatmapCaption,
  HeatmapLegend,
  HeatmapMuscleDetail,
  HeatmapTimeframeChips,
  useHeatmapTimeframe,
} from '@/components/muscle/VolumeHeatmapView';
import {
  STANDARD_TO_COARSE,
  type CoarseMuscle,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * VolumeHeatmapCard — the long-window "where does my volume actually go?"
 * body map on /dashboard/volume. Pick a trailing window (2 weeks … 1 year)
 * and every muscle group paints by its AVERAGE weekly credited sets, weighted
 * against its own MEV: red/amber where the average isn't enough to grow,
 * greens darkening with volume across (and past) the MEV–MRV band. Tap a
 * muscle for its numbers.
 *
 * All numbers come from the shared weekly-volume pipeline via
 * useVolumeHeatmap; the chips/legend/detail pieces are shared with the
 * readiness map's compact heatmap (components/muscle/VolumeHeatmapView) so
 * every surface reads identically. This card computes nothing itself.
 */
export function VolumeHeatmapCard() {
  const [timeframe, setTimeframe] = useHeatmapTimeframe();
  const [selected, setSelected] = useState<CoarseMuscle | null>(null);

  const { heatmap, isLoading, isPlaceholderData } = useVolumeHeatmap(timeframe);

  const mapData = useMemo(
    () => (heatmap ? heatmapRowsToMapData(heatmap.rows) : {}),
    [heatmap]
  );
  const selectMuscle = useCallback((muscle: MuscleId) => {
    const coarse = STANDARD_TO_COARSE[muscle];
    setSelected((prev) => (prev === coarse ? null : coarse));
  }, []);

  const selectedRow = selected
    ? (heatmap?.rows.find((row) => row.muscle === selected) ?? null)
    : null;
  // Below-MEV callout mirrors the map's red/amber paint exactly (same rows).
  const underVolume = heatmap?.rows.filter((row) => row.avgWeeklySets < row.band.mev) ?? [];
  const hasAnyVolume = (heatmap?.rows ?? []).some((row) => row.totalSets > 0);

  return (
    <Card className="p-4 mb-6" data-testid="volume-heatmap-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-surface-100">Volume Heatmap</h3>
        <HeatmapTimeframeChips value={timeframe} onChange={setTimeframe} />
      </div>

      <p
        className={`mt-1 text-xs text-surface-500 ${isPlaceholderData ? 'animate-pulse' : ''}`}
        data-testid="heatmap-caption"
      >
        {heatmapCaption(timeframe, heatmap)}
      </p>

      {isLoading && !heatmap ? (
        // Cold start only — revisits and timeframe switches paint cached data.
        <div className="h-64 mt-3 animate-pulse rounded-lg bg-surface-800" data-testid="heatmap-loading" />
      ) : !hasAnyVolume ? (
        <p className="py-10 text-center text-sm text-surface-500" data-testid="heatmap-empty">
          No completed workouts in this period yet.
        </p>
      ) : (
        <>
          <MuscleMap
            data={mapData}
            mode="heat"
            view="both"
            onMuscleTap={selectMuscle}
            className={`h-64 mt-3 ${isPlaceholderData ? 'opacity-60' : ''}`}
            data-testid="heatmap-muscle-map"
          />

          <div className="mt-3">
            <HeatmapLegend />
          </div>

          {selectedRow ? (
            <HeatmapMuscleDetail row={selectedRow} />
          ) : (
            <p className="mt-2 text-[11px] text-surface-600">
              Tap a muscle for its average, zone and total.
            </p>
          )}

          {underVolume.length > 0 && (
            <div className="mt-2 rounded-lg bg-surface-800/60 px-3 py-2" data-testid="heatmap-under-volume">
              <p className="text-[11px] uppercase tracking-wide text-surface-500">
                Not getting enough to grow
              </p>
              <p className="text-xs text-surface-300 mt-0.5">
                {underVolume.map((row, i) => (
                  <span key={row.muscle}>
                    {i > 0 && <span className="text-surface-500">, </span>}
                    {row.displayName}
                    <span className="text-surface-500">
                      {' '}({formatHeatmapSets(row.avgWeeklySets)}/{row.band.mev})
                    </span>
                  </span>
                ))}
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default VolumeHeatmapCard;
