'use client';

import { memo } from 'react';
import { InfoTooltip } from '@/components/ui';
import { SELECTOR_CHIP_BASE, SELECTOR_CHIP_IDLE } from './selectorChips';
import type { FormRating } from '@/types/schema';

interface FormOption {
  value: FormRating;
  label: string;
  /** Small inline glyph rendered next to the label (not a hero icon). */
  glyph: string;
  description: string;
  /**
   * Selected treatment: solid semantic tint at the same intensity the effort
   * chips use for their selected primary-500. Unselected chips stay neutral.
   */
  selectedBg: string;
}

const FORM_OPTIONS: FormOption[] = [
  {
    value: 'clean',
    label: 'Clean',
    glyph: '✓',
    description: 'Textbook form throughout',
    selectedBg: 'bg-success-500 text-white',
  },
  {
    value: 'some_breakdown',
    label: 'Some Breakdown',
    glyph: '~',
    description: 'Last 1-2 reps got sloppy',
    selectedBg: 'bg-warning-500 text-white',
  },
  {
    value: 'ugly',
    label: 'Ugly',
    glyph: '✗',
    description: 'Significant form loss, grinder reps',
    selectedBg: 'bg-danger-500 text-white',
  },
];

interface FormRatingSelectorProps {
  value: FormRating | null;
  onChange: (value: FormRating) => void;
  disabled?: boolean;
}

/**
 * Form quality rating selector — a chip row styled like the effort (RIR)
 * chips in SetLoggerRow (same height, radius, and selected treatment).
 * Three options: Clean, Some Breakdown, Ugly.
 */
export const FormRatingSelector = memo(function FormRatingSelector({
  value,
  onChange,
  disabled = false,
}: FormRatingSelectorProps) {
  const activeDescription = value
    ? FORM_OPTIONS.find((o) => o.value === value)?.description
    : null;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-surface-300">
        Form
        <InfoTooltip term="FORM_QUALITY" size="sm" />
      </label>
      <div className="flex items-stretch gap-2">
        {FORM_OPTIONS.map((option) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              aria-pressed={isSelected}
              className={`${SELECTOR_CHIP_BASE} px-1 ${
                disabled ? 'opacity-50 cursor-not-allowed' : ''
              } ${isSelected ? option.selectedBg : SELECTOR_CHIP_IDLE}`}
            >
              <span className="text-[13px] leading-tight text-center">
                <span aria-hidden="true">{option.glyph}</span> {option.label}
              </span>
            </button>
          );
        })}
      </div>
      {activeDescription && (
        <p className="text-xs text-surface-500 text-center">{activeDescription}</p>
      )}
    </div>
  );
});

export default FormRatingSelector;
