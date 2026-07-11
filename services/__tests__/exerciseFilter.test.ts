import {
  dedupeExercisesById,
  exerciseMatchesEquipment,
  exerciseMatchesMuscleChip,
  exerciseMatchesMuscleGroup,
  exerciseMatchesQuery,
  filterExercises,
  getExerciseEquipment,
  getExerciseMuscles,
  getPrimaryMuscle,
  type FilterableExercise,
} from '../exerciseFilter';

// snake_case (DB row) exercise
const backExtSnake: FilterableExercise = {
  id: 'backext',
  name: 'Machine Back Extension',
  primary_muscle: 'back',
  secondary_muscles: ['glutes'],
  equipment_required: ['machine'],
};

// camelCase (domain) exercise, precisely-tagged sub-muscle of the back
const rowCamel: FilterableExercise = {
  id: 'row',
  name: 'Seated Cable Row',
  primaryMuscle: 'lats',
  secondaryMuscles: ['biceps'],
  equipmentRequired: ['cable'],
};

// underscore token to exercise the formatted-name query path ("Rear Delts")
const rearDeltRaise: FilterableExercise = {
  id: 'reardelt',
  name: 'Reverse Pec Deck',
  primaryMuscle: 'rear_delts',
  equipmentRequired: ['machine'],
};

const cableCrunch: FilterableExercise = {
  id: 'crunch',
  name: 'Cable Crunch',
  primary_muscle: 'abs',
  equipment_required: ['cable'],
};

const hipAdduction: FilterableExercise = {
  id: 'hipadd',
  name: 'Hip Adduction Machine',
  primary_muscle: 'adductors',
  equipment_required: ['machine'],
};

describe('field accessors (casing tolerance)', () => {
  it('reads primary muscle from either casing, lowercased', () => {
    expect(getPrimaryMuscle(backExtSnake)).toBe('back');
    expect(getPrimaryMuscle(rowCamel)).toBe('lats');
    expect(getPrimaryMuscle({ id: 'x', name: 'x' })).toBe('');
  });

  it('collects primary + secondary muscles', () => {
    expect(getExerciseMuscles(backExtSnake)).toEqual(['back', 'glutes']);
    expect(getExerciseMuscles(rowCamel)).toEqual(['lats', 'biceps']);
  });

  it('collects equipment from list and singular field', () => {
    expect(getExerciseEquipment(rowCamel)).toEqual(['cable']);
    expect(getExerciseEquipment({ id: 'x', name: 'x', equipment_required: ['barbell'], equipment: 'Barbell' }))
      .toEqual(['barbell', 'barbell']);
  });
});

describe('exerciseMatchesQuery', () => {
  it('empty query matches everything', () => {
    expect(exerciseMatchesQuery(cableCrunch, '')).toBe(true);
    expect(exerciseMatchesQuery(cableCrunch, '   ')).toBe(true);
  });

  it('matches name case-insensitively', () => {
    expect(exerciseMatchesQuery(backExtSnake, 'back')).toBe(true);
    expect(exerciseMatchesQuery(backExtSnake, 'BACK')).toBe(true);
    expect(exerciseMatchesQuery(cableCrunch, 'back')).toBe(false);
  });

  it('matches by muscle (raw token and formatted form)', () => {
    expect(exerciseMatchesQuery(rowCamel, 'lats')).toBe(true);
    expect(exerciseMatchesQuery(cableCrunch, 'abs')).toBe(true);
    // formatted display name ("Rear Delts") matches a spaced query
    expect(exerciseMatchesQuery(rearDeltRaise, 'rear delt')).toBe(true);
  });

  it('matches by equipment', () => {
    expect(exerciseMatchesQuery(cableCrunch, 'cable')).toBe(true);
    expect(exerciseMatchesQuery(hipAdduction, 'machine')).toBe(true);
    expect(exerciseMatchesQuery(hipAdduction, 'cable')).toBe(false);
  });
});

describe('exerciseMatchesMuscleGroup', () => {
  it('empty group matches everything', () => {
    expect(exerciseMatchesMuscleGroup(cableCrunch, null)).toBe(true);
    expect(exerciseMatchesMuscleGroup(cableCrunch, '')).toBe(true);
  });

  it('coarse chip matches precisely-tagged exercises', () => {
    // 'back' chip should catch both lats and lower_back
    expect(exerciseMatchesMuscleGroup(rowCamel, 'back')).toBe(true);
    expect(exerciseMatchesMuscleGroup(backExtSnake, 'back')).toBe(true);
  });

  it('rejects off-target muscles', () => {
    expect(exerciseMatchesMuscleGroup(cableCrunch, 'back')).toBe(false);
    expect(exerciseMatchesMuscleGroup(hipAdduction, 'back')).toBe(false);
  });
});

describe('exerciseMatchesMuscleChip (raw primary_muscle chips)', () => {
  const lats = rowCamel; // primaryMuscle 'lats'
  const backCoarse = backExtSnake; // primary_muscle 'back'

  it('empty chip matches everything', () => {
    expect(exerciseMatchesMuscleChip(lats, null)).toBe(true);
    expect(exerciseMatchesMuscleChip(lats, '')).toBe(true);
  });

  it('coarse/legacy chip expands to sub-muscles', () => {
    // 'back' chip catches both back and lats
    expect(exerciseMatchesMuscleChip(backCoarse, 'back')).toBe(true);
    expect(exerciseMatchesMuscleChip(lats, 'back')).toBe(true);
  });

  it('precise chip matches exactly and does NOT widen to coarse rows', () => {
    // tapping 'lats' shows lats, but NOT a generic 'back'-tagged row —
    // even though muscleMatchesGroup('back','lats') is true.
    expect(exerciseMatchesMuscleChip(lats, 'lats')).toBe(true);
    expect(exerciseMatchesMuscleChip(backCoarse, 'lats')).toBe(false);
    expect(exerciseMatchesMuscleChip(rearDeltRaise, 'rear_delts')).toBe(true);
  });
});

describe('exerciseMatchesEquipment', () => {
  it('empty matches all; otherwise exact token match', () => {
    expect(exerciseMatchesEquipment(cableCrunch, null)).toBe(true);
    expect(exerciseMatchesEquipment(cableCrunch, 'cable')).toBe(true);
    expect(exerciseMatchesEquipment(cableCrunch, 'Cable')).toBe(true);
    expect(exerciseMatchesEquipment(cableCrunch, 'machine')).toBe(false);
  });
});

describe('dedupeExercisesById', () => {
  it('keeps first occurrence, drops later duplicates', () => {
    const withDup = [backExtSnake, hipAdduction, { ...hipAdduction, name: 'Hip Adduction (library)' }];
    const out = dedupeExercisesById(withDup);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.id)).toEqual(['backext', 'hipadd']);
    expect(out[1].name).toBe('Hip Adduction Machine'); // first one won
  });
});

describe('filterExercises (compose + dedupe)', () => {
  const library = [backExtSnake, rowCamel, cableCrunch, hipAdduction, { ...hipAdduction }];

  it('de-dupes even with no filters', () => {
    const out = filterExercises(library);
    expect(out.map((e) => e.id)).toEqual(['backext', 'row', 'crunch', 'hipadd']);
  });

  it('chip alone -> only that muscle group', () => {
    const out = filterExercises(library, { muscleGroup: 'back' });
    expect(out.map((e) => e.id).sort()).toEqual(['backext', 'row']);
  });

  it('query alone -> name/muscle/equipment match', () => {
    expect(filterExercises(library, { query: 'back' }).map((e) => e.id)).toEqual(['backext']);
    expect(filterExercises(library, { query: 'cable' }).map((e) => e.id).sort()).toEqual(['crunch', 'row']);
  });

  it('query AND chip compose (intersection)', () => {
    // 'cable' matches Seated Cable Row (equipment) + Cable Crunch (name);
    // 'back' chip narrows to just the row.
    const out = filterExercises(library, { query: 'cable', muscleGroup: 'back' });
    expect(out.map((e) => e.id)).toEqual(['row']);
  });

  it('returns empty when nothing matches (never the full list)', () => {
    expect(filterExercises(library, { query: 'nonexistent-xyz' })).toEqual([]);
    expect(filterExercises(library, { muscleGroup: 'back', query: 'crunch' })).toEqual([]);
  });
});
