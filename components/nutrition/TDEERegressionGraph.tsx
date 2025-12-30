'use client';

import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Line,
  ComposedChart,
} from 'recharts';
import type { RegressionAnalysis, RegressionDataPoint } from '@/lib/nutrition/adaptive-tdee';

interface TDEERegressionGraphProps {
  regressionAnalysis: RegressionAnalysis;
}

export function TDEERegressionGraph({ regressionAnalysis }: TDEERegressionGraphProps) {
  const { dataPoints, burnRatePerLb, estimatedTDEE, rSquared, standardError, currentWeight } =
    regressionAnalysis;

  // Transform data for scatter plot: calories consumed vs weight change
  const scatterData = useMemo(() => {
    return dataPoints.map((point) => ({
      ...point,
      // Format date for display
      displayDate: new Date(point.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      // Convert actual change to lbs/day * 7 for weekly rate visualization
      weeklyChange: point.actualChange * 7,
      predictedWeeklyChange: point.predictedChange * 7,
    }));
  }, [dataPoints]);

  // Calculate range for chart axes
  const calorieRange = useMemo(() => {
    const calories = dataPoints.map((d) => d.calories);
    const min = Math.min(...calories);
    const max = Math.max(...calories);
    const padding = (max - min) * 0.1;
    return [Math.floor((min - padding) / 100) * 100, Math.ceil((max + padding) / 100) * 100];
  }, [dataPoints]);

  const weightChangeRange = useMemo(() => {
    const changes = dataPoints.map((d) => d.actualChange);
    const min = Math.min(...changes);
    const max = Math.max(...changes);
    // Use smaller padding to make small weight changes more visible
    // Minimum padding of 0.2 lbs instead of 0.5 to show subtle fluctuations
    const padding = Math.max(Math.abs(max - min) * 0.2, 0.2);
    return [min - padding, max + padding];
  }, [dataPoints]);

  // Generate line data for the regression line
  const regressionLine = useMemo(() => {
    // TDEE line: where predicted change = 0
    // predicted_change = (calories - burnRate * weight) / 3500
    // So at TDEE: calories = burnRate * weight
    const avgWeight = dataPoints.reduce((sum, d) => sum + d.weight, 0) / dataPoints.length;
    const tdeePoint = burnRatePerLb * avgWeight;

    // Create line points across calorie range
    return [
      {
        calories: calorieRange[0],
        predictedChange: (calorieRange[0] - burnRatePerLb * avgWeight) / 3500,
      },
      {
        calories: tdeePoint,
        predictedChange: 0,
      },
      {
        calories: calorieRange[1],
        predictedChange: (calorieRange[1] - burnRatePerLb * avgWeight) / 3500,
      },
    ];
  }, [burnRatePerLb, calorieRange, dataPoints]);

  // Model fit quality
  const fitQuality = useMemo(() => {
    if (rSquared >= 0.5) return { label: 'Excellent', color: 'text-success-400' };
    if (rSquared >= 0.3) return { label: 'Good', color: 'text-primary-400' };
    if (rSquared >= 0.1) return { label: 'Fair', color: 'text-warning-400' };
    return { label: 'Limited', color: 'text-surface-400' };
  }, [rSquared]);

  return (
    <Card className="p-6">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              TDEE Regression Analysis
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-500/20 text-primary-400">
                {estimatedTDEE.toLocaleString()} cal/day
              </span>
            </CardTitle>
            <p className="text-xs text-surface-500 mt-1">
              Actual weight changes vs. calories consumed
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-surface-500">Model Fit (R²)</div>
            <div className={`text-sm font-semibold ${fitQuality.color}`}>
              {(rSquared * 100).toFixed(0)}% {fitQuality.label}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Main regression chart */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={scatterData}
              margin={{ top: 20, right: 20, bottom: 20, left: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="calories"
                type="number"
                domain={calorieRange}
                tick={{ fontSize: 10, fill: '#888' }}
                tickFormatter={(value) => `${(value / 1000).toFixed(1)}k`}
                label={{
                  value: 'Calories Consumed',
                  position: 'bottom',
                  offset: 0,
                  fontSize: 10,
                  fill: '#888',
                }}
              />
              <YAxis
                dataKey="actualChange"
                type="number"
                domain={weightChangeRange}
                tick={{ fontSize: 10, fill: '#888' }}
                tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`}
                label={{
                  value: 'Weight Change (lbs/day)',
                  angle: -90,
                  position: 'insideLeft',
                  fontSize: 10,
                  fill: '#888',
                  offset: 10,
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'actualChange') {
                    return [`${value > 0 ? '+' : ''}${value.toFixed(2)} lbs/day`, 'Actual'];
                  }
                  if (name === 'predictedChange') {
                    return [`${value > 0 ? '+' : ''}${value.toFixed(2)} lbs/day`, 'Model'];
                  }
                  return [value, name];
                }}
                labelFormatter={(label) => `${label.toLocaleString()} cal`}
              />

              {/* Zero line - maintenance */}
              <ReferenceLine
                y={0}
                stroke="#666"
                strokeDasharray="3 3"
                label={{
                  value: 'Maintenance',
                  position: 'right',
                  fontSize: 9,
                  fill: '#666',
                }}
              />

              {/* TDEE vertical line */}
              <ReferenceLine
                x={estimatedTDEE}
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="5 3"
                label={{
                  value: `TDEE: ${estimatedTDEE}`,
                  position: 'top',
                  fontSize: 10,
                  fill: '#22c55e',
                }}
              />

              {/* Regression line (using Line within ComposedChart) */}
              <Line
                data={regressionLine}
                type="linear"
                dataKey="predictedChange"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                legendType="none"
                isAnimationActive={false}
              />

              {/* Actual data points */}
              <Scatter
                name="Daily Data"
                dataKey="actualChange"
                fill="#60a5fa"
                fillOpacity={0.8}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-4 gap-4">
          <div className="text-center p-2 bg-surface-800/50 rounded-lg">
            <div className="text-xs text-surface-500">Burn Rate</div>
            <div className="text-sm font-semibold text-surface-100">
              {burnRatePerLb.toFixed(1)} cal/lb
            </div>
          </div>
          <div className="text-center p-2 bg-surface-800/50 rounded-lg">
            <div className="text-xs text-surface-500">Current Weight</div>
            <div className="text-sm font-semibold text-surface-100">
              {currentWeight.toFixed(1)} lbs
            </div>
          </div>
          <div className="text-center p-2 bg-surface-800/50 rounded-lg">
            <div className="text-xs text-surface-500">Std Error</div>
            <div className="text-sm font-semibold text-surface-100">
              ±{(standardError * 7).toFixed(1)} lbs/wk
            </div>
          </div>
          <div className="text-center p-2 bg-surface-800/50 rounded-lg">
            <div className="text-xs text-surface-500">Data Points</div>
            <div className="text-sm font-semibold text-surface-100">{dataPoints.length}</div>
          </div>
        </div>

        {/* Interpretation */}
        <div className="mt-4 p-3 bg-surface-800/30 rounded-lg">
          <p className="text-xs text-surface-400">
            <span className="text-primary-400 font-medium">How to read this chart:</span> Each blue
            dot shows a day&apos;s calorie intake vs. the resulting weight change. The orange line
            is your personal model. Where it crosses zero (green dashed line) is your estimated
            TDEE of <span className="text-success-400 font-semibold">{estimatedTDEE}</span> cal/day.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default TDEERegressionGraph;
