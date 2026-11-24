/**
 * Everything the mesocycle builder (/dashboard/mesocycle/new) reads before it
 * can plan: the profile, the latest DEXA scan, unavailable gym equipment,
 * whether this is the first block, the last block's session length, muscle
 * priorities, and recent training (schedule defaults).
 *
 * UX panel r19: "the new mesocycle page loaded slowly". The page used to run
 * these as SEVEN serial round trips after a getUser() call (one of them a
 * server action), setting state after each — and every state change re-ran
 * the full program generator. Now: identity from the local session, all
 * reads in ONE parallel batch, and the page applies the result in one go.
 * Only reads; the builder's program logic is untouched.
 */

import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { now as clockNow } from '@/lib/clock';
import {
  BUILDER_HISTORY_DAYS,
  type MusclePriorityRow,
} from '@/lib/training/builderDefaults';
import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';

export interface BuilderProfileRow {
  goal: string | null;
  experience: string | null;
  height_cm: number | null;
  age: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  training_age: number | null;
  available_equipment: unknown;
  injury_history: unknown;
  enhanced_athlete_mode: boolean | null;
  preferences: unknown;
}

export interface BuilderDexaRow {
  id: string;
  user_id: string;
  scan_date: string;
  weight_kg: number;
  lean_mass_kg: number;
  fat_mass_kg: number;
  body_fat_percent: number;
  bone_mass_kg: number | null;
  regional_data: unknown;
  notes: string | null;
  created_at: string;
}

export interface BuilderInputs {
  userId: string;
  profile: BuilderProfileRow | null;
  latestDexa: BuilderDexaRow | null;
  unavailableEquipmentIds: string[];
  isFirstMesocycle: boolean;
  lastSessionMinutes: number | null;
  priorityRows: MusclePriorityRow[];
  /** Standard muscles trained per recent session, oldest first. */
  recentSessions: StandardMuscleGroup[][];
  /** Days covered by the recent sessions (BUILDER_HISTORY_DAYS with none). */
  historySpanDays: number;
}

type RecentRow = {
  completed_at?: string;
  exercise_blocks?: { exercises?: { primary_muscle?: string | null } | null }[] | null;
};

/** Recent sessions → the muscles each trained, and the span they cover. Pure. */
export function recentTrainingFromRows(
  rows: readonly RecentRow[],
  now: Date
): { sessions: StandardMuscleGroup[][]; spanDays: number } {
  const sessions = rows.map((s) =>
    (s.exercise_blocks ?? []).flatMap((b) => {
      const primary = b.exercises?.primary_muscle;
      const std = primary ? resolveMuscleToStandard(primary)[0] : undefined;
      return std ? [std] : [];
    })
  );
  const firstAt = rows[0]?.completed_at;
  const spanDays = firstAt
    ? Math.ceil((now.getTime() - new Date(firstAt).getTime()) / 86_400_000)
    : BUILDER_HISTORY_DAYS;
  return { sessions, spanDays };
}

export const BUILDER_INPUTS_QUERY_KEY = ['mesocycle-builder', 'inputs'] as const;

/** Null when signed out (middleware owns the redirect). */
export async function fetchBuilderInputs(): Promise<BuilderInputs | null> {
  const supabase = createUntypedClient();
  const userId = await getLocalUserId(supabase);
  if (!userId) return null;

  const at = clockNow();
  const since = new Date(at);
  since.setDate(since.getDate() - BUILDER_HISTORY_DAYS);

  const [profileRes, scanRes, equipmentRes, countRes, lastMesoRes, priorityRes, recentRes] = await Promise.all([
    supabase
      .from('users')
      .select('goal, experience, height_cm, age, sleep_quality, stress_level, training_age, available_equipment, injury_history, enhanced_athlete_mode, preferences')
      .eq('id', userId)
      .single(),
    supabase
      .from('dexa_scans')
      .select('*')
      .eq('user_id', userId)
      .order('scan_date', { ascending: false })
      .limit(1),
    // Same read as lib/actions/equipment fetchUnavailableEquipment, made from
    // the client (RLS-scoped) instead of a server-action round trip.
    supabase
      .from('user_equipment')
      .select('equipment_id')
      .eq('user_id', userId)
      .eq('is_available', false),
    supabase
      .from('mesocycles')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),
    // Session length: the last block's, else by experience.
    supabase
      .from('mesocycles')
      .select('session_duration_minutes')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Muscle priorities from Settings.
    supabase.from('user_muscle_priorities').select('muscle_group, priority').eq('user_id', userId),
    // Recent training → schedule defaults (sessions a week, split).
    supabase
      .from('workout_sessions')
      .select('completed_at, exercise_blocks(exercises(primary_muscle))')
      .eq('user_id', userId)
      .eq('state', 'completed')
      .gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: true }),
  ]);

  // The profile is what the plan is built from: a failed read must not be
  // taken as "no profile" (the query retries; the page falls back to
  // defaults only if it keeps failing). The rest stay best-effort, as before.
  if (profileRes.error && profileRes.error.code !== 'PGRST116') throw profileRes.error;

  const recent = recentTrainingFromRows((recentRes.data ?? []) as RecentRow[], at);
  return {
    userId,
    profile: (profileRes.data ?? null) as BuilderProfileRow | null,
    latestDexa: ((scanRes.data ?? [])[0] ?? null) as BuilderDexaRow | null,
    unavailableEquipmentIds: ((equipmentRes.data ?? []) as { equipment_id: string }[]).map((e) => e.equipment_id),
    // Unknown (failed count) reads as "not the first" — no first-block tips forced.
    isFirstMesocycle: countRes.count === 0,
    lastSessionMinutes:
      (lastMesoRes.data as { session_duration_minutes?: number | null } | null)?.session_duration_minutes ?? null,
    priorityRows: (priorityRes.data ?? []) as MusclePriorityRow[],
    recentSessions: recent.sessions,
    historySpanDays: recent.spanDays,
  };
}
