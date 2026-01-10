'use client';

import { useState, memo } from 'react';
import { Button, InfoTooltip } from '@/components/ui';
import { SetFeedbackCard } from './SetFeedbackCard';
import type { SetLog, WeightUnit, SetFeedback } from '@/types/schema';
import { formatWeightValue, inputWeightToKg } from '@/lib/utils';

interface SetInputRowProps {
  setNumber: number;
  targetWeight: number; // Always in kg
  targetRepRange: [number, number];
  targetRir: number;
  previousSet?: SetLog;
  isLastSet: boolean;
  onSubmit: (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
    feedback: SetFeedback;
  }) => void;
  disabled?: boolean;
  unit?: WeightUnit;
  /** If true, this is a duration-based exercise (plank, hold) - show seconds instead of reps */
  isDurationBased?: boolean;
}

type InputPhase = 'weight_reps' | 'feedback';

// PERFORMANCE: Memoized component to prevent unnecessary re-renders
export const SetInputRow = memo(function SetInputRow({
  setNumber,
  targetWeight,
  targetRepRange,
  targetRir,
  previousSet,
  isLastSet,
  onSubmit,
  disabled = false,
  unit = 'kg',
  isDurationBased = false,
}: SetInputRowProps) {
  // Convert from kg to display unit
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);
  const initialWeight = previousSet?.weightKg ?? targetWeight;

  const [weight, setWeight] = useState(String(displayWeight(initialWeight)));
  const [reps, setReps] = useState(String(previousSet?.reps ?? targetRepRange[1]));
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [phase, setPhase] = useState<InputPhase>('weight_reps');

  // For smart defaults - use previous set's feedback if available
  const defaultFeedback: SetFeedback | undefined = previousSet?.feedback;

  // Duration-based exercises allow up to 600 seconds (10 minutes)
  const maxValue = isDurationBased ? 600 : 100;

  const handleProceedToFeedback = () => {
    const weightNum = parseFloat(weight);
    const repsNum = parseInt(reps);

    if (isNaN(weightNum) || isNaN(repsNum) || repsNum < 1 || repsNum > maxValue) {
      return;
    }

    setPhase('feedback');
  };

  const handleFeedbackSave = (feedback: SetFeedback) => {
    const weightNum = parseFloat(weight);
    const repsNum = parseInt(reps);

    if (isNaN(weightNum) || isNaN(repsNum) || repsNum < 1 || repsNum > maxValue) {
      return;
    }

    // Convert from display unit to kg for storage
    const weightKg = inputWeightToKg(weightNum, unit);

    // Convert RIR to RPE for backwards compatibility
    const rpe = feedback.repsInTank === 4 ? 6 : feedback.repsInTank === 2 ? 7.5 : feedback.repsInTank === 1 ? 9 : 10;

    onSubmit({
      weightKg,
      reps: repsNum,
      rpe,
      note: note || undefined,
      feedback,
    });

    // Reset for next set
    setNote('');
    setShowNote(false);
    setPhase('weight_reps');
  };

  const handleBackToWeightReps = () => {
    setPhase('weight_reps');
  };

  const weightKg = inputWeightToKg(parseFloat(weight) || 0, unit);
  const repsNum = parseInt(reps) || 0;
  const valueExceedsMax = repsNum > maxValue;

  // Labels for duration vs rep-based exercises
  const valueLabel = isDurationBased ? 'Seconds' : 'Reps';
  const targetLabel = isDurationBased
    ? `${targetRepRange[0]}-${targetRepRange[1]} sec @ RIR ${targetRir}`
    : `${targetRepRange[0]}-${targetRepRange[1]} reps @ RIR ${targetRir}`;

  // Show feedback card phase
  if (phase === 'feedback') {
    return (
      <SetFeedbackCard
        setNumber={setNumber}
        weightKg={weightKg}
        reps={repsNum}
        unit={unit}
        defaultFeedback={defaultFeedback}
        onSave={handleFeedbackSave}
        onCancel={handleBackToWeightReps}
        disabled={disabled}
      />
    );
  }

  // Weight and reps input phase
  const weightInputId = `set-${setNumber}-weight`;
  const repsInputId = `set-${setNumber}-reps`;
  const noteInputId = `set-${setNumber}-note`;

  return (
    <div
      className="bg-surface-800/50 rounded-lg p-3 space-y-3"
      role="group"
      aria-label={`Set ${setNumber} input`}
    >
      {/* Set header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-surface-300" id={`set-${setNumber}-label`}>
          Set {setNumber}
        </span>
        <span className="flex items-center gap-1 text-xs text-surface-500" aria-label="Target">
          Target: {targetLabel}
          <InfoTooltip term="RIR" size="sm" />
        </span>
      </div>

      {/* Input row */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor={weightInputId} className="block text-xs text-surface-500 mb-1">
            Weight ({unit})
          </label>
          <input
            id={weightInputId}
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            disabled={disabled}
            step="0.5"
            min="0"
            aria-describedby={`set-${setNumber}-label`}
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
        <div className="flex-1">
          <label htmlFor={repsInputId} className="block text-xs text-surface-500 mb-1">
            {valueLabel}
          </label>
          <input
            id={repsInputId}
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            disabled={disabled}
            min="0"
            max={maxValue}
            aria-describedby={`set-${setNumber}-label`}
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
        <Button
          onClick={handleProceedToFeedback}
          disabled={disabled || !weight || !reps || parseInt(reps) < 1 || parseInt(reps) > maxValue}
          size="md"
          className="shrink-0"
          aria-label={`Log set ${setNumber}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>

      {/* Validation warning */}
      {valueExceedsMax && (
        <p className="text-xs text-red-400">
          Maximum {maxValue} {isDurationBased ? 'seconds' : 'reps'} allowed
        </p>
      )}

      {/* Note toggle and input */}
      {!showNote ? (
        <button
          onClick={() => setShowNote(true)}
          className="text-xs text-surface-500 hover:text-surface-400 flex items-center gap-1"
          aria-label={`Add note to set ${setNumber}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add note
        </button>
      ) : (
        <input
          id={noteInputId}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Set note (optional)"
          aria-label={`Note for set ${setNumber}`}
          className="w-full px-3 py-1.5 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-300 placeholder:text-surface-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return (
    prevProps.setNumber === nextProps.setNumber &&
    prevProps.targetWeight === nextProps.targetWeight &&
    prevProps.targetRepRange[0] === nextProps.targetRepRange[0] &&
    prevProps.targetRepRange[1] === nextProps.targetRepRange[1] &&
    prevProps.targetRir === nextProps.targetRir &&
    prevProps.isLastSet === nextProps.isLastSet &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.unit === nextProps.unit &&
    prevProps.previousSet?.id === nextProps.previousSet?.id &&
    prevProps.isDurationBased === nextProps.isDurationBased
  );
});

