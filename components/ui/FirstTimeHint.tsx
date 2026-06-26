'use client';

import { memo, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  const { shouldShow, dismiss, register, unregister, isEligible } = useFirstTimeHint(id);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Track if component is mounted (for portal)
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Register this hint with the queue when eligible (and unregister on unmount)
  useEffect(() => {
    if (isEligible && !forceShow) {
      register();
      return () => unregister();
    }
  }, [isEligible, forceShow, register, unregister]);

  // Calculate tooltip position based on wrapper element
  const updatePosition = useCallback(() => {
    if (!wrapperRef.current || !tooltipRef.current) return;

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const padding = 8; // Viewport padding
    const gap = 8; // Gap between trigger and tooltip

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = wrapperRect.top - tooltipRect.height - gap;
        left = wrapperRect.left + (wrapperRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'bottom':
        top = wrapperRect.bottom + gap;
        left = wrapperRect.left + (wrapperRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'left':
        top = wrapperRect.top + (wrapperRect.height / 2) - (tooltipRect.height / 2);
        left = wrapperRect.left - tooltipRect.width - gap;
        break;
      case 'right':
        top = wrapperRect.top + (wrapperRect.height / 2) - (tooltipRect.height / 2);
        left = wrapperRect.right + gap;
        break;
    }

    // Keep tooltip within viewport bounds
    const maxLeft = window.innerWidth - tooltipRect.width - padding;
    const maxTop = window.innerHeight - tooltipRect.height - padding;

    left = Math.max(padding, Math.min(left, maxLeft));
    top = Math.max(padding, Math.min(top, maxTop));

    setTooltipPosition({ top, left });
  }, [position]);

  // Delay showing the hint, and reset visibility when shouldShow becomes false or on unmount
  useEffect(() => {
    if (!shouldShow && !forceShow) {
      setIsVisible(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => {
      clearTimeout(timer);
      setIsVisible(false);
    };
  }, [shouldShow, forceShow, delay]);

  // Update position when visible
  useEffect(() => {
    if (!isVisible) return;

    // Initial position calculation (with a small delay to ensure tooltip is rendered)
    const initialTimer = setTimeout(updatePosition, 10);

    // Update on scroll and resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      clearTimeout(initialTimer);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isVisible, updatePosition]);

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

  // Arrow positioning based on tooltip position relative to trigger
  const getArrowClasses = () => {
    switch (position) {
      case 'top':
        return 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-t-primary-600 border-x-transparent border-b-transparent';
      case 'bottom':
        return 'top-0 left-1/2 -translate-x-1/2 -translate-y-full border-b-primary-600 border-x-transparent border-t-transparent';
      case 'left':
        return 'right-0 top-1/2 -translate-y-1/2 translate-x-full border-l-primary-600 border-y-transparent border-r-transparent';
      case 'right':
        return 'left-0 top-1/2 -translate-y-1/2 -translate-x-full border-r-primary-600 border-y-transparent border-l-transparent';
    }
  };

  const tooltipContent = (
    <div
      ref={tooltipRef}
      role="tooltip"
      style={tooltipPosition ? { top: tooltipPosition.top, left: tooltipPosition.left } : { visibility: 'hidden' }}
      className={cn(
        'fixed z-[9999] w-64 max-w-[calc(100vw-2rem)] p-3 rounded-lg',
        'bg-primary-600 text-white shadow-lg',
        'transition-all duration-200',
        isAnimatingOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100 animate-fade-in',
        className
      )}
    >
      {/* Arrow */}
      {showArrow && (
        <div
          className={cn(
            'absolute w-0 h-0 border-[6px]',
            getArrowClasses()
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
  );

  return (
    <div ref={wrapperRef} className="relative inline-block">
      {children}
      {/* Render tooltip in a portal to escape overflow containers */}
      {isMounted && createPortal(tooltipContent, document.body)}
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
  const { shouldShow, dismiss, register, unregister, isEligible } = useFirstTimeHint(id);

  // Register this hint with the queue when eligible
  useEffect(() => {
    if (isEligible) {
      register();
      return () => unregister();
    }
  }, [isEligible, register, unregister]);

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
