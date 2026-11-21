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
 * from services/setRecommender.ts.
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
      bg: 'bg-status-ok/10',
      border: 'border-status-ok/30',
      icon: 'text-status-ok',
      accent: 'text-status-ok',
    },
    yellow: {
      bg: 'bg-status-warn/10',
      border: 'border-status-warn/30',
      icon: 'text-status-warn',
      accent: 'text-status-warn',
    },
    red: {
      bg: 'bg-status-bad/10',
      border: 'border-status-bad/30',
      icon: 'text-status-bad',
      accent: 'text-status-bad',
    },
    blue: {
      bg: 'bg-action/10',
      border: 'border-action/30',
      icon: 'text-action',
      accent: 'text-action',
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
            <span className={cn('font-medium text-subhead', colors.accent)}>
              {signalText}
            </span>
            {signal.metadata?.weeksStagnant != null && (
              <span className="text-caption text-ink-3">
                {signal.metadata.weeksStagnant} weeks
              </span>
            )}
          </div>
          <p className="text-subhead text-ink-2 leading-snug">
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
            Learn more
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
    green: 'bg-status-ok',
    yellow: 'bg-status-warn',
    red: 'bg-status-bad',
    blue: 'bg-action',
  };

  return (
    <button
      onClick={onPress}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded-md',
        'text-caption text-ink-2',
        'hover:bg-fill transition-colors'
      )}
    >
      <span className={cn('w-2 h-2 rounded-full animate-pulse', dotColors[signalColor])} />
      <span>{getSignalDisplayText(signal.signal)}</span>
    </button>
  );
});

ProgressionFlagInline.displayName = 'ProgressionFlagInline';
