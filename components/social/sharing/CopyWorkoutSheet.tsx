'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck } from '@tabler/icons-react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { createClient } from '@/lib/supabase/client';
import { copySharedWorkout } from '@/lib/workout-sharing';
import type { SharedWorkoutWithProfile } from '@/types/social';

/** How long the "copied" confirmation shows before the sheet closes itself. */
const CLOSE_AFTER_SUCCESS_MS = 1500;

/**
 * Copies a shared workout into the viewer's templates. Used by Discover and
 * the Feed's Discover tab (they used to carry identical copies of this).
 */
export function CopyWorkoutSheet({
  workout,
  onClose,
}: {
  /** The workout to copy; null keeps the sheet closed. */
  workout: SharedWorkoutWithProfile | null;
  onClose: () => void;
}) {
  const [isCopying, setIsCopying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Feed and Discover keep one sheet mounted across workouts, so a copy that
  // finishes after the sheet was dismissed (or switched to another workout)
  // must not touch the new state. Each request takes a ticket; dismissing or
  // switching workouts invalidates outstanding tickets and the close timer.
  const ticket = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    ticket.current += 1;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setIsCopying(false);
    setSuccess(false);
    setError(null);
  };

  const workoutId = workout?.id ?? null;
  useEffect(() => {
    reset();
    // reset only touches refs and setters, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutId]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const close = () => {
    reset();
    onClose();
  };

  const handleCopy = async () => {
    if (!workout) return;
    const mine = ++ticket.current;
    setIsCopying(true);
    setError(null);

    const result = await copySharedWorkout(workout.id, createClient());
    if (mine !== ticket.current) return; // dismissed or switched meanwhile

    if (result.success) {
      setSuccess(true);
      closeTimer.current = setTimeout(close, CLOSE_AFTER_SUCCESS_MS);
    } else {
      setError(result.error || 'Failed to copy workout');
      setIsCopying(false);
    }
  };

  const exercises = workout?.workout_data?.exercises ?? [];

  return (
    <Sheet
      isOpen={workout !== null}
      onClose={close}
      title="Copy workout"
      description={workout ? `Adds “${workout.title}” to your workout templates.` : undefined}
      size="md"
      data-testid="copy-workout-sheet"
      footer={
        success ? (
          <div className="flex items-center justify-center gap-2 py-3 text-body text-status-ok">
            <IconCheck className="h-5 w-5" stroke={2} aria-hidden="true" />
            <span>Copied to your templates</span>
          </div>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" onClick={close} disabled={isCopying} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCopy} disabled={isCopying} className="flex-1">
              {isCopying ? 'Copying…' : 'Copy to my workouts'}
            </Button>
          </div>
        )
      }
    >
      {exercises.length > 0 && (
        <div className="rounded-card bg-fill p-3">
          <p className="text-caption text-ink-2 mb-2">Exercises included</p>
          <div className="space-y-1">
            {exercises.map((exercise, index) => (
              <div key={index} className="flex justify-between gap-3 text-subhead">
                <span className="text-ink">{exercise.exercise_name}</span>
                <span className="text-ink-2 tabular-nums">
                  {exercise.sets} × {exercise.rep_range[0]}–{exercise.rep_range[1]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-card bg-status-bad-tint p-3">
          <p className="text-subhead text-status-bad">{error}</p>
        </div>
      )}
    </Sheet>
  );
}
