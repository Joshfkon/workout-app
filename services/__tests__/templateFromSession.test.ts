import {
  buildTemplateExercises,
  type TemplateSourceBlock,
  type TemplateSourceSet,
} from '@/services/templateFromSession';

/**
 * Guards the session → template mapping behind "Save as template":
 *  - logged working sets beat the prescription, warmups never count
 *  - weights stay in kg, order is preserved, duration exercises stay seconds
 */

function block(overrides: Partial<TemplateSourceBlock> = {}): TemplateSourceBlock {
  return {
    id: 'block-1',
    exerciseId: 'ex-1',
    exercise: { name: 'Bench Press' },
    targetSets: 3,
    targetRepRange: [8, 12],
    targetWeightKg: 60,
    targetRestSeconds: 120,
    note: null,
    ...overrides,
  };
}

function set(overrides: Partial<TemplateSourceSet> = {}): TemplateSourceSet {
  return {
    exerciseBlockId: 'block-1',
    reps: 10,
    weightKg: 60,
    isWarmup: false,
    setType: 'working',
    ...overrides,
  };
}

describe('buildTemplateExercises', () => {
  it('falls back to the prescription for a block with nothing logged', () => {
    const [row] = buildTemplateExercises([block()], []);

    expect(row).toMatchObject({
      exercise_id: 'ex-1',
      exercise_name: 'Bench Press',
      exercise_type: 'rep_based',
      sort_order: 0,
      default_sets: 3,
      default_reps: '8-12',
      default_weight: 60,
      default_rest_seconds: 120,
      notes: null,
    });
  });

  it('prefers what was actually logged over the plan', () => {
    const [row] = buildTemplateExercises(
      [block({ targetSets: 3, targetWeightKg: 60 })],
      [
        set({ reps: 10, weightKg: 60 }),
        set({ reps: 9, weightKg: 62.5 }),
        set({ reps: 8, weightKg: 62.5 }),
        set({ reps: 8, weightKg: 62.5 }),
      ]
    );

    // Four sets performed, an 8-10 rep spread, top working weight 62.5 kg.
    expect(row.default_sets).toBe(4);
    expect(row.default_reps).toBe('8-10');
    expect(row.default_weight).toBe(62.5);
  });

  it('collapses a single logged rep count to one number', () => {
    const [row] = buildTemplateExercises(
      [block()],
      [set({ reps: 10 }), set({ reps: 10 })]
    );
    expect(row.default_reps).toBe('10');
  });

  it('ignores warmups entirely', () => {
    const [row] = buildTemplateExercises(
      [block({ targetSets: 3, targetWeightKg: 60 })],
      [
        set({ reps: 15, weightKg: 20, isWarmup: true }),
        set({ reps: 12, weightKg: 40, setType: 'warmup' }),
        set({ reps: 8, weightKg: 60 }),
      ]
    );

    expect(row.default_sets).toBe(1);
    expect(row.default_reps).toBe('8');
    expect(row.default_weight).toBe(60);
  });

  it('keeps block order and scopes sets to their own block', () => {
    const rows = buildTemplateExercises(
      [
        block({ id: 'a', exerciseId: 'ex-a', exercise: { name: 'Squat' } }),
        block({ id: 'b', exerciseId: 'ex-b', exercise: { name: 'Row' }, targetWeightKg: 40 }),
      ],
      [set({ exerciseBlockId: 'a', reps: 5, weightKg: 100 })]
    );

    expect(rows.map((r) => r.exercise_name)).toEqual(['Squat', 'Row']);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ default_sets: 1, default_reps: '5', default_weight: 100 });
    // Untouched block keeps its prescription.
    expect(rows[1]).toMatchObject({ default_sets: 3, default_reps: '8-12', default_weight: 40 });
  });

  it('formats duration exercises in seconds', () => {
    const durationBlock = block({
      exercise: { name: 'Plank', exerciseType: 'duration_based' },
      targetRepRange: [30, 60],
      targetWeightKg: 0,
    });

    expect(buildTemplateExercises([durationBlock], [])[0]).toMatchObject({
      default_reps: '30-60s',
      exercise_type: 'duration_based',
      default_weight: null,
    });

    expect(
      buildTemplateExercises([durationBlock], [set({ reps: 45, weightKg: 0 })])[0].default_reps
    ).toBe('45s');
  });

  it('leaves weight null for unloaded work instead of writing a zero', () => {
    const [row] = buildTemplateExercises(
      [block({ exercise: { name: 'Push-up' }, targetWeightKg: 0 })],
      [set({ reps: 20, weightKg: 0 })]
    );
    expect(row.default_weight).toBeNull();
  });

  it('substitutes sane defaults for a block with no usable prescription', () => {
    const [row] = buildTemplateExercises(
      [block({ targetSets: 0, targetRepRange: [], targetRestSeconds: 0 })],
      []
    );
    expect(row).toMatchObject({
      default_sets: 1,
      default_reps: '8-12',
      default_rest_seconds: 90,
    });
  });

  it('carries the block note across as the exercise note', () => {
    const [row] = buildTemplateExercises([block({ note: '  pause at chest  ' })], []);
    expect(row.notes).toBe('pause at chest');
  });

  it('returns nothing for an empty session', () => {
    expect(buildTemplateExercises([], [])).toEqual([]);
  });
});
