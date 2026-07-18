'use client';

/**
 * Body hub trend charts (Progress → Body):
 *
 *   1. Weight trend — the (previously orphaned) WeightGraph over weight_log.
 *   2. Body composition trend — BF% / lean mass / FFMI over time from
 *      services/bodyCompAnchor: a continuous estimate driven by bodyweight,
 *      re-anchored so it passes EXACTLY through every DEXA scan. DEXA points
 *      render as distinct large markers; everything between them is an
 *      estimate drawn as a plain line.
 *
 * Data arrives via props (page-level useBodyCompTrend) so the FFMI gauge and
 * this chart derive from the SAME anchored series. The x-axis is a true time
 * scale, and estimate segments spanning > LOW_CONFIDENCE_GAP_DAYS without
 * weigh-ins render dashed at reduced opacity — interpolation across a
 * months-long void must not look like densely-supported data.
 *
 * FFMI here is the RAW value (FFM / height m²), same function as the gauge
 * (bodyCompEngine.computeFFMI); the height-normalized variant is shown as a
 * clearly-labeled secondary readout, never silently substituted.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { WeightGraph, type PhaseBandSpan } from '@/components/analytics/WeightGraph';
import {
  findLowConfidenceGaps,
  LOW_CONFIDENCE_GAP_DAYS,
  type AnchoredTrendPoint,
} from '@/services/bodyCompAnchor';
import { computeFFMI } from '@/services/bodyCompEngine';
import {
  BODY_COMP_TREND_SECTION_ID,
  MIN_SCANS_FOR_COMPOSITION_MAP,
  type CompositionTargetInput,
} from '@/services/compositionSpace';
import { CompositionMap } from '@/components/body/CompositionMap';
import type { WeightHistoryEntry } from '@/hooks/useBodyCompTrend';
import { kgToLbs } from '@/lib/utils';
import type { Goal, Experience } from '@/types/schema';

interface BodyHubTrendsProps {
  units: 'lb' | 'kg';
  /** Height from the user profile; without it the FFMI toggle is hidden. */
  heightCm: number | null;
  /** Anchored trend from useBodyCompTrend — shared with the FFMI gauge. */
  trend: AnchoredTrendPoint[];
  /** Raw weigh-ins for the weight chart. */
  weightHistory: WeightHistoryEntry[];
  isLoading: boolean;
  /** Training phase for the Composition Map's p-ratio framing. */
  phase?: Goal | null;
  /** Active composition target for the map's goal vector. */
  target?: CompositionTargetInput | null;
  /** Current phase start (e.g. active target's createdAt). */
  phaseStartDate?: string | null;
  /** Profile sex — athletic zone + cut-milestone BF% on the map. */
  sex?: 'male' | 'female';
  /** Training age — scales the map's suggested bulk milestone. */
  experience?: Experience | null;
  /** Persist a suggested milestone as the active target. */
  onSetTarget?: (target: { targetFfmi: number; targetBodyFatPercent: number }) => void | Promise<void>;
  /** Deep links can open a specific view (e.g. 'map' from the Home card). */
  initialMetric?: CompMetric;
  /** Training-phase spans drawn as background bands on the weight chart. */
  phaseSpans?: PhaseBandSpan[];
}

export type CompMetric = 'bodyFat' | 'leanMass' | 'ffmi' | 'map';

interface ChartRow {
  ts: number;
  solid: number | null;
  anchorValue?: number;
  [key: `gap${number}`]: number | undefined;
}

/** Thresholds mirrored from the FFMI gauge's scale markers. */
const FFMI_THRESHOLDS = [
  { value: 18, label: '18 avg' },
  { value: 20, label: '20 above avg' },
  { value: 22, label: '22 excellent' },
  { value: 25, label: '25 natural limit' },
];

function toTs(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

export function BodyHubTrends({
  units,
  heightCm,
  trend,
  weightHistory,
  isLoading,
  phase = null,
  target = null,
  phaseStartDate = null,
  sex = 'male',
  experience = null,
  onSetTarget,
  initialMetric,
  phaseSpans,
}: BodyHubTrendsProps) {
  const [metric, setMetric] = useState<CompMetric>(initialMetric ?? 'bodyFat');

  const dexaCount = useMemo(
    () => trend.filter((p) => p.kind === 'dexa').length,
    [trend]
  );

  // Which metric options exist: FFMI and the Composition Map need a profile
  // height; the map additionally needs ≥2 scans to have a path to draw.
  const metricOptions = useMemo(() => {
    const options: { value: CompMetric; label: string }[] = [
      { value: 'bodyFat', label: 'BF %' },
      { value: 'leanMass', label: 'Lean mass' },
    ];
    if (heightCm) options.push({ value: 'ffmi', label: 'FFMI' });
    if (heightCm && dexaCount >= MIN_SCANS_FOR_COMPOSITION_MAP) {
      options.push({ value: 'map', label: 'Map' });
    }
    return options;
  }, [heightCm, dexaCount]);

  // A deep link may ask for a view that isn't available (no height / <2
  // scans) — fall back rather than rendering an orphaned state.
  const activeMetric = metricOptions.some((o) => o.value === metric)
    ? metric
    : 'bodyFat';

  // Deep-linked view (e.g. ?section= → 'map'): the option it targets only
  // exists after the trend data loads, so apply it once it becomes valid —
  // and never again, so it can't stomp a manual toggle later.
  const appliedInitialMetric = useRef(false);
  useEffect(() => {
    if (appliedInitialMetric.current || !initialMetric) return;
    if (metricOptions.some((o) => o.value === initialMetric)) {
      appliedInitialMetric.current = true;
      setMetric(initialMetric);
    }
  }, [initialMetric, metricOptions]);

  const { rows, gapCount } = useMemo(() => {
    const valueOf = (point: AnchoredTrendPoint): number | null => {
      switch (activeMetric) {
        case 'bodyFat':
          return point.bodyFatPercent;
        case 'leanMass':
          return units === 'lb'
            ? Math.round(kgToLbs(point.leanMassKg) * 10) / 10
            : point.leanMassKg;
        case 'ffmi':
          // Same function as the Analytics gauge — single source of truth.
          return heightCm
            ? computeFFMI(point.leanMassKg, point.boneMassKg, heightCm).ffmi
            : null;
        case 'map':
          // The map renders its own component; no time-series rows needed.
          return null;
      }
    };

    const dataRows: ChartRow[] = trend.map((point) => {
      const value = valueOf(point);
      return {
        ts: toTs(point.date),
        solid: value,
        // Scatter series: only DEXA anchors carry a value.
        anchorValue: point.kind === 'dexa' && value != null ? value : undefined,
      };
    });

    // Long spans without weigh-ins: the solid line breaks there and a dashed
    // low-confidence segment bridges the two supported endpoints instead.
    const gaps = findLowConfidenceGaps(trend.map((p) => p.date));
    const breakers: ChartRow[] = gaps.map((gap, k) => {
      dataRows[gap.fromIndex][`gap${k}`] = dataRows[gap.fromIndex].solid ?? undefined;
      dataRows[gap.toIndex][`gap${k}`] = dataRows[gap.toIndex].solid ?? undefined;
      // Synthetic null point mid-gap so the solid line doesn't span it.
      return {
        ts: (dataRows[gap.fromIndex].ts + dataRows[gap.toIndex].ts) / 2,
        solid: null,
      };
    });

    return {
      rows: [...dataRows, ...breakers].sort((a, b) => a.ts - b.ts),
      gapCount: gaps.length,
    };
  }, [trend, activeMetric, units, heightCm]);

  // Latest FFMI for the labeled normalized readout under the chart.
  const latestFfmi = useMemo(() => {
    if (!heightCm || trend.length === 0) return null;
    const last = trend[trend.length - 1];
    return computeFFMI(last.leanMassKg, last.boneMassKg, heightCm);
  }, [trend, heightCm]);

  const unitSuffix = activeMetric === 'bodyFat' ? '%' : activeMetric === 'leanMass' ? ` ${units}` : '';

  const formatTick = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Weight trend */}
      {weightHistory.length >= 2 && (
        <WeightGraph weightHistory={weightHistory} preferredUnit={units} phases={phaseSpans} />
      )}

      {/* BF% / lean mass / FFMI anchored trend + Composition Map.
          The id anchors ?section= deep links (e.g. from the Home card). */}
      <div id={BODY_COMP_TREND_SECTION_ID} className="scroll-mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>
              {activeMetric === 'map' ? 'Composition Map' : 'Body Composition Trend'}
            </CardTitle>
            <div className="inline-flex bg-surface-800 rounded-lg p-1">
              {metricOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMetric(option.value)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                    activeMetric === option.value
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-56 animate-pulse bg-surface-800/50 rounded-lg" />
          ) : trend.length === 0 ? (
            <p className="text-sm text-surface-500 py-8 text-center">
              Log a DEXA scan to unlock the composition trend — bodyweight
              alone can&apos;t estimate body fat.
            </p>
          ) : activeMetric === 'map' && heightCm ? (
            <CompositionMap
              trend={trend}
              heightCm={heightCm}
              units={units}
              phase={phase}
              target={target}
              phaseStartDate={phaseStartDate}
              sex={sex}
              experience={experience}
              onSetTarget={onSetTarget}
            />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    {/* True time scale: equal durations get equal width. */}
                    <XAxis
                      dataKey="ts"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={formatTick}
                      stroke="#9ca3af"
                      fontSize={11}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#9ca3af"
                      fontSize={11}
                      domain={
                        activeMetric === 'ffmi'
                          ? [
                              (dataMin: number) => Math.floor(Math.min(dataMin - 0.3, 17.5)),
                              (dataMax: number) => Math.ceil(Math.max(dataMax + 0.3, 25.2)),
                            ]
                          : ['auto', 'auto']
                      }
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#f3f4f6',
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) => [
                        `${value}${unitSuffix}`,
                        name,
                      ]}
                      labelFormatter={(ts: number) =>
                        new Date(ts).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      }
                    />
                    {/* FFMI thresholds — same values as the gauge's scale. */}
                    {activeMetric === 'ffmi' &&
                      FFMI_THRESHOLDS.map((threshold) => (
                        <ReferenceLine
                          key={threshold.value}
                          y={threshold.value}
                          stroke="#6b7280"
                          strokeDasharray="3 3"
                          strokeOpacity={0.5}
                          ifOverflow="hidden"
                          label={{
                            value: threshold.label,
                            position: 'insideBottomRight',
                            fontSize: 9,
                            fill: '#6b7280',
                          }}
                        />
                      ))}
                    {/* Estimated trend: plain line, no per-point markers */}
                    <Line
                      type="monotone"
                      dataKey="solid"
                      name="Estimate"
                      stroke="#818cf8"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {/* Low-confidence bridges across weigh-in gaps */}
                    {Array.from({ length: gapCount }, (_, k) => (
                      <Line
                        key={`gap${k}`}
                        type="linear"
                        dataKey={`gap${k}`}
                        name="Estimate (sparse data)"
                        stroke="#818cf8"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        strokeOpacity={0.5}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    {/* DEXA anchors: distinct, larger markers */}
                    <Scatter
                      dataKey="anchorValue"
                      name="DEXA scan"
                      fill="#22d3ee"
                      shape={(props: { cx?: number; cy?: number }) =>
                        props.cx != null && props.cy != null ? (
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={5}
                            fill="#22d3ee"
                            stroke="#0e7490"
                            strokeWidth={2}
                          />
                        ) : (
                          <g />
                        )
                      }
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-surface-500 mt-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 align-middle mr-1" />
                DEXA scans (measured) · line between scans is an estimate
                re-anchored to pass through every scan
                {gapCount > 0 && (
                  <>
                    {' '}· dashed = spans &gt;{LOW_CONFIDENCE_GAP_DAYS} days
                    without weigh-ins (low confidence)
                  </>
                )}
                .
              </p>
              {activeMetric === 'ffmi' && latestFfmi && (
                <p className="text-[11px] text-surface-500 mt-1">
                  Chart shows raw FFMI (fat-free mass / height m²) · latest{' '}
                  {latestFfmi.ffmi} · height-normalized:{' '}
                  {latestFfmi.normalizedFfmi}
                  {trend[trend.length - 1].boneMassKg == null &&
                    ' · bone mass not logged — FFMI uses lean mass only'}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
