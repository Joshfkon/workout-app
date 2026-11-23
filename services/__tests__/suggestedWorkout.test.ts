import {
  buildSuggestedWorkout,
  suggestedOrderLine,
  injuryAreasPhrase,
  injuryPickLine,
  injuryPlanLine,
  injuryNoteFromReason,
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
    expect(plan.exercises[0].reason).toMatch(/^Side Delts: \d+(\.\d)? of \d+(\.\d)? weekly sets done$/);
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

    expect(plan.focus).toContain('Today:');
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

// ============================================================
// Guardrails: MRV cap, light session, injuries, joint stress,
// equipment, set/rep/RIR targets, determinism
// ============================================================

describe('MRV cap', () => {
  it('caps a pick to the muscle&apos;s remaining weekly MRV headroom', () => {
    const plan = build({
      muscles: [
        // deficit 4 (below MAV target) but only 2 sets of MRV headroom left
        makeMuscle('biceps', { weeklySets: 8, targetSets: 12, mrvSets: 10 }),
      ],
      exercises: [
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
        makeExercise({ id: 'hammer', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      ],
    });

    const totalSets = plan.exercises.reduce((sum, p) => sum + p.sets, 0);
    expect(totalSets).toBeLessThanOrEqual(2); // 10 MRV - 8 done
    expect(plan.exercises.length).toBeGreaterThan(0);
  });

  it('never lets the sum of suggested sets push a muscle past MRV across picks', () => {
    const plan = build({
      muscles: [makeMuscle('lats', { weeklySets: 10, targetSets: 18, mrvSets: 15 })],
      exercises: [
        makeExercise({ id: 'pulldown', primaryMuscle: 'lats' }),
        makeExercise({ id: 'row', primaryMuscle: 'lats' }),
        makeExercise({ id: 'pullover', primaryMuscle: 'lats', mechanic: 'isolation' }),
      ],
    });

    const totalSets = plan.exercises.reduce((sum, p) => sum + p.sets, 0);
    expect(totalSets).toBeLessThanOrEqual(5); // 15 MRV - 10 done
  });

  it('emits a light technique session when every under-target muscle is out of headroom', () => {
    const plan = build({
      muscles: [
        makeMuscle('biceps', { weeklySets: 9, targetSets: 10, mrvSets: 10 }), // headroom 1
        makeMuscle('triceps', { weeklySets: 11, targetSets: 12, mrvSets: 12 }), // headroom 1
      ],
      exercises: [
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
        makeExercise({ id: 'pushdown', primaryMuscle: 'triceps', mechanic: 'isolation' }),
      ],
    });

    expect(plan.isLightSession).toBe(true);
    expect(plan.focus.toLowerCase()).toContain('light');
    plan.exercises.forEach((p) => {
      expect(p.sets).toBeLessThanOrEqual(1); // capped by 1 set of headroom
      expect(p.targetRir).toBeGreaterThanOrEqual(3); // technique work, far from failure
    });
  });

  it('says so even when there is zero headroom anywhere', () => {
    const plan = build({
      muscles: [makeMuscle('biceps', { weeklySets: 10, targetSets: 12, mrvSets: 10 })],
      exercises: [makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' })],
    });

    expect(plan.isLightSession).toBe(true);
    expect(plan.exercises).toHaveLength(0);
    expect(plan.focus.toLowerCase()).toContain('mrv');
  });
});

describe('injury exclusion (mesocycle generator rule)', () => {
  it('never suggests a muscle whose legacy group is injury-flagged', () => {
    const plan = build({
      muscles: [
        makeMuscle('lateral_delts', { weeklySets: 0, targetSets: 12 }),
        makeMuscle('biceps', { weeklySets: 2, targetSets: 8 }),
      ],
      exercises: [
        makeExercise({ id: 'raise', primaryMuscle: 'lateral_delts', mechanic: 'isolation' }),
        makeExercise({ id: 'curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      ],
      injuredMuscles: ['shoulders'],
    });

    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(plan.exercises.every((p) => p.muscle === 'biceps')).toBe(true);
  });

  it('keeps injured muscles out of the full-body fallback too', () => {
    const plan = build({
      muscles: [],
      exercises: fullBodyLibrary(),
      injuredMuscles: ['quads'],
    });

    expect(plan.exercises.length).toBeGreaterThan(0);
    expect(plan.exercises.some((p) => p.muscle === 'quads')).toBe(false);
  });
});

describe('joint-stress RIR floor', () => {
  it('floors a heavy barbell compound at RIR 2 even when the library default is lower', () => {
    const plan = build({
      muscles: [makeMuscle('chest_upper', { weeklySets: 0, targetSets: 10 })],
      exercises: [
        makeExercise({
          id: 'bench',
          name: 'Barbell Bench Press',
          primaryMuscle: 'chest_upper',
          defaultRir: 0,
        }),
      ],
      maxExercises: 1,
    });

    expect(plan.exercises[0].targetRir).toBeGreaterThanOrEqual(2);
  });

  it('leaves machine work free to go near failure', () => {
    const plan = build({
      muscles: [makeMuscle('chest_upper', { weeklySets: 0, targetSets: 10 })],
      exercises: [
        makeExercise({
          id: 'machine-press',
          name: 'Machine Chest Press',
          primaryMuscle: 'chest_upper',
          defaultRir: 0,
        }),
      ],
      maxExercises: 1,
    });

    expect(plan.exercises[0].targetRir).toBe(0);
  });
});

describe('equipment filter', () => {
  it('skips exercises that need unavailable equipment', () => {
    const plan = build({
      muscles: [makeMuscle('biceps', { weeklySets: 0, targetSets: 10 })],
      exercises: [
        makeExercise({
          id: 'bb-curl',
          name: 'Barbell Curl',
          primaryMuscle: 'biceps',
          tier: 'S',
          mechanic: 'isolation',
          equipment: ['barbell'],
        }),
        makeExercise({
          id: 'cable-curl',
          name: 'Cable Curl',
          primaryMuscle: 'biceps',
          tier: 'B',
          mechanic: 'isolation',
          equipment: ['cable machine'],
        }),
      ],
      unavailableEquipmentIds: ['barbell'],
      maxExercises: 1,
    });

    expect(plan.exercises).toHaveLength(1);
    expect(plan.exercises[0].exerciseId).toBe('cable-curl');
  });

  it('fails closed: untagged non-bodyweight exercises are excluded when a blocklist exists', () => {
    const plan = build({
      muscles: [makeMuscle('biceps', { weeklySets: 0, targetSets: 10 })],
      exercises: [
        makeExercise({
          id: 'mystery-curl',
          name: 'Mystery Curl',
          primaryMuscle: 'biceps',
          tier: 'S',
          mechanic: 'isolation',
          // no equipment tags, not bodyweight
        }),
        makeExercise({
          id: 'bw-chin-curl',
          name: 'Towel Curl',
          primaryMuscle: 'biceps',
          tier: 'C',
          mechanic: 'isolation',
          isBodyweight: true,
        }),
      ],
      unavailableEquipmentIds: ['barbell'],
      maxExercises: 2,
    });

    expect(plan.exercises.map((p) => p.exerciseId)).toEqual(['bw-chin-curl']);
  });
});

describe('set/rep/RIR targets', () => {
  it('every pick carries sets, a rep range, and a target RIR', () => {
    const plan = build({
      muscles: [makeMuscle('lats', { weeklySets: 0, targetSets: 12 })],
      exercises: [makeExercise({ id: 'pulldown', primaryMuscle: 'lats' })],
    });

    plan.exercises.forEach((p) => {
      expect(p.sets).toBeGreaterThanOrEqual(2);
      expect(p.repRange[0]).toBeLessThanOrEqual(p.repRange[1]);
      expect(p.targetRir).toBeGreaterThanOrEqual(0);
    });
  });

  it('scales set targets down for short sessions', () => {
    const short = build({
      muscles: [makeMuscle('lats', { weeklySets: 0, targetSets: 12 })],
      exercises: [makeExercise({ id: 'pulldown', primaryMuscle: 'lats' })],
      sessionMinutes: 30,
      maxExercises: 1,
    });
    const long = build({
      muscles: [makeMuscle('lats', { weeklySets: 0, targetSets: 12 })],
      exercises: [makeExercise({ id: 'pulldown', primaryMuscle: 'lats' })],
      sessionMinutes: 90,
      maxExercises: 1,
    });

    expect(short.exercises[0].sets).toBeLessThan(long.exercises[0].sets);
  });

  it('uses the library rep range and default RIR when present', () => {
    const plan = build({
      muscles: [makeMuscle('lats', { weeklySets: 0, targetSets: 12 })],
      exercises: [
        makeExercise({
          id: 'pulldown',
          name: 'Lat Pulldown',
          primaryMuscle: 'lats',
          defaultRepRange: [8, 12],
          defaultRir: 1,
        }),
      ],
      maxExercises: 1,
    });

    expect(plan.exercises[0].repRange).toEqual([8, 12]);
    expect(plan.exercises[0].targetRir).toBe(1); // pulldown is a safe pattern, no floor bump
  });
});

describe('determinism', () => {
  it('produces an identical plan for identical inputs', () => {
    const input: BuildSuggestedWorkoutInput = {
      muscles: [
        makeMuscle('chest_upper', { weeklySets: 3, targetSets: 12, mrvSets: 18 }),
        makeMuscle('lats', { weeklySets: 5, targetSets: 14, mrvSets: 20 }),
        makeMuscle('biceps', { weeklySets: 1, targetSets: 10, mrvSets: 14 }),
      ],
      exercises: fullBodyLibrary(),
      recentExerciseIds: ['row'],
      sessionMinutes: 45,
    };

    const a = buildSuggestedWorkout(input);
    const b = buildSuggestedWorkout(input);
    expect(a).toEqual(b);
  });
});

// ============================================================
// Focus header vs. exercise list (synthetic-panel finding, 2026-11-22)
// ============================================================

describe('focus matches the picked exercises', () => {
  /**
   * The panel's returning user: recovery/volume report the COARSE 'calves'
   * and 'triceps' rows, while the library tags calf and triceps work at head
   * grain (gastrocnemius / soleus / triceps_lat_med / triceps_long). The
   * header said "calves, side delts and triceps" over a list of Upright Row,
   * Overhead Carry and two squats.
   */
  function panelLibrary(): SuggestedExerciseInput[] {
    return [
      makeExercise({ id: 'upright', name: 'Upright Row', primaryMuscle: 'lateral_delts', tier: 'B', defaultRepRange: [10, 15] }),
      makeExercise({ id: 'latraise', name: 'Lateral Raise', primaryMuscle: 'lateral_delts', tier: 'C', mechanic: 'isolation' }),
      makeExercise({
        id: 'ohcarry',
        name: 'Overhead Carry',
        primaryMuscle: 'shoulders',
        tier: 'C',
        defaultRepRange: [30, 60],
        exerciseType: 'duration_based',
      }),
      makeExercise({ id: 'squat', name: 'Barbell Back Squat', primaryMuscle: 'quads', tier: 'C' }),
      makeExercise({ id: 'pendulum', name: 'Pendulum Squat', primaryMuscle: 'quads', tier: 'S' }),
      makeExercise({ id: 'calfraise', name: 'Standing Calf Raise', primaryMuscle: 'gastrocnemius', tier: 'C', mechanic: 'isolation' }),
      makeExercise({ id: 'seatedcalf', name: 'Seated Calf Raise', primaryMuscle: 'soleus', tier: 'C', mechanic: 'isolation' }),
      makeExercise({ id: 'pushdown', name: 'Rope Tricep Pushdown', primaryMuscle: 'triceps_lat_med', tier: 'A', mechanic: 'isolation' }),
      makeExercise({ id: 'ohext', name: 'Overhead Tricep Extension', primaryMuscle: 'triceps_long', tier: 'C', mechanic: 'isolation' }),
    ];
  }

  const panelMuscles = [
    makeMuscle('calves', { targetSets: 14 }),
    makeMuscle('lateral_delts', { targetSets: 13 }),
    makeMuscle('triceps', { targetSets: 12 }),
    makeMuscle('quads', { targetSets: 11 }),
  ];

  it('trains a coarse parent muscle with exercises tagged at its heads', () => {
    const plan = build({ muscles: panelMuscles, exercises: panelLibrary(), sessionMinutes: 45, maxExercises: 4 });
    const ids = plan.exercises.map((p) => p.exerciseId);
    expect(ids.some((id) => id === 'calfraise' || id === 'seatedcalf')).toBe(true);
    expect(ids.some((id) => id === 'pushdown' || id === 'ohext')).toBe(true);
    expect(plan.exercises.find((p) => p.exerciseId === 'calfraise' || p.exerciseId === 'seatedcalf')?.muscle).toBe('calves');
  });

  it('names every trained muscle and no others in the focus sentence (panel library)', () => {
    const plan = build({ muscles: panelMuscles, exercises: panelLibrary(), sessionMinutes: 45, maxExercises: 4 });
    expect(new Set(plan.exercises.map((p) => p.muscle))).toEqual(
      new Set(['calves', 'lateral_delts', 'triceps', 'quads'])
    );
    expect(plan.focus).toBe(
      "Today: calves, side delts, triceps and quads — rested, and furthest behind on this week's sets."
    );
  });

  it('names only muscles that have a pick in the focus sentence', () => {
    // No calf work in the library at all: calves must drop out of the header.
    const library = panelLibrary().filter((ex) => !['calfraise', 'seatedcalf'].includes(ex.id));
    const plan = build({ muscles: panelMuscles, exercises: library, sessionMinutes: 45, maxExercises: 4 });
    const pickedMuscles = new Set(plan.exercises.map((p) => p.muscle));
    expect(pickedMuscles.has('calves')).toBe(false);
    expect(plan.focus).not.toMatch(/calves/i);
    for (const m of Array.from(pickedMuscles)) {
      // Every muscle the header names has at least one exercise.
      expect(plan.focus.toLowerCase()).toContain(
        ({ lateral_delts: 'side delts', triceps: 'triceps', quads: 'quads' } as Record<string, string>)[m] ?? m
      );
    }
  });

  it('prefers rep-based work over a timed carry for a hypertrophy pick', () => {
    const plan = build({ muscles: [makeMuscle('lateral_delts')], exercises: panelLibrary() });
    const ids = plan.exercises.map((p) => p.exerciseId);
    expect(ids).toContain('upright');
    expect(ids).toContain('latraise');
    expect(ids).not.toContain('ohcarry');
  });

  it('lists one member of a parent/head family, not calves AND gastrocnemius', () => {
    const plan = build({
      muscles: [makeMuscle('calves', { targetSets: 14 }), makeMuscle('gastrocnemius'), makeMuscle('soleus'), makeMuscle('quads')],
      exercises: panelLibrary(),
    });
    expect(plan.focus).toBe("Today: calves and quads — rested, and furthest behind on this week's sets.");
  });
});

describe('standing-injury safety', () => {
  const muscles = [makeMuscle('lateral_delts', { weeklySets: 0, targetSets: 12 })];
  const exercises = [
    makeExercise({ id: 'upright', name: 'Upright Row', primaryMuscle: 'lateral_delts', mechanic: 'compound', tier: 'A' }),
    makeExercise({ id: 'raise', name: 'Lateral Raise', primaryMuscle: 'lateral_delts', mechanic: 'isolation', tier: 'B' }),
  ];

  it('ranks a caution lift behind a safe alternative for the same muscle', () => {
    const plain = build({ muscles, exercises, maxExercises: 1 });
    expect(plain.exercises[0].exerciseId).toBe('upright'); // compound, higher tier wins normally
    const plan = build({ muscles, exercises, maxExercises: 1, cautionExerciseIds: ['upright'] });
    expect(plan.exercises[0].exerciseId).toBe('raise');
  });

  it('never picks an avoid lift', () => {
    const plan = build({ muscles, exercises, avoidExerciseIds: new Set(['upright']) });
    expect(plan.exercises.map((p) => p.exerciseId)).not.toContain('upright');
  });

  // UX panel round 19 (returning lifter, shoulder): say what the injury
  // check changed, per pick. Metadata only — the picks are unchanged.
  it('notes which lift a pick replaced, without changing the pick', () => {
    const without = build({ muscles, exercises, maxExercises: 1 });
    expect(without.exercises[0].injury).toBeUndefined();
    const plan = build({ muscles, exercises, maxExercises: 1, avoidExerciseIds: ['upright'] });
    expect(plan.exercises[0].exerciseId).toBe('raise');
    expect(plan.exercises[0].injury).toEqual({ kind: 'instead_of', pickedId: 'raise', insteadOfId: 'upright' });
    // Same numbers as before the note existed.
    const { injury: _ignored, ...rest } = plan.exercises[0];
    const fromCaution = build({ muscles, exercises, maxExercises: 1, cautionExerciseIds: ['upright'] }).exercises[0];
    expect(fromCaution.injury).toEqual({ kind: 'instead_of', pickedId: 'raise', insteadOfId: 'upright' });
    const { injury: _ignored2, ...restCaution } = fromCaution;
    expect(rest).toEqual(restCaution);
  });

  it('notes a pick that is itself rated caution (no safe alternative)', () => {
    const plan = build({ muscles, exercises: [exercises[0]], cautionExerciseIds: ['upright'] });
    expect(plan.exercises[0].injury).toEqual({ kind: 'caution', pickedId: 'upright' });
  });

  it('adds no note when the injury check changed nothing', () => {
    const plan = build({ muscles, exercises, maxExercises: 1, avoidExerciseIds: ['some-other-lift'] });
    expect(plan.exercises[0].exerciseId).toBe('upright');
    expect(plan.exercises[0].injury).toBeUndefined();
  });
});

describe('injury copy', () => {
  const nameOf = (id: string) => ({ upright: 'Upright Row', ohp: 'Overhead Press' })[id];

  it('injuryAreasPhrase', () => {
    expect(injuryAreasPhrase([])).toBeNull();
    expect(injuryAreasPhrase(['Shoulder'])).toBe('your shoulder');
    expect(injuryAreasPhrase(['Shoulder', 'Knee'])).toBe('your shoulder and knee');
    expect(injuryAreasPhrase(['Shoulder', 'Lower back', 'Hip'])).toBe('your shoulder, lower back and hip');
  });

  it('injuryPickLine', () => {
    const areas = 'your shoulder';
    expect(injuryPickLine({ kind: 'instead_of', pickedId: 'raise', insteadOfId: 'upright' }, 'raise', areas, nameOf)).toBe(
      'For your shoulder: picked instead of Upright Row'
    );
    expect(injuryPickLine({ kind: 'caution', pickedId: 'upright' }, 'upright', areas, nameOf)).toBe(
      'For your shoulder: go light, stop if it hurts'
    );
    // Swapped since the note was written: the note does not follow.
    expect(injuryPickLine({ kind: 'caution', pickedId: 'upright' }, 'raise', areas, nameOf)).toBeNull();
    expect(injuryPickLine(undefined, 'raise', areas, nameOf)).toBeNull();
    expect(injuryPickLine({ kind: 'caution', pickedId: 'upright' }, 'upright', null, nameOf)).toBeNull();
  });

  it('injuryPlanLine answers "does it account for my shoulder?" either way', () => {
    expect(injuryPlanLine([{ exerciseId: 'raise' }], null)).toBeNull();
    expect(injuryPlanLine([{ exerciseId: 'raise' }], 'your shoulder')).toBe(
      'Planned around your shoulder: lifts that strain it are left out, and none of today’s picks needed changing.'
    );
    expect(
      injuryPlanLine(
        [
          { exerciseId: 'raise', injury: { kind: 'instead_of', pickedId: 'raise', insteadOfId: 'upright' } },
          { exerciseId: 'press', injury: { kind: 'caution', pickedId: 'press' } },
        ],
        'your shoulder'
      )
    ).toBe('Planned around your shoulder: lifts that strain it are left out — 1 lift swapped for one easier on it, 1 to take carefully.');
  });

  it('injuryNoteFromReason reads the line back off a started block', () => {
    expect(injuryNoteFromReason('Side Delts: 0 of 12 weekly sets done · For your shoulder: picked instead of Upright Row')).toBe(
      'For your shoulder: picked instead of Upright Row'
    );
    expect(
      injuryNoteFromReason(
        'Side Delts: 0 of 12 weekly sets done ↔ Swapped from X (equipment) · For your shoulder: go light, stop if it hurts'
      )
    ).toBe('For your shoulder: go light, stop if it hurts');
    expect(injuryNoteFromReason('Side Delts: 0 of 12 weekly sets done')).toBeNull();
    expect(injuryNoteFromReason(null)).toBeNull();
  });
});

describe('order line (why this exercise first)', () => {
  it('a ranked plan is ordered compounds first, and the line says so', () => {
    const exercises = [
      makeExercise({ id: 'fly', name: 'Cable Fly', primaryMuscle: 'chest_upper', mechanic: 'isolation', tier: 'S' }),
      makeExercise({ id: 'curl', name: 'Curl', primaryMuscle: 'biceps', mechanic: 'isolation' }),
      makeExercise({ id: 'row', name: 'Row', primaryMuscle: 'lats', mechanic: 'compound' }),
    ];
    const plan = build({
      muscles: [makeMuscle('chest_upper'), makeMuscle('biceps'), makeMuscle('lats', { weeklySets: 5 })],
      exercises,
    });
    expect(plan.order).toBe('compounds_first');
    // The rule the line describes is the rule the builder applied: the
    // least-behind muscle's compound still leads.
    const mechanics = plan.exercises.map((p) => exercises.find((e) => e.id === p.exerciseId)?.mechanic);
    expect(plan.exercises[0].exerciseId).toBe('row');
    expect(mechanics.lastIndexOf('compound')).toBeLessThan(mechanics.indexOf('isolation'));
    expect(suggestedOrderLine(plan)).toBe(
      'Order: big compound lifts first, then smaller ones. Within each, rested muscles furthest behind this week go first.'
    );
    expect(suggestedOrderLine(plan, { beginner: true })).toBe(
      'Order: big lifts that work several muscles first, then smaller ones. Rested muscles that have had the least work this week go first.'
    );
  });

  it('the no-data fallback takes turns around the body', () => {
    const plan = build({ muscles: [], exercises: fullBodyLibrary() });
    expect(plan.order).toBe('full_body_rotation');
    expect(suggestedOrderLine(plan)).toBe('Order: one lift per body part, taking turns around the body.');
  });

  it('says nothing with fewer than two picks or no recorded rule', () => {
    expect(suggestedOrderLine({ order: 'compounds_first', exercises: [{}] })).toBeNull();
    expect(suggestedOrderLine({ order: undefined, exercises: [{}, {}] })).toBeNull();
  });
});

describe('session order: big compound lifts first', () => {
  it('a small-muscle compound (upright row) goes after the bench press even when its muscle is furthest behind', () => {
    const plan = build({
      muscles: [
        makeMuscle('lateral_delts', { weeklySets: 0, targetSets: 14 }),
        makeMuscle('triceps', { weeklySets: 0, targetSets: 12 }),
        makeMuscle('chest_upper', { weeklySets: 0, targetSets: 10 }),
      ],
      exercises: [
        makeExercise({ id: 'upright', name: 'Upright Row', primaryMuscle: 'lateral_delts' }),
        makeExercise({ id: 'pushdown', name: 'Triceps Pushdown', primaryMuscle: 'triceps', mechanic: 'isolation' }),
        makeExercise({ id: 'bench', name: 'Barbell Bench Press', primaryMuscle: 'chest_upper' }),
      ],
    });
    expect(plan.exercises.map((e) => e.exerciseId)).toEqual(['bench', 'upright', 'pushdown']);
    expect(plan.order).toBe('compounds_first');
  });
});
