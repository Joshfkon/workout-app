'use client';

import { useMemo } from 'react';
import type { WorkoutDay } from '@/types/schema';
import { WorkoutDaySelector } from './WorkoutDaySelector';
import {
  TRAINING_INTERVAL_OPTIONS,
  buildTrainingSchedule,
  intervalDaysPerWeek,
  scheduledDatesBetween,
  parseLocalDate,
  type ScheduleMode,
} from '@/lib/training/trainingSchedule';

interface TrainingScheduleSelectorProps {
  /** Sessions per week for the fixed-day mode (the days/week slider). */
  daysPerWeek: number;
  mode: ScheduleMode;
  onModeChange: (mode: ScheduleMode) => void;
  selectedDays: WorkoutDay[];
  onDaysChange: (days: WorkoutDay[]) => void;
  /** Train every N days, when mode is 'interval'. */
  intervalDays: number;
  onIntervalChange: (intervalDays: number) => void;
  /** Local YYYY-MM-DD the interval counts from (the block's start date). */
  anchorDate: string;
  className?: string;
}

const PREVIEW_SESSIONS = 5;

function intervalLabel(intervalDays: number): string {
  return intervalDays === 2 ? 'Every other day' : `Every ${intervalDays} days`;
}

/**
 * Picks *when* a mesocycle trains.
 *
 * Two modes, because they are genuinely different shapes of schedule:
 *   - Same days each week: a fixed set of weekdays.
 *   - Every N days: a rolling cadence anchored to the start date. "Every
 *     other day" is 3.5 sessions/week and lands on different weekdays each
 *     week, so it cannot be written down as a set of weekdays at all.
 */
export function TrainingScheduleSelector({
  daysPerWeek,
  mode,
  onModeChange,
  selectedDays,
  onDaysChange,
  intervalDays,
  onIntervalChange,
  anchorDate,
  className = '',
}: TrainingScheduleSelectorProps) {
  const previewDates = useMemo(() => {
    if (mode !== 'interval') return [];
    const schedule = buildTrainingSchedule({
      days_per_week: intervalDaysPerWeek(intervalDays),
      schedule_mode: 'interval',
      training_interval_days: intervalDays,
      start_date: anchorDate,
    });
    const start = parseLocalDate(anchorDate);
    if (!start) return [];
    const end = new Date(start);
    end.setDate(end.getDate() + intervalDays * PREVIEW_SESSIONS);
    return scheduledDatesBetween(schedule, start, end).slice(0, PREVIEW_SESSIONS);
  }, [mode, intervalDays, anchorDate]);

  const sessionsPerWeekLabel = (7 / intervalDays).toFixed(1).replace(/\.0$/, '');
  const plannedDaysPerWeek = intervalDaysPerWeek(intervalDays);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Schedule type">
        {([
          { value: 'fixed_days' as const, label: 'Same days each week' },
          { value: 'interval' as const, label: 'Every N days' },
        ]).map((option) => {
          const isActive = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onModeChange(option.value)}
              aria-pressed={isActive}
              className={`px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {mode === 'fixed_days' ? (
        <WorkoutDaySelector
          daysPerWeek={daysPerWeek}
          selectedDays={selectedDays}
          onChange={onDaysChange}
          showPresets
        />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-surface-500 mb-2">
              Train on a rolling cadence instead of fixed weekdays. Your training days move
              through the week, so weekends are in the rotation like any other day.
            </p>
            <div className="flex flex-wrap gap-2">
              {TRAINING_INTERVAL_OPTIONS.map((option) => {
                const isActive = intervalDays === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onIntervalChange(option)}
                    aria-pressed={isActive}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                      isActive
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
                    }`}
                  >
                    {intervalLabel(option)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 bg-surface-800/50 rounded-lg space-y-2">
            <p className="text-xs text-surface-500">
              Your workout schedule: {intervalLabel(intervalDays).toLowerCase()}, starting{' '}
              {previewDates[0]
                ? previewDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : anchorDate}
            </p>
            {previewDates.length > 0 && (
              <p className="text-sm text-surface-200 font-medium">
                {previewDates
                  // Composed rather than a single toLocaleDateString call:
                  // the {weekday, day} combination renders as "3 Mon" in some
                  // ICU builds, which reads as a date rather than a weekday.
                  .map(
                    (date) =>
                      `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.getDate()}`
                  )
                  .join(' → ')}
                {' → …'}
              </p>
            )}
            <p className="text-xs text-surface-500">
              ~{sessionsPerWeekLabel} sessions/week. Volume and progression are planned at{' '}
              {plannedDaysPerWeek} sessions/week, the nearest whole number.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default TrainingScheduleSelector;
