'use client';

import { useState, memo } from 'react';
import { Button } from '@/components/ui';
import { SetFeedbackCard } from './SetFeedbackCard';
import type {
  SetLog,
  WeightUnit,
  SetFeedback,
  BodyweightData,
  BodyweightModification,
} from '@/types/schema';
import { formatWeightValue, convertWeightForDisplay, inputWeightToKg } from '@/lib/utils';
import { calculateEffectiveLoad } from '@/types/schema';

interface CompactSetRowProps {
  setNumber: number;
  /** User's current body weight in kg */
  userBodyweightKg?: number;
  /** Weight mode for bodyweight exercises */
  weightMode?: 'bodyweight' | 'weighted' | 'assisted';
  /** Whether this is a bodyweight exercise */
  isBodyweight?: boolean;
  /** Whether weight can be added */
  canAddWeight?: boolean;
  /** Whether assistance can be used */
  canUseAssistance?: boolean;
  /** Whether this is a pure bodyweight exercise */
  isPureBodyweight?: boolean;
  /** Previous set for smart defaults */
  previousSet?: SetLog;
  /** Target rep range */
  targetRepRange: [number, number];
  /** Target RIR */
  targetRir: number;
  /** Whether this set is completed */
  isCompleted?: boolean;
  /** Completed set data (if completed) */
  completedSet?: SetLog;
  /** Whether this is the active/current set */
  isActive?: boolean;
  /** Suggested weight for non-bodyweight exercises */
  suggestedWeight?: number;
  /** Callback when set is submitted */
  onSubmit?: (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
    feedback: SetFeedback;
    bodyweightData?: BodyweightData;
  }) => Promise<string | null | void> | void;
  /** Callback when set is edited */
  onEdit?: (setId: string) => void;
  /** Weight unit */
  unit?: WeightUnit;
  /** Whether input is disabled */
  disabled?: boolean;
}

type InputPhase = 'input' | 'feedback';

/**
 * Compact horizontal set row for streamlined logging
 */
export const CompactSetRow = memo(function CompactSetRow({
  setNumber,
  userBodyweightKg,
  weightMode = 'bodyweight',
  isBodyweight = false,
  canAddWeight = true,
  canUseAssistance = true,
  isPureBodyweight = false,
  previousSet,
  targetRepRange,
  targetRir,
  isCompleted = false,
  completedSet,
  isActive = false,
  suggestedWeight = 0,
  onSubmit,
  onEdit,
  unit = 'kg',
  disabled = false,
}: CompactSetRowProps) {
  const [reps, setReps] = useState(String(previousSet?.reps ?? targetRepRange[1]));
  const [weight, setWeight] = useState(
    previousSet?.weightKg 
      ? formatWeightValue(previousSet.weightKg, unit).toString()
      : (suggestedWeight > 0 ? formatWeightValue(suggestedWeight, unit).toString() : '')
  );
  const [phase, setPhase] = useState<InputPhase>('input');
  const [bodyweightData, setBodyweightData] = useState<BodyweightData | undefined>(
    previousSet?.bodyweightData
  );

  // If completed, show completed state (clickable to edit)
  // Use convertWeightForDisplay to preserve exact user input, not rounded to plate increments
  if (isCompleted && completedSet) {
    const completedDisplayWeight = isBodyweight && completedSet.bodyweightData
      ? convertWeightForDisplay(completedSet.bodyweightData.effectiveLoadKg, unit)
      : convertWeightForDisplay(completedSet.weightKg, unit);

    // Determine modification display for bodyweight exercises
    const bwModification = completedSet.bodyweightData?.modification;
    const showBwPrefix = isBodyweight && (!bwModification || bwModification === 'none');

    return (
      <div
        onClick={onEdit ? () => onEdit(completedSet.id) : undefined}
        className={`
          flex items-center gap-2 px-3 py-2 h-14
          bg-surface-800/30 border-l-2 border-l-transparent
          opacity-60 transition-opacity
          ${onEdit ? 'cursor-pointer hover:opacity-100' : ''}
        `}
      >
        <div className="w-8 text-xs text-surface-500 font-medium">{setNumber}</div>
        <div className="flex-1 text-xs text-surface-400 font-mono">
          {showBwPrefix && <span className="text-surface-500">BW </span>}
          {completedDisplayWeight} {unit}
        </div>
        <div className="w-20 text-center text-sm font-semibold text-surface-300">
          {completedSet.reps}
        </div>
        <div className="w-10 flex justify-center">
          <svg className="w-5 h-5 text-primary-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
      </div>
    );
  }

  // Show feedback phase
  if (phase === 'feedback') {
    return (
      <SetFeedbackCard
        setNumber={setNumber}
        weightKg={isBodyweight && bodyweightData ? bodyweightData.effectiveLoadKg : parseFloat(weight) || 0}
        reps={parseInt(reps) || 0}
        unit={unit}
        defaultFeedback={previousSet?.feedback}
        onSave={async (feedback) => {
          if (onSubmit) {
            const weightKg = isBodyweight && bodyweightData
              ? bodyweightData.effectiveLoadKg
              : inputWeightToKg(parseFloat(weight) || 0, unit);

            const rpe = feedback.repsInTank === 4 ? 6 : feedback.repsInTank === 2 ? 7.5 : feedback.repsInTank === 1 ? 9 : 10;

            await onSubmit({
              weightKg,
              reps: parseInt(reps) || 0,
              rpe,
              feedback,
              bodyweightData,
            });
            setPhase('input');
            setReps(String(targetRepRange[1]));
            setWeight('');
          }
        }}
        onCancel={() => setPhase('input')}
        disabled={disabled}
      />
    );
  }

  // Calculate bodyweight data based on mode
  const getBodyweightData = (): BodyweightData | undefined => {
    if (!isBodyweight || !userBodyweightKg) return undefined;

    if (weightMode === 'bodyweight' || isPureBodyweight) {
      return {
        userBodyweightKg,
        modification: 'none',
        effectiveLoadKg: userBodyweightKg,
      };
    }

    if (weightMode === 'weighted') {
      const addedKg = inputWeightToKg(parseFloat(weight) || 0, unit);
      return {
        userBodyweightKg,
        modification: 'weighted',
        addedWeightKg: addedKg,
        effectiveLoadKg: calculateEffectiveLoad(userBodyweightKg, 'weighted', addedKg),
      };
    }

    if (weightMode === 'assisted') {
      const assistKg = inputWeightToKg(parseFloat(weight) || 0, unit);
      return {
        userBodyweightKg,
        modification: 'assisted',
        assistanceWeightKg: assistKg,
        assistanceType: 'machine',
        effectiveLoadKg: calculateEffectiveLoad(userBodyweightKg, 'assisted', undefined, assistKg),
      };
    }

    return undefined;
  };

  const handleProceed = () => {
    const repsNum = parseInt(reps);
    if (isNaN(repsNum) || repsNum < 1) return;

    if (isBodyweight) {
      setBodyweightData(getBodyweightData());
    }
    setPhase('feedback');
  };

  const displayBw = userBodyweightKg ? formatWeightValue(userBodyweightKg, unit) : '—';

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-2 h-14
        bg-surface-800/50 border-l-2 transition-colors
        ${isActive ? 'border-l-primary-500 bg-surface-800/70' : 'border-l-transparent'}
      `}
    >
      {/* Set number */}
      <div className="w-8 text-xs text-surface-400 font-medium">{setNumber}</div>

      {/* Weight field */}
      <div className="flex-1 min-w-0">
        {isBodyweight ? (
          weightMode === 'bodyweight' || isPureBodyweight ? (
            <div className="text-xs text-surface-500">
              <span className="text-surface-400">BW</span> {displayBw} {unit}
            </div>
          ) : weightMode === 'weighted' ? (
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-surface-500">+</span>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0"
                disabled={disabled}
                className="w-full pl-5 pr-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs font-mono text-surface-100 text-center focus:ring-1 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
          ) : (
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-surface-500">-</span>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0"
                disabled={disabled}
                className="w-full pl-5 pr-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs font-mono text-surface-100 text-center focus:ring-1 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
              />
            </div>
          )
        ) : (
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={suggestedWeight > 0 ? formatWeightValue(suggestedWeight, unit).toString() : '—'}
            disabled={disabled}
            step="0.5"
            min="0"
            className="w-full px-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs font-mono text-surface-100 text-center focus:ring-1 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        )}
      </div>

      {/* Reps input - prominent */}
      <div className="w-20">
        <input
          type="number"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          disabled={disabled}
          min="0"
          max="100"
          className="w-full px-2 py-2 bg-surface-900 border border-surface-700 rounded text-center font-mono text-base font-semibold text-surface-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
        />
      </div>

      {/* Check button */}
      <div className="w-10 flex justify-center">
        <Button
          onClick={handleProceed}
          disabled={disabled || !reps || parseInt(reps) < 1}
          size="sm"
          className="w-8 h-8 p-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
});

