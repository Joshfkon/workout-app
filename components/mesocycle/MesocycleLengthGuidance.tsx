'use client';

import { useState } from 'react';
import type { MesocycleLengthGuidance as GuidanceType } from '@/services/mesocycleBuilder';

interface MesocycleLengthGuidanceProps {
  /** Guidance data from evaluateMesocycleLength */
  guidance: GuidanceType;
  /** Callback when user wants to accept recommendation */
  onAcceptRecommendation?: (weeks: number) => void;
  /** Custom class name */
  className?: string;
}

/**
 * Displays contextual guidance about mesocycle length selection.
 * Shows when the selected length may not be optimal for the user's
 * goals, experience, and recovery profile.
 */
export function MesocycleLengthGuidance({
  guidance,
  onAcceptRecommendation,
  className = '',
}: MesocycleLengthGuidanceProps) {
  const [dismissed, setDismissed] = useState(false);

  // Don't show anything if selection is optimal or user dismissed
  if (guidance.isOptimal || dismissed) {
    return null;
  }

  const { recommendedRange, reasoning } = guidance;
  const suggestedWeeks = recommendedRange.min === recommendedRange.max
    ? recommendedRange.min
    : Math.round((recommendedRange.min + recommendedRange.max) / 2);

  return (
    <div
      className={`p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {/* Info icon */}
        <svg
          className="w-5 h-5 text-warning-400 flex-shrink-0 mt-0.5"
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

        <div className="flex-1 min-w-0">
          <p className="text-sm text-surface-200 leading-relaxed">
            {reasoning}
          </p>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            {onAcceptRecommendation && (
              <button
                onClick={() => onAcceptRecommendation(suggestedWeeks)}
                className="text-sm font-medium text-warning-400 hover:text-warning-300 transition-colors"
              >
                Adjust to {recommendedRange.min === recommendedRange.max
                  ? `${recommendedRange.min} weeks`
                  : `${recommendedRange.min}-${recommendedRange.max} weeks`}
              </button>
            )}
            <button
              onClick={() => setDismissed(true)}
              className="text-sm text-surface-400 hover:text-surface-300 transition-colors"
            >
              Keep {guidance.selectedWeeks} weeks
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
