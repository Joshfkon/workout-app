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
    color: 'text-status-bad',
    bgColor: 'bg-status-bad/10 border-status-bad/20 hover:bg-status-bad/20',
    selectedBg: 'bg-status-bad text-white border-status-bad',
  },
  {
    value: 3,
    label: '3',
    subLabel: 'Good',
    color: 'text-status-ok',
    bgColor: 'bg-status-ok/10 border-status-ok/20 hover:bg-status-ok/20',
    selectedBg: 'bg-status-ok text-white border-status-ok',
  },
  {
    value: 2,
    label: '2',
    subLabel: 'Good',
    color: 'text-status-ok',
    bgColor: 'bg-status-ok/10 border-status-ok/20 hover:bg-status-ok/20',
    selectedBg: 'bg-status-ok text-white border-status-ok',
  },
  {
    value: 1,
    label: '1',
    subLabel: 'Hard',
    color: 'text-status-warn',
    bgColor: 'bg-status-warn/10 border-status-warn/20 hover:bg-status-warn/20',
    selectedBg: 'bg-status-warn text-white border-status-warn',
  },
  {
    value: 0,
    label: 'Maxed',
    subLabel: 'Out',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20',
    selectedBg: 'bg-orange-500 text-white border-orange-500',
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
      <label className="flex items-center gap-1 text-sm font-medium text-ink-2">
        Reps left in tank?
        <InfoTooltip term="RIR" size="sm" />
      </label>
      <div className="grid grid-cols-5 gap-2">
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
                className={`text-xs ${isSelected ? 'text-white/80' : 'text-ink-2'}`}
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
