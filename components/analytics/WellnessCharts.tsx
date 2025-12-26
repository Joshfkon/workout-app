'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';

interface CheckInDataPoint {
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

interface HydrationDataPoint {
  date: string;
  glasses: number;
  target: number;
}

interface CardioDataPoint {
  date: string;
  minutes: number;
  type: string;
  distance: number | null;
}

interface WellnessChartsProps {
  hydrationData: HydrationDataPoint[];
  cardioData: CardioDataPoint[];
  checkInData: CheckInDataPoint[];
}

// Chart tooltip styling
const tooltipStyle = {
  backgroundColor: '#1f2937',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#f3f4f6',
};

// Metric chart component to reduce duplication
function MetricLineChart({
  data,
  dataKey,
  color,
  label,
  domain = [0, 10],
}: {
  data: CheckInDataPoint[];
  dataKey: keyof CheckInDataPoint;
  color: string;
  label: string;
  domain?: [number, number];
}) {
  const filteredData = data.filter(d => d[dataKey] !== null);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={filteredData}>
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
          domain={domain}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [value, label]}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color }}
          activeDot={{ r: 5, fill: color }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HydrationChart({ data }: { data: HydrationDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
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
          formatter={(value: number, name: string) => [
            `${value} glasses`,
            name === 'target' ? 'Target' : 'Actual',
          ]}
        />
        <defs>
          <linearGradient id="hydrationGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="glasses"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#hydrationGradient)"
        />
        <Line
          type="monotone"
          dataKey="target"
          stroke="#22c55e"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CardioChart({ data }: { data: CardioDataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
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
            if (name === 'minutes') return [`${value} min`, 'Duration'];
            if (name === 'distance') return [`${value?.toFixed(1) || 0} km`, 'Distance'];
            return [value, name];
          }}
        />
        <defs>
          <linearGradient id="cardioGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="minutes"
          stroke="#8b5cf6"
          strokeWidth={2}
          fill="url(#cardioGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SleepHoursChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart
      data={data}
      dataKey="sleepHours"
      color="#8b5cf6"
      label="Hours"
      domain={[0, 12]}
    />
  );
}

export function SleepQualityChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="sleepQuality" color="#3b82f6" label="Quality" />
  );
}

export function EnergyChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="energyLevel" color="#22c55e" label="Energy" />
  );
}

export function MoodChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="moodRating" color="#f59e0b" label="Mood" />
  );
}

export function FocusChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="focusRating" color="#06b6d4" label="Focus" />
  );
}

export function LibidoChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="libidoRating" color="#ec4899" label="Libido" />
  );
}

export function StressChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="stressLevel" color="#ef4444" label="Stress" />
  );
}

export function SorenessChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="sorenessLevel" color="#f97316" label="Soreness" />
  );
}

export function HungerChart({ data }: { data: CheckInDataPoint[] }) {
  return (
    <MetricLineChart data={data} dataKey="hungerLevel" color="#84cc16" label="Hunger" />
  );
}
