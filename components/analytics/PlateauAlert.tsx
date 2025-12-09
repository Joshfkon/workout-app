'use client';

import { useState } from 'react';
import { Card, Button, Badge } from '@/components/ui';
import type { PlateauDetectionResult } from '@/services/plateauDetector';

interface PlateauAlertProps {
  exerciseName: string;
  result: PlateauDetectionResult;
  onDismiss?: () => void;
  onViewSuggestions?: () => void;
}

export function PlateauAlert({
  exerciseName,
  result,
  onDismiss,
  onViewSuggestions,
}: PlateauAlertProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!result.isPlateaued) return null;

  const getSeverityColor = () => {
    if (result.weeksSinceProgress >= 6) return 'border-danger-500/50 bg-danger-500/5';
    if (result.weeksSinceProgress >= 4) return 'border-warning-500/50 bg-warning-500/5';
    return 'border-primary-500/50 bg-primary-500/5';
  };

  const getSeverityLabel = () => {
    if (result.weeksSinceProgress >= 6) return 'Significant Plateau';
    if (result.weeksSinceProgress >= 4) return 'Plateau Detected';
    return 'Stalling Progress';
  };

  return (
    <Card
      variant="bordered"
      className={`border-l-4 ${getSeverityColor()}`}
      padding="none"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <svg
                className="w-5 h-5 text-warning-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="font-medium text-surface-100">{exerciseName}</span>
              <Badge
                variant={result.weeksSinceProgress >= 6 ? 'danger' : 'warning'}
                size="sm"
              >
                {getSeverityLabel()}
              </Badge>
            </div>
            <p className="text-sm text-surface-400">
              No progress in {result.weeksSinceProgress} weeks • Current E1RM:{' '}
              <span className="font-mono text-surface-300">{result.currentE1RM}kg</span>
              {result.currentE1RM < result.peakE1RM && (
                <span className="text-danger-400 ml-2">
                  ({(result.currentE1RM - result.peakE1RM).toFixed(1)}kg from peak)
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 text-surface-500 hover:text-surface-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Expandable suggestions */}
        <div className="mt-3">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            {isExpanded ? 'Hide' : 'Show'} suggestions
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isExpanded && result.suggestions.length > 0 && (
            <div className="mt-3 space-y-2">
              {result.suggestions.map((suggestion, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-surface-300"
                >
                  <span className="text-primary-400 mt-0.5">•</span>
                  <span>{suggestion}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// List of plateau alerts
interface PlateauAlertListProps {
  alerts: Array<{
    exerciseId: string;
    exerciseName: string;
    result: PlateauDetectionResult;
  }>;
  onDismiss?: (exerciseId: string) => void;
}

export function PlateauAlertList({ alerts, onDismiss }: PlateauAlertListProps) {
  const activeAlerts = alerts.filter((a) => a.result.isPlateaued);

  if (activeAlerts.length === 0) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-success-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-surface-200 font-medium">All exercises progressing</p>
          <p className="text-sm text-surface-500 mt-1">
            No plateaus detected - keep up the great work!
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-surface-300">
          Plateau Alerts ({activeAlerts.length})
        </h3>
      </div>
      {activeAlerts.map((alert) => (
        <PlateauAlert
          key={alert.exerciseId}
          exerciseName={alert.exerciseName}
          result={alert.result}
          onDismiss={() => onDismiss?.(alert.exerciseId)}
        />
      ))}
    </div>
  );
}

// Compact plateau indicator
export function PlateauIndicator({ weeksSinceProgress }: { weeksSinceProgress: number }) {
  if (weeksSinceProgress < 3) return null;

  const severity = weeksSinceProgress >= 6 ? 'danger' : weeksSinceProgress >= 4 ? 'warning' : 'info';

  return (
    <Badge variant={severity} size="sm">
      {weeksSinceProgress}w stall
    </Badge>
  );
}

