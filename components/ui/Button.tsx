'use client';

import { forwardRef, memo, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Design system:
   * - primary: one per screen, the main action (filled accent)
   * - secondary: tinted accent
   * - tertiary: accent text only
   * - destructive: red text on a red tint
   * Kept for existing callers: ghost (quiet neutral text), outline (neutral
   * fill — outlines are gone from the system), danger (= destructive).
   */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'ghost' | 'danger' | 'outline';
  /** sm 32px pill · md 44px · lg 50px (full-width primary actions). */
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const VARIANTS = {
  primary: 'bg-action text-on-action hover:brightness-110 active:brightness-95 focus-visible:ring-action',
  secondary: 'bg-action-tint text-action hover:brightness-110 active:brightness-95 focus-visible:ring-action',
  tertiary: 'bg-transparent text-action hover:bg-action-tint focus-visible:ring-action',
  destructive: 'bg-status-bad-tint text-status-bad hover:brightness-110 focus-visible:ring-status-bad',
  ghost: 'bg-transparent text-ink-2 hover:bg-fill hover:text-ink focus-visible:ring-action',
  outline: 'bg-fill text-ink hover:brightness-110 focus-visible:ring-action',
} as const;

const SIZES = {
  sm: 'h-8 px-3 rounded-full text-subhead font-semibold gap-1.5',
  md: 'min-h-[44px] px-4 rounded-button text-body font-semibold gap-2',
  lg: 'min-h-[50px] px-5 rounded-button text-headline gap-2',
} as const;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const resolved = variant === 'danger' ? 'destructive' : variant;
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap transition-[filter,background-color,color] duration-150',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          VARIANTS[resolved],
          SIZES[size],
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

const MemoizedButton = memo(Button);
MemoizedButton.displayName = 'Button';

export { MemoizedButton as Button };
