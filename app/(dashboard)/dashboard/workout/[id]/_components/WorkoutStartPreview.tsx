'use client';

/**
 * The workout screen while a just-started workout is still being saved and
 * loaded: the first exercise, usable, instead of a skeleton.
 *
 * UX panel round 21 (3 of 6): "The page looked half-loaded right after
 * starting the workout" / "skeleton loaders after start, so I had to wait
 * before I could log". Round 21 made Start navigate first; this renders what
 * the start already knew (lib/training/pendingWorkoutStart preview) — the
 * exercise, its prefilled first set and Log set — while the rows are written
 * and the screen loads its history. A set logged here is held and replayed
 * through the screen's normal logging path once it is ready (same write,
 * rest timer and checks), so nothing about how a set is saved changes.
 */

import { useState } from 'react';
import { IconCircleCheckFilled } from '@tabler/icons-react';
import { SetLoggerRow } from '@/components/workout/SetLoggerRow';
import { convertWeightForDisplay } from '@/lib/utils';
import { getSetReps } from '@/services/shared/setModality';
import type {
  EarlyLoggedSet,
  PendingBuildStage,
  PendingWorkoutPreview,
  PendingWorkoutPreviewExercise,
} from '@/lib/training/pendingWorkoutStart';
import type { WeightUnit } from '@/types/schema';
import {
  PreviewFirstSetSummary,
  PreviewReason,
  WorkoutStartPreviewShell,
  previewRepsInput,
  previewWeightInput,
} from './WorkoutStartPreviewShell';

export { previewReasonLine, previewRepsInput, previewStatusLine, previewWeightInput } from './WorkoutStartPreviewShell';

function PreviewLogger({
  exercise,
  unit,
  onLogFirstSet,
}: {
  exercise: PendingWorkoutPreviewExercise;
  unit: WeightUnit;
  onLogFirstSet: (set: EarlyLoggedSet) => void;
}) {
  const [weight, setWeight] = useState(() => previewWeightInput(exercise.weightKg, unit));
  const [reps, setReps] = useState(() => previewRepsInput(exercise));
  return (
    <>
      <SetLoggerRow
        setNumber={1}
        weight={weight}
        reps={reps}
        onWeightChange={setWeight}
        onRepsChange={setReps}
        targetRir={exercise.targetRir}
        unit={unit}
        minIncrementKg={exercise.minIncrementKg}
        exerciseId={exercise.exerciseId}
        stickyLabel={exercise.name}
        onLog={(data) =>
          onLogFirstSet({
            exerciseId: exercise.exerciseId,
            weightKg: data.weightKg,
            // Duration lifts never reach this logger (loggable), so null asserts rep-based.
            repCount: getSetReps(data, null) ?? 0,
            rpe: data.rpe,
            note: data.note,
            feedback: data.feedback,
          })
        }
      />
      <PreviewReason exercise={exercise} unit={unit} />
    </>
  );
}

export function WorkoutStartPreview({
  preview,
  stage,
  unit,
  earlySet,
  onLogFirstSet,
}: {
  preview: PendingWorkoutPreview;
  stage: PendingBuildStage | null;
  /** Null until the lifter's unit is known: the numbers show, logging waits. */
  unit: WeightUnit | null;
  earlySet: EarlyLoggedSet | null;
  onLogFirstSet: (set: EarlyLoggedSet) => void;
}) {
  const first = preview.exercises[0];
  const unitLabel = unit === 'kg' ? 'kg' : 'lbs';

  return (
    <WorkoutStartPreviewShell preview={preview} stage={stage}>
      {earlySet && unit ? (
        <p
          className="flex items-start gap-2 rounded-lg bg-status-ok-tint px-3 py-2 text-subhead text-ink"
          data-testid="preview-set-logged"
        >
          <IconCircleCheckFilled size={18} className="mt-0.5 flex-shrink-0 text-status-ok" aria-hidden="true" />
          <span>
            Set 1 logged: {convertWeightForDisplay(earlySet.weightKg, unit)} {unitLabel} × {earlySet.repCount}. It
            saves with your workout in a moment, and your rest timer starts then.
          </span>
        </p>
      ) : first.loggable && unit ? (
        <PreviewLogger key={unit} exercise={first} unit={unit} onLogFirstSet={onLogFirstSet} />
      ) : (
        <PreviewFirstSetSummary preview={preview} unit={unit} />
      )}
    </WorkoutStartPreviewShell>
  );
}
