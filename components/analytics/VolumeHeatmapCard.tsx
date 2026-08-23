'use client';

import { useCallback, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { heatmapRowsToMapData } from '@/lib/muscleMap/adapters';
import type { MuscleId } from '@/lib/muscleMap/taxonomy';
import { useVolumeHeatmap } from '@/hooks/useVolumeHeatmap';
import {
  DEFAULT_HEATMAP_TIMEFRAME,
  getHeatmapTimeframe,
  HEATMAP_TIMEFRAMES,
  HEAT_LABELS,
  HEAT_LEVELS,
  HEAT_SWATCH_CLASSES,
  type HeatmapTimeframeId,
  type VolumeHeatmapRow,
} from '@/app/(dashboard)/dashboard/_lib/volumeHeatmap';
import {
  groupZoneBandLabel,
  STANDARD_TO_COARSE,
  type CoarseMuscle,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * VolumeHeatmapCard — the long-window "where does my volume actually go?"
 * body map. Pick a trailing window (2 weeks … 1 year) and every muscle group
 * paints by its AVERAGE weekly credited sets, weighted against its own MEV:
 * red/amber where the average isn't enough to grow, greens darkening with
 * volume across (and past) the MEV–MRV band. Tap a muscle for its numbers.
 *
 * All numbers come from the shared weekly-volume pipeline via
 * useVolumeHeatmap; this card computes nothing itself.
 */

/** Selected timeframe survives revisits (localStorage, default 3 months). */
const TIMEFRAME_STORAGE_KEY = 'hypertrack:volume-heatmap-timeframe';

function readTimeframe(): HeatmapTimeframeId {
  if (typeof window === 'undefined') return DEFAULT_HEATMAP_TIMEFRAME;
  try {
    const stored = window.localStorage.getItem(TIMEFRAME_STORAGE_KEY);
    if (stored && HEATMAP_TIMEFRAMES.some((t) => t.id === stored)) {
      return stored as HeatmapTimeframeId;
    }
  } catch {
    /* localStorage unavailable — fall through to the default. */
  }
  return DEFAULT_HEATMAP_TIMEFRAME;
}

function persistTimeframe(id: HeatmapTimeframeId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIMEFRAME_STORAGE_KEY, id);
  } catch {
    /* localStorage unavailable — degrade to in-memory. */
  }
}

/** "12.3 sets/wk" with the trailing ".0" dropped for whole numbers. */
function formatSets(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function SelectedMuscleDetail({ row }: { row: VolumeHeatmapRow }) {
  return (
    <div
      className="mt-2 rounded-lg bg-surface-800/60 px-3 py-2 text-xs text-surface-400"
      data-testid="heatmap-detail"
    >
      <span className="font-medium text-surface-200">{row.displayName}</span>
      <span> — {formatSets(row.avgWeeklySets)} sets/wk avg</span>
      <span className="text-surface-500"> · {HEAT_LABELS[row.heat]}</span>
      <span className="text-surface-500"> · {groupZoneBandLabel(row.band)}</span>
      <span className="text-surface-500"> · {formatSets(row.totalSets)} sets total</span>
    </div>
  );
}

export function VolumeHeatmapCard() {
  const [timeframe, setTimeframeState] = useState<HeatmapTimeframeId>(() => readTimeframe());
  const setTimeframe = (id: HeatmapTimeframeId) => {
    setTimeframeState(id);
    persistTimeframe(id);
  };
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
  const windowName = getHeatmapTimeframe(timeframe).name;
  const effectiveWeeks = heatmap ? Math.max(1, Math.round(heatmap.effectiveDays / 7)) : 0;

  return (
    <Card className="p-4 mb-6" data-testid="volume-heatmap-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-surface-100">Volume Heatmap</h3>
        <div className="flex gap-1">
          {HEATMAP_TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTimeframe(t.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                timeframe === t.id
                  ? 'bg-surface-700 text-surface-100'
                  : 'text-surface-500 hover:text-surface-300'
              }`}
              data-testid={`heatmap-timeframe-${t.id}`}
              aria-pressed={timeframe === t.id}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p
        className={`mt-1 text-xs text-surface-500 ${isPlaceholderData ? 'animate-pulse' : ''}`}
        data-testid="heatmap-caption"
      >
        Average weekly credited sets vs each group&rsquo;s MEV, {windowName}
        {heatmap?.clamped
          ? ` (you have ~${effectiveWeeks} week${effectiveWeeks === 1 ? '' : 's'} of logged training, so the average covers that span)`
          : ''}
        .
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

          {/* Legend: one strip, coldest → hottest, matching HEAT_FILL_CLASSES. */}
          <div className="mt-3" data-testid="heatmap-legend">
            <div className="flex h-2 overflow-hidden rounded-full">
              {HEAT_LEVELS.map((level) => (
                <span key={level} className={`flex-1 ${HEAT_SWATCH_CLASSES[level]}`} title={HEAT_LABELS[level]} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-surface-500">
              <span>Not enough to grow</span>
              <span>MEV</span>
              <span>MRV+</span>
            </div>
          </div>

          {selectedRow ? (
            <SelectedMuscleDetail row={selectedRow} />
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
                      {' '}({formatSets(row.avgWeeklySets)}/{row.band.mev})
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
