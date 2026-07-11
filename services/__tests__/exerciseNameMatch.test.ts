import {
  singularize,
  normalizeExerciseName,
  normalizeExerciseKey,
  exerciseNameSimilarity,
  findNameMatches,
  type NameMatchable,
} from '../exerciseNameMatch';

describe('exerciseNameMatch', () => {
  describe('singularize', () => {
    it.each([
      ['raises', 'raise'],
      ['curls', 'curl'],
      ['rows', 'row'],
      ['extensions', 'extension'],
      ['flies', 'fly'],
      ['calves', 'calf'],
      ['crunches', 'crunch'],
      ['dips', 'dip'],
      ['presses', 'press'],
    ])('singularizes %s -> %s', (input, expected) => {
      expect(singularize(input)).toBe(expected);
    });

    it('leaves already-singular words alone', () => {
      expect(singularize('press')).toBe('press'); // -ss guard
      expect(singularize('raise')).toBe('raise');
      expect(singularize('leg')).toBe('leg'); // too short
    });
  });

  describe('normalizeExerciseKey', () => {
    it('collapses parenthetical variants to the same key', () => {
      const key = normalizeExerciseKey('Seated Calf Raise');
      expect(normalizeExerciseKey('Seated Calf Raise (Machine)')).toBe(key);
      expect(normalizeExerciseKey('Seated Calf Raise (Plate Loaded)')).toBe(key);
      expect(normalizeExerciseKey('Seated calf raise (ameri fit)')).toBe(key);
    });

    it('is order-independent and punctuation-independent', () => {
      expect(normalizeExerciseKey('Hip Adduction Machine')).toBe(
        normalizeExerciseKey('hip  adduction, machine')
      );
    });

    it('keeps genuinely different exercises apart', () => {
      expect(normalizeExerciseKey('Seated Calf Raise')).not.toBe(
        normalizeExerciseKey('Standing Calf Raise')
      );
      expect(normalizeExerciseKey('Barbell Bench Press')).not.toBe(
        normalizeExerciseKey('Barbell Row')
      );
    });
  });

  describe('exerciseNameSimilarity', () => {
    it('scores 1 for normalized-identical names', () => {
      expect(exerciseNameSimilarity('Seated Calf Raise', 'seated calf raise')).toBe(1);
      expect(exerciseNameSimilarity('Seated Calf Raise (Machine)', 'Seated Calf Raise')).toBe(1);
    });

    it('tolerates typos (rase -> raise)', () => {
      expect(exerciseNameSimilarity('seated calf rase', 'Seated Calf Raise')).toBeGreaterThan(0.55);
    });

    it('scores near-identical variants far above distant same-muscle moves', () => {
      const near = exerciseNameSimilarity('Seated Calf Raise (Plate Loaded)', 'Seated Calf Raise (Machine)');
      const distant = exerciseNameSimilarity('Seated Calf Raise (Plate Loaded)', 'Calf Extension');
      expect(near).toBeGreaterThan(distant);
      expect(near - distant).toBeGreaterThan(0.3);
    });

    it('scores unrelated names low', () => {
      expect(exerciseNameSimilarity('Barbell Bench Press', 'Leg Curl')).toBeLessThan(0.3);
    });
  });

  describe('findNameMatches', () => {
    const library: NameMatchable[] = [
      { id: '1', name: 'Seated Calf Raise', primaryMuscle: 'calves' },
      { id: '2', name: 'Seated Calf Raise (Machine)', primaryMuscle: 'calves' },
      { id: '3', name: 'Standing Calf Raise', primaryMuscle: 'calves' },
      { id: '4', name: 'Barbell Bench Press', primaryMuscle: 'chest' },
    ];

    it('surfaces exact normalized matches first, flagged exact', () => {
      const matches = findNameMatches('Seated calf raise', library, { primaryMuscle: 'calves' });
      expect(matches.length).toBeGreaterThan(0);
      // Both the base and the (Machine) variant normalize equal to the query.
      expect(matches[0].exact).toBe(true);
      expect(matches.filter((m) => m.exact).map((m) => m.exercise.id)).toEqual(
        expect.arrayContaining(['1', '2'])
      );
    });

    it('surfaces fuzzy matches for typos even without an exact key match', () => {
      const matches = findNameMatches('seated calf rase', library, { primaryMuscle: 'calves' });
      expect(matches.map((m) => m.exercise.id)).toEqual(expect.arrayContaining(['1', '2']));
    });

    it('does not surface unrelated exercises', () => {
      const matches = findNameMatches('Seated Calf Raise', library);
      expect(matches.find((m) => m.exercise.id === '4')).toBeUndefined();
    });

    it('returns nothing for an empty name', () => {
      expect(findNameMatches('   ', library)).toEqual([]);
    });
  });
});
