'use client';

import { useState, useEffect } from 'react';
import type { WorkoutDay } from '@/types/schema';
import { DAYS_OF_WEEK, WEEKDAYS, WEEKEND_DAYS } from '@/types/schema';

interface WorkoutDaySelectorProps {
  /** Number of days the user wants to work out per week */
  daysPerWeek: number;
  /** Currently selected workout days */
  selectedDays: WorkoutDay[];
  /** Callback when days change */
  onChange: (days: WorkoutDay[]) => void;
  /** Whether to show preset buttons (Spread out, Weekdays only, etc.) */
  showPresets?: boolean;
  /** Custom class name */
  className?: string;
}

/** A named starting point for a week's worth of training days. */
interface DayPreset {
  id: string;
  label: string;
  /** What pressing it does, for users who can't tell the shapes apart. */
  hint: string;
  /** Null when the preset can't cover daysPerWeek (e.g. 6 days on weekdays). */
  days: WorkoutDay[] | null;
}

const DAY_COUNT = DAYS_OF_WEEK.length;

function sortDays(days: WorkoutDay[]): WorkoutDay[] {
  return [...days].sort((a, b) => DAYS_OF_WEEK.indexOf(a) - DAYS_OF_WEEK.indexOf(b));
}

function sameDays(a: WorkoutDay[], b: WorkoutDay[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = sortDays(a);
  const sortedB = sortDays(b);
  return sortedA.every((day, i) => day === sortedB[i]);
}

/**
 * Rest-day patterns that keep sessions apart without bunching them. These
 * mirror the defaults in lib/training/trainingSchedule so the chip lights up
 * when the user is on the app's default spread. They start on Monday only
 * because a pattern has to start somewhere — the shift control below rotates
 * any of them onto whatever week the user actually trains.
 */
const SPREAD_PATTERNS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function spreadDays(count: number): WorkoutDay[] {
  const safeCount = Math.max(1, Math.min(DAY_COUNT, count));
  const pattern = SPREAD_PATTERNS[safeCount] || SPREAD_PATTERNS[4];
  return sortDays(pattern.map((i) => DAYS_OF_WEEK[i]));
}

/**
 * Spreads that always include Saturday and Sunday, for people whose week is
 * built around the weekend rather than around Monday-to-Friday.
 */
const WEEKEND_PATTERNS: Record<number, number[]> = {
  1: [5],
  2: [5, 6],
  3: [2, 5, 6],
  4: [1, 3, 5, 6],
  5: [0, 2, 4, 5, 6],
  6: [0, 1, 2, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

function weekendDays(count: number): WorkoutDay[] {
  const safeCount = Math.max(1, Math.min(DAY_COUNT, count));
  const pattern = WEEKEND_PATTERNS[safeCount] || WEEKEND_PATTERNS[4];
  return sortDays(pattern.map((i) => DAYS_OF_WEEK[i]));
}

function consecutiveDays(count: number, startIndex = 0): WorkoutDay[] {
  const safeCount = Math.max(1, Math.min(DAY_COUNT, count));
  return sortDays(
    Array.from({ length: safeCount }, (_, i) => DAYS_OF_WEEK[(startIndex + i) % DAY_COUNT])
  );
}

/**
 * Rotate a selection forward by one day (Sunday wraps to Monday), so a
 * preset built around a Monday-start week can be moved onto whatever week
 * the user actually lives in.
 */
function shiftDays(days: WorkoutDay[], direction: 1 | -1): WorkoutDay[] {
  return sortDays(
    days.map((day) => {
      const next = (DAYS_OF_WEEK.indexOf(day) + direction + DAY_COUNT) % DAY_COUNT;
      return DAYS_OF_WEEK[next];
    })
  );
}

/**
 * The presets offered for a given day count, with duplicates removed.
 *
 * Named week shapes genuinely collide once you pick N of 7 days — "Weekdays
 * only" and 4 consecutive days from Monday are the same four days. Two chips
 * for one selection is what made the old picker look like it was overriding
 * the user's choice, so a preset that produces a set an earlier preset already
 * covers is dropped rather than shown twice. At most one chip is ever active.
 */
function buildPresets(daysPerWeek: number): (DayPreset & { days: WorkoutDay[] })[] {
  const candidates: DayPreset[] = [
    {
      id: 'spread',
      label: 'Spread out',
      hint: 'Maximise rest between sessions',
      days: spreadDays(daysPerWeek),
    },
    {
      id: 'weekdays',
      label: 'Weekdays only',
      hint: 'Keep Saturday and Sunday free',
      days: daysPerWeek <= WEEKDAYS.length ? sortDays(WEEKDAYS.slice(0, daysPerWeek)) : null,
    },
    {
      id: 'weekends',
      label: daysPerWeek <= WEEKEND_DAYS.length ? 'Weekends only' : 'Weekends + weekdays',
      hint: 'Always train Saturday and Sunday',
      days: weekendDays(daysPerWeek),
    },
    {
      id: 'consecutive',
      label: 'Back to back',
      hint: 'Train on consecutive days, then rest',
      days: consecutiveDays(daysPerWeek),
    },
  ];

  const seen: WorkoutDay[][] = [];
  const presets: (DayPreset & { days: WorkoutDay[] })[] = [];

  for (const candidate of candidates) {
    if (!candidate.days) continue;
    if (seen.some((days) => sameDays(days, candidate.days!))) continue;
    seen.push(candidate.days);
    presets.push(candidate as DayPreset & { days: WorkoutDay[] });
  }

  return presets;
}

/**
 * Allows users to select which specific days of the week they want to work out.
 * Enforces that the number of selected days matches daysPerWeek.
 *
 * All seven days are equal here: presets cover weekday-, weekend- and
 * spread-shaped weeks, and the shift control rotates any of them onto the
 * days the user actually trains.
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

  const presets = buildPresets(daysPerWeek);
  const canShift = selectedDays.length > 0;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Preset buttons */}
      {showPresets && (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const isActive = sameDays(selectedDays, preset.days);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.days)}
                aria-pressed={isActive}
                title={preset.hint}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  isActive
                    ? 'bg-primary-500 text-white'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onChange(shiftDays(selectedDays, 1))}
            disabled={!canShift}
            title="Move every selected day one day later"
            className="px-3 py-1.5 text-xs font-medium rounded-full bg-surface-800 text-surface-300 hover:bg-surface-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Shift +1 day
          </button>
        </div>
      )}

      {/* Day selector grid */}
      <div className="flex gap-1.5 sm:gap-2">
        {DAYS_OF_WEEK.map((day) => {
          const isSelected = selectedDays.includes(day);

          return (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={isSelected}
              aria-label={day}
              className={`
                flex-1 py-3 px-1 sm:px-2 rounded-lg text-center transition-all
                ${isSelected
                  ? 'bg-primary-500 text-white ring-2 ring-primary-400 ring-offset-2 ring-offset-surface-900'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                }
              `}
            >
              <span className="block text-xs sm:text-sm font-medium">
                {getShortDay(day)}
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
            {sortDays(selectedDays).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

export default WorkoutDaySelector;
