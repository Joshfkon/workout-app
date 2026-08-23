'use client';

/**
 * ~12-week per-session trend sparkline for the workout card's expanded
 * history detail (below the Last Workout block).
 *
 * Data comes from the same cached-first query as the exercise detail sheet
 * (hooks/useExerciseDetailHistory), so expanding mid-workout paints from the
 * persisted cache; all derivation is pure (services/exerciseDetailAnalytics
 * .buildSessionSparkline). While the first-ever fetch is in flight — or when
 * the window holds fewer than two sessions — the component renders nothing:
 * one point isn't a trend, and the compact panel gets no spinner.
 */

import { useMemo } from 'react';
import { useExerciseDetailHistory } from '@/hooks/useExerciseDetailHistory';
import {
  buildSessionSparkline,
  SPARKLINE_WINDOW_DAYS,
  type SparklineMetric,
} from '@/services/exerciseDetailAnalytics';
import { convertWeightForDisplay, formatWeightValue } from '@/lib/utils';
import { now as clockNow } from '@/lib/clock';
import type { WeightUnit } from '@/types/schema';

const METRIC_LABELS: Record<SparklineMetric, string> = {
  e1rm: 'est. 1RM',
  volume: 'session volume',
  duration: 'time under load',
};

interface ExerciseHistorySparklineProps {
  exerciseId: string;
  /** Which per-session number to plot — follows the progression model. */
  metric: SparklineMetric;
  unit: WeightUnit;
}

export function ExerciseHistorySparkline({
  exerciseId,
  metric,
  unit,
}: ExerciseHistorySparklineProps) {
  const query = useExerciseDetailHistory(exerciseId, true);

  const points = useMemo(
    () => buildSessionSparkline(query.data ?? [], metric, clockNow()),
    [query.data, metric]
  );

  if (points.length < 2) return null;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  // Same tiny-polyline idiom as the dashboard tiles (MetricTileGrid.Sparkline):
  // 0–100 x, 26-high viewBox with a 3-unit margin, stretched to the container.
  const polylinePoints = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 20 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Endpoint numbers in the display domain: e1RM through the same
  // plate-increment rounding as the card's "Estimated 1RM" line; tonnage
  // converted exactly to whole display units (plate rounding is meaningless
  // on a 6,400-lb total); duration is plain seconds. The delta is computed
  // BETWEEN the displayed numbers so the two can never disagree.
  const toDisplay = (v: number) =>
    metric === 'duration'
      ? Math.round(v)
      : metric === 'volume'
        ? convertWeightForDisplay(v, unit, 0)
        : formatWeightValue(v, unit);
  const firstDisplay = toDisplay(values[0]);
  const latestDisplay = toDisplay(values[values.length - 1]);
  const delta = parseFloat((latestDisplay - firstDisplay).toFixed(1));

  const unitSuffix = unit === 'lb' ? 'lbs' : 'kg';
  const formatValue = (v: number) =>
    metric === 'duration' ? `${v}s` : `${v.toLocaleString('en-US')} ${unitSuffix}`;
  const deltaLabel = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('en-US')}${
    metric === 'duration' ? 's' : ''
  }`;

  return (
    <div className="p-3 bg-surface-800/50 rounded-lg" data-testid="history-sparkline">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-surface-400 uppercase tracking-wider">
          Last {Math.round(SPARKLINE_WINDOW_DAYS / 7)} Weeks
        </span>
        <span className="text-xs text-surface-500">
          {METRIC_LABELS[metric]} · {points.length} sessions
        </span>
      </div>
      <svg
        viewBox="0 0 100 26"
        className="w-full h-8 mt-2 text-primary-400"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-surface-500">{formatValue(firstDisplay)}</span>
        <span>
          <span className="text-surface-200">{formatValue(latestDisplay)}</span>{' '}
          <span
            className={
              delta > 0
                ? 'text-success-400'
                : delta < 0
                  ? 'text-danger-400'
                  : 'text-surface-500'
            }
            data-testid="history-sparkline-delta"
          >
            {deltaLabel}
          </span>
        </span>
      </div>
    </div>
  );
}
