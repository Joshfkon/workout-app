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
    default: 'bg-surface-700 text-surface-200',
    success: 'bg-success-500/20 text-success-400 border border-success-500/30',
    warning: 'bg-warning-500/20 text-warning-400 border border-warning-500/30',
    danger: 'bg-danger-500/20 text-danger-400 border border-danger-500/30',
    info: 'bg-primary-500/20 text-primary-400 border border-primary-500/30',
    outline: 'bg-transparent border border-surface-600 text-surface-300',
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
    junk: { variant: 'default' as const, label: 'Junk' },
    effective: { variant: 'info' as const, label: 'Effective' },
    stimulative: { variant: 'success' as const, label: 'Stimulative' },
    excessive: { variant: 'danger' as const, label: 'Excessive' },
  };

  const config = configs[quality];

  return (
    <Badge variant={config.variant} size="sm">
      {config.label}
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

