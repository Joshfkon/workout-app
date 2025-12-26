/**
 * Tests for useActiveWorkout hook
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useActiveWorkout } from '../useActiveWorkout';
import { useWorkoutStore } from '@/stores';
import type { WorkoutSession, ExerciseBlock, SetLog, Exercise } from '@/types/schema';

// Mock Supabase client
const mockSupabaseClient = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: null, error: null })),
        order: jest.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
    insert: jest.fn(() => Promise.resolve({ error: null })),
    update: jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    })),
    delete: jest.fn(() => ({
      in: jest.fn(() => Promise.resolve({ error: null })),
    })),
  })),
};

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => mockSupabaseClient,
  createUntypedClient: () => mockSupabaseClient,
}));

jest.mock('@/lib/utils', () => ({
  generateId: () => 'generated-id',
}));

// Test fixtures
function createMockSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    mesocycleId: null,
    name: 'Test Workout',
    state: 'in_progress',
    scheduledFor: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    sessionRpe: null,
    sessionNotes: null,
    completionPercent: 0,
    preWorkoutCheckIn: null,
    ...overrides,
  };
}

function createMockBlock(overrides: Partial<ExerciseBlock> = {}): ExerciseBlock {
  return {
    id: 'block-1',
    workoutSessionId: 'session-1',
    exerciseId: 'exercise-1',
    order: 1,
    targetSets: 3,
    targetRepRange: [8, 12],
    targetRir: 2,
    restSeconds: 120,
    suggestedWeightKg: 60,
    notes: null,
    exercise: null,
    ...overrides,
  };
}

function createMockExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'exercise-1',
    name: 'Bench Press',
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    pattern: 'compound',
    equipment: 'barbell',
    difficulty: 'intermediate',
    fatigueRating: 3,
    notes: null,
    hypertrophyScore: null,
    ...overrides,
  };
}

describe('useActiveWorkout', () => {
  beforeEach(() => {
    // Reset the store
    useWorkoutStore.setState({
      activeSession: null,
      exerciseBlocks: [],
      setLogs: new Map(),
      currentBlockIndex: 0,
      exercises: new Map(),
      restTimerEnd: null,
    });

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('returns initial state when no active session', () => {
      const { result } = renderHook(() => useActiveWorkout());

      expect(result.current.activeSession).toBeNull();
      expect(result.current.isActive).toBe(false);
      expect(result.current.currentBlock).toBeNull();
      expect(result.current.exerciseBlocks).toEqual([]);
    });
  });

  describe('with active session', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('returns active session state', () => {
      const { result } = renderHook(() => useActiveWorkout());

      expect(result.current.activeSession).toBeDefined();
      expect(result.current.isActive).toBe(true);
      expect(result.current.exerciseBlocks).toHaveLength(1);
    });

    it('returns current block', () => {
      const { result } = renderHook(() => useActiveWorkout());

      expect(result.current.currentBlock).toBeDefined();
      expect(result.current.currentBlock?.id).toBe('block-1');
    });

    it('returns session stats', () => {
      const { result } = renderHook(() => useActiveWorkout());

      expect(result.current.stats).toBeDefined();
      expect(result.current.stats.totalSets).toBe(0);
    });
  });

  describe('saveSet', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('logs a set to the store', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      await act(async () => {
        await result.current.saveSet('block-1', {
          weightKg: 60,
          reps: 10,
          rpe: 7,
        });
      });

      const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
      expect(sets).toHaveLength(1);
      expect(sets[0].weightKg).toBe(60);
      expect(sets[0].reps).toBe(10);
    });

    it('calculates set quality', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      await act(async () => {
        await result.current.saveSet('block-1', {
          weightKg: 60,
          reps: 10,
          rpe: 8,
        });
      });

      const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
      expect(sets[0].quality).toBeDefined();
    });

    it('returns null for unknown block', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      let savedSet: any;
      await act(async () => {
        savedSet = await result.current.saveSet('unknown-block', {
          weightKg: 60,
          reps: 10,
          rpe: 7,
        });
      });

      expect(savedSet).toBeNull();
    });

    it('includes form feedback in quality reason', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      await act(async () => {
        await result.current.saveSet('block-1', {
          weightKg: 60,
          reps: 10,
          rpe: 7,
          feedback: {
            form: 'clean',
            difficulty: 'appropriate',
          },
        });
      });

      const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
      expect(sets[0].qualityReason).toContain('Clean form');
    });
  });

  describe('block navigation', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [
        createMockBlock({ id: 'block-1', order: 1 }),
        createMockBlock({ id: 'block-2', order: 2 }),
        createMockBlock({ id: 'block-3', order: 3 }),
      ];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('navigates to next block', () => {
      const { result } = renderHook(() => useActiveWorkout());

      act(() => {
        result.current.nextBlock();
      });

      expect(result.current.currentBlockIndex).toBe(1);
    });

    it('navigates to previous block', () => {
      const { result } = renderHook(() => useActiveWorkout());

      act(() => {
        result.current.nextBlock();
        result.current.previousBlock();
      });

      expect(result.current.currentBlockIndex).toBe(0);
    });

    it('sets specific block', () => {
      const { result } = renderHook(() => useActiveWorkout());

      act(() => {
        result.current.setCurrentBlock(2);
      });

      expect(result.current.currentBlockIndex).toBe(2);
      expect(result.current.currentBlock?.id).toBe('block-3');
    });
  });

  describe('submitCheckIn', () => {
    beforeEach(() => {
      const session = createMockSession({ state: 'planned' });
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('updates session with check-in data', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      const checkIn = {
        sleepQuality: 4,
        energyLevel: 3,
        stressLevel: 2,
        soreness: [],
      };

      await act(async () => {
        await result.current.submitCheckIn(checkIn);
      });

      expect(result.current.activeSession?.preWorkoutCheckIn).toEqual(checkIn);
    });
  });

  describe('completeWorkout', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('ends the session in the store', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      await act(async () => {
        await result.current.completeWorkout({
          sessionRpe: 8,
          pumpRating: 4,
          notes: 'Good workout',
        });
      });

      expect(result.current.activeSession).toBeNull();
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('cancelWorkout', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('clears the active session', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      await act(async () => {
        await result.current.cancelWorkout();
      });

      expect(result.current.activeSession).toBeNull();
    });
  });

  describe('endSession', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('clears the session from store', () => {
      const { result } = renderHook(() => useActiveWorkout());

      act(() => {
        result.current.endSession();
      });

      expect(result.current.activeSession).toBeNull();
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('currentBlockSets', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    it('returns sets for current block', async () => {
      const { result } = renderHook(() => useActiveWorkout());

      await act(async () => {
        await result.current.saveSet('block-1', {
          weightKg: 60,
          reps: 10,
          rpe: 7,
        });
      });

      expect(result.current.currentBlockSets).toHaveLength(1);
    });

    it('returns empty array when no sets logged', () => {
      const { result } = renderHook(() => useActiveWorkout());

      expect(result.current.currentBlockSets).toEqual([]);
    });
  });
});
