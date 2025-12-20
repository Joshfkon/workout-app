'use client';

import { Button } from '@/components/ui';
import { ElapsedRestTimer } from './ElapsedRestTimer';
import type { Exercise } from '@/types/schema';

interface ExerciseTransitionProps {
  completedExercise: Exercise;
  completedSets: number;
  nextExercise: Exercise;
  nextExercisePrescription: {
    sets: number;
    repRange: [number, number];
    notes?: string;
  };
  lastSetTimestamp: string | null;
  onStartExercise: () => void;
  onSkip?: () => void;
}

/**
 * Exercise transition screen shown when moving between exercises.
 * Displays completed exercise summary, next exercise details, and elapsed time.
 */
export function ExerciseTransition({
  completedExercise,
  completedSets,
  nextExercise,
  nextExercisePrescription,
  lastSetTimestamp,
  onStartExercise,
  onSkip,
}: ExerciseTransitionProps) {
  const { sets, repRange, notes } = nextExercisePrescription;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div className="w-full max-w-md space-y-6">
        {/* Completed exercise summary */}
        <div className="flex items-center gap-3 p-4 bg-success-500/10 border border-success-500/30 rounded-xl">
          <div className="w-10 h-10 rounded-full bg-success-500/20 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-success-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm text-success-400 font-medium">Completed</p>
            <p className="text-surface-100 font-semibold">{completedExercise.name}</p>
            <p className="text-sm text-surface-400">{completedSets} sets logged</p>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-surface-700" />
          <span className="text-surface-500 text-sm">Next Up</span>
          <div className="flex-1 h-px bg-surface-700" />
        </div>

        {/* Next exercise card */}
        <div className="p-6 bg-surface-800 border border-surface-700 rounded-xl space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-surface-100">
                {nextExercise.name}
              </h2>
              <p className="text-surface-400 mt-1">
                {sets} sets × {repRange[0]}-{repRange[1]} reps
              </p>
            </div>
            {/* Exercise icon placeholder */}
            <div className="w-12 h-12 rounded-lg bg-surface-700 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-surface-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
          </div>

          {/* Notes if present */}
          {notes && (
            <p className="text-sm text-surface-400 italic border-l-2 border-surface-600 pl-3">
              {notes}
            </p>
          )}

          {/* Muscle target */}
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full bg-primary-500/20 text-primary-400 capitalize">
              {nextExercise.primaryMuscle}
            </span>
            {nextExercise.secondaryMuscles?.slice(0, 2).map((muscle) => (
              <span
                key={muscle}
                className="text-xs px-2 py-1 rounded-full bg-surface-700 text-surface-400 capitalize"
              >
                {muscle}
              </span>
            ))}
          </div>
        </div>

        {/* Elapsed time display */}
        <div className="text-center py-4">
          <ElapsedRestTimer
            sinceTimestamp={lastSetTimestamp}
            label="Time since last set"
            size="lg"
            showLabel={true}
            className="inline-block"
          />
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          <Button
            onClick={onStartExercise}
            className="w-full py-4 text-lg font-semibold"
          >
            Start {nextExercise.name}
          </Button>

          {onSkip && (
            <button
              onClick={onSkip}
              className="w-full py-2 text-sm text-surface-500 hover:text-surface-300 transition-colors"
            >
              Skip exercise
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
