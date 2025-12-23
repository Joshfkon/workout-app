'use client';

import { useState, memo, useCallback } from 'react';
import { Button } from '@/components/ui';
import { SetFeedbackCard } from './SetFeedbackCard';
import { BodyweightInput } from './BodyweightInput';
import type {
  SetLog,
  WeightUnit,
  SetFeedback,
  BodyweightData,
  BodyweightModification,
} from '@/types/schema';
import { calculateEffectiveLoad } from '@/types/schema';

interface BodyweightSetInputRowProps {
  setNumber: number;
  /** User's current body weight in kg */
  userBodyweightKg: number;
  /** Target rep range for this exercise */
  targetRepRange: [number, number];
  /** Target RIR (reps in reserve) */
  targetRir: number;
  /** Previous set for smart defaults */
  previousSet?: SetLog;
  /** Whether this is the last set */
  isLastSet: boolean;
  /** Callback when set is submitted */
  onSubmit: (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
    feedback: SetFeedback;
    bodyweightData: BodyweightData;
  }) => void;
  /** Whether weight can be added */
  canAddWeight?: boolean;
  /** Whether assistance can be used */
  canUseAssistance?: boolean;
  /** Whether this is a pure bodyweight exercise */
  isPureBodyweight?: boolean;
  /** Whether input is disabled */
  disabled?: boolean;
  /** Weight unit for display */
  unit?: WeightUnit;
}

type InputPhase = 'weight_reps' | 'feedback';

/**
 * Set input row specifically for bodyweight exercises
 * Handles bodyweight modifications (added weight, assistance) and integrates
 * with the standard set feedback flow.
 */
export const BodyweightSetInputRow = memo(function BodyweightSetInputRow({
  setNumber,
  userBodyweightKg,
  targetRepRange,
  targetRir,
  previousSet,
  isLastSet,
  onSubmit,
  canAddWeight = true,
  canUseAssistance = true,
  isPureBodyweight = false,
  disabled = false,
  unit = 'kg',
}: BodyweightSetInputRowProps) {
  // Initialize from previous set if available
  const getInitialBodyweightData = (): BodyweightData => {
    if (previousSet?.bodyweightData) {
      // Use previous set's modification type but with current bodyweight
      const prevData = previousSet.bodyweightData;
      return {
        ...prevData,
        userBodyweightKg,
        effectiveLoadKg: calculateEffectiveLoad(
          userBodyweightKg,
          prevData.modification,
          prevData.addedWeightKg,
          prevData.assistanceWeightKg
        ),
      };
    }

    // Default to pure bodyweight
    return {
      userBodyweightKg,
      modification: 'none',
      effectiveLoadKg: userBodyweightKg,
    };
  };

  const [bodyweightData, setBodyweightData] = useState<BodyweightData>(getInitialBodyweightData());
  const [reps, setReps] = useState(String(previousSet?.reps ?? targetRepRange[1]));
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [phase, setPhase] = useState<InputPhase>('weight_reps');

  // Previous set's feedback for smart defaults
  const defaultFeedback: SetFeedback | undefined = previousSet?.feedback;

  const handleBodyweightChange = useCallback((data: BodyweightData) => {
    setBodyweightData(data);
  }, []);

  const handleProceedToFeedback = () => {
    const repsNum = parseInt(reps);
    if (isNaN(repsNum) || repsNum < 1) {
      return;
    }
    setPhase('feedback');
  };

  const handleFeedbackSave = (feedback: SetFeedback) => {
    const repsNum = parseInt(reps);
    if (isNaN(repsNum)) {
      return;
    }

    // Use effective load as the weight for backwards compatibility
    const weightKg = bodyweightData.effectiveLoadKg;

    // Convert RIR to RPE for backwards compatibility
    const rpe = feedback.repsInTank === 4 ? 6 : feedback.repsInTank === 2 ? 7.5 : feedback.repsInTank === 1 ? 9 : 10;

    onSubmit({
      weightKg,
      reps: repsNum,
      rpe,
      note: note || undefined,
      feedback,
      bodyweightData,
    });

    // Reset for next set
    setNote('');
    setShowNote(false);
    setPhase('weight_reps');
  };

  const handleBackToWeightReps = () => {
    setPhase('weight_reps');
  };

  const repsNum = parseInt(reps) || 0;

  // Show feedback card phase
  if (phase === 'feedback') {
    return (
      <SetFeedbackCard
        setNumber={setNumber}
        weightKg={bodyweightData.effectiveLoadKg}
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
  return (
    <div className="bg-surface-800/50 rounded-lg p-2 space-y-2">
      {/* Set header - more compact */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-surface-300">Set {setNumber}</span>
        <span className="text-xs text-surface-500">
          {targetRepRange[0]}-{targetRepRange[1]} reps @ RIR {targetRir}
        </span>
      </div>

      {/* Bodyweight input */}
      <BodyweightInput
        userBodyweightKg={userBodyweightKg}
        canAddWeight={canAddWeight}
        canUseAssistance={canUseAssistance}
        isPureBodyweight={isPureBodyweight}
        value={bodyweightData}
        onChange={handleBodyweightChange}
        unit={unit}
        disabled={disabled}
      />

      {/* Reps input row - more compact */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-surface-500 mb-0.5">Reps</label>
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            disabled={disabled}
            min="0"
            max="100"
            className="w-full px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-surface-100 text-center font-mono text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
        <Button
          onClick={handleProceedToFeedback}
          disabled={disabled || !reps || parseInt(reps) < 1}
          size="sm"
          className="shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>

      {/* Note toggle and input - more compact */}
      {!showNote ? (
        <button
          onClick={() => setShowNote(true)}
          className="text-xs text-surface-500 hover:text-surface-400 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add note
        </button>
      ) : (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Set note (optional)"
          className="w-full px-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs text-surface-300 placeholder:text-surface-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return (
    prevProps.setNumber === nextProps.setNumber &&
    prevProps.userBodyweightKg === nextProps.userBodyweightKg &&
    prevProps.targetRepRange[0] === nextProps.targetRepRange[0] &&
    prevProps.targetRepRange[1] === nextProps.targetRepRange[1] &&
    prevProps.targetRir === nextProps.targetRir &&
    prevProps.isLastSet === nextProps.isLastSet &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.unit === nextProps.unit &&
    prevProps.canAddWeight === nextProps.canAddWeight &&
    prevProps.canUseAssistance === nextProps.canUseAssistance &&
    prevProps.isPureBodyweight === nextProps.isPureBodyweight &&
    prevProps.previousSet?.id === nextProps.previousSet?.id
  );
});
