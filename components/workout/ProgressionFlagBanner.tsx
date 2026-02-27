'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/Button';
import type { PerformanceSignal } from '@/services/performanceTracker';
import { getSignalDisplayText, getSignalColor } from '@/services/performanceTracker';
import { cn } from '@/lib/utils';

export interface ProgressionFlagBannerProps {
  signal: PerformanceSignal;
  onDismiss: () => void;
  onLearnMore?: () => void;
}

/**
 * Informational banner showing a detected performance pattern.
 *
 * This banner is advisory only — it surfaces observations like stagnation
 * or consistent overperformance. Actual weight/rep recommendations come
 * from progressionEngine.calculateNextTargets().
 */
export const ProgressionFlagBanner = memo(function ProgressionFlagBanner({
  signal,
  onDismiss,
  onLearnMore,
}: ProgressionFlagBannerProps) {
  const signalColor = getSignalColor(signal.signal);
  const signalText = getSignalDisplayText(signal.signal);

  const colorClasses = {
    green: {
      bg: 'bg-success-500/10',
      border: 'border-success-500/30',
      icon: 'text-success-400',
      accent: 'text-success-300',
    },
    yellow: {
      bg: 'bg-warning-500/10',
      border: 'border-warning-500/30',
      icon: 'text-warning-400',
      accent: 'text-warning-300',
    },
    red: {
      bg: 'bg-danger-500/10',
      border: 'border-danger-500/30',
      icon: 'text-danger-400',
      accent: 'text-danger-300',
    },
    blue: {
      bg: 'bg-primary-500/10',
      border: 'border-primary-500/30',
      icon: 'text-primary-400',
      accent: 'text-primary-300',
    },
  };

  const colors = colorClasses[signalColor];

  const icons: Record<PerformanceSignal['signal'], JSX.Element> = {
    consistent_overperformance: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    consistent_underperformance: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
      </svg>
    ),
    stagnation_detected: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    recovery_concern: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        colors.bg,
        colors.border
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn('flex-shrink-0 mt-0.5', colors.icon)}>
          {icons[signal.signal]}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('font-medium text-sm', colors.accent)}>
              {signalText}
            </span>
            {signal.metadata?.weeksStagnant != null && (
              <span className="text-xs text-surface-500">
                {signal.metadata.weeksStagnant} weeks
              </span>
            )}
          </div>
          <p className="text-sm text-surface-400 leading-snug">
            {signal.reason}
          </p>
        </div>
      </div>

      {/* Actions - informational only, no weight change buttons */}
      <div className="flex items-center gap-2 mt-3 ml-8">
        {onLearnMore && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onLearnMore}
          >
            Learn More
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
});

ProgressionFlagBanner.displayName = 'ProgressionFlagBanner';

/**
 * Compact version for inline display
 */
export const ProgressionFlagInline = memo(function ProgressionFlagInline({
  signal,
  onPress,
}: {
  signal: PerformanceSignal;
  onPress: () => void;
}) {
  const signalColor = getSignalColor(signal.signal);

  const dotColors = {
    green: 'bg-success-500',
    yellow: 'bg-warning-500',
    red: 'bg-danger-500',
    blue: 'bg-primary-500',
  };

  return (
    <button
      onClick={onPress}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded-md',
        'text-xs text-surface-300',
        'hover:bg-surface-800 transition-colors'
      )}
    >
      <span className={cn('w-2 h-2 rounded-full animate-pulse', dotColors[signalColor])} />
      <span>{getSignalDisplayText(signal.signal)}</span>
    </button>
  );
});

ProgressionFlagInline.displayName = 'ProgressionFlagInline';
