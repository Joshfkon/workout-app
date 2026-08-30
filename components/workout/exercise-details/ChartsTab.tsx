'use client';

import { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { SegmentedControl } from '../SegmentedControl';
import { convertWeight } from '@/lib/utils';
import {
  buildE1RMTrend,
  buildWeeklyVolume,
  isNormalDetailSet,
  type ExerciseDetailSession,
  type TrendRange,
} from '@/services/exerciseDetailAnalytics';

interface ChartsTabProps {
  sessions: ExerciseDetailSession[] | undefined;
  unit: 'kg' | 'lb';
  /** rep_total exercise: the trend chart defaults to session rep totals. */
  repTotalMode?: boolean;
}

/** Which number the trend chart plots. Both are switchable on any exercise;
 * the exercise's progression model only picks the default. */
type ChartMetric = 'reps' | 'e1rm';

const RANGE_OPTIONS = [
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const METRIC_OPTIONS = [
  { value: 'reps', label: 'Reps' },
  { value: 'e1rm', label: 'Est 1RM' },
];

const TOOLTIP_STYLE = {
  backgroundColor: '#1f2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#f3f4f6',
} as const;

export function ChartsTab({ sessions, unit, repTotalMode = false }: ChartsTabProps) {
  const [range, setRange] = useState<TrendRange>('all');
  // Default to the exercise's progression metric; the toggle lets the user
  // view the other one as reference.
  const [metric, setMetric] = useState<ChartMetric>(repTotalMode ? 'reps' : 'e1rm');

  // Session rep totals — the progression metric for rep_total exercises,
  // reference for everything else. Deload sessions are excluded (held light
  // on purpose). Oldest-first for the time axis.
  const repTotalTrend = useMemo(() => {
    if (metric !== 'reps' || !sessions) return [];
    const now = new Date();
    const cutoff =
      range === '3m'
        ? new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())
        : range === '1y'
          ? new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
          : null;
    return sessions
      .filter((sn) => !sn.isDeload && (!cutoff || new Date(sn.date) >= cutoff))
      .slice()
      .reverse()
      .map((sn) => ({
        label: new Date(sn.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        // Straight sets only — same rule the rep_total policy grades.
        total: sn.sets.filter(isNormalDetailSet).reduce((sum, st) => sum + st.reps, 0),
      }));
  }, [metric, sessions, range]);

  // Lazy-computed: this component only mounts on first visit to the tab.
  const trendData = useMemo(() => {
    if (metric !== 'e1rm' || !sessions) return [];
    return buildE1RMTrend(sessions, range, new Date()).map((p) => ({
      label: p.label,
      e1rm: p.e1rm === null ? null : Math.round(convertWeight(p.e1rm, 'kg', unit)),
      deloadE1rm: p.deloadE1rm === null ? null : Math.round(convertWeight(p.deloadE1rm, 'kg', unit)),
    }));
  }, [metric, sessions, range, unit]);

  const weeklyVolume = useMemo(() => {
    if (!sessions) return [];
    return buildWeeklyVolume(sessions).map((p) => ({
      label: p.label,
      volume: Math.round(convertWeight(p.volumeKg, 'kg', unit)),
    }));
  }, [sessions, unit]);

  const trendPointCount = trendData.filter((p) => p.e1rm !== null).length;

  if (sessions === undefined) {
    return (
      <div className="space-y-3">
        <div className="h-48 rounded-lg bg-surface-800/50 animate-pulse" />
        <div className="h-40 rounded-lg bg-surface-800/50 animate-pulse" />
      </div>
    );
  }

  if (sessions.length < 2) {
    return (
      <div className="bg-surface-800/30 rounded-lg p-6 text-center">
        <p className="text-surface-500 text-sm">
          Complete at least 2 workouts with this exercise to see progress charts
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="exercise-detail-charts">
      <div className="bg-surface-800/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <p className="text-sm font-medium text-surface-200">
            {metric === 'reps' ? 'Session rep total' : 'Est. 1RM trend'}
          </p>
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as TrendRange)}
          />
        </div>
        <div className="mb-3">
          <SegmentedControl
            options={METRIC_OPTIONS}
            value={metric}
            onChange={(v) => setMetric(v as ChartMetric)}
          />
        </div>
        {metric === 'reps' ? (
          repTotalTrend.length >= 1 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={repTotalTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tick={{ fill: '#9ca3af' }} />
                  <YAxis
                    stroke="#9ca3af"
                    fontSize={11}
                    tick={{ fill: '#9ca3af' }}
                    domain={['dataMin - 2', 'dataMax + 2']}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number) => [`${value} reps`, 'Session total']}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#8b5cf6' }}
                    activeDot={{ r: 5, fill: '#a78bfa' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-surface-500 text-sm py-8 text-center">
              No sessions in this range
            </p>
          )
        ) : trendPointCount >= 1 ? (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tick={{ fill: '#9ca3af' }} />
                  <YAxis
                    stroke="#9ca3af"
                    fontSize={11}
                    tick={{ fill: '#9ca3af' }}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [
                      `${value} ${unit}`,
                      name === 'deloadE1rm' ? 'Deload (not in trend)' : 'Est 1RM',
                    ]}
                  />
                  {/* Deload sessions: excluded from the trend line, shown as muted dots */}
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#8b5cf6' }}
                    activeDot={{ r: 5, fill: '#a78bfa' }}
                    connectNulls
                  />
                  <Line
                    dataKey="deloadE1rm"
                    stroke="none"
                    dot={{ r: 3, fill: '#6b7280', stroke: 'none' }}
                    activeDot={{ r: 4, fill: '#9ca3af' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {trendData.some((p) => p.deloadE1rm !== null) && (
              <p className="text-[11px] text-surface-500 mt-1.5 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-surface-500 inline-block" />
                Deload sessions shown as gray dots, excluded from the trend
              </p>
            )}
          </>
        ) : (
          <p className="text-surface-500 text-sm py-6 text-center">
            {repTotalMode
              ? 'No est. 1RM in this range — high-rep sets fall outside the estimator'
              : 'No non-deload sessions in this range'}
          </p>
        )}
        {metric === 'reps' ? (
          <p className="text-[11px] text-surface-500 mt-1.5">
            {repTotalMode
              ? 'Rep-total progression: this exercise trends total reps at its working load.'
              : 'Total reps across straight sets per session; deload sessions excluded.'}
          </p>
        ) : repTotalMode ? (
          <p className="text-[11px] text-surface-500 mt-1.5">
            Shown for reference — this exercise progresses by session rep total,
            and only sets low-rep enough to estimate a 1RM appear here.
          </p>
        ) : null}
      </div>

      {/* Volume per week */}
      <div className="bg-surface-800/30 rounded-lg p-3">
        <p className="text-sm font-medium text-surface-200 mb-3">Volume per week</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyVolume}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tick={{ fill: '#9ca3af' }} />
              <YAxis stroke="#9ca3af" fontSize={11} tick={{ fill: '#9ca3af' }} width={45} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: 'rgba(59, 130, 246, 0.08)' }}
                formatter={(value: number) => [`${value.toLocaleString()} ${unit}`, 'Volume']}
              />
              <Bar dataKey="volume" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
