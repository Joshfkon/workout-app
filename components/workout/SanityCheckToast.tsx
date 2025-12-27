'use client';

import { memo, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { SanityCheckResult } from '@/services/sanityChecks';
import { getSeverityColor, getCheckTypeTitle, shouldAutoDismiss } from '@/services/sanityChecks';
import { cn } from '@/lib/utils';

export interface SanityCheckToastProps {
  check: SanityCheckResult;
  onDismiss: () => void;
  /** Auto-dismiss after this many milliseconds (0 = no auto-dismiss) */
  autoDismissMs?: number;
}

/**
 * Toast notification for sanity check results
 * Shows after logging a set with potential issues
 */
export const SanityCheckToast = memo(function SanityCheckToast({
  check,
  onDismiss,
  autoDismissMs = 8000,
}: SanityCheckToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const color = getSeverityColor(check.severity);
  const title = getCheckTypeTitle(check.type);
  const canAutoDismiss = shouldAutoDismiss(check.type) && autoDismissMs > 0;

  // Auto-dismiss logic
  useEffect(() => {
    if (!canAutoDismiss) return;

    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 200);
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [canAutoDismiss, autoDismissMs, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 200);
  };

  const colorClasses = {
    blue: {
      bg: 'bg-primary-500/10',
      border: 'border-primary-500/30',
      icon: 'text-primary-400',
      title: 'text-primary-300',
    },
    yellow: {
      bg: 'bg-warning-500/10',
      border: 'border-warning-500/30',
      icon: 'text-warning-400',
      title: 'text-warning-300',
    },
    red: {
      bg: 'bg-danger-500/10',
      border: 'border-danger-500/30',
      icon: 'text-danger-400',
      title: 'text-danger-300',
    },
  };

  const colors = colorClasses[color];

  const icons = {
    blue: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    yellow: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    red: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50 max-w-sm',
        'rounded-lg border shadow-lg',
        colors.bg,
        colors.border,
        'transform transition-all duration-200',
        isExiting
          ? 'opacity-0 translate-y-2'
          : 'opacity-100 translate-y-0 animate-in slide-in-from-bottom-4 fade-in-0'
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={cn('flex-shrink-0', colors.icon)}>
            {icons[color]}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h4 className={cn('font-medium text-sm mb-1', colors.title)}>
              {title}
            </h4>
            <p className="text-sm text-surface-300 leading-snug">
              {check.message}
            </p>
            {check.suggestion && (
              <p className="text-xs text-surface-500 mt-2">
                {check.suggestion}
              </p>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-surface-500 hover:text-surface-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar for auto-dismiss */}
        {canAutoDismiss && (
          <div className="mt-3 h-1 bg-surface-800 rounded-full overflow-hidden">
            <div
              className={cn('h-full bg-surface-600 rounded-full', 'animate-shrink-width')}
              style={{
                animationDuration: `${autoDismissMs}ms`,
                animationTimingFunction: 'linear',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
});

SanityCheckToast.displayName = 'SanityCheckToast';

/**
 * Container for managing multiple toasts
 */
export const SanityCheckToastContainer = memo(function SanityCheckToastContainer({
  checks,
  onDismiss,
}: {
  checks: SanityCheckResult[];
  onDismiss: (index: number) => void;
}) {
  if (checks.length === 0) return null;

  // Only show the most severe check
  const sortedChecks = [...checks].sort((a, b) => {
    const severityOrder = { alert: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  const topCheck = sortedChecks[0];
  const topIndex = checks.indexOf(topCheck);

  return (
    <SanityCheckToast
      check={topCheck}
      onDismiss={() => onDismiss(topIndex)}
    />
  );
});

SanityCheckToastContainer.displayName = 'SanityCheckToastContainer';

/**
 * Inline sanity check indicator (for session summary)
 */
export const SanityCheckIndicator = memo(function SanityCheckIndicator({
  checks,
  onClick,
}: {
  checks: SanityCheckResult[];
  onClick?: () => void;
}) {
  if (checks.length === 0) return null;

  const alertCount = checks.filter(c => c.severity === 'alert').length;
  const warningCount = checks.filter(c => c.severity === 'warning').length;
  const infoCount = checks.filter(c => c.severity === 'info').length;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded-md',
        'text-xs',
        'hover:bg-surface-800 transition-colors'
      )}
    >
      {alertCount > 0 && (
        <span className="flex items-center gap-1 text-danger-400">
          <span className="w-2 h-2 rounded-full bg-danger-500" />
          {alertCount}
        </span>
      )}
      {warningCount > 0 && (
        <span className="flex items-center gap-1 text-warning-400">
          <span className="w-2 h-2 rounded-full bg-warning-500" />
          {warningCount}
        </span>
      )}
      {infoCount > 0 && (
        <span className="flex items-center gap-1 text-primary-400">
          <span className="w-2 h-2 rounded-full bg-primary-500" />
          {infoCount}
        </span>
      )}
    </button>
  );
});

SanityCheckIndicator.displayName = 'SanityCheckIndicator';
