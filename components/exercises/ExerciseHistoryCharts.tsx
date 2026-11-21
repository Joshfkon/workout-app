'use client';

import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { convertWeight } from '@/lib/utils';

interface ChartDataPoint {
  date: string;
  e1rm: number;
  volume: number;
  bestWeight: number;
  bestReps: number;
}

interface PersonalRecord {
  weightKg: number;
  reps: number;
  e1rm: number;
  date: string;
}

interface ExerciseHistoryChartsProps {
  chartData: ChartDataPoint[];
  personalRecord: PersonalRecord | null;
  activeChart: 'e1rm' | 'volume' | 'best';
  unit: 'kg' | 'lb';
}

export function ExerciseHistoryCharts({
  chartData,
  personalRecord,
  activeChart,
  unit,
}: ExerciseHistoryChartsProps) {
  return (
    <>
      {/* E1RM Chart */}
      {activeChart === 'e1rm' && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--ht-sep))" />
              <XAxis
                dataKey="date"
                stroke="rgb(var(--ht-ink-3))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-ink-3))' }}
              />
              <YAxis
                stroke="rgb(var(--ht-ink-3))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-ink-3))' }}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--ht-card))',
                  border: '1px solid rgb(var(--ht-sep))',
                  borderRadius: '8px',
                  color: 'rgb(var(--ht-ink))',
                }}
                formatter={(value: number) => [`${value} ${unit}`, 'Est 1RM']}
              />
              <Line
                type="monotone"
                dataKey="e1rm"
                stroke="rgb(var(--ht-action))"
                strokeWidth={2}
                dot={{ r: 4, fill: 'rgb(var(--ht-action))' }}
                activeDot={{ r: 6, fill: 'rgb(var(--ht-action))' }}
              />
              {personalRecord && (
                <ReferenceLine
                  y={Math.round(convertWeight(personalRecord.e1rm, 'kg', unit))}
                  stroke="rgb(var(--ht-ok))"
                  strokeDasharray="5 5"
                  label={{
                    value: 'PR',
                    fill: 'rgb(var(--ht-ok))',
                    fontSize: 11,
                    position: 'right',
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Volume Chart */}
      {activeChart === 'volume' && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--ht-sep))" />
              <XAxis
                dataKey="date"
                stroke="rgb(var(--ht-ink-3))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-ink-3))' }}
              />
              <YAxis
                stroke="rgb(var(--ht-ink-3))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-ink-3))' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--ht-card))',
                  border: '1px solid rgb(var(--ht-sep))',
                  borderRadius: '8px',
                  color: 'rgb(var(--ht-ink))',
                }}
                formatter={(value: number) => [
                  `${value.toLocaleString()} ${unit}`,
                  'Volume',
                ]}
              />
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="rgb(var(--ht-action))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="rgb(var(--ht-action))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="volume"
                stroke="rgb(var(--ht-action))"
                strokeWidth={2}
                fill="url(#volumeGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Best Set Chart */}
      {activeChart === 'best' && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--ht-sep))" />
              <XAxis
                dataKey="date"
                stroke="rgb(var(--ht-ink-3))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-ink-3))' }}
              />
              <YAxis
                yAxisId="weight"
                stroke="rgb(var(--ht-action))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-action))' }}
                orientation="left"
              />
              <YAxis
                yAxisId="reps"
                stroke="rgb(var(--ht-ink-2))"
                fontSize={11}
                tick={{ fill: 'rgb(var(--ht-ink-2))' }}
                orientation="right"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--ht-card))',
                  border: '1px solid rgb(var(--ht-sep))',
                  borderRadius: '8px',
                  color: 'rgb(var(--ht-ink))',
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'bestWeight') return [`${value} ${unit}`, 'Weight'];
                  return [`${value}`, 'Reps'];
                }}
              />
              <Line
                yAxisId="weight"
                type="monotone"
                dataKey="bestWeight"
                stroke="rgb(var(--ht-action))"
                strokeWidth={2}
                dot={{ r: 4, fill: 'rgb(var(--ht-action))' }}
                name="bestWeight"
              />
              <Line
                yAxisId="reps"
                type="monotone"
                dataKey="bestReps"
                stroke="rgb(var(--ht-ink-2))"
                strokeWidth={2}
                dot={{ r: 4, fill: 'rgb(var(--ht-ink-2))' }}
                name="bestReps"
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 mt-2 text-caption">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-action"></span>
              <span className="text-ink-2">Weight ({unit})</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-ink-2"></span>
              <span className="text-ink-2">Reps</span>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
