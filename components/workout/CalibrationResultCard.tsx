'use client';

import { memo } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { CalibrationResult } from '@/services/rpeCalibration';
import { getCalibrationVerdict, formatBias } from '@/services/rpeCalibration';
import { cn } from '@/lib/utils';

export interface CalibrationResultCardProps {
  result: CalibrationResult;
  enhancedAthleteMode?: boolean;
  onDismiss: () => void;
  onLearnMore?: () => void;
}

/**
 * Displays AMRAP calibration results comparing predicted vs actual performance.
 * Always shows the raw numbers (predicted/actual/bias); the judgment (badge,
 * colors, copy) is confidence-gated via getCalibrationVerdict — low-confidence
 * results stay neutral instead of handing down verdicts off 1-2 data points.
 */
export const CalibrationResultCard = memo(function CalibrationResultCard({
  result,
  enhancedAthleteMode,
  onDismiss,
  onLearnMore,
}: CalibrationResultCardProps) {
  const verdict = getCalibrationVerdict(result, enhancedAthleteMode);

  const colorClasses = {
    gray: {
      border: 'border-surface-600/50',
      bg: 'bg-surface-700/30',
      text: 'text-surface-300',
      accent: 'text-surface-200',
    },
    green: {
      border: 'border-success-500/30',
      bg: 'bg-success-500/10',
      text: 'text-success-400',
      accent: 'text-success-300',
    },
    yellow: {
      border: 'border-warning-500/30',
      bg: 'bg-warning-500/10',
      text: 'text-warning-400',
      accent: 'text-warning-300',
    },
    red: {
      border: 'border-danger-500/30',
      bg: 'bg-danger-500/10',
      text: 'text-danger-400',
      accent: 'text-danger-300',
    },
  };

  const colors = colorClasses[verdict.color];

  return (
    <Card
      variant="elevated"
      className={cn('border-2', colors.border)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">AMRAP Calibration Result</CardTitle>
          <Badge variant={verdict.badgeVariant} size="sm">
            {verdict.badgeLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Main Stats */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="space-y-1">
            <p className="text-xs text-surface-400 uppercase tracking-wide">Predicted</p>
            <p className="text-2xl font-semibold text-surface-200">
              {result.predictedMaxReps.toFixed(0)}
            </p>
            <p className="text-xs text-surface-500">reps</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-surface-400 uppercase tracking-wide">Actual</p>
            <p className="text-2xl font-semibold text-surface-100">
              {result.actualMaxReps}
            </p>
            <p className="text-xs text-surface-500">reps</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-surface-400 uppercase tracking-wide">Bias</p>
            <p className={cn('text-2xl font-semibold', colors.accent)}>
              {formatBias(result.bias)}
            </p>
            <p className="text-xs text-surface-500">difference</p>
          </div>
        </div>

        {/* Interpretation (confidence-gated) */}
        <div className={cn('p-3 rounded-lg', colors.bg)}>
          <p className={cn('text-sm', colors.text)}>
            {verdict.message}
          </p>
        </div>

        {/* Confidence indicator */}
        <div className="flex items-center gap-2 text-xs text-surface-500">
          <span>Confidence:</span>
          <div className="flex gap-1">
            <div className={cn(
              'w-2 h-2 rounded-full',
              result.confidenceLevel !== 'low' ? 'bg-primary-500' : 'bg-surface-700'
            )} />
            <div className={cn(
              'w-2 h-2 rounded-full',
              result.confidenceLevel === 'high' ? 'bg-primary-500' : 'bg-surface-700'
            )} />
            <div className={cn(
              'w-2 h-2 rounded-full',
              result.confidenceLevel === 'high' ? 'bg-primary-500' : 'bg-surface-700'
            )} />
          </div>
          <span className="capitalize">{result.confidenceLevel}</span>
          <span className="text-surface-600">({result.dataPoints} data points)</span>
        </div>
      </CardContent>

      <CardFooter className="flex justify-between gap-2">
        {onLearnMore && (
          <Button variant="ghost" size="sm" onClick={onLearnMore}>
            Learn More
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onDismiss} className="ml-auto">
          Got it
        </Button>
      </CardFooter>
    </Card>
  );
});

CalibrationResultCard.displayName = 'CalibrationResultCard';
