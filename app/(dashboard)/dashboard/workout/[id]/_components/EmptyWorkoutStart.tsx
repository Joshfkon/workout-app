'use client';

import type { ReactNode } from 'react';

/**
 * EmptyWorkoutStart — what fills the exercise-list slot of the active workout
 * page while the session has no exercises.
 *
 * Layout, top to bottom: the "Add exercise" call to action (always above the
 * fold), then the readiness slot (weekly volume per muscle + recovery, with
 * readiness-ranked Quick Add chips), then the secondary starts (copy last
 * workout, build a plan). The page unmounts this as soon as the first block
 * lands, so the normal exercise list takes its place.
 *
 * The readiness body is passed in as a slot so the page can keep lazy-loading
 * it (it pulls in the readiness hook + assembly, which the workout screen's
 * initial bundle doesn't need).
 */
interface EmptyWorkoutStartProps {
  onAddExercise: () => void;
  onCopyLastWorkout: () => void;
  isCopyingLastWorkout: boolean;
  onBuildPlan: () => void;
  disabled?: boolean;
  /** Weekly volume + readiness body (EmptyWorkoutReadiness, lazy-loaded). */
  readiness: ReactNode;
}

export function EmptyWorkoutStart({
  onAddExercise,
  onCopyLastWorkout,
  isCopyingLastWorkout,
  onBuildPlan,
  disabled = false,
  readiness,
}: EmptyWorkoutStartProps) {
  return (
    <div data-testid="empty-workout-start">
      <button
        type="button"
        onClick={onAddExercise}
        disabled={disabled}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-lg font-semibold shadow-lg shadow-purple-500/25 hover:from-purple-400 hover:to-indigo-500 active:scale-[0.99] disabled:opacity-60 transition-all flex items-center justify-center gap-2.5"
        data-testid="empty-add-exercises"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add exercise
      </button>

      <div className="mt-2 flex items-center justify-center gap-4 text-sm font-medium">
        <button
          type="button"
          onClick={onCopyLastWorkout}
          disabled={disabled}
          className="py-2 text-surface-400 hover:text-surface-200 disabled:opacity-50 transition-colors"
          data-testid="empty-copy-last"
        >
          {isCopyingLastWorkout ? 'Copying last workout…' : 'Copy last workout'}
        </button>
        <span className="text-surface-700" aria-hidden>
          ·
        </span>
        <button
          type="button"
          onClick={onBuildPlan}
          disabled={disabled}
          className="py-2 text-surface-400 hover:text-surface-200 disabled:opacity-50 transition-colors"
          data-testid="empty-build-plan"
        >
          Build a plan for me
        </button>
      </div>

      {readiness}
    </div>
  );
}

export default EmptyWorkoutStart;
