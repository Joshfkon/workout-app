'use client';

import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { ProgressRing, ProgressBar, BenchmarkBar, ProportionsBenchmarkBar } from './ProgressVisualization';
import {
  formatMeasurement,
  formatMeasurementValue,
  formatWeight,
  formatHeight,
} from '@/lib/utils';
import type {
  BodyCompositionTarget,
  TargetProgress,
  Mesocycle,
  MeasurementTargets,
} from '@/types/schema';
import type {
  ProportionalityRatio,
  MeasurementBenchmark,
  EnhancedProportionsAnalysis,
} from '@/services/bodyProportionsAnalytics';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
  Legend,
} from 'recharts';

// ============================================================
// TYPES
// ============================================================

export interface GoalsTabProps {
  /** Active mesocycle (if any) */
  activeMesocycle: Mesocycle | null;
  /** Active body composition target */
  activeTarget: BodyCompositionTarget | null;
  /** Current body composition data */
  currentBodyComp: {
    weightKg: number | null;
    bodyFatPercent: number | null;
    ffmi: number | null;
    leanMassKg: number | null;
  };
  /** Current measurements (in cm) */
  currentMeasurements: Record<string, number>;
  /** Weight history for projections */
  weightHistory: Array<{
    date: string;
    weightKg: number;
  }>;
  /** Proportions analysis (from body proportions service) */
  proportionsAnalysis: EnhancedProportionsAnalysis | null;
  /** User's height in cm */
  heightCm: number | null;
  /** Display unit for measurements */
  displayUnit: 'in' | 'cm';
  /** Weight unit preference */
  weightUnit: 'kg' | 'lb';
  /** Callback to open edit goals modal */
  onEditGoals: () => void;
  /** Callback to create mesocycle */
  onCreateMesocycle: () => void;
}

interface TrackingStatus {
  status: 'ahead' | 'on_track' | 'behind' | 'off_track' | 'not_started';
  icon: string;
  color: string;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getTrackingStatus(
  current: number | null | undefined,
  target: number | null | undefined,
  mesocycleProgress: number, // 0-1, how far through the mesocycle we are
  isLowerBetter: boolean = false
): TrackingStatus {
  if (current == null || target == null) {
    return { status: 'not_started', icon: '○', color: 'text-surface-500' };
  }

  const diff = target - current;
  const expectedProgress = mesocycleProgress;
  const totalChange = Math.abs(diff);
  const actualChange = isLowerBetter ? current - target : target - current;
  const progressMade = totalChange > 0 ? actualChange / totalChange : 1;

  if (progressMade >= expectedProgress + 0.15) {
    return { status: 'ahead', icon: '▲', color: 'text-success-400' };
  } else if (progressMade >= expectedProgress - 0.15) {
    return { status: 'on_track', icon: '●', color: 'text-primary-400' };
  } else if (progressMade >= expectedProgress - 0.35) {
    return { status: 'behind', icon: '▼', color: 'text-warning-400' };
  } else {
    return { status: 'off_track', icon: '▼▼', color: 'text-danger-400' };
  }
}

function calculateProgress(
  current: number | null | undefined,
  start: number | null | undefined,
  target: number | null | undefined
): number {
  if (current == null || start == null || target == null) return 0;
  if (start === target) return current === target ? 100 : 0;
  const progress = ((current - start) / (target - start)) * 100;
  return Math.max(0, Math.min(100, progress));
}

function formatChange(current: number, target: number, unit: string, precision: number = 1): string {
  const diff = target - current;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(precision)} ${unit}`;
}

// ============================================================
// NO ACTIVE MESOCYCLE STATE
// ============================================================

function NoActiveMesocycle({ onCreateMesocycle }: { onCreateMesocycle: () => void }) {
  return (
    <Card className="border-dashed border-surface-600">
      <CardContent className="py-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-surface-800 flex items-center justify-center mb-4">
          <span className="text-3xl">🎯</span>
        </div>
        <h3 className="text-lg font-medium text-surface-200 mb-2">No Active Goals</h3>
        <p className="text-sm text-surface-400 mb-6 max-w-md">
          Create a mesocycle with body composition targets to track your progress toward specific goals.
        </p>
        <Button onClick={onCreateMesocycle}>Create Mesocycle</Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// MESOCYCLE HEADER
// ============================================================

interface MesocycleHeaderProps {
  mesocycle: Mesocycle;
  target: BodyCompositionTarget | null;
  onEditGoals: () => void;
}

function MesocycleHeader({ mesocycle, target, onEditGoals }: MesocycleHeaderProps) {
  const progressPercent = (mesocycle.currentWeek / mesocycle.totalWeeks) * 100;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
              <span className="text-primary-400">📅</span>
            </div>
            <div>
              <h3 className="font-medium text-surface-200">
                {target?.name || mesocycle.name}
              </h3>
              <p className="text-xs text-surface-500">
                Week {mesocycle.currentWeek} of {mesocycle.totalWeeks}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onEditGoals}>
            Edit Goals
          </Button>
        </div>
        <div className="relative h-2 bg-surface-800 rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// BODY COMPOSITION TARGETS CARD
// ============================================================

interface BodyCompTargetsCardProps {
  currentBodyComp: GoalsTabProps['currentBodyComp'];
  target: BodyCompositionTarget | null;
  mesocycleProgress: number; // 0-1
  weightUnit: 'kg' | 'lb';
}

function BodyCompTargetsCard({
  currentBodyComp,
  target,
  mesocycleProgress,
  weightUnit,
}: BodyCompTargetsCardProps) {
  const metrics = useMemo(() => {
    const { weightKg, bodyFatPercent, ffmi } = currentBodyComp;
    const weightDisplay = weightUnit === 'lb' && weightKg
      ? weightKg * 2.20462
      : weightKg;
    const targetWeightDisplay = weightUnit === 'lb' && target?.targetWeightKg
      ? target.targetWeightKg * 2.20462
      : target?.targetWeightKg;
    const unit = weightUnit === 'lb' ? 'lbs' : 'kg';

    return [
      {
        key: 'weight',
        label: 'Weight',
        current: weightDisplay,
        target: targetWeightDisplay,
        unit,
        precision: 1,
        lowerIsBetter: target?.targetWeightKg ? target.targetWeightKg < (weightKg || 0) : false,
      },
      {
        key: 'bodyFat',
        label: 'Body Fat',
        current: bodyFatPercent,
        target: target?.targetBodyFatPercent,
        unit: '%',
        precision: 1,
        lowerIsBetter: true,
      },
      {
        key: 'ffmi',
        label: 'FFMI',
        current: ffmi,
        target: target?.targetFfmi,
        unit: '',
        precision: 1,
        lowerIsBetter: false,
      },
    ];
  }, [currentBodyComp, target, weightUnit]);

  if (!target) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Body Composition Targets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-surface-500">
            No body composition targets set. Edit your goals to add targets.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Body Composition Targets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {metrics.map((metric) => {
            const hasData = metric.current != null && metric.target != null;
            const status = getTrackingStatus(
              metric.current ?? undefined,
              metric.target ?? undefined,
              mesocycleProgress,
              metric.lowerIsBetter
            );
            // Calculate progress (for visualization, assuming linear from start)
            const progressValue = hasData
              ? Math.min(100, Math.max(0,
                  metric.lowerIsBetter
                    ? ((metric.current! - metric.target!) / (metric.current! - metric.target!) * 100) || 50
                    : 50 // Default to 50% when we don't have start data
                ))
              : 0;

            return (
              <div key={metric.key} className="flex flex-col items-center">
                <ProgressRing
                  value={hasData ? progressValue : 0}
                  size={64}
                  strokeWidth={5}
                  variant={
                    status.status === 'ahead' || status.status === 'on_track'
                      ? 'success'
                      : status.status === 'behind'
                      ? 'warning'
                      : status.status === 'off_track'
                      ? 'danger'
                      : 'default'
                  }
                  showValue={false}
                />
                <div className="mt-2 text-center">
                  <p className="text-lg font-bold text-surface-100">
                    {metric.target != null
                      ? `${metric.target.toFixed(metric.precision)}${metric.unit}`
                      : '—'}
                  </p>
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider">
                    {metric.label}
                  </p>
                  {hasData && (
                    <>
                      <p className="text-xs text-surface-400 mt-1">
                        Current: {metric.current!.toFixed(metric.precision)}{metric.unit}
                      </p>
                      <p className={`text-xs mt-0.5 flex items-center justify-center gap-1 ${status.color}`}>
                        <span>{status.icon}</span>
                        <span>{formatChange(metric.current!, metric.target!, metric.unit, metric.precision)}</span>
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* On track summary */}
        <div className="mt-4 pt-4 border-t border-surface-800">
          <div className="flex items-center justify-center gap-4 text-xs">
            {metrics.map((metric) => {
              const status = getTrackingStatus(
                metric.current ?? undefined,
                metric.target ?? undefined,
                mesocycleProgress,
                metric.lowerIsBetter
              );
              if (metric.target == null) return null;
              return (
                <span key={metric.key} className={`flex items-center gap-1 ${status.color}`}>
                  <span>{status.icon}</span>
                  <span>{metric.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// PROPORTIONS ANALYSIS WITH TARGETS
// ============================================================

interface ProportionsAnalysisWithTargetsProps {
  ratios: ProportionalityRatio[];
  targetRatios?: Partial<Record<string, number>>; // target values by ratio name
  overallScore: number;
  targetOverallScore?: number;
}

function ProportionsAnalysisWithTargets({
  ratios,
  targetRatios,
  overallScore,
  targetOverallScore,
}: ProportionsAnalysisWithTargetsProps) {
  const [expandedRatio, setExpandedRatio] = useState<string | null>(null);

  if (ratios.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Proportions Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-surface-500">
            Add more measurements to see your proportionality targets.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            Proportions Analysis
          </CardTitle>
          {targetOverallScore && (
            <span className="text-xs text-surface-400">
              {Math.round(overallScore)}% → {Math.round(targetOverallScore)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-surface-500">
          Target proportions for this mesocycle:
        </p>

        {ratios.map((ratio) => {
          const targetValue = targetRatios?.[ratio.name];
          const isExpanded = expandedRatio === ratio.name;

          return (
            <div key={ratio.name}>
              <button
                onClick={() => setExpandedRatio(isExpanded ? null : ratio.name)}
                className="w-full text-left"
              >
                <ProportionsBenchmarkBar
                  current={ratio.currentValue}
                  target={targetValue ?? ratio.idealValue}
                  range={ratio.acceptableRange}
                  label={ratio.name}
                  status={ratio.status}
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-surface-500">{ratio.formula}</span>
                  <span className="text-[10px] text-surface-500">
                    {ratio.percentOfIdeal}% of ideal
                    {targetValue && ratio.currentValue !== targetValue && (
                      <span className="text-primary-400 ml-1">
                        → {Math.round((targetValue / ratio.idealValue) * 100)}%
                      </span>
                    )}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="pl-2 border-l-2 border-surface-700 space-y-1 mt-2">
                  <p className="text-xs text-surface-400">{ratio.description}</p>
                  {ratio.recommendation && (
                    <p className="text-xs text-primary-400">{ratio.recommendation}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ============================================================
// HOW YOU COMPARE WITH TARGETS
// ============================================================

interface HowYouCompareWithTargetsProps {
  benchmarks: MeasurementBenchmark[];
  targetMeasurements?: MeasurementTargets;
  heightCm: number;
  heightScaleFactor: number;
  displayUnit: 'in' | 'cm';
}

function HowYouCompareWithTargets({
  benchmarks,
  targetMeasurements,
  heightCm,
  heightScaleFactor,
  displayUnit,
}: HowYouCompareWithTargetsProps) {
  const [showAll, setShowAll] = useState(false);
  const displayedBenchmarks = showAll ? benchmarks : benchmarks.slice(0, 4);

  if (benchmarks.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">How You Compare</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-surface-500">
            Add measurements to see how you compare to physique benchmarks.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Map measurement names to target keys
  const measurementToTargetKey: Record<string, keyof MeasurementTargets> = {
    'Shoulders': 'shoulders',
    'Chest': 'chest',
    'Upper Back': 'upper_back',
    'Waist': 'waist',
    'Hips': 'hips',
    'Neck': 'neck',
    'Biceps': 'left_bicep', // Use left as representative
    'Thighs': 'left_thigh',
    'Calves': 'left_calf',
    'Forearms': 'left_forearm',
  };

  const convertBenchmarks = (b: MeasurementBenchmark['benchmarks']) => ({
    attainable: {
      min: formatMeasurementValue(b.attainable.min, displayUnit),
      max: formatMeasurementValue(b.attainable.max, displayUnit),
    },
    elite: {
      min: formatMeasurementValue(b.elite.min, displayUnit),
      max: formatMeasurementValue(b.elite.max, displayUnit),
    },
    superhero: {
      min: formatMeasurementValue(b.superhero.min, displayUnit),
      max: formatMeasurementValue(b.superhero.max, displayUnit),
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">How You Compare</CardTitle>
          <span className="text-[10px] text-surface-500">
            Scaled for {formatHeight(heightCm, displayUnit)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-[10px] text-surface-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full border-2 border-white" />
            <span>Current</span>
          </div>
          {targetMeasurements && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded border border-primary-400 bg-primary-400/20" />
              <span>Target</span>
            </div>
          )}
          <div className="flex items-center gap-1 ml-2">
            <div className="w-2 h-2 rounded bg-warning-500/50" />
            <span>Attainable</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-primary-500/50" />
            <span>Elite</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-success-500/50" />
            <span>Superhero</span>
          </div>
        </div>

        {displayedBenchmarks.map((benchmark) => {
          const targetKey = measurementToTargetKey[benchmark.measurement];
          const targetCm = targetKey ? targetMeasurements?.[targetKey] : undefined;
          const targetDisplay = targetCm
            ? formatMeasurementValue(targetCm, displayUnit)
            : undefined;

          return (
            <div key={benchmark.measurement} className="space-y-1">
              <BenchmarkBar
                label={benchmark.measurement}
                current={formatMeasurementValue(benchmark.currentCm, displayUnit)}
                benchmarks={convertBenchmarks(benchmark.benchmarks)}
                currentTier={benchmark.currentTier}
                unit={displayUnit}
                isInverted={benchmark.measurement.toLowerCase() === 'waist'}
              />
              {targetDisplay && targetDisplay !== formatMeasurementValue(benchmark.currentCm, displayUnit) && (
                <div className="flex items-center gap-2 pl-2">
                  <span className="text-[10px] text-primary-400">
                    Target: {targetDisplay} {displayUnit}
                  </span>
                  <span className="text-[10px] text-surface-500">
                    ({(targetDisplay - formatMeasurementValue(benchmark.currentCm, displayUnit)) >= 0 ? '+' : ''}
                    {(targetDisplay - formatMeasurementValue(benchmark.currentCm, displayUnit)).toFixed(1)} {displayUnit})
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {benchmarks.length > 4 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full text-center text-xs text-primary-400 hover:text-primary-300 py-1"
          >
            {showAll ? 'Show less' : `Show ${benchmarks.length - 4} more`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// WEIGHT PROJECTION CHART
// ============================================================

interface WeightProjectionProps {
  weightHistory: Array<{ date: string; weightKg: number }>;
  targetWeight: number | undefined;
  mesocycleWeeks: number;
  currentWeek: number;
  weightUnit: 'kg' | 'lb';
}

function WeightProjection({
  weightHistory,
  targetWeight,
  mesocycleWeeks,
  currentWeek,
  weightUnit,
}: WeightProjectionProps) {
  const chartData = useMemo(() => {
    if (weightHistory.length === 0) return [];

    const convertWeight = (kg: number) =>
      weightUnit === 'lb' ? kg * 2.20462 : kg;

    // Group by week and calculate weekly averages
    const weeklyData: Array<{
      week: number;
      actual: number | null;
      projected: number | null;
    }> = [];

    // Get start date from first weigh-in
    const startDate = new Date(weightHistory[0].date);
    const startWeight = convertWeight(weightHistory[0].weightKg);
    const targetWeightDisplay = targetWeight ? convertWeight(targetWeight) : null;

    // Calculate weekly rate based on historical data
    const endWeight = convertWeight(weightHistory[weightHistory.length - 1].weightKg);
    const weeksOfData = Math.max(1,
      Math.ceil((new Date(weightHistory[weightHistory.length - 1].date).getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
    );
    const weeklyRate = (endWeight - startWeight) / weeksOfData;

    for (let week = 1; week <= mesocycleWeeks; week++) {
      if (week <= currentWeek) {
        // Calculate actual weight for this week (average of weigh-ins in that week)
        const weekStart = new Date(startDate);
        weekStart.setDate(weekStart.getDate() + (week - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const weekWeighIns = weightHistory.filter((w) => {
          const date = new Date(w.date);
          return date >= weekStart && date < weekEnd;
        });

        const avgWeight =
          weekWeighIns.length > 0
            ? weekWeighIns.reduce((sum, w) => sum + convertWeight(w.weightKg), 0) /
              weekWeighIns.length
            : null;

        weeklyData.push({
          week,
          actual: avgWeight,
          projected: null,
        });
      } else {
        // Project future weights based on current rate
        const projectedWeight = endWeight + weeklyRate * (week - currentWeek);
        weeklyData.push({
          week,
          actual: null,
          projected: projectedWeight,
        });
      }
    }

    return weeklyData;
  }, [weightHistory, targetWeight, mesocycleWeeks, currentWeek, weightUnit]);

  if (weightHistory.length < 2) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Weight Projection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-surface-500">
            Add more weigh-ins to see your weight projection.
          </p>
        </CardContent>
      </Card>
    );
  }

  const unit = weightUnit === 'lb' ? 'lbs' : 'kg';
  const targetWeightDisplay = targetWeight
    ? (weightUnit === 'lb' ? targetWeight * 2.20462 : targetWeight)
    : null;

  // Calculate projection stats
  const lastActual = chartData.filter((d) => d.actual !== null).pop();
  const finalProjected = chartData.filter((d) => d.projected !== null).pop();
  const projectedEndWeight = finalProjected?.projected ?? lastActual?.actual ?? 0;
  const currentWeekRate = lastActual && chartData.length > 1
    ? (lastActual.actual! - (chartData[0].actual ?? lastActual.actual!)) / currentWeek
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Weight Projection</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="week"
                stroke="#9ca3af"
                fontSize={10}
                tickFormatter={(w) => `W${w}`}
              />
              <YAxis stroke="#9ca3af" fontSize={10} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#f3f4f6',
                  fontSize: '12px',
                }}
                formatter={(value: number, name: string) => [
                  `${value.toFixed(1)} ${unit}`,
                  name === 'actual' ? 'Actual' : 'Projected',
                ]}
                labelFormatter={(week) => `Week ${week}`}
              />
              {targetWeightDisplay && (
                <ReferenceLine
                  y={targetWeightDisplay}
                  stroke="#22c55e"
                  strokeDasharray="5 5"
                  label={{
                    value: `Target: ${targetWeightDisplay.toFixed(1)}`,
                    position: 'right',
                    fontSize: 10,
                    fill: '#22c55e',
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 4, fill: '#6366f1' }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="projected"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 3, fill: '#6366f1', strokeDasharray: '0' }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Stats below chart */}
        <div className="mt-3 pt-3 border-t border-surface-800 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-surface-500 uppercase">Weekly Rate</p>
            <p className={`text-sm font-medium ${currentWeekRate < 0 ? 'text-success-400' : currentWeekRate > 0 ? 'text-warning-400' : 'text-surface-300'}`}>
              {currentWeekRate >= 0 ? '+' : ''}{currentWeekRate.toFixed(2)} {unit}/wk
            </p>
          </div>
          <div>
            <p className="text-[10px] text-surface-500 uppercase">Projected End</p>
            <p className="text-sm font-medium text-surface-200">
              {projectedEndWeight.toFixed(1)} {unit}
            </p>
          </div>
          {targetWeightDisplay && (
            <div>
              <p className="text-[10px] text-surface-500 uppercase">vs Target</p>
              <p className={`text-sm font-medium ${
                Math.abs(projectedEndWeight - targetWeightDisplay) < 1
                  ? 'text-success-400'
                  : projectedEndWeight > targetWeightDisplay
                  ? 'text-warning-400'
                  : 'text-primary-400'
              }`}>
                {projectedEndWeight > targetWeightDisplay ? '+' : ''}
                {(projectedEndWeight - targetWeightDisplay).toFixed(1)} {unit}
              </p>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-surface-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-primary-500 rounded" />
            Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-primary-500 rounded" style={{ background: 'repeating-linear-gradient(90deg, #6366f1 0px, #6366f1 3px, transparent 3px, transparent 6px)' }} />
            Projected
          </span>
          {targetWeightDisplay && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-success-500 rounded" style={{ background: 'repeating-linear-gradient(90deg, #22c55e 0px, #22c55e 3px, transparent 3px, transparent 6px)' }} />
              Target
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// FFMI PROJECTION
// ============================================================

interface FFMIProjectionProps {
  currentFFMI: number | null;
  targetFFMI: number | undefined;
  startFFMI?: number;
}

function FFMIProjection({ currentFFMI, targetFFMI, startFFMI }: FFMIProjectionProps) {
  if (currentFFMI == null) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">FFMI Projection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-surface-500">
            Add body composition data to see your FFMI projection.
          </p>
        </CardContent>
      </Card>
    );
  }

  // FFMI tiers
  const tiers = [
    { label: 'Average', min: 18, max: 20, color: 'bg-surface-600' },
    { label: 'Above Avg', min: 20, max: 22, color: 'bg-warning-500/50' },
    { label: 'Excellent', min: 22, max: 24, color: 'bg-primary-500/50' },
    { label: 'Elite', min: 24, max: 26, color: 'bg-success-500/50' },
  ];

  const naturalCeiling = 25; // Approximate natural ceiling for most males
  const distanceToCeiling = naturalCeiling - currentFFMI;

  // Determine feasibility of target
  const getFeasibility = () => {
    if (!targetFFMI) return null;
    const change = targetFFMI - currentFFMI;
    if (change <= 0.3) return { label: 'Very Achievable', color: 'text-success-400' };
    if (change <= 0.6) return { label: 'Achievable', color: 'text-primary-400' };
    if (change <= 1.0) return { label: 'Ambitious', color: 'text-warning-400' };
    if (change <= 1.5) return { label: 'Very Ambitious', color: 'text-warning-500' };
    return { label: 'Unrealistic', color: 'text-danger-400' };
  };

  const feasibility = getFeasibility();
  const visualMin = 17;
  const visualMax = 27;
  const visualRange = visualMax - visualMin;

  const toPercent = (val: number) => ((val - visualMin) / visualRange) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">FFMI Projection</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Visual bar */}
        <div className="relative h-10 bg-surface-900 rounded overflow-hidden mb-4">
          {/* Tier zones */}
          {tiers.map((tier) => (
            <div
              key={tier.label}
              className={`absolute top-0 bottom-0 ${tier.color}`}
              style={{
                left: `${toPercent(tier.min)}%`,
                width: `${toPercent(tier.max) - toPercent(tier.min)}%`,
              }}
            />
          ))}

          {/* Tier labels */}
          <div className="absolute inset-0 flex items-end pb-1">
            {tiers.map((tier) => (
              <div
                key={tier.label}
                className="absolute text-[8px] text-surface-400 text-center"
                style={{
                  left: `${toPercent(tier.min) + (toPercent(tier.max) - toPercent(tier.min)) / 2}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                {tier.label}
              </div>
            ))}
          </div>

          {/* Current marker */}
          <div
            className="absolute top-0 bottom-0 flex flex-col items-center justify-start pt-1"
            style={{ left: `${toPercent(currentFFMI)}%`, transform: 'translateX(-50%)' }}
          >
            <div className="w-1 h-4 bg-white rounded" />
            <span className="text-[10px] text-white font-bold mt-0.5">▲</span>
          </div>

          {/* Target marker */}
          {targetFFMI && (
            <div
              className="absolute top-0 bottom-0 flex flex-col items-center justify-start pt-1"
              style={{ left: `${toPercent(targetFFMI)}%`, transform: 'translateX(-50%)' }}
            >
              <div className="w-1 h-4 bg-primary-400 rounded" />
              <span className="text-[10px] text-primary-400 font-bold mt-0.5">○</span>
            </div>
          )}
        </div>

        {/* Scale labels */}
        <div className="flex justify-between text-[10px] text-surface-500 mb-4">
          {[18, 20, 22, 24, 26].map((val) => (
            <span key={val}>{val}</span>
          ))}
        </div>

        {/* Stats */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-surface-400">Current FFMI</span>
            <span className="text-surface-200 font-medium">{currentFFMI.toFixed(1)}</span>
          </div>
          {targetFFMI && (
            <div className="flex justify-between text-xs">
              <span className="text-surface-400">Target FFMI</span>
              <span className="text-primary-400 font-medium">{targetFFMI.toFixed(1)}</span>
            </div>
          )}
          {feasibility && (
            <div className="flex justify-between text-xs">
              <span className="text-surface-400">Feasibility</span>
              <span className={`font-medium ${feasibility.color}`}>{feasibility.label}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-surface-400">Natural ceiling estimate</span>
            <span className="text-surface-300">~{naturalCeiling.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-surface-400">Distance to ceiling</span>
            <span className="text-surface-300">~{distanceToCeiling.toFixed(1)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// MAIN GOALS TAB COMPONENT
// ============================================================

export function GoalsTab({
  activeMesocycle,
  activeTarget,
  currentBodyComp,
  currentMeasurements,
  weightHistory,
  proportionsAnalysis,
  heightCm,
  displayUnit,
  weightUnit,
  onEditGoals,
  onCreateMesocycle,
}: GoalsTabProps) {
  // No active mesocycle - show empty state
  if (!activeMesocycle) {
    return <NoActiveMesocycle onCreateMesocycle={onCreateMesocycle} />;
  }

  // Calculate mesocycle progress (0-1)
  const mesocycleProgress = activeMesocycle.currentWeek / activeMesocycle.totalWeeks;

  return (
    <div className="space-y-6">
      {/* Mesocycle Header */}
      <MesocycleHeader
        mesocycle={activeMesocycle}
        target={activeTarget}
        onEditGoals={onEditGoals}
      />

      {/* Body Composition Targets */}
      <BodyCompTargetsCard
        currentBodyComp={currentBodyComp}
        target={activeTarget}
        mesocycleProgress={mesocycleProgress}
        weightUnit={weightUnit}
      />

      {/* Proportions Analysis with Targets */}
      {proportionsAnalysis && (
        <ProportionsAnalysisWithTargets
          ratios={proportionsAnalysis.proportionalityRatios}
          overallScore={proportionsAnalysis.scoreBreakdown.overall}
        />
      )}

      {/* How You Compare with Targets */}
      {proportionsAnalysis && heightCm && (
        <HowYouCompareWithTargets
          benchmarks={proportionsAnalysis.benchmarkComparisons}
          targetMeasurements={activeTarget?.measurementTargets}
          heightCm={heightCm}
          heightScaleFactor={proportionsAnalysis.heightScaleFactor}
          displayUnit={displayUnit}
        />
      )}

      {/* Weight Projection */}
      <WeightProjection
        weightHistory={weightHistory}
        targetWeight={activeTarget?.targetWeightKg}
        mesocycleWeeks={activeMesocycle.totalWeeks}
        currentWeek={activeMesocycle.currentWeek}
        weightUnit={weightUnit}
      />

      {/* FFMI Projection */}
      <FFMIProjection
        currentFFMI={currentBodyComp.ffmi}
        targetFFMI={activeTarget?.targetFfmi}
      />
    </div>
  );
}

export default GoalsTab;
