'use client';

import { memo, useState } from 'react';
import { InfoTooltip } from '@/components/ui';
import type { FormRating } from '@/types/schema';

interface FormOption {
  value: FormRating;
  label: string;
  icon: string;
  description: string;
  color: string;
  bgColor: string;
  selectedBg: string;
}

const FORM_OPTIONS: FormOption[] = [
  {
    value: 'clean',
    label: 'Clean',
    icon: '\u2713',
    description: 'Textbook form throughout',
    color: 'text-success-400',
    bgColor: 'bg-success-500/10 border-success-500/20 hover:bg-success-500/20',
    selectedBg: 'bg-success-500 text-white border-success-500',
  },
  {
    value: 'some_breakdown',
    label: 'Some Breakdown',
    icon: '~',
    description: 'Last 1-2 reps got sloppy',
    color: 'text-warning-400',
    bgColor: 'bg-warning-500/10 border-warning-500/20 hover:bg-warning-500/20',
    selectedBg: 'bg-warning-500 text-white border-warning-500',
  },
  {
    value: 'ugly',
    label: 'Ugly',
    icon: '\u2717',
    description: 'Significant form loss, grinder reps',
    color: 'text-danger-400',
    bgColor: 'bg-danger-500/10 border-danger-500/20 hover:bg-danger-500/20',
    selectedBg: 'bg-danger-500 text-white border-danger-500',
  },
];

interface FormRatingSelectorProps {
  value: FormRating | null;
  onChange: (value: FormRating) => void;
  disabled?: boolean;
}

/**
 * Form quality rating selector component
 * Three options: Clean, Some Breakdown, Ugly
 */
export const FormRatingSelector = memo(function FormRatingSelector({
  value,
  onChange,
  disabled = false,
}: FormRatingSelectorProps) {
  const [hoveredOption, setHoveredOption] = useState<FormRating | null>(null);

  const activeDescription = hoveredOption
    ? FORM_OPTIONS.find((o) => o.value === hoveredOption)?.description
    : value
      ? FORM_OPTIONS.find((o) => o.value === value)?.description
      : null;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-surface-300">
        Form
        <InfoTooltip term="FORM_QUALITY" size="sm" />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {FORM_OPTIONS.map((option) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              onMouseEnter={() => setHoveredOption(option.value)}
              onMouseLeave={() => setHoveredOption(null)}
              disabled={disabled}
              className={`
                flex flex-col items-center justify-center py-3 px-2 rounded-lg border transition-all
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                ${isSelected ? option.selectedBg : option.bgColor}
              `}
            >
              <span
                className={`text-xl font-bold ${isSelected ? 'text-white' : option.color}`}
              >
                {option.icon}
              </span>
              <span
                className={`text-xs mt-1 text-center ${isSelected ? 'text-white/90' : 'text-surface-300'}`}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* Description tooltip */}
      {activeDescription && (
        <p className="text-xs text-surface-400 text-center italic">
          {activeDescription}
        </p>
      )}
    </div>
  );
});

export default FormRatingSelector;
