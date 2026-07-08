import {
  applyLocationSubstitutions,
  buildSubstitutedPick,
  countSubstitutions,
  substitutionScore,
  type LocationSubstitutionExercise,
} from '@/services/locationSubstitution';
import { LOCATION_PRESETS, presetUnavailableEquipmentIds } from '@/services/locationProfiles';
import type { SuggestedWorkoutPick, SuggestedWorkoutPlan } from '@/services/suggestedWorkout';

// ============================================================
// Fixtures
// ============================================================

/** The Hotel preset's blocklist: everything except dumbbells + bands. */
const HOTEL_UNAVAILABLE = presetUnavailableEquipmentIds(
  LOCATION_PRESETS.find((p) => p.kind === 'travel')!
);

function ex(overrides: Partial<LocationSubstitutionExercise> & { id: string; name: string }): LocationSubstitutionExercise {
  return {
    primaryMuscle: 'chest',
    secondaryMuscles: [],
    movementPattern: 'horizontal_push',
    mechanic: 'compound',
    tier: 'B',
    equipment: null,
    ...overrides,
  };
}

function pick(exerciseId: string, overrides: Partial<SuggestedWorkoutPick> = {}): SuggestedWorkoutPick {
  return {
    exerciseId,
    muscle: 'chest_upper',
    reason: 'Chest — 4 sets below target this week',
    sets: 4,
    repRange: [6, 10],
    targetRir: 2,
    ...overrides,
  };
}

function plan(picks: SuggestedWorkoutPick[]): SuggestedWorkoutPlan {
  return { exercises: picks, focus: 'Focus: chest', isLightSession: false };
}

const CHEST_MACHINE = ex({
  id: 'chest-machine',
  name: 'Chest Press Machine',
  equipment: 'machine',
});
const DB_PRESS = ex({
  id: 'db-press',
  name: 'Dumbbell Floor Press',
  equipment: 'dumbbell',
  tier: 'A',
});
const PUSH_UP = ex({
  id: 'push-up',
  name: 'Push-Up',
  equipment: 'bodyweight',
});
const BAND_FLY = ex({
  id: 'band-fly',
  name: 'Band Chest Fly',
  equipment: 'resistance band',
  mechanic: 'isolation',
  movementPattern: 'horizontal_push',
});
const ROW_MACHINE = ex({
  id: 'row-machine',
  name: 'Seated Row Machine',
  primaryMuscle: 'lats',
  movementPattern: 'horizontal_pull',
  equipment: 'machine',
});
const DB_ROW = ex({
  id: 'db-row',
  name: 'Dumbbell Row',
  primaryMuscle: 'lats',
  movementPattern: 'horizontal_pull',
  equipment: 'dumbbell',
});

// ============================================================
// applyLocationSubstitutions
// ============================================================

describe('applyLocationSubstitutions', () => {
  it('substitutes machine picks with same-muscle dumbbell/band alternatives at a Hotel profile', () => {
    const result = applyLocationSubstitutions({
      plan: plan([pick('chest-machine'), pick('row-machine', { muscle: 'lats' })]),
      exercises: [CHEST_MACHINE, DB_PRESS, PUSH_UP, BAND_FLY, ROW_MACHINE, DB_ROW],
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });

    expect(result.exercises).toHaveLength(2);
    const [chest, back] = result.exercises;

    // Both swapped, both to available same-muscle work.
    expect(chest.exerciseId).toBe('db-press');
    expect(chest.substitution?.originalExerciseId).toBe('chest-machine');
    expect(chest.substitution?.originalExerciseName).toBe('Chest Press Machine');
    expect(back.exerciseId).toBe('db-row');
    expect(back.substitution?.originalExerciseId).toBe('row-machine');

    // Muscle credit is unchanged — volume accounting stays coherent.
    expect(chest.muscle).toBe('chest_upper');
    expect(back.muscle).toBe('lats');

    expect(countSubstitutions(result)).toBe(2);
  });

  it('offers remaining available candidates as choose-other alternatives', () => {
    const result = applyLocationSubstitutions({
      plan: plan([pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_PRESS, PUSH_UP, BAND_FLY],
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });

    const sub = result.exercises[0].substitution!;
    expect(sub.alternatives).toEqual(expect.arrayContaining(['push-up']));
    expect(sub.alternatives).not.toContain('db-press');
    expect(sub.alternatives).not.toContain('chest-machine');
  });

  it('never silently drops a muscle: bodyweight-only chest falls back to a push-up variant', () => {
    // Location with no chest equipment at all except bodyweight.
    const noChestEquipment = [...HOTEL_UNAVAILABLE, 'dumbbells', 'resistance_bands'];
    const result = applyLocationSubstitutions({
      plan: plan([pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_PRESS, BAND_FLY, PUSH_UP],
      unavailableEquipmentIds: noChestEquipment,
      sessionMinutes: 45,
    });

    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].exerciseId).toBe('push-up');
    expect(result.exercises[0].muscle).toBe('chest_upper');
  });

  it('keeps and flags the pick when no same-muscle substitute exists', () => {
    const result = applyLocationSubstitutions({
      plan: plan([pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_ROW], // no other chest exercise at all
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });

    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].exerciseId).toBe('chest-machine');
    expect(result.exercises[0].noSubstituteAvailable).toBe(true);
    expect(result.exercises[0].substitution).toBeUndefined();
  });

  it('leaves available picks untouched and is a no-op with an empty blocklist', () => {
    const untouched = applyLocationSubstitutions({
      plan: plan([pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_PRESS],
      unavailableEquipmentIds: [],
      sessionMinutes: 45,
    });
    expect(untouched.exercises[0].exerciseId).toBe('chest-machine');
    expect(untouched.exercises[0].substitution).toBeUndefined();

    const mixed = applyLocationSubstitutions({
      plan: plan([pick('db-press'), pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_PRESS, PUSH_UP],
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });
    expect(mixed.exercises[0].exerciseId).toBe('db-press');
    expect(mixed.exercises[0].substitution).toBeUndefined();
  });

  it('does not substitute into an exercise already picked elsewhere in the plan', () => {
    const result = applyLocationSubstitutions({
      plan: plan([pick('db-press'), pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_PRESS, PUSH_UP],
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });

    // db-press already in the plan → machine pick must go to push-up.
    expect(result.exercises[1].exerciseId).toBe('push-up');
  });

  it('does not mutate the input plan (progression isolation at the data level)', () => {
    const original = plan([pick('chest-machine')]);
    applyLocationSubstitutions({
      plan: original,
      exercises: [CHEST_MACHINE, DB_PRESS],
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });

    expect(original.exercises[0].exerciseId).toBe('chest-machine');
    expect((original.exercises[0] as { substitution?: unknown }).substitution).toBeUndefined();
  });

  it('substituted picks carry no load/weight data from the original', () => {
    const result = applyLocationSubstitutions({
      plan: plan([pick('chest-machine')]),
      exercises: [CHEST_MACHINE, DB_PRESS],
      unavailableEquipmentIds: HOTEL_UNAVAILABLE,
      sessionMinutes: 45,
    });

    // The pick identifies the substitute only; weights are seeded later by
    // the estimation engine from the substitute's own name.
    const keys = Object.keys(result.exercises[0]);
    expect(keys).not.toContain('targetWeightKg');
    expect(keys).not.toContain('e1rm');
    expect(result.exercises[0].exerciseId).toBe('db-press');
  });
});

// ============================================================
// Matching & set sizing
// ============================================================

describe('substitutionScore', () => {
  it('prefers same movement pattern and mechanic', () => {
    expect(substitutionScore(CHEST_MACHINE, DB_PRESS)).toBeGreaterThan(
      substitutionScore(CHEST_MACHINE, BAND_FLY)
    );
  });

  it('prefers loaded work over bodyweight when the original was loaded', () => {
    const loadedScore = substitutionScore(CHEST_MACHINE, DB_PRESS);
    const bodyweightScore = substitutionScore(CHEST_MACHINE, {
      ...DB_PRESS,
      id: 'bw-clone',
      equipment: 'bodyweight',
      tier: DB_PRESS.tier,
    });
    expect(loadedScore).toBeGreaterThan(bodyweightScore);
  });
});

describe('buildSubstitutedPick', () => {
  it('keeps the original set count when the mechanic matches', () => {
    const result = buildSubstitutedPick(pick('chest-machine'), CHEST_MACHINE, DB_PRESS, 45, []);
    expect(result.sets).toBe(4);
    expect(result.substitution?.originalSets).toBe(4);
  });

  it('re-sizes sets when the mechanic changes but never above the original (MRV-safe)', () => {
    // Compound → isolation at 45 min: isolation sizing (2) < original (4).
    const toIsolation = buildSubstitutedPick(pick('chest-machine'), CHEST_MACHINE, BAND_FLY, 45, []);
    expect(toIsolation.sets).toBeLessThanOrEqual(4);
    expect(toIsolation.sets).toBe(2);

    // Isolation → compound at 60 min: compound sizing (4) would exceed the
    // original 3 — capped at the original (already MRV-checked) count.
    const isolationPick = pick('band-fly', { sets: 3 });
    const toCompound = buildSubstitutedPick(isolationPick, BAND_FLY, DB_PRESS, 60, []);
    expect(toCompound.sets).toBe(3);
  });

  it('records the original for revert and the alternatives for choose-other', () => {
    const result = buildSubstitutedPick(pick('chest-machine'), CHEST_MACHINE, DB_PRESS, 45, ['push-up']);
    expect(result.substitution).toEqual({
      originalExerciseId: 'chest-machine',
      originalExerciseName: 'Chest Press Machine',
      originalSets: 4,
      alternatives: ['push-up'],
    });
  });
});
