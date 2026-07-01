'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { IconMinus, IconPlus, IconMessagePlus } from '@tabler/icons-react';
import { BottomSheet } from './BottomSheet';
import { FormRatingSelector } from './FormRatingSelector';
import { DiscomfortLogger } from './DiscomfortLogger';
import type {
  WeightUnit,
  SetFeedback,
  RepsInTank,
  FormRating,
  SetDiscomfort,
  BodyweightData,
} from '@/types/schema';
import { rirToRpe, calculateEffectiveLoad } from '@/types/schema';
import {
  convertWeight,
  convertWeightForDisplay,
  inputWeightToKg,
  roundToIncrement,
} from '@/lib/utils';

type WeightMode = 'bodyweight' | 'weighted' | 'assisted';

interface SetLoggerRowProps {
  setNumber: number;
  /** Weight in DISPLAY units as a string. For weighted/assisted bodyweight modes this is the added/assistance load. */
  weight: string;
  /** Reps (or seconds for duration-based exercises) as a string. */
  reps: string;
  onWeightChange: (value: string) => void;
  onRepsChange: (value: string) => void;
  /**
   * Prescribed target RIR for this set (calibration/readiness adjusted).
   * Pre-selects the matching RIR chip (clamped to the 0-3 chip range).
   */
  targetRir: number;
  unit?: WeightUnit;
  /** Smallest load increment for this exercise, in kg. Steppers move by this (converted for display units). */
  minIncrementKg?: number;
  disabled?: boolean;
  /** Duration-based exercise (plank, hold): reps column is seconds. */
  isDurationBased?: boolean;
  /** Bodyweight exercise support */
  isBodyweight?: boolean;
  weightMode?: WeightMode;
  userBodyweightKg?: number;
  /**
   * One-tap commit. Data shape matches the existing onSetComplete persistence
   * path exactly (weight converted to kg, RPE derived from the selected RIR).
   */
  onLog: (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
    feedback: SetFeedback;
    bodyweightData?: BodyweightData;
  }) => void;
}

/** Clamp a prescribed RIR to the 0-3 chip range. */
function clampToChip(rir: number): RepsInTank {
  const rounded = Math.round(rir);
  return Math.max(0, Math.min(3, Number.isFinite(rounded) ? rounded : 2)) as RepsInTank;
}

const RIR_CHIPS: RepsInTank[] = [3, 2, 1, 0];

/**
 * One-tap set logger row (replaces the SetInputRow → SetFeedbackCard
 * two-phase flow). Weight/reps steppers pre-filled from the suggestion, RIR
 * chips pre-selected to the prescribed target — accepting the suggestion is
 * exactly one tap on "Log set". Optional form/discomfort/note live behind
 * the note icon's bottom sheet.
 */
export function SetLoggerRow({
  setNumber,
  weight,
  reps,
  onWeightChange,
  onRepsChange,
  targetRir,
  unit = 'kg',
  minIncrementKg,
  disabled = false,
  isDurationBased = false,
  isBodyweight = false,
  weightMode = 'bodyweight',
  userBodyweightKg,
  onLog,
}: SetLoggerRowProps) {
  const [selectedRir, setSelectedRir] = useState<RepsInTank>(() => clampToChip(targetRir));
  const [editingField, setEditingField] = useState<'weight' | 'reps' | null>(null);
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [form, setForm] = useState<FormRating | null>(null);
  const [discomfort, setDiscomfort] = useState<SetDiscomfort | undefined>(undefined);
  const [note, setNote] = useState('');
  const noteInputId = useId();

  // Re-sync the default chip when the set advances or the prescription changes.
  useEffect(() => {
    setSelectedRir(clampToChip(targetRir));
  }, [setNumber, targetRir]);

  // Clear per-set feedback when the set advances.
  useEffect(() => {
    setForm(null);
    setDiscomfort(undefined);
    setNote('');
  }, [setNumber]);

  const unitLabel = unit === 'lb' ? 'lbs' : 'kg';
  const maxReps = isDurationBased ? 600 : 100;
  const repsStep = isDurationBased ? 5 : 1;

  // Weight step in DISPLAY units, derived from the exercise's minimum kg
  // increment. For lb users the converted step snaps to real 2.5 lb plate
  // math (2.5 kg -> 5 lb, 1.25 kg -> 2.5 lb) instead of 5.51 lb.
  const weightStep = useMemo(() => {
    const incKg = minIncrementKg && minIncrementKg > 0 ? minIncrementKg : 2.5;
    if (unit === 'lb') {
      const lbs = convertWeight(incKg, 'kg', 'lb');
      return Math.max(2.5, roundToIncrement(lbs, 2.5));
    }
    return incKg;
  }, [minIncrementKg, unit]);

  const isPlainBodyweight = isBodyweight && weightMode === 'bodyweight';
  const weightNum = parseFloat(weight);
  const repsNum = parseInt(reps);
  const weightValid = isPlainBodyweight || (!isNaN(weightNum) && weightNum >= 0 && (isBodyweight || weightNum > 0));
  const repsValid = !isNaN(repsNum) && repsNum >= 1 && repsNum <= maxReps;
  const canLog = !disabled && weightValid && repsValid;
  const hasSheetFeedback = form !== null || discomfort !== undefined || note.trim().length > 0;

  const stepWeight = (direction: 1 | -1) => {
    const current = isNaN(weightNum) ? 0 : weightNum;
    const next = Math.max(0, current + direction * weightStep);
    onWeightChange(String(parseFloat(next.toFixed(2))));
  };

  const stepReps = (direction: 1 | -1) => {
    const current = isNaN(repsNum) ? 0 : repsNum;
    const next = Math.min(maxReps, Math.max(1, current + direction * repsStep));
    onRepsChange(String(next));
  };

  const handleLog = () => {
    if (!canLog) return;

    const feedback: SetFeedback = {
      repsInTank: selectedRir,
      form: form ?? 'clean',
      discomfort,
    };
    const rpe = rirToRpe(selectedRir);

    let weightKg: number;
    let bodyweightData: BodyweightData | undefined;

    if (isBodyweight && userBodyweightKg) {
      if (weightMode === 'weighted') {
        const addedKg = inputWeightToKg(isNaN(weightNum) ? 0 : weightNum, unit);
        bodyweightData = {
          userBodyweightKg,
          modification: 'weighted',
          addedWeightKg: addedKg,
          effectiveLoadKg: calculateEffectiveLoad(userBodyweightKg, 'weighted', addedKg),
        };
      } else if (weightMode === 'assisted') {
        const assistKg = inputWeightToKg(isNaN(weightNum) ? 0 : weightNum, unit);
        bodyweightData = {
          userBodyweightKg,
          modification: 'assisted',
          assistanceWeightKg: assistKg,
          assistanceType: 'machine',
          effectiveLoadKg: calculateEffectiveLoad(userBodyweightKg, 'assisted', undefined, assistKg),
        };
      } else {
        bodyweightData = {
          userBodyweightKg,
          modification: 'none',
          effectiveLoadKg: userBodyweightKg,
        };
      }
      weightKg = bodyweightData.effectiveLoadKg;
    } else {
      weightKg = inputWeightToKg(weightNum, unit);
    }

    onLog({
      weightKg,
      reps: repsNum,
      rpe,
      note: note.trim() || undefined,
      feedback,
      bodyweightData,
    });

    // Reset per-set feedback for the next set.
    setForm(null);
    setDiscomfort(undefined);
    setNote('');
    setShowFeedbackSheet(false);
  };

  const stepperButtonClass =
    'min-w-[40px] min-h-[40px] flex items-center justify-center rounded-md bg-surface-800/50 text-surface-300 hover:text-surface-100 active:bg-surface-700 transition-colors disabled:opacity-30';

  const renderValue = (
    field: 'weight' | 'reps',
    displayText: string,
    value: string,
    onChange: (v: string) => void,
    ariaLabel: string
  ) => {
    if (editingField === field) {
      return (
        <input
          type="number"
          inputMode={field === 'weight' ? 'decimal' : 'numeric'}
          pattern={field === 'reps' ? '[0-9]*' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditingField(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onFocus={(e) => e.target.select()}
          autoFocus
          min="0"
          step={field === 'weight' ? '0.5' : '1'}
          aria-label={ariaLabel}
          className="w-full min-w-0 px-1 py-2 bg-surface-900 border border-primary-500/50 rounded-md text-center font-mono text-sm text-surface-100 focus:outline-none"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => setEditingField(field)}
        disabled={disabled}
        aria-label={`${ariaLabel}: ${displayText}. Tap to type`}
        className="w-full min-w-0 py-2 font-mono text-sm text-surface-100 truncate"
      >
        {displayText}
      </button>
    );
  };

  return (
    <div
      className="rounded-lg border border-primary-500/40 p-2.5 space-y-2"
      role="group"
      aria-label={`Set ${setNumber} logger`}
    >
      {/* Row 1: set number, weight stepper, reps stepper */}
      <div className="flex items-center gap-2">
        <span className="w-5 flex-shrink-0 text-[12px] font-medium text-surface-400 text-center">
          {setNumber}
        </span>

        {/* Weight */}
        {isPlainBodyweight ? (
          <div className="flex-1 flex items-center justify-center py-2 text-sm font-mono text-surface-300">
            <span className="text-surface-500 mr-1">BW</span>
            {userBodyweightKg ? `${convertWeightForDisplay(userBodyweightKg, unit)} ${unitLabel}` : ''}
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => stepWeight(-1)}
              disabled={disabled}
              aria-label="Decrease weight"
              className={stepperButtonClass}
            >
              <IconMinus size={16} />
            </button>
            {renderValue(
              'weight',
              `${isBodyweight && weightMode === 'assisted' ? '-' : isBodyweight && weightMode === 'weighted' ? '+' : ''}${weight || '0'} ${unitLabel}`,
              weight,
              onWeightChange,
              'Weight'
            )}
            <button
              type="button"
              onClick={() => stepWeight(1)}
              disabled={disabled}
              aria-label="Increase weight"
              className={stepperButtonClass}
            >
              <IconPlus size={16} />
            </button>
          </div>
        )}

        {/* Reps / seconds */}
        <div className="flex-1 flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={() => stepReps(-1)}
            disabled={disabled}
            aria-label={isDurationBased ? 'Decrease seconds' : 'Decrease reps'}
            className={stepperButtonClass}
          >
            <IconMinus size={16} />
          </button>
          {renderValue(
            'reps',
            `${reps || '0'}${isDurationBased ? 's' : ''}`,
            reps,
            onRepsChange,
            isDurationBased ? 'Seconds' : 'Reps'
          )}
          <button
            type="button"
            onClick={() => stepReps(1)}
            disabled={disabled}
            aria-label={isDurationBased ? 'Increase seconds' : 'Increase reps'}
            className={stepperButtonClass}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>

      {/* Row 2: RIR chips + feedback sheet trigger */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-surface-500 mr-0.5">RIR</span>
        {RIR_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => setSelectedRir(chip)}
            disabled={disabled}
            aria-label={`${chip} reps in reserve`}
            aria-pressed={selectedRir === chip}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              selectedRir === chip
                ? 'bg-primary-500 text-white'
                : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
            }`}
          >
            {chip}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowFeedbackSheet(true)}
          disabled={disabled}
          aria-label="Add set feedback"
          className="ml-auto relative p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
        >
          <IconMessagePlus size={18} />
          {hasSheetFeedback && (
            <span
              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary-400"
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      {/* Row 3: one-tap log */}
      <button
        type="button"
        onClick={handleLog}
        disabled={!canLog}
        className="w-full bg-primary-500 hover:bg-primary-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
      >
        Log set
      </button>

      {/* Optional feedback sheet (absorbs the old SetFeedbackCard content) */}
      <BottomSheet
        isOpen={showFeedbackSheet}
        onClose={() => setShowFeedbackSheet(false)}
        title={`Set ${setNumber} feedback`}
      >
        <div className="space-y-4">
          <FormRatingSelector value={form} onChange={setForm} disabled={disabled} />
          <DiscomfortLogger value={discomfort} onChange={setDiscomfort} disabled={disabled} />
          <div className="space-y-1">
            <label htmlFor={noteInputId} className="block text-sm font-medium text-surface-300">
              Note
            </label>
            <input
              id={noteInputId}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional set note"
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-sm text-surface-200 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFeedbackSheet(false)}
            className="w-full bg-primary-500 hover:bg-primary-600 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
          >
            Done
          </button>
          <p className="text-[11px] text-surface-500 text-center">
            All optional — feedback is saved with the set when you tap Log set.
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}

export default SetLoggerRow;
