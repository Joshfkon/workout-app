'use client';

import { memo, useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { RIRSelector } from './RIRSelector';
import { FormRatingSelector } from './FormRatingSelector';
import { DiscomfortLogger } from './DiscomfortLogger';
import type {
  SetFeedback,
  RepsInTank,
  FormRating,
  SetDiscomfort,
  WeightUnit,
} from '@/types/schema';
import { formatWeightValue } from '@/lib/utils';

interface SetFeedbackCardProps {
  /** Set number being logged */
  setNumber: number;
  /** Weight used (in kg internally) */
  weightKg: number;
  /** Reps completed */
  reps: number;
  /** User's preferred weight unit */
  unit?: WeightUnit;
  /** Pre-selected feedback from previous set (for smart defaults) */
  defaultFeedback?: SetFeedback;
  /** Called when user saves the set with feedback */
  onSave: (feedback: SetFeedback) => void;
  /** Called when user cancels/goes back */
  onCancel?: () => void;
  /** Whether the card is disabled */
  disabled?: boolean;
}

/**
 * Set feedback card component
 * Shows after weight/reps are entered. RIR and Form are OPTIONAL refinements:
 * the set can always be saved, falling back to the provided defaultFeedback (or a
 * neutral default) when the user hasn't picked them. This matches the fast non-bodyweight
 * table path so logging never blocks on feedback.
 */
export const SetFeedbackCard = memo(function SetFeedbackCard({
  setNumber,
  weightKg,
  reps,
  unit = 'kg',
  defaultFeedback,
  onSave,
  onCancel,
  disabled = false,
}: SetFeedbackCardProps) {
  const [repsInTank, setRepsInTank] = useState<RepsInTank | null>(
    defaultFeedback?.repsInTank ?? null
  );
  const [form, setForm] = useState<FormRating | null>(
    defaultFeedback?.form ?? null
  );
  const [discomfort, setDiscomfort] = useState<SetDiscomfort | undefined>(
    defaultFeedback?.discomfort
  );

  // Track if using defaults (for visual indication)
  const [usingDefaults, setUsingDefaults] = useState(!!defaultFeedback);

  // Reset using defaults when user changes values
  useEffect(() => {
    if (defaultFeedback) {
      const isUsingDefaults =
        repsInTank === defaultFeedback.repsInTank && form === defaultFeedback.form;
      setUsingDefaults(isUsingDefaults);
    }
  }, [repsInTank, form, defaultFeedback]);

  // Feedback is optional: the set can always be saved. RIR/Form are refinements that
  // fall back to the previous set's feedback, then to a neutral default, when unspecified.
  const hasFeedback = repsInTank !== null || form !== null;

  const handleSave = () => {
    onSave({
      repsInTank: repsInTank ?? defaultFeedback?.repsInTank ?? 2,
      form: form ?? defaultFeedback?.form ?? 'clean',
      discomfort,
    });
  };

  const displayWeight = formatWeightValue(weightKg, unit);
  const unitLabel = unit === 'lb' ? 'lbs' : 'kg';

  return (
    <div className="bg-surface-800/80 border border-surface-700 rounded-xl p-4 space-y-4">
      {/* Header with set info */}
      <div className="flex items-center justify-between border-b border-surface-700 pb-3">
        <div>
          <p className="text-sm text-surface-400">Set {setNumber}</p>
          <p className="text-xl font-bold text-surface-100">
            {displayWeight} {unitLabel} <span className="text-surface-400">x</span> {reps}
          </p>
        </div>
        {usingDefaults && (
          <span className="text-xs text-surface-500 bg-surface-700/50 px-2 py-1 rounded">
            Same as last set
          </span>
        )}
      </div>

      {/* RIR Selection */}
      <RIRSelector value={repsInTank} onChange={setRepsInTank} disabled={disabled} />

      {/* Form Selection */}
      <FormRatingSelector value={form} onChange={setForm} disabled={disabled} />

      {/* Discomfort Logger (optional) */}
      <DiscomfortLogger value={discomfort} onChange={setDiscomfort} disabled={disabled} />

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onCancel && (
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={disabled}
            className="flex-1"
          >
            Back
          </Button>
        )}
        <Button
          onClick={handleSave}
          disabled={disabled}
          className="flex-1"
          size="lg"
        >
          <svg
            className="w-5 h-5 mr-2"
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
          Save Set
        </Button>
      </div>

      {/* Optional-feedback hint */}
      {!hasFeedback && (
        <p className="text-xs text-surface-500 text-center">
          RIR &amp; form are optional — tap Save Set to log, or rate it first.
        </p>
      )}
    </div>
  );
});

export default SetFeedbackCard;
