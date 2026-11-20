'use client';

import { forwardRef, memo, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      type = 'text',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || label?.toLowerCase().replace(/\s/g, '-');

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-ink mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            type={type}
            className={cn(
              `w-full rounded-lg bg-fill border px-4 py-2.5
              text-ink placeholder:text-ink-3
              focus:outline-none focus:ring-2 focus:border-transparent
              transition-all duration-200`,
              error
                ? 'border-status-bad focus:ring-status-bad'
                : 'border-sep focus:ring-action',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-2">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-status-bad">{error}</p>
        )}
        {hint && !error && (
          <p className="mt-1.5 text-sm text-ink-3">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

const MemoizedInput = memo(Input);
MemoizedInput.displayName = 'Input';

export { MemoizedInput as Input };

