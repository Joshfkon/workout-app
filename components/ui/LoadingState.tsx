'use client';

import { type ReactNode } from 'react';
import { Card, CardContent } from './Card';
import { LoadingAnimation, type AnimationType } from './LoadingAnimation';
import { cn } from '@/lib/utils';

export interface LoadingStateProps {
  /** Optional label to display below spinner */
  label?: string;
  /** Spinner size */
  size?: 'sm' | 'md' | 'lg';
  /** Spinner type - must match LoadingAnimation AnimationType */
  type?: AnimationType;
  /** Optional className for customization */
  className?: string;
  /** Use skeleton loader for PageHeader layout instead of spinner */
  variant?: 'spinner' | 'skeleton';
}

/**
 * Standardized loading state component with centered spinner and optional label.
 * Provides consistent loading presentation across dashboard pages.
 * 
 * Pattern: centered spinner + optional label (matching EmptyState card style).
 * Use for page-level loading states after cold start (not full-page blocking).
 */
export function LoadingState({ 
  label, 
  size = 'md', 
  type = 'random',
  className,
  variant = 'spinner'
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    // Skeleton variant: matches PageHeader + common list layout
    return (
      <div className={cn('space-y-6', className)}>
        {/* PageHeader skeleton */}
        <div className="animate-pulse">
          <div className="h-8 w-48 bg-surface-800 rounded mb-2" />
          <div className="h-4 w-64 bg-surface-800 rounded" />
        </div>
        
        {/* List items skeleton */}
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-surface-800 bg-surface-900 p-4 animate-pulse">
              <div className="h-6 w-3/4 bg-surface-800 rounded mb-2" />
              <div className="h-4 w-1/2 bg-surface-800 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="py-12 text-center">
        <div className="flex flex-col items-center justify-center">
          <LoadingAnimation type={type} size={size} />
          {label && (
            <p className="text-surface-400 mt-4">{label}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
