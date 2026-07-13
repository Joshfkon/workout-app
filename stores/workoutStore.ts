import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  WorkoutSession,
  ExerciseBlock,
  SetLog,
  PreWorkoutCheckIn,
  Exercise,
  SorenessRating,
  PumpRating0to3,
  WorkloadRating,
} from '@/types/schema';

/**
 * One start-of-session soreness ask (additive feedback field on the workout
 * record). `rating` is null when the prompt was dismissed by logging a set
 * without answering — the muscle is never re-asked this session either way.
 */
export interface SorenessAskRecord {
  rating: SorenessRating | null;
  askedAt: string; // ISO timestamp
}

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

  // Subjective feedback (additive) — soreness asks keyed by StandardMuscleGroup
  muscleSorenessAsked: Record<string, SorenessAskRecord>;

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

  // Subjective feedback
  recordSorenessAsked: (muscle: string, rating: SorenessRating | null) => void;
  setBlockFeedback: (
    blockId: string,
    feedback: { pump?: PumpRating0to3; workload?: WorkloadRating }
  ) => void;

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
      muscleSorenessAsked: {},

      startSession: (session, blocks, exercises) => {
        const exerciseRecord: Record<string, Exercise> = {};
        exercises.forEach((ex) => { exerciseRecord[ex.id] = ex; });

        // The workout page re-syncs the same session whenever its blocks
        // change (exercise added, page reload). Wiping setLogs on those
        // re-syncs zeroed the resume pill's "N/M sets" progress count.
        const isSameSession = get().activeSession?.id === session.id;

        set({
          activeSession: session,
          exerciseBlocks: blocks,
          setLogs: isSameSession ? get().setLogs : {},
          currentBlockIndex: 0,
          isPaused: false,
          pausedAt: null,
          exercises: exerciseRecord,
          restTimerEnd: null,
          muscleSorenessAsked: isSameSession ? get().muscleSorenessAsked : {},
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
          muscleSorenessAsked: {},
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

      recordSorenessAsked: (muscle, rating) => {
        const { muscleSorenessAsked } = get();
        // Once asked (answered or dismissed), never re-ask this session.
        if (muscleSorenessAsked[muscle]) return;
        set({
          muscleSorenessAsked: {
            ...muscleSorenessAsked,
            [muscle]: { rating, askedAt: new Date().toISOString() },
          },
        });
      },

      setBlockFeedback: (blockId, feedback) => {
        const { exerciseBlocks } = get();
        set({
          exerciseBlocks: exerciseBlocks.map((b) =>
            b.id === blockId ? { ...b, ...feedback } : b
          ),
        });
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
        // Soreness asks survive reloads so a muscle is never re-asked.
        muscleSorenessAsked: state.muscleSorenessAsked,
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
