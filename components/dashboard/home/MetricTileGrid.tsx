'use client';

import { getDisplayWeight } from '@/lib/weightUtils';
import { IconApple, IconHeartbeat, IconChartBar, IconScale } from '@tabler/icons-react';
import type { MuscleRecoveryStatus } from '@/hooks/useMuscleRecovery';
import { MetricTile } from './MetricTile';

/** Today's macro totals (as summed from the food log). */
export interface GlanceNutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Pre-aggregated weekly volume summary for the glance tile (null = no volume yet). */
export interface GlanceVolumeSummary {
  totalSets: number;
  totalTarget: number;
  lowCount: number;
}

/** Weekly weight trend (latest vs ~7 days ago) in the user's display unit. */
export interface GlanceWeightTrend {
  delta: number;
  down: boolean;
}

interface MetricTileGridProps {
  nutritionTotals: GlanceNutritionTotals;
  /** Nutrition targets; tile is hidden when none are set. */
  nutritionTargets: { calories: number } | null;
  /** Recovery hook state — gate the tile on loading so the "all ready" default isn't shown. */
  recoveryLoading: boolean;
  readyMuscles: MuscleRecoveryStatus[];
  recoveringMuscles: MuscleRecoveryStatus[];
  volume: GlanceVolumeSummary | null;
  todaysWeight: { weight: number; unit: string } | null;
  weightUnit: 'lb' | 'kg';
  weightTrend: GlanceWeightTrend | null;
}

/**
 * 2x2 glance grid: Nutrition · Recovery · Weekly volume · Weight.
 * Renders nothing when there's no data for any tile.
 */
export function MetricTileGrid({
  nutritionTotals,
  nutritionTargets,
  recoveryLoading,
  readyMuscles,
  recoveringMuscles,
  volume,
  todaysWeight,
  weightUnit,
  weightTrend,
}: MetricTileGridProps) {
  const hasAnyTile =
    volume !== null || !!nutritionTargets || !!todaysWeight || recoveryLoading ||
    readyMuscles.length > 0 || recoveringMuscles.length > 0;
  if (!hasAnyTile) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {nutritionTargets && (
        <MetricTile icon={IconApple} label="Nutrition">
          <div className="text-xl font-semibold text-surface-100">
            {Math.round(nutritionTotals.calories)}
            <span className="text-sm text-surface-500 font-normal"> / {nutritionTargets.calories}</span>
          </div>
          <div className="h-1 bg-surface-800 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-primary-500" style={{ width: `${Math.min(100, (nutritionTotals.calories / Math.max(1, nutritionTargets.calories)) * 100)}%` }} />
          </div>
        </MetricTile>
      )}
      {recoveryLoading ? (
        <MetricTile icon={IconHeartbeat} label="Recovery">
          <div className="h-6 w-24 bg-surface-800 rounded animate-pulse mt-1" />
        </MetricTile>
      ) : (readyMuscles.length > 0 || recoveringMuscles.length > 0) ? (
        <MetricTile icon={IconHeartbeat} label="Recovery">
          <div className="text-xl font-semibold text-success-400">
            {readyMuscles.length} ready
            <span className="text-sm text-surface-500 font-normal"> · {recoveringMuscles.length} sore</span>
          </div>
          {readyMuscles.length > 0 && (
            <div className="text-xs text-surface-500 mt-1 truncate">
              {readyMuscles.slice(0, 3).map((m) => m.displayName).join(', ')} fresh
            </div>
          )}
        </MetricTile>
      ) : null}
      {volume && (
        <MetricTile icon={IconChartBar} label="Weekly volume">
          <div className="text-xl font-semibold text-surface-100">
            {volume.totalSets}
            <span className="text-sm text-surface-500 font-normal"> / {volume.totalTarget} sets</span>
          </div>
          <div className={`text-xs mt-1 ${volume.lowCount > 0 ? 'text-warning-400' : 'text-success-400'}`}>
            {volume.lowCount > 0 ? `${volume.lowCount} below target` : 'On target'}
          </div>
        </MetricTile>
      )}
      {todaysWeight && (
        <MetricTile icon={IconScale} label="Weight">
          <div className="text-xl font-semibold text-surface-100">
            {getDisplayWeight(todaysWeight.weight, todaysWeight.unit as 'lb' | 'kg' | null, weightUnit).toFixed(1)}
            <span className="text-sm text-surface-500 font-normal"> {weightUnit}</span>
          </div>
          {weightTrend && (
            <div className={`text-xs mt-1 ${weightTrend.down ? 'text-success-400' : 'text-surface-400'}`}>
              {weightTrend.down ? '↓' : '↑'} {Math.abs(weightTrend.delta).toFixed(1)} this week
            </div>
          )}
        </MetricTile>
      )}
    </div>
  );
}
