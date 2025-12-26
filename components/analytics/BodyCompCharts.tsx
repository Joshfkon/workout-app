'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ScanDataPoint {
  date: string;
  weight: number;
  leanMass: number;
  fatMass: number;
  bodyFat: number;
}

interface BodyCompChartsProps {
  data: ScanDataPoint[];
}

// Chart tooltip styling
const tooltipStyle = {
  backgroundColor: '#1f2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#f3f4f6',
};

export function BodyCompChart({ data }: BodyCompChartsProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
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
          contentStyle={tooltipStyle}
          formatter={(value: number, name: string) => {
            if (name === 'leanMass') return [`${value.toFixed(1)} kg`, 'Lean Mass'];
            if (name === 'fatMass') return [`${value.toFixed(1)} kg`, 'Fat Mass'];
            return [value, name];
          }}
        />
        <Legend />
        <defs>
          <linearGradient id="leanGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="fatGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="leanMass"
          stackId="1"
          stroke="#22c55e"
          strokeWidth={2}
          fill="url(#leanGradient)"
          name="Lean Mass"
        />
        <Area
          type="monotone"
          dataKey="fatMass"
          stackId="1"
          stroke="#ef4444"
          strokeWidth={2}
          fill="url(#fatGradient)"
          name="Fat Mass"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
