'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import {
  ProgressBar,
  RatioProgressBar,
  BenchmarkBar,
  ProgressRing,
} from './ProgressVisualization';
import {
  formatMeasurement,
  formatMeasurementValue,
  formatMeasurementDiff,
  formatHeight,
} from '@/lib/utils';
import type {
  ProportionalityRatio,
  MeasurementBenchmark,
  EnhancedAsymmetry,
  TrainingPriority,
  ScoreBreakdown,
} from '@/services/bodyProportionsAnalytics';

// ============================================================
// PROPORTIONALITY RATIOS CARD
// ============================================================

interface ProportionalityRatiosCardProps {
  ratios: ProportionalityRatio[];
  onRatioClick?: (ratio: ProportionalityRatio) => void;
}

export function ProportionalityRatiosCard({ ratios, onRatioClick }: ProportionalityRatiosCardProps) {
  const [expandedRatio, setExpandedRatio] = useState<string | null>(null);

  if (ratios.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Classic Proportions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-surface-500">
            Add more measurements to see your proportionality analysis.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadge = (status: ProportionalityRatio['status']) => {
    const config = {
      far_below: { variant: 'danger' as const, label: 'Needs Focus' },
      below: { variant: 'warning' as const, label: 'Below Target' },
      optimal: { variant: 'success' as const, label: 'Optimal' },
      above: { variant: 'info' as const, label: 'Above Target' },
      far_above: { variant: 'default' as const, label: 'Well Developed' },
    };
    return config[status];
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Classic Proportions (Adonis Ratios)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ratios.map((ratio) => {
          const isExpanded = expandedRatio === ratio.name;
          const badge = getStatusBadge(ratio.status);

          return (
            <div key={ratio.name} className="space-y-2">
              <button
                onClick={() => {
                  setExpandedRatio(isExpanded ? null : ratio.name);
                  onRatioClick?.(ratio);
                }}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-surface-300">{ratio.name}</span>
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
                </div>
                <RatioProgressBar
                  current={ratio.currentValue}
                  target={ratio.idealValue}
                  range={ratio.acceptableRange}
                  label=""
                  size="sm"
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-surface-500">{ratio.formula}</span>
                  <span className="text-[10px] text-surface-500">
                    {ratio.percentOfIdeal}% of ideal
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="pl-2 border-l-2 border-surface-700 space-y-1">
                  <p className="text-xs text-surface-400">{ratio.description}</p>
                  <div className="text-xs text-surface-500">
                    <span>Optimal range: {ratio.acceptableRange[0].toFixed(2)} - {ratio.acceptableRange[1].toFixed(2)}</span>
                  </div>
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
// SUPERHERO BENCHMARKS CARD
// ============================================================

interface SuperheroBenchmarksCardProps {
  benchmarks: MeasurementBenchmark[];
  heightCm: number;
  heightScaleFactor: number;
  displayUnit: 'in' | 'cm';
}

export function SuperheroBenchmarksCard({
  benchmarks,
  heightCm,
  heightScaleFactor,
  displayUnit,
}: SuperheroBenchmarksCardProps) {
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

  // Convert cm benchmarks to display unit
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

        {displayedBenchmarks.map((benchmark) => (
          <BenchmarkBar
            key={benchmark.measurement}
            label={benchmark.measurement}
            current={formatMeasurementValue(benchmark.currentCm, displayUnit)}
            benchmarks={convertBenchmarks(benchmark.benchmarks)}
            currentTier={benchmark.currentTier}
            unit={displayUnit}
            isInverted={benchmark.measurement.toLowerCase() === 'waist'}
          />
        ))}

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
// IMPROVED ASYMMETRY CARD (with unit fix)
// ============================================================

interface ImprovedAsymmetryCardProps {
  asymmetries: EnhancedAsymmetry[];
  displayUnit: 'in' | 'cm';
}

export function ImprovedAsymmetryCard({ asymmetries, displayUnit }: ImprovedAsymmetryCardProps) {
  const significantAsymmetries = asymmetries.filter(a => a.severity !== 'normal');

  if (asymmetries.length === 0) {
    return null;
  }

  const allBalanced = significantAsymmetries.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Symmetry Analysis
          {allBalanced && (
            <Badge variant="success" size="sm">Balanced</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allBalanced ? (
          <div className="p-3 bg-success-500/10 border border-success-500/20 rounded-lg text-center">
            <p className="text-sm text-success-400">Excellent bilateral symmetry across all measurements!</p>
            <p className="text-xs text-surface-500 mt-1">All differences are within the normal 3% range.</p>
          </div>
        ) : (
          significantAsymmetries.map((asym) => (
            <div
              key={asym.bodyPart}
              className={`p-3 rounded-lg border ${
                asym.severity === 'significant'
                  ? 'bg-danger-500/10 border-danger-500/30'
                  : asym.severity === 'moderate'
                  ? 'bg-warning-500/10 border-warning-500/30'
                  : 'bg-surface-800/50 border-surface-700'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-sm font-medium text-surface-200">{asym.bodyPart}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs font-medium ${
                      asym.severityColor === 'green' ? 'text-success-400' :
                      asym.severityColor === 'yellow' ? 'text-yellow-400' :
                      asym.severityColor === 'orange' ? 'text-warning-400' :
                      'text-danger-400'
                    }`}>
                      {asym.dominantSide === 'balanced'
                        ? 'Balanced'
                        : `${asym.dominantSide.charAt(0).toUpperCase() + asym.dominantSide.slice(1)} +${Math.abs(asym.percentDifference).toFixed(1)}%`
                      }
                    </span>
                    <span className="text-xs text-surface-500">
                      ({formatMeasurementDiff(asym.differenceCm, displayUnit)})
                    </span>
                  </div>
                </div>
                <Badge
                  variant={
                    asym.severity === 'significant' ? 'danger' :
                    asym.severity === 'moderate' ? 'warning' :
                    asym.severity === 'minor' ? 'default' : 'success'
                  }
                  size="sm"
                >
                  {asym.severity === 'normal' ? 'Normal' :
                   asym.severity.charAt(0).toUpperCase() + asym.severity.slice(1)}
                </Badge>
              </div>

              <p className="text-xs text-surface-400 mb-2">{asym.severityContext}</p>

              {/* Visual comparison bar */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-surface-500 w-8">L</span>
                <div className="flex-1 relative">
                  <div className="h-2 bg-surface-700 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-primary-500"
                      style={{
                        width: `${(asym.leftValueCm / (asym.leftValueCm + asym.rightValueCm)) * 100}%`
                      }}
                    />
                    <div
                      className="h-full bg-primary-400"
                      style={{
                        width: `${(asym.rightValueCm / (asym.leftValueCm + asym.rightValueCm)) * 100}%`
                      }}
                    />
                  </div>
                </div>
                <span className="text-surface-500 w-8 text-right">R</span>
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-surface-500">
                <span>{formatMeasurement(asym.leftValueCm, displayUnit)}</span>
                <span>{formatMeasurement(asym.rightValueCm, displayUnit)}</span>
              </div>

              {asym.severity !== 'normal' && (
                <p className="text-xs text-primary-400 mt-2">{asym.recommendation}</p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// TRAINING PRIORITIES CARD
// ============================================================

interface TrainingPrioritiesCardProps {
  priorities: TrainingPriority[];
  /** Items marked as on-track (no issues) */
  onTrackItems?: { label: string; detail: string }[];
}

export function TrainingPrioritiesCard({ priorities, onTrackItems = [] }: TrainingPrioritiesCardProps) {
  if (priorities.length === 0 && onTrackItems.length === 0) {
    return null;
  }

  const highPriority = priorities.filter(p => p.priority === 'high');
  const mediumPriority = priorities.filter(p => p.priority === 'medium');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Your Training Priorities
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-surface-500">
          Based on your proportions, exercise suggestions are weighted by these priorities:
        </p>

        {highPriority.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-danger-400 font-medium">HIGH PRIORITY</span>
            </div>
            {highPriority.map((p, i) => (
              <div key={i} className="pl-3 border-l-2 border-danger-500/50 py-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-surface-200">{p.muscleGroup}</span>
                  <Badge variant="danger" size="sm">{p.issueType}</Badge>
                </div>
                <p className="text-xs text-surface-400 mt-0.5">{p.reason}</p>
                <p className="text-[10px] text-surface-500">({p.metricValue})</p>
              </div>
            ))}
          </div>
        )}

        {mediumPriority.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-warning-400 font-medium">MEDIUM PRIORITY</span>
            </div>
            {mediumPriority.map((p, i) => (
              <div key={i} className="pl-3 border-l-2 border-warning-500/50 py-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-surface-300">{p.muscleGroup}</span>
                  <Badge variant="warning" size="sm">{p.issueType}</Badge>
                </div>
                <p className="text-xs text-surface-400 mt-0.5">{p.reason}</p>
              </div>
            ))}
          </div>
        )}

        {onTrackItems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-success-400 font-medium">ON TRACK</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {onTrackItems.map((item, i) => (
                <div key={i} className="flex items-center gap-1 text-xs text-surface-400">
                  <span className="text-success-400">✓</span>
                  <span>{item.label}</span>
                  <span className="text-surface-600">({item.detail})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-surface-800">
          <p className="text-[10px] text-surface-600 flex items-center gap-1">
            <span>ℹ️</span>
            <span>Exercise suggestions are automatically weighted by these priorities</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// SCORE BREAKDOWN CARD
// ============================================================

interface ScoreBreakdownCardProps {
  breakdown: ScoreBreakdown;
  /** Callback when user taps a component */
  onComponentClick?: (component: keyof ScoreBreakdown['components']) => void;
}

export function ScoreBreakdownCard({ breakdown, onComponentClick }: ScoreBreakdownCardProps) {
  const [expandedComponent, setExpandedComponent] = useState<keyof ScoreBreakdown['components'] | null>(null);

  const getVariant = (score: number): 'success' | 'warning' | 'danger' | 'primary' => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'primary';
    if (score >= 40) return 'warning';
    return 'danger';
  };

  const componentLabels: Record<keyof ScoreBreakdown['components'], string> = {
    symmetry: 'Symmetry (L/R Balance)',
    classicRatios: 'Classic Ratios',
    upperLower: 'Upper/Lower Balance',
    vsBenchmark: 'vs. Target Physique',
  };

  const componentIcons: Record<keyof ScoreBreakdown['components'], string> = {
    symmetry: '⚖️',
    classicRatios: '📐',
    upperLower: '↕️',
    vsBenchmark: '🎯',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Overall Proportionality</CardTitle>
          <div className="flex items-center gap-2">
            <ProgressRing
              value={breakdown.overall}
              size={48}
              strokeWidth={4}
              variant={getVariant(breakdown.overall)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-surface-500 mb-3">Breakdown:</p>

        {(Object.keys(breakdown.components) as Array<keyof ScoreBreakdown['components']>).map((key) => {
          const score = breakdown.components[key];
          const isExpanded = expandedComponent === key;

          return (
            <div key={key}>
              <button
                onClick={() => {
                  setExpandedComponent(isExpanded ? null : key);
                  onComponentClick?.(key);
                }}
                className="w-full flex items-center gap-2 py-1 hover:bg-surface-800/50 rounded transition-colors"
              >
                <span className="text-sm">{componentIcons[key]}</span>
                <div className="flex-1">
                  <ProgressBar
                    value={score}
                    label={componentLabels[key]}
                    valueLabel={`${score}%`}
                    variant={getVariant(score)}
                    size="sm"
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="pl-7 pr-2 py-2 text-xs text-surface-400 bg-surface-800/30 rounded-b">
                  {breakdown.explanations[key]}
                </div>
              )}
            </div>
          );
        })}

        <p className="text-[10px] text-surface-600 pt-2">
          Tap any score to see details
        </p>
      </CardContent>
    </Card>
  );
}

// ============================================================
// EXPORT ALL COMPONENTS
// ============================================================

export {
  type ProportionalityRatiosCardProps,
  type SuperheroBenchmarksCardProps,
  type ImprovedAsymmetryCardProps,
  type TrainingPrioritiesCardProps,
  type ScoreBreakdownCardProps,
};
