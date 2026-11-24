'use client';

import { IconChartBar } from '@tabler/icons-react';
import { useState, useMemo, memo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  getLocalDateString,
  formatChartTickDate,
  dateTickStep,
  showDateTick,
} from '@/lib/utils';
import type { FoodLogEntry, NutritionTargets } from '@/types/nutrition';
import { explainIntakeVsTrend } from '@/lib/nutrition/intakeVsTrend';

interface DailyData {
  date: string;
  displayDate: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  hasData: boolean;
}

interface NutritionTrendGraphProps {
  targets: NutritionTargets | null;
  /** Estimated daily burn (the "Your metabolism" number), to explain the gap. */
  estimatedBurnKcal?: number | null;
  /** True while that estimate is still settling (not yet 'stable'). */
  burnSettling?: boolean;
  /** The weight trend shown above, per week in `weightUnit` (negative = losing). */
  observedWeightPerWeek?: number | null;
  weightUnit?: 'kg' | 'lb';
}

const TIME_RANGES = [
  { label: '7D', days: 7 },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
] as const;

// Custom tooltip with dark theme
const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string; payload: DailyData }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const data = payload[0]?.payload;
  if (!data?.hasData) {
    return (
      <div className="bg-fill border border-sep rounded-lg p-3 shadow-lg">
        <p className="text-subhead font-medium text-ink">{label}</p>
        <p className="text-caption text-ink-2">No data logged</p>
      </div>
    );
  }

  return (
    <div className="bg-fill border border-sep rounded-lg p-3 shadow-lg min-w-[140px]">
      <p className="text-subhead font-medium text-ink mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-caption text-action">Calories</span>
          <span className="text-caption font-medium text-ink">
            {Math.round(data.calories)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-caption text-action">Protein</span>
          <span className="text-caption font-medium text-ink">{Math.round(data.protein)}g</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-caption text-status-warn">Carbs</span>
          <span className="text-caption font-medium text-ink">{Math.round(data.carbs)}g</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-caption text-status-bad">Fat</span>
          <span className="text-caption font-medium text-ink">{Math.round(data.fat)}g</span>
        </div>
      </div>
    </div>
  );
});

// View toggle for calories vs macros
type ViewMode = 'calories' | 'macros';

export function NutritionTrendGraph({
  targets,
  estimatedBurnKcal = null,
  burnSettling = false,
  observedWeightPerWeek = null,
  weightUnit = 'kg',
}: NutritionTrendGraphProps) {
  const [days, setDays] = useState(30);
  const [viewMode, setViewMode] = useState<ViewMode>('calories');
  const [isLoading, setIsLoading] = useState(true);
  const [foodEntries, setFoodEntries] = useState<FoodLogEntry[]>([]);

  const supabase = createUntypedClient();

  // Fetch historical data
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = getLocalDateString(startDate);

        const { data, error } = await supabase
          .from('food_log')
          .select('logged_at, calories, protein, carbs, fat')
          .eq('user_id', user.id)
          .gte('logged_at', startDateStr)
          .order('logged_at', { ascending: true });

        if (error) {
          console.error('Error fetching nutrition data:', error);
          return;
        }

        setFoodEntries(data || []);
      } catch (error) {
        console.error('Error fetching nutrition data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [days, supabase]);

  // Aggregate data by date
  const chartData = useMemo(() => {
    // Create a map of date -> totals
    const dateMap = new Map<
      string,
      { calories: number; protein: number; carbs: number; fat: number }
    >();

    for (const entry of foodEntries) {
      const existing = dateMap.get(entry.logged_at) || {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      };
      dateMap.set(entry.logged_at, {
        calories: existing.calories + (entry.calories || 0),
        protein: existing.protein + (entry.protein || 0),
        carbs: existing.carbs + (entry.carbs || 0),
        fat: existing.fat + (entry.fat || 0),
      });
    }

    // Generate all dates in range
    const result: DailyData[] = [];
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - days + 1);

    // Include the year in tick labels only when the range crosses a year boundary.
    const spansYear = startDate.getFullYear() !== today.getFullYear();

    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = getLocalDateString(d);
      const data = dateMap.get(dateStr);

      result.push({
        date: dateStr,
        displayDate: formatChartTickDate(dateStr, spansYear),
        calories: data?.calories || 0,
        protein: data?.protein || 0,
        carbs: data?.carbs || 0,
        fat: data?.fat || 0,
        hasData: !!data,
      });
    }

    return result;
  }, [foodEntries, days]);

  // Calculate averages for display
  const averages = useMemo(() => {
    const daysWithData = chartData.filter((d) => d.hasData);
    if (daysWithData.length === 0) return null;

    return {
      calories: Math.round(
        daysWithData.reduce((sum, d) => sum + d.calories, 0) / daysWithData.length
      ),
      protein: Math.round(
        daysWithData.reduce((sum, d) => sum + d.protein, 0) / daysWithData.length
      ),
      carbs: Math.round(daysWithData.reduce((sum, d) => sum + d.carbs, 0) / daysWithData.length),
      fat: Math.round(daysWithData.reduce((sum, d) => sum + d.fat, 0) / daysWithData.length),
      daysTracked: daysWithData.length,
    };
  }, [chartData]);

  // Average over COMPLETE days for the goal / burn comparison: today is still
  // being logged, and counting a half-logged day drags the average down and
  // inflates "under goal". (Today still shows on the chart.)
  const completeDayAverage = useMemo(() => {
    const today = getLocalDateString();
    const complete = chartData.filter((d) => d.hasData && d.date !== today);
    if (complete.length === 0) return null;
    return {
      calories: Math.round(complete.reduce((sum, d) => sum + d.calories, 0) / complete.length),
      days: complete.length,
    };
  }, [chartData]);

  const explanation = useMemo(
    () =>
      completeDayAverage
        ? explainIntakeVsTrend({
            avgIntakeKcal: completeDayAverage.calories,
            daysLogged: completeDayAverage.days,
            goalKcal: targets?.calories ?? null,
            burnKcal: estimatedBurnKcal,
            burnSettling,
            observedPerWeek: observedWeightPerWeek,
            unit: weightUnit,
          })
        : null,
    [completeDayAverage, targets?.calories, estimatedBurnKcal, burnSettling, observedWeightPerWeek, weightUnit]
  );

  // Determine Y-axis domain for calories
  const caloriesDomain = useMemo(() => {
    const values = chartData.filter((d) => d.hasData).map((d) => d.calories);
    if (values.length === 0) return [0, 3000];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const targetCal = targets?.calories || 0;
    const upperBound = Math.max(max, targetCal) * 1.1;
    const lowerBound = Math.max(0, Math.min(min, targetCal) * 0.9);
    return [Math.floor(lowerBound / 100) * 100, Math.ceil(upperBound / 100) * 100];
  }, [chartData, targets]);

  // Determine Y-axis domain for macros
  const macrosDomain = useMemo(() => {
    const values = chartData.filter((d) => d.hasData);
    if (values.length === 0) return [0, 300];
    const allMacros = values.flatMap((d) => [d.protein, d.carbs, d.fat]);
    const targetMacros = [targets?.protein || 0, targets?.carbs || 0, targets?.fat || 0];
    const max = Math.max(...allMacros, ...targetMacros);
    return [0, Math.ceil(max * 1.1 / 50) * 50];
  }, [chartData, targets]);

  // Thin x-axis date ticks by range so labels don't overlap on small screens.
  const tickStep = dateTickStep(days);
  const formatXAxisTick = (value: string, index: number) =>
    showDateTick(index, chartData.length, tickStep) ? value : '';

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nutrition trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="animate-pulse text-ink-2">Loading...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show empty state if no data logged
  if (!averages || averages.daysTracked === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nutrition trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-fill flex items-center justify-center">
              <IconChartBar size={28} className="text-ink-2" aria-hidden="true" />
            </div>
            <h3 className="text-headline font-semibold text-ink mb-2">
              No nutrition data yet
            </h3>
            <p className="text-ink-3 max-w-md mx-auto">
              Start logging meals to see your nutrition trends over time. Track how your intake aligns with your targets.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            Nutrition trends
            {averages && (
              <span className="text-subhead font-normal text-ink-2">
                ({averages.daysTracked} days tracked)
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg bg-fill p-0.5">
              <button
                onClick={() => setViewMode('calories')}
                className={`px-3 py-1.5 text-caption font-medium rounded-md transition-colors ${
                  viewMode === 'calories'
                    ? 'bg-action text-on-action'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Calories
              </button>
              <button
                onClick={() => setViewMode('macros')}
                className={`px-3 py-1.5 text-caption font-medium rounded-md transition-colors ${
                  viewMode === 'macros'
                    ? 'bg-action text-on-action'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Macros
              </button>
            </div>
            {/* Time range selector */}
            <div className="flex rounded-lg bg-fill p-0.5">
              {TIME_RANGES.map((range) => (
                <button
                  key={range.days}
                  onClick={() => setDays(range.days)}
                  className={`px-2.5 py-1.5 text-caption font-medium rounded-md transition-colors ${
                    days === range.days
                      ? 'bg-action text-on-action'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Averages summary */}
        {averages && (
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="text-center p-2 bg-fill/50 rounded-lg">
              <div className="text-caption text-ink-3">Avg calories</div>
              <div className="text-headline font-semibold text-action">{averages.calories}</div>
            </div>
            <div className="text-center p-2 bg-fill/50 rounded-lg">
              <div className="text-caption text-ink-3">Avg protein</div>
              <div className="text-headline font-semibold text-action">{averages.protein}g</div>
            </div>
            <div className="text-center p-2 bg-fill/50 rounded-lg">
              <div className="text-caption text-ink-3">Avg carbs</div>
              <div className="text-headline font-semibold text-status-warn">{averages.carbs}g</div>
            </div>
            <div className="text-center p-2 bg-fill/50 rounded-lg">
              <div className="text-caption text-ink-3">Avg fat</div>
              <div className="text-headline font-semibold text-status-bad">{averages.fat}g</div>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {viewMode === 'calories' ? (
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="displayDate"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  interval={0}
                  minTickGap={0}
                  tickFormatter={formatXAxisTick}
                  angle={-35}
                  textAnchor="end"
                  height={44}
                  tickMargin={6}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  domain={caloriesDomain}
                  tickFormatter={(value) => `${(value / 1000).toFixed(1)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                {targets?.calories && (
                  <ReferenceLine
                    y={targets.calories}
                    stroke="#22c55e"
                    strokeDasharray="5 3"
                    strokeWidth={2}
                    label={{
                      value: `Target: ${targets.calories}`,
                      position: 'insideTopRight',
                      fontSize: 10,
                      fill: '#22c55e',
                    }}
                  />
                )}
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="calories"
                  name="Calories"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={{ fill: '#0ea5e9', r: 3 }}
                  activeDot={{ r: 5, fill: '#0ea5e9' }}
                  connectNulls={false}
                />
              </LineChart>
            ) : (
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis
                  dataKey="displayDate"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  interval={0}
                  minTickGap={0}
                  tickFormatter={formatXAxisTick}
                  angle={-35}
                  textAnchor="end"
                  height={44}
                  tickMargin={6}
                />
                <YAxis
                  stroke="#71717a"
                  fontSize={11}
                  tickLine={false}
                  domain={macrosDomain}
                  tickFormatter={(value) => `${value}g`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                  iconType="line"
                />
                {targets?.protein && (
                  <ReferenceLine
                    y={targets.protein}
                    stroke="#a78bfa"
                    strokeDasharray="3 3"
                    strokeOpacity={0.5}
                  />
                )}
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="protein"
                  name="Protein"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={{ fill: '#a78bfa', r: 2 }}
                  activeDot={{ r: 4 }}
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="carbs"
                  name="Carbs"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ fill: '#f59e0b', r: 2 }}
                  activeDot={{ r: 4 }}
                />
                <Line
                  isAnimationActive={false}
                  type="monotone"
                  dataKey="fat"
                  name="Fat"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ fill: '#ef4444', r: 2 }}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Interpretation */}
        {/* Interpretation: what "under goal" means (logged intake vs the
            goal), and how intake vs estimated burn compares with the weight
            trend. See lib/nutrition/intakeVsTrend. */}
        {explanation && (explanation.goalLine || explanation.burnLine) && (
          <div className="mt-4 space-y-1.5 rounded-lg bg-fill/30 p-3" data-testid="intake-vs-trend">
            {explanation.goalLine && (
              <p className="text-caption text-ink-2" data-testid="intake-vs-goal">
                {completeDayAverage && targets?.calories ? (
                  <span
                    className={`font-medium ${
                      completeDayAverage.calories > targets.calories
                        ? 'text-status-warn'
                        : completeDayAverage.calories < targets.calories * 0.9
                          ? 'text-action'
                          : 'text-status-ok'
                    }`}
                  >
                    {completeDayAverage.calories > targets.calories
                      ? 'Above goal: '
                      : completeDayAverage.calories < targets.calories * 0.9
                        ? 'Below goal: '
                        : 'On track: '}
                  </span>
                ) : null}
                {explanation.goalLine}
              </p>
            )}
            {explanation.burnLine && (
              <p className="text-caption text-ink-2" data-testid="intake-vs-burn">
                {explanation.burnLine}
              </p>
            )}
            {explanation.trendLine && (
              <p className="text-caption text-ink-2" data-testid="intake-vs-weight">
                {explanation.trendLine}
              </p>
            )}
            <p className="text-caption text-ink-3">Today isn&apos;t counted until it&apos;s over.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default NutritionTrendGraph;
