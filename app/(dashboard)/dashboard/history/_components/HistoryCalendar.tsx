'use client';

/**
 * Month-grid calendar for workout history (P1-6, Strong's calendar as the
 * reference). Purely presentational: the page supplies which local dates have
 * completed workouts (dots) and handles day selection / month paging.
 */

import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { getLocalDateString } from '@/lib/utils';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export interface HistoryCalendarProps {
  /** First day of the displayed month. */
  month: Date;
  /** Local YYYY-MM-DD dates that have at least one completed workout. */
  dotDates: Set<string>;
  /** Currently selected day (YYYY-MM-DD) or null. */
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onMonthChange: (month: Date) => void;
}

export default function HistoryCalendar({
  month,
  dotDates,
  selectedDay,
  onSelectDay,
  onMonthChange,
}: HistoryCalendarProps) {
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const firstWeekday = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const today = getLocalDateString();

  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      getLocalDateString(new Date(year, monthIdx, i + 1))
    ),
  ];

  return (
    <div className="bg-card rounded-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => onMonthChange(new Date(year, monthIdx - 1, 1))}
          aria-label="Previous month"
          className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-2 hover:bg-fill hover:text-ink transition-colors"
        >
          <IconChevronLeft size={20} />
        </button>
        <span className="text-body font-semibold text-ink">
          {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={() => onMonthChange(new Date(year, monthIdx + 1, 1))}
          aria-label="Next month"
          className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-2 hover:bg-fill hover:text-ink transition-colors"
        >
          <IconChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={`${d}-${i}`} className="text-caption text-ink-3 py-1">
            {d}
          </span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={day}
              onClick={() => onSelectDay(selectedDay === day ? null : day)}
              aria-label={`${day}${dotDates.has(day) ? ' — workout logged' : ''}`}
              aria-pressed={selectedDay === day}
              className={`relative h-11 rounded-lg text-subhead tabular-nums transition-colors ${
                selectedDay === day
                  ? 'bg-action text-on-action font-semibold'
                  : day === today
                    ? 'border border-action/50 text-ink hover:bg-fill'
                    : 'text-ink-2 hover:bg-fill'
              }`}
            >
              {parseInt(day.slice(-2), 10)}
              {dotDates.has(day) && (
                <span
                  className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${
                    selectedDay === day ? 'bg-white' : 'bg-status-ok'
                  }`}
                  aria-hidden="true"
                />
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
}
