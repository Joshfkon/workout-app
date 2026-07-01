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
  nutritionTargets: { calories: number; protein: number } | null;
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
 * Whether protein intake is keeping pace with the day (eating window 7:00-21:00).
 * More than 15 percentage points behind the expected fraction reads "behind".
 */
function proteinPaceLabel(proteinSoFar: number, proteinTarget: number): 'on pace' | 'behind' {
  if (proteinTarget <= 0) return 'on pace';
  const now = new Date();
  const hourOfDay = now.getHours() + now.getMinutes() / 60;
  const expectedPercent = Math.max(0, Math.min(100, ((hourOfDay - 7) / (21 - 7)) * 100));
  const actualPercent = (proteinSoFar / proteinTarget) * 100;
  return actualPercent < expectedPercent - 15 ? 'behind' : 'on pace';
}

/**
 * Glance metric grid: Nutrition · Recovery · Weekly volume · Weight.
 * 2x2 on mobile, 4-across at lg. Tiles tap through to their detail pages
 * (recovery stays inline). Renders nothing when there's no data for any tile.
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

  // Per-muscle recovery segments — only muscles trained in the last week
  // (untrained muscles report "ready" by default and would wash out the strip).
  const recoverySegments = [...readyMuscles, ...recoveringMuscles]
    .filter((m) => m.lastTrainedAt !== null)
    .sort((a, b) => Number(b.isReady) - Number(a.isReady));

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {nutritionTargets && (
        <MetricTile icon={IconApple} label="Nutrition" href="/dashboard/nutrition">
          <div className="text-xl font-semibold text-surface-100">
            {Math.round(nutritionTotals.calories)}
            <span className="text-sm text-surface-500 font-normal"> / {nutritionTargets.calories}</span>
          </div>
          <div className="h-1 bg-surface-800 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-primary-500" style={{ width: `${Math.min(100, (nutritionTotals.calories / Math.max(1, nutritionTargets.calories)) * 100)}%` }} />
          </div>
          <div className="text-[11px] text-surface-500 mt-1.5">
            {Math.round(nutritionTotals.protein)}g protein · {proteinPaceLabel(nutritionTotals.protein, nutritionTargets.protein)}
          </div>
        </MetricTile>
      )}
      {recoveryLoading ? (
        <MetricTile icon={IconHeartbeat} label="Recovery">
          <div className="h-6 w-24 bg-surface-800 rounded animate-pulse mt-1" />
        </MetricTile>
      ) : (readyMuscles.length > 0 || recoveringMuscles.length > 0) ? (
        <MetricTile icon={IconHeartbeat} label="Recovery" href="/dashboard/analytics">
          <div className="text-xl font-semibold text-success-400">
            {readyMuscles.length} ready
            <span className="text-sm text-surface-500 font-normal"> · {recoveringMuscles.length} sore</span>
          </div>
          {recoverySegments.length > 0 && (
            <div className="flex gap-0.5 mt-2" aria-hidden="true">
              {recoverySegments.map((m) => (
                <div
                  key={m.muscle}
                  title={`${m.displayName}: ${m.statusText}`}
                  className={`h-1 flex-1 rounded-full ${m.isReady ? 'bg-success-500' : 'bg-warning-500'}`}
                />
              ))}
            </div>
          )}
          {readyMuscles.length > 0 && (
            <div className="text-[11px] text-surface-500 mt-1.5 truncate">
              {recoveringMuscles.length > 0
                ? `${recoveringMuscles.slice(0, 2).map((m) => m.displayName).join(', ')} still sore`
                : `${readyMuscles.slice(0, 3).map((m) => m.displayName).join(', ')} fresh`}
            </div>
          )}
        </MetricTile>
      ) : null}
      {volume && (
        <MetricTile icon={IconChartBar} label="Weekly volume" href="/dashboard/analytics">
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
        <MetricTile icon={IconScale} label="Weight" href="/dashboard/analytics">
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
