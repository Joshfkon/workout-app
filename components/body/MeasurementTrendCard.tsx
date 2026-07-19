'use client';

/**
 * Per-site tape measurement trend (Body hub). One line chart per selected
 * site over the selected date range — site list identical to the entry form /
 * ratio analytics (MEASUREMENT_FIELDS). Self-fetching; refetches when
 * refreshKey bumps (after the unified log sheet or the measurements grid
 * saves).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { createUntypedClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import {
  MEASUREMENT_FIELDS,
  type Measurements,
} from '@/components/dashboard/BodyMeasurements';
import { cmToIn, getLocalDateString } from '@/lib/utils';

interface MeasurementTrendCardProps {
  /** Tape unit follows the app-wide weight unit (lb → in, kg → cm). */
  tapeUnit: 'in' | 'cm';
  refreshKey?: number;
}

type MeasurementRow = Measurements & { logged_at: string };

// Selectable chart windows. `days: null` = no cutoff (full history).
const DATE_RANGES = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 91 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
] as const;
type DateRangeKey = (typeof DATE_RANGES)[number]['key'];

export function MeasurementTrendCard({ tapeUnit, refreshKey = 0 }: MeasurementTrendCardProps) {
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [site, setSite] = useState<keyof Measurements | ''>('');
  const [range, setRange] = useState<DateRangeKey>('1y');

  useEffect(() => {
    async function fetchAll() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        // Full history — the range selector filters client-side so "All"
        // and shorter windows never need a refetch.
        const { data } = await supabase
          .from('body_measurements')
          .select('*')
          .eq('user_id', user.id)
          .order('logged_at', { ascending: true });
        setRows((data ?? []) as MeasurementRow[]);
      } catch (err) {
        console.error('Failed to load measurement history:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
  }, [refreshKey]);

  /** Sites with at least one logged value, in canonical field order. */
  const availableSites = useMemo(
    () =>
      MEASUREMENT_FIELDS.filter((field) =>
        rows.some((row) => row[field.key] != null)
      ),
    [rows]
  );

  // Default to the first site with enough data for an actual trend.
  useEffect(() => {
    if (site || availableSites.length === 0) return;
    const withTrend = availableSites.find(
      (field) => rows.filter((row) => row[field.key] != null).length >= 2
    );
    setSite((withTrend ?? availableSites[0]).key);
  }, [availableSites, rows, site]);

  // Local-timezone YYYY-MM-DD cutoff for the selected range (string compare
  // works because logged_at is a YYYY-MM-DD date column).
  const rangeCutoff = useMemo(() => {
    const days = DATE_RANGES.find((r) => r.key === range)?.days ?? null;
    if (days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return getLocalDateString(d);
  }, [range]);

  /** All chart points for the site, before the date-range cut. */
  const sitePointCount = useMemo(
    () => (site ? rows.filter((row) => row[site] != null).length : 0),
    [rows, site]
  );

  const chartData = useMemo(() => {
    if (!site) return [];
    return rows
      .filter(
        (row) =>
          row[site] != null && (rangeCutoff == null || row.logged_at >= rangeCutoff)
      )
      .map((row) => ({
        label: new Date(`${row.logged_at}T00:00:00`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        value:
          Math.round((tapeUnit === 'in' ? cmToIn(Number(row[site])) : Number(row[site])) * 10) /
          10,
      }));
  }, [rows, site, tapeUnit, rangeCutoff]);

  if (!isLoading && rows.length === 0) return null; // nothing to trend yet

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Measurement Trends</CardTitle>
          {availableSites.length > 0 && (
            <select
              value={site}
              onChange={(e) => setSite(e.target.value as keyof Measurements)}
              className="px-2 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-200 text-xs"
              aria-label="Measurement site"
            >
              {availableSites.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!isLoading && rows.length > 0 && (
          <div className="flex gap-1 mb-3" role="group" aria-label="Date range">
            {DATE_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                data-testid={`measurement-trend-range-${r.key}`}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  range === r.key
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                }`}
                aria-pressed={range === r.key}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
        {isLoading ? (
          <div className="h-48 animate-pulse bg-surface-800/50 rounded-lg" />
        ) : chartData.length < 2 ? (
          <p className="text-sm text-surface-500 py-6 text-center">
            {sitePointCount >= 2
              ? 'Fewer than two entries in this date range — try a longer range.'
              : 'Log this site a couple of times to see its trend.'}
          </p>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} minTickGap={24} />
                <YAxis
                  stroke="#9ca3af"
                  fontSize={11}
                  domain={['auto', 'auto']}
                  width={40}
                  unit={tapeUnit === 'in' ? '"' : ''}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1f2937',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    color: '#f3f4f6',
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [`${value} ${tapeUnit}`, '']}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#818cf8"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
