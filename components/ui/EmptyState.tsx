'use client';

import { type ReactNode } from 'react';
import { Card, CardContent } from './Card';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Icon to display - can be SVG element or emoji string */
  icon?: ReactNode | string;
  /** Main heading text */
  title: string;
  /** Description text */
  description: string;
  /** Optional action button(s) */
  action?: ReactNode;
  /** Optional className for customization */
  className?: string;
}

/**
 * Standardized empty state component with icon, heading, description, and optional CTA.
 * Provides consistent empty state presentation across dashboard pages.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  const isEmoji = typeof icon === 'string';
  
  return (
    <Card className={className}>
      <CardContent className="py-12 text-center">
        {icon && (
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            {isEmoji ? (
              <span className="text-4xl" role="img" aria-hidden="true">{icon}</span>
            ) : (
              <div className="w-8 h-8 text-surface-500">
                {icon}
              </div>
            )}
          </div>
        )}
        <h2 className="text-lg font-semibold text-surface-200">{title}</h2>
        <p className="text-surface-500 mt-2 max-w-md mx-auto">
          {description}
        </p>
        {action && (
          <div className="mt-6">
            {action}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
