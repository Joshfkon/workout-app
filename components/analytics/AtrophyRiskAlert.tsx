'use client';

import { useState } from 'react';
import { Card, Badge, InfoTooltip } from '@/components/ui';
import type { MuscleVolumeData } from '@/services/volumeTracker';
import type { Goal } from '@/types/schema';

interface AtrophyRiskAlertProps {
  musclesBelowMev: MuscleVolumeData[];
  userGoal: Goal;
  onDismiss?: () => void;
}

export function AtrophyRiskAlert({
  musclesBelowMev,
  userGoal,
  onDismiss,
}: AtrophyRiskAlertProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (musclesBelowMev.length === 0) return null;

  const isOnCut = userGoal === 'cut';
  const severityLevel = isOnCut ? 'high' : 'moderate';

  const getSeverityStyles = () => {
    if (isOnCut) {
      return 'border-danger-500/50 bg-danger-500/5';
    }
    return 'border-warning-500/50 bg-warning-500/5';
  };

  const formatMuscleName = (name: string) => {
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  // Sort muscles by how far below MEV they are (worst first)
  const sortedMuscles = [...musclesBelowMev].sort((a, b) => {
    const aDeficit = a.landmarks.mev - a.totalSets;
    const bDeficit = b.landmarks.mev - b.totalSets;
    return bDeficit - aDeficit;
  });

  // Generate suggestions based on context
  const getSuggestions = () => {
    const suggestions: string[] = [];

    if (isOnCut) {
      suggestions.push(
        'During a cut, maintaining MEV for each muscle is critical to prevent muscle loss',
        'Consider prioritizing volume for lagging muscles even if reducing elsewhere',
        'Focus on compound movements that hit multiple at-risk muscles efficiently'
      );
    } else {
      suggestions.push(
        'Add 1-2 direct sets per week for each muscle below MEV',
        'Consider adding an extra training day or extending current sessions'
      );
    }

    // Add specific muscle suggestions
    const muscleNames = sortedMuscles.slice(0, 3).map(m => formatMuscleName(m.muscleGroup));
    if (muscleNames.length > 0) {
      suggestions.push(
        `Priority muscles to address: ${muscleNames.join(', ')}`
      );
    }

    return suggestions;
  };

  return (
    <Card
      variant="bordered"
      className={`border-l-4 ${getSeverityStyles()}`}
      padding="none"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {/* Warning icon */}
              <svg
                className={`w-5 h-5 ${isOnCut ? 'text-danger-400' : 'text-warning-400'}`}
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
              <span className="font-medium text-surface-100">
                {isOnCut ? 'Atrophy Risk' : 'Insufficient Volume'}
              </span>
              <Badge variant={isOnCut ? 'danger' : 'warning'} size="sm">
                {musclesBelowMev.length} muscle{musclesBelowMev.length > 1 ? 's' : ''} below MEV
              </Badge>
              <InfoTooltip term="MEV" size="sm" />
            </div>
            <p className="text-sm text-surface-400">
              {isOnCut ? (
                <>
                  <span className="text-danger-400 font-medium">Cutting without adequate volume risks muscle loss.</span>
                  {' '}The following muscles are below minimum effective volume:
                </>
              ) : (
                <>These muscles aren&apos;t receiving enough volume to maintain or grow:</>
              )}
            </p>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 text-surface-500 hover:text-surface-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`mt-2 flex items-center gap-1 text-sm ${
            isOnCut ? 'text-danger-400 hover:text-danger-300' : 'text-primary-400 hover:text-primary-300'
          } transition-colors`}
        >
          {isExpanded ? 'Hide' : 'Show'} details
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isExpanded && (
          <>
            {/* Muscle list */}
            <div className="mt-3 flex flex-wrap gap-2">
              {sortedMuscles.map((muscle) => {
                const deficit = muscle.landmarks.mev - muscle.totalSets;
                return (
                  <div
                    key={muscle.muscleGroup}
                    className={`px-2.5 py-1.5 rounded-lg text-sm ${
                      isOnCut
                        ? 'bg-danger-500/10 border border-danger-500/20'
                        : 'bg-warning-500/10 border border-warning-500/20'
                    }`}
                  >
                    <span className={`font-medium ${isOnCut ? 'text-danger-300' : 'text-warning-300'}`}>
                      {formatMuscleName(muscle.muscleGroup)}
                    </span>
                    <span className="text-surface-500 ml-1.5">
                      {muscle.totalSets}/{muscle.landmarks.mev} sets
                    </span>
                    <span className={`text-xs ml-1 ${isOnCut ? 'text-danger-400' : 'text-warning-400'}`}>
                      (+{deficit} needed)
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Suggestions */}
            <div className="mt-3 space-y-2">
              {getSuggestions().map((suggestion, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-surface-300"
                >
                  <span className={`mt-0.5 ${isOnCut ? 'text-danger-400' : 'text-primary-400'}`}>•</span>
                  <span>{suggestion}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Cut-specific science callout */}
        {isOnCut && isExpanded && (
          <div className="mt-4 p-3 bg-surface-800/50 rounded-lg border border-surface-700">
            <div className="flex items-start gap-2">
              <svg
                className="w-4 h-4 text-primary-400 mt-0.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-xs text-surface-400">
                <span className="font-medium text-surface-300">Science note:</span> Research shows that
                maintaining at least MEV during a caloric deficit is essential for muscle preservation.
                Dropping below MEV while cutting significantly increases the risk of losing hard-earned muscle mass.
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// Compact indicator for dashboard cards
export function AtrophyRiskIndicator({
  count,
  isOnCut,
}: {
  count: number;
  isOnCut: boolean;
}) {
  if (count === 0) return null;

  return (
    <Badge variant={isOnCut ? 'danger' : 'warning'} size="sm">
      {count} below MEV{isOnCut ? ' (cut)' : ''}
    </Badge>
  );
}
