/**
 * Bootstrap fixtures — the world a simulated user wakes up in.
 *
 * Everything here is data that would already exist before a simulation begins:
 * a user, an exercise catalogue, and the shell of a first session. The Phase 0
 * mutation-boundary audit permits exactly this and no more — no prescription,
 * no progression state, no aggregates. Every number the engine produces during
 * a run still comes from the engine.
 *
 * WORKING WEIGHTS ARE CALIBRATED TO THE PERSONAS ON PURPOSE. `target_weight_kg`
 * sits near 70% of the personas' true starting e1RM, which is where a load for
 * an 8–12 range belongs. An earlier version of this fixture used ~90–100%, and
 * the result was personas logging zero-rep sets and the harness reporting a
 * contract violation that was entirely its own fault. If you change these,
 * change them together with `simulation/personas.DEFAULT_START`.
 */
import { createFakeSupabase, type FakeSupabase } from './fakeSupabase';

export const SIM_USER_ID = 'sim-user';
export const SIM_SESSION_ID = 'sim-session-0000';
export const SIM_MESOCYCLE_ID = 'sim-meso';

export const SIM_EXERCISES = [
  {
    id: 'ex-bench',
    name: 'Barbell Bench Press',
    primary_muscle: 'chest',
    secondary_muscles: ['triceps', 'front_delts'],
    equipment_required: ['barbell'],
    is_bodyweight: false,
    exercise_type: 'rep_based',
    min_weight_increment_kg: 2.5,
    deleted_at: null,
  },
  {
    id: 'ex-row',
    name: 'Barbell Row',
    primary_muscle: 'lats',
    secondary_muscles: ['biceps'],
    equipment_required: ['barbell'],
    is_bodyweight: false,
    exercise_type: 'rep_based',
    min_weight_increment_kg: 2.5,
    deleted_at: null,
  },
];

/** Roughly 70% of the personas' starting e1RM for each lift. */
const WORKING_WEIGHTS: Record<string, number> = {
  'ex-bench': 70, // vs 100 kg true e1RM
  'ex-row': 60, // vs 90 kg true e1RM
};

export interface WorldOptions {
  userId?: string;
  sessionId?: string;
  plannedDate?: string;
  targetSets?: number;
  targetRepRange?: [number, number];
  targetRir?: number;
}

/** A seeded database with one in-progress session of two barbell lifts. */
export function createSimulationWorld(options: WorldOptions = {}): FakeSupabase {
  const userId = options.userId ?? SIM_USER_ID;
  const sessionId = options.sessionId ?? SIM_SESSION_ID;
  const plannedDate = options.plannedDate ?? '2026-04-06';
  const targetSets = options.targetSets ?? 3;
  const targetRepRange = options.targetRepRange ?? [8, 12];
  const targetRir = options.targetRir ?? 2;

  const fake = createFakeSupabase({ userId });

  fake.db.seed('users', [
    {
      id: userId,
      weight_kg: 80,
      height_cm: 178,
      experience: 'intermediate',
      goal: 'bulk',
      preferences: {},
      volume_landmarks: null,
      enhanced_athlete_mode: false,
    },
  ]);
  fake.db.seed('user_profiles', [{ user_id: userId, goal: 'bulk', experience: 'intermediate' }]);
  fake.db.seed('exercises', SIM_EXERCISES);

  // A mesocycle for the sessions to BELONG to.
  //
  // Not decoration: `runPostSessionMesoUpdates` short-circuits on a session
  // with no `mesocycle_id`, so with the sessions unlinked the week advance,
  // the weekly fatigue log and the deload-trigger check never ran even once
  // the harness started finishing sessions properly (Codex review on #609).
  // `current_week` and the fatigue log are then real outputs a run can be
  // asserted against — see `checkMesocycleProgressed`.
  fake.db.seed('mesocycles', [
    {
      id: SIM_MESOCYCLE_ID,
      user_id: userId,
      name: 'Simulation mesocycle',
      split_type: 'upper_lower',
      goal: 'hypertrophy',
      status: 'active',
      total_weeks: 24,
      days_per_week: 3,
      current_week: 1,
      start_date: plannedDate,
      preferred_workout_days: [1, 3, 5],
      schedule_mode: 'fixed_days',
      training_interval_days: null,
      deleted_at: null,
    },
  ]);

  fake.db.seed('workout_sessions', [
    {
      id: sessionId,
      user_id: userId,
      mesocycle_id: SIM_MESOCYCLE_ID,
      state: 'in_progress',
      planned_date: plannedDate,
      started_at: `${plannedDate}T09:00:00.000Z`,
      completed_at: null,
      completion_percent: 0,
      location_id: null,
      is_deload: false,
    },
  ]);

  fake.db.seed(
    'exercise_blocks',
    SIM_EXERCISES.map((exercise, i) => ({
      id: `${sessionId}-blk-${i + 1}`,
      workout_session_id: sessionId,
      exercise_id: exercise.id,
      order: i + 1,
      target_sets: targetSets,
      target_rep_range: targetRepRange,
      target_rir: targetRir,
      target_weight_kg: WORKING_WEIGHTS[exercise.id] ?? 60,
      target_rest_seconds: 180,
      warmup_protocol: { sets: [] },
      suggestion_reason: '',
      skipped_at: null,
    }))
  );

  return fake;
}

/**
 * An in-memory outbox driver.
 *
 * The real one is IndexedDB-backed and module-global; a simulation installs
 * this so runs never share queued writes.
 */
export function createMemoryOutbox() {
  const map = new Map<string, { id: string } & Record<string, unknown>>();
  return {
    put: async (entry: { id: string } & Record<string, unknown>) => {
      map.set(entry.id, { ...entry });
    },
    getAll: async () => Array.from(map.values()),
    delete: async (id: string) => {
      map.delete(id);
    },
    get: async (id: string) => map.get(id),
  };
}
