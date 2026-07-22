'use client';

/**
 * Muscle Multi-Selector
 *
 * Chip picker over the grouped taxonomy: each coarse group renders alongside
 * its fine standard-muscle heads (Front/Side/Rear Delts, …), so custom
 * exercises can be tagged precisely instead of coarse-only. A coarse chip for
 * a group WITH subdivisions stays selectable as an explicit "whole group"
 * fallback — with a warning that volume credit will be split evenly across
 * the heads (that split is how "Lateral Raise" customs ended up crediting
 * front and rear delts).
 */

import { GROUPED_MUSCLE_OPTIONS, coarseSplitWarning } from '@/lib/exercises/types';

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
  const toggleMuscle = (muscle: string) => {
    if (selected.includes(muscle)) {
      onChange(selected.filter((m) => m !== muscle));
    } else {
      onChange([...selected, muscle]);
    }
  };

  const chip = (value: string, label: string, isFine: boolean) => {
    const isSelected = selected.includes(value);
    return (
      <button
        key={value}
        type="button"
        onClick={() => toggleMuscle(value)}
        className={`${isFine ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'} rounded-lg transition-all duration-200
          ${
            isSelected
              ? 'bg-primary-600 text-white'
              : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
          }
        `}
      >
        {label}
      </button>
    );
  };

  const splitWarnings = selected
    .map((m) => coarseSplitWarning(m))
    .filter((w): w is string => w !== null);

  return (
    <div>
      <div className="space-y-2">
        {GROUPED_MUSCLE_OPTIONS.filter((group) => !exclude.includes(group.value)).map((group) => (
          <div key={group.value} className="flex flex-wrap items-center gap-1.5">
            {chip(
              group.value,
              group.subMuscles.length > 0 ? `${group.label} (all)` : group.label,
              false
            )}
            {group.subMuscles
              .filter((s) => !exclude.includes(s.value))
              .map((s) => chip(s.value, s.label, true))}
          </div>
        ))}
      </div>
      {splitWarnings.length > 0 && (
        <p className="mt-2 text-xs text-warning-400">{splitWarnings[0]}</p>
      )}
    </div>
  );
}
