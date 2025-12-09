'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  showValue?: boolean;
  valueFormatter?: (value: number) => string;
  marks?: Array<{ value: number; label: string }>;
}

const Slider = forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      className,
      label,
      showValue = true,
      valueFormatter = (v) => String(v),
      marks,
      min = 0,
      max = 100,
      value,
      id,
      ...props
    },
    ref
  ) => {
    const sliderId = id || label?.toLowerCase().replace(/\s/g, '-');
    const currentValue = Number(value ?? min);
    const percentage = ((currentValue - Number(min)) / (Number(max) - Number(min))) * 100;

    return (
      <div className="w-full">
        {(label || showValue) && (
          <div className="flex items-center justify-between mb-2">
            {label && (
              <label
                htmlFor={sliderId}
                className="text-sm font-medium text-surface-200"
              >
                {label}
              </label>
            )}
            {showValue && (
              <span className="text-sm font-mono text-primary-400">
                {valueFormatter(currentValue)}
              </span>
            )}
          </div>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={sliderId}
            type="range"
            min={min}
            max={max}
            value={value}
            className={cn(
              `w-full h-2 bg-surface-700 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-5
              [&::-webkit-slider-thumb]:h-5
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-primary-500
              [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-primary-400
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:transition-all
              [&::-webkit-slider-thumb]:hover:bg-primary-400
              [&::-webkit-slider-thumb]:hover:scale-110
              [&::-moz-range-thumb]:w-5
              [&::-moz-range-thumb]:h-5
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-primary-500
              [&::-moz-range-thumb]:border-2
              [&::-moz-range-thumb]:border-primary-400
              [&::-moz-range-thumb]:cursor-pointer`,
              className
            )}
            style={{
              background: `linear-gradient(to right, rgb(14 165 233) 0%, rgb(14 165 233) ${percentage}%, rgb(63 63 70) ${percentage}%, rgb(63 63 70) 100%)`,
            }}
            {...props}
          />
        </div>
        {marks && (
          <div className="relative mt-1 flex justify-between text-xs text-surface-500">
            {marks.map((mark) => (
              <span key={mark.value}>{mark.label}</span>
            ))}
          </div>
        )}
      </div>
    );
  }
);

Slider.displayName = 'Slider';

export { Slider };

