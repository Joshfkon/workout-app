'use client';

import { forwardRef, memo, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /**
   * 'large': bigger label, field text and hint (17px, nothing smaller), for
   * screens read before the user can pick a text size (sign-up / sign-in;
   * UX panel rounds 19 and 20).
   */
  inputSize?: 'default' | 'large';
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
      inputSize = 'default',
      type = 'text',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || label?.toLowerCase().replace(/\s/g, '-');
    const large = inputSize === 'large';

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className={cn('block font-medium text-ink mb-1.5', large ? 'text-headline' : 'text-subhead')}
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
              large && 'min-h-[52px] py-3 text-headline font-normal',
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
          <p className={cn('mt-1.5 text-status-bad', large ? 'text-headline font-normal' : 'text-subhead')}>{error}</p>
        )}
        {hint && !error && (
          <p className={cn('mt-1.5', large ? 'text-headline font-normal text-ink-2' : 'text-subhead text-ink-3')}>{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

const MemoizedInput = memo(Input);
MemoizedInput.displayName = 'Input';

export { MemoizedInput as Input };

