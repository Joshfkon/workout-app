import {
  buildSuggestedWorkout,
  type BuildSuggestedWorkoutInput,
  type SuggestedExerciseInput,
  type SuggestedMuscleInput,
} from '@/services/suggestedWorkout';
import type { StandardMuscleGroup } from '@/types/schema';

// ============================================================
// Helpers
// ============================================================

let idCounter = 0;

function makeExercise(overrides: Partial<SuggestedExerciseInput> = {}): SuggestedExerciseInput {
  idCounter += 1;
  return {
    id: `ex-${idCounter}`,
    name: `Exercise ${idCounter}`,
    primaryMuscle: 'chest_upper',
    tier: 'B',
    mechanic: 'compound',
    ...overrides,
  };
}

function makeMuscle(
  muscle: StandardMuscleGroup,
  overrides: Partial<SuggestedMuscleInput> = {}
): SuggestedMuscleInput {
  return {
    muscle,
    recoveryStatus: 'ready',
    weeklySets: 0,
    targetSets: 10,
    ...overrides,
  };
}

function build(input: Partial<BuildSuggestedWorkoutInput>): ReturnType<typeof buildSuggestedWorkout> {
  return buildSuggestedWorkout({
    muscles: [],
    exercises: [],
    recentExerciseIds: [],
    ...input,
  });
}

/** A small library with staples across the major full-body groups. */
function fullBodyLibrary(): SuggestedExerciseInput[] {
  return [
    makeExercise({ id: 'bench', name: 'Bench Press', primaryMuscle: 'chest', tier: 'S' }),
    makeExercise({ id: 'row', name: 'Barbell Row', primaryMuscle: 'back', tier: 'S' }),
    makeExercise({ id: 'squat', name: 'Squat', primaryMuscle: 'quads', tier: 'S' }),
    makeExercise({ id: 'ohp', name: 'Overhead Press', primaryMuscle: 'shoulders', tier: 'A' }),
    makeExercise({ id: 'rdl', name: 'Romanian Deadlift', primaryMuscle: 'hamstrings', tier: 'S' }),
    makeExercise({
      id: 'curl',
      name: 'Barbell Curl',
      primaryMuscle: 'biceps',
      tier: 'A',
      mechanic: 'isolation',
    }),
    makeExercise({
      id: 'pushdown',
      name: 'Triceps Pushdown',
      primaryMuscle: 'triceps',
      tier: 'A',
      mechanic: 'isolation',
    }),
    makeExercise({ id: 'hipthrust', name: 'Hip Thrust', primaryMuscle: 'glutes', tier: 'S' }),
  ];
}

beforeEach(() => {
  idCounter = 0;
});

// ============================================================
// Ready vs sore gating
// ============================================================

describe('recovery gating', () => {
  it('never picks a sore muscle, even with the largest deficit', () => {
    const plan = build({
      muscles: [
        makeMuscle('quads', { recoveryStatus: 'sore', weeklySets: 0, targetSets: 20 }),
        makeMuscle('biceps', { recoveryStatus: 'ready', weeklySets: 5, targetSets: 8 }),
      ],
      exercises: [
        makeExercise({ id: 'squat', primaryMuscle: 'quads' }),
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      ],
    });

    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(plan.exercises.every((p) => p.muscle === 'biceps')).toBe(true);
  });

  it('ranks ready muscles ahead of recovering muscles regardless of deficit', () => {
    const plan = build({
      muscles: [
        makeMuscle('lats', { recoveryStatus: 'recovering', weeklySets: 0, targetSets: 20 }),
        makeMuscle('biceps', { recoveryStatus: 'ready', weeklySets: 7, targetSets: 8 }),
      ],
      exercises: [
        makeExercise({ id: 'pulldown', primaryMuscle: 'lats' }),
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      ],
      maxExercises: 1,
    });

    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0].muscle).toBe('biceps');
  });

  it('still includes recovering muscles when there is room, with a reason noting recovery', () => {
    const plan = build({
      muscles: [
        makeMuscle('biceps', { recoveryStatus: 'ready', weeklySets: 5, targetSets: 8 }),
        makeMuscle('lats', { recoveryStatus: 'recovering', weeklySets: 2, targetSets: 16 }),
      ],
      exercises: [
        makeExercise({ id: 'pulldown', primaryMuscle: 'lats' }),
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      ],
    });

    const latPick = plan.exercises.find((p) => p.muscle === 'lats');
    expect(latPick).toBeDefined();
    expect(latPick?.reason).toContain('almost recovered');
  });
});

// ============================================================
// Deficit ranking
// ============================================================

describe('deficit ranking', () => {
  it('prioritizes the muscle furthest below target', () => {
    const plan = build({
      muscles: [
        makeMuscle('biceps', { weeklySets: 7, targetSets: 8 }), // deficit 1
        makeMuscle('lateral_delts', { weeklySets: 1, targetSets: 12 }), // deficit 11
      ],
      exercises: [
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
        makeExercise({ id: 'raise', primaryMuscle: 'lateral_delts', mechanic: 'isolation' }),
      ],
      maxExercises: 1,
    });

    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0].muscle).toBe('lateral_delts');
    expect(plan.exercises[0].reason).toContain('11 sets below target this week');
  });

  it('skips muscles already at or over target', () => {
    const plan = build({
      muscles: [
        makeMuscle('quads', { weeklySets: 12, targetSets: 10 }), // over target
        makeMuscle('chest_upper', { weeklySets: 10, targetSets: 10 }), // at target
        makeMuscle('biceps', { weeklySets: 2, targetSets: 8 }),
      ],
      exercises: [
        makeExercise({ id: 'squat', primaryMuscle: 'quads' }),
        makeExercise({ id: 'incline', primaryMuscle: 'chest_upper' }),
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      ],
    });

    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(plan.exercises.every((p) => p.muscle === 'biceps')).toBe(true);
  });

  it('mentions the top muscles in the focus sentence', () => {
    const plan = build({
      muscles: [
        makeMuscle('lateral_delts', { weeklySets: 0, targetSets: 12 }),
        makeMuscle('lats', { weeklySets: 2, targetSets: 12 }),
      ],
      exercises: [
        makeExercise({ id: 'raise', primaryMuscle: 'lateral_delts', mechanic: 'isolation' }),
        makeExercise({ id: 'pulldown', primaryMuscle: 'lats' }),
      ],
    });

    expect(plan.focus).toContain('Focus:');
    expect(plan.focus.toLowerCase()).toContain('side delts');
    expect(plan.focus.toLowerCase()).toContain('lats');
  });
});

// ============================================================
// Exercise preference: recents over staples
// ============================================================

describe('exercise preference', () => {
  it('prefers a recently used exercise over a higher-tier staple', () => {
    // 'machine-press' is C tier (not a staple pick over the S tier) but the
    // user did it recently; 'bench' is the S-tier staple.
    const exercises = [
      makeExercise({ id: 'bench', name: 'Bench Press', primaryMuscle: 'chest_upper', tier: 'S' }),
      makeExercise({
        id: 'machine-press',
        name: 'Machine Press',
        primaryMuscle: 'chest_upper',
        tier: 'C',
      }),
    ];
    const plan = build({
      muscles: [makeMuscle('chest_upper', { weeklySets: 0, targetSets: 10 })],
      exercises,
      recentExerciseIds: ['machine-press'],
      maxExercises: 1,
    });

    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0].exerciseId).toBe('machine-press');
  });

  it('falls back to staple tier order when nothing is recent', () => {
    const exercises = [
      makeExercise({ id: 'flye', name: 'Cable Flye', primaryMuscle: 'chest_upper', tier: 'B', mechanic: 'isolation' }),
      makeExercise({ id: 'bench', name: 'Bench Press', primaryMuscle: 'chest_upper', tier: 'S' }),
    ];
    const plan = build({
      muscles: [makeMuscle('chest_upper', { weeklySets: 0, targetSets: 10 })],
      exercises,
      recentExerciseIds: [],
      maxExercises: 1,
    });

    expect(plan.exercises[0].exerciseId).toBe('bench');
  });

  it('matches legacy-tagged exercises to standard muscle targets', () => {
    // Exercise tagged with legacy 'chest' should satisfy a chest_upper target.
    const plan = build({
      muscles: [makeMuscle('chest_upper', { weeklySets: 0, targetSets: 10 })],
      exercises: [makeExercise({ id: 'bench', primaryMuscle: 'chest' })],
      maxExercises: 1,
    });

    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0].exerciseId).toBe('bench');
  });

  it('orders compounds before isolations in the final plan', () => {
    const plan = build({
      muscles: [
        makeMuscle('biceps', { weeklySets: 0, targetSets: 12 }),
        makeMuscle('lats', { weeklySets: 0, targetSets: 10 }),
      ],
      exercises: [
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
        makeExercise({ id: 'pulldown', primaryMuscle: 'lats', mechanic: 'compound' }),
      ],
    });

    expect(plan.exercises.length).toBe(2);
    expect(plan.exercises[0].exerciseId).toBe('pulldown');
    expect(plan.exercises[1].exerciseId).toBe('curl');
  });
});

// ============================================================
// Caps
// ============================================================

describe('caps', () => {
  it('caps at 6 exercises by default and at most 2 per muscle', () => {
    const muscles: SuggestedMuscleInput[] = [
      makeMuscle('chest_upper', { weeklySets: 0, targetSets: 20 }),
      makeMuscle('lats', { weeklySets: 0, targetSets: 18 }),
      makeMuscle('quads', { weeklySets: 0, targetSets: 16 }),
      makeMuscle('biceps', { weeklySets: 0, targetSets: 14 }),
      makeMuscle('triceps', { weeklySets: 0, targetSets: 12 }),
    ];
    // 4 exercises per muscle available
    const exercises = muscles.flatMap((m) =>
      Array.from({ length: 4 }, () => makeExercise({ primaryMuscle: m.muscle }))
    );

    const plan = build({ muscles, exercises });

    expect(plan.exercises).toHaveLength(6);
    const perMuscle = new Map<string, number>();
    plan.exercises.forEach((p) => perMuscle.set(p.muscle, (perMuscle.get(p.muscle) ?? 0) + 1));
    perMuscle.forEach((count) => expect(count).toBeLessThanOrEqual(2));
    // Only the top 4 muscles are used; triceps (smallest deficit) is left out.
    expect(plan.exercises.some((p) => p.muscle === 'triceps')).toBe(false);
  });

  it('respects a custom maxExercises', () => {
    const muscles: SuggestedMuscleInput[] = [
      makeMuscle('chest_upper', { weeklySets: 0, targetSets: 20 }),
      makeMuscle('lats', { weeklySets: 0, targetSets: 18 }),
    ];
    const exercises = muscles.flatMap((m) =>
      Array.from({ length: 3 }, () => makeExercise({ primaryMuscle: m.muscle }))
    );

    const plan = build({ muscles, exercises, maxExercises: 3 });
    expect(plan.exercises).toHaveLength(3);
  });

  it('does not duplicate an exercise across picks', () => {
    const plan = build({
      muscles: [makeMuscle('chest_upper', { weeklySets: 0, targetSets: 20 })],
      exercises: [makeExercise({ id: 'bench', primaryMuscle: 'chest_upper' })],
    });

    expect(plan.exercises).toHaveLength(1);
  });
});

// ============================================================
// Empty-data fallback
// ============================================================

describe('empty-data fallback', () => {
  it('builds a balanced full-body pick from staples when there is no muscle data', () => {
    const plan = build({ muscles: [], exercises: fullBodyLibrary() });

    expect(plan.exercises).toHaveLength(6);
    expect(plan.focus.toLowerCase()).toContain('full body');
    // Balanced: no muscle appears twice before others appear once.
    const muscleCounts = new Map<string, number>();
    plan.exercises.forEach((p) =>
      muscleCounts.set(p.muscle, (muscleCounts.get(p.muscle) ?? 0) + 1)
    );
    muscleCounts.forEach((count) => expect(count).toBeLessThanOrEqual(1));
    plan.exercises.forEach((p) => expect(p.reason.length).toBeGreaterThan(0));
  });

  it('falls back to full body when every muscle is sore or at target', () => {
    const plan = build({
      muscles: [
        makeMuscle('quads', { recoveryStatus: 'sore', weeklySets: 0, targetSets: 20 }),
        makeMuscle('chest_upper', { weeklySets: 10, targetSets: 10 }),
      ],
      exercises: fullBodyLibrary(),
    });

    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(plan.focus.toLowerCase()).toContain('full body');
  });

  it('falls back to full body when ranked muscles have no matching exercises', () => {
    const plan = build({
      muscles: [makeMuscle('erectors', { weeklySets: 0, targetSets: 10 })],
      exercises: fullBodyLibrary(),
    });

    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(plan.focus.toLowerCase()).toContain('full body');
  });

  it('returns an empty plan with a message when there are no exercises at all', () => {
    const plan = build({ muscles: [], exercises: [] });

    expect(plan.exercises).toHaveLength(0);
    expect(plan.focus).toBe('No exercises available to suggest.');
  });
});
