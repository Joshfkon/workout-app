'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Action button(s) - typically a Button or group of Buttons */
  actions?: ReactNode;
  /** Optional className for customization */
  className?: string;
}

/**
 * Standardized page header with title, optional subtitle, and action buttons.
 * Provides consistent spacing and responsive layout across dashboard pages.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4', className)}>
      <div className="flex-1">
        <h1 className="text-2xl font-bold text-surface-100">{title}</h1>
        {subtitle && (
          <p className="text-surface-400 mt-1">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
