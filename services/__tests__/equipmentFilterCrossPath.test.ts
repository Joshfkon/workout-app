/**
 * Cross-path equipment constraint tests (Attic repro).
 *
 * One shared fail-closed filter (services/equipmentFilter.ts) backs every
 * exercise-selection path. These tests pin each entry point to the same
 * location constraint so no path can drift back to fail-open:
 *   - suggested-workout generator (buildSuggestedWorkout)
 *   - location substitution pass (applyLocationSubstitutions)
 *   - post-generation invariant (enforcePlanEquipmentInvariant)
 *   - injury-aware swapper (getSafeAlternatives / autoSwapForInjuries)
 *
 * Attic inventory from the live repro: all three benches + dumbbells;
 * no barbell / EZ bar / kettlebells / trap bar; machines: none.
 */

import { KNOWN_EQUIPMENT_IDS } from '../equipmentFilter';
import {
  buildSuggestedWorkout,
  type SuggestedExerciseInput,
  type SuggestedMuscleInput,
} from '../suggestedWorkout';
import {
  applyLocationSubstitutions,
  enforcePlanEquipmentInvariant,
  type LocationSubstitutionExercise,
} from '../locationSubstitution';
import { autoSwapForInjuries, getSafeAlternatives } from '../injuryAwareSwapper';
import type { Exercise } from '@/types/schema';

const ATTIC_AVAILABLE = new Set(['flat_bench', 'incline_bench', 'decline_bench', 'dumbbells']);
const ATTIC_BLOCKLIST = KNOWN_EQUIPMENT_IDS.filter((id) => !ATTIC_AVAILABLE.has(id));

/** Names of everything in the pool the Attic genuinely supports. */
const ATTIC_PERFORMABLE = new Set([
  'Dumbbell Romanian Deadlift',
  'Single Leg Calf Raise',
  'Back Extension',
  'Dumbbell Bench Press',
  'Jefferson Curl', // seeded as dumbbells + bench
]);

interface PoolExercise {
  id: string;
  name: string;
  muscle: string;
  pattern: string;
  mechanic: 'compound' | 'isolation';
  equipment: string[];
  isBodyweight?: boolean;
}

// The repro offenders + honest alternatives, mirroring seeded metadata.
const POOL: PoolExercise[] = [
  { id: 'jefferson', name: 'Jefferson Curl', muscle: 'erectors', pattern: 'hip_hinge', mechanic: 'compound', equipment: ['dumbbells', 'bench'] },
  { id: 'nordic', name: 'Nordic Curl', muscle: 'hamstrings', pattern: 'knee_flexion', mechanic: 'isolation', equipment: ['nordic anchor'] },
  { id: 'seated-calf-pl', name: 'Seated Calf Raise (Plate Loaded)', muscle: 'calves', pattern: 'plantar_flexion', mechanic: 'isolation', equipment: ['seated calf raise machine', 'weight plates'] },
  { id: 'bb-rdl', name: 'Barbell Romanian Deadlift', muscle: 'hamstrings', pattern: 'hip_hinge', mechanic: 'compound', equipment: ['barbell'] },
  { id: 'db-rdl', name: 'Dumbbell Romanian Deadlift', muscle: 'hamstrings', pattern: 'hip_hinge', mechanic: 'compound', equipment: ['dumbbells'] },
  { id: 'sl-calf', name: 'Single Leg Calf Raise', muscle: 'calves', pattern: 'plantar_flexion', mechanic: 'isolation', equipment: [], isBodyweight: true },
  { id: 'back-ext', name: 'Back Extension', muscle: 'erectors', pattern: 'spinal_extension', mechanic: 'isolation', equipment: ['bodyweight'] },
  { id: 'machine-back-ext', name: 'Machine Back Extension', muscle: 'erectors', pattern: 'spinal_extension', mechanic: 'isolation', equipment: ['back extension machine'] },
  { id: 'db-bench', name: 'Dumbbell Bench Press', muscle: 'chest', pattern: 'horizontal_push', mechanic: 'compound', equipment: ['dumbbells', 'bench'] },
];

const toSuggestedInput = (ex: PoolExercise): SuggestedExerciseInput => ({
  id: ex.id,
  name: ex.name,
  primaryMuscle: ex.muscle,
  tier: 'B',
  mechanic: ex.mechanic,
  defaultRepRange: [8, 12],
  defaultRir: 2,
  equipment: ex.equipment,
  isBodyweight: ex.isBodyweight ?? false,
});

const toSubstitutionInput = (ex: PoolExercise): LocationSubstitutionExercise => ({
  id: ex.id,
  name: ex.name,
  primaryMuscle: ex.muscle,
  secondaryMuscles: [],
  movementPattern: ex.pattern,
  mechanic: ex.mechanic,
  tier: 'B',
  equipment: ex.equipment,
  isBodyweight: ex.isBodyweight ?? false,
});

const toSchemaExercise = (ex: PoolExercise): Exercise => ({
  id: ex.id,
  name: ex.name,
  primaryMuscle: ex.muscle as Exercise['primaryMuscle'],
  secondaryMuscles: [],
  mechanic: ex.mechanic,
  defaultRepRange: [8, 12],
  defaultRir: 2,
  minWeightIncrementKg: 2.5,
  formCues: [],
  commonMistakes: [],
  setupNote: '',
  movementPattern: ex.pattern,
  equipmentRequired: ex.equipment,
  isBodyweight: ex.isBodyweight,
});

const MUSCLES: SuggestedMuscleInput[] = [
  { muscle: 'hamstrings', recoveryStatus: 'ready', weeklySets: 0, targetSets: 10, mrvSets: 20 },
  { muscle: 'calves', recoveryStatus: 'ready', weeklySets: 0, targetSets: 8, mrvSets: 16 },
  { muscle: 'erectors', recoveryStatus: 'ready', weeklySets: 0, targetSets: 6, mrvSets: 12 },
];

describe('Attic repro: suggested-workout generator', () => {
  it('generates zero barbell/machine/anchor exercises and still covers hamstrings, calves, and erectors', () => {
    const plan = buildSuggestedWorkout({
      muscles: MUSCLES,
      exercises: POOL.map(toSuggestedInput),
      recentExerciseIds: [],
      maxExercises: 6,
      sessionMinutes: 60,
      unavailableEquipmentIds: ATTIC_BLOCKLIST,
    });

    const pickedNames = plan.exercises.map(
      (p) => POOL.find((ex) => ex.id === p.exerciseId)!.name
    );
    expect(pickedNames.length).toBeGreaterThan(0);
    for (const name of pickedNames) {
      expect(ATTIC_PERFORMABLE).toContain(name);
    }

    const pickedMuscles = new Set(plan.exercises.map((p) => p.muscle));
    expect(pickedMuscles).toContain('hamstrings');
    expect(pickedMuscles).toContain('calves');
    expect(pickedMuscles).toContain('erectors');
  });
});

describe('Attic repro: location substitution pass', () => {
  it('swaps blocked picks for same-muscle Attic-performable alternatives', () => {
    // A plan built for a fully-equipped default gym...
    const gymPlan = {
      exercises: [
        { exerciseId: 'bb-rdl', muscle: 'hamstrings' as const, reason: 'hams', sets: 4, repRange: [8, 12] as [number, number], targetRir: 2 },
        { exerciseId: 'seated-calf-pl', muscle: 'calves' as const, reason: 'calves', sets: 3, repRange: [12, 20] as [number, number], targetRir: 2 },
        { exerciseId: 'machine-back-ext', muscle: 'erectors' as const, reason: 'erectors', sets: 3, repRange: [12, 15] as [number, number], targetRir: 2 },
      ],
      focus: 'test',
      isLightSession: false,
    };

    // ...re-checked against the Attic.
    const substituted = applyLocationSubstitutions({
      plan: gymPlan,
      exercises: POOL.map(toSubstitutionInput),
      unavailableEquipmentIds: ATTIC_BLOCKLIST,
      sessionMinutes: 60,
    });

    const finalNames = substituted.exercises.map(
      (p) => POOL.find((ex) => ex.id === p.exerciseId)!.name
    );
    for (const name of finalNames) {
      expect(ATTIC_PERFORMABLE).toContain(name);
    }
    // Muscle coverage survives the substitutions.
    expect(substituted.exercises.map((p) => p.muscle)).toEqual([
      'hamstrings',
      'calves',
      'erectors',
    ]);
    // And the post-generation invariant agrees nothing slipped through.
    const enforced = enforcePlanEquipmentInvariant(
      substituted,
      POOL.map(toSubstitutionInput),
      ATTIC_BLOCKLIST
    );
    expect(enforced.exercises).toHaveLength(substituted.exercises.length);
  });

  it('the invariant throws (dev) when a violating pick sneaks through unflagged', () => {
    const violatingPlan = {
      exercises: [
        { exerciseId: 'bb-rdl', muscle: 'hamstrings' as const, reason: 'hams', sets: 4, repRange: [8, 12] as [number, number], targetRir: 2 },
      ],
      focus: 'test',
      isLightSession: false,
    };
    expect(() =>
      enforcePlanEquipmentInvariant(violatingPlan, POOL.map(toSubstitutionInput), ATTIC_BLOCKLIST)
    ).toThrow(/invariant violated/);
  });

  it('the invariant respects the visible noSubstituteAvailable exception', () => {
    const flaggedPlan = {
      exercises: [
        { exerciseId: 'bb-rdl', muscle: 'hamstrings' as const, reason: 'hams', sets: 4, repRange: [8, 12] as [number, number], targetRir: 2, noSubstituteAvailable: true },
      ],
      focus: 'test',
      isLightSession: false,
    };
    const enforced = enforcePlanEquipmentInvariant(
      flaggedPlan,
      POOL.map(toSubstitutionInput),
      ATTIC_BLOCKLIST
    );
    expect(enforced.exercises).toHaveLength(1);
  });
});

describe('Attic repro: injury-aware swapper', () => {
  it('never suggests an alternative the location cannot support', () => {
    const source = toSchemaExercise(POOL.find((ex) => ex.id === 'nordic')!);
    const alternatives = getSafeAlternatives(
      source,
      POOL.map(toSchemaExercise),
      [{ area: 'knee', severity: 1 }],
      ATTIC_BLOCKLIST
    );
    expect(alternatives.length).toBeGreaterThan(0);
    for (const alt of alternatives) {
      expect(ATTIC_PERFORMABLE).toContain(alt.exercise.name);
    }
  });

  it('autoSwapForInjuries replacements respect the blocklist', () => {
    const lowBackInjury = [{ area: 'lower_back' as const, severity: 2 as const }];
    const workout = [
      { id: 'block-1', exercise: toSchemaExercise(POOL.find((ex) => ex.id === 'bb-rdl')!) },
    ];
    const results = autoSwapForInjuries(
      workout,
      POOL.map(toSchemaExercise),
      lowBackInjury,
      ATTIC_BLOCKLIST
    );
    for (const result of results) {
      if (result.action === 'swapped' && result.replacement) {
        expect(ATTIC_PERFORMABLE).toContain(result.replacement.name);
      }
    }
  });
});
