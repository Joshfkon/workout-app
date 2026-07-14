'use client';

/**
 * Wellness Trends — ONE card replacing the nine stacked full-height wellness
 * charts. A single chart with metric chips (Sleep, Soreness, Energy, Mood up
 * front; Focus / Stress / Hunger / Libido / Hydration / Cardio behind
 * "More ▾"), plus a 2-column sparkline summary grid for at-a-glance.
 *
 * Honesty rules:
 *  - Metrics with no data in the selected range never render as empty
 *    full-height charts — they appear only inside "More" with an inline log
 *    affordance.
 *  - Inverted-scale metrics (soreness / stress / hunger) plot on a NORMAL
 *    axis with a "lower is better" footnote — axes are never flipped.
 *  - The card honors the page's global time-range selector (the data
 *    passed in is already range-scoped).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface WellnessCheckInPoint {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  energyLevel: number | null;
  moodRating: number | null;
  focusRating: number | null;
  libidoRating: number | null;
  stressLevel: number | null;
  sorenessLevel: number | null;
  hungerLevel: number | null;
}

export interface WellnessTrendsCardProps {
  checkInData: WellnessCheckInPoint[];
  hydrationData: Array<{ date: string; totalMl: number }>;
  cardioData: Array<{ date: string; totalMinutes: number; modality: string }>;
  /** 'ml' for kg users, 'oz' for lb users — same derivation as the tracker. */
  hydrationUnit: 'ml' | 'oz';
  /** Human label for the selected range, e.g. "this month". */
  rangeLabel: string;
}

type MetricKey =
  | 'sleepHours'
  | 'sleepQuality'
  | 'sorenessLevel'
  | 'energyLevel'
  | 'moodRating'
  | 'focusRating'
  | 'stressLevel'
  | 'hungerLevel'
  | 'libidoRating'
  | 'hydration'
  | 'cardio';

interface MetricDef {
  key: MetricKey;
  label: string;
  color: string;
  /** Chart Y domain; null = auto. */
  domain: [number, number] | null;
  lowerIsBetter: boolean;
  /** Format a value for tooltip / sparkline tile. */
  format: (v: number) => string;
  /** Optional target reference line. */
  targetLine?: { y: number; label: string };
}

const ML_PER_OZ = 29.5735;

function metricDefs(hydrationUnit: 'ml' | 'oz'): MetricDef[] {
  return [
    {
      key: 'sleepHours',
      label: 'Sleep',
      color: '#8b5cf6',
      domain: [0, 12],
      lowerIsBetter: false,
      format: (v) => `${v.toFixed(1)} h`,
      targetLine: { y: 7, label: 'Target' },
    },
    {
      key: 'sleepQuality',
      label: 'Sleep quality',
      color: '#6366f1',
      domain: [1, 5],
      lowerIsBetter: false,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'sorenessLevel',
      label: 'Soreness',
      color: '#a855f7',
      domain: [1, 5],
      lowerIsBetter: true,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'energyLevel',
      label: 'Energy',
      color: '#f59e0b',
      domain: [1, 5],
      lowerIsBetter: false,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'moodRating',
      label: 'Mood',
      color: '#ec4899',
      domain: [1, 5],
      lowerIsBetter: false,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'focusRating',
      label: 'Focus',
      color: '#06b6d4',
      domain: [1, 5],
      lowerIsBetter: false,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'stressLevel',
      label: 'Stress',
      color: '#ef4444',
      domain: [1, 5],
      lowerIsBetter: true,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'hungerLevel',
      label: 'Hunger',
      color: '#14b8a6',
      domain: [1, 5],
      lowerIsBetter: true,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'libidoRating',
      label: 'Libido',
      color: '#f97316',
      domain: [1, 5],
      lowerIsBetter: false,
      format: (v) => `${v.toFixed(1)}/5`,
    },
    {
      key: 'hydration',
      label: 'Hydration',
      color: '#3b82f6',
      domain: null,
      lowerIsBetter: false,
      format: (v) =>
        hydrationUnit === 'oz' ? `${Math.round(v)} oz` : `${Math.round(v)} ml`,
    },
    {
      key: 'cardio',
      label: 'Cardio',
      color: '#10b981',
      domain: null,
      lowerIsBetter: false,
      format: (v) => `${Math.round(v)} min`,
    },
  ];
}

/** Chips shown up-front (when they have data); everything else lives in More. */
const PRIMARY_KEYS: MetricKey[] = ['sleepHours', 'sorenessLevel', 'energyLevel', 'moodRating'];

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 24 - ((v - min) / range) * 18 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 24" className="w-full h-6" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WellnessTrendsCard({
  checkInData,
  hydrationData,
  cardioData,
  hydrationUnit,
  rangeLabel,
}: WellnessTrendsCardProps) {
  const defs = useMemo(() => metricDefs(hydrationUnit), [hydrationUnit]);

  // Per-metric series in date order (only days where the metric was logged).
  const seriesByKey = useMemo(() => {
    const map = new Map<MetricKey, Array<{ date: string; value: number }>>();
    for (const def of defs) {
      if (def.key === 'hydration') {
        map.set(
          def.key,
          hydrationData.map((d) => ({
            date: d.date,
            value: hydrationUnit === 'oz' ? d.totalMl / ML_PER_OZ : d.totalMl,
          }))
        );
      } else if (def.key === 'cardio') {
        map.set(
          def.key,
          cardioData.map((d) => ({ date: d.date, value: d.totalMinutes }))
        );
      } else {
        // def.key is a check-in metric here (hydration/cardio handled above).
        const ciKey = def.key as keyof Omit<WellnessCheckInPoint, 'date'>;
        map.set(
          def.key,
          checkInData
            .filter((d) => d[ciKey] != null)
            .map((d) => ({ date: d.date, value: d[ciKey] as number }))
        );
      }
    }
    return map;
  }, [defs, checkInData, hydrationData, cardioData, hydrationUnit]);

  const hasData = (key: MetricKey) => (seriesByKey.get(key)?.length ?? 0) > 0;

  // Primary chips = primary metrics that actually have data in range.
  const primaryDefs = defs.filter((d) => PRIMARY_KEYS.includes(d.key) && hasData(d.key));
  // Everything else (secondary metrics + empty primaries) lives under More.
  const moreDefs = defs.filter((d) => !primaryDefs.includes(d));

  const [activeKey, setActiveKey] = useState<MetricKey | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const effectiveKey =
    activeKey && hasData(activeKey)
      ? activeKey
      : primaryDefs[0]?.key ?? defs.find((d) => hasData(d.key))?.key ?? null;
  const activeDef = defs.find((d) => d.key === effectiveKey) ?? null;
  const activeSeries = effectiveKey ? (seriesByKey.get(effectiveKey) ?? []) : [];

  // Sparkline tiles: every metric with data, in defs order.
  const tiles = defs.filter((d) => hasData(d.key));

  const anyData = tiles.length > 0;

  return (
    <Card data-testid="wellness-trends-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Wellness Trends</CardTitle>
            <p className="text-xs text-surface-500 mt-1">Showing {rangeLabel}</p>
          </div>
          {anyData && (
            <div className="flex items-center gap-1 flex-wrap">
              {primaryDefs.map((def) => (
                <button
                  key={def.key}
                  onClick={() => setActiveKey(def.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                    effectiveKey === def.key
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                  }`}
                  data-testid={`wellness-chip-${def.key}`}
                >
                  {def.label}
                </button>
              ))}
              <button
                onClick={() => setMoreOpen((o) => !o)}
                aria-expanded={moreOpen}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                  moreOpen || moreDefs.some((d) => d.key === effectiveKey)
                    ? 'bg-surface-700 text-surface-200'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                }`}
                data-testid="wellness-chip-more"
              >
                More ▾
              </button>
            </div>
          )}
        </div>
        {moreOpen && (
          <div className="flex items-center gap-1 flex-wrap mt-2" data-testid="wellness-more-row">
            {moreDefs.map((def) =>
              hasData(def.key) ? (
                <button
                  key={def.key}
                  onClick={() => setActiveKey(def.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                    effectiveKey === def.key
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                  }`}
                  data-testid={`wellness-chip-${def.key}`}
                >
                  {def.label}
                </button>
              ) : (
                // No data in range: never an empty chart — an inline log
                // affordance instead.
                <Link
                  key={def.key}
                  href="/dashboard/log"
                  className="px-2.5 py-1 text-xs rounded-lg bg-surface-800/60 text-surface-500 hover:text-surface-300 transition-colors"
                  data-testid={`wellness-log-${def.key}`}
                >
                  {def.label} · Log +
                </Link>
              )
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {!anyData ? (
          <div className="text-center py-8">
            <p className="text-sm text-surface-400">No wellness data for this period</p>
            <Link
              href="/dashboard/log"
              className="inline-block mt-2 text-xs text-primary-400 hover:text-primary-300"
            >
              Log today&apos;s check-in →
            </Link>
          </div>
        ) : (
          <>
            {activeDef && (
              <>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={activeSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="date"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      {/* Normal axis direction ALWAYS — inverted-scale metrics
                          get a footnote, not a flipped axis. */}
                      <YAxis
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        domain={activeDef.domain ?? ['auto', 'auto']}
                        width={36}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1f2937',
                          border: '1px solid #374151',
                          borderRadius: '8px',
                        }}
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          });
                        }}
                        formatter={(value: number) => [activeDef.format(value), activeDef.label]}
                      />
                      {activeDef.targetLine && (
                        <ReferenceLine
                          y={activeDef.targetLine.y}
                          stroke="#10b981"
                          strokeDasharray="3 3"
                          label={{
                            value: activeDef.targetLine.label,
                            position: 'right',
                            fill: '#10b981',
                            fontSize: 10,
                          }}
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={activeDef.color}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {activeDef.lowerIsBetter && (
                  <p className="text-[11px] text-surface-500 mt-1" data-testid="lower-is-better-note">
                    Lower is better for {activeDef.label.toLowerCase()}.
                  </p>
                )}
              </>
            )}

            {/* At-a-glance sparkline summary grid */}
            <div className="grid grid-cols-2 gap-2 mt-4" data-testid="wellness-sparkline-grid">
              {tiles.map((def) => {
                const series = seriesByKey.get(def.key)!;
                const latest = series[series.length - 1];
                const first = series[0];
                const delta = latest.value - first.value;
                const deltaGood = def.lowerIsBetter ? delta < 0 : delta > 0;
                return (
                  <button
                    key={def.key}
                    onClick={() => {
                      setActiveKey(def.key);
                      if (!PRIMARY_KEYS.includes(def.key)) setMoreOpen(true);
                    }}
                    className={`text-left p-2.5 rounded-lg border transition-colors ${
                      effectiveKey === def.key
                        ? 'border-primary-500/40 bg-primary-500/5'
                        : 'border-surface-800 bg-surface-800/40 hover:bg-surface-800'
                    }`}
                    data-testid={`wellness-tile-${def.key}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-surface-400">{def.label}</span>
                      {Math.abs(delta) >= 0.05 && (
                        <span
                          className={`text-[10px] ${deltaGood ? 'text-success-400' : 'text-warning-400'}`}
                        >
                          {delta > 0 ? '▲' : '▼'} {def.format(Math.abs(delta)).trim()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-surface-100 mt-0.5">
                      {def.format(latest.value)}
                    </p>
                    <Sparkline values={series.map((s) => s.value)} color={def.color} />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default WellnessTrendsCard;
