'use client';

import { type HTMLAttributes, memo } from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  size?: 'sm' | 'md';
}

export const Badge = memo(function Badge({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const variants = {
    default: 'bg-sep text-ink',
    success: 'bg-status-ok/20 text-status-ok border border-status-ok/30',
    warning: 'bg-status-warn/20 text-status-warn border border-status-warn/30',
    danger: 'bg-status-bad/20 text-status-bad border border-status-bad/30',
    info: 'bg-action/20 text-action border border-action/30',
    outline: 'bg-transparent border border-sep text-ink-2',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
});

// Specific badge variants for common use cases
export const SetQualityBadge = memo(function SetQualityBadge({
  quality,
}: {
  quality: 'junk' | 'effective' | 'stimulative' | 'excessive';
}) {
  const configs = {
    junk: { variant: 'default' as const, label: 'Junk', shortLabel: 'Junk' },
    effective: { variant: 'info' as const, label: 'Effective', shortLabel: 'Eff' },
    stimulative: { variant: 'success' as const, label: 'Stimulative', shortLabel: 'Stim' },
    excessive: { variant: 'danger' as const, label: 'Excessive', shortLabel: 'Exc' },
  };

  const config = configs[quality];

  return (
    <Badge variant={config.variant} size="sm">
      <span className="sm:hidden">{config.shortLabel}</span>
      <span className="hidden sm:inline">{config.label}</span>
    </Badge>
  );
});

export const VolumeStatusBadge = memo(function VolumeStatusBadge({
  status,
}: {
  status: 'below_mev' | 'effective' | 'optimal' | 'approaching_mrv' | 'exceeding_mrv';
}) {
  const configs = {
    below_mev: { variant: 'default' as const, label: 'Below MEV' },
    effective: { variant: 'info' as const, label: 'Effective' },
    optimal: { variant: 'success' as const, label: 'Optimal' },
    approaching_mrv: { variant: 'warning' as const, label: 'High' },
    exceeding_mrv: { variant: 'danger' as const, label: 'Over MRV' },
  };

  const config = configs[status];

  return (
    <Badge variant={config.variant} size="sm">
      {config.label}
    </Badge>
  );
});

