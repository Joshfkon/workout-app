'use client';

/**
 * The frame of the just-started workout's preview (see WorkoutStartPreview):
 * title, progress line, the first exercise's card and what comes after it.
 * Shared by the workout screen and the route's loading boundary: right after
 * Start, Next shows `workout/[id]/loading.tsx` while the workout screen's
 * code arrives, and that used to be three grey cards (UX panel round 21,
 * Dre: "skeleton loaders after start"). Since round 23 the boundary renders
 * the full preview, logger included (see PendingStartFallback).
 */

import type { ReactNode } from 'react';
import { IconLoader2 } from '@tabler/icons-react';
import { convertWeightForDisplay, formatWeightValue } from '@/lib/utils';
import type {
  PendingBuildStage,
  PendingWorkoutPreview,
  PendingWorkoutPreviewExercise,
} from '@/lib/training/pendingWorkoutStart';
import type { WeightUnit } from '@/types/schema';

/** Prefilled weight in display units, as the logger's text field holds it ('' = none). */
export function previewWeightInput(weightKg: number, unit: WeightUnit): string {
  if (!(weightKg > 0)) return '';
  return String(formatWeightValue(weightKg, unit));
}

/**
 * The one plain line under the prefilled numbers. Claims history only when
 * the start read it (the lift's last best set); otherwise it says nothing
 * about where a number came from beyond "suggested". The full card, with the
 * exact source, replaces this within moments.
 */
export function previewReasonLine(
  exercise: Pick<PendingWorkoutPreviewExercise, 'weightKg' | 'repRange' | 'lastTopSet'>,
  unit: WeightUnit | null
): string {
  if (exercise.lastTopSet && unit) {
    const w = convertWeightForDisplay(exercise.lastTopSet.weightKg, unit);
    return `Last time your best set was ${w} ${unit === 'kg' ? 'kg' : 'lbs'} × ${exercise.lastTopSet.repCount}; today builds on it. Change it before you log if it feels off.`;
  }
  if (exercise.weightKg > 0) {
    return 'Suggested starting weight for this lift. Change it before you log if it feels off.';
  }
  return `Pick a weight you could lift about ${exercise.repRange[1]} times with good form. Suggestions learn from what you log.`;
}

/** Prefilled reps: the start's own number, else the bottom of the range. */
export function previewRepsInput(exercise: Pick<PendingWorkoutPreviewExercise, 'prefillReps' | 'repRange'>): string {
  const { prefillReps, repRange } = exercise;
  return String(prefillReps && prefillReps > 0 ? prefillReps : repRange[0]);
}

/**
 * The status line over the preview. When set 1 can be logged right here, it
 * leads with that: "Getting the rest of your workout ready…" alone read as
 * "wait" (UX panel round 22, Maya and Frank both waited instead of logging).
 */
export function previewStatusLine(stage: PendingBuildStage | null, canLogNow = false, ready = false): string {
  if (ready) return 'Your full workout is ready. Log set 1 here, or open the full workout below.';
  if (canLogNow) return 'Set 1 is ready to log. The rest of your workout loads while you lift.';
  if (stage === 'building') return 'Picking weights for the rest of your workout…';
  if (stage === 'saving') return 'Saving your exercises…';
  return 'Getting the rest of your workout ready…';
}

export function PreviewReason({
  exercise,
  unit,
}: {
  exercise: PendingWorkoutPreviewExercise;
  unit: WeightUnit | null;
}) {
  return (
    <p className="px-1 text-caption text-ink-2" data-testid="preview-reason">
      <span className="font-semibold text-action">Why: </span>
      {previewReasonLine(exercise, unit)}
    </p>
  );
}

export function WorkoutStartPreviewShell({
  preview,
  stage,
  canLogNow = false,
  ready = false,
  children,
}: {
  preview: PendingWorkoutPreview;
  stage: PendingBuildStage | null;
  /** Set 1's logger is showing: the status line says so instead of "getting ready". */
  canLogNow?: boolean;
  /** The full workout has loaded behind the preview (no spinner, says so). */
  ready?: boolean;
  /** The first set: the logger on the workout screen, the numbers while its code loads. */
  children: ReactNode;
}) {
  const first = preview.exercises[0];
  const rest = preview.exercises.slice(1);
  return (
    <div className="max-w-2xl mx-auto space-y-4" data-testid="workout-start-preview">
      <div className="pt-4">
        <h1 className="text-title font-bold text-ink">Today&apos;s workout</h1>
        <p role="status" className="mt-1 flex items-center gap-1.5 text-subhead text-ink-3">
          {!ready && <IconLoader2 size={14} className="animate-spin flex-shrink-0" aria-hidden="true" />}
          {previewStatusLine(stage, canLogNow, ready)}
        </p>
      </div>

      <section className="rounded-card bg-card shadow-card p-4 space-y-3" aria-label={first.name}>
        <div>
          <h2 className="text-headline font-semibold text-ink">{first.name}</h2>
          <p className="text-subhead text-ink-2">
            {first.targetSets} sets × {first.repRange[0]}–{first.repRange[1]} reps
          </p>
        </div>
        {children}
      </section>

      {rest.length > 0 && (
        <div className="rounded-card bg-card/60 px-4 py-3" data-testid="preview-up-next">
          <p className="text-caption font-semibold text-ink-3">Then</p>
          <ol className="mt-1 space-y-0.5">
            {rest.map((ex, i) => (
              <li key={`${ex.exerciseId}-${i}`} className="text-subhead text-ink-2">
                {ex.name}
                <span className="text-ink-3"> · {ex.targetSets} sets</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** The prefilled first set as text, where there is no logger (loading boundary, unit not known yet). */
export function PreviewFirstSetSummary({
  preview,
  unit,
}: {
  preview: PendingWorkoutPreview;
  unit: WeightUnit | null;
}) {
  const first = preview.exercises[0];
  const weight = unit ? previewWeightInput(first.weightKg, unit) : '';
  return (
    <>
      <p className="text-title font-semibold text-ink" data-testid="preview-first-set">
        {weight
          ? `${weight} ${unit === 'kg' ? 'kg' : 'lbs'} × ${previewRepsInput(first)}`
          : `Set 1 · ${first.repRange[0]}–${first.repRange[1]} reps`}
      </p>
      <PreviewReason exercise={first} unit={unit} />
    </>
  );
}
