'use client';

/**
 * Month calendar sheet for the Eat tab, opened by tapping the date in the
 * Nutrition header. Standard Sun–Sat grid PLUS a WEEK column on the right:
 *
 *  - Each logged day renders a compliance ring: arc fill = % of the calorie
 *    target consumed, color = the phase-aware band the share formatter uses
 *    (green in band, yellow near-miss, red badly off — direction-aware per
 *    THAT day's phase from phase history, since a month can span cut→bulk).
 *    Unlogged days show an empty track; today mid-window grades by pace.
 *  - The WEEK column shows the week's net kcal over/under target with
 *    phase-aware framing (a deficit week on a bulk reads red "−3,590"), and
 *    is labeled with the phase when it changed mid-month.
 *  - Tapping a day navigates the Eat tab to that date. Month paging + Today.
 *
 * Data: ONE aggregate food_log query per visible month (useNutritionMonth) +
 * the cached phase-history query — never a per-day fetch. Today's live total
 * comes in as a prop from the page's day cache so the current-month cache
 * being a few minutes stale never shows a wrong "today" ring.
 */

import { useEffect, useMemo, useState } from 'react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { Modal } from '@/components/ui';
import { getLocalDateString } from '@/lib/utils';
import { useNutritionMonth, usePhaseHistory } from '@/hooks/useNutritionMonth';
import {
  buildCalendarMonth,
  formatNetKcal,
  phaseDisplayLabel,
  type CalendarDayCell,
  type RingTone,
} from '@/services/nutritionCalendar';
import type { EatingWindow, PacingPhase } from '@/services/intakePacing';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const RING_STROKE: Record<RingTone, string> = {
  green: 'stroke-success-500',
  yellow: 'stroke-warning-500',
  red: 'stroke-danger-500',
  neutral: 'stroke-surface-400',
};

const WEEK_TEXT: Record<RingTone, string> = {
  green: 'text-success-400',
  yellow: 'text-warning-400',
  red: 'text-danger-400',
  neutral: 'text-surface-500',
};

/** SVG compliance ring with the day number in the center. */
function DayRing({ cell }: { cell: CalendarDayCell }) {
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const { ring } = cell;
  return (
    <span className="relative flex h-9 w-9 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-9 w-9 -rotate-90" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="2.5"
          className="stroke-surface-800"
        />
        {!ring.empty && ring.fill > 0 && (
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${ring.fill * circumference} ${circumference}`}
            className={RING_STROKE[ring.tone]}
            data-testid="day-ring-arc"
            data-tone={ring.tone}
            data-partial={ring.partial ? 'true' : 'false'}
          />
        )}
      </svg>
      <span
        className={`relative text-[12px] tabular-nums ${
          cell.isToday
            ? 'font-bold text-primary-400'
            : cell.isFuture
              ? 'text-surface-600'
              : 'text-surface-200'
        }`}
      >
        {cell.dayOfMonth}
      </span>
    </span>
  );
}

export interface NutritionCalendarSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The Eat tab's currently selected day (YYYY-MM-DD). */
  selectedDate: string;
  /** Navigate the Eat tab to a day (the sheet closes itself after). */
  onSelectDate: (dateKey: string) => void;
  calorieTarget: number | null;
  currentPhase: PacingPhase;
  /**
   * Live calorie total for TODAY from the page's day cache. Overlaid on the
   * month aggregate so a freshly logged meal shows immediately.
   */
  todayCalories?: number;
  eatingWindow: EatingWindow;
}

export function NutritionCalendarSheet({
  isOpen,
  onClose,
  selectedDate,
  onSelectDate,
  calorieTarget,
  currentPhase,
  todayCalories,
  eatingWindow,
}: NutritionCalendarSheetProps) {
  const todayKey = getLocalDateString();
  const [monthKey, setMonthKey] = useState(() => selectedDate.slice(0, 7));

  // Re-center on the selected day's month every time the sheet opens.
  useEffect(() => {
    if (isOpen) setMonthKey(selectedDate.slice(0, 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const monthQuery = useNutritionMonth(isOpen ? monthKey : null, isOpen);
  const phaseHistoryQuery = usePhaseHistory(isOpen);

  const model = useMemo(() => {
    const dayCalories = { ...(monthQuery.data?.dayCalories ?? {}) };
    // Live today overlay: the page's day cache is fresher than the month
    // aggregate. Only when today has entries — undefined stays "unlogged".
    if (todayCalories !== undefined && todayKey.startsWith(monthKey)) {
      dayCalories[todayKey] = todayCalories;
    }
    return buildCalendarMonth({
      monthKey,
      dayCalories,
      calorieTarget,
      phaseHistory: phaseHistoryQuery.data ?? [],
      currentPhase,
      todayKey,
      now: new Date(),
      window: eatingWindow,
    });
  }, [
    monthQuery.data,
    phaseHistoryQuery.data,
    monthKey,
    calorieTarget,
    currentPhase,
    todayCalories,
    todayKey,
    eatingWindow,
  ]);

  const [year, month] = monthKey.split('-').map(Number);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const isCurrentMonth = monthKey === todayKey.slice(0, 7);

  const changeMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setMonthKey(getLocalDateString(d).slice(0, 7));
  };

  const selectDay = (cell: CalendarDayCell) => {
    if (cell.isFuture) return;
    onSelectDate(cell.dateKey);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Calendar" size="md">
      <div data-testid="nutrition-calendar">
        {/* Month header: paging + Today jump */}
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => changeMonth(-1)}
            aria-label="Previous month"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
          >
            <IconChevronLeft size={20} aria-hidden="true" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-surface-100">{monthLabel}</span>
            {!isCurrentMonth && (
              <button
                onClick={() => setMonthKey(todayKey.slice(0, 7))}
                className="rounded-full border border-primary-500/40 px-2 py-0.5 text-[11px] font-medium text-primary-400 transition-colors hover:bg-primary-500/10"
              >
                Today
              </button>
            )}
          </div>
          <button
            onClick={() => changeMonth(1)}
            aria-label="Next month"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-200"
          >
            <IconChevronRight size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Grid: 7 day columns + the WEEK column */}
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(3.25rem,auto)] gap-x-0.5 gap-y-1 text-center">
          {WEEKDAYS.map((d, i) => (
            <span key={`${d}-${i}`} className="py-1 text-[10px] uppercase text-surface-500">
              {d}
            </span>
          ))}
          <span className="py-1 text-[10px] uppercase text-surface-500">Week</span>

          {model.weeks.map((week, weekIdx) => (
            <FragmentRow key={`week-${weekIdx}`}>
              {week.days.map((cell, dayIdx) =>
                cell === null ? (
                  <span key={`pad-${weekIdx}-${dayIdx}`} />
                ) : (
                  <button
                    key={cell.dateKey}
                    onClick={() => selectDay(cell)}
                    disabled={cell.isFuture}
                    aria-label={dayCellAriaLabel(cell, calorieTarget)}
                    aria-pressed={cell.dateKey === selectedDate}
                    data-testid="calendar-day"
                    className={`flex h-11 items-center justify-center rounded-lg transition-colors ${
                      cell.dateKey === selectedDate
                        ? 'bg-surface-800'
                        : cell.isFuture
                          ? 'cursor-default'
                          : 'hover:bg-surface-800'
                    }`}
                  >
                    <DayRing cell={cell} />
                  </button>
                )
              )}
              <div
                className="flex h-11 flex-col items-center justify-center rounded-lg bg-surface-800/40 px-1"
                data-testid="week-summary"
                data-tone={week.summary.tone}
              >
                <span
                  className={`text-[11px] font-semibold tabular-nums ${WEEK_TEXT[week.summary.tone]}`}
                >
                  {week.summary.netKcal === null ? '—' : formatNetKcal(week.summary.netKcal)}
                </span>
                {week.summary.phaseLabel && week.summary.netKcal !== null && (
                  <span className="text-[9px] uppercase tracking-wide text-surface-500">
                    {week.summary.phaseLabel}
                  </span>
                )}
              </div>
            </FragmentRow>
          ))}
        </div>

        {/* Legend */}
        <p className="mt-3 text-center text-[11px] text-surface-500">
          Ring = % of calorie target · color graded for that day&apos;s phase
          {model.spansPhases
            ? ` (${Array.from(
                new Set(
                  model.weeks.flatMap((w) =>
                    w.days.filter((d): d is CalendarDayCell => !!d).map((d) => d.phase)
                  )
                )
              )
                .map(phaseDisplayLabel)
                .join(' → ')} this month)`
            : ''}
        </p>
      </div>
    </Modal>
  );
}

/** aria copy for a day cell: date + grading summary for screen readers. */
function dayCellAriaLabel(cell: CalendarDayCell, calorieTarget: number | null): string {
  if (cell.ring.empty) return `${cell.dateKey} — nothing logged`;
  const pct = calorieTarget ? Math.round(cell.ring.fill * 100) : null;
  const grade = cell.ring.partial ? 'pacing' : cell.ring.tone;
  return pct === null
    ? `${cell.dateKey} — logged`
    : `${cell.dateKey} — ${pct}% of calorie target, ${grade}`;
}

/** Children passthrough — grid rows are just 8 sibling cells. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
