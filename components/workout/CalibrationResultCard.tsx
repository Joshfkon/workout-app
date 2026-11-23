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
      border: 'border-sep/50',
      bg: 'bg-sep/30',
      text: 'text-ink-2',
      accent: 'text-ink',
    },
    green: {
      border: 'border-status-ok/30',
      bg: 'bg-status-ok/10',
      text: 'text-status-ok',
      accent: 'text-status-ok',
    },
    yellow: {
      border: 'border-status-warn/30',
      bg: 'bg-status-warn/10',
      text: 'text-status-warn',
      accent: 'text-status-warn',
    },
    red: {
      border: 'border-status-bad/30',
      bg: 'bg-status-bad/10',
      text: 'text-status-bad',
      accent: 'text-status-bad',
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
          <CardTitle className="text-body">AMRAP calibration result</CardTitle>
          <Badge variant={verdict.badgeVariant} size="sm">
            {verdict.badgeLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Main Stats */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="space-y-1">
            <p className="text-caption text-ink-2">Predicted</p>
            <p className="text-title font-semibold text-ink">
              {result.predictedMaxReps.toFixed(0)}
            </p>
            <p className="text-caption text-ink-3">reps</p>
          </div>

          <div className="space-y-1">
            <p className="text-caption text-ink-2">Actual</p>
            <p className="text-title font-semibold text-ink">
              {result.actualMaxReps}
            </p>
            <p className="text-caption text-ink-3">reps</p>
          </div>

          <div className="space-y-1">
            <p className="text-caption text-ink-2">Bias</p>
            <p className={cn('text-title font-semibold', colors.accent)}>
              {formatBias(result.bias)}
            </p>
            <p className="text-caption text-ink-3">difference</p>
          </div>
        </div>

        {/* Interpretation (confidence-gated) */}
        <div className={cn('p-3 rounded-lg', colors.bg)}>
          <p className={cn('text-subhead', colors.text)}>
            {verdict.message}
          </p>
        </div>

        {/* Confidence indicator */}
        <div className="flex items-center gap-2 text-caption text-ink-3">
          <span>Confidence:</span>
          <div className="flex gap-1">
            <div className={cn(
              'w-2 h-2 rounded-full',
              result.confidenceLevel !== 'low' ? 'bg-action' : 'bg-sep'
            )} />
            <div className={cn(
              'w-2 h-2 rounded-full',
              result.confidenceLevel === 'high' ? 'bg-action' : 'bg-sep'
            )} />
            <div className={cn(
              'w-2 h-2 rounded-full',
              result.confidenceLevel === 'high' ? 'bg-action' : 'bg-sep'
            )} />
          </div>
          <span className="capitalize">{result.confidenceLevel}</span>
          <span className="text-ink-3">({result.dataPoints} data points)</span>
        </div>
      </CardContent>

      <CardFooter className="flex justify-between gap-2">
        {onLearnMore && (
          <Button variant="ghost" size="sm" onClick={onLearnMore}>
            Learn more
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

/**
 * The same result as a quiet one-line note under the exercise, for the
 * active-workout screen: the full-screen card interrupted the session right
 * after the last set (UX panel). Same numbers and the same confidence-gated
 * verdict copy; the full breakdown is in the session summary.
 */
export const CalibrationResultNote = memo(function CalibrationResultNote({
  result,
  enhancedAthleteMode,
  onDismiss,
}: Omit<CalibrationResultCardProps, 'onLearnMore'>) {
  const verdict = getCalibrationVerdict(result, enhancedAthleteMode);
  return (
    <div
      role="status"
      data-testid="calibration-note"
      className="flex items-start justify-between gap-2 px-1 text-caption text-ink-2"
    >
      <span>
        Effort check: predicted {result.predictedMaxReps.toFixed(0)} reps, you did{' '}
        {result.actualMaxReps}. {verdict.message}
      </span>
      <button type="button" onClick={onDismiss} className="flex-shrink-0 font-medium text-action">
        OK
      </button>
    </div>
  );
});

CalibrationResultNote.displayName = 'CalibrationResultNote';
