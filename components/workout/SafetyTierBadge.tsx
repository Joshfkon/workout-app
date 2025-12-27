'use client';

import { memo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import type { FailureSafetyTier } from '@/services/exerciseSafety';
import { getTierDisplayInfo } from '@/services/exerciseSafety';
import { cn } from '@/lib/utils';

export interface SafetyTierBadgeProps {
  tier: FailureSafetyTier;
  /** Show full label or just short version */
  variant?: 'short' | 'full';
  /** Show tooltip on hover */
  showTooltip?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Displays a safety tier badge for exercises
 * Green = Safe to fail, Yellow = Moderate risk, Red = Protect
 */
export const SafetyTierBadge = memo(function SafetyTierBadge({
  tier,
  variant = 'short',
  showTooltip = true,
  className,
}: SafetyTierBadgeProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const info = getTierDisplayInfo(tier);

  const badgeVariant = {
    green: 'success' as const,
    yellow: 'warning' as const,
    red: 'danger' as const,
  }[info.color];

  const handleMouseEnter = useCallback(() => {
    if (showTooltip) setIsTooltipVisible(true);
  }, [showTooltip]);

  const handleMouseLeave = useCallback(() => {
    setIsTooltipVisible(false);
  }, []);

  const label = variant === 'full' ? info.label : info.shortLabel;

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Badge variant={badgeVariant} size="sm">
        {info.emoji} {label}
      </Badge>

      {/* Tooltip */}
      {showTooltip && isTooltipVisible && (
        <div
          className={cn(
            'absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2',
            'w-64 p-3 rounded-lg',
            'bg-surface-800 border border-surface-700 shadow-lg',
            'text-xs text-surface-300',
            'animate-in fade-in-0 zoom-in-95 duration-200'
          )}
        >
          <p className="font-medium text-surface-100 mb-1">{info.label}</p>
          <p>{info.description}</p>

          {/* Arrow */}
          <div
            className={cn(
              'absolute top-full left-1/2 -translate-x-1/2',
              'w-0 h-0',
              'border-l-8 border-r-8 border-t-8',
              'border-l-transparent border-r-transparent border-t-surface-800'
            )}
          />
        </div>
      )}
    </div>
  );
});

SafetyTierBadge.displayName = 'SafetyTierBadge';

/**
 * Inline safety tier indicator (just the colored dot)
 */
export const SafetyTierDot = memo(function SafetyTierDot({
  tier,
  size = 'md',
  className,
}: {
  tier: FailureSafetyTier;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const info = getTierDisplayInfo(tier);

  const colorClasses = {
    green: 'bg-success-500',
    yellow: 'bg-warning-500',
    red: 'bg-danger-500',
  }[info.color];

  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  };

  return (
    <span
      className={cn(
        'inline-block rounded-full',
        colorClasses,
        sizeClasses[size],
        className
      )}
      title={info.label}
    />
  );
});

SafetyTierDot.displayName = 'SafetyTierDot';

/**
 * Safety tier legend component for displaying all tiers
 */
export const SafetyTierLegend = memo(function SafetyTierLegend({
  className,
}: {
  className?: string;
}) {
  const tiers: FailureSafetyTier[] = ['push_freely', 'push_cautiously', 'protect'];

  return (
    <div className={cn('space-y-2', className)}>
      {tiers.map((tier) => {
        const info = getTierDisplayInfo(tier);
        return (
          <div key={tier} className="flex items-start gap-2">
            <SafetyTierBadge tier={tier} variant="short" showTooltip={false} />
            <span className="text-sm text-surface-400">{info.description}</span>
          </div>
        );
      })}
    </div>
  );
});

SafetyTierLegend.displayName = 'SafetyTierLegend';
