'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/Button';
import type { ProgressionFlag } from '@/services/performanceTracker';
import { getActionDisplayText, getActionColor, formatAdjustment } from '@/services/performanceTracker';
import { cn } from '@/lib/utils';

export interface ProgressionFlagBannerProps {
  flag: ProgressionFlag;
  onAccept: () => void;
  onDismiss: () => void;
  onLearnMore?: () => void;
}

/**
 * Banner that appears when a progression flag is active for an exercise
 * Shows recommendation to increase/decrease weight or investigate stagnation
 */
export const ProgressionFlagBanner = memo(function ProgressionFlagBanner({
  flag,
  onAccept,
  onDismiss,
  onLearnMore,
}: ProgressionFlagBannerProps) {
  const actionColor = getActionColor(flag.action);
  const actionText = getActionDisplayText(flag.action);

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

  const colors = colorClasses[actionColor];

  const icons = {
    increase_weight: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    decrease_weight: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
      </svg>
    ),
    hold: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
      </svg>
    ),
    investigate: (
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
          {icons[flag.action]}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('font-medium text-sm', colors.accent)}>
              {actionText}
            </span>
            {flag.suggestedAdjustmentKg !== 0 && (
              <span className="text-sm text-surface-300">
                ({formatAdjustment(flag.suggestedAdjustmentKg)})
              </span>
            )}
            {flag.weeksStagnant && (
              <span className="text-xs text-surface-500">
                {flag.weeksStagnant} weeks
              </span>
            )}
          </div>
          <p className="text-sm text-surface-400 leading-snug">
            {flag.reason}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 ml-8">
        {flag.action === 'increase_weight' && (
          <Button
            variant="primary"
            size="sm"
            onClick={onAccept}
          >
            Apply Increase
          </Button>
        )}
        {flag.action === 'decrease_weight' && (
          <Button
            variant="danger"
            size="sm"
            onClick={onAccept}
          >
            Reduce Weight
          </Button>
        )}
        {flag.action === 'investigate' && onLearnMore && (
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
          {flag.action === 'investigate' ? 'Dismiss' : 'Not Now'}
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
  flag,
  onPress,
}: {
  flag: ProgressionFlag;
  onPress: () => void;
}) {
  const actionColor = getActionColor(flag.action);

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
      <span className={cn('w-2 h-2 rounded-full animate-pulse', dotColors[actionColor])} />
      <span>{getActionDisplayText(flag.action)}</span>
      {flag.suggestedAdjustmentKg !== 0 && (
        <span className="text-surface-500">
          {formatAdjustment(flag.suggestedAdjustmentKg)}
        </span>
      )}
    </button>
  );
});

ProgressionFlagInline.displayName = 'ProgressionFlagInline';
