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
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                stroke="#9ca3af"
                fontSize={11}
                tick={{ fill: '#9ca3af' }}
              />
              <YAxis
                stroke="#9ca3af"
                fontSize={11}
                tick={{ fill: '#9ca3af' }}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#f3f4f6',
                }}
                formatter={(value: number) => [`${value} ${unit}`, 'Est 1RM']}
              />
              <Line
                type="monotone"
                dataKey="e1rm"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ r: 4, fill: '#8b5cf6' }}
                activeDot={{ r: 6, fill: '#a78bfa' }}
              />
              {personalRecord && (
                <ReferenceLine
                  y={Math.round(convertWeight(personalRecord.e1rm, 'kg', unit))}
                  stroke="#22c55e"
                  strokeDasharray="5 5"
                  label={{
                    value: 'PR',
                    fill: '#22c55e',
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
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                stroke="#9ca3af"
                fontSize={11}
                tick={{ fill: '#9ca3af' }}
              />
              <YAxis
                stroke="#9ca3af"
                fontSize={11}
                tick={{ fill: '#9ca3af' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#f3f4f6',
                }}
                formatter={(value: number) => [
                  `${value.toLocaleString()} ${unit}`,
                  'Volume',
                ]}
              />
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#3b82f6"
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
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                stroke="#9ca3af"
                fontSize={11}
                tick={{ fill: '#9ca3af' }}
              />
              <YAxis
                yAxisId="weight"
                stroke="#f59e0b"
                fontSize={11}
                tick={{ fill: '#f59e0b' }}
                orientation="left"
              />
              <YAxis
                yAxisId="reps"
                stroke="#10b981"
                fontSize={11}
                tick={{ fill: '#10b981' }}
                orientation="right"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#f3f4f6',
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
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 4, fill: '#f59e0b' }}
                name="bestWeight"
              />
              <Line
                yAxisId="reps"
                type="monotone"
                dataKey="bestReps"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 4, fill: '#10b981' }}
                name="bestReps"
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-6 mt-2 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="text-surface-400">Weight ({unit})</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              <span className="text-surface-400">Reps</span>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
