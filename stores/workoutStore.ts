import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  WorkoutSession,
  ExerciseBlock,
  SetLog,
  PreWorkoutCheckIn,
  Exercise,
} from '@/types/schema';

interface WorkoutState {
  // Current session
  activeSession: WorkoutSession | null;
  exerciseBlocks: ExerciseBlock[];
  setLogs: Record<string, SetLog[]>; // blockId -> sets
  currentBlockIndex: number;

  // Pause state
  isPaused: boolean;
  pausedAt: number | null; // Timestamp when paused

  // Cached exercise data
  exercises: Record<string, Exercise>;

  // Timer state
  restTimerEnd: number | null;

  // Actions
  startSession: (session: WorkoutSession, blocks: ExerciseBlock[], exercises: Exercise[]) => void;
  endSession: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  setCheckIn: (checkIn: PreWorkoutCheckIn) => void;

  // Exercise navigation
  setCurrentBlock: (index: number) => void;
  nextBlock: () => void;
  previousBlock: () => void;

  // Set logging
  logSet: (blockId: string, set: SetLog) => void;
  updateSet: (blockId: string, setId: string, data: Partial<SetLog>) => void;
  deleteSet: (blockId: string, setId: string) => void;
  getSetsForBlock: (blockId: string) => SetLog[];

  // Timer
  startRestTimer: (seconds: number) => void;
  clearRestTimer: () => void;

  // Session summary
  getSessionStats: () => {
    totalSets: number;
    totalReps: number;
    totalVolume: number;
    avgRpe: number;
  };
}

export const useWorkoutStore = create<WorkoutState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      exerciseBlocks: [],
      setLogs: {},
      currentBlockIndex: 0,
      isPaused: false,
      pausedAt: null,
      exercises: {},
      restTimerEnd: null,

      startSession: (session, blocks, exercises) => {
        const exerciseRecord: Record<string, Exercise> = {};
        exercises.forEach((ex) => { exerciseRecord[ex.id] = ex; });

        set({
          activeSession: session,
          exerciseBlocks: blocks,
          setLogs: {},
          currentBlockIndex: 0,
          isPaused: false,
          pausedAt: null,
          exercises: exerciseRecord,
          restTimerEnd: null,
        });
      },

      endSession: () => {
        set({
          activeSession: null,
          exerciseBlocks: [],
          setLogs: {},
          currentBlockIndex: 0,
          isPaused: false,
          pausedAt: null,
          exercises: {},
          restTimerEnd: null,
        });
      },

      pauseSession: () => {
        const { activeSession } = get();
        if (!activeSession) return;

        set({
          isPaused: true,
          pausedAt: Date.now(),
        });
      },

      resumeSession: () => {
        set({
          isPaused: false,
          pausedAt: null,
        });
      },

      setCheckIn: (checkIn) => {
        const { activeSession } = get();
        if (!activeSession) return;

        set({
          activeSession: {
            ...activeSession,
            preWorkoutCheckIn: checkIn,
          },
        });
      },

      setCurrentBlock: (index) => {
        const { exerciseBlocks } = get();
        if (index >= 0 && index < exerciseBlocks.length) {
          set({ currentBlockIndex: index });
        }
      },

      nextBlock: () => {
        const { currentBlockIndex, exerciseBlocks } = get();
        if (currentBlockIndex < exerciseBlocks.length - 1) {
          set({ currentBlockIndex: currentBlockIndex + 1 });
        }
      },

      previousBlock: () => {
        const { currentBlockIndex } = get();
        if (currentBlockIndex > 0) {
          set({ currentBlockIndex: currentBlockIndex - 1 });
        }
      },

      logSet: (blockId, setData) => {
        const { setLogs } = get();
        const blockSets = setLogs[blockId] || [];
        set({ setLogs: { ...setLogs, [blockId]: [...blockSets, setData] } });
      },

      updateSet: (blockId, setId, data) => {
        const { setLogs } = get();
        const blockSets = setLogs[blockId] || [];
        const updatedSets = blockSets.map((s) =>
          s.id === setId ? { ...s, ...data } : s
        );
        set({ setLogs: { ...setLogs, [blockId]: updatedSets } });
      },

      deleteSet: (blockId, setId) => {
        const { setLogs } = get();
        const blockSets = setLogs[blockId] || [];
        set({ setLogs: { ...setLogs, [blockId]: blockSets.filter((s) => s.id !== setId) } });
      },

      getSetsForBlock: (blockId) => {
        const { setLogs } = get();
        return setLogs[blockId] || [];
      },

      startRestTimer: (seconds) => {
        set({ restTimerEnd: Date.now() + seconds * 1000 });
      },

      clearRestTimer: () => {
        set({ restTimerEnd: null });
      },

      getSessionStats: () => {
        const { setLogs } = get();
        let totalSets = 0;
        let totalReps = 0;
        let totalVolume = 0;
        let totalRpe = 0;

        Object.values(setLogs).forEach((sets) => {
          const workingSets = sets.filter((s) => !s.isWarmup);
          totalSets += workingSets.length;
          workingSets.forEach((s) => {
            totalReps += s.reps;
            totalVolume += s.weightKg * s.reps;
            totalRpe += s.rpe;
          });
        });

        return {
          totalSets,
          totalReps,
          totalVolume: Math.round(totalVolume),
          avgRpe: totalSets > 0 ? Math.round((totalRpe / totalSets) * 10) / 10 : 0,
        };
      },
    }),
    {
      name: 'workout-storage',
      version: 1,
      partialize: (state) => ({
        activeSession: state.activeSession,
        exerciseBlocks: state.exerciseBlocks,
        setLogs: state.setLogs,
        currentBlockIndex: state.currentBlockIndex,
        isPaused: state.isPaused,
        pausedAt: state.pausedAt,
        exercises: state.exercises,
        // Persist the rest-timer end timestamp so a page refresh / app restart
        // doesn't drop an in-flight timer. It's an absolute epoch-ms value, so
        // remaining time is recomputed from Date.now() on rehydrate.
        restTimerEnd: state.restTimerEnd,
      }),
      // Migrate stale persisted shapes forward. A pre-versioned (version 0)
      // payload predates restTimerEnd persistence; default it so old data
      // can't corrupt new code.
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;
        if (version === 0) {
          // restTimerEnd was never persisted before v1; default it.
          if (!('restTimerEnd' in state)) {
            state.restTimerEnd = null;
          }
        }
        return state;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Recompute the rest timer from the absolute end timestamp. If it has
        // already elapsed (timer finished while the app was closed), clear it
        // so the UI doesn't show a phantom expired timer.
        if (typeof state.restTimerEnd === 'number' && state.restTimerEnd <= Date.now()) {
          state.restTimerEnd = null;
        }

        // Clear/clamp a stale pause. If we were paused but the timestamp is
        // missing or in the future (clock skew / corruption), reset pause state
        // so the session resumes cleanly rather than getting stuck.
        if (state.isPaused) {
          if (typeof state.pausedAt !== 'number' || state.pausedAt > Date.now()) {
            state.isPaused = false;
            state.pausedAt = null;
          }
        } else if (state.pausedAt != null) {
          // Not paused but a stale pausedAt lingered — drop it.
          state.pausedAt = null;
        }
      },
    }
  )
);
