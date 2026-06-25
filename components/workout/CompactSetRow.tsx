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
    // Seed an EXISTING logged value exactly (convertWeightForDisplay); only fall back to
    // the rounded suggestion (formatWeightValue) when there is no previous set.
    previousSet?.weightKg !== undefined
      ? convertWeightForDisplay(previousSet.weightKg, unit).toString()
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

  // One-tap "Repeat last set": log identical weight/reps as the previous set in a single
  // tap, reusing its feedback (or a neutral default). Skips the feedback screen entirely.
  const handleRepeatLastSet = async () => {
    if (!onSubmit || !previousSet) return;

    const repsNum = previousSet.reps;
    if (!repsNum || repsNum < 1) return;

    // "Repeat" means log an identical set, so reuse the previous set's stored
    // values directly. Recomputing from the current inputs would double-count
    // for weighted/assisted bodyweight: those inputs are seeded from the
    // previous EFFECTIVE load, not the added/assistance amount.
    const bwData = isBodyweight ? previousSet.bodyweightData : undefined;
    const weightKg = previousSet.weightKg;

    const feedback = previousSet.feedback ?? { repsInTank: 2, form: 'clean' };
    const rpe = previousSet.rpe
      ?? (feedback.repsInTank === 4 ? 6 : feedback.repsInTank === 2 ? 7.5 : feedback.repsInTank === 1 ? 9 : 10);

    await onSubmit({
      weightKg,
      reps: repsNum,
      rpe,
      feedback,
      bodyweightData: bwData,
    });
    setReps(String(targetRepRange[1]));
    setWeight('');
  };

  const canRepeatLastSet = isActive && !!previousSet && previousSet.reps > 0;

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
                inputMode="decimal"
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
                inputMode="decimal"
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
            inputMode="decimal"
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
          inputMode="numeric"
          pattern="[0-9]*"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          disabled={disabled}
          min="0"
          max="100"
          className="w-full px-2 py-2 bg-surface-900 border border-surface-700 rounded text-center font-mono text-base font-semibold text-surface-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
        />
      </div>

      {/* Repeat last set - one tap to log identical weight/reps */}
      {canRepeatLastSet && (
        <button
          onClick={handleRepeatLastSet}
          disabled={disabled}
          className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] -my-1 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-700/50 transition-colors disabled:opacity-30"
          title="Repeat last set"
          aria-label="Repeat last set"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      )}

      {/* Check button - >=44px tap target */}
      <div className="flex justify-center">
        <Button
          onClick={handleProceed}
          disabled={disabled || !reps || parseInt(reps) < 1}
          size="sm"
          className="min-w-[44px] min-h-[44px] -my-1 p-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
});

