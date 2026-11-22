'use client';

import { memo } from 'react';

interface SegmentedControlProps {
  options: { value: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Segmented control for selecting between options (e.g., Bodyweight | Weighted | Assisted)
 */
export const SegmentedControl = memo(function SegmentedControl({
  options,
  value,
  onChange,
  className = '',
}: SegmentedControlProps) {
  return (
    <div className={`inline-flex bg-fill rounded-lg p-1 ${className}`}>
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={option.disabled}
            className={`
              px-3 py-1 text-caption font-medium rounded transition-all
              ${isSelected
                ? 'bg-action text-on-action shadow-sm'
                : 'text-ink-2 hover:text-ink'
              }
              ${option.disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
});

