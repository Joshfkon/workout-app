import { groupDuplicates, suggestSurvivor, type DedupExercise } from '../exerciseDedup';

function ex(over: Partial<DedupExercise> & { id: string; name: string }): DedupExercise {
  return { primaryMuscle: 'calves', source: 'custom', setLogCount: 0, ...over };
}

describe('exerciseDedup.groupDuplicates', () => {
  it('groups exact, parenthetical, and plural variants as near-certain', () => {
    const exercises: DedupExercise[] = [
      ex({ id: 's1', name: 'Seated Calf Raise', source: 'seed', setLogCount: 12 }),
      ex({ id: 's2', name: 'Seated Calf Raise (Plate Loaded)', setLogCount: 3 }),
      ex({ id: 's3', name: 'Seated calf raise (ameri fit)' }),
      ex({ id: 's4', name: 'Seated Calf Raise (Machine)' }),
      // plural variant collapses via singularization
      ex({ id: 'a1', name: 'Hip Adduction Machine', primaryMuscle: 'adductors' }),
      ex({ id: 'a2', name: 'Hip Adductions Machine', primaryMuscle: 'adductors' }),
      // a lone, unrelated exercise
      ex({ id: 'z1', name: 'Barbell Bench Press', primaryMuscle: 'chest' }),
    ];

    const { nearCertain } = groupDuplicates(exercises);

    const calf = nearCertain.find((g) => g.members.some((m) => m.id === 's1'));
    expect(calf).toBeDefined();
    expect(calf!.members.map((m) => m.id).sort()).toEqual(['s1', 's2', 's3', 's4']);

    const adduction = nearCertain.find((g) => g.members.some((m) => m.id === 'a1'));
    expect(adduction).toBeDefined();
    expect(adduction!.members.map((m) => m.id).sort()).toEqual(['a1', 'a2']);

    // The unrelated exercise is not in any group.
    expect(nearCertain.some((g) => g.members.some((m) => m.id === 'z1'))).toBe(false);
  });

  it('groups fuzzy/typo variants (same muscle) as possible, not near-certain', () => {
    const exercises: DedupExercise[] = [
      ex({ id: 'f1', name: 'Standing Calf Raise' }),
      ex({ id: 'f2', name: 'Standing Calf Rais' }), // typo, different key
      ex({ id: 'f3', name: 'Leg Press', primaryMuscle: 'quads' }),
    ];

    const { nearCertain, possible } = groupDuplicates(exercises);

    // Typo means the normalized keys differ -> not near-certain...
    expect(nearCertain).toHaveLength(0);
    // ...but the fuzzy pass catches it within the same muscle.
    const fuzzy = possible.find((g) => g.members.some((m) => m.id === 'f1'));
    expect(fuzzy).toBeDefined();
    expect(fuzzy!.members.map((m) => m.id).sort()).toEqual(['f1', 'f2']);
  });

  it('does not fuzzily group across different muscles', () => {
    const exercises: DedupExercise[] = [
      ex({ id: 'm1', name: 'Cable Row', primaryMuscle: 'back' }),
      ex({ id: 'm2', name: 'Cable Rowe', primaryMuscle: 'biceps' }), // similar name, other muscle
    ];
    const { possible } = groupDuplicates(exercises);
    expect(possible).toHaveLength(0);
  });

  it('suggestSurvivor prefers the member with the most set history', () => {
    const group = groupDuplicates([
      ex({ id: 's1', name: 'Seated Calf Raise', source: 'seed', setLogCount: 2 }),
      ex({ id: 's2', name: 'Seated Calf Raise (Machine)', setLogCount: 40 }),
    ]).nearCertain[0];

    expect(suggestSurvivor(group).id).toBe('s2');
  });
});
