'use client';

/**
 * Two-Step Muscle Picker
 *
 * Makes muscle selection easier by showing body regions first,
 * then precise muscle heads when the region has subdivisions.
 */

import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { GROUPED_MUSCLE_OPTIONS, coarseSplitWarning } from '@/lib/exercises/types';
import type { GroupedMuscleOption } from '@/lib/exercises/types';

interface TwoStepMusclePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
}

export function TwoStepMusclePicker({
  label,
  value,
  onChange,
  error,
  required = false,
  placeholder = 'Select muscle group',
}: TwoStepMusclePickerProps) {
  // Find the selected group and sub-muscle based on current value
  const findSelectedGroup = (): GroupedMuscleOption | null => {
    for (const group of GROUPED_MUSCLE_OPTIONS) {
      if (group.value === value) return group;
      if (group.subMuscles.some((sub) => sub.value === value)) return group;
    }
    return null;
  };

  const selectedGroup = findSelectedGroup();
  const [currentGroup, setCurrentGroup] = useState<string>(selectedGroup?.value || '');

  // When a group is selected, check if it has subdivisions
  const handleGroupChange = (groupValue: string) => {
    setCurrentGroup(groupValue);
    const group = GROUPED_MUSCLE_OPTIONS.find((g) => g.value === groupValue);
    
    if (!group) {
      onChange('');
      return;
    }

    // If no subdivisions, select the group itself
    if (group.subMuscles.length === 0) {
      onChange(groupValue);
    } else {
      // Has subdivisions - wait for sub-muscle selection
      // Clear the value to force user to pick a specific muscle
      onChange('');
    }
  };

  // Handle sub-muscle selection
  const handleSubMuscleChange = (subValue: string) => {
    onChange(subValue);
  };

  // Group options for the first dropdown
  const groupOptions = GROUPED_MUSCLE_OPTIONS.map((group) => ({
    value: group.value,
    label: group.label,
  }));

  // Get the current group for showing sub-options
  const activeGroup = GROUPED_MUSCLE_OPTIONS.find((g) => g.value === currentGroup);

  // Show sub-muscle picker if the selected group has subdivisions
  const showSubMuscles = activeGroup && activeGroup.subMuscles.length > 0;

  // Show "whole group" option for groups with subdivisions (for secondaries)
  const canSelectWholeGroup = activeGroup && activeGroup.subMuscles.length > 0;

  return (
    <div className="space-y-3">
      {/* Step 1: Body Region */}
      <Select
        label={label}
        options={groupOptions}
        value={currentGroup}
        onChange={(e) => handleGroupChange(e.target.value)}
        placeholder={placeholder}
        error={error}
        required={required}
      />

      {/* Step 2: Precise Muscle (if applicable) */}
      {showSubMuscles && (
        <div>
          <Select
            label="Specific Muscle"
            options={[
              ...(canSelectWholeGroup
                ? [{ value: activeGroup.value, label: 'Whole group (split evenly)' }]
                : []),
              ...activeGroup.subMuscles.map((sub) => ({
                value: sub.value,
                label: sub.label,
              })),
            ]}
            value={value}
            onChange={(e) => handleSubMuscleChange(e.target.value)}
            placeholder="Select specific muscle"
            error={error && !value ? error : undefined}
            required={required}
          />
          {value && coarseSplitWarning(value) && (
            <p className="mt-1.5 text-sm text-warning-400">{coarseSplitWarning(value)}</p>
          )}
        </div>
      )}

      {/* Show split warning if whole group is selected */}
      {!showSubMuscles && value && coarseSplitWarning(value) && (
        <p className="mt-1.5 text-sm text-warning-400">{coarseSplitWarning(value)}</p>
      )}
    </div>
  );
}
