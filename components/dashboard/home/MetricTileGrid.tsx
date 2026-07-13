'use client';

import { getDisplayWeight } from '@/lib/weightUtils';
import { IconApple, IconTrendingUp, IconChartBar, IconScale, IconGauge } from '@tabler/icons-react';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { BodyCompGlance } from '@/lib/actions/dashboard';
import { BODY_COMP_TREND_SECTION_ID } from '@/services/compositionSpace';
import { MetricTile } from './MetricTile';
import { SleepTile, type SleepGlance } from './SleepTile';
import { intakePaceVerdict } from './intakePace';
import type { EatingWindow, PacingPhase } from '@/services/intakePacing';

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
  /** Latest anchored BF% + FFMI (≥2 DEXA scans); null hides the tile. */
  bodyComp?: BodyCompGlance | null;
  /** Sleep glance data; tile renders (with a quiet empty state) whenever
   *  onLogSleep is provided. */
  sleep?: SleepGlance | null;
  /** Opens the sleep quick-log sheet (tap anywhere on the Sleep tile). */
  onLogSleep?: () => void;
  /** Opens the weight-log modal ("+ log" on the Weight tile). */
  onLogWeight: () => void;
  /** Training phase — flips which pacing direction warns (default maintenance). */
  phase?: PacingPhase;
  /** User's eating window; defaults to 07:00–21:00 inside the engine. */
  eatingWindow?: EatingWindow;
}

/**
 * Trend arrow for the Body comp tile. Direction is the HONEST direction of
 * change; color grades it (rising FFMI good, rising BF% flagged, flat
 * neutral). `threshold` is the per-month dead zone.
 */
function bodyCompArrow(
  ratePerMonth: number,
  threshold: number,
  risingIsGood: boolean
): { icon: string; color: string } {
  if (ratePerMonth > threshold) {
    return { icon: '↑', color: risingIsGood ? 'text-success-400' : 'text-warning-400' };
  }
  if (ratePerMonth < -threshold) {
    return { icon: '↓', color: risingIsGood ? 'text-danger-400' : 'text-success-400' };
  }
  return { icon: '→', color: 'text-surface-400' };
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
  bodyComp = null,
  sleep = null,
  onLogSleep,
  onLogWeight,
  phase = 'maintenance',
  eatingWindow,
}: MetricTileGridProps) {
  // Show the tile when anything was classified OR lifts are accruing history
  // (a brand-new program should read "rebuilding", not vanish).
  const showLifts = !!liftTrends && (liftTrends.lifts.length > 0 || liftTrends.insufficientData > 0);
  // The Sleep tile fills the grid's empty slot whenever it can open its log
  // sheet — its empty state IS the "Log sleep" affordance, so no data gate.
  const showSleep = !!sleep && !!onLogSleep;
  const hasAnyTile =
    volume !== null || !!nutritionTargets || !!latestWeight || showLifts || !!bodyComp || showSleep;
  // Confident lifts drive the headline; low-confidence lifts (window spans a
  // program switch) are "rebuilding" and shouldn't read as stagnation.
  const confidentLifts = liftTrends ? liftTrends.rising + liftTrends.flat + liftTrends.down : 0;
  const rebuildingLifts = liftTrends ? liftTrends.rebuilding + liftTrends.insufficientData : 0;
  if (!hasAnyTile) return null;

  // Nutrition: what's LEFT for the day (the actionable number), not consumed.
  const kcalLeft = nutritionTargets ? Math.round(nutritionTargets.calories - nutritionTotals.calories) : 0;
  const proteinLeft = nutritionTargets ? Math.round(nutritionTargets.protein - nutritionTotals.protein) : 0;
  // Same engine as the Log page's macro grid, so both surfaces agree.
  const kcalVerdict = intakePaceVerdict(
    nutritionTotals.calories,
    nutritionTargets?.calories ?? null,
    undefined,
    phase,
    eatingWindow
  );
  const kcalPaceColor =
    kcalVerdict.tone === 'yellow'
      ? 'text-warning-400'
      : kcalVerdict.tone === 'orange'
        ? 'text-orange-400'
        : 'text-surface-500';

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
          <div className={`text-[11px] mt-1.5 ${kcalPaceColor}`}>
            {proteinLeft > 0 ? `${proteinLeft}g protein to go` : 'protein target hit'}
            {/* No pace judgment before/at the start of the eating window */}
            {!kcalVerdict.suppressed && <> · {kcalVerdict.status}</>}
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
          // Tile body opens the Body hub (Progress → Body); "+ log" opens
          // the unified log sheet (MetricTile keeps it from navigating).
          href="/dashboard/analytics?tab=body"
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
      {bodyComp && (
        <MetricTile
          icon={IconGauge}
          label="Body comp"
          // Lands on the Body Composition Trend module with the Composition
          // Map open (?section= scroll target + initial view).
          href={`/dashboard/analytics?tab=body&section=${BODY_COMP_TREND_SECTION_ID}`}
        >
          {(() => {
            const bfArrow = bodyCompArrow(bodyComp.bodyFatRatePerMonth, 0.1, false);
            const ffmiArrow = bodyCompArrow(bodyComp.ffmiRatePerMonth, 0.05, true);
            return (
              <>
                <div className="text-xl font-semibold text-surface-100">
                  {bodyComp.bodyFatPercent.toFixed(1)}
                  <span className="text-sm text-surface-500 font-normal">% BF</span>
                  <span className={`text-sm ml-1 ${bfArrow.color}`} aria-hidden="true">
                    {bfArrow.icon}
                  </span>
                </div>
                <div className="text-sm text-surface-300 mt-1.5">
                  FFMI {bodyComp.ffmi.toFixed(1)}
                  <span className={`ml-1 ${ffmiArrow.color}`} aria-hidden="true">
                    {ffmiArrow.icon}
                  </span>
                </div>
                <div className="text-[11px] text-surface-500 mt-1.5">
                  DEXA-anchored · {bodyComp.scanCount} scans
                </div>
              </>
            );
          })()}
        </MetricTile>
      )}
      {showSleep && sleep && onLogSleep && <SleepTile sleep={sleep} onLog={onLogSleep} />}
    </div>
  );
}
