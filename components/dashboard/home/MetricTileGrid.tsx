'use client';

import { getDisplayWeight } from '@/lib/weightUtils';
import { IconApple, IconTrendingUp, IconChartBar, IconScale } from '@tabler/icons-react';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { MetricTile } from './MetricTile';
import { intakePaceLabel } from './intakePace';

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

/** Weekly weight-change rate in the display unit, vs the goal's target rate. */
export interface GlanceWeightRate {
  /** Observed lb-or-kg per week (regression over recent entries). */
  perWeek: number;
  /** Goal-implied target rate; null when the goal has no rate (maintenance). */
  target: number | null;
}

interface MetricTileGridProps {
  nutritionTotals: GlanceNutritionTotals;
  /** Nutrition targets; tile is hidden when none are set. */
  nutritionTargets: { calories: number; protein: number } | null;
  /** Lift trend summary; tile is hidden when there aren't enough tracked lifts. */
  liftTrends: LiftTrendsSummary | null;
  volume: GlanceVolumeSummary | null;
  /** Latest known weight (today's log or most recent history entry). */
  latestWeight: { weight: number; unit: string } | null;
  weightUnit: 'lb' | 'kg';
  /** Recent weight history for the sparkline (any unit; converted for display). */
  weightHistory: { date: string; weight: number; unit: string }[];
  weightRate: GlanceWeightRate | null;
  /** Opens the weight-log modal ("+ log" on the Weight tile). */
  onLogWeight: () => void;
}

/** Tiny trend line for the Weight tile (last ~30 days, display unit). */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 20 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 26" className="w-full h-6 mt-1.5 text-primary-400" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;

/**
 * Glance metric grid: Nutrition · Lifts · Weekly volume · Weight.
 * 2x2 on mobile, 4-across at lg. Tiles tap through to their detail pages.
 * Renders nothing when there's no data for any tile.
 */
export function MetricTileGrid({
  nutritionTotals,
  nutritionTargets,
  liftTrends,
  volume,
  latestWeight,
  weightUnit,
  weightHistory,
  weightRate,
  onLogWeight,
}: MetricTileGridProps) {
  // Show the tile when anything was classified OR lifts are accruing history
  // (a brand-new program should read "rebuilding", not vanish).
  const showLifts = !!liftTrends && (liftTrends.lifts.length > 0 || liftTrends.insufficientData > 0);
  const hasAnyTile = volume !== null || !!nutritionTargets || !!latestWeight || showLifts;
  // Confident lifts drive the headline; low-confidence lifts (window spans a
  // program switch) are "rebuilding" and shouldn't read as stagnation.
  const confidentLifts = liftTrends ? liftTrends.rising + liftTrends.flat + liftTrends.down : 0;
  const rebuildingLifts = liftTrends ? liftTrends.rebuilding + liftTrends.insufficientData : 0;
  if (!hasAnyTile) return null;

  // Nutrition: what's LEFT for the day (the actionable number), not consumed.
  const kcalLeft = nutritionTargets ? Math.round(nutritionTargets.calories - nutritionTotals.calories) : 0;
  const proteinLeft = nutritionTargets ? Math.round(nutritionTargets.protein - nutritionTotals.protein) : 0;
  const kcalPace = nutritionTargets
    ? intakePaceLabel(nutritionTotals.calories, nutritionTargets.calories)
    : 'on pace';

  // Lifts sub-line: "3 flat · 2 down · Bench stalled 3 wks" (zero parts omitted).
  const liftParts: string[] = [];
  if (liftTrends) {
    if (liftTrends.flat > 0) liftParts.push(`${liftTrends.flat} flat`);
    if (liftTrends.down > 0) liftParts.push(`${liftTrends.down} down`);
    if (liftTrends.stalled) {
      liftParts.push(`${liftTrends.stalled.name} stalled ${liftTrends.stalled.weeks} wk${liftTrends.stalled.weeks === 1 ? '' : 's'}`);
    }
    if (liftParts.length === 0 && liftTrends.rising > 0) liftParts.push('all trending up');
    if (rebuildingLifts > 0) {
      liftParts.push(`${rebuildingLifts} rebuilding after program change`);
    }
  }

  // Weight sparkline values in the display unit (last 30 entries).
  const sparkValues = weightHistory
    .slice(-30)
    .map((w) => getDisplayWeight(w.weight, w.unit as 'lb' | 'kg' | null, weightUnit));

  // Rate reads green when it moves in the goal's direction (or no target set).
  const rateOnTrack =
    !weightRate || weightRate.target === null || weightRate.target === 0
      ? true
      : Math.sign(weightRate.perWeek) === Math.sign(weightRate.target);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {nutritionTargets && (
        <MetricTile icon={IconApple} label="Nutrition" href="/dashboard/nutrition">
          <div className="text-xl font-semibold text-surface-100">
            {kcalLeft >= 0 ? (
              <>
                {kcalLeft.toLocaleString()}
                <span className="text-sm text-surface-500 font-normal"> left</span>
              </>
            ) : (
              <>
                {Math.abs(kcalLeft).toLocaleString()}
                <span className="text-sm text-warning-400 font-normal"> over</span>
              </>
            )}
          </div>
          <div className="h-1 bg-surface-800 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-primary-500"
              style={{ width: `${Math.min(100, (nutritionTotals.calories / Math.max(1, nutritionTargets.calories)) * 100)}%` }}
            />
          </div>
          <div className={`text-[11px] mt-1.5 ${kcalPace === 'behind' ? 'text-warning-400' : 'text-surface-500'}`}>
            {proteinLeft > 0 ? `${proteinLeft}g protein to go` : 'protein target hit'} · {kcalPace === 'behind' ? 'behind' : 'on pace'}
          </div>
        </MetricTile>
      )}
      {showLifts && liftTrends && (
        <MetricTile icon={IconTrendingUp} label="Lifts" href="/dashboard/analytics?tab=strength&section=lift-trends">
          {confidentLifts > 0 ? (
            <div className="text-xl font-semibold text-success-400">
              {liftTrends.rising} rising
              <span className="text-sm text-surface-500 font-normal"> of {confidentLifts}</span>
            </div>
          ) : (
            <div className="text-xl font-semibold text-surface-100">
              Rebuilding
              <span className="text-sm text-surface-500 font-normal"> new program</span>
            </div>
          )}
          <div className="flex gap-1 mt-2" aria-hidden="true">
            {liftTrends.lifts.map((lift) => (
              <div
                key={lift.exerciseId}
                title={`${lift.name}: ${lift.lowConfidence ? 'rebuilding (low confidence)' : lift.direction}`}
                className={`h-1.5 flex-1 rounded-full ${
                  lift.lowConfidence
                    ? 'bg-surface-700'
                    : lift.direction === 'rising' ? 'bg-success-500' : lift.direction === 'down' ? 'bg-danger-500' : 'bg-surface-600'
                }`}
              />
            ))}
          </div>
          {confidentLifts > 0 && liftParts.length > 0 ? (
            <div className="text-[11px] text-surface-500 mt-1.5 truncate">{liftParts.join(' · ')}</div>
          ) : confidentLifts === 0 ? (
            <div className="text-[11px] text-surface-500 mt-1.5 truncate">trends rebuild over 2–3 sessions</div>
          ) : null}
        </MetricTile>
      )}
      {volume && (
        <MetricTile
          icon={IconChartBar}
          label="Weekly volume"
          href="/dashboard/volume"
          accent={volume.lowCount > 0 ? 'warning' : undefined}
        >
          <div className="text-xl font-semibold text-surface-100">
            {volume.totalSets}
            <span className="text-sm text-surface-500 font-normal"> / {volume.totalTarget} sets</span>
          </div>
          <div className="h-1 bg-surface-800 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full ${volume.lowCount > 0 ? 'bg-warning-500' : 'bg-success-500'}`}
              style={{ width: `${Math.min(100, (volume.totalSets / Math.max(1, volume.totalTarget)) * 100)}%` }}
            />
          </div>
          <div className={`text-[11px] mt-1.5 ${volume.lowCount > 0 ? 'text-warning-400' : 'text-success-400'}`}>
            {volume.lowCount > 0
              ? `${volume.lowCount} muscle${volume.lowCount === 1 ? '' : 's'} below MEV →`
              : 'All muscles at MEV'}
          </div>
        </MetricTile>
      )}
      {latestWeight && (
        <MetricTile
          icon={IconScale}
          label="Weight"
          href="/dashboard/nutrition?tab=weight"
          action={
            <button
              type="button"
              onClick={onLogWeight}
              className="text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors"
            >
              + log
            </button>
          }
        >
          <div className="text-xl font-semibold text-surface-100">
            {getDisplayWeight(latestWeight.weight, latestWeight.unit as 'lb' | 'kg' | null, weightUnit).toFixed(1)}
            <span className="text-sm text-surface-500 font-normal"> {weightUnit}</span>
          </div>
          <Sparkline values={sparkValues} />
          {weightRate && (
            <div className={`text-[11px] mt-1 ${rateOnTrack ? 'text-success-400' : 'text-warning-400'}`}>
              {signed(weightRate.perWeek)} {weightUnit}/wk
              {weightRate.target !== null && (
                <span className="text-surface-500"> · target {signed(weightRate.target)}</span>
              )}
            </div>
          )}
        </MetricTile>
      )}
    </div>
  );
}
