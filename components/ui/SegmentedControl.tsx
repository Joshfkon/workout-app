'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * iOS-style segmented control (design system). A radio group under the hood,
 * so screen readers announce it as "1 of 3, selected".
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex rounded-[10px] bg-fill p-0.5', className)}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1 rounded-[8px] px-2 text-ink transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-action',
              size === 'sm' ? 'h-7 text-caption' : 'h-8 text-subhead',
              selected ? 'bg-card font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.14)]' : 'font-medium'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
