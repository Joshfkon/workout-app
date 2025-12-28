'use client';

import React, { useMemo, memo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { Card, InfoTooltip } from '@/components/ui';
import type { MuscleVolumeData } from '@/services/volumeTracker';
import type { VolumeStatus } from '@/types/schema';
import type { RechartsTooltipProps } from '@/types/database-queries';

interface VolumeChartDataPoint {
  name: string;
  sets: number;
  direct: number;
  indirect: number;
  mev: number;
  mav: number;
  mrv: number;
  status: VolumeStatus;
}

interface VolumeChartProps {
  data: MuscleVolumeData[];
  showLandmarks?: boolean;
}

// Moved outside component to prevent re-creation on every render
const VolumeTooltip = memo(function VolumeTooltip({ active, payload, label }: RechartsTooltipProps<VolumeChartDataPoint>) {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload as VolumeChartDataPoint;

  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-3 shadow-lg">
      <p className="font-medium text-surface-100 mb-2">{label}</p>
      <div className="space-y-1 text-sm">
        <p className="text-surface-300">
          Total Sets: <span className="font-mono text-primary-400">{data.sets}</span>
        </p>
        <p className="text-surface-400">
          Direct: {data.direct} | Indirect: {data.indirect}
        </p>
        <div className="pt-2 mt-2 border-t border-surface-700 text-xs text-surface-500">
          <p>MEV: {data.mev} | MAV: {data.mav} | MRV: {data.mrv}</p>
        </div>
      </div>
    </div>
  );
});

const getBarColor = (status: VolumeStatus) => {
  switch (status) {
    case 'below_mev':
      return '#71717a'; // surface-500
    case 'effective':
      return '#0ea5e9'; // primary-500
    case 'optimal':
      return '#22c55e'; // success-500
    case 'approaching_mrv':
      return '#eab308'; // warning-500
    case 'exceeding_mrv':
      return '#ef4444'; // danger-500
  }
};

export const VolumeChart = memo(function VolumeChart({ data, showLandmarks = true }: VolumeChartProps) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      name: item.muscleGroup.charAt(0).toUpperCase() + item.muscleGroup.slice(1),
      sets: item.totalSets,
      direct: item.directSets,
      indirect: item.indirectSets,
      mev: item.landmarks.mev,
      mav: item.landmarks.mav,
      mrv: item.landmarks.mrv,
      status: item.status,
    }));
  }, [data]);

  return (
    <Card>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-surface-100">Weekly Volume</h3>
        <p className="text-sm text-surface-400">Sets per muscle group this week</p>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 60, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              type="number"
              stroke="#71717a"
              fontSize={12}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#71717a"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<VolumeTooltip />} />
            <Bar
              dataKey="sets"
              radius={[0, 4, 4, 0]}
              maxBarSize={24}
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={getBarColor(entry.status)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend with tooltips */}
      <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-surface-800 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#71717a]" />
          <span className="text-surface-400">Below MEV</span>
          <InfoTooltip term="MEV" size="sm" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#0ea5e9]" />
          <span className="text-surface-400">Effective</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#22c55e]" />
          <span className="text-surface-400">Optimal</span>
          <InfoTooltip term="MAV" size="sm" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#eab308]" />
          <span className="text-surface-400">High</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-[#ef4444]" />
          <span className="text-surface-400">Over MRV</span>
          <InfoTooltip term="MRV" size="sm" />
        </div>
      </div>
    </Card>
  );
});

const getStatusColorClass = (status: VolumeStatus) => {
  switch (status) {
    case 'below_mev': return 'bg-surface-600';
    case 'effective': return 'bg-primary-500';
    case 'optimal': return 'bg-success-500';
    case 'approaching_mrv': return 'bg-warning-500';
    case 'exceeding_mrv': return 'bg-danger-500';
  }
};

// Compact version for dashboard - memoized
export const VolumeChartCompact = memo(function VolumeChartCompact({ data }: { data: MuscleVolumeData[] }) {
  return (
    <div className="space-y-2">
      {data.map((item) => {
        const percent = Math.min(100, (item.totalSets / item.landmarks.mrv) * 100);
        const mevPercent = (item.landmarks.mev / item.landmarks.mrv) * 100;
        const mavPercent = (item.landmarks.mav / item.landmarks.mrv) * 100;

        return (
          <div key={item.muscleGroup} className="group">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-surface-300 capitalize group-hover:text-surface-200 transition-colors">
                {item.muscleGroup}
              </span>
              <span className="text-surface-500 font-mono">
                {item.totalSets} sets
              </span>
            </div>
            <div className="relative h-2 bg-surface-800 rounded-full overflow-hidden">
              {/* MEV marker */}
              <div
                className="absolute top-0 bottom-0 w-px bg-surface-600"
                style={{ left: `${mevPercent}%` }}
              />
              {/* MAV marker */}
              <div
                className="absolute top-0 bottom-0 w-px bg-surface-500"
                style={{ left: `${mavPercent}%` }}
              />
              {/* Progress bar */}
              <div
                className={`h-full transition-all duration-300 ${getStatusColorClass(item.status)}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

