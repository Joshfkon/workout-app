'use client';

/**
 * Body hub trend charts (Progress → Body):
 *
 *   1. Weight trend — the (previously orphaned) WeightGraph over weight_log.
 *   2. Body composition trend — BF% / lean mass over time from
 *      services/bodyCompAnchor: a continuous estimate driven by bodyweight,
 *      re-anchored so it passes EXACTLY through every DEXA scan. DEXA points
 *      render as distinct large markers; everything between them is an
 *      estimate drawn as a plain line.
 *
 * Self-fetching so the (already enormous) analytics page only mounts it.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { createUntypedClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { WeightGraph } from '@/components/analytics/WeightGraph';
import {
  buildAnchoredBodyCompTrend,
  type AnchoredTrendPoint,
} from '@/services/bodyCompAnchor';
import { inputWeightToKg, kgToLbs } from '@/lib/utils';

interface WeightLogRow {
  logged_at: string;
  weight: number;
  unit: 'lb' | 'kg' | null;
}

interface DexaRow {
  scan_date: string;
  body_fat_percent: number;
  lean_mass_kg: number;
  fat_mass_kg: number;
}

interface BodyHubTrendsProps {
  units: 'lb' | 'kg';
  /** Bump to refetch after the log sheet saves something. */
  refreshKey?: number;
}

type CompMetric = 'bodyFat' | 'leanMass';

export function BodyHubTrends({ units, refreshKey = 0 }: BodyHubTrendsProps) {
  const [weightRows, setWeightRows] = useState<WeightLogRow[]>([]);
  const [scans, setScans] = useState<DexaRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [metric, setMetric] = useState<CompMetric>('bodyFat');

  useEffect(() => {
    async function fetchAll() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const yearAgo = new Date();
        yearAgo.setDate(yearAgo.getDate() - 365);
        const [weightsRes, scansRes] = await Promise.all([
          supabase
            .from('weight_log')
            .select('logged_at, weight, unit')
            .eq('user_id', user.id)
            .gte('logged_at', yearAgo.toISOString().slice(0, 10))
            .order('logged_at', { ascending: true }),
          supabase
            .from('dexa_scans')
            .select('scan_date, body_fat_percent, lean_mass_kg, fat_mass_kg')
            .eq('user_id', user.id)
            .order('scan_date', { ascending: true }),
        ]);

        setWeightRows((weightsRes.data ?? []) as WeightLogRow[]);
        setScans((scansRes.data ?? []) as DexaRow[]);
      } catch (err) {
        console.error('Failed to load body trend data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
  }, [refreshKey]);

  const weightHistory = useMemo(
    () =>
      weightRows.map((row) => ({
        date: row.logged_at,
        weight: row.weight,
        unit: (row.unit ?? 'lb') as 'lb' | 'kg',
      })),
    [weightRows]
  );

  const trend = useMemo(
    () =>
      buildAnchoredBodyCompTrend(
        weightRows.map((row) => ({
          date: row.logged_at,
          weightKg: inputWeightToKg(row.weight, row.unit ?? 'lb'),
        })),
        scans.map((scan) => ({
          date: scan.scan_date,
          bodyFatPercent: Number(scan.body_fat_percent),
          leanMassKg: Number(scan.lean_mass_kg),
          fatMassKg: Number(scan.fat_mass_kg),
        }))
      ),
    [weightRows, scans]
  );

  const chartData = useMemo(
    () =>
      trend.map((point) => ({
        ...point,
        label: new Date(`${point.date}T00:00:00`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        value:
          metric === 'bodyFat'
            ? point.bodyFatPercent
            : units === 'lb'
              ? Math.round(kgToLbs(point.leanMassKg) * 10) / 10
              : point.leanMassKg,
        // Scatter series: only DEXA anchors carry a value.
        anchorValue:
          point.kind === 'dexa'
            ? metric === 'bodyFat'
              ? point.bodyFatPercent
              : units === 'lb'
                ? Math.round(kgToLbs(point.leanMassKg) * 10) / 10
                : point.leanMassKg
            : undefined,
      })),
    [trend, metric, units]
  );

  const unitSuffix = metric === 'bodyFat' ? '%' : ` ${units}`;

  return (
    <div className="space-y-4">
      {/* Weight trend */}
      {weightHistory.length >= 2 && (
        <WeightGraph weightHistory={weightHistory} preferredUnit={units} />
      )}

      {/* BF% / lean mass anchored trend */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Body Composition Trend</CardTitle>
            <div className="inline-flex bg-surface-800 rounded-lg p-1">
              {(
                [
                  { value: 'bodyFat', label: 'BF %' },
                  { value: 'leanMass', label: 'Lean mass' },
                ] as { value: CompMetric; label: string }[]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMetric(option.value)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                    metric === option.value
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
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} minTickGap={24} />
                    <YAxis
                      stroke="#9ca3af"
                      fontSize={11}
                      domain={['auto', 'auto']}
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
                        name === 'anchorValue' ? 'DEXA scan' : 'Estimate',
                      ]}
                      labelFormatter={(label) => label}
                    />
                    {/* Estimated trend: plain line, no per-point markers */}
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="value"
                      stroke="#818cf8"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    {/* DEXA anchors: distinct, larger markers */}
                    <Scatter
                      dataKey="anchorValue"
                      name="anchorValue"
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
                re-anchored to pass through every scan.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
