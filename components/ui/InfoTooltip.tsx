'use client';

import { useState, useRef, useEffect, memo, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TOOLTIP_CONTENT, type TooltipContent } from '@/types/education';

export interface InfoTooltipProps {
  /** The term to explain (must exist in TOOLTIP_CONTENT) */
  term?: keyof typeof TOOLTIP_CONTENT;

  /** Or provide custom content directly */
  content?: TooltipContent;

  /** Size of the trigger icon */
  size?: 'sm' | 'md';

  /** Additional class for the trigger */
  className?: string;

  /** Position preference (auto-adjusts if needed) */
  position?: 'top' | 'bottom' | 'left' | 'right';

  /** Show inline with text or as standalone */
  inline?: boolean;

  /** Children to wrap (if provided, icon appears after) */
  children?: ReactNode;
}

export const InfoTooltip = memo(function InfoTooltip({
  term,
  content: customContent,
  size = 'sm',
  className,
  position = 'top',
  inline = true,
  children,
}: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Get content from library or use custom
  const content = customContent || (term ? TOOLTIP_CONTENT[term] : null);

  // Calculate position when opening
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const trigger = triggerRef.current.getBoundingClientRect();
    const padding = 8;
    const tooltipWidth = 288; // w-72 = 18rem = 288px
    const viewportWidth = window.innerWidth;
    const viewportPadding = 12; // Minimum distance from screen edge

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = trigger.top - padding;
        left = trigger.left + trigger.width / 2;
        break;
      case 'bottom':
        top = trigger.bottom + padding;
        left = trigger.left + trigger.width / 2;
        break;
      case 'left':
        top = trigger.top + trigger.height / 2;
        left = trigger.left - padding;
        break;
      case 'right':
        top = trigger.top + trigger.height / 2;
        left = trigger.right + padding;
        break;
    }

    // For top/bottom positions, check horizontal boundaries
    // The tooltip is centered with -translate-x-1/2, so actual left edge is: left - tooltipWidth/2
    if (position === 'top' || position === 'bottom') {
      const tooltipLeft = left - tooltipWidth / 2;
      const tooltipRight = left + tooltipWidth / 2;

      // If tooltip would overflow right edge, shift left
      if (tooltipRight > viewportWidth - viewportPadding) {
        left = viewportWidth - viewportPadding - tooltipWidth / 2;
      }
      // If tooltip would overflow left edge, shift right
      if (tooltipLeft < viewportPadding) {
        left = viewportPadding + tooltipWidth / 2;
      }
    }

    setTooltipPosition({ top, left });
  }, [isOpen, position]);

  // Close on escape or click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  if (!content) {
    console.warn(`InfoTooltip: No content found for term "${term}"`);
    return children || null;
  }

  const sizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
  };

  const positionClasses = {
    top: '-translate-x-1/2 -translate-y-full mb-2',
    bottom: '-translate-x-1/2 mt-2',
    left: '-translate-x-full -translate-y-1/2 mr-2',
    right: '-translate-y-1/2 ml-2',
  };

  const trigger = (
    <button
      ref={triggerRef}
      onClick={handleToggle}
      className={cn(
        'inline-flex items-center justify-center rounded-full',
        'text-surface-400 hover:text-surface-200 hover:bg-surface-800',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 focus:ring-offset-surface-900',
        sizes[size],
        inline && 'ml-1',
        className
      )}
      aria-label={`Learn more about ${content.term}`}
      aria-expanded={isOpen}
    >
      <svg
        className="w-full h-full"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </button>
  );

  const tooltipContent = isOpen && typeof window !== 'undefined' && createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={cn(
        'fixed z-[100] w-72 p-3 rounded-lg',
        'bg-surface-800 border border-surface-700 shadow-xl',
        'animate-fade-in',
        positionClasses[position]
      )}
      style={{
        top: tooltipPosition.top,
        left: tooltipPosition.left,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="font-semibold text-surface-100">{content.term}</span>
          {content.fullName && (
            <span className="text-surface-400 text-sm ml-1">
              ({content.fullName})
            </span>
          )}
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-0.5 text-surface-400 hover:text-surface-200 rounded"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Short explanation */}
      <p className="text-sm text-surface-300 leading-relaxed">
        {content.shortExplanation}
      </p>

      {/* Long explanation (if available) */}
      {content.longExplanation && (
        <p className="text-xs text-surface-400 mt-2 leading-relaxed">
          {content.longExplanation}
        </p>
      )}

      {/* Learn more link */}
      {content.learnMoreSlug && (
        <Link
          href={`/dashboard/learn/${content.learnMoreSlug}`}
          className="inline-flex items-center gap-1 mt-3 text-xs text-primary-400 hover:text-primary-300 transition-colors"
          onClick={() => setIsOpen(false)}
        >
          Learn more
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </div>,
    document.body
  );

  if (children) {
    return (
      <span className="inline-flex items-center">
        {children}
        {trigger}
        {tooltipContent}
      </span>
    );
  }

  return (
    <>
      {trigger}
      {tooltipContent}
    </>
  );
});

InfoTooltip.displayName = 'InfoTooltip';

/**
 * Convenience component for displaying a term with its tooltip
 */
export const ExplainedTerm = memo(function ExplainedTerm({
  term,
  className,
}: {
  term: keyof typeof TOOLTIP_CONTENT;
  className?: string;
}) {
  const content = TOOLTIP_CONTENT[term];
  if (!content) return <span>{term}</span>;

  return (
    <span className={cn('inline-flex items-center', className)}>
      <span className="border-b border-dotted border-surface-500 cursor-help">
        {content.term}
      </span>
      <InfoTooltip term={term} />
    </span>
  );
});

ExplainedTerm.displayName = 'ExplainedTerm';
