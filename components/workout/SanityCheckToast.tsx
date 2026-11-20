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
  /**
   * How the toast anchors itself.
   * - 'fixed' (default): self-positions bottom-right as its own fixed layer.
   * - 'inline': renders in normal flow so a parent can place it inside a
   *   shared bottom stack (right-aligned, capped width) without it fighting
   *   the other bottom-anchored chrome for the same fixed band.
   */
  layout?: 'fixed' | 'inline';
}

/**
 * Toast notification for sanity check results
 * Shows after logging a set with potential issues
 */
export const SanityCheckToast = memo(function SanityCheckToast({
  check,
  onDismiss,
  autoDismissMs = 8000,
  layout = 'fixed',
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

  // Accent shades must exist in the Tailwind palette (warning/danger only
  // define 400-600) and need a dark counterpart so titles stay readable on
  // the light theme's white toast surface.
  const colorClasses = {
    blue: {
      bg: 'bg-action/10',
      border: 'border-action/30',
      icon: 'text-action dark:text-action',
      title: 'text-action dark:text-action',
    },
    yellow: {
      bg: 'bg-status-warn/10',
      border: 'border-status-warn/30',
      icon: 'text-status-warn dark:text-status-warn',
      title: 'text-status-warn dark:text-status-warn',
    },
    red: {
      bg: 'bg-status-bad/10',
      border: 'border-status-bad/30',
      icon: 'text-status-bad dark:text-status-bad',
      title: 'text-status-bad dark:text-status-bad',
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
        layout === 'fixed'
          ? 'fixed bottom-4 right-4 z-50 max-w-sm'
          : 'relative ml-auto w-full max-w-sm',
        // Solid surface under the accent tint: the toast floats over page
        // content, so a bare /10 background lets whatever is behind it bleed
        // through the text.
        'rounded-lg border shadow-lg bg-card overflow-hidden',
        colors.border,
        'transform transition-all duration-200',
        isExiting
          ? 'opacity-0 translate-y-2'
          : 'opacity-100 translate-y-0 animate-in slide-in-from-bottom-4 fade-in-0'
      )}
    >
      <div className={cn('p-4', colors.bg)}>
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
            <p className="text-sm text-ink-2 leading-snug">
              {check.message}
            </p>
            {check.suggestion && (
              <p className="text-xs text-ink-3 mt-2">
                {check.suggestion}
              </p>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-ink-3 hover:text-ink-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Progress bar for auto-dismiss */}
        {canAutoDismiss && (
          <div className="mt-3 h-1 bg-fill rounded-full overflow-hidden">
            <div
              className={cn('h-full bg-sep rounded-full', 'animate-shrink-width')}
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
        'hover:bg-fill transition-colors'
      )}
    >
      {alertCount > 0 && (
        <span className="flex items-center gap-1 text-status-bad">
          <span className="w-2 h-2 rounded-full bg-status-bad" />
          {alertCount}
        </span>
      )}
      {warningCount > 0 && (
        <span className="flex items-center gap-1 text-status-warn">
          <span className="w-2 h-2 rounded-full bg-status-warn" />
          {warningCount}
        </span>
      )}
      {infoCount > 0 && (
        <span className="flex items-center gap-1 text-action">
          <span className="w-2 h-2 rounded-full bg-action" />
          {infoCount}
        </span>
      )}
    </button>
  );
});

SanityCheckIndicator.displayName = 'SanityCheckIndicator';
