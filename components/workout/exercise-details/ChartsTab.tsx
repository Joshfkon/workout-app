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
  type ExerciseDetailSession,
  type TrendRange,
} from '@/services/exerciseDetailAnalytics';

interface ChartsTabProps {
  sessions: ExerciseDetailSession[] | undefined;
  unit: 'kg' | 'lb';
  /** rep_total exercise: chart session rep totals, never an e1RM (ADD 2). */
  repTotalMode?: boolean;
}

const RANGE_OPTIONS = [
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

const TOOLTIP_STYLE = {
  backgroundColor: '#1f2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#f3f4f6',
} as const;

export function ChartsTab({ sessions, unit, repTotalMode = false }: ChartsTabProps) {
  const [range, setRange] = useState<TrendRange>('all');

  // rep_total: the progression metric is the session rep total — chart that
  // instead of an e1RM that doesn't exist for this exercise. Deload sessions
  // are excluded (held light on purpose). Oldest-first for the time axis.
  const repTotalTrend = useMemo(() => {
    if (!repTotalMode || !sessions) return [];
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
        total: sn.sets.reduce((sum, st) => sum + st.reps, 0),
      }));
  }, [repTotalMode, sessions, range]);

  // Lazy-computed: this component only mounts on first visit to the tab.
  const trendData = useMemo(() => {
    if (!sessions) return [];
    return buildE1RMTrend(sessions, range, new Date()).map((p) => ({
      label: p.label,
      e1rm: p.e1rm === null ? null : Math.round(convertWeight(p.e1rm, 'kg', unit)),
      deloadE1rm: p.deloadE1rm === null ? null : Math.round(convertWeight(p.deloadE1rm, 'kg', unit)),
    }));
  }, [sessions, range, unit]);

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
      {repTotalMode ? (
        /* rep_total: session rep-total trend replaces the e1RM chart. */
        <div className="bg-surface-800/30 rounded-lg p-3">
          <div className="flex items-center justify-between mb-3 gap-2">
            <p className="text-sm font-medium text-surface-200">Session rep total</p>
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onChange={(v) => setRange(v as TrendRange)}
            />
          </div>
          {repTotalTrend.length >= 1 ? (
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
          )}
          <p className="text-[11px] text-surface-500 mt-1.5">
            Rep-total progression: this exercise trends total reps at its working
            load — no estimated 1RM is computed for it.
          </p>
        </div>
      ) : (
      <div className="bg-surface-800/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-3 gap-2">
          <p className="text-sm font-medium text-surface-200">Est. 1RM trend</p>
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as TrendRange)}
          />
        </div>
        {trendPointCount >= 1 ? (
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
            No non-deload sessions in this range
          </p>
        )}
      </div>
      )}

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
