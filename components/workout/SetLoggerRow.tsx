'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  IconBarbell,
  IconMinus,
  IconPlus,
  IconMessagePlus,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconRotate,
} from '@tabler/icons-react';
import { useDurationTimer } from '@/hooks/useDurationTimer';
import { BottomSheet } from './BottomSheet';
import { FormRatingSelector } from './FormRatingSelector';
import { JointPainPicker } from './FeedbackChips';
import { SELECTOR_CHIP_BASE, SELECTOR_CHIP_IDLE, SELECTOR_CHIP_SELECTED } from './selectorChips';
import { getBodyPartDisplayName, getSeverityInfo, jointToBodyPart } from '@/services/discomfortTracker';
import { Input } from '@/components/ui';
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
   * Pre-selects the matching RIR chip (clamped to the 0-4 chip range).
   */
  targetRir: number;
  unit?: WeightUnit;
  /** Smallest load increment for this exercise, in kg. Steppers move by this (converted for display units). */
  minIncrementKg?: number;
  disabled?: boolean;
  /** Duration-based exercise (plank, hold): reps column is seconds. */
  isDurationBased?: boolean;
  /**
   * Exercise ID — scopes the hold timer's crash/reload persistence so a
   * running plank timer can never be restored into another exercise's row.
   */
  exerciseId?: string;
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
  /**
   * Opens the plate calculator pre-filled with the current weight (P1-5).
   * The calculator has existed since the audit — this is its first
   * discoverable trigger at the point of use.
   */
  onPlateCalculatorOpen?: () => void;
}

/** Clamp a prescribed RIR to the 0-4 chip range. */
function clampToChip(rir: number): RepsInTank {
  const rounded = Math.round(rir);
  return Math.max(0, Math.min(4, Number.isFinite(rounded) ? rounded : 2)) as RepsInTank;
}

const RIR_CHIPS: RepsInTank[] = [4, 3, 2, 1, 0];

/** Chip face text — RIR 4 renders as "4+" (stored as integer 4). */
const RIR_CHIP_TEXT: Record<RepsInTank, string> = {
  4: '4+',
  3: '3',
  2: '2',
  1: '1',
  0: '0',
};

/** Compact neutral summary line for a logged discomfort, with Remove. */
function DiscomfortSummaryRow({
  discomfort,
  onRemove,
}: {
  discomfort: SetDiscomfort;
  onRemove: () => void;
}) {
  const severityInfo = getSeverityInfo(discomfort.severity);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-800/70 border border-surface-700 px-2.5 py-1.5 text-[12px]">
      <span className={severityInfo.color}>
        {getBodyPartDisplayName(discomfort.bodyPart)} — {severityInfo.label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto text-surface-500 hover:text-surface-300"
        aria-label="Remove discomfort"
      >
        Remove
      </button>
    </div>
  );
}

/** Effort labels under the RIR numbers (matches the set-feedback semantics). */
const RIR_LABELS: Record<RepsInTank, string> = {
  4: 'cruise',
  3: 'easy',
  2: 'good',
  1: 'hard',
  0: 'maxed',
};

/**
 * One-tap set logger row (replaces the SetInputRow → SetFeedbackCard
 * two-phase flow). Weight/reps steppers pre-filled from the suggestion, RIR
 * chips (4+/3/2/1/0) pre-selected to the prescribed target — accepting the
 * suggestion is exactly one tap on "Log set". Optional form/injury/note live
 * behind the note icon's bottom sheet.
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
  exerciseId,
  isBodyweight = false,
  weightMode = 'bodyweight',
  userBodyweightKg,
  onLog,
  onPlateCalculatorOpen,
}: SetLoggerRowProps) {
  const [selectedRir, setSelectedRir] = useState<RepsInTank>(() => clampToChip(targetRir));
  const [editingField, setEditingField] = useState<'weight' | 'reps' | null>(null);
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [showSheetDiscomfortPicker, setShowSheetDiscomfortPicker] = useState(false);
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
    setShowSheetDiscomfortPicker(false);
  }, [setNumber]);

  const unitLabel = unit === 'lb' ? 'lbs' : 'kg';
  const maxReps = isDurationBased ? 600 : 100;
  const repsStep = isDurationBased ? 5 : 1;

  // ---- Hold timer (duration exercises) ----
  // Start the hold, count up live (wall-clock based — survives phone lock),
  // chime at the target, and on Stop commit the elapsed seconds into the
  // seconds field, where the −/+ steppers and tap-to-type adjust it before
  // logging. The prefilled suggestion IS the target. Hook is called
  // unconditionally (rules of hooks); its UI renders only for duration rows,
  // and persistence is scoped by exerciseId so a running plank timer can
  // never restore into another exercise's row.
  const parsedSeconds = parseInt(reps);
  const holdTargetSeconds =
    isDurationBased && !isNaN(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : undefined;
  const holdTimer = useDurationTimer({
    targetSeconds: holdTargetSeconds,
    exerciseId,
  });
  const holdRunning = isDurationBased && holdTimer.isRunning;
  const holdCommittedRef = useRef(false);

  // Commit the hold time when the timer stops (never mid-run: the steppers
  // and the field stay the single source of truth for what gets logged).
  useEffect(() => {
    if (!isDurationBased) return;
    if (holdTimer.isRunning) {
      holdCommittedRef.current = false;
      return;
    }
    if (holdTimer.hasStarted && !holdCommittedRef.current && holdTimer.elapsed > 0) {
      holdCommittedRef.current = true;
      onRepsChange(String(Math.min(600, Math.max(1, holdTimer.elapsed))));
    }
  }, [isDurationBased, holdTimer.isRunning, holdTimer.hasStarted, holdTimer.elapsed, onRepsChange]);

  // Fresh set → fresh timer. Skipped on the initial mount: useDurationTimer
  // restores a running hold from localStorage in its own mount effect (the
  // crash/reload persistence), and resetting here would immediately wipe it.
  const resetHoldTimer = holdTimer.reset;
  const holdMountedForSetRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isDurationBased) return;
    if (holdMountedForSetRef.current === null) {
      holdMountedForSetRef.current = setNumber;
      return;
    }
    if (holdMountedForSetRef.current === setNumber) return;
    holdMountedForSetRef.current = setNumber;
    resetHoldTimer();
    holdCommittedRef.current = false;
  }, [setNumber, isDurationBased, resetHoldTimer]);

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
  // Mid-hold you're holding, not logging: Stop commits the time first.
  const canLog = !disabled && weightValid && repsValid && !holdRunning;
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
    setShowSheetDiscomfortPicker(false);
  };

  // Gym-proof tap targets (P0-4): every interactive control in this row is
  // ≥44px in both axes, with the primary input row at 52px tall.
  const stepperButtonClass =
    'min-w-[44px] min-h-[52px] flex items-center justify-center rounded-lg bg-surface-800/50 text-surface-300 hover:text-surface-100 active:bg-surface-700 transition-colors disabled:opacity-30';

  const renderValue = (
    field: 'weight' | 'reps',
    displayText: string,
    value: string,
    onChange: (v: string) => void,
    ariaLabel: string,
    unitText?: string
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
          className="w-full min-w-0 px-1 min-h-[52px] bg-surface-900 border border-primary-500/50 rounded-lg text-center font-mono text-[15px] text-surface-100 focus:outline-none"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => setEditingField(field)}
        disabled={disabled}
        aria-label={`${ariaLabel}: ${displayText}${unitText ? ` ${unitText}` : ''}. Tap to type`}
        className="w-full min-w-0 min-h-[52px] flex flex-col items-center justify-center leading-tight"
      >
        <span className="font-mono text-[15px] text-surface-100 whitespace-nowrap">{displayText}</span>
        {unitText && (
          <span className="text-[10px] uppercase tracking-wide text-surface-500">{unitText}</span>
        )}
      </button>
    );
  };

  return (
    <div
      className="rounded-lg border border-primary-500/40 p-2.5 space-y-2"
      role="group"
      aria-label={`Set ${setNumber} logger`}
    >
      {/* Row 0: set label + plate calculator affordance (P1-5, mockup 02) */}
      {onPlateCalculatorOpen && (
        <div className="flex items-center justify-between -mb-1">
          <span className="text-[11px] text-surface-500">Set {setNumber}</span>
          <button
            type="button"
            onClick={onPlateCalculatorOpen}
            disabled={disabled}
            aria-label="Open plate calculator"
            className="min-h-[44px] -my-2.5 px-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary-400 hover:text-primary-300 transition-colors"
          >
            <IconBarbell size={14} aria-hidden="true" />
            Plates
          </button>
        </div>
      )}

      {/* Row 1: set number, weight stepper, reps stepper */}
      <div className="flex items-center gap-1.5">
        {!onPlateCalculatorOpen && (
          <span className="w-3 flex-shrink-0 text-[12px] font-medium text-surface-400 text-center">
            {setNumber}
          </span>
        )}

        {/* Weight */}
        {isPlainBodyweight ? (
          <div className="flex-1 flex items-center justify-center py-2 text-sm font-mono text-surface-300">
            <span className="text-surface-500 mr-1">BW</span>
            {userBodyweightKg ? `${convertWeightForDisplay(userBodyweightKg, unit)} ${unitLabel}` : ''}
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-0.5 min-w-0">
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
              `${isBodyweight && weightMode === 'assisted' ? '-' : isBodyweight && weightMode === 'weighted' ? '+' : ''}${weight || '0'}`,
              weight,
              onWeightChange,
              'Weight',
              unitLabel
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
        <div className="flex-1 flex items-center gap-0.5 min-w-0">
          <button
            type="button"
            onClick={() => stepReps(-1)}
            disabled={disabled || holdRunning}
            aria-label={isDurationBased ? 'Decrease seconds' : 'Decrease reps'}
            className={stepperButtonClass}
          >
            <IconMinus size={16} />
          </button>
          {holdRunning ? (
            // Live hold readout while the timer runs — the field commits on Stop.
            <div
              className="w-full min-w-0 min-h-[52px] flex flex-col items-center justify-center leading-tight"
              aria-live="polite"
              aria-label={`Holding: ${holdTimer.elapsed} seconds`}
            >
              <span className="font-mono text-[15px] text-primary-400 whitespace-nowrap">
                {holdTimer.elapsed}s
              </span>
              {holdTargetSeconds ? (
                <span className="text-[10px] uppercase tracking-wide text-surface-500">
                  of {holdTargetSeconds}s
                </span>
              ) : null}
            </div>
          ) : (
            renderValue(
              'reps',
              `${reps || '0'}${isDurationBased ? 's' : ''}`,
              reps,
              onRepsChange,
              isDurationBased ? 'Seconds' : 'Reps',
              isDurationBased ? undefined : 'reps'
            )
          )}
          <button
            type="button"
            onClick={() => stepReps(1)}
            disabled={disabled || holdRunning}
            aria-label={isDurationBased ? 'Increase seconds' : 'Increase reps'}
            className={stepperButtonClass}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>

      {/* Hold timer row (duration exercises): start the hold, stop to capture,
          then adjust with the −/+ steppers above before logging. */}
      {isDurationBased && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => holdTimer.toggle()}
            disabled={disabled}
            aria-label={
              holdTimer.isRunning ? 'Stop hold timer' : holdTimer.hasStarted ? 'Resume hold timer' : 'Start hold timer'
            }
            className={`relative flex-1 min-h-[44px] rounded-lg overflow-hidden flex items-center justify-center gap-2 text-[13px] font-semibold transition-colors ${
              holdTimer.isRunning
                ? 'bg-primary-500/20 text-primary-300 border border-primary-500/50'
                : 'bg-surface-800/50 text-surface-200 hover:bg-surface-800 border border-surface-700'
            } disabled:opacity-30`}
          >
            {/* Progress toward the target while running */}
            {holdTimer.isRunning && holdTargetSeconds ? (
              <span
                className={`absolute inset-y-0 left-0 opacity-25 transition-all duration-200 ${
                  holdTimer.hasReachedTarget ? 'bg-success-500' : 'bg-primary-500'
                }`}
                style={{ width: `${Math.min(100, holdTimer.progressPercent)}%` }}
                aria-hidden="true"
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-2">
              {holdTimer.isRunning ? (
                <>
                  <IconPlayerStopFilled size={16} aria-hidden="true" />
                  Stop · {holdTimer.elapsed}s
                </>
              ) : (
                <>
                  <IconPlayerPlayFilled size={16} aria-hidden="true" />
                  {holdTimer.hasStarted ? 'Resume hold' : 'Start hold'}
                </>
              )}
            </span>
          </button>
          {holdTimer.hasStarted && !holdTimer.isRunning && (
            <button
              type="button"
              onClick={() => {
                holdTimer.reset();
                holdCommittedRef.current = false;
              }}
              disabled={disabled}
              aria-label="Reset hold timer"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-800/50 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-30"
            >
              <IconRotate size={16} />
            </button>
          )}
        </div>
      )}

      {/* Row 2: RIR chips (labeled, full-width) + feedback sheet trigger */}
      <div className="flex items-stretch gap-2">
        {RIR_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => setSelectedRir(chip)}
            disabled={disabled}
            aria-label={`${RIR_CHIP_TEXT[chip]} reps in reserve (${RIR_LABELS[chip]})`}
            aria-pressed={selectedRir === chip}
            className={`${SELECTOR_CHIP_BASE} ${
              selectedRir === chip ? SELECTOR_CHIP_SELECTED : SELECTOR_CHIP_IDLE
            }`}
          >
            <span className="text-[16px] font-semibold leading-tight">{RIR_CHIP_TEXT[chip]}</span>
            <span className={`text-[10px] leading-tight ${selectedRir === chip ? 'text-white/80' : 'text-surface-500'}`}>
              {RIR_LABELS[chip]}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowFeedbackSheet(true)}
          disabled={disabled}
          aria-label="Add set feedback"
          className={`relative min-w-[52px] min-h-[52px] rounded-xl flex items-center justify-center transition-colors ${
            discomfort
              ? 'text-danger-400 bg-danger-500/10'
              : 'text-surface-400 hover:text-surface-200 bg-surface-800/50 hover:bg-surface-800'
          }`}
        >
          <IconMessagePlus size={20} />
          {hasSheetFeedback && (
            <span
              className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                discomfort ? 'bg-danger-400' : 'bg-primary-400'
              }`}
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
        className="w-full bg-primary-500 hover:bg-primary-600 text-white rounded-xl min-h-[52px] text-base font-semibold transition-colors disabled:opacity-40"
      >
        Log set
      </button>

      {/* Optional feedback sheet (absorbs the old SetFeedbackCard content) */}
      <BottomSheet
        isOpen={showFeedbackSheet}
        onClose={() => {
          setShowFeedbackSheet(false);
          setShowSheetDiscomfortPicker(false);
        }}
        title={`Set ${setNumber} feedback`}
      >
        <div className="space-y-4">
          <FormRatingSelector value={form} onChange={setForm} disabled={disabled} />

          {/* Injury / discomfort — the two-tap joint picker (this sheet is now
              its only entry point; the old bone-icon shortcut on the chip row
              was removed). The pick rides feedback.discomfort and is saved
              with the set, feeding joint_pain_events → deload advisor and
              exercise pain-pattern notices exactly as before. Collapsed behind
              a small neutral row (nothing is wrong, so no warning styling). */}
          <div className="space-y-2">
            <span className="block text-sm font-medium text-surface-300">Injury / discomfort</span>
            {discomfort ? (
              <DiscomfortSummaryRow
                discomfort={discomfort}
                onRemove={() => setDiscomfort(undefined)}
              />
            ) : showSheetDiscomfortPicker ? (
              <JointPainPicker
                onPick={(joint, severity) => {
                  setDiscomfort({ bodyPart: jointToBodyPart(joint), severity });
                  setShowSheetDiscomfortPicker(false);
                }}
                onCancel={() => setShowSheetDiscomfortPicker(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowSheetDiscomfortPicker(true)}
                disabled={disabled}
                data-testid="joint-pain-trigger"
                className="w-full min-h-[44px] flex items-center gap-1.5 rounded-lg bg-surface-800/50 hover:bg-surface-800 px-3 text-[13px] text-surface-400 hover:text-surface-200 transition-colors"
              >
                <IconPlus size={14} aria-hidden="true" />
                Log injury or discomfort (optional)
              </button>
            )}
          </div>

          <Input
            id={noteInputId}
            label="Note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional set note"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => {
              setShowFeedbackSheet(false);
              setShowSheetDiscomfortPicker(false);
            }}
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
