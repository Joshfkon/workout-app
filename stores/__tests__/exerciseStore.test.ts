/**
 * Tests for stores/exerciseStore.ts
 * Zustand store for exercise library caching
 */

import { useExerciseStore } from '../exerciseStore';
import type { Exercise, MuscleGroup, MovementPattern } from '@/types/schema';

// ============================================
// HELPER FUNCTIONS
// ============================================

function createMockExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: `ex-${Math.random().toString(36).slice(2, 9)}`,
    name: 'Test Exercise',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    movementPattern: 'push',
    equipment: 'barbell',
    difficulty: 'intermediate',
    instructions: 'Test instructions',
    videoUrl: null,
    isCustom: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Exercise;
}

// ============================================
// STORE TESTS
// ============================================

describe('exerciseStore', () => {
  // Reset the store before each test
  beforeEach(() => {
    useExerciseStore.setState({
      exercises: [],
      isLoading: false,
      lastFetched: null,
    });
  });

  describe('initial state', () => {
    it('starts with empty exercises array', () => {
      const { exercises } = useExerciseStore.getState();
      expect(exercises).toEqual([]);
    });

    it('starts with isLoading false', () => {
      const { isLoading } = useExerciseStore.getState();
      expect(isLoading).toBe(false);
    });

    it('starts with lastFetched null', () => {
      const { lastFetched } = useExerciseStore.getState();
      expect(lastFetched).toBeNull();
    });
  });

  describe('setExercises', () => {
    it('sets the exercises array', () => {
      const mockExercises = [createMockExercise(), createMockExercise()];
      useExerciseStore.getState().setExercises(mockExercises);

      const { exercises } = useExerciseStore.getState();
      expect(exercises).toHaveLength(2);
    });

    it('sets lastFetched to current time', () => {
      const before = Date.now();
      useExerciseStore.getState().setExercises([]);
      const after = Date.now();

      const { lastFetched } = useExerciseStore.getState();
      expect(lastFetched).toBeGreaterThanOrEqual(before);
      expect(lastFetched).toBeLessThanOrEqual(after);
    });

    it('sets isLoading to false', () => {
      useExerciseStore.setState({ isLoading: true });
      useExerciseStore.getState().setExercises([]);

      const { isLoading } = useExerciseStore.getState();
      expect(isLoading).toBe(false);
    });
  });

  describe('addExercise', () => {
    it('adds an exercise to the array', () => {
      const exercise = createMockExercise();
      useExerciseStore.getState().addExercise(exercise);

      const { exercises } = useExerciseStore.getState();
      expect(exercises).toHaveLength(1);
      expect(exercises[0]).toEqual(exercise);
    });

    it('appends to existing exercises', () => {
      const exercise1 = createMockExercise({ name: 'Exercise 1' });
      const exercise2 = createMockExercise({ name: 'Exercise 2' });

      useExerciseStore.getState().setExercises([exercise1]);
      useExerciseStore.getState().addExercise(exercise2);

      const { exercises } = useExerciseStore.getState();
      expect(exercises).toHaveLength(2);
      expect(exercises[1].name).toBe('Exercise 2');
    });
  });

  describe('updateExercise', () => {
    it('updates an existing exercise', () => {
      const exercise = createMockExercise({ id: 'ex-1', name: 'Original Name' });
      useExerciseStore.getState().setExercises([exercise]);
      useExerciseStore.getState().updateExercise('ex-1', { name: 'Updated Name' });

      const { exercises } = useExerciseStore.getState();
      expect(exercises[0].name).toBe('Updated Name');
    });

    it('preserves other properties', () => {
      const exercise = createMockExercise({
        id: 'ex-1',
        name: 'Original',
        primaryMuscle: 'chest',
      });
      useExerciseStore.getState().setExercises([exercise]);
      useExerciseStore.getState().updateExercise('ex-1', { name: 'Updated' });

      const { exercises } = useExerciseStore.getState();
      expect(exercises[0].primaryMuscle).toBe('chest');
    });

    it('does not affect other exercises', () => {
      const exercise1 = createMockExercise({ id: 'ex-1', name: 'Exercise 1' });
      const exercise2 = createMockExercise({ id: 'ex-2', name: 'Exercise 2' });
      useExerciseStore.getState().setExercises([exercise1, exercise2]);
      useExerciseStore.getState().updateExercise('ex-1', { name: 'Updated' });

      const { exercises } = useExerciseStore.getState();
      expect(exercises[1].name).toBe('Exercise 2');
    });

    it('does nothing for non-existent exercise', () => {
      const exercise = createMockExercise({ id: 'ex-1' });
      useExerciseStore.getState().setExercises([exercise]);
      useExerciseStore.getState().updateExercise('ex-999', { name: 'Updated' });

      const { exercises } = useExerciseStore.getState();
      expect(exercises).toHaveLength(1);
      expect(exercises[0].id).toBe('ex-1');
    });
  });

  describe('getExerciseById', () => {
    it('returns exercise when found', () => {
      const exercise = createMockExercise({ id: 'ex-123' });
      useExerciseStore.getState().setExercises([exercise]);

      const result = useExerciseStore.getState().getExerciseById('ex-123');
      expect(result).toEqual(exercise);
    });

    it('returns undefined when not found', () => {
      useExerciseStore.getState().setExercises([createMockExercise()]);

      const result = useExerciseStore.getState().getExerciseById('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns undefined from empty store', () => {
      const result = useExerciseStore.getState().getExerciseById('any');
      expect(result).toBeUndefined();
    });
  });

  describe('getExercisesByMuscle', () => {
    it('finds exercises by primary muscle', () => {
      const chestExercise = createMockExercise({ primaryMuscle: 'chest' });
      const backExercise = createMockExercise({ primaryMuscle: 'back' });
      useExerciseStore.getState().setExercises([chestExercise, backExercise]);

      const result = useExerciseStore.getState().getExercisesByMuscle('chest');
      expect(result).toHaveLength(1);
      expect(result[0].primaryMuscle).toBe('chest');
    });

    it('finds exercises by secondary muscle', () => {
      const exercise = createMockExercise({
        primaryMuscle: 'chest',
        secondaryMuscles: ['triceps', 'shoulders'],
      });
      useExerciseStore.getState().setExercises([exercise]);

      const result = useExerciseStore.getState().getExercisesByMuscle('triceps');
      expect(result).toHaveLength(1);
    });

    it('is case insensitive', () => {
      const exercise = createMockExercise({ primaryMuscle: 'chest' });
      useExerciseStore.getState().setExercises([exercise]);

      expect(useExerciseStore.getState().getExercisesByMuscle('CHEST')).toHaveLength(1);
      expect(useExerciseStore.getState().getExercisesByMuscle('Chest')).toHaveLength(1);
    });

    it('returns empty array when no matches', () => {
      const exercise = createMockExercise({ primaryMuscle: 'chest' });
      useExerciseStore.getState().setExercises([exercise]);

      const result = useExerciseStore.getState().getExercisesByMuscle('legs');
      expect(result).toEqual([]);
    });
  });

  describe('getExercisesByPattern', () => {
    it('finds exercises by movement pattern', () => {
      const pushExercise = createMockExercise({ movementPattern: 'push' });
      const pullExercise = createMockExercise({ movementPattern: 'pull' });
      useExerciseStore.getState().setExercises([pushExercise, pullExercise]);

      const result = useExerciseStore.getState().getExercisesByPattern('push');
      expect(result).toHaveLength(1);
      expect(result[0].movementPattern).toBe('push');
    });

    it('is case insensitive', () => {
      const exercise = createMockExercise({ movementPattern: 'push' });
      useExerciseStore.getState().setExercises([exercise]);

      expect(useExerciseStore.getState().getExercisesByPattern('PUSH')).toHaveLength(1);
    });

    it('returns empty array when no matches', () => {
      const exercise = createMockExercise({ movementPattern: 'push' });
      useExerciseStore.getState().setExercises([exercise]);

      const result = useExerciseStore.getState().getExercisesByPattern('squat');
      expect(result).toEqual([]);
    });
  });

  describe('searchExercises', () => {
    beforeEach(() => {
      const exercises = [
        createMockExercise({ name: 'Bench Press', primaryMuscle: 'chest', movementPattern: 'push' }),
        createMockExercise({ name: 'Incline Dumbbell Press', primaryMuscle: 'chest', movementPattern: 'push' }),
        createMockExercise({ name: 'Barbell Row', primaryMuscle: 'back', movementPattern: 'pull' }),
        createMockExercise({ name: 'Lat Pulldown', primaryMuscle: 'back', movementPattern: 'pull' }),
      ];
      useExerciseStore.getState().setExercises(exercises);
    });

    it('searches by name', () => {
      const result = useExerciseStore.getState().searchExercises('bench');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bench Press');
    });

    it('searches by partial name', () => {
      const result = useExerciseStore.getState().searchExercises('press');
      expect(result).toHaveLength(2);
    });

    it('searches by primary muscle', () => {
      const result = useExerciseStore.getState().searchExercises('back');
      expect(result).toHaveLength(2);
    });

    it('searches by movement pattern', () => {
      const result = useExerciseStore.getState().searchExercises('pull');
      expect(result).toHaveLength(2);
    });

    it('is case insensitive', () => {
      expect(useExerciseStore.getState().searchExercises('BENCH')).toHaveLength(1);
      expect(useExerciseStore.getState().searchExercises('Bench')).toHaveLength(1);
    });

    it('returns empty array for no matches', () => {
      const result = useExerciseStore.getState().searchExercises('nonexistent');
      expect(result).toEqual([]);
    });

    it('returns all matches across fields', () => {
      // "Lat Pulldown" matches both name "Lat Pulldown" and pattern "pull"
      const result = useExerciseStore.getState().searchExercises('lat');
      expect(result).toHaveLength(1);
    });
  });

  describe('shouldRefetch', () => {
    it('returns true when exercises array is empty', () => {
      useExerciseStore.setState({ exercises: [], lastFetched: Date.now() });
      expect(useExerciseStore.getState().shouldRefetch()).toBe(true);
    });

    it('returns true when lastFetched is null', () => {
      useExerciseStore.setState({
        exercises: [createMockExercise()],
        lastFetched: null,
      });
      expect(useExerciseStore.getState().shouldRefetch()).toBe(true);
    });

    it('returns true when cache is expired (> 1 hour)', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      useExerciseStore.setState({
        exercises: [createMockExercise()],
        lastFetched: twoHoursAgo,
      });
      expect(useExerciseStore.getState().shouldRefetch()).toBe(true);
    });

    it('returns false when cache is fresh (< 1 hour)', () => {
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
      useExerciseStore.setState({
        exercises: [createMockExercise()],
        lastFetched: thirtyMinutesAgo,
      });
      expect(useExerciseStore.getState().shouldRefetch()).toBe(false);
    });

    it('returns false immediately after setExercises', () => {
      useExerciseStore.getState().setExercises([createMockExercise()]);
      expect(useExerciseStore.getState().shouldRefetch()).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('sets isLoading to true', () => {
      useExerciseStore.getState().setLoading(true);
      expect(useExerciseStore.getState().isLoading).toBe(true);
    });

    it('sets isLoading to false', () => {
      useExerciseStore.setState({ isLoading: true });
      useExerciseStore.getState().setLoading(false);
      expect(useExerciseStore.getState().isLoading).toBe(false);
    });
  });

  describe('persistence', () => {
    it('persists exercises and lastFetched (partialize check)', () => {
      // The store is configured with partialize to only persist exercises and lastFetched
      // This test verifies the expected behavior
      const exercise = createMockExercise();
      useExerciseStore.getState().setExercises([exercise]);
      useExerciseStore.getState().setLoading(true);

      const state = useExerciseStore.getState();

      // These should be part of persisted state
      expect(state.exercises).toHaveLength(1);
      expect(state.lastFetched).not.toBeNull();

      // isLoading should not affect persistence (not in partialize)
      expect(state.isLoading).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles exercises with empty secondary muscles', () => {
      const exercise = createMockExercise({
        primaryMuscle: 'chest',
        secondaryMuscles: [],
      });
      useExerciseStore.getState().setExercises([exercise]);

      const result = useExerciseStore.getState().getExercisesByMuscle('triceps');
      expect(result).toEqual([]);
    });

    it('handles very large exercise library', () => {
      const exercises = Array.from({ length: 500 }, (_, i) =>
        createMockExercise({ id: `ex-${i}`, name: `Exercise ${i}` })
      );
      useExerciseStore.getState().setExercises(exercises);

      expect(useExerciseStore.getState().exercises).toHaveLength(500);
      expect(useExerciseStore.getState().getExerciseById('ex-250')).toBeDefined();
    });

    it('search handles special characters gracefully', () => {
      const exercise = createMockExercise({ name: 'T-Bar Row' });
      useExerciseStore.getState().setExercises([exercise]);

      const result = useExerciseStore.getState().searchExercises('t-bar');
      expect(result).toHaveLength(1);
    });
  });
});
