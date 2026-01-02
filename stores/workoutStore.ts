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

  // Pause state
  isPaused: boolean;
  pausedAt: number | null; // Timestamp when paused

  // Cached exercise data
  exercises: Map<string, Exercise>;

  // Timer state
  restTimerEnd: number | null;

  // Warmup completion tracking (persisted per block)
  completedWarmups: Map<string, Set<number>>; // blockId -> set of completed warmup setNumbers

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

  // Warmup tracking
  toggleWarmupComplete: (blockId: string, setNumber: number) => void;
  setAllWarmupsComplete: (blockId: string, setNumbers: number[]) => void;
  getCompletedWarmupsForBlock: (blockId: string) => Set<number>;

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
      isPaused: false,
      pausedAt: null,
      exercises: new Map(),
      restTimerEnd: null,
      completedWarmups: new Map(),

      startSession: (session, blocks, exercises) => {
        const exerciseMap = new Map<string, Exercise>();
        exercises.forEach((ex) => exerciseMap.set(ex.id, ex));

        set({
          activeSession: session,
          exerciseBlocks: blocks,
          setLogs: new Map(),
          currentBlockIndex: 0,
          isPaused: false,
          pausedAt: null,
          exercises: exerciseMap,
          restTimerEnd: null,
          completedWarmups: new Map(),
        });
      },

      endSession: () => {
        set({
          activeSession: null,
          exerciseBlocks: [],
          setLogs: new Map(),
          currentBlockIndex: 0,
          isPaused: false,
          pausedAt: null,
          exercises: new Map(),
          restTimerEnd: null,
          completedWarmups: new Map(),
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
        const newMap = new Map(setLogs);
        const blockSets = newMap.get(blockId) || [];
        newMap.set(blockId, [...blockSets, setData]);
        set({ setLogs: newMap });
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

      toggleWarmupComplete: (blockId, setNumber) => {
        const { completedWarmups } = get();
        const newMap = new Map(completedWarmups);
        const blockWarmups = newMap.get(blockId) || new Set();
        const newBlockWarmups = new Set(blockWarmups);

        if (newBlockWarmups.has(setNumber)) {
          newBlockWarmups.delete(setNumber);
        } else {
          newBlockWarmups.add(setNumber);
        }

        newMap.set(blockId, newBlockWarmups);
        set({ completedWarmups: newMap });
      },

      setAllWarmupsComplete: (blockId, setNumbers) => {
        const { completedWarmups } = get();
        const newMap = new Map(completedWarmups);
        newMap.set(blockId, new Set(setNumbers));
        set({ completedWarmups: newMap });
      },

      getCompletedWarmupsForBlock: (blockId) => {
        const { completedWarmups } = get();
        return completedWarmups.get(blockId) || new Set();
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
        isPaused: state.isPaused,
        pausedAt: state.pausedAt,
        exercises: Array.from(state.exercises.entries()),
        // Serialize completedWarmups: Map<string, Set<number>> -> Array<[string, number[]]>
        completedWarmups: Array.from(state.completedWarmups.entries()).map(
          ([blockId, setNumbers]) => [blockId, Array.from(setNumbers)]
        ),
      }),
      onRehydrateStorage: () => (state) => {
        // Convert Maps back after rehydration
        if (state && Array.isArray(state.setLogs)) {
          state.setLogs = new Map(state.setLogs as any);
        }
        if (state && Array.isArray(state.exercises)) {
          state.exercises = new Map(state.exercises as any);
        }
        // Deserialize completedWarmups: Array<[string, number[]]> -> Map<string, Set<number>>
        if (state && Array.isArray(state.completedWarmups)) {
          state.completedWarmups = new Map(
            (state.completedWarmups as [string, number[]][]).map(
              ([blockId, setNumbers]) => [blockId, new Set(setNumbers)]
            )
          );
        } else if (state) {
          state.completedWarmups = new Map();
        }
      },
    }
  )
);

