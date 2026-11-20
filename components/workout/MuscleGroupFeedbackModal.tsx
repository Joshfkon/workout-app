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
import { successHaptic } from '@/lib/integrations/notifications';

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

// Segmented controls (design system): one track per question, the picked
// answer lifts onto a card-coloured pill.
const segTrack = 'flex flex-1 min-w-0 rounded-[10px] bg-fill p-0.5';
const segBase =
  'flex-1 min-w-0 min-h-[34px] rounded-[8px] px-1 text-subhead leading-tight text-ink transition-colors';
const segIdle = 'font-medium';
const segSelected = 'bg-card font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.14)]';

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

  const handleConfirm = () => {
    void successHaptic();
    onConfirm(ratings);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" showCloseButton={false}>
      <div data-testid="muscle-feedback-modal">
        {/* Title kept as "Finish Workout?" (tests and muscle memory); sheet
            styling comes from Modal → Sheet. */}
        <h3 className="text-title text-ink">Finish Workout?</h3>
        <p className="text-subhead text-ink-2 mt-1">{message}</p>

        {muscles.length > 0 && (
          <div className="mt-5 space-y-3">
            <div>
              <p className="text-body font-semibold text-ink">How did each muscle feel?</p>
              <p className="text-subhead text-ink-2">
                Optional. Tunes next week&apos;s sets — skip anything you&apos;re unsure about.
              </p>
            </div>
            {muscles.map((muscle) => {
              const current = ratings[muscle];
              return (
                <div
                  key={muscle}
                  className="rounded-card bg-canvas px-3.5 py-3 space-y-2.5"
                  data-testid={`muscle-feedback-${muscle}`}
                >
                  <div className="text-body font-semibold text-ink">
                    {STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-[72px] flex-shrink-0 text-caption text-ink-2">Pump</span>
                    <div className={segTrack} role="radiogroup" aria-label={`Pump for ${STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}`}>
                      {PUMP_CHIPS.map((chip) => (
                        <button
                          key={chip.value}
                          type="button"
                          role="radio"
                          aria-checked={current?.pump === chip.value}
                          onClick={() => setRating(muscle, { pump: chip.value })}
                          className={`${segBase} ${current?.pump === chip.value ? segSelected : segIdle}`}
                          data-testid={`finish-pump-${muscle}-${chip.value}`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-[72px] flex-shrink-0 text-caption text-ink-2">Workload</span>
                    <div className={segTrack} role="radiogroup" aria-label={`Workload for ${STANDARD_MUSCLE_DISPLAY_NAMES[muscle]}`}>
                      {WORKLOAD_CHIPS.map((chip) => (
                        <button
                          key={chip.value}
                          type="button"
                          role="radio"
                          aria-checked={current?.workload === chip.value}
                          onClick={() => setRating(muscle, { workload: chip.value })}
                          className={`${segBase} ${current?.workload === chip.value ? segSelected : segIdle}`}
                          data-testid={`finish-workload-${muscle}-${chip.value}`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-1">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={handleConfirm}
            data-testid="muscle-feedback-finish"
          >
            Finish
          </Button>
          <Button variant="tertiary" className="w-full" onClick={onClose}>
            Keep Training
          </Button>
        </div>
      </div>
    </Modal>
  );
}
