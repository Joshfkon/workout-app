// ============================================================
// NUTRITION CALENDAR ENGINE
//
// Pure month-model builder for the Eat tab's calendar sheet: per-day
// compliance rings + a per-week net over/under column, both phase-aware.
//
// The band logic is NOT re-derived here — day rings call
// services/nutritionShareText.calorieComplianceBand (the share formatter's
// calorie square) and today's in-window ring calls
// services/intakePacing.assessIntakePace (the glance-tile pacing grade), so
// every surface grades a day the same way.
//
// Phase is resolved PER DAY from phase history, because a month can span a
// cut→bulk switch: the same 88%-of-target day reads green during the cut half
// and red during the bulk half.
//
// Pure functions only — no database calls, no clock reads (`now`/`todayKey`
// are always inputs). See CLAUDE.md /services rule.
// ============================================================

import {
  assessIntakePace,
  DEFAULT_EATING_WINDOW,
  eatingWindowFraction,
  type EatingWindow,
  type PacingPhase,
} from '@/services/intakePacing';
import {
  calorieComplianceBand,
  calorieHarm,
  type ComplianceBand,
} from '@/services/nutritionShareText';

/** One phase interval: `phase` became active on `startedOn` (local date). */
export interface PhaseHistoryEntry {
  phase: PacingPhase;
  /** YYYY-MM-DD (local) the phase started. */
  startedOn: string;
}

/** Ring color; 'neutral' = no judgment (no target / pre-window today). */
export type RingTone = ComplianceBand | 'neutral';

export interface DayRingModel {
  /** Nothing logged that day (or a future day) — render a hollow track. */
  empty: boolean;
  /** Arc fill: fraction of the calorie target consumed, clamped to [0, 1]. */
  fill: number;
  tone: RingTone;
  /** True when graded against intraday pace (today, mid-window), not the full-day band. */
  partial: boolean;
}

export interface CalendarDayCell {
  dateKey: string;
  dayOfMonth: number;
  isToday: boolean;
  isFuture: boolean;
  phase: PacingPhase;
  ring: DayRingModel;
}

export interface WeekSummary {
  /** Net kcal over (+) / under (−) target across the week's logged days; null when none logged. */
  netKcal: number | null;
  loggedDays: number;
  /** Phase-aware framing: a deficit week on a bulk is 'red', on a cut 'green'. */
  tone: RingTone;
  /** Dominant phase of the week's in-month days. */
  phase: PacingPhase;
  /** Short phase label ("Cut"/"Bulk"/"Recomp") — set only when the month spans >1 phase. */
  phaseLabel: string | null;
}

export interface CalendarWeek {
  /** Always 7 slots (Sun..Sat); null = day outside the displayed month. */
  days: (CalendarDayCell | null)[];
  summary: WeekSummary;
}

export interface CalendarMonthModel {
  monthKey: string;
  weeks: CalendarWeek[];
  /** True when phase history places more than one phase inside this month. */
  spansPhases: boolean;
}

export interface BuildCalendarMonthInput {
  /** 'YYYY-MM' of the displayed month. */
  monthKey: string;
  /** Calorie totals keyed by YYYY-MM-DD — ONLY days with ≥1 log entry present. */
  dayCalories: Record<string, number>;
  calorieTarget: number | null;
  /** Phase change log (any order). Empty for users predating phase history. */
  phaseHistory: PhaseHistoryEntry[];
  /** Fallback phase for dates not covered by history (users.goal today). */
  currentPhase: PacingPhase;
  /** Local YYYY-MM-DD for "today" — passed in, never read from the clock. */
  todayKey: string;
  /** Wall-clock reference for today's pacing grade. */
  now: Date;
  window?: EatingWindow;
}

/**
 * Phase active on `dateKey`: the latest history entry that had started by
 * then. Dates before recorded history (and every date when history is empty)
 * fall back to `currentPhase` — the best available guess for legacy data.
 */
export function resolvePhaseOnDate(
  history: PhaseHistoryEntry[],
  dateKey: string,
  currentPhase: PacingPhase
): PacingPhase {
  let resolved: PacingPhase | null = null;
  let resolvedStart = '';
  for (const entry of history) {
    if (entry.startedOn <= dateKey && entry.startedOn >= resolvedStart) {
      resolved = entry.phase;
      resolvedStart = entry.startedOn;
    }
  }
  return resolved ?? currentPhase;
}

/** Display label, matching the share header ('maintenance' reads "Recomp"). */
export function phaseDisplayLabel(phase: PacingPhase): string {
  if (phase === 'maintenance') return 'Recomp';
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/** "+1,240" / "−3,590" — explicit sign, en-US grouping (U+2212 minus). */
export function formatNetKcal(net: number): string {
  const rounded = Math.round(net);
  const abs = Math.abs(rounded).toLocaleString('en-US');
  if (rounded > 0) return `+${abs}`;
  if (rounded < 0) return `−${abs}`;
  return '±0';
}

/** Mirrors the share formatter's end-of-day switch (nutritionShareText). */
const END_OF_DAY_CALORIE_FRACTION = 0.95;

/**
 * Ring for one day. Completed days grade against the full-day phase-aware
 * band; today mid-window grades against pace (being at 50% of calories at
 * 2 PM is on pace, i.e. green) exactly like the share formatter and the
 * home-glance tiles.
 */
export function dayRing(input: {
  dateKey: string;
  /** undefined = nothing logged that day. */
  calories: number | undefined;
  calorieTarget: number | null;
  phase: PacingPhase;
  todayKey: string;
  now: Date;
  window?: EatingWindow;
}): DayRingModel {
  const { dateKey, calories, calorieTarget, phase, todayKey, now } = input;
  const window = input.window ?? DEFAULT_EATING_WINDOW;

  if (calories === undefined || dateKey > todayKey) {
    return { empty: true, fill: 0, tone: 'neutral', partial: false };
  }

  const hasTarget = !!calorieTarget && calorieTarget > 0;
  const ratio = hasTarget ? calories / (calorieTarget as number) : 0;
  const fill = hasTarget ? Math.max(0, Math.min(1, ratio)) : 1;

  if (!hasTarget) {
    // Logged but ungradeable — full neutral ring, "you showed up".
    return { empty: false, fill, tone: 'neutral', partial: false };
  }

  if (dateKey === todayKey) {
    // In-window today: the pacing grade. Same end-of-day switch as the share
    // formatter — once the window closes or the day is ≥95% complete, grade
    // it like a finished day.
    const minutes = now.getHours() * 60 + now.getMinutes();
    const windowClosed = minutes >= window.endMinutes;
    const isEndOfDay = windowClosed || ratio >= END_OF_DAY_CALORIE_FRACTION;
    if (!isEndOfDay && eatingWindowFraction(now, window) > 0) {
      const verdict = assessIntakePace({
        macro: 'calories',
        consumed: calories,
        target: calorieTarget,
        phase,
        now,
        window,
      });
      const tone: RingTone =
        verdict.tone === 'orange' ? 'red' : verdict.tone === 'neutral' ? 'neutral' : verdict.tone;
      return { empty: false, fill, tone, partial: true };
    }
  }

  const pct = Math.round(ratio * 100);
  return { empty: false, fill, tone: calorieComplianceBand(pct, phase), partial: false };
}

/**
 * Week framing: net kcal vs target across the week's LOGGED days, banded with
 * the same ±5%/±10% phase-directional thresholds as the day rings (relative
 * to the summed target of those days). Deficit on a bulk → red; deficit on a
 * cut → green.
 */
export function weekTone(
  netKcal: number,
  weeklyTargetKcal: number,
  phase: PacingPhase
): RingTone {
  if (weeklyTargetKcal <= 0) return 'neutral';
  const devPct = (netKcal / weeklyTargetKcal) * 100;
  if (Math.abs(devPct) <= 5) return 'green';
  const harm = calorieHarm(phase);
  const harmful = devPct < 0 ? harm.under : harm.over;
  if (!harmful) return 'green';
  return Math.abs(devPct) <= 10 ? 'yellow' : 'red';
}

/** Dominant phase among the given days (ties go to the later phase). */
function dominantPhase(phases: PacingPhase[], fallback: PacingPhase): PacingPhase {
  if (phases.length === 0) return fallback;
  const counts = new Map<PacingPhase, number>();
  let winner: PacingPhase = phases[phases.length - 1];
  let best = 0;
  // Iterate backwards so on a tie the LATER phase (closer to now) wins.
  for (let i = phases.length - 1; i >= 0; i--) {
    const next = (counts.get(phases[i]) || 0) + 1;
    counts.set(phases[i], next);
    if (next > best) {
      best = next;
      winner = phases[i];
    }
  }
  return winner;
}

/**
 * Build the full month model: weeks of day cells (Sun-padded) plus one
 * summary per calendar-week row. Week summaries only count IN-MONTH logged
 * days — the week column reads as "this month's week", not a rolling window.
 * Today is included in its week's net only once its day is fully graded
 * (i.e. excluded while partial, so a half-eaten today doesn't read as a
 * catastrophic weekly deficit).
 */
export function buildCalendarMonth(input: BuildCalendarMonthInput): CalendarMonthModel {
  const {
    monthKey,
    dayCalories,
    calorieTarget,
    phaseHistory,
    currentPhase,
    todayKey,
    now,
    window,
  } = input;

  const [year, month] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  const cells: (CalendarDayCell | null)[] = Array.from({ length: firstWeekday }, () => null);
  const phasesSeen = new Set<PacingPhase>();

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    const phase = resolvePhaseOnDate(phaseHistory, dateKey, currentPhase);
    phasesSeen.add(phase);
    cells.push({
      dateKey,
      dayOfMonth: day,
      isToday: dateKey === todayKey,
      isFuture: dateKey > todayKey,
      phase,
      ring: dayRing({
        dateKey,
        calories: dayCalories[dateKey],
        calorieTarget,
        phase,
        todayKey,
        now,
        window,
      }),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const spansPhases = phasesSeen.size > 1;

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const days = cells.slice(i, i + 7);
    const graded = days.filter(
      (d): d is CalendarDayCell => !!d && !d.ring.empty && !d.ring.partial
    );
    const loggedDays = graded.length;
    const hasTarget = !!calorieTarget && calorieTarget > 0;
    const netKcal =
      loggedDays > 0 && hasTarget
        ? graded.reduce(
            (sum, d) => sum + (dayCalories[d.dateKey] ?? 0) - (calorieTarget as number),
            0
          )
        : null;
    const phase = dominantPhase(
      graded.map((d) => d.phase),
      days.find((d) => d !== null)?.phase ?? currentPhase
    );
    weeks.push({
      days,
      summary: {
        netKcal,
        loggedDays,
        tone:
          netKcal === null
            ? 'neutral'
            : weekTone(netKcal, (calorieTarget as number) * loggedDays, phase),
        phase,
        phaseLabel: spansPhases ? phaseDisplayLabel(phase) : null,
      },
    });
  }

  return { monthKey, weeks, spansPhases };
}
