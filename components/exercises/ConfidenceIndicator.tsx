'use client';

/**
 * AI Confidence Indicator
 *
 * Displays the AI's confidence level in its analysis
 * with appropriate coloring and messaging.
 */

import type { AIConfidence } from '@/lib/exercises/types';
import { CONFIDENCE_DISPLAY } from '@/lib/exercises/types';

interface ConfidenceIndicatorProps {
  confidence: AIConfidence;
  notes?: string;
}

export function ConfidenceIndicator({ confidence, notes }: ConfidenceIndicatorProps) {
  const info = CONFIDENCE_DISPLAY[confidence];

  return (
    <div className={`rounded-lg p-4 ${info.bgColor} border border-surface-700`}>
      <div className="flex items-center gap-3">
        <div
          className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
            ${confidence === 'high' ? 'bg-success-900/50' : ''}
            ${confidence === 'medium' ? 'bg-warning-900/50' : ''}
            ${confidence === 'low' ? 'bg-danger-900/50' : ''}
          `}
        >
          {confidence === 'high' && (
            <svg
              className="w-6 h-6 text-success-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
          {confidence === 'medium' && (
            <svg
              className="w-6 h-6 text-warning-400"
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
          )}
          {confidence === 'low' && (
            <svg
              className="w-6 h-6 text-danger-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${info.color}`}>
              AI Confidence: {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
            </span>
          </div>
          <p className="text-sm text-surface-400 mt-0.5">{info.message}</p>
        </div>
      </div>

      {notes && (
        <div className="mt-3 pt-3 border-t border-surface-700">
          <p className="text-xs text-surface-500 mb-1">AI Notes:</p>
          <p className="text-sm text-surface-300">{notes}</p>
        </div>
      )}
    </div>
  );
}
