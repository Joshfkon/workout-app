/**
 * MESOCYCLE PLAN PREVIEW (pure)
 *
 * Shapes a mesocycle's stored `program_data` into the week-by-week,
 * session-by-session structure rendered read-only by
 * /dashboard/mesocycle/plan and the preview sheets — "what am I actually
 * signed up for?" without having to press Start.
 *
 * The preview must describe the SAME sessions the start path would build, so
 * it reuses the same primitives and the same indexing rules:
 *   - `getWeekSessionsFromProgramData` (mesocycleWeeks, legacy `sessions`
 *     fallback, week index capped to the stored weeks — exactly how
 *     `getSessionFromProgramData` behaves when a meso outlives its stored
 *     weeks),
 *   - `applyExerciseOverrides` (the user's swaps),
 *   - ONE SLOT PER TRAINING DAY, wrapping into the stored sessions with
 *     `slot % sessions.length`. A week can hold fewer session templates than
 *     the user trains days (buildSessionTemplates slices the split's templates
 *     to daysPerWeek — a 5-day Arnold plan stores 3), and Start wraps the day
 *     index over them. Rendering the stored sessions one-for-one would hide
 *     the repeated days and undercount the week's volume.
 *   - the week/session the user is actually up to: `current_week` (which Start
 *     reads, and which the completion flow clamps upward so mesocycles
 *     advanced under the old date-based scheme never jump backwards) paired
 *     with `sessionIndexFromCompleted`, so "next up" lands on the session
 *     Start would launch even after skipped days.
 *
 * Two things the preview deliberately does NOT model, because they are only
 * resolved at start time against the database: per-exercise weight targets
 * (weightEstimationEngine / setRecommender) and the ±1 weekly set adjustment
 * from last week's feedback (lib/training/weeklyRollover). Set counts here are
 * the planned counts.
 *
 * No DB access — callers pass the mesocycle row's fields.
 */

import {
  getWeekSessionsFromProgramData,
  getWeeklyProgressionModifiers,
  applyExerciseOverrides,
  type ExerciseOverride,
  type ExtractedSession,
} from '@/services/mesocycleHelpers';
import {
  getTrainingDays,
  parseLocalDate,
  type TrainingSchedule,
} from '@/lib/training/trainingSchedule';
import {
  computeCurrentWeekFromSessions,
  sessionIndexFromCompleted,
} from '@/lib/training/mesocycleProgress';
import type { FullProgramRecommendation, MuscleGroup, WorkoutDay } from '@/types/schema';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Where a session sits relative to the user's progress through the block. */
export type PlanSessionStatus = 'done' | 'next' | 'upcoming';

/** Where a week sits relative to the user's progress through the block. */
export type PlanWeekStatus = 'done' | 'current' | 'upcoming';

export interface PlanSessionPreview {
  /** 0-based training-day slot inside its week (0 = first training day). */
  index: number;
  /** Stable key for React lists / expand-collapse state. */
  key: string;
  /** Normalized session (exercise overrides already applied). */
  session: ExtractedSession;
  /**
   * When this session lands: "Mon" for a fixed-weekday schedule, the calendar
   * date ("Aug 10") for an every-N-days one — an interval cadence shifts
   * weekday every week, so a weekday label would be a lie. Null when neither
   * is derivable.
   */
  weekdayLabel: string | null;
  status: PlanSessionStatus;
  /** Planned working sets across the session's exercises. */
  totalSets: number;
  estimatedMinutes: number;
}

export interface MuscleSetCount {
  muscle: MuscleGroup;
  sets: number;
}

export interface PlanWeekPreview {
  weekNumber: number;
  /** Week focus from program_data ("Accumulation", "Deload", …); '' if absent. */
  focus: string;
  isDeload: boolean;
  /** 1.0 = as planned; >1 harder / more volume. */
  intensityModifier: number;
  volumeModifier: number;
  status: PlanWeekStatus;
  sessions: PlanSessionPreview[];
  /** Planned working sets across the whole week. */
  totalSets: number;
  /** Weekly sets per primary muscle, most-trained first. */
  setsByMuscle: MuscleSetCount[];
}

export interface PlanPreviewInput {
  programData: FullProgramRecommendation | null | undefined;
  totalWeeks: number;
  daysPerWeek: number;
  /** 1-based deload week; only used when program_data carries no deload flag. */
  deloadWeek?: number | null;
  preferredWorkoutDays?: WorkoutDay[] | null;
  exerciseOverrides?: ExerciseOverride[] | null;
  /**
   * TOTAL completed sessions for the mesocycle. Picks the slot within the
   * current week, the same way the start path does.
   */
  completedSessions: number;
  /**
   * The mesocycle's stored `current_week`. Start reads the week's exercises
   * from this column, and the completion flow only ever raises it
   * (Math.max(storedWeek, …)), so a block advanced under the old date-based
   * scheme sits at a LATER week than the completed count implies. Omit it and
   * the preview would mark an earlier week current than the one Start serves.
   */
  currentWeek?: number | null;
  /**
   * The block's normalized schedule (buildTrainingSchedule). Only affects how
   * slots are LABELLED: a fixed-day block names the weekday, an every-N-days
   * block names the date its ordinal falls on. Omit for fixed weekdays.
   */
  schedule?: TrainingSchedule | null;
}

/** Planned working sets of a session (falls back to the stored total). */
export function sessionSetCount(session: ExtractedSession): number {
  const fromExercises = session.exercises.reduce((sum, ex) => sum + (ex.sets || 0), 0);
  return fromExercises > 0 ? fromExercises : session.totalSets || 0;
}

/**
 * Weekday labels for a mesocycle's training days, in schedule order —
 * ["Mon", "Wed", "Fri"] for a 3-day week. Session i of a week is planned for
 * label i; sessions beyond the planned day count get null.
 */
export function trainingDayLabels(
  daysPerWeek: number,
  preferredWorkoutDays?: WorkoutDay[] | null
): string[] {
  return getTrainingDays(daysPerWeek, preferredWorkoutDays).map(
    (dayNumber) => WEEKDAY_SHORT[dayNumber - 1] ?? ''
  );
}

/**
 * Label for slot `ordinal` (counted from the block's first session) under an
 * every-N-days schedule: the calendar date that ordinal falls on, since the
 * cadence walks through the week rather than pinning to weekdays. Null when
 * the schedule is missing its interval or anchor.
 */
export function intervalSlotLabel(
  schedule: TrainingSchedule,
  ordinal: number
): string | null {
  if (!schedule.intervalDays || !schedule.anchorDate) return null;
  const anchor = parseLocalDate(schedule.anchorDate);
  if (!anchor) return null;

  const date = new Date(anchor);
  date.setDate(date.getDate() + ordinal * schedule.intervalDays);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Build the read-only week-by-week plan.
 *
 * Returns one entry per programmed week (`totalWeeks`), even when
 * program_data stores fewer weeks — the extra weeks repeat the last stored
 * week, which is what the start path serves once a block runs past its stored
 * weeks. Returns [] when program_data holds no sessions at all (legacy
 * mesocycles built before program_data existed); callers show the
 * "exercises are planned when you start" state for those.
 */
export function buildPlanPreview(input: PlanPreviewInput): PlanWeekPreview[] {
  const {
    programData,
    preferredWorkoutDays,
    exerciseOverrides,
    deloadWeek,
    schedule,
  } = input;

  const totalWeeks = Math.max(1, Math.floor(input.totalWeeks || 1));
  const daysPerWeek = Math.max(1, Math.floor(input.daysPerWeek || 1));
  const completedSessions = Math.max(0, Math.floor(input.completedSessions || 0));
  const overrides = (exerciseOverrides ?? []) as ExerciseOverride[];
  const dayLabels = trainingDayLabels(daysPerWeek, preferredWorkoutDays);

  // Where the user actually is: the stored current_week wins whenever it is
  // ahead of the count-derived week (the completion flow clamps it upward and
  // Start reads it), and the slot inside that week comes from the completed
  // count — exactly the pair startMesocycleSession feeds
  // getSessionFromProgramData.
  const derivedWeek = computeCurrentWeekFromSessions(
    completedSessions,
    daysPerWeek,
    totalWeeks
  ).week;
  const effectiveWeek = Math.min(
    totalWeeks,
    Math.max(1, Math.floor(input.currentWeek || 0), derivedWeek)
  );
  const nextSessionIndex = sessionIndexFromCompleted(completedSessions, daysPerWeek);

  const weeks: PlanWeekPreview[] = [];

  for (let weekNumber = 1; weekNumber <= totalWeeks; weekNumber++) {
    const rawSessions = getWeekSessionsFromProgramData(programData, weekNumber);
    if (rawSessions.length === 0) continue;

    const modifiers = getWeeklyProgressionModifiers(programData, weekNumber);

    // One entry per TRAINING DAY, wrapping into the stored sessions the way
    // getSessionFromProgramData does — a 5-day week over 3 stored sessions
    // really does run sessions 1 and 2 twice.
    const sessions: PlanSessionPreview[] = Array.from({ length: daysPerWeek }, (_, index) => {
      const raw = rawSessions[index % rawSessions.length];
      const session: ExtractedSession = {
        ...raw,
        exercises: applyExerciseOverrides(raw.exercises, overrides),
      };
      const status: PlanSessionStatus =
        weekNumber < effectiveWeek || (weekNumber === effectiveWeek && index < nextSessionIndex)
          ? 'done'
          : weekNumber === effectiveWeek && index === nextSessionIndex
            ? 'next'
            : 'upcoming';

      // Interval blocks count slots continuously from the anchor, so the
      // label comes from the ordinal's date, not the weekday.
      const ordinal = (weekNumber - 1) * daysPerWeek + index;
      const label =
        schedule?.mode === 'interval'
          ? intervalSlotLabel(schedule, ordinal)
          : dayLabels[index] || null;

      return {
        index,
        key: `w${weekNumber}-s${index}`,
        session,
        weekdayLabel: label,
        status,
        totalSets: sessionSetCount(session),
        estimatedMinutes: Math.round(session.estimatedMinutes || 0),
      };
    });

    const setsByMuscle = new Map<MuscleGroup, number>();
    for (const { session } of sessions) {
      for (const exercise of session.exercises) {
        if (!exercise.primaryMuscle) continue;
        setsByMuscle.set(
          exercise.primaryMuscle,
          (setsByMuscle.get(exercise.primaryMuscle) ?? 0) + (exercise.sets || 0)
        );
      }
    }

    weeks.push({
      weekNumber,
      focus: weekFocusFromSessions(rawSessions),
      isDeload:
        rawSessions.some((s) => s.isDeload) ||
        modifiers.isDeload ||
        (deloadWeek ? weekNumber === deloadWeek : weekNumber === totalWeeks),
      intensityModifier: modifiers.intensityModifier,
      volumeModifier: modifiers.volumeModifier,
      status:
        weekNumber < effectiveWeek
          ? 'done'
          : weekNumber === effectiveWeek
            ? 'current'
            : 'upcoming',
      sessions,
      totalSets: sessions.reduce((sum, s) => sum + s.totalSets, 0),
      setsByMuscle: Array.from(setsByMuscle.entries())
        .map(([muscle, sets]) => ({ muscle, sets }))
        .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle)),
    });
  }

  return weeks;
}

/**
 * A week's focus line. program_data stores focus per SESSION ("Push", "Upper
 * A"), and MesocycleWeek.focus ("Accumulation") is not carried through the
 * extraction — so only surface a focus when every session in the week agrees
 * on one, which is how the week-level phase label survives extraction.
 */
function weekFocusFromSessions(sessions: ExtractedSession[]): string {
  const first = sessions[0]?.focus?.trim();
  if (!first) return '';
  return sessions.every((s) => s.focus?.trim() === first) ? first : '';
}

/** The week the user is currently in (falls back to the first week). */
export function currentPlanWeek(weeks: PlanWeekPreview[]): PlanWeekPreview | null {
  if (weeks.length === 0) return null;
  return weeks.find((w) => w.status === 'current') ?? weeks[weeks.length - 1] ?? null;
}

/** The next session Start would launch, across the whole block. */
export function nextPlanSession(weeks: PlanWeekPreview[]): PlanSessionPreview | null {
  for (const week of weeks) {
    const next = week.sessions.find((s) => s.status === 'next');
    if (next) return next;
  }
  return null;
}
