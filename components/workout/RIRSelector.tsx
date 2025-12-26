'use client';

import { memo } from 'react';
import { InfoTooltip } from '@/components/ui';
import type { RepsInTank } from '@/types/schema';

interface RIROption {
  value: RepsInTank;
  label: string;
  subLabel: string;
  color: string;
  bgColor: string;
  selectedBg: string;
}

const RIR_OPTIONS: RIROption[] = [
  {
    value: 4,
    label: '4+',
    subLabel: 'Easy',
    color: 'text-success-400',
    bgColor: 'bg-success-500/10 border-success-500/20 hover:bg-success-500/20',
    selectedBg: 'bg-success-500 text-white border-success-500',
  },
  {
    value: 2,
    label: '2-3',
    subLabel: 'Good',
    color: 'text-primary-400',
    bgColor: 'bg-primary-500/10 border-primary-500/20 hover:bg-primary-500/20',
    selectedBg: 'bg-primary-500 text-white border-primary-500',
  },
  {
    value: 1,
    label: '1',
    subLabel: 'Hard',
    color: 'text-warning-400',
    bgColor: 'bg-warning-500/10 border-warning-500/20 hover:bg-warning-500/20',
    selectedBg: 'bg-warning-500 text-white border-warning-500',
  },
  {
    value: 0,
    label: 'Maxed',
    subLabel: 'Out',
    color: 'text-danger-400',
    bgColor: 'bg-danger-500/10 border-danger-500/20 hover:bg-danger-500/20',
    selectedBg: 'bg-danger-500 text-white border-danger-500',
  },
];

interface RIRSelectorProps {
  value: RepsInTank | null;
  onChange: (value: RepsInTank) => void;
  disabled?: boolean;
}

/**
 * RIR (Reps In Reserve) selector component
 * Horizontal row of buttons for selecting how many reps were left in the tank
 */
export const RIRSelector = memo(function RIRSelector({
  value,
  onChange,
  disabled = false,
}: RIRSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1 text-sm font-medium text-surface-300">
        Reps left in tank?
        <InfoTooltip term="RIR" size="sm" />
      </label>
      <div className="grid grid-cols-4 gap-2">
        {RIR_OPTIONS.map((option) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              className={`
                flex flex-col items-center justify-center py-3 px-2 rounded-lg border transition-all
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                ${isSelected ? option.selectedBg : option.bgColor}
              `}
            >
              <span
                className={`text-lg font-bold ${isSelected ? 'text-white' : option.color}`}
              >
                {option.label}
              </span>
              <span
                className={`text-xs ${isSelected ? 'text-white/80' : 'text-surface-400'}`}
              >
                {option.subLabel}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default RIRSelector;
