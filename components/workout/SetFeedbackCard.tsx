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
 * Shows after weight/reps are entered, requires RIR and Form selection
 * before the set can be saved
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

  const canSave = repsInTank !== null && form !== null;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      repsInTank: repsInTank!,
      form: form!,
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
          disabled={!canSave || disabled}
          className="flex-1"
          size="lg"
        >
          {canSave ? (
            <>
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
            </>
          ) : (
            'Select RIR & Form'
          )}
        </Button>
      </div>

      {/* Validation hint */}
      {!canSave && (
        <p className="text-xs text-surface-500 text-center">
          Please select both reps in tank and form quality to save the set
        </p>
      )}
    </div>
  );
});

export default SetFeedbackCard;
