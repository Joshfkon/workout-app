/**
 * Shared mesocycle fetch for Home and Train pages.
 *
 * Both pages need the full mesocycle row with all fields required by
 * startMesocycleWorkoutSession (program_data, exercise_overrides, deload_week,
 * generated_with_enhanced_mode) to build identical workouts. Using the same
 * query ensures they select the same mesocycle and have the same inputs.
 *
 * Selection: state='active' only (no fallback to is_active or non-completed).
 * Train already did this; Home's fallback could pick a different meso.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkoutDay } from '@/types/schema';

/** Schedule mode from trainingSchedule (re-exported to avoid circular deps). */
export type ScheduleMode = 'fixed_days' | 'interval';

/**
 * The complete active mesocycle row with all fields needed for workout
 * starting and scheduling. Null if no active mesocycle exists.
 */
export interface ActiveMesocycleRow {
  id: string;
  name: string;
  current_week: number;
  total_weeks: number;
  deload_week: number;
  split_type: string;
  days_per_week: number;
  preferred_workout_days: WorkoutDay[] | null;
  schedule_mode: ScheduleMode | null;
  training_interval_days: number | null;
  sessions_per_day: number | null;
  start_date: string;
  program_data: unknown;
  exercise_overrides: unknown[] | null;
  generated_with_enhanced_mode: boolean | null;
}

/**
 * Fetch the active mesocycle for a user with all fields required for starting
 * workouts. Returns null if no active mesocycle exists.
 *
 * Selection rule: Among rows where is_active=true OR state='active', pick the
 * most recently created. This handles users with inconsistent rows (e.g., a
 * newer mesocycle with is_active=true but state='planned', and an older one
 * with state='active'). The newest by created_at is what the user most recently
 * made current, matching their mental model.
 *
 * No user should have multiple current mesocycles (createMesocycle deactivates
 * old ones), but if they do, this picks their most recent intent.
 */
export async function fetchActiveMesocycle(
  supabase: SupabaseClient,
  userId: string
): Promise<ActiveMesocycleRow | null> {
  const { data: rows, error } = await supabase
    .from('mesocycles')
    .select(
      'id, name, current_week, total_weeks, deload_week, split_type, days_per_week, preferred_workout_days, schedule_mode, training_interval_days, sessions_per_day, start_date, program_data, exercise_overrides, generated_with_enhanced_mode, created_at'
    )
    .eq('user_id', userId)
    .or('is_active.eq.true,state.eq.active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch active mesocycle:', error);
    return null;
  }

  // Pick the newest among candidates
  return (rows?.[0] as ActiveMesocycleRow | undefined) ?? null;
}
