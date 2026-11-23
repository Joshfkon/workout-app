'use client';

import { IconBowl, IconMoon, IconChartLine } from '@tabler/icons-react';
import { ListGroup, ListRow } from '@/components/ui';
import { formatSleepHours } from '@/lib/sleep/formatSleep';
import { getDisplayWeight } from '@/lib/weightUtils';
import type { LiftTrendsSummary } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { SleepLogEntry } from '@/types/schema';
import type { PaceStatus } from './intakePace';
import type { GlanceNutritionTotals, GlanceVolumeSummary, GlanceWeightRate } from './MetricTileGrid';

export interface TodayCardProps {
  nutritionTotals: GlanceNutritionTotals;
  nutritionTargets: { calories: number; protein: number } | null;
  /** Calorie pace word; null before the eating window (no judgement yet). */
  kcalPace: PaceStatus | null;
  lastNight: SleepLogEntry | null;
  stepsToday: number | null;
  /** HRV vs the user's 14-day baseline, in percent (negative = below). */
  hrvDeltaPct: number | null;
  /** Today's check-in readiness (0–100), if done. */
  readiness: number | null;
  liftTrends: LiftTrendsSummary | null;
  volume: GlanceVolumeSummary | null;
  latestWeight: { weight: number; unit: string } | null;
  weightRate: GlanceWeightRate | null;
  weightUnit: 'lb' | 'kg';
  /** Food-only (hooks/useTrackingFocus): no lifts or weekly sets in the copy. */
  foodOnly?: boolean;
  /** Opens the Today sheet (recovery, tiles, weekly sets). */
  onOpenDetails: () => void;
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

function eatRow({ nutritionTotals, nutritionTargets, kcalPace }: TodayCardProps) {
  if (!nutritionTargets) {
    return { value: undefined, subtitle: 'Set calorie and protein targets' };
  }
  const left = Math.round(nutritionTargets.calories - nutritionTotals.calories);
  const proteinLeft = Math.round(nutritionTargets.protein - nutritionTotals.protein);
  const value = left >= 0 ? `${left.toLocaleString()} left` : `${Math.abs(left).toLocaleString()} over`;
  const protein = proteinLeft > 0 ? `${proteinLeft} g protein to go` : 'Protein target hit';
  return { value, subtitle: kcalPace ? `${protein} · ${kcalPace}` : protein };
}

function recoveryRow({ lastNight, stepsToday, hrvDeltaPct, readiness }: TodayCardProps) {
  const parts: string[] = [];
  if (stepsToday !== null) parts.push(`${stepsToday.toLocaleString()} steps`);
  if (hrvDeltaPct !== null) {
    parts.push(
      Math.abs(hrvDeltaPct) < 5 ? 'HRV at your usual' : `HRV ${Math.abs(hrvDeltaPct)}% ${hrvDeltaPct < 0 ? 'below' : 'above'} usual`
    );
  }
  if (readiness !== null) parts.push(`readiness ${readiness}`);
  return {
    value: lastNight ? `${formatSleepHours(lastNight.hours)} sleep` : undefined,
    subtitle: parts.length > 0 ? parts.join(' · ') : lastNight ? 'Last night' : 'Sleep, steps and HRV',
  };
}

function weekRow({ liftTrends, volume, latestWeight, weightRate, weightUnit, foodOnly }: TodayCardProps) {
  const parts: string[] = [];
  if (!foodOnly && liftTrends && liftTrends.rising + liftTrends.flat + liftTrends.down > 0) {
    parts.push(`${liftTrends.rising} lift${liftTrends.rising === 1 ? '' : 's'} rising`);
  }
  if (latestWeight) {
    const display = getDisplayWeight(latestWeight.weight, latestWeight.unit as 'lb' | 'kg' | null, weightUnit);
    const w = `${display.toFixed(1)} ${weightUnit}`;
    parts.push(weightRate ? `${w}, ${signed(weightRate.perWeek)} ${weightUnit}/wk` : w);
  }
  const low = foodOnly ? 0 : volume?.lowCount ?? 0;
  return {
    value: low > 0 ? `${low} behind` : undefined,
    subtitle: parts.length > 0 ? parts.join(' · ') : foodOnly ? 'Your weight trend' : 'Lifts, weekly sets, weight',
  };
}

/**
 * Home "Today" card (design system list rows): Eat, Recovery and This week,
 * one line each. Eat opens the Eat tab; Recovery and This week open the Today
 * sheet, where the full tiles, Apple Health and weekly-set details live.
 */
export function TodayCard(props: TodayCardProps) {
  const eat = eatRow(props);
  const recovery = recoveryRow(props);
  const week = weekRow(props);
  return (
    <ListGroup title="Today">
      <ListRow
        icon={<IconBowl size={18} />}
        title="Eat"
        subtitle={eat.subtitle}
        value={eat.value}
        href="/dashboard/nutrition"
      />
      <ListRow
        icon={<IconMoon size={18} />}
        title="Recovery"
        subtitle={recovery.subtitle}
        value={recovery.value}
        onClick={props.onOpenDetails}
      />
      <ListRow
        icon={<IconChartLine size={18} />}
        title="This week"
        subtitle={week.subtitle}
        value={week.value}
        onClick={props.onOpenDetails}
      />
    </ListGroup>
  );
}
