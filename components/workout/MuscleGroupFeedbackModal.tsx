'use client';

/**
 * MuscleGroupFeedbackModal — the "Finish Workout?" popup.
 *
 * Replaces the per-exercise pump/workload chip rows: instead of asking after
 * every exercise, the questions are asked ONCE per muscle group trained, in
 * the confirmation popup that opens when the user taps "Finish Workout".
 *
 * Doubles as the finish confirmation (finishing is easy to hit by accident),
 * so it always shows the sets-logged message and Keep Training / Finish
 * buttons. Every chip row is skippable — finishing is never blocked on an
 * answer, and unanswered muscles simply submit no pump and the default
 * workload downstream.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import type {
  PumpRating0to3,
  StandardMuscleGroup,
  WorkloadRating,
} from '@/types/schema';
import { PUMP_CHIPS, WORKLOAD_CHIPS } from './FeedbackChips';

export type MuscleFeedbackRatings = Partial<
  Record<StandardMuscleGroup, { pump?: PumpRating0to3; workload?: WorkloadRating }>
>;

export interface MuscleGroupFeedbackModalProps {
  isOpen: boolean;
  /** "Keep Training" — closes without finishing. */
  onClose: () => void;
  /** Finish the workout, carrying whatever was rated (possibly nothing). */
  onConfirm: (ratings: MuscleFeedbackRatings) => void;
  /** Muscle groups trained this session (≥1 working set), in workout order. */
  muscles: StandardMuscleGroup[];
  /**
   * Seed ratings (e.g. legacy per-exercise chip answers on a resumed
   * session) so an already-given answer is never re-asked from scratch.
   */
  initialRatings?: MuscleFeedbackRatings;
  /** Contextual confirm message (e.g. "You've logged 12 of 15 sets…"). */
  message: string;
}

const chipBase =
  'px-2.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors whitespace-nowrap';
const chipIdle =
  'bg-surface-800 border-surface-700 text-surface-300 active:bg-surface-700';
const chipSelected = 'bg-primary-500/20 border-primary-500/60 text-primary-300';

export function MuscleGroupFeedbackModal({
  isOpen,
  onClose,
  onConfirm,
  muscles,
  initialRatings,
  message,
}: MuscleGroupFeedbackModalProps) {
  const [ratings, setRatings] = useState<MuscleFeedbackRatings>({});

  // Re-seed each time the popup opens: the trained-muscle set (and any
  // legacy seeds) may have changed since the last open.
  useEffect(() => {
    if (isOpen) setRatings(initialRatings ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const setRating = (
    muscle: StandardMuscleGroup,
    partial: { pump?: PumpRating0to3; workload?: WorkloadRating }
  ) => {
    setRatings((prev) => ({ ...prev, [muscle]: { ...prev[muscle], ...partial } }));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" showCloseButton={false}>
      <div data-testid="muscle-feedback-modal">
        <h3 className="text-lg font-semibold text-surface-100">Finish Workout?</h3>
        <p className="text-sm text-surface-400 mt-1">{message}</p>

        {muscles.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-surface-500">
              How did each muscle feel? Tunes next week&apos;s sets — skip anything
              you&apos;re unsure about.
            </p>
            {muscles.map((muscle) => {
              const current = ratings[muscle];
              return (
                <div
                  key={muscle}
                  className="rounded-lg bg-surface-800/50 border border-surface-800 px-2.5 py-2 space-y-1.5"
                  data-testid={`muscle-feedback-${muscle}`}
                >
                  <div className="text-[13px] font-medium text-surface-200">
                    {STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    <span className="text-[12px] text-surface-400 flex-shrink-0 w-[68px]">
                      Pump:
                    </span>
                    {PUMP_CHIPS.map((chip) => (
                      <button
                        key={chip.value}
                        type="button"
                        onClick={() => setRating(muscle, { pump: chip.value })}
                        className={`${chipBase} ${
                          current?.pump === chip.value ? chipSelected : chipIdle
                        }`}
                        data-testid={`finish-pump-${muscle}-${chip.value}`}
                      >
                        {chip.bar} {chip.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    <span className="text-[12px] text-surface-400 flex-shrink-0 w-[68px]">
                      Workload:
                    </span>
                    {WORKLOAD_CHIPS.map((chip) => (
                      <button
                        key={chip.value}
                        type="button"
                        onClick={() => setRating(muscle, { workload: chip.value })}
                        className={`${chipBase} ${
                          current?.workload === chip.value ? chipSelected : chipIdle
                        }`}
                        data-testid={`finish-workload-${muscle}-${chip.value}`}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-3 w-full mt-5">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Keep Training
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => onConfirm(ratings)}
            data-testid="muscle-feedback-finish"
          >
            Finish
          </Button>
        </div>
      </div>
    </Modal>
  );
}
