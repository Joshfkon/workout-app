'use client';

/**
 * Proportions & targets — the Body tab's single home for the content that
 * used to be duplicated across the Goals tab and the Body tab:
 *
 *   - How You Compare (physique benchmarks vs current + target tape)
 *   - FFMI ceiling (current vs target vs experience-scaled natural ceiling)
 *   - Weight projection (actual weekly averages + linear projection vs target)
 *
 * Each section is collapsed by default (Accordion) so the tab stays scannable.
 * The proportionality-ratio analysis itself renders ONCE inside the
 * BodyMeasurements card's "Proportions analysis" section — this card
 * deliberately does not repeat it.
 *
 * Scope honesty: none of these sections follow the page's global time-range
 * selector — the projection is explicitly labeled with its own window.
 */

import { useMemo, useState } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui';
import { BenchmarkBar } from './ProgressVisualization';
import { formatMeasurementValue, formatHeight, parseLocalDate } from '@/lib/utils';
import { getNaturalFFMILimit } from '@/services/bodyCompEngine';
import type {
  BodyCompositionTarget,
  Mesocycle,
  MeasurementTargets,
  Experience,
} from '@/types/schema';
import type { MeasurementBenchmark } from '@/services/bodyProportionsAnalytics';
import type { ResolvedPartition } from '@/services/waistTrend';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export interface ProportionsTargetsCardProps {
  benchmarks: MeasurementBenchmark[];
  activeTarget: BodyCompositionTarget | null;
  activeMesocycle: Mesocycle | null;
  /** Canonical FFMI (selectCanonicalFfmi) — raw value. */
  currentFfmi: number | null;
  experience: Experience | null;
  heightCm: number | null;
  displayUnit: 'in' | 'cm';
  weightUnit: 'kg' | 'lb';
  /** Weigh-ins in kg — the SAME source the Home weight tile reads. */
  weightHistory: Array<{ date: string; weightKg: number }>;
  /**
   * Observed-vs-assumed lean/fat partition for the projected weight change.
   * When source==='waist' it came from the waist trend; otherwise the fixed
   * assumption. Undefined until enough data — the card falls back to assumed.
   */
  partition?: ResolvedPartition;
}

// ============================================================
// HOW YOU COMPARE
// ============================================================

function HowYouCompareSection({
  benchmarks,
  targetMeasurements,
  heightCm,
  displayUnit,
}: {
  benchmarks: MeasurementBenchmark[];
  targetMeasurements?: MeasurementTargets;
  heightCm: number;
  displayUnit: 'in' | 'cm';
}) {
  const [showAll, setShowAll] = useState(false);
  const displayedBenchmarks = showAll ? benchmarks : benchmarks.slice(0, 4);

  if (benchmarks.length === 0) {
    return (
      <p className="text-caption text-ink-3">
        Add measurements to see how you compare to physique benchmarks.
      </p>
    );
  }

  const measurementToTargetKey: Record<string, keyof MeasurementTargets> = {
    Shoulders: 'shoulders',
    Chest: 'chest',
    'Upper Back': 'upper_back',
    Waist: 'waist',
    Hips: 'hips',
    Neck: 'neck',
    Biceps: 'left_bicep',
    Thighs: 'left_thigh',
    Calves: 'left_calf',
    Forearms: 'left_forearm',
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-caption text-ink-3 flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full border-2 border-sep" />
            <span>Current</span>
          </div>
          {targetMeasurements && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded border border-action bg-action/20" />
              <span>Target</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-status-warn/50" />
            <span>Attainable</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-action/50" />
            <span>Elite</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-status-ok/50" />
            <span>Superhero</span>
          </div>
        </div>
        <span className="text-caption text-ink-3 flex-shrink-0">
          Scaled for {formatHeight(heightCm, displayUnit)}
        </span>
      </div>

      {displayedBenchmarks.map((benchmark) => {
        const targetKey = measurementToTargetKey[benchmark.measurement];
        const targetCm = targetKey ? targetMeasurements?.[targetKey] : undefined;
        const current = formatMeasurementValue(benchmark.currentCm, displayUnit);
        const targetDisplay = targetCm ? formatMeasurementValue(targetCm, displayUnit) : undefined;

        return (
          <div key={benchmark.measurement} className="space-y-1">
            <BenchmarkBar
              label={benchmark.measurement}
              current={current}
              benchmarks={convertBenchmarks(benchmark.benchmarks)}
              currentTier={benchmark.currentTier}
              unit={displayUnit}
              isInverted={benchmark.measurement.toLowerCase() === 'waist'}
            />
            {targetDisplay != null && targetDisplay !== current && (
              <div className="flex items-center gap-2 pl-2">
                <span className="text-caption text-action">
                  Target: {targetDisplay} {displayUnit}
                </span>
                <span className="text-caption text-ink-3">
                  ({targetDisplay - current >= 0 ? '+' : ''}
                  {(targetDisplay - current).toFixed(1)} {displayUnit})
                </span>
              </div>
            )}
          </div>
        );
      })}

      {benchmarks.length > 4 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full text-center text-caption text-action py-1"
        >
          {showAll ? 'Show less' : `Show ${benchmarks.length - 4} more`}
        </button>
      )}
    </div>
  );
}

// ============================================================
// FFMI CEILING
// ============================================================

function FfmiCeilingSection({
  currentFfmi,
  targetFfmi,
  experience,
}: {
  currentFfmi: number | null;
  targetFfmi: number | undefined;
  experience: Experience | null;
}) {
  if (currentFfmi == null) {
    return (
      <p className="text-caption text-ink-3">
        Add a body scan (DEXA) to see your muscle-to-height ceiling (FFMI).
      </p>
    );
  }

  const tiers = [
    { label: 'Average', min: 18, max: 20, color: 'bg-sep' },
    { label: 'Above Avg', min: 20, max: 22, color: 'bg-status-warn/50' },
    { label: 'Excellent', min: 22, max: 24, color: 'bg-action/50' },
    { label: 'Elite', min: 24, max: 26, color: 'bg-status-ok/50' },
  ];

  // Experience-scaled ceiling (getNaturalFFMILimit) — the old card hardcoded
  // 25 for everyone.
  const naturalCeiling = getNaturalFFMILimit(experience ?? 'intermediate');
  const distanceToCeiling = naturalCeiling - currentFfmi;

  const getFeasibility = () => {
    if (!targetFfmi) return null;
    const change = targetFfmi - currentFfmi;
    if (change <= 0.3) return { label: 'Very achievable', color: 'text-status-ok' };
    if (change <= 0.6) return { label: 'Achievable', color: 'text-action' };
    if (change <= 1.0) return { label: 'Ambitious', color: 'text-status-warn' };
    if (change <= 1.5) return { label: 'Very ambitious', color: 'text-status-warn' };
    return { label: 'Unrealistic', color: 'text-status-bad' };
  };

  const feasibility = getFeasibility();
  const visualMin = 17;
  const visualMax = 27;
  const toPercent = (val: number) =>
    Math.max(0, Math.min(100, ((val - visualMin) / (visualMax - visualMin)) * 100));

  return (
    <div>
      <div className="relative h-10 bg-card rounded overflow-hidden mb-1">
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
        <div className="absolute inset-0 flex items-end pb-1">
          {tiers.map((tier) => (
            <div
              key={tier.label}
              className="absolute text-[8px] text-ink-2 text-center"
              style={{
                left: `${toPercent(tier.min) + (toPercent(tier.max) - toPercent(tier.min)) / 2}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {tier.label}
            </div>
          ))}
        </div>
        <div
          className="absolute top-0 bottom-0 flex flex-col items-center justify-start pt-1"
          style={{ left: `${toPercent(currentFfmi)}%`, transform: 'translateX(-50%)' }}
        >
          <div className="w-1 h-4 bg-white rounded" />
          <span className="text-caption text-white font-bold mt-0.5">▲</span>
        </div>
        {targetFfmi && (
          <div
            className="absolute top-0 bottom-0 flex flex-col items-center justify-start pt-1"
            style={{ left: `${toPercent(targetFfmi)}%`, transform: 'translateX(-50%)' }}
          >
            <div className="w-1 h-4 bg-action rounded" />
            <span className="text-caption text-action font-bold mt-0.5">○</span>
          </div>
        )}
      </div>

      <div className="flex justify-between text-caption text-ink-3 mb-4">
        {[18, 20, 22, 24, 26].map((val) => (
          <span key={val}>{val}</span>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-caption">
          <span className="text-ink-2">Current muscle score (FFMI)</span>
          <span className="text-ink font-medium">{currentFfmi.toFixed(1)}</span>
        </div>
        {targetFfmi && (
          <div className="flex justify-between text-caption">
            <span className="text-ink-2">Target muscle score (FFMI)</span>
            <span className="text-action font-medium">{targetFfmi.toFixed(1)}</span>
          </div>
        )}
        {feasibility && (
          <div className="flex justify-between text-caption">
            <span className="text-ink-2">Feasibility</span>
            <span className={`font-medium ${feasibility.color}`}>{feasibility.label}</span>
          </div>
        )}
        <div className="flex justify-between text-caption">
          <span className="text-ink-2">
            Natural ceiling estimate ({experience ?? 'intermediate'})
          </span>
          <span className="text-ink-2">~{naturalCeiling.toFixed(1)}</span>
        </div>
        <div className="flex justify-between text-caption">
          <span className="text-ink-2">Distance to ceiling</span>
          <span className="text-ink-2">~{distanceToCeiling.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// WEIGHT PROJECTION
// ============================================================

/** Projection horizon when no mesocycle bounds the window. */
const DEFAULT_PROJECTION_WEEKS = 8;

function WeightProjectionSection({
  weightHistory,
  targetWeightKg,
  mesocycle,
  weightUnit,
  partition,
}: {
  weightHistory: Array<{ date: string; weightKg: number }>;
  targetWeightKg: number | undefined | null;
  mesocycle: Mesocycle | null;
  weightUnit: 'kg' | 'lb';
  partition?: ResolvedPartition;
}) {
  const mesocycleWeeks = mesocycle?.totalWeeks ?? DEFAULT_PROJECTION_WEEKS;
  const currentWeek = mesocycle?.currentWeek ?? Math.ceil(DEFAULT_PROJECTION_WEEKS / 2);

  const convertWeight = (kg: number) => (weightUnit === 'lb' ? kg * 2.20462 : kg);
  const unit = weightUnit === 'lb' ? 'lbs' : 'kg';

  const chartData = useMemo(() => {
    if (weightHistory.length === 0) return [];

    const weeklyData: Array<{ week: number; actual: number | null; projected: number | null }> = [];
    const startDate = parseLocalDate(weightHistory[0].date);
    const startWeight = convertWeight(weightHistory[0].weightKg);
    const endWeight = convertWeight(weightHistory[weightHistory.length - 1].weightKg);
    const weeksOfData = Math.max(
      1,
      Math.ceil(
        (parseLocalDate(weightHistory[weightHistory.length - 1].date).getTime() - startDate.getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      )
    );
    const weeklyRate = (endWeight - startWeight) / weeksOfData;

    for (let week = 1; week <= mesocycleWeeks; week++) {
      if (week <= currentWeek) {
        const weekStart = new Date(startDate);
        weekStart.setDate(weekStart.getDate() + (week - 1) * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const weekWeighIns = weightHistory.filter((w) => {
          const date = parseLocalDate(w.date);
          return date >= weekStart && date < weekEnd;
        });

        weeklyData.push({
          week,
          actual:
            weekWeighIns.length > 0
              ? weekWeighIns.reduce((sum, w) => sum + convertWeight(w.weightKg), 0) /
                weekWeighIns.length
              : null,
          projected: null,
        });
      } else {
        weeklyData.push({
          week,
          actual: null,
          projected: endWeight + weeklyRate * (week - currentWeek),
        });
      }
    }

    return weeklyData;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightHistory, mesocycleWeeks, currentWeek, weightUnit]);

  if (weightHistory.length < 2) {
    return (
      <p className="text-caption text-ink-3">
        Add more weigh-ins to see your weight projection.
      </p>
    );
  }

  const targetWeightDisplay = targetWeightKg ? convertWeight(targetWeightKg) : null;
  const lastActual = chartData.filter((d) => d.actual !== null).pop();
  const finalProjected = chartData.filter((d) => d.projected !== null).pop();
  const projectedEndWeight = finalProjected?.projected ?? lastActual?.actual ?? 0;
  // Net weight the projection adds from the last actual to the horizon end.
  const projectedGain = projectedEndWeight - (lastActual?.actual ?? projectedEndWeight);
  const currentWeekRate =
    lastActual && chartData.length > 1
      ? (lastActual.actual! - (chartData[0].actual ?? lastActual.actual!)) / currentWeek
      : 0;

  return (
    <div>
      <p className="text-caption text-ink-3 mb-2">
        {mesocycle
          ? `Scope: this mesocycle (week ${mesocycle.currentWeek} of ${mesocycle.totalWeeks})`
          : `Scope: last 90 days of weigh-ins, projected ${DEFAULT_PROJECTION_WEEKS - currentWeek} weeks ahead`}
      </p>
      <div className="h-48" data-testid="weight-projection-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="week" stroke="#9ca3af" fontSize={10} tickFormatter={(w) => `W${w}`} />
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
              dot={{ r: 3, fill: '#6366f1' }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 pt-3 border-t border-sep grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-caption text-ink-3">Weekly rate</p>
          <p
            className={`text-subhead font-medium ${
              currentWeekRate < 0
                ? 'text-status-ok'
                : currentWeekRate > 0
                  ? 'text-status-warn'
                  : 'text-ink-2'
            }`}
          >
            {currentWeekRate >= 0 ? '+' : ''}
            {currentWeekRate.toFixed(2)} {unit}/wk
          </p>
        </div>
        <div>
          <p className="text-caption text-ink-3">Projected end</p>
          <p className="text-subhead font-medium text-ink">
            {projectedEndWeight.toFixed(1)} {unit}
          </p>
        </div>
        {targetWeightDisplay && (
          <div>
            <p className="text-caption text-ink-3">vs Target</p>
            <p
              className={`text-subhead font-medium ${
                Math.abs(projectedEndWeight - targetWeightDisplay) < 1
                  ? 'text-status-ok'
                  : projectedEndWeight > targetWeightDisplay
                    ? 'text-status-warn'
                    : 'text-action'
              }`}
            >
              {projectedEndWeight > targetWeightDisplay ? '+' : ''}
              {(projectedEndWeight - targetWeightDisplay).toFixed(1)} {unit}
            </p>
          </div>
        )}
      </div>

      {/*
        Projected-gain partition: split the projected gain into lean/fat using
        the OBSERVED waist ratio when available, else the fixed assumption. The
        label states which is in play. Waist informs the RATE of fat change
        only — this never asserts an absolute BF%.
      */}
      {partition && projectedGain > 0.1 && (
        <div className="mt-3 pt-3 border-t border-sep" data-testid="projection-partition">
          <div className="flex items-center justify-between">
            <p className="text-caption text-ink-3">Projected gain split</p>
            <span className="text-caption text-ink-2" data-testid="projection-partition-source">
              {partition.label}
            </span>
          </div>
          <p className="text-caption text-ink-2 mt-1">
            +{projectedGain.toFixed(1)} {unit} → ~{(projectedGain * partition.leanFractionOfGain).toFixed(1)} lean
            {' / '}~{(projectedGain * (1 - partition.leanFractionOfGain)).toFixed(1)} fat
          </p>
          {partition.source === 'waist' && partition.anchor && (
            <p className="text-caption text-ink-3 mt-1">
              Waist trend {partition.anchor.deltaWaistIn >= 0 ? '+' : ''}
              {partition.anchor.deltaWaistIn.toFixed(2)}&quot; vs{' '}
              {partition.anchor.deltaWeightLb >= 0 ? '+' : ''}
              {partition.anchor.deltaWeightLb.toFixed(1)} lb over {partition.anchor.windowDays} days.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN CARD
// ============================================================

export function ProportionsTargetsCard({
  benchmarks,
  activeTarget,
  activeMesocycle,
  currentFfmi,
  experience,
  heightCm,
  displayUnit,
  weightUnit,
  weightHistory,
  partition,
}: ProportionsTargetsCardProps) {
  return (
    <Card data-testid="proportions-targets-card">
      <CardHeader className="pb-0">
        <CardTitle>Proportions &amp; Targets</CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple">
          {heightCm != null && (
            <AccordionItem id="how-you-compare">
              <AccordionTrigger id="how-you-compare">How you compare</AccordionTrigger>
              <AccordionContent id="how-you-compare">
                <div className="pb-3">
                  <HowYouCompareSection
                    benchmarks={benchmarks}
                    targetMeasurements={activeTarget?.measurementTargets}
                    heightCm={heightCm}
                    displayUnit={displayUnit}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
          <AccordionItem id="ffmi-ceiling">
            <AccordionTrigger id="ffmi-ceiling">Muscle-to-height ceiling (FFMI)</AccordionTrigger>
            <AccordionContent id="ffmi-ceiling">
              <div className="pb-3">
                <FfmiCeilingSection
                  currentFfmi={currentFfmi}
                  targetFfmi={activeTarget?.targetFfmi ?? undefined}
                  experience={experience}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem id="weight-projection">
            <AccordionTrigger id="weight-projection">Weight projection</AccordionTrigger>
            <AccordionContent id="weight-projection">
              <div className="pb-3">
                <WeightProjectionSection
                  weightHistory={weightHistory}
                  targetWeightKg={activeTarget?.targetWeightKg}
                  mesocycle={activeMesocycle}
                  weightUnit={weightUnit}
                  partition={partition}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

export default ProportionsTargetsCard;
