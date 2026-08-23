'use client';

import { useCallback, useMemo, useState } from 'react';
import { MuscleMap } from '@/components/muscleMap/MuscleMap';
import { heatmapRowsToMapData } from '@/lib/muscleMap/adapters';
import type { MuscleId } from '@/lib/muscleMap/taxonomy';
import type { BodyView } from '@/lib/muscleMap/paths';
import { useVolumeHeatmap } from '@/hooks/useVolumeHeatmap';
import {
  DEFAULT_HEATMAP_TIMEFRAME,
  getHeatmapTimeframe,
  HEATMAP_TIMEFRAMES,
  HEAT_LABELS,
  HEAT_LEVELS,
  HEAT_SWATCH_CLASSES,
  type HeatmapTimeframeId,
  type VolumeHeatmapResult,
  type VolumeHeatmapRow,
} from '@/app/(dashboard)/dashboard/_lib/volumeHeatmap';
import {
  groupZoneBandLabel,
  STANDARD_TO_COARSE,
  type CoarseMuscle,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/**
 * Shared building blocks for every long-window volume-heatmap surface: the
 * full card on /dashboard/volume (VolumeHeatmapCard) and the compact paint
 * inside the readiness map (Train page card + in-workout Muscle readiness
 * sheet). One timeframe store, one chip row, one legend, one tap-detail line —
 * so the surfaces can't drift apart in copy or color semantics.
 */

/**
 * Selected timeframe survives revisits AND is shared across surfaces
 * (localStorage, default 3 months) — picking 6M on the volume page means the
 * readiness sheet's heatmap opens on 6M too.
 */
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

/** Persisted timeframe selection (shared key across all heatmap surfaces). */
export function useHeatmapTimeframe(): [HeatmapTimeframeId, (id: HeatmapTimeframeId) => void] {
  const [timeframe, setTimeframeState] = useState<HeatmapTimeframeId>(() => readTimeframe());
  const setTimeframe = useCallback((id: HeatmapTimeframeId) => {
    setTimeframeState(id);
    persistTimeframe(id);
  }, []);
  return [timeframe, setTimeframe];
}

/** "12.3" with the trailing ".0" dropped for whole numbers. */
export function formatHeatmapSets(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 2W / 1M / 3M / 6M / 1Y chip row. */
export function HeatmapTimeframeChips({
  value,
  onChange,
  testIdPrefix = 'heatmap',
}: {
  value: HeatmapTimeframeId;
  onChange: (id: HeatmapTimeframeId) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className="flex gap-1">
      {HEATMAP_TIMEFRAMES.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            value === t.id
              ? 'bg-surface-700 text-surface-100'
              : 'text-surface-500 hover:text-surface-300'
          }`}
          data-testid={`${testIdPrefix}-timeframe-${t.id}`}
          aria-pressed={value === t.id}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The color strip, coldest → hottest, matching HEAT_FILL_CLASSES exactly. */
export function HeatmapLegend({ testId = 'heatmap-legend' }: { testId?: string }) {
  return (
    <div data-testid={testId}>
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
  );
}

/** Tapped-muscle readout: average, bucket, band, window total. */
export function HeatmapMuscleDetail({
  row,
  testId = 'heatmap-detail',
}: {
  row: VolumeHeatmapRow;
  testId?: string;
}) {
  return (
    <div
      className="mt-2 rounded-lg bg-surface-800/60 px-3 py-2 text-xs text-surface-400"
      data-testid={testId}
    >
      <span className="font-medium text-surface-200">{row.displayName}</span>
      <span> — {formatHeatmapSets(row.avgWeeklySets)} sets/wk avg</span>
      <span className="text-surface-500"> · {HEAT_LABELS[row.heat]}</span>
      <span className="text-surface-500"> · {groupZoneBandLabel(row.band)}</span>
      <span className="text-surface-500"> · {formatHeatmapSets(row.totalSets)} sets total</span>
    </div>
  );
}

/** Caption copy: what the paint means + the data-span clamp note. */
export function heatmapCaption(
  timeframe: HeatmapTimeframeId,
  heatmap: VolumeHeatmapResult | null
): string {
  const windowName = getHeatmapTimeframe(timeframe).name;
  if (!heatmap?.clamped) {
    return `Average weekly credited sets vs each group’s MEV, ${windowName}.`;
  }
  const weeks = Math.max(1, Math.round(heatmap.effectiveDays / 7));
  return `Average weekly credited sets vs each group’s MEV, ${windowName} (you have ~${weeks} week${weeks === 1 ? '' : 's'} of logged training, so the average covers that span).`;
}

/**
 * CompactVolumeHeatmap — the whole heatmap unit at sheet size: timeframe
 * chips, single-view body map, legend, tap-for-detail and caption. Dropped
 * into the readiness map when its paint toggle is on "Heatmap"; the parent
 * keeps owning the Front/Back toggle and passes `view` down. Fetches lazily
 * (the hook only runs while this is mounted, i.e. while the mode is active).
 */
export function CompactVolumeHeatmap({
  view,
  testIdPrefix = 'readiness-heatmap',
}: {
  view: BodyView;
  testIdPrefix?: string;
}) {
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
  const hasAnyVolume = (heatmap?.rows ?? []).some((row) => row.totalSets > 0);

  return (
    <div data-testid={testIdPrefix}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <HeatmapTimeframeChips value={timeframe} onChange={setTimeframe} testIdPrefix={testIdPrefix} />
      </div>

      {isLoading && !heatmap ? (
        <div className="h-44 animate-pulse rounded-lg bg-surface-800" data-testid={`${testIdPrefix}-loading`} />
      ) : !hasAnyVolume ? (
        <p className="py-8 text-center text-sm text-surface-500" data-testid={`${testIdPrefix}-empty`}>
          No completed workouts in this period yet.
        </p>
      ) : (
        <>
          <MuscleMap
            data={mapData}
            mode="heat"
            view={view}
            onMuscleTap={selectMuscle}
            className={`h-44 ${isPlaceholderData ? 'opacity-60' : ''}`}
            data-testid={`${testIdPrefix}-map`}
          />
          <div className="mt-2">
            <HeatmapLegend testId={`${testIdPrefix}-legend`} />
          </div>
          {selectedRow && <HeatmapMuscleDetail row={selectedRow} testId={`${testIdPrefix}-detail`} />}
        </>
      )}

      <p
        className={`mt-1.5 text-[10px] text-surface-600 ${isPlaceholderData ? 'animate-pulse' : ''}`}
        data-testid={`${testIdPrefix}-caption`}
      >
        {heatmapCaption(timeframe, heatmap)}
        {selectedRow ? '' : ' Tap a muscle for its numbers.'}
      </p>
    </div>
  );
}
