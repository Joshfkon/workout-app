'use client';

import type { ReactNode } from 'react';
import { IconBarbell, IconPlus } from '@tabler/icons-react';

/**
 * EmptyWorkoutStart — what fills the exercise-list slot of the active workout
 * page while the session has no exercises (design system "Workout · empty").
 *
 * Top to bottom: one card with the next action — "Add exercise", then
 * "Repeat last workout", then a quiet "Build a plan for me" link — and below
 * it the readiness slot ("Fresh today" chips ranked by recovery, plus rows
 * that open the full readiness / weekly-sets sheet). The page unmounts this as
 * soon as the first block lands, so the normal exercise list takes its place.
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
  /** Fresh-today chips + readiness rows (EmptyWorkoutReadiness, lazy-loaded). */
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
      <div className="flex flex-col items-center rounded-card bg-card px-5 pt-6 pb-5 text-center shadow-card">
        <span
          className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-action-tint text-action"
          aria-hidden="true"
        >
          <IconBarbell size={28} />
        </span>
        <h2 className="text-title text-ink">Add your first exercise</h2>
        <p className="mt-1 max-w-[260px] text-subhead text-ink-2">
          Pick as you go, or repeat something you&apos;ve done before.
        </p>

        <div className="mt-5 flex w-full flex-col gap-2.5">
          <button
            type="button"
            onClick={onAddExercise}
            disabled={disabled}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-button bg-action text-headline text-on-action transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-60"
            data-testid="empty-add-exercises"
          >
            <IconPlus size={20} aria-hidden="true" />
            Add exercise
          </button>
          <button
            type="button"
            onClick={onCopyLastWorkout}
            disabled={disabled}
            className="flex min-h-[50px] w-full items-center justify-center rounded-button bg-action-tint text-headline text-action transition-[filter] hover:brightness-110 disabled:opacity-60"
            data-testid="empty-copy-last"
          >
            {isCopyingLastWorkout ? 'Copying last workout…' : 'Repeat last workout'}
          </button>
          <button
            type="button"
            onClick={onBuildPlan}
            disabled={disabled}
            className="mt-1 py-1.5 text-body font-medium text-action disabled:opacity-50"
            data-testid="empty-build-plan"
          >
            Build a plan for me
          </button>
        </div>
      </div>

      {readiness}
    </div>
  );
}

export default EmptyWorkoutStart;
