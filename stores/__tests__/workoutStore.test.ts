/**
 * Tests for stores/workoutStore.ts
 * Zustand store for managing active workout sessions
 */

import { act } from '@testing-library/react';
import { useWorkoutStore } from '../workoutStore';
import type { SetLog } from '@/types/schema';
import {
  makeWorkoutSession,
  makeExerciseBlock,
  makeExercise,
  makeSetLog,
  makePreWorkoutCheckIn,
} from '@/test-utils/factories';

// Mock zustand persist middleware
jest.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
}));

// Test fixtures (delegate to shared schema-aligned factories)
const createMockSession = makeWorkoutSession;
const createMockBlock = makeExerciseBlock;
const createMockExercise = makeExercise;
const createMockSetLog = (overrides: Partial<SetLog> = {}): SetLog =>
  makeSetLog(overrides);

describe('useWorkoutStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    act(() => {
      useWorkoutStore.getState().endSession();
    });
  });

  describe('initial state', () => {
    it('starts with no active session', () => {
      const state = useWorkoutStore.getState();
      expect(state.activeSession).toBeNull();
      expect(state.exerciseBlocks).toEqual([]);
      expect(state.currentBlockIndex).toBe(0);
    });
  });

  describe('startSession', () => {
    it('sets up a new workout session', () => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
      });

      const state = useWorkoutStore.getState();
      expect(state.activeSession).toEqual(session);
      expect(state.exerciseBlocks).toEqual(blocks);
      expect(state.currentBlockIndex).toBe(0);
    });

    it('caches exercises in the store', () => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
      });

      const state = useWorkoutStore.getState();
      expect(Object.keys(state.exercises).length).toBe(1);
      expect(state.exercises['exercise-1']).toEqual(exercises[0]);
    });

    it('clears previous set logs', () => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];

      // Start a session and log a set
      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
        useWorkoutStore.getState().logSet('block-1', createMockSetLog());
      });

      // Start a new session
      act(() => {
        useWorkoutStore.getState().startSession(
          createMockSession({ id: 'session-2' }),
          blocks,
          exercises
        );
      });

      const state = useWorkoutStore.getState();
      expect(state.getSetsForBlock('block-1')).toEqual([]);
    });
  });

  describe('endSession', () => {
    it('clears all session data', () => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
        useWorkoutStore.getState().logSet('block-1', createMockSetLog());
        useWorkoutStore.getState().endSession();
      });

      const state = useWorkoutStore.getState();
      expect(state.activeSession).toBeNull();
      expect(state.exerciseBlocks).toEqual([]);
      expect(state.getSetsForBlock('block-1')).toEqual([]);
      expect(state.currentBlockIndex).toBe(0);
    });
  });

  describe('setCheckIn', () => {
    it('sets pre-workout check-in data', () => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];

      const checkIn = makePreWorkoutCheckIn({
        sleepQuality: 4,
        stressLevel: 2,
        nutritionRating: 4,
      });

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
        useWorkoutStore.getState().setCheckIn(checkIn);
      });

      const state = useWorkoutStore.getState();
      expect(state.activeSession?.preWorkoutCheckIn).toEqual(checkIn);
    });

    it('does nothing if no active session', () => {
      const checkIn = makePreWorkoutCheckIn();

      act(() => {
        useWorkoutStore.getState().setCheckIn(checkIn);
      });

      const state = useWorkoutStore.getState();
      expect(state.activeSession).toBeNull();
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

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
      });
    });

    describe('setCurrentBlock', () => {
      it('sets the current block index', () => {
        act(() => {
          useWorkoutStore.getState().setCurrentBlock(2);
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(2);
      });

      it('does not set invalid index (negative)', () => {
        act(() => {
          useWorkoutStore.getState().setCurrentBlock(-1);
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(0);
      });

      it('does not set invalid index (too large)', () => {
        act(() => {
          useWorkoutStore.getState().setCurrentBlock(10);
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(0);
      });
    });

    describe('nextBlock', () => {
      it('moves to the next block', () => {
        act(() => {
          useWorkoutStore.getState().nextBlock();
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(1);
      });

      it('does not go past the last block', () => {
        act(() => {
          useWorkoutStore.getState().setCurrentBlock(2);
          useWorkoutStore.getState().nextBlock();
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(2);
      });
    });

    describe('previousBlock', () => {
      it('moves to the previous block', () => {
        act(() => {
          useWorkoutStore.getState().setCurrentBlock(2);
          useWorkoutStore.getState().previousBlock();
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(1);
      });

      it('does not go before the first block', () => {
        act(() => {
          useWorkoutStore.getState().previousBlock();
        });

        expect(useWorkoutStore.getState().currentBlockIndex).toBe(0);
      });
    });
  });

  describe('set logging', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [createMockBlock()];
      const exercises = [createMockExercise()];

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
      });
    });

    describe('logSet', () => {
      it('logs a new set', () => {
        const set = createMockSetLog();

        act(() => {
          useWorkoutStore.getState().logSet('block-1', set);
        });

        const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
        expect(sets).toHaveLength(1);
        expect(sets[0]).toEqual(set);
      });

      it('appends to existing sets', () => {
        const set1 = createMockSetLog({ id: 'set-1', setNumber: 1 });
        const set2 = createMockSetLog({ id: 'set-2', setNumber: 2 });

        act(() => {
          useWorkoutStore.getState().logSet('block-1', set1);
          useWorkoutStore.getState().logSet('block-1', set2);
        });

        const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
        expect(sets).toHaveLength(2);
      });
    });

    describe('updateSet', () => {
      it('updates an existing set', () => {
        const set = createMockSetLog({ reps: 10 });

        act(() => {
          useWorkoutStore.getState().logSet('block-1', set);
          useWorkoutStore.getState().updateSet('block-1', 'set-1', { reps: 12 });
        });

        const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
        expect(sets[0].reps).toBe(12);
      });

      it('does not affect other sets', () => {
        const set1 = createMockSetLog({ id: 'set-1', reps: 10 });
        const set2 = createMockSetLog({ id: 'set-2', reps: 8 });

        act(() => {
          useWorkoutStore.getState().logSet('block-1', set1);
          useWorkoutStore.getState().logSet('block-1', set2);
          useWorkoutStore.getState().updateSet('block-1', 'set-1', { reps: 12 });
        });

        const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
        expect(sets[1].reps).toBe(8);
      });
    });

    describe('deleteSet', () => {
      it('deletes a set', () => {
        const set = createMockSetLog();

        act(() => {
          useWorkoutStore.getState().logSet('block-1', set);
          useWorkoutStore.getState().deleteSet('block-1', 'set-1');
        });

        const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
        expect(sets).toHaveLength(0);
      });

      it('only deletes the specified set', () => {
        const set1 = createMockSetLog({ id: 'set-1' });
        const set2 = createMockSetLog({ id: 'set-2' });

        act(() => {
          useWorkoutStore.getState().logSet('block-1', set1);
          useWorkoutStore.getState().logSet('block-1', set2);
          useWorkoutStore.getState().deleteSet('block-1', 'set-1');
        });

        const sets = useWorkoutStore.getState().getSetsForBlock('block-1');
        expect(sets).toHaveLength(1);
        expect(sets[0].id).toBe('set-2');
      });
    });
  });

  describe('rest timer', () => {
    it('starts rest timer', () => {
      const before = Date.now();

      act(() => {
        useWorkoutStore.getState().startRestTimer(180);
      });

      const state = useWorkoutStore.getState();
      expect(state.restTimerEnd).toBeGreaterThanOrEqual(before + 180000);
    });

    it('clears rest timer', () => {
      act(() => {
        useWorkoutStore.getState().startRestTimer(180);
        useWorkoutStore.getState().clearRestTimer();
      });

      expect(useWorkoutStore.getState().restTimerEnd).toBeNull();
    });
  });

  describe('getSessionStats', () => {
    beforeEach(() => {
      const session = createMockSession();
      const blocks = [
        createMockBlock({ id: 'block-1' }),
        createMockBlock({ id: 'block-2' }),
      ];
      const exercises = [createMockExercise()];

      act(() => {
        useWorkoutStore.getState().startSession(session, blocks, exercises);
      });
    });

    it('calculates total sets', () => {
      act(() => {
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-1' }));
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-2' }));
        useWorkoutStore.getState().logSet('block-2', createMockSetLog({ id: 'set-3' }));
      });

      const stats = useWorkoutStore.getState().getSessionStats();
      expect(stats.totalSets).toBe(3);
    });

    it('calculates total reps', () => {
      act(() => {
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-1', reps: 10 }));
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-2', reps: 8 }));
      });

      const stats = useWorkoutStore.getState().getSessionStats();
      expect(stats.totalReps).toBe(18);
    });

    it('calculates total volume (weight x reps)', () => {
      act(() => {
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({
          id: 'set-1',
          weightKg: 100,
          reps: 10
        }));
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({
          id: 'set-2',
          weightKg: 100,
          reps: 8
        }));
      });

      const stats = useWorkoutStore.getState().getSessionStats();
      expect(stats.totalVolume).toBe(1800); // 100*10 + 100*8
    });

    it('calculates average RPE', () => {
      act(() => {
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-1', rpe: 7 }));
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-2', rpe: 8 }));
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({ id: 'set-3', rpe: 9 }));
      });

      const stats = useWorkoutStore.getState().getSessionStats();
      expect(stats.avgRpe).toBe(8);
    });

    it('excludes warmup sets from stats', () => {
      act(() => {
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({
          id: 'set-1',
          isWarmup: true,
          reps: 15
        }));
        useWorkoutStore.getState().logSet('block-1', createMockSetLog({
          id: 'set-2',
          isWarmup: false,
          reps: 10
        }));
      });

      const stats = useWorkoutStore.getState().getSessionStats();
      expect(stats.totalSets).toBe(1);
      expect(stats.totalReps).toBe(10);
    });

    it('returns zero stats when no sets logged', () => {
      const stats = useWorkoutStore.getState().getSessionStats();
      expect(stats.totalSets).toBe(0);
      expect(stats.totalReps).toBe(0);
      expect(stats.totalVolume).toBe(0);
      expect(stats.avgRpe).toBe(0);
    });
  });
});

describe('Workout Flow Integration', () => {
  beforeEach(() => {
    act(() => {
      useWorkoutStore.getState().endSession();
    });
  });

  it('completes a full workout flow: start → log sets → navigate → stats', () => {
    // Setup
    const session = createMockSession({ sessionNotes: 'Push Day' });
    const blocks = [
      createMockBlock({ id: 'block-1', exerciseId: 'bench', targetSets: 3 }),
      createMockBlock({ id: 'block-2', exerciseId: 'ohp', targetSets: 3 }),
    ];
    const exercises = [
      createMockExercise({ id: 'bench', name: 'Bench Press' }),
      createMockExercise({ id: 'ohp', name: 'Overhead Press' }),
    ];

    // Start session
    act(() => {
      useWorkoutStore.getState().startSession(session, blocks, exercises);
    });

    let state = useWorkoutStore.getState();
    expect(state.activeSession?.sessionNotes).toBe('Push Day');
    expect(state.exerciseBlocks).toHaveLength(2);

    // Submit check-in
    const checkIn = makePreWorkoutCheckIn({
      sleepQuality: 4,
      stressLevel: 2,
      nutritionRating: 4,
    });

    act(() => {
      useWorkoutStore.getState().setCheckIn(checkIn);
    });

    state = useWorkoutStore.getState();
    expect(state.activeSession?.preWorkoutCheckIn).toEqual(checkIn);

    // Log sets for first exercise
    act(() => {
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-1',
        exerciseBlockId: 'block-1',
        setNumber: 1,
        weightKg: 100,
        reps: 10,
        rpe: 7,
      }));
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-2',
        exerciseBlockId: 'block-1',
        setNumber: 2,
        weightKg: 100,
        reps: 9,
        rpe: 8,
      }));
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-3',
        exerciseBlockId: 'block-1',
        setNumber: 3,
        weightKg: 100,
        reps: 8,
        rpe: 9,
      }));
    });

    expect(useWorkoutStore.getState().getSetsForBlock('block-1')).toHaveLength(3);

    // Navigate to next exercise
    act(() => {
      useWorkoutStore.getState().nextBlock();
    });

    expect(useWorkoutStore.getState().currentBlockIndex).toBe(1);

    // Log sets for second exercise
    act(() => {
      useWorkoutStore.getState().logSet('block-2', createMockSetLog({
        id: 'set-4',
        exerciseBlockId: 'block-2',
        setNumber: 1,
        weightKg: 60,
        reps: 10,
        rpe: 7,
      }));
      useWorkoutStore.getState().logSet('block-2', createMockSetLog({
        id: 'set-5',
        exerciseBlockId: 'block-2',
        setNumber: 2,
        weightKg: 60,
        reps: 9,
        rpe: 8,
      }));
      useWorkoutStore.getState().logSet('block-2', createMockSetLog({
        id: 'set-6',
        exerciseBlockId: 'block-2',
        setNumber: 3,
        weightKg: 60,
        reps: 8,
        rpe: 9,
      }));
    });

    expect(useWorkoutStore.getState().getSetsForBlock('block-2')).toHaveLength(3);

    // Check final stats
    const stats = useWorkoutStore.getState().getSessionStats();
    expect(stats.totalSets).toBe(6);
    expect(stats.totalReps).toBe(54); // 10+9+8 + 10+9+8
    expect(stats.totalVolume).toBe(4320); // (100*(10+9+8)) + (60*(10+9+8)) = 2700 + 1620
    expect(stats.avgRpe).toBe(8); // (7+8+9+7+8+9) / 6 = 8

    // End session
    act(() => {
      useWorkoutStore.getState().endSession();
    });

    state = useWorkoutStore.getState();
    expect(state.activeSession).toBeNull();
    expect(state.exerciseBlocks).toHaveLength(0);
  });

  it('handles editing and deleting sets during workout', () => {
    const session = createMockSession();
    const blocks = [createMockBlock()];
    const exercises = [createMockExercise()];

    // Start session and log sets
    act(() => {
      useWorkoutStore.getState().startSession(session, blocks, exercises);
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-1',
        reps: 10,
        rpe: 7,
      }));
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-2',
        reps: 8,
        rpe: 8,
      }));
    });

    // Edit a set (correct wrong entry)
    act(() => {
      useWorkoutStore.getState().updateSet('block-1', 'set-1', { reps: 11, rpe: 8 });
    });

    let sets = useWorkoutStore.getState().getSetsForBlock('block-1');
    expect(sets[0].reps).toBe(11);
    expect(sets[0].rpe).toBe(8);

    // Delete a set (logged by mistake)
    act(() => {
      useWorkoutStore.getState().deleteSet('block-1', 'set-2');
    });

    sets = useWorkoutStore.getState().getSetsForBlock('block-1');
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe('set-1');
  });

  it('tracks warmup sets separately from working sets', () => {
    const session = createMockSession();
    const blocks = [createMockBlock({ targetSets: 3 })];
    const exercises = [createMockExercise()];

    act(() => {
      useWorkoutStore.getState().startSession(session, blocks, exercises);

      // Log warmup sets
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'warmup-1',
        isWarmup: true,
        weightKg: 40,
        reps: 15,
        rpe: 3,
      }));
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'warmup-2',
        isWarmup: true,
        weightKg: 60,
        reps: 10,
        rpe: 4,
      }));

      // Log working sets
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-1',
        isWarmup: false,
        weightKg: 100,
        reps: 10,
        rpe: 8,
      }));
      useWorkoutStore.getState().logSet('block-1', createMockSetLog({
        id: 'set-2',
        isWarmup: false,
        weightKg: 100,
        reps: 9,
        rpe: 9,
      }));
    });

    const allSets = useWorkoutStore.getState().getSetsForBlock('block-1');
    expect(allSets).toHaveLength(4);

    const warmupSets = allSets.filter(s => s.isWarmup);
    const workingSets = allSets.filter(s => !s.isWarmup);

    expect(warmupSets).toHaveLength(2);
    expect(workingSets).toHaveLength(2);

    // Stats should only include working sets
    const stats = useWorkoutStore.getState().getSessionStats();
    expect(stats.totalSets).toBe(2);
    expect(stats.totalReps).toBe(19); // 10 + 9
    expect(stats.totalVolume).toBe(1900); // 100*10 + 100*9
  });
});

describe('subjective feedback (additive fields)', () => {
  beforeEach(() => {
    useWorkoutStore.getState().endSession();
  });

  it('records a soreness ask once and never overwrites it (once per session)', () => {
    const store = useWorkoutStore.getState();
    store.recordSorenessAsked('hamstrings', 3);

    let ask = useWorkoutStore.getState().muscleSorenessAsked.hamstrings;
    expect(ask.rating).toBe(3);
    expect(typeof ask.askedAt).toBe('string');

    // A second ask (answer or dismissal) is ignored.
    useWorkoutStore.getState().recordSorenessAsked('hamstrings', 0);
    ask = useWorkoutStore.getState().muscleSorenessAsked.hamstrings;
    expect(ask.rating).toBe(3);
  });

  it('records a dismissal as rating null', () => {
    useWorkoutStore.getState().recordSorenessAsked('quads', null);
    expect(useWorkoutStore.getState().muscleSorenessAsked.quads.rating).toBeNull();
  });

  it('clears soreness asks on endSession', () => {
    useWorkoutStore.getState().recordSorenessAsked('quads', 2);
    useWorkoutStore.getState().endSession();
    expect(useWorkoutStore.getState().muscleSorenessAsked).toEqual({});
  });

  it('setBlockFeedback stamps pump/workload on the block', () => {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      mesocycleId: null,
      state: 'in_progress' as const,
      plannedDate: '2026-07-13',
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationSeconds: null,
      preWorkoutCheckIn: null,
      sessionRpe: null,
      pumpRating: null,
      sessionNotes: null,
      completionPercent: 0,
      isDeload: false,
    };
    const block = {
      id: 'block-1',
      workoutSessionId: 'session-1',
      exerciseId: 'ex-1',
      order: 1,
      supersetGroupId: null,
      supersetOrder: null,
      targetSets: 3,
      targetRepRange: [8, 12] as [number, number],
      targetRir: 2,
      targetWeightKg: 100,
      targetRestSeconds: 120,
      progressionType: null,
      suggestionReason: '',
      warmupProtocol: [],
      note: null,
      dropsetsPerSet: 0,
      dropPercentage: 0.25,
    };
    useWorkoutStore.getState().startSession(session, [block], []);
    useWorkoutStore.getState().setBlockFeedback('block-1', { pump: 3, workload: 1 });

    const updated = useWorkoutStore.getState().exerciseBlocks[0];
    expect(updated.pump).toBe(3);
    expect(updated.workload).toBe(1);
  });
});
