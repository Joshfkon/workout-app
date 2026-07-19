'use client';

/**
 * Per-site tape measurement trends (Body hub). A Lift-Trends-style list —
 * one row per measured site with a direction badge, current value, fitted
 * monthly rate, and sparkline — plus a detail line chart for the selected
 * row. Site list identical to the entry form / ratio analytics
 * (MEASUREMENT_FIELDS). Self-fetching; refetches when refreshKey bumps
 * (after the unified log sheet or the measurements grid saves).
 *
 * The detail view also hosts the per-entry editor ("Edit entries") — the fix
 * path for a mislogged value (e.g. a calf logged as a thigh): each historical
 * entry for the selected site can be corrected inline or deleted.
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
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import {
  MEASUREMENT_FIELDS,
  type Measurements,
} from '@/components/dashboard/BodyMeasurements';
import {
  computeMeasurementTrends,
  MIN_POINTS_FOR_TREND,
  type MeasurementSiteTrend,
} from '@/lib/body/measurementTrends';
import { cmToIn, inToCm, getLocalDateString } from '@/lib/utils';
import {
  updateMeasurementSiteEntry,
  deleteMeasurementSiteEntry,
} from '@/lib/body/bodyLog';

interface MeasurementTrendCardProps {
  /** Tape unit follows the app-wide weight unit (lb → in, kg → cm). */
  tapeUnit: 'in' | 'cm';
  refreshKey?: number;
  /** Called after an entry is edited/deleted so sibling widgets refetch. */
  onDataChanged?: () => void;
}

type MeasurementRow = Measurements & { logged_at: string };

// Selectable chart windows. `days: null` = no cutoff (full history).
const DATE_RANGES = [
  { key: '1m', label: '1M', subtitle: 'last month', days: 30 },
  { key: '3m', label: '3M', subtitle: 'last 3 months', days: 91 },
  { key: '6m', label: '6M', subtitle: 'last 6 months', days: 182 },
  { key: '1y', label: '1Y', subtitle: 'last 12 months', days: 365 },
  { key: 'all', label: 'All', subtitle: 'all time', days: null },
] as const;
type DateRangeKey = (typeof DATE_RANGES)[number]['key'];

/** Tiny per-site trend line (same visual language as the Lift Trends list). */
function SiteSparkline({ trend }: { trend: MeasurementSiteTrend }) {
  const points = trend.history.map((p) => p.valueCm);
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const polyline = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 20 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const colorClass =
    trend.improving == null
      ? 'text-surface-500'
      : trend.improving
      ? 'text-success-400'
      : 'text-danger-400';
  return (
    <svg
      viewBox="0 0 100 26"
      className={`w-24 h-6 flex-shrink-0 ${colorClass}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DIRECTION_LABEL: Record<'rising' | 'flat' | 'down', string> = {
  rising: 'Rising',
  flat: 'Flat',
  down: 'Down',
};

/**
 * Per-entry editor for one site — fix or remove a mislogged value (e.g. a
 * calf logged as a thigh). Mounted with key={site} so all edit state resets
 * on site switch. Calls onChanged after a successful write so the card (and
 * sibling widgets) refetch.
 */
function SiteEntriesEditor({
  site,
  label,
  entries,
  tapeUnit,
  onChanged,
}: {
  site: string;
  label: string;
  entries: { date: string; valueCm: number }[];
  tapeUnit: 'in' | 'cm';
  onChanged: () => void;
}) {
  const [showEntries, setShowEntries] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteDate, setConfirmDeleteDate] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const startEdit = (entry: { date: string; valueCm: number }) => {
    setConfirmDeleteDate(null);
    setMutateError(null);
    setEditingDate(entry.date);
    setEditValue(
      (tapeUnit === 'in' ? cmToIn(entry.valueCm) : entry.valueCm).toFixed(1)
    );
  };

  const runMutation = async (fn: (userId: string) => Promise<void>) => {
    setIsMutating(true);
    setMutateError(null);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      await fn(user.id);
      setEditingDate(null);
      setConfirmDeleteDate(null);
      onChanged();
    } catch (err) {
      console.error('Failed to update measurement entry:', err);
      setMutateError('Could not save that change — try again.');
    } finally {
      setIsMutating(false);
    }
  };

  const saveEdit = (date: string) => {
    const parsed = parseFloat(editValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMutateError('Enter a value greater than 0.');
      return;
    }
    const valueCm = tapeUnit === 'in' ? inToCm(parsed) : parsed;
    return runMutation((userId) =>
      updateMeasurementSiteEntry(
        createUntypedClient(),
        userId,
        date,
        site,
        Math.round(valueCm * 100) / 100
      )
    );
  };

  const deleteEntry = (date: string) =>
    runMutation((userId) =>
      deleteMeasurementSiteEntry(
        createUntypedClient(),
        userId,
        date,
        site,
        MEASUREMENT_FIELDS.map((f) => f.key)
      )
    );

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setShowEntries((s) => !s)}
        data-testid="measurement-entries-toggle"
        className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
      >
        {showEntries ? 'Hide entries' : `Edit entries (${entries.length})`}
      </button>
      {showEntries && (
        <div
          className="mt-2 space-y-1 max-h-56 overflow-y-auto"
          data-testid="measurement-entries-list"
        >
          {entries.map((entry) => (
            <div
              key={entry.date}
              className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg bg-surface-800/40"
              data-testid={`measurement-entry-${entry.date}`}
            >
              <span className="text-xs text-surface-400">
                {new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              {editingDate === entry.date ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                    data-testid="measurement-entry-input"
                    className="w-16 px-2 py-0.5 text-sm bg-surface-900 border border-surface-700 rounded text-surface-100 text-center"
                    aria-label={`${label} on ${entry.date}`}
                  />
                  <span className="text-xs text-surface-500">{tapeUnit}</span>
                  <button
                    type="button"
                    onClick={() => saveEdit(entry.date)}
                    disabled={isMutating}
                    data-testid="measurement-entry-save"
                    className="text-xs font-medium text-primary-400 hover:text-primary-300 disabled:opacity-50 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDate(null);
                      setMutateError(null);
                    }}
                    disabled={isMutating}
                    className="text-xs text-surface-500 hover:text-surface-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : confirmDeleteDate === entry.date ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-danger-400">Delete this entry?</span>
                  <button
                    type="button"
                    onClick={() => deleteEntry(entry.date)}
                    disabled={isMutating}
                    data-testid="measurement-entry-delete-confirm"
                    className="text-xs font-medium text-danger-400 hover:text-danger-300 disabled:opacity-50 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteDate(null)}
                    disabled={isMutating}
                    className="text-xs text-surface-500 hover:text-surface-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-surface-200">
                    {(tapeUnit === 'in' ? cmToIn(entry.valueCm) : entry.valueCm).toFixed(1)}{' '}
                    {tapeUnit}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(entry)}
                    data-testid={`measurement-entry-edit-${entry.date}`}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDate(null);
                      setMutateError(null);
                      setConfirmDeleteDate(entry.date);
                    }}
                    data-testid={`measurement-entry-delete-${entry.date}`}
                    className="text-xs text-surface-500 hover:text-danger-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {mutateError && (
        <p className="text-xs text-danger-400 mt-1.5" data-testid="measurement-entry-error">
          {mutateError}
        </p>
      )}
    </div>
  );
}

export function MeasurementTrendCard({
  tapeUnit,
  refreshKey = 0,
  onDataChanged,
}: MeasurementTrendCardProps) {
  const [rows, setRows] = useState<MeasurementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [site, setSite] = useState<keyof Measurements | ''>('');
  const [range, setRange] = useState<DateRangeKey>('1y');
  // Bumped after this card's own entry edits/deletes so the history refetches;
  // refreshKey stays the parent's signal.
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

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
  }, [refreshKey, localRefreshKey]);

  // Local-timezone YYYY-MM-DD cutoff for the selected range (string compare
  // works because logged_at is a YYYY-MM-DD date column).
  const rangeCutoff = useMemo(() => {
    const days = DATE_RANGES.find((r) => r.key === range)?.days ?? null;
    if (days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return getLocalDateString(d);
  }, [range]);

  const summary = useMemo(
    () => computeMeasurementTrends(rows, MEASUREMENT_FIELDS, rangeCutoff),
    [rows, rangeCutoff]
  );

  // Default selection: the first listed site with enough data for a chart.
  useEffect(() => {
    if (site && summary.sites.some((s) => s.site === site)) return;
    const withTrend = summary.sites.find((s) => s.pointCount >= 2) ?? summary.sites[0];
    setSite((withTrend?.site as keyof Measurements) ?? '');
  }, [summary, site]);

  const selected = summary.sites.find((s) => s.site === site) ?? null;

  /** All entries for the site regardless of range (for the empty-state copy). */
  const sitePointCount = useMemo(
    () => (site ? rows.filter((row) => row[site] != null).length : 0),
    [rows, site]
  );

  /**
   * Full entry history for the selected site, newest first — the editor list
   * deliberately ignores the chart's date range so a bad entry is fixable
   * without hunting for the window it falls in.
   */
  const siteEntries = useMemo(() => {
    if (!site) return [];
    return rows
      .filter((row) => typeof row[site] === 'number' && Number.isFinite(row[site]))
      .map((row) => ({ date: row.logged_at, valueCm: row[site] as number }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, site]);

  const chartData = useMemo(() => {
    if (!selected) return [];
    return selected.history.map((point) => ({
      label: new Date(`${point.date}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      value:
        Math.round((tapeUnit === 'in' ? cmToIn(point.valueCm) : point.valueCm) * 10) / 10,
    }));
  }, [selected, tapeUnit]);

  const formatValue = (cm: number) =>
    `${(tapeUnit === 'in' ? cmToIn(cm) : cm).toFixed(1)} ${tapeUnit}`;
  const formatRate = (cmPerMonth: number) => {
    const v = tapeUnit === 'in' ? cmToIn(cmPerMonth) : cmPerMonth;
    return `${v >= 0 ? '+' : ''}${v.toFixed(1)} ${tapeUnit}/mo`;
  };

  const aggregateParts: string[] = [];
  if (summary.rising + summary.flat + summary.down > 0) {
    aggregateParts.push(
      `${summary.rising} rising`,
      `${summary.flat} flat`,
      `${summary.down} down`
    );
  }
  if (summary.building > 0) aggregateParts.push(`${summary.building} building history`);
  const rangeSubtitle = DATE_RANGES.find((r) => r.key === range)?.subtitle ?? '';

  if (!isLoading && rows.length === 0) return null; // nothing to trend yet

  return (
    <Card>
      <CardHeader>
        <CardTitle>Measurement Trends</CardTitle>
        {!isLoading && summary.sites.length > 0 && (
          <p className="text-xs text-surface-500 mt-1">
            Tape trend per site over the {rangeSubtitle} · {aggregateParts.join(' · ')}
          </p>
        )}
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
        ) : summary.sites.length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">
            No measurements in this date range — try a longer range.
          </p>
        ) : (
          <>
            <div className="space-y-1" role="listbox" aria-label="Measurement site trends">
              {summary.sites.map((trend) => (
                <button
                  key={trend.site}
                  type="button"
                  role="option"
                  aria-selected={trend.site === site}
                  onClick={() => setSite(trend.site as keyof Measurements)}
                  data-testid={`measurement-trend-row-${trend.site}`}
                  className={`w-full flex items-center gap-3 p-3 -mx-1 rounded-lg text-left transition-colors ${
                    trend.site === site ? 'bg-surface-800/70' : 'hover:bg-surface-800/50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-surface-200 truncate">
                        {trend.label}
                      </p>
                      {trend.direction == null ? (
                        <Badge size="sm" variant="default">Building</Badge>
                      ) : (
                        <Badge
                          size="sm"
                          variant={
                            trend.improving == null
                              ? 'default'
                              : trend.improving
                              ? 'success'
                              : 'danger'
                          }
                        >
                          {DIRECTION_LABEL[trend.direction]}
                        </Badge>
                      )}
                    </div>
                    {/* A building site shows NO rate — a slope fitted through
                        one or two tape entries is noise with a decimal point. */}
                    <p className="text-xs text-surface-500 mt-0.5">
                      {trend.direction == null
                        ? `${formatValue(trend.currentCm)} · ${trend.pointCount} ${
                            trend.pointCount === 1 ? 'entry' : 'entries'
                          } — trends appear after ${MIN_POINTS_FOR_TREND}`
                        : `${formatValue(trend.currentCm)} · ${formatRate(trend.monthlyChangeCm)} · ${trend.pointCount} entries`}
                    </p>
                  </div>
                  <SiteSparkline trend={trend} />
                </button>
              ))}
            </div>

            {selected && (
              <div className="mt-4 pt-3 border-t border-surface-800">
                <p className="text-xs font-medium text-surface-400 mb-2">
                  {selected.label} detail
                </p>
                {chartData.length < 2 ? (
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

                <SiteEntriesEditor
                  key={selected.site}
                  site={selected.site}
                  label={selected.label}
                  entries={siteEntries}
                  tapeUnit={tapeUnit}
                  onChanged={() => {
                    setLocalRefreshKey((k) => k + 1);
                    onDataChanged?.();
                  }}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
