'use client';

import { useMemo } from 'react';
import { Badge, Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import {
  analyzeImbalances,
  type BodyMeasurements,
  type UserLifts,
  type ImbalanceAnalysis,
  type BilateralAsymmetry,
  type ProportionalityAnalysis,
} from '@/services/measurementImbalanceEngine';

interface MeasurementImbalanceCardProps {
  measurements: BodyMeasurements;
  lifts?: UserLifts;
  heightCm?: number;
  wristCm?: number;
  compact?: boolean;
  className?: string;
}

/**
 * Card displaying body measurement imbalance analysis
 */
export function MeasurementImbalanceCard({
  measurements,
  lifts,
  heightCm,
  wristCm,
  compact = false,
  className = '',
}: MeasurementImbalanceCardProps) {
  const analysis = useMemo(() => {
    return analyzeImbalances(measurements, lifts, heightCm, wristCm);
  }, [measurements, lifts, heightCm, wristCm]);

  if (compact) {
    return (
      <CompactView analysis={analysis} className={className} />
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Body Balance Analysis</span>
          <BalanceScoreBadge score={analysis.balanceScore} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Balance Score */}
        <BalanceScoreBar score={analysis.balanceScore} />

        {/* Bilateral Asymmetries */}
        {analysis.bilateralAsymmetries.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-surface-300 mb-3">Left/Right Symmetry</h3>
            <div className="space-y-2">
              {analysis.bilateralAsymmetries.map((asymmetry, i) => (
                <AsymmetryRow key={i} asymmetry={asymmetry} />
              ))}
            </div>
          </section>
        )}

        {/* Proportionality Analysis */}
        {analysis.proportionalityAnalysis.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-surface-300 mb-3">Proportionality</h3>
            <div className="space-y-2">
              {analysis.proportionalityAnalysis.map((analysis, i) => (
                <ProportionalityRow key={i} analysis={analysis} />
              ))}
            </div>
          </section>
        )}

        {/* Lift Sanity Checks */}
        {analysis.liftSanityChecks.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-surface-300 mb-3">Strength vs Size</h3>
            <div className="space-y-2">
              {analysis.liftSanityChecks.map((check, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg ${
                    check.status === 'consistent'
                      ? 'bg-surface-800/50'
                      : check.status === 'measurement_low'
                      ? 'bg-warning-500/10 border border-warning-500/30'
                      : 'bg-success-500/10 border border-success-500/30'
                  }`}
                >
                  <p className="text-sm text-surface-300">{check.message}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recommendations */}
        {analysis.recommendations.length > 0 && (
          <section>
            <h3 className="text-sm font-medium text-surface-300 mb-3">Recommendations</h3>
            <div className="space-y-2">
              {analysis.recommendations.map((rec, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/30"
                >
                  <p className="text-sm text-surface-200">{rec}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Summary */}
        <SummarySection analysis={analysis} />
      </CardContent>
    </Card>
  );
}

// Sub-components

function BalanceScoreBadge({ score }: { score: number }) {
  const variant = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
  return (
    <Badge variant={variant} size="lg">
      {score}%
    </Badge>
  );
}

function BalanceScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-success-500' : score >= 60 ? 'bg-warning-500' : 'bg-danger-500';

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-surface-400">Overall Balance</span>
        <span className="text-surface-200 font-medium">{score}/100</span>
      </div>
      <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="text-xs text-surface-500">
        {score >= 80
          ? 'Excellent symmetry and proportions'
          : score >= 60
          ? 'Some areas could use attention'
          : 'Consider addressing the imbalances below'}
      </p>
    </div>
  );
}

function AsymmetryRow({ asymmetry }: { asymmetry: BilateralAsymmetry }) {
  const severityColors = {
    none: 'bg-success-500',
    minor: 'bg-surface-500',
    moderate: 'bg-warning-500',
    significant: 'bg-danger-500',
  };

  const severityLabels = {
    none: 'Balanced',
    minor: 'Minor',
    moderate: 'Moderate',
    significant: 'Significant',
  };

  const formatBodyPart = (part: string) => {
    return part.charAt(0).toUpperCase() + part.slice(1);
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-surface-800/50">
      <div className="flex items-center gap-3">
        <span className="text-lg">
          {asymmetry.severity === 'none' ? '✓' : '⚖️'}
        </span>
        <div>
          <p className="text-sm font-medium text-surface-200">
            {formatBodyPart(asymmetry.bodyPart)}
          </p>
          <p className="text-xs text-surface-400">
            L: {asymmetry.leftCm.toFixed(1)}cm | R: {asymmetry.rightCm.toFixed(1)}cm
            {asymmetry.severity !== 'none' && (
              <span className="ml-2">
                ({asymmetry.dominantSide === 'right' ? 'R' : 'L'} +{asymmetry.differenceCm.toFixed(1)}cm)
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${severityColors[asymmetry.severity]}`} />
        <span className="text-xs text-surface-400">{severityLabels[asymmetry.severity]}</span>
      </div>
    </div>
  );
}

function ProportionalityRow({ analysis }: { analysis: ProportionalityAnalysis }) {
  const statusColors = {
    underdeveloped: 'text-warning-400',
    balanced: 'text-success-400',
    overdeveloped: 'text-primary-400',
  };

  const statusIcons = {
    underdeveloped: '↓',
    balanced: '✓',
    overdeveloped: '↑',
  };

  return (
    <div className="p-3 rounded-lg bg-surface-800/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={statusColors[analysis.status]}>{statusIcons[analysis.status]}</span>
          <span className="text-sm font-medium text-surface-200">{analysis.bodyPart}</span>
        </div>
        <span className="text-sm text-surface-400">
          {analysis.percentOfIdeal}% of ideal
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              analysis.status === 'balanced'
                ? 'bg-success-500'
                : analysis.status === 'underdeveloped'
                ? 'bg-warning-500'
                : 'bg-primary-500'
            }`}
            style={{ width: `${Math.min(100, analysis.percentOfIdeal)}%` }}
          />
        </div>
        <span className="text-xs text-surface-500 w-20 text-right">
          {analysis.actualCm.toFixed(1)} / {analysis.idealCm.toFixed(1)}cm
        </span>
      </div>
      {analysis.recommendation && (
        <p className="text-xs text-surface-400 mt-2">{analysis.recommendation}</p>
      )}
    </div>
  );
}

function SummarySection({ analysis }: { analysis: ImbalanceAnalysis }) {
  if (analysis.laggingMuscles.length === 0 && analysis.dominantMuscles.length === 0) {
    return (
      <div className="p-4 rounded-lg bg-success-500/10 border border-success-500/30 text-center">
        <p className="text-success-400">Your physique is well-balanced!</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-surface-300">Summary</h3>

      {analysis.laggingMuscles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-surface-400">Needs focus:</span>
          {analysis.laggingMuscles.map((muscle) => (
            <Badge key={muscle} variant="warning" size="sm">
              {muscle}
            </Badge>
          ))}
        </div>
      )}

      {analysis.dominantMuscles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-surface-400">Strong points:</span>
          {analysis.dominantMuscles.map((muscle) => (
            <Badge key={muscle} variant="success" size="sm">
              {muscle}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

function CompactView({
  analysis,
  className,
}: {
  analysis: ImbalanceAnalysis;
  className?: string;
}) {
  const hasIssues =
    analysis.bilateralAsymmetries.some((a) => a.severity !== 'none') ||
    analysis.proportionalityAnalysis.some((p) => p.status !== 'balanced');

  return (
    <div
      className={`p-4 rounded-lg ${
        hasIssues
          ? 'bg-warning-500/10 border border-warning-500/30'
          : 'bg-success-500/10 border border-success-500/30'
      } ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{hasIssues ? '⚖️' : '✓'}</span>
          <div>
            <p className="text-sm font-medium text-surface-200">
              Balance Score: {analysis.balanceScore}%
            </p>
            <p className="text-xs text-surface-400">
              {hasIssues
                ? `${analysis.recommendations.length} recommendation${analysis.recommendations.length !== 1 ? 's' : ''}`
                : 'No imbalances detected'}
            </p>
          </div>
        </div>
        <BalanceScoreBadge score={analysis.balanceScore} />
      </div>
    </div>
  );
}

// Export types and functions for external use
export { analyzeImbalances };
export type { BodyMeasurements, UserLifts, ImbalanceAnalysis };
