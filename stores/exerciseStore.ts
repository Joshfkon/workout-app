import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Exercise, MuscleGroup, MovementPattern } from '@/types/schema';

interface ExerciseState {
  // Exercise library cache
  exercises: Exercise[];
  isLoading: boolean;
  lastFetched: number | null;
  
  // Actions
  setExercises: (exercises: Exercise[]) => void;
  addExercise: (exercise: Exercise) => void;
  updateExercise: (id: string, data: Partial<Exercise>) => void;
  
  // Getters
  getExerciseById: (id: string) => Exercise | undefined;
  getExercisesByMuscle: (muscle: string) => Exercise[];
  getExercisesByPattern: (pattern: string) => Exercise[];
  searchExercises: (query: string) => Exercise[];
  
  // Cache management
  shouldRefetch: () => boolean;
  setLoading: (loading: boolean) => void;
}

const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export const useExerciseStore = create<ExerciseState>()(
  persist(
    (set, get) => ({
      exercises: [],
      isLoading: false,
      lastFetched: null,

      setExercises: (exercises) => {
        set({
          exercises,
          lastFetched: Date.now(),
          isLoading: false,
        });
      },

      addExercise: (exercise) => {
        const { exercises } = get();
        set({ exercises: [...exercises, exercise] });
      },

      updateExercise: (id, data) => {
        const { exercises } = get();
        set({
          exercises: exercises.map((ex) =>
            ex.id === id ? { ...ex, ...data } : ex
          ),
        });
      },

      getExerciseById: (id) => {
        const { exercises } = get();
        return exercises.find((ex) => ex.id === id);
      },

      getExercisesByMuscle: (muscle) => {
        const { exercises } = get();
        return exercises.filter(
          (ex) =>
            ex.primaryMuscle.toLowerCase() === muscle.toLowerCase() ||
            ex.secondaryMuscles.some(
              (m) => m.toLowerCase() === muscle.toLowerCase()
            )
        );
      },

      getExercisesByPattern: (pattern) => {
        const { exercises } = get();
        return exercises.filter(
          (ex) => ex.movementPattern.toLowerCase() === pattern.toLowerCase()
        );
      },

      searchExercises: (query) => {
        const { exercises } = get();
        const lowerQuery = query.toLowerCase();
        return exercises.filter(
          (ex) =>
            ex.name.toLowerCase().includes(lowerQuery) ||
            ex.primaryMuscle.toLowerCase().includes(lowerQuery) ||
            ex.movementPattern.toLowerCase().includes(lowerQuery)
        );
      },

      shouldRefetch: () => {
        const { lastFetched, exercises } = get();
        if (exercises.length === 0) return true;
        if (!lastFetched) return true;
        return Date.now() - lastFetched > CACHE_DURATION;
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },
    }),
    {
      name: 'exercise-storage',
      partialize: (state) => ({
        exercises: state.exercises,
        lastFetched: state.lastFetched,
      }),
    }
  )
);

