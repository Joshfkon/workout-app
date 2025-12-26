'use client';

import { memo, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useFirstTimeHint } from '@/hooks/useEducationPreferences';

export interface FirstTimeHintProps {
  /** Unique ID for tracking dismissal */
  id: string;

  /** Title of the hint */
  title: string;

  /** Description/explanation */
  description: string;

  /** Position relative to children */
  position?: 'top' | 'bottom' | 'left' | 'right';

  /** Optional action button */
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };

  /** Children to wrap - the hint appears relative to this */
  children?: ReactNode;

  /** Delay before showing (ms) */
  delay?: number;

  /** Custom class for the hint container */
  className?: string;

  /** Whether to show a pointing arrow */
  showArrow?: boolean;

  /** Force show (ignores dismissal state) - useful for demos */
  forceShow?: boolean;
}

export const FirstTimeHint = memo(function FirstTimeHint({
  id,
  title,
  description,
  position = 'bottom',
  action,
  children,
  delay = 500,
  className,
  showArrow = true,
  forceShow = false,
}: FirstTimeHintProps) {
  const { shouldShow, dismiss } = useFirstTimeHint(id);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  // Delay showing the hint
  useEffect(() => {
    if (!shouldShow && !forceShow) return;

    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [shouldShow, forceShow, delay]);

  const handleDismiss = () => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      dismiss();
      setIsVisible(false);
      setIsAnimatingOut(false);
    }, 200);
  };

  const handleAction = () => {
    if (action?.onClick) {
      action.onClick();
    }
    handleDismiss();
  };

  if (!isVisible) {
    return <>{children}</>;
  }

  // Mobile-first positioning: start aligned on mobile, centered on larger screens
  const positionClasses = {
    top: 'bottom-full mb-2 left-0 sm:left-1/2 sm:-translate-x-1/2',
    bottom: 'top-full mt-2 left-0 sm:left-1/2 sm:-translate-x-1/2',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  // Arrow positioning: aligned with mobile hint position, centered on larger screens
  const arrowClasses = {
    top: 'bottom-0 left-4 sm:left-1/2 sm:-translate-x-1/2 translate-y-full border-t-primary-600 border-x-transparent border-b-transparent',
    bottom: 'top-0 left-4 sm:left-1/2 sm:-translate-x-1/2 -translate-y-full border-b-primary-600 border-x-transparent border-t-transparent',
    left: 'right-0 top-1/2 -translate-y-1/2 translate-x-full border-l-primary-600 border-y-transparent border-r-transparent',
    right: 'left-0 top-1/2 -translate-y-1/2 -translate-x-full border-r-primary-600 border-y-transparent border-l-transparent',
  };

  return (
    <div className="relative inline-block">
      {children}

      {/* Hint callout */}
      <div
        role="tooltip"
        className={cn(
          'absolute z-50 w-64 max-w-[calc(100vw-2rem)] p-3 rounded-lg',
          'bg-primary-600 text-white shadow-lg',
          'transition-all duration-200',
          isAnimatingOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100 animate-fade-in',
          positionClasses[position],
          className
        )}
      >
        {/* Arrow */}
        {showArrow && (
          <div
            className={cn(
              'absolute w-0 h-0 border-[6px]',
              arrowClasses[position]
            )}
          />
        )}

        {/* Content */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h4 className="font-semibold text-sm mb-1">{title}</h4>
            <p className="text-xs text-primary-100 leading-relaxed">
              {description}
            </p>
          </div>

          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-0.5 hover:bg-primary-500 rounded transition-colors"
            aria-label="Dismiss hint"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Action button */}
        {action && (
          <div className="mt-3 flex gap-2">
            {action.href ? (
              <a
                href={action.href}
                onClick={handleDismiss}
                className="px-3 py-1.5 bg-white text-primary-600 text-xs font-medium rounded hover:bg-primary-50 transition-colors"
              >
                {action.label}
              </a>
            ) : (
              <button
                onClick={handleAction}
                className="px-3 py-1.5 bg-white text-primary-600 text-xs font-medium rounded hover:bg-primary-50 transition-colors"
              >
                {action.label}
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 text-xs text-primary-100 hover:text-white transition-colors"
            >
              Got it
            </button>
          </div>
        )}

        {/* Simple dismiss if no action */}
        {!action && (
          <button
            onClick={handleDismiss}
            className="mt-2 text-xs text-primary-200 hover:text-white transition-colors"
          >
            Got it, don&apos;t show again
          </button>
        )}
      </div>
    </div>
  );
});

FirstTimeHint.displayName = 'FirstTimeHint';

/**
 * A simpler inline hint that appears once
 */
export const InlineHint = memo(function InlineHint({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const { shouldShow, dismiss } = useFirstTimeHint(id);

  if (!shouldShow) return null;

  return (
    <div
      className={cn(
        'flex items-start gap-2 p-3 rounded-lg',
        'bg-primary-900/30 border border-primary-800 text-primary-100',
        'animate-fade-in',
        className
      )}
    >
      <svg
        className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <div className="flex-1 text-sm">{children}</div>
      <button
        onClick={dismiss}
        className="flex-shrink-0 p-1 hover:bg-primary-800 rounded transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});

InlineHint.displayName = 'InlineHint';
