'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

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
    const baseStyles = `
      inline-flex items-center justify-center font-medium transition-all duration-200
      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950
      disabled:opacity-50 disabled:cursor-not-allowed
      rounded-lg
    `;

    const variants = {
      primary: `
        bg-primary-600 text-white 
        hover:bg-primary-500 active:bg-primary-700
        focus:ring-primary-500
      `,
      secondary: `
        bg-surface-800 text-surface-100 border border-surface-700
        hover:bg-surface-700 active:bg-surface-800
        focus:ring-surface-500
      `,
      ghost: `
        bg-transparent text-surface-300
        hover:bg-surface-800 hover:text-surface-100
        focus:ring-surface-500
      `,
      danger: `
        bg-danger-600 text-white
        hover:bg-danger-500 active:bg-danger-700
        focus:ring-danger-500
      `,
      outline: `
        bg-transparent border border-surface-600 text-surface-200
        hover:bg-surface-800 hover:border-surface-500
        focus:ring-primary-500
      `,
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm gap-1.5',
      md: 'px-4 py-2.5 text-sm gap-2',
      lg: 'px-6 py-3 text-base gap-2',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
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

export { Button };

