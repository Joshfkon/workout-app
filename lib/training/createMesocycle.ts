/**
 * Mesocycle creation — the canonical "start a new training block" write.
 *
 * The planners this calls are already pure and headless
 * (`services/mesocycleBuilder`); what was missing was the persistence, which
 * lived as ~90 lines inside `handleSubmit` in the mesocycle/new page. That put
 * the very first step of a simulated user's life — create a program — out of
 * reach of anything but a mounted form.
 *
 * Everything here is deliberately dumb about the FORM: the caller decides the
 * split, week count, schedule shape and so on, and hands them over. What lives
 * here is the part that has to be identical whoever is asking:
 *
 *   - deactivating the previous active block (and failing loudly if that write
 *     fails, rather than leaving the user with two active mesocycles);
 *   - reconciling `total_weeks` / `deload_week` against the program actually
 *     generated, so `current_week` indexing can't run off the end;
 *   - the row shape itself, including the schedule columns that
 *     `lib/training/trainingSchedule` later reads back.
 */
import type {
  FullProgramRecommendation,
  RecoveryFactors,
  Split,
  WorkoutDay,
} from '@/types/schema';
import type { MesocycleRecommendation } from '@/services/mesocycleBuilder';
import type { ScheduleMode } from './trainingSchedule';
import { describeSupabaseError } from '@/lib/errors';
import { now as clockNow } from '@/lib/clock';
import { today as clockToday } from '@/lib/clock';

/** Untyped client, matching the convention in the sibling write modules. */
export type MesocycleWriteClient = ReturnType<
  typeof import('@/lib/supabase/client').createUntypedClient
>;

export interface CreateMesocycleInput {
  userId: string;
  /** Blank falls back to "<split> - <date>". */
  name?: string;
  splitType: Split | string;
  /**
   * Planned SESSIONS per week — with two-a-day training this is days x 2 (up
   * to 14), matching the sessions-count convention interval mode set.
   */
  daysPerWeek: number;
  /** Sessions on each training day (1 or 2). Defaults to 1. */
  sessionsPerDay?: number;
  /** Requested length; clamped to the generated program's actual week count. */
  totalWeeks: number;
  scheduleMode: ScheduleMode;
  /** Only meaningful in interval mode; stored as null otherwise. */
  trainingIntervalDays?: number | null;
  /**
   * Kept even in interval mode, so switching back to fixed days restores the
   * user's choice instead of silently re-deriving a default spread.
   */
  preferredWorkoutDays: WorkoutDay[];
  sessionDurationMinutes?: number | null;
  /**
   * The generated program. Its `mesocycleWeeks` are what `total_weeks` and
   * `deload_week` are reconciled against.
   */
  fullProgram: FullProgramRecommendation | null;
  /** Legacy recommendation, used only as a volume-target fallback. */
  recommendation?: Pick<MesocycleRecommendation, 'volumePerMuscle'> | null;
  recoveryFactors?: Pick<RecoveryFactors, 'volumeMultiplier'> | null;
  /**
   * Enhanced Athlete Mode AT GENERATION TIME. In-flight weekly progression
   * follows this tag rather than the live profile flag, so a later toggle
   * really does leave the current block alone.
   */
  enhancedAthleteMode?: boolean;
  /**
   * Local `YYYY-MM-DD` the block starts on — the anchor an interval schedule
   * counts from, so it is load-bearing, not cosmetic. Defaults to today.
   */
  startDate?: string;
}

export interface CreateMesocycleResult {
  mesocycleId: string;
  /** The row as inserted, for callers that want to avoid a re-read. */
  mesocycle: Record<string, unknown>;
  effectiveTotalWeeks: number;
  effectiveDeloadWeek: number;
}

/**
 * Reconcile the requested block length against the program actually generated.
 *
 * A program with fewer weeks than requested would leave `current_week` able to
 * index past the end of `program_data.mesocycleWeeks`, so the program wins. The
 * deload week is the program's marked one when it fits, else the final week.
 * Pure — exported for testing and for previews that want the same numbers
 * before committing.
 */
export function reconcileMesocycleWeeks(
  totalWeeks: number,
  fullProgram: FullProgramRecommendation | null
): { effectiveTotalWeeks: number; effectiveDeloadWeek: number } {
  const programWeekCount = fullProgram?.mesocycleWeeks?.length ?? 0;
  const effectiveTotalWeeks =
    programWeekCount > 0 ? Math.min(totalWeeks, programWeekCount) : totalWeeks;

  const programDeloadWeek = fullProgram?.mesocycleWeeks?.find((w) => w.isDeload)?.weekNumber;
  const effectiveDeloadWeek =
    programDeloadWeek && programDeloadWeek <= effectiveTotalWeeks
      ? programDeloadWeek
      : effectiveTotalWeeks;

  return { effectiveTotalWeeks, effectiveDeloadWeek };
}

/** The `mesocycles` row for a new block. Pure, so the shape is testable. */
export function buildMesocycleRow(
  input: CreateMesocycleInput,
  weeks: { effectiveTotalWeeks: number; effectiveDeloadWeek: number }
): Record<string, unknown> {
  const { fullProgram } = input;

  return {
    user_id: input.userId,
    name: input.name || `${input.splitType} - ${clockNow().toLocaleDateString()}`,
    split_type: input.splitType,
    days_per_week: input.daysPerWeek,
    sessions_per_day: input.sessionsPerDay ?? 1,
    total_weeks: weeks.effectiveTotalWeeks,
    deload_week: weeks.effectiveDeloadWeek,
    current_week: 1,
    state: 'active',
    fatigue_score: 0,
    is_active: true,
    start_date: input.startDate ?? clockToday(),
    // Schedule shape: fixed weekdays, or every-N-days from start_date.
    schedule_mode: input.scheduleMode,
    training_interval_days:
      input.scheduleMode === 'interval' ? input.trainingIntervalDays ?? null : null,
    preferred_workout_days: input.preferredWorkoutDays,
    session_duration_minutes: input.sessionDurationMinutes ?? null,
    periodization_model: fullProgram?.periodization?.model || 'linear',
    program_data: fullProgram,
    fatigue_budget_config: fullProgram?.fatigueBudget || null,
    // Volume targets from the program actually generated, not the legacy rec.
    volume_per_muscle:
      fullProgram?.volumePerMuscle || input.recommendation?.volumePerMuscle || null,
    recovery_multiplier: input.recoveryFactors?.volumeMultiplier || 1.0,
    generated_with_enhanced_mode: input.enhancedAthleteMode ?? false,
  };
}

/**
 * Deactivate the user's current active block(s) and insert the new one.
 *
 * Throws on failure — including on a failed deactivation, which must NOT be
 * swallowed: pressing on would leave two rows with `state: 'active'`, and
 * every "the active mesocycle" read in the app assumes there is exactly one.
 *
 * `describeInsertFailure` lets the UI keep its migration-aware error text
 * (see mesocycle/_lib/mesocycleErrors) without this module depending on it.
 */
export async function createMesocycle(
  supabase: MesocycleWriteClient,
  input: CreateMesocycleInput,
  options?: { describeInsertFailure?: (error: unknown) => string }
): Promise<CreateMesocycleResult> {
  const { error: deactivateError } = await supabase
    .from('mesocycles')
    .update({ state: 'completed', is_active: false })
    .eq('user_id', input.userId)
    .eq('state', 'active');

  if (deactivateError) {
    throw new Error(
      `Couldn't close your current mesocycle: ${describeSupabaseError(deactivateError)}`
    );
  }

  const weeks = reconcileMesocycleWeeks(input.totalWeeks, input.fullProgram);
  const row = buildMesocycleRow(input, weeks);

  const { data: mesocycle, error: insertError } = await supabase
    .from('mesocycles')
    .insert(row)
    .select()
    .single();

  if (insertError || !mesocycle) {
    const describe =
      options?.describeInsertFailure ??
      ((e: unknown) => describeSupabaseError(e, 'Failed to create mesocycle'));
    throw new Error(describe(insertError));
  }

  return { mesocycleId: mesocycle.id, mesocycle, ...weeks };
}
