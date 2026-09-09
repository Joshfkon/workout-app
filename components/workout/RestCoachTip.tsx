'use client';

/**
 * RestCoachTip - Coaching tip shown during rest timer
 *
 * Displays below the rest timer countdown. Expandable for "why?" context.
 * Never interrupts the set-logging critical path.
 */

import { useState } from 'react';
import { IconChevronDown, IconBulb } from '@tabler/icons-react';

export interface RestCoachTipProps {
  tip: string;
  nextExercise?: string;
  expandedContent?: string;
}

export function RestCoachTip({ tip, nextExercise, expandedContent }: RestCoachTipProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="mt-2 px-3 py-2 rounded-lg bg-surface-800/60 border border-surface-700"
      data-testid="rest-coach-tip"
    >
      <div className="flex items-start gap-2">
        <IconBulb className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-surface-100 leading-snug">
            {tip}
          </p>
          {isExpanded && expandedContent && (
            <p className="mt-2 text-xs text-surface-300 leading-relaxed">
              {expandedContent}
            </p>
          )}
        </div>
        {expandedContent && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-shrink-0 p-1 rounded hover:bg-surface-700 transition-colors"
            aria-label={isExpanded ? 'Collapse tip details' : 'Expand tip details'}
            aria-expanded={isExpanded}
          >
            <IconChevronDown
              className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </button>
        )}
      </div>
    </div>
  );
}
