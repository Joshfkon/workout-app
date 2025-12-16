'use client';

import { forwardRef } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onChange, disabled = false, size = 'md', className = '' }, ref) => {
    const sizes = {
      sm: {
        track: 'w-8 h-4',
        knob: 'w-3 h-3',
        translate: checked ? 'translate-x-4' : 'translate-x-0.5',
      },
      md: {
        track: 'w-11 h-6',
        knob: 'w-5 h-5',
        translate: checked ? 'translate-x-5' : 'translate-x-0.5',
      },
      lg: {
        track: 'w-14 h-7',
        knob: 'w-6 h-6',
        translate: checked ? 'translate-x-7' : 'translate-x-0.5',
      },
    };

    const { track, knob, translate } = sizes[size];

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          relative inline-flex items-center shrink-0 cursor-pointer rounded-full
          transition-colors duration-200 ease-in-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900
          ${track}
          ${checked ? 'bg-primary-500' : 'bg-surface-600'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${className}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block rounded-full bg-white shadow-lg
            transform transition-transform duration-200 ease-in-out
            ${knob}
            ${translate}
          `}
        />
      </button>
    );
  }
);

Toggle.displayName = 'Toggle';

export { Toggle };
export type { ToggleProps };

