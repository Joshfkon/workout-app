'use client';

import { useState, useEffect } from 'react';
import type { WorkoutDay } from '@/types/schema';
import { DAYS_OF_WEEK, WEEKDAYS } from '@/types/schema';

interface WorkoutDaySelectorProps {
  /** Number of days the user wants to work out per week */
  daysPerWeek: number;
  /** Currently selected workout days */
  selectedDays: WorkoutDay[];
  /** Callback when days change */
  onChange: (days: WorkoutDay[]) => void;
  /** Whether to show preset buttons (Weekdays only, etc.) */
  showPresets?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Allows users to select which specific days of the week they want to work out.
 * Enforces that the number of selected days matches daysPerWeek.
 */
export function WorkoutDaySelector({
  daysPerWeek,
  selectedDays,
  onChange,
  showPresets = true,
  className = '',
}: WorkoutDaySelectorProps) {
  const [error, setError] = useState<string | null>(null);

  // Check if current selection is valid
  useEffect(() => {
    if (selectedDays.length !== daysPerWeek) {
      setError(`Select exactly ${daysPerWeek} days`);
    } else {
      setError(null);
    }
  }, [selectedDays, daysPerWeek]);

  const toggleDay = (day: WorkoutDay) => {
    if (selectedDays.includes(day)) {
      // Removing a day
      onChange(selectedDays.filter(d => d !== day));
    } else {
      // Adding a day - only allow if we haven't reached the limit
      if (selectedDays.length < daysPerWeek) {
        onChange([...selectedDays, day]);
      } else {
        // Replace the oldest selected day with the new one
        const newDays = [...selectedDays.slice(1), day];
        onChange(newDays);
      }
    }
  };

  // Get short day name (Mon, Tue, etc.)
  const getShortDay = (day: WorkoutDay): string => {
    return day.slice(0, 3);
  };

  // Preset handlers
  const selectWeekdaysOnly = () => {
    // Select first N weekdays
    const weekdaySelection = WEEKDAYS.slice(0, Math.min(daysPerWeek, 5));
    // If daysPerWeek > 5, we'll still only select weekdays (max 5)
    onChange(weekdaySelection);
  };

  const selectSpreadOut = () => {
    // Optimally spread days across the week
    const patterns: Record<number, WorkoutDay[]> = {
      2: ['Monday', 'Thursday'],
      3: ['Monday', 'Wednesday', 'Friday'],
      4: ['Monday', 'Tuesday', 'Thursday', 'Friday'],
      5: ['Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday'],
      6: ['Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday', 'Sunday'],
    };
    onChange(patterns[daysPerWeek] || patterns[4]);
  };

  const selectConsecutive = () => {
    // Select consecutive days starting from Monday
    onChange(DAYS_OF_WEEK.slice(0, daysPerWeek));
  };

  const canSelectWeekdaysOnly = daysPerWeek <= 5;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Preset buttons */}
      {showPresets && (
        <div className="flex flex-wrap gap-2">
          {canSelectWeekdaysOnly && (
            <button
              type="button"
              onClick={selectWeekdaysOnly}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                selectedDays.length === daysPerWeek &&
                selectedDays.every(d => WEEKDAYS.includes(d))
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              Weekdays only
            </button>
          )}
          <button
            type="button"
            onClick={selectSpreadOut}
            className="px-3 py-1.5 text-xs font-medium rounded-full bg-surface-800 text-surface-300 hover:bg-surface-700 transition-colors"
          >
            Spread out (optimal)
          </button>
          <button
            type="button"
            onClick={selectConsecutive}
            className="px-3 py-1.5 text-xs font-medium rounded-full bg-surface-800 text-surface-300 hover:bg-surface-700 transition-colors"
          >
            Consecutive days
          </button>
        </div>
      )}

      {/* Day selector grid */}
      <div className="flex gap-1.5 sm:gap-2">
        {DAYS_OF_WEEK.map((day) => {
          const isSelected = selectedDays.includes(day);
          const isWeekend = day === 'Saturday' || day === 'Sunday';

          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`
                flex-1 py-3 px-1 sm:px-2 rounded-lg text-center transition-all
                ${isSelected
                  ? 'bg-primary-500 text-white ring-2 ring-primary-400 ring-offset-2 ring-offset-surface-900'
                  : isWeekend
                    ? 'bg-surface-800/50 text-surface-400 hover:bg-surface-700'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                }
              `}
            >
              <span className="block text-xs sm:text-sm font-medium">
                {getShortDay(day)}
              </span>
              <span className={`block text-[10px] sm:text-xs mt-0.5 ${isSelected ? 'text-primary-100' : 'text-surface-500'}`}>
                {isWeekend ? 'Weekend' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selection status */}
      <div className="flex items-center justify-between">
        <span className={`text-sm ${error ? 'text-warning-400' : 'text-surface-400'}`}>
          {selectedDays.length}/{daysPerWeek} days selected
        </span>
        {error && (
          <span className="text-xs text-warning-400">{error}</span>
        )}
      </div>

      {/* Selected days preview */}
      {selectedDays.length > 0 && (
        <div className="p-3 bg-surface-800/50 rounded-lg">
          <p className="text-xs text-surface-500 mb-1">Your workout schedule:</p>
          <p className="text-sm text-surface-200 font-medium">
            {selectedDays
              .sort((a, b) => DAYS_OF_WEEK.indexOf(a) - DAYS_OF_WEEK.indexOf(b))
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

export default WorkoutDaySelector;
