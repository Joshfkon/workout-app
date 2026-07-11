/**
 * Tests for Exercise Swapper Service
 */
import {
  calculateSimilarityScore,
  findSimilarExercises,
  suggestSwap,
  rankByEquipmentAvailability,
  getBodyweightAlternatives,
  getExercisesByPattern,
  getRelatedPatterns,
  analyzeSwapOptions,
  getBestSwap,
  areExercisesInterchangeable,
  type SwapContext,
} from '../exerciseSwapper';
import type { Exercise, MovementPattern } from '@/types/schema';

// Mock exercise factory
function createExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    name: 'Bench Press',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    movementPattern: 'horizontal_push',
    mechanic: 'compound',
    equipmentRequired: ['barbell', 'bench'],
    defaultRepRange: [6, 10] as [number, number],
    defaultRir: 2,
    minWeightIncrementKg: 2.5,
    formCues: [],
    commonMistakes: [],
    setupNote: '',
    ...overrides,
  };
}

describe('exerciseSwapper', () => {
  describe('calculateSimilarityScore', () => {
    it('returns a high score for near-identical exercises', () => {
      const source = createExercise();
      const candidate = createExercise({ id: 'ex-2', name: 'Barbell Bench Press' });

      // 30 (muscle) + 22 (pattern) + 14 (equipment) + 8 (mechanic)
      // + 6 (secondary) + name similarity — comfortably in the 90s.
      const score = calculateSimilarityScore(source, candidate);
      expect(score).toBeGreaterThanOrEqual(90);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('awards more for an exact primary-muscle tag than a group overlap', () => {
      const base = {
        movementPattern: 'vertical_push',
        mechanic: 'isolation' as const,
        secondaryMuscles: [],
        equipmentRequired: ['cable'],
        defaultRepRange: [15, 20] as [number, number],
        name: 'Some Movement',
      };
      const source = createExercise({ ...base, primaryMuscle: 'chest' });
      const exact = createExercise({ ...base, id: 'ex-exact', primaryMuscle: 'chest' });
      const groupOverlap = createExercise({ ...base, id: 'ex-grp', primaryMuscle: 'chest_upper' });
      const unrelated = createExercise({ ...base, id: 'ex-none', primaryMuscle: 'quads' });

      expect(calculateSimilarityScore(source, exact)).toBeGreaterThan(
        calculateSimilarityScore(source, groupOverlap)
      );
      expect(calculateSimilarityScore(source, groupOverlap)).toBeGreaterThan(
        calculateSimilarityScore(source, unrelated)
      );
    });

    it('does NOT reward a blank movement pattern matching another blank one', () => {
      // Regression: call sites pass movementPattern: '' as a placeholder. Two
      // blanks must not count as a pattern match (the "everything ~60%" bug).
      const source = createExercise({
        name: 'A',
        primaryMuscle: 'chest',
        movementPattern: '',
        equipmentRequired: [],
        secondaryMuscles: [],
        mechanic: 'compound',
      });
      const blankCandidate = createExercise({
        id: 'ex-2',
        name: 'B',
        primaryMuscle: 'chest',
        movementPattern: '',
        equipmentRequired: [],
        secondaryMuscles: [],
        mechanic: 'isolation',
      });
      const realPatternCandidate = createExercise({
        id: 'ex-3',
        name: 'A', // identical name to isolate the pattern effect
        primaryMuscle: 'chest',
        movementPattern: 'horizontal_push',
        equipmentRequired: [],
        secondaryMuscles: [],
        mechanic: 'compound',
      });
      const sourceReal = createExercise({
        name: 'A',
        primaryMuscle: 'chest',
        movementPattern: 'horizontal_push',
        equipmentRequired: [],
        secondaryMuscles: [],
        mechanic: 'compound',
      });

      // Blank↔blank gets muscle (30) + name, but NO pattern points.
      const blankScore = calculateSimilarityScore(source, blankCandidate);
      // Known-equal patterns DO add points.
      const realScore = calculateSimilarityScore(sourceReal, realPatternCandidate);
      expect(realScore).toBeGreaterThan(blankScore);
    });

    it('rewards matching equipment class', () => {
      const base = {
        primaryMuscle: 'chest',
        movementPattern: 'horizontal_push',
        mechanic: 'compound' as const,
        secondaryMuscles: [],
        name: 'Chest Move',
      };
      const source = createExercise({ ...base, equipmentRequired: ['machine'] });
      const sameClass = createExercise({
        ...base,
        id: 'ex-2',
        equipmentRequired: ['seated chest press machine'],
      });
      const diffClass = createExercise({
        ...base,
        id: 'ex-3',
        equipmentRequired: ['barbell'],
      });

      expect(calculateSimilarityScore(source, sameClass)).toBeGreaterThan(
        calculateSimilarityScore(source, diffClass)
      );
    });

    it('ranks a near-identical name far above a merely same-muscle movement (Task 4)', () => {
      const source = createExercise({
        name: 'Seated Calf Raise (Plate Loaded)',
        primaryMuscle: 'calves',
        movementPattern: 'calf_raise',
        mechanic: 'isolation',
        equipmentRequired: ['machine'],
        secondaryMuscles: [],
        defaultRepRange: [12, 20] as [number, number],
      });
      const nearIdentical = createExercise({
        id: 'ex-machine',
        name: 'Seated Calf Raise (Machine)',
        primaryMuscle: 'calves',
        movementPattern: 'calf_raise',
        mechanic: 'isolation',
        equipmentRequired: ['machine'],
        secondaryMuscles: [],
        defaultRepRange: [12, 20] as [number, number],
      });
      const distantSameMuscle = createExercise({
        id: 'ex-ext',
        name: 'Calf Extension',
        primaryMuscle: 'calves',
        movementPattern: 'calf_raise',
        mechanic: 'isolation',
        equipmentRequired: ['machine'],
        secondaryMuscles: [],
        defaultRepRange: [12, 20] as [number, number],
      });

      const near = calculateSimilarityScore(source, nearIdentical);
      const distant = calculateSimilarityScore(source, distantSameMuscle);
      expect(near).toBeGreaterThan(distant);
      // "Far above" — the name signal opens a clear gap even when every
      // structured field is identical between the two candidates.
      expect(near - distant).toBeGreaterThanOrEqual(10);
    });

    it('caps score at 100', () => {
      const source = createExercise({
        secondaryMuscles: ['a', 'b', 'c', 'd', 'e'],
      });
      const candidate = createExercise({
        id: 'ex-2',
        secondaryMuscles: ['a', 'b', 'c', 'd', 'e'],
      });

      const score = calculateSimilarityScore(source, candidate);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('findSimilarExercises', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', name: 'Bench Press' }),
      createExercise({ id: 'ex-2', name: 'Incline Bench Press', movementPattern: 'horizontal_push' }),
      createExercise({ id: 'ex-3', name: 'Dumbbell Fly', mechanic: 'isolation', movementPattern: 'horizontal_push' }),
      createExercise({ id: 'ex-4', name: 'Squat', primaryMuscle: 'quads', movementPattern: 'squat' }),
    ];

    it('excludes source exercise from results', () => {
      const source = exercises[0];
      const similar = findSimilarExercises(source, exercises);

      expect(similar.find(e => e.id === source.id)).toBeUndefined();
    });

    it('returns exercises with similarity score > 50', () => {
      const source = exercises[0];
      const similar = findSimilarExercises(source, exercises);

      // Incline bench and DB fly should be similar (same muscle, similar pattern)
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.some(e => e.id === 'ex-2')).toBe(true);
    });

    it('does not return exercises with low similarity', () => {
      const source = exercises[0]; // Bench press (chest)
      const similar = findSimilarExercises(source, exercises);

      // Squat should not be similar to bench press
      expect(similar.find(e => e.id === 'ex-4')).toBeUndefined();
    });

    it('penalizes exercises without required equipment', () => {
      const source = exercises[0];
      const context: SwapContext = {
        reason: 'equipment',
        availableEquipment: ['dumbbell'], // No barbell
      };

      const similar = findSimilarExercises(source, exercises, context);
      // Exercises requiring barbell should be ranked lower
      expect(similar).toBeDefined();
    });

    it('boosts exercises from user history', () => {
      const source = exercises[0];
      const context: SwapContext = {
        reason: 'variation',
        userHistory: ['ex-3'], // User has done DB fly before
      };

      const similar = findSimilarExercises(source, exercises, context);
      expect(similar).toBeDefined();
    });
  });

  describe('suggestSwap', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', name: 'Bench Press' }),
      createExercise({ id: 'ex-2', name: 'Incline Bench' }),
      createExercise({ id: 'ex-3', name: 'DB Bench' }),
      createExercise({ id: 'ex-4', name: 'Push Up', equipmentRequired: ['bodyweight'] }),
      createExercise({ id: 'ex-5', name: 'Cable Fly', mechanic: 'isolation' }),
      createExercise({ id: 'ex-6', name: 'Pec Deck', mechanic: 'isolation' }),
    ];

    it('returns up to 5 suggestions', () => {
      const source = exercises[0];
      const context: SwapContext = { reason: 'variation' };

      const suggestions = suggestSwap(source, exercises, context);
      expect(suggestions.length).toBeLessThanOrEqual(5);
    });

    it('includes match score in suggestions', () => {
      const source = exercises[0];
      const context: SwapContext = { reason: 'plateau' };

      const suggestions = suggestSwap(source, exercises, context);
      suggestions.forEach(s => {
        expect(s.matchScore).toBeGreaterThan(0);
        expect(s.matchScore).toBeLessThanOrEqual(100);
      });
    });

    it('includes reason in suggestions', () => {
      const source = exercises[0];
      const context: SwapContext = { reason: 'injury' };

      const suggestions = suggestSwap(source, exercises, context);
      suggestions.forEach(s => {
        expect(typeof s.reason).toBe('string');
        expect(s.reason.length).toBeGreaterThan(0);
      });
    });
  });

  describe('rankByEquipmentAvailability', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', name: 'Barbell Squat', equipmentRequired: ['barbell', 'squat rack'] }),
      createExercise({ id: 'ex-2', name: 'Goblet Squat', equipmentRequired: ['dumbbell'] }),
      createExercise({ id: 'ex-3', name: 'Bodyweight Squat', equipmentRequired: ['bodyweight'] }),
      createExercise({ id: 'ex-4', name: 'Leg Press', equipmentRequired: ['leg press'] }),
    ];

    it('ranks exercises with all required equipment first', () => {
      const available = ['barbell', 'squat rack', 'dumbbell'];
      const ranked = rankByEquipmentAvailability(exercises, available);

      // Barbell squat and goblet squat should be first
      expect(['ex-1', 'ex-2']).toContain(ranked[0].id);
    });

    it('ranks bodyweight exercises high', () => {
      const available = ['cable'];
      const ranked = rankByEquipmentAvailability(exercises, available);

      // Bodyweight squat should rank high even without matching equipment
      const bwIndex = ranked.findIndex(e => e.id === 'ex-3');
      expect(bwIndex).toBeLessThan(ranked.length - 1);
    });

    it('ranks exercises with missing equipment lower', () => {
      const available = ['dumbbell'];
      const ranked = rankByEquipmentAvailability(exercises, available);

      // Leg press should be last (no matching equipment)
      const lpIndex = ranked.findIndex(e => e.id === 'ex-4');
      expect(lpIndex).toBe(ranked.length - 1);
    });
  });

  describe('getBodyweightAlternatives', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', name: 'Bench Press', equipmentRequired: ['barbell', 'bench'] }),
      createExercise({ id: 'ex-2', name: 'Push Up', equipmentRequired: ['bodyweight'] }),
      createExercise({ id: 'ex-3', name: 'Dips', equipmentRequired: ['dip bars'] }),
      createExercise({ id: 'ex-4', name: 'Pull Up', primaryMuscle: 'back', equipmentRequired: ['pull-up bar'] }),
    ];

    it('returns bodyweight exercises for same muscle', () => {
      const source = exercises[0]; // Bench press (chest)
      const alternatives = getBodyweightAlternatives(source, exercises);

      expect(alternatives.some(e => e.id === 'ex-2')).toBe(true); // Push up
      expect(alternatives.some(e => e.id === 'ex-3')).toBe(true); // Dips
    });

    it('excludes source exercise', () => {
      const source = exercises[0];
      const alternatives = getBodyweightAlternatives(source, exercises);

      expect(alternatives.find(e => e.id === source.id)).toBeUndefined();
    });

    it('excludes exercises for different muscle groups', () => {
      const source = exercises[0]; // Chest
      const alternatives = getBodyweightAlternatives(source, exercises);

      expect(alternatives.find(e => e.id === 'ex-4')).toBeUndefined(); // Pull up (back)
    });
  });

  describe('getExercisesByPattern', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', movementPattern: 'horizontal_push' }),
      createExercise({ id: 'ex-2', movementPattern: 'horizontal_push' }),
      createExercise({ id: 'ex-3', movementPattern: 'squat' }),
    ];

    it('returns all exercises matching the pattern', () => {
      const result = getExercisesByPattern('horizontal_push', exercises);
      expect(result.length).toBe(2);
      expect(result.every(e => e.movementPattern === 'horizontal_push')).toBe(true);
    });

    it('returns empty array if no matches', () => {
      const result = getExercisesByPattern('hip_hinge', exercises);
      expect(result.length).toBe(0);
    });
  });

  describe('getRelatedPatterns', () => {
    it('returns related patterns for horizontal push', () => {
      const related = getRelatedPatterns('horizontal_push');
      expect(related).toContain('vertical_push');
    });

    it('returns related patterns for squat', () => {
      const related = getRelatedPatterns('squat');
      expect(related).toContain('lunge');
      expect(related).toContain('hip_hinge');
    });

    it('returns empty array for isolation patterns', () => {
      const related = getRelatedPatterns('elbow_flexion');
      expect(related.length).toBe(0);
    });
  });

  describe('analyzeSwapOptions', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', name: 'Bench Press', movementPattern: 'horizontal_push' }),
      createExercise({ id: 'ex-2', name: 'Incline Bench', movementPattern: 'horizontal_push' }),
      createExercise({ id: 'ex-3', name: 'OHP', movementPattern: 'vertical_push' }),
      createExercise({ id: 'ex-4', name: 'Push Up', equipmentRequired: ['bodyweight'] }),
    ];

    it('returns direct swaps, pattern variations, and equipment alternatives', () => {
      const source = exercises[0];
      const context: SwapContext = { reason: 'variation' };

      const analysis = analyzeSwapOptions(source, exercises, context);

      expect(analysis.directSwaps).toBeDefined();
      expect(analysis.patternVariations).toBeDefined();
      expect(analysis.equipmentAlternatives).toBeDefined();
    });

    it('includes pattern variations from related movements', () => {
      const source = exercises[0]; // horizontal_push
      const context: SwapContext = { reason: 'plateau' };

      const analysis = analyzeSwapOptions(source, exercises, context);

      // OHP (vertical_push) should appear in pattern variations
      expect(analysis.patternVariations.some(s => s.exercise.id === 'ex-3')).toBe(true);
    });
  });

  describe('getBestSwap', () => {
    const exercises: Exercise[] = [
      createExercise({ id: 'ex-1', name: 'Bench Press' }),
      createExercise({ id: 'ex-2', name: 'Incline Bench' }),
    ];

    it('returns the best swap suggestion', () => {
      const source = exercises[0];
      const context: SwapContext = { reason: 'variation' };

      const best = getBestSwap(source, exercises, context);

      expect(best).not.toBeNull();
      expect(best?.exercise.id).toBe('ex-2');
    });

    it('returns null if no good swaps available', () => {
      const source = exercises[0];
      const context: SwapContext = { reason: 'variation' };

      const best = getBestSwap(source, [source], context); // Only source in list
      expect(best).toBeNull();
    });
  });

  describe('areExercisesInterchangeable', () => {
    it('returns true for exercises with same muscle, pattern, and mechanic', () => {
      const a = createExercise({
        primaryMuscle: 'chest',
        movementPattern: 'horizontal_push',
        mechanic: 'compound',
      });
      const b = createExercise({
        id: 'ex-2',
        primaryMuscle: 'chest',
        movementPattern: 'horizontal_push',
        mechanic: 'compound',
      });

      expect(areExercisesInterchangeable(a, b)).toBe(true);
    });

    it('returns false if primary muscle differs', () => {
      const a = createExercise({ primaryMuscle: 'chest' });
      const b = createExercise({ id: 'ex-2', primaryMuscle: 'shoulders' });

      expect(areExercisesInterchangeable(a, b)).toBe(false);
    });

    it('returns false if movement pattern differs', () => {
      const a = createExercise({ movementPattern: 'horizontal_push' });
      const b = createExercise({ id: 'ex-2', movementPattern: 'vertical_push' });

      expect(areExercisesInterchangeable(a, b)).toBe(false);
    });

    it('returns false if mechanic differs', () => {
      const a = createExercise({ mechanic: 'compound' });
      const b = createExercise({ id: 'ex-2', mechanic: 'isolation' });

      expect(areExercisesInterchangeable(a, b)).toBe(false);
    });
  });
});

describe('estimateExerciseSFR', () => {
  const { estimateExerciseSFR } = jest.requireActual('../exerciseSwapper');

  it('returns the SFR for a known pattern/equipment pair', () => {
    const sfr = estimateExerciseSFR(
      createExercise({ movementPattern: 'squat', equipmentRequired: ['barbell'] })
    );
    expect(typeof sfr).toBe('number');
    expect(sfr).toBeGreaterThan(0);
  });

  it('returns null for an unknown movement pattern (neutral, never penalized)', () => {
    expect(
      estimateExerciseSFR(
        createExercise({ movementPattern: 'not-a-pattern', equipmentRequired: ['barbell'] })
      )
    ).toBeNull();
  });

  it('returns null when no listed equipment is covered by the SFR table', () => {
    expect(
      estimateExerciseSFR(
        createExercise({ movementPattern: 'squat', equipmentRequired: ['resistance-band-of-unknown-kind'] })
      )
    ).toBeNull();
  });
});
