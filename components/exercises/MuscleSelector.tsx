'use client';

/**
 * Muscle Group Multi-Selector
 *
 * Allows selecting multiple muscle groups with visual feedback.
 * Supports both legacy MuscleGroup and DetailedMuscleGroup values.
 */

import { MUSCLE_GROUP_OPTIONS } from '@/lib/exercises/types';

interface MuscleSelectorProps {
  selected: string[];
  onChange: (muscles: string[]) => void;
  exclude?: string[];
}

export function MuscleSelector({
  selected,
  onChange,
  exclude = [],
}: MuscleSelectorProps) {
  const availableOptions = MUSCLE_GROUP_OPTIONS.filter(
    (opt) => !exclude.includes(opt.value)
  );

  const toggleMuscle = (muscle: string) => {
    if (selected.includes(muscle)) {
      onChange(selected.filter((m) => m !== muscle));
    } else {
      onChange([...selected, muscle]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {availableOptions.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggleMuscle(option.value)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-all duration-200
              ${
                isSelected
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }
            `}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
