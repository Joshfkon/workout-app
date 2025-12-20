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
  setLogs: Map<string, SetLog[]>; // blockId -> sets
  currentBlockIndex: number;

  // Cached exercise data
  exercises: Map<string, Exercise>;

  // Timer state
  restTimerEnd: number | null;

  // Elapsed time tracking
  lastSetCompletedAt: string | null; // ISO timestamp of last logged set
  exerciseStartedAt: string | null; // ISO timestamp when current exercise was started
  
  // Actions
  startSession: (session: WorkoutSession, blocks: ExerciseBlock[], exercises: Exercise[]) => void;
  endSession: () => void;
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

  // Elapsed time tracking
  setLastSetCompletedAt: (timestamp: string | null) => void;
  setExerciseStartedAt: (timestamp: string | null) => void;

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
      setLogs: new Map(),
      currentBlockIndex: 0,
      exercises: new Map(),
      restTimerEnd: null,
      lastSetCompletedAt: null,
      exerciseStartedAt: null,

      startSession: (session, blocks, exercises) => {
        const exerciseMap = new Map<string, Exercise>();
        exercises.forEach((ex) => exerciseMap.set(ex.id, ex));

        set({
          activeSession: session,
          exerciseBlocks: blocks,
          setLogs: new Map(),
          currentBlockIndex: 0,
          exercises: exerciseMap,
          restTimerEnd: null,
          lastSetCompletedAt: null,
          exerciseStartedAt: null,
        });
      },

      endSession: () => {
        set({
          activeSession: null,
          exerciseBlocks: [],
          setLogs: new Map(),
          currentBlockIndex: 0,
          restTimerEnd: null,
          lastSetCompletedAt: null,
          exerciseStartedAt: null,
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
        const newMap = new Map(setLogs);
        const blockSets = newMap.get(blockId) || [];
        newMap.set(blockId, [...blockSets, setData]);
        // Update lastSetCompletedAt with the set's logged timestamp
        set({
          setLogs: newMap,
          lastSetCompletedAt: setData.loggedAt || new Date().toISOString(),
        });
      },

      updateSet: (blockId, setId, data) => {
        const { setLogs } = get();
        const newMap = new Map(setLogs);
        const blockSets = newMap.get(blockId) || [];
        const updatedSets = blockSets.map((s) =>
          s.id === setId ? { ...s, ...data } : s
        );
        newMap.set(blockId, updatedSets);
        set({ setLogs: newMap });
      },

      deleteSet: (blockId, setId) => {
        const { setLogs } = get();
        const newMap = new Map(setLogs);
        const blockSets = newMap.get(blockId) || [];
        newMap.set(blockId, blockSets.filter((s) => s.id !== setId));
        set({ setLogs: newMap });
      },

      getSetsForBlock: (blockId) => {
        const { setLogs } = get();
        return setLogs.get(blockId) || [];
      },

      startRestTimer: (seconds) => {
        set({ restTimerEnd: Date.now() + seconds * 1000 });
      },

      clearRestTimer: () => {
        set({ restTimerEnd: null });
      },

      setLastSetCompletedAt: (timestamp) => {
        set({ lastSetCompletedAt: timestamp });
      },

      setExerciseStartedAt: (timestamp) => {
        set({ exerciseStartedAt: timestamp });
      },

      getSessionStats: () => {
        const { setLogs } = get();
        let totalSets = 0;
        let totalReps = 0;
        let totalVolume = 0;
        let totalRpe = 0;

        setLogs.forEach((sets) => {
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
      partialize: (state) => ({
        activeSession: state.activeSession,
        exerciseBlocks: state.exerciseBlocks,
        setLogs: Array.from(state.setLogs.entries()),
        currentBlockIndex: state.currentBlockIndex,
        lastSetCompletedAt: state.lastSetCompletedAt,
        exerciseStartedAt: state.exerciseStartedAt,
      }),
      onRehydrateStorage: () => (state) => {
        // Convert setLogs back to Map after rehydration
        if (state && Array.isArray(state.setLogs)) {
          state.setLogs = new Map(state.setLogs as any);
        }
      },
    }
  )
);

