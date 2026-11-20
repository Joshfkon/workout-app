'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected chips use the accent tint. */
  selected?: boolean;
  /** Leading icon (16px). */
  icon?: ReactNode;
  /** 'card' sits on the page background; 'fill' sits inside a card. */
  surface?: 'card' | 'fill';
}

/** Design system chip: 36pt pill, optional icon, selected = accent tint. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ selected = false, icon, surface = 'card', className, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={props.onClick ? selected : undefined}
      className={cn(
        'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50',
        selected
          ? 'bg-action-tint text-action'
          : surface === 'card'
            ? 'bg-card text-ink shadow-card'
            : 'bg-fill text-ink',
        className
      )}
      {...props}
    >
      {icon && (
        <span className={cn('flex h-4 w-4 items-center justify-center', !selected && 'text-action')} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  )
);

Chip.displayName = 'Chip';
