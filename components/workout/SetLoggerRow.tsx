'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IconBarbell,
  IconMinus,
  IconPencil,
  IconPlus,
  IconMessagePlus,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconRotate,
  IconInfoCircle,
  IconRepeat,
} from '@tabler/icons-react';
import { useDurationTimer } from '@/hooks/useDurationTimer';
import { BottomSheet } from './BottomSheet';
import type { EffortCheck } from './SuggestionBanner';
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
  SetType,
} from '@/types/schema';
import { convertWeightForDisplay } from '@/lib/utils';
import { buildSetLogData, maxRepsFor, weightStepForDisplay } from '@/lib/workout/setLogData';
import { stepLoad, type LoadGrid } from '@/lib/workout/loadableWeight';
import { lightHaptic } from '@/lib/integrations/notifications';
import { useBeginnerMode } from '@/hooks/useBeginnerMode';
import {
  BEGINNER_EFFORT_CHOICES,
  BEGINNER_EFFORT_EXPLAINER,
  beginnerEffortChoiceFor,
  effortLeftPhrase,
  plainWorkoutText,
} from '@/lib/beginnerMode';

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
  /**
   * Loadable weight grid in DISPLAY units (lib/workout/loadableWeight). When
   * given it overrides the step derived from `minIncrementKg`, so the stepper
   * and the suggestion rounding share one grid (bar-anchored for barbells).
   */
  weightGrid?: LoadGrid;
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
   * Live predicted effort for the CURRENTLY ENTERED weight × reps, computed
   * by the caller on the suggestion engine's own e1RM/curve (same object the
   * SuggestionBanner uses for its amber warning). Renders an always-visible
   * "~N RIR" readout under the steppers with an (i) reasoning sheet.
   * Null/omitted (no capacity anchor, duration-based) hides the readout.
   */
  effortCheck?: EffortCheck | null;
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
    setType: SetType;
    rirExplicitlySelected: boolean;
  }) => void;
  /**
   * Opens the plate calculator pre-filled with the current weight (P1-5).
   * The calculator has existed since the audit — this is its first
   * discoverable trigger at the point of use.
   */
  onPlateCalculatorOpen?: () => void;
  /**
   * RIR estimated from the motion capture at Stop (`nonce` changes per
   * capture). Preselects that chip unless the lifter already tapped one —
   * then it is offered instead. Logged untouched, the set's feedback carries
   * rirSource 'sensor'; any chip tap makes the RIR the lifter's own.
   */
  sensorRirPrefill?: { nonce: number; rir: RepsInTank } | null;
  /**
   * Context line on the pinned "Log set" bar (usually the exercise name), so
   * a lifter who can't see the card still knows what the tap logs.
   */
  stickyLabel?: string;
  /**
   * The suggestion's one-line reason and prediction, repeated on the pinned
   * bar (UX panel: a lifter who logs every set from the bar never scrolls to
   * the card's strip, so he never saw why the weight was picked). `why` is
   * the same text the strip's "Why:" line shows; `expect` is the strip's
   * forecast, shown only while the entered weight is still the one it was
   * made for.
   */
  stickyHint?: StickyHint | null;
}

export interface StickyHint {
  /** The strip's reason line (set-change or source line), already plain-worded. */
  why?: string | null;
  /** Predicted reps at `atWeight` (the suggested load, as the field shows it). */
  expect?: { repCount: number; atWeight: string } | null;
}

/**
 * The pinned bar's hint line: "Why: … · Expect ~9 reps". The forecast is
 * dropped once the lifter types a different weight — it was made for the
 * suggested load, not the entered one. Null when there is nothing to say.
 */
export function stickyHintText(
  hint: StickyHint | null | undefined,
  enteredWeight: string
): { why: string | null; expect: string | null } | null {
  if (!hint) return null;
  const why = hint.why?.trim() || null;
  const sameWeight =
    hint.expect != null &&
    Number.isFinite(parseFloat(enteredWeight)) &&
    Math.abs(parseFloat(enteredWeight) - parseFloat(hint.expect.atWeight)) < 0.001;
  const expect = sameWeight && hint.expect ? `Expect ~${hint.expect.repCount} reps` : null;
  return why || expect ? { why, expect } : null;
}

/**
 * DOM id of the workout page's bottom-chrome slot. When it exists the pinned
 * "Log set" bar portals into it, so it stacks with the rest timer instead of
 * colliding with it; otherwise the bar pins itself above the safe area.
 */
export const STICKY_LOG_SLOT_ID = 'workout-sticky-action-slot';

/** Share of the in-card button that must be on screen to count as reachable. */
const LOG_BUTTON_VISIBLE_RATIO = 0.6;

/**
 * Clamp a prescribed RIR to the 0-4 chip range. Also the ONE display value
 * for the target everywhere on the active set (suggestion strip, preset chip,
 * effort readout), so the strip can never say "@ 3 RIR" over a chip preset
 * to 4+.
 */
export function clampToChip(rir: number): RepsInTank {
  const rounded = Math.round(rir);
  return Math.max(0, Math.min(4, Number.isFinite(rounded) ? rounded : 2)) as RepsInTank;
}

// 0 → 4+ left to right (approved mockup): reads as "how many more could you
// have done?" counting up. The edit row in ExerciseCard uses the same order.
const RIR_CHIPS: RepsInTank[] = [0, 1, 2, 3, 4];

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
    <div className="flex items-center gap-2 rounded-lg bg-fill border border-sep px-2.5 py-1.5 text-caption">
      <span className={severityInfo.color}>
        {getBodyPartDisplayName(discomfort.bodyPart)} — {severityInfo.label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto text-ink-2 hover:text-ink"
        aria-label="Remove discomfort"
      >
        Remove
      </button>
    </div>
  );
}

/**
 * Large text: the five effort chips need the whole row (their "cruise" /
 * "maxed" labels clip otherwise), so the set-type and note buttons drop to a
 * second line, half width each, with their names shown.
 */
const LARGE_TEXT_ICON_BUTTON = 'large-text:flex-1 large-text:basis-[calc(50%_-_0.1875rem)]';

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
  weightGrid: weightGridProp,
  disabled = false,
  isDurationBased = false,
  exerciseId,
  isBodyweight = false,
  weightMode = 'bodyweight',
  userBodyweightKg,
  effortCheck = null,
  onLog,
  onPlateCalculatorOpen,
  sensorRirPrefill = null,
  stickyLabel,
  stickyHint = null,
}: SetLoggerRowProps) {
  const [selectedRir, setSelectedRir] = useState<RepsInTank>(() => clampToChip(targetRir));
  const [rirTouched, setRirTouched] = useState(false);
  // Beginner "What's this?" under the effort question (UX panel round 22).
  const [showEffortExplainer, setShowEffortExplainer] = useState(false);
  // The selected chip is the sensor's untouched estimate.
  const [rirFromSensor, setRirFromSensor] = useState(false);
  const [sensorRirOffer, setSensorRirOffer] = useState<RepsInTank | null>(null);
  const [selectedSetType, setSelectedSetType] = useState<SetType>('normal');
  const [editingField, setEditingField] = useState<'weight' | 'reps' | null>(null);
  const [showFeedbackSheet, setShowFeedbackSheet] = useState(false);
  const [showSetTypeSheet, setShowSetTypeSheet] = useState(false);
  const [showPredictionInfo, setShowPredictionInfo] = useState(false);
  // Beginner mode: effort in words only, never "RIR" / "in the tank".
  const beginner = useBeginnerMode();
  const [showSheetDiscomfortPicker, setShowSheetDiscomfortPicker] = useState(false);
  const [form, setForm] = useState<FormRating | null>(null);
  const [discomfort, setDiscomfort] = useState<SetDiscomfort | undefined>(undefined);
  const [note, setNote] = useState('');
  const noteInputId = useId();

  // Pinned "Log set" (UX panel: the in-card button sat below the fold at
  // phone width, so lifters scrolled for it on every set). Shown only while
  // the card's own button is below the visible area; scrolling down to it
  // hides the bar again, so the bar never sits over the button it stands in
  // for. Both buttons call the same handleLog.
  const logButtonRef = useRef<HTMLButtonElement>(null);
  const [logButtonBelowFold, setLogButtonBelowFold] = useState(false);
  useEffect(() => {
    const el = logButtonRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const reachable = entry.isIntersecting && entry.intersectionRatio >= LOG_BUTTON_VISIBLE_RATIO;
        // Below the fold only: a button scrolled off the TOP means the lifter
        // moved on down the page, and a bar for a card they left would confuse.
        const rootTop = entry.rootBounds?.top ?? 0;
        setLogButtonBelowFold(!reachable && entry.boundingClientRect.top > rootTop);
      },
      { threshold: [0, LOG_BUTTON_VISIBLE_RATIO, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-sync the default chip when the set advances or the prescription
  // changes — but a prescription change mid-set doesn't overwrite a sensor
  // estimate for the set just performed.
  const syncedSetNumberRef = useRef(setNumber);
  useEffect(() => {
    const newSet = syncedSetNumberRef.current !== setNumber;
    syncedSetNumberRef.current = setNumber;
    if (newSet) {
      setRirFromSensor(false);
      setSensorRirOffer(null);
    } else if (rirFromSensor) {
      return;
    }
    setSelectedRir(clampToChip(targetRir));
    setRirTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setNumber, targetRir]);

  // Sensor RIR prefill: one per capture Stop (keyed on the nonce).
  useEffect(() => {
    if (!sensorRirPrefill) return;
    if (rirTouched) {
      setSensorRirOffer(sensorRirPrefill.rir === selectedRir ? null : sensorRirPrefill.rir);
      return;
    }
    setSelectedRir(sensorRirPrefill.rir);
    setRirFromSensor(true);
    setSensorRirOffer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorRirPrefill?.nonce]);

  // Clear per-set feedback when the set advances.
  useEffect(() => {
    setForm(null);
    setDiscomfort(undefined);
    setNote('');
    setSelectedSetType('normal');
    setShowSheetDiscomfortPicker(false);
  }, [setNumber]);

  const unitLabel = unit === 'lb' ? 'lbs' : 'kg';
  const maxReps = maxRepsFor(Boolean(isDurationBased));
  const repsStep = isDurationBased ? 5 : 1;

  // ---- Hold timer (duration exercises) ----
  // Tap Start, get a 5-second camera-style countdown to grip the bar / set the
  // plank, then the hold counts up live (wall-clock based — survives phone lock),
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
  const holdCountingDown = isDurationBased && holdTimer.isCountingDown;
  const holdBusy = holdRunning || holdCountingDown;
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

  // Weight step in DISPLAY units (shared with the Apple Watch logger).
  const weightGrid = useMemo<LoadGrid>(
    () =>
      weightGridProp && weightGridProp.step > 0
        ? weightGridProp
        : { step: weightStepForDisplay(minIncrementKg, unit), offset: 0 },
    [weightGridProp, minIncrementKg, unit]
  );

  const isPlainBodyweight = isBodyweight && weightMode === 'bodyweight';
  const parsedWeight = parseFloat(weight);
  // Timed holds (dead hang, plank) frequently carry no external load, and a
  // duration exercise with no load prescription arrives here with a blank or
  // zero weight. That is a real, loggable set — treat it as 0 kg rather than
  // an invalid entry that silently disables "Log set".
  const weightNum = isDurationBased && isNaN(parsedWeight) ? 0 : parsedWeight;
  const repsNum = parseInt(reps);
  const weightValid =
    isPlainBodyweight ||
    (!isNaN(weightNum) && weightNum >= 0 && (isBodyweight || isDurationBased || weightNum > 0));
  const repsValid = !isNaN(repsNum) && repsNum >= 1 && repsNum <= maxReps;
  // Mid-hold you're holding, not logging: Stop commits the time first.
  const canLog = !disabled && weightValid && repsValid && !holdBusy;
  const hasSheetFeedback = form !== null || discomfort !== undefined || note.trim().length > 0;

  const stepWeight = (direction: 1 | -1) => {
    // Off-grid values (a legacy or hand-typed number) step onto the grid:
    // 154.3 + 5 → 155, not 159.3.
    onWeightChange(String(stepLoad(isNaN(weightNum) ? 0 : weightNum, direction, weightGrid)));
  };

  const stepReps = (direction: 1 | -1) => {
    const current = isNaN(repsNum) ? 0 : repsNum;
    const next = Math.min(maxReps, Math.max(1, current + direction * repsStep));
    onRepsChange(String(next));
  };

  const handleLog = () => {
    if (!canLog) return;

    // Built by the shared helper so a set logged from the Apple Watch is the
    // same payload this row would produce (lib/workout/setLogData).
    const data = buildSetLogData({
      weight: weightNum,
      reps: repsNum,
      rir: selectedRir,
      unit,
      form,
      discomfort,
      rirFromSensor,
      note,
      setType: selectedSetType,
      isBodyweight,
      weightMode,
      userBodyweightKg,
    });

    onLog({ ...data, rirExplicitlySelected: rirTouched });

    // Light haptic feedback on set complete (native only)
    void lightHaptic();

    // Reset per-set feedback for the next set.
    setForm(null);
    setDiscomfort(undefined);
    setNote('');
    setShowFeedbackSheet(false);
    setShowSheetDiscomfortPicker(false);
  };

  // The pinned bar steps aside whenever something else owns the bottom of
  // the screen: a sheet from this row, or a field being typed into (the
  // keyboard is up and the bar must not sit over the input).
  const showStickyLog =
    logButtonBelowFold &&
    editingField === null &&
    !showFeedbackSheet &&
    !showSetTypeSheet &&
    !showPredictionInfo;
  // Looked up at render: showStickyLog only turns true from the observer
  // callback, so this never runs during server rendering.
  const stickyTarget =
    showStickyLog && typeof document !== 'undefined'
      ? document.getElementById(STICKY_LOG_SLOT_ID)
      : null;
  const stickyWeightText = isPlainBodyweight
    ? 'BW'
    : `${isBodyweight && weightMode === 'assisted' ? 'BW −' : isBodyweight && weightMode === 'weighted' ? 'BW +' : ''}${weight || '0'} ${unitLabel}`;
  const stickySummary = `${stickyWeightText} × ${reps || '0'}${isDurationBased ? 's' : ' reps'} · ${
    RIR_CHIP_TEXT[selectedRir]
  } left`;
  const stickyHintLine = stickyHintText(stickyHint, weight);
  const stickyBar = (
    <div
      data-testid="sticky-log-set"
      className="flex items-center gap-3 rounded-card border border-sep bg-card p-2 shadow-lg"
    >
      <div className="min-w-0 flex-1 pl-1 leading-tight">
        <span className="block truncate text-caption text-ink-2">
          {stickyLabel ? `${stickyLabel} · Set ${setNumber}` : `Set ${setNumber}`}
        </span>
        <span className="block truncate text-subhead font-semibold tabular-nums text-ink">
          {stickySummary}
        </span>
        {/* Why + forecast: wraps to two lines rather than truncating, so the
            reason survives 390 px and the larger text sizes. */}
        {stickyHintLine ? (
          <span data-testid="sticky-log-hint" className="mt-0.5 line-clamp-2 text-caption text-ink">
            {stickyHintLine.why ? (
              <>
                <span className="font-semibold text-action">Why: </span>
                <span data-testid="sticky-log-why">{stickyHintLine.why}</span>
              </>
            ) : null}
            {stickyHintLine.why && stickyHintLine.expect ? <span className="text-ink-2"> · </span> : null}
            {stickyHintLine.expect ? (
              <span data-testid="sticky-log-expect" className="text-ink-2">
                {stickyHintLine.expect}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={handleLog}
        disabled={!canLog}
        aria-label={`Log set ${setNumber}: ${stickySummary}`}
        className="flex-shrink-0 rounded-button bg-action px-6 min-h-[52px] text-headline text-on-action transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-40"
      >
        Log set
      </button>
    </div>
  );

  // Gym-proof tap targets (P0-4): every interactive control in this row is
  // ≥44px in both axes, with the primary input row at 52px tall.
  // Large text: each stepper takes its own line (beside the set number when
  // it shows: w-4 + gap = 1.375rem).
  const stackedStepperClass = onPlateCalculatorOpen
    ? 'large-text:basis-full'
    : 'large-text:basis-[calc(100%_-_1.375rem)]';
  const stepperButtonClass =
    'min-w-[44px] min-h-[56px] flex items-center justify-center rounded-xl text-action active:bg-fill transition-colors disabled:opacity-30';

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
          className="w-full min-w-0 px-1 min-h-[56px] bg-card border border-action rounded-xl text-center text-title font-bold tabular-nums text-ink focus:outline-none"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => setEditingField(field)}
        disabled={disabled}
        aria-label={`${ariaLabel}: ${displayText}${unitText ? ` ${unitText}` : ''}. Tap to type`}
        className="w-full min-w-0 min-h-[56px] flex flex-col items-center justify-center leading-tight"
      >
        {/* Visible "you can type here" affordance: a dashed underline on
            the number and a pencil by the unit (the panel's beginners didn't
            know the prefilled numbers were theirs to change). */}
        <span
          data-testid={`logger-${field}-value`}
          className="text-title font-bold tabular-nums text-ink whitespace-nowrap underline decoration-dashed decoration-ink-3 decoration-1 underline-offset-4"
        >
          {displayText}
        </span>
        <span className="inline-flex items-center gap-0.5 text-caption text-ink-2">
          {unitText}
          <IconPencil size={11} aria-hidden="true" data-testid={`logger-${field}-edit-hint`} />
        </span>
      </button>
    );
  };

  return (
    <div
      className="rounded-card bg-action-tint p-3 space-y-2.5"
      role="group"
      aria-label={`Set ${setNumber} logger`}
      // The workout page keeps this clear of its fixed bottom stack when the
      // stack grows (a toast arriving) — see keepClearOfBottomChrome.
      data-active-logger=""
    >
      {/* Row 0: set label + plate calculator affordance (P1-5, mockup 02) */}
      {onPlateCalculatorOpen && (
        <div className="flex items-center justify-between -mb-1">
          <span className="text-body font-semibold text-ink">Set {setNumber}</span>
          <button
            type="button"
            onClick={onPlateCalculatorOpen}
            disabled={disabled}
            aria-label="Open plate calculator"
            className="min-h-[44px] -my-2.5 px-2 inline-flex items-center gap-1 text-subhead font-semibold text-action transition-colors"
          >
            <IconBarbell size={14} aria-hidden="true" />
            Plates
          </button>
        </div>
      )}

      {/* Row 1: set number, weight stepper, reps stepper. With Large /
          Larger text the fixed 44px steppers leave too little room for the
          number between them, so weight and reps stack (large-text:). */}
      <div className="flex items-center gap-1.5 large-text:flex-wrap">
        {!onPlateCalculatorOpen && (
          <span className="w-4 flex-shrink-0 text-body font-semibold text-ink text-center">
            {setNumber}
          </span>
        )}

        {/* Weight */}
        {isPlainBodyweight ? (
          <div className={`flex-1 flex items-center justify-center min-h-[56px] rounded-xl bg-card text-body font-semibold tabular-nums text-ink ${stackedStepperClass}`}>
            <span className="text-ink-2 mr-1">BW</span>
            {userBodyweightKg ? `${convertWeightForDisplay(userBodyweightKg, unit)} ${unitLabel}` : ''}
          </div>
        ) : (
          <div className={`flex-1 flex items-center min-w-0 rounded-xl bg-card ${stackedStepperClass}`}>
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
        <div
          className={`flex-1 flex items-center min-w-0 rounded-xl bg-card ${stackedStepperClass} ${
            onPlateCalculatorOpen ? '' : 'large-text:ml-[1.375rem]'
          }`}
        >
          <button
            type="button"
            onClick={() => stepReps(-1)}
            disabled={disabled || holdBusy}
            aria-label={isDurationBased ? 'Decrease seconds' : 'Decrease reps'}
            className={stepperButtonClass}
          >
            <IconMinus size={16} />
          </button>
          {holdCountingDown ? (
            // Camera-style lead-in: big count, then the hold clock starts.
            <div
              className="w-full min-w-0 min-h-[52px] flex flex-col items-center justify-center leading-tight"
              aria-live="assertive"
              aria-label={`Starting in ${holdTimer.countdownRemaining} seconds`}
              data-testid="hold-countdown"
            >
              <span className="text-title font-bold text-action whitespace-nowrap tabular-nums">
                {holdTimer.countdownRemaining}
              </span>
              <span className="text-caption text-ink-2">
                get set
              </span>
            </div>
          ) : holdRunning ? (
            // Live hold readout while the timer runs — the field commits on Stop.
            <div
              className="w-full min-w-0 min-h-[52px] flex flex-col items-center justify-center leading-tight"
              aria-live="polite"
              aria-label={`Holding: ${holdTimer.elapsed} seconds`}
            >
              <span className="text-title font-bold tabular-nums text-action whitespace-nowrap">
                {holdTimer.elapsed}s
              </span>
              {holdTargetSeconds ? (
                <span className="text-caption text-ink-2">
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
            disabled={disabled || holdBusy}
            aria-label={isDurationBased ? 'Increase seconds' : 'Increase reps'}
            className={stepperButtonClass}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </div>

      {/* Hold timer row (duration exercises): tap Start, get the 5-second
          "get in position" countdown, hold, stop to capture, then adjust with
          the −/+ steppers above before logging. */}
      {isDurationBased && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => holdTimer.toggle()}
            disabled={disabled}
            aria-label={
              holdTimer.isCountingDown
                ? 'Cancel hold countdown'
                : holdTimer.isRunning
                  ? 'Stop hold timer'
                  : holdTimer.hasStarted
                    ? 'Resume hold timer'
                    : 'Start hold timer'
            }
            className={`relative flex-1 min-h-[44px] rounded-lg overflow-hidden flex items-center justify-center gap-2 text-subhead font-semibold transition-colors ${
              holdTimer.isRunning || holdTimer.isCountingDown
                ? 'bg-action text-on-action'
                : 'bg-card text-action'
            } disabled:opacity-30`}
          >
            {/* Progress toward the target while running */}
            {holdTimer.isRunning && holdTargetSeconds ? (
              <span
                className={`absolute inset-y-0 left-0 opacity-25 transition-all duration-200 ${
                  holdTimer.hasReachedTarget ? 'bg-status-ok' : 'bg-action'
                }`}
                style={{ width: `${Math.min(100, holdTimer.progressPercent)}%` }}
                aria-hidden="true"
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-2">
              {holdTimer.isCountingDown ? (
                <>Get in position · {holdTimer.countdownRemaining}s — tap to cancel</>
              ) : holdTimer.isRunning ? (
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
          {holdTimer.isCountingDown && (
            // Already gripped? Skip the lead-in and start the clock now.
            <button
              type="button"
              onClick={() => holdTimer.startNow()}
              disabled={disabled}
              aria-label="Start hold now"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-fill text-ink hover:text-ink transition-colors disabled:opacity-30"
            >
              <IconPlayerPlayFilled size={16} />
            </button>
          )}
          {holdTimer.hasStarted && !holdTimer.isRunning && !holdTimer.isCountingDown && (
            <button
              type="button"
              onClick={() => {
                holdTimer.reset();
                holdCommittedRef.current = false;
              }}
              disabled={disabled}
              aria-label="Reset hold timer"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-fill text-ink-2 hover:text-ink transition-colors disabled:opacity-30"
            >
              <IconRotate size={16} />
            </button>
          )}
        </div>
      )}

      {/* Row 1.5: live predicted RIR for the ENTERED weight × reps. Always
          visible while a prediction exists (unlike the banner's amber
          warning, which only fires at ≤ 0 RIR); the (i) opens a sheet that
          walks through the math in plain language. */}
      {effortCheck && (
        <div className="flex items-center justify-between gap-2 pl-1" data-testid="predicted-rir">
          <span
            aria-live="polite"
            className={`text-caption leading-snug ${
              effortCheck.predictedRir <= 0 ? 'text-status-warn' : 'text-ink-2'
            }`}
          >
            {effortCheck.predictedRir < 0
              ? effortCheck.softened
                ? // No history on this lift: the number is a starting guess,
                  // so say what to do rather than claim a max.
                  'This starting guess may be more than you can do — lower it if it feels heavy'
                : `Predicted: ${Math.abs(effortCheck.predictedRir)} rep${
                    Math.abs(effortCheck.predictedRir) === 1 ? '' : 's'
                  } more than you can likely do`
              : // A forecast for the entered weight, not the chip below (which is
                // how the set actually felt) — say so, or the two read as a clash.
                `At this weight: ${
                  beginner
                    ? effortLeftPhrase(effortCheck.predictedRir)
                    : `about ${effortCheck.predictedRir} more in the tank (${
                        RIR_LABELS[clampToChip(effortCheck.predictedRir)]
                      })`
                }${
                  effortCheck.repsForTarget != null
                    ? beginner
                      ? ` · ~${effortCheck.repsForTarget} reps would hit your target`
                      : ` · ~${effortCheck.repsForTarget} reps would leave ${effortCheck.targetRir}, your target`
                    : clampToChip(effortCheck.predictedRir) === clampToChip(targetRir)
                      ? ' · on target'
                      : ''
                }`}
            {effortCheck.softened ? ' · rough estimate' : ''}
          </span>
          <button
            type="button"
            onClick={() => setShowPredictionInfo(true)}
            aria-label={beginner ? 'How this prediction works' : 'How this RIR prediction works'}
            className="min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center flex-shrink-0 text-ink-2 hover:text-ink transition-colors"
          >
            <IconInfoCircle size={16} />
          </button>
        </div>
      )}

      {/* Row 2: effort chips (labeled, full-width) + set type + feedback sheet
          trigger. Asked in plain words; "RIR" stays in the accessible names. */}
      <div className="flex items-baseline justify-between gap-2 pl-1">
        <p className="text-subhead font-medium text-ink" id={`effort-q-${setNumber}`}>
          {beginner ? 'After the set: how many more reps could you have done?' : 'After the set: how many more could you have done?'}
        </p>
        {beginner && (
          // "A beginner wouldn't know what the feel-rating means" (UX panel
          // round 22, Maya): a visible word, not another ⓘ.
          <button
            type="button"
            onClick={() => setShowEffortExplainer((v) => !v)}
            aria-expanded={showEffortExplainer}
            data-testid="effort-whats-this"
            className="flex-shrink-0 min-h-[44px] -my-3 text-caption font-medium text-action underline underline-offset-2"
          >
            What&apos;s this?
          </button>
        )}
      </div>
      {beginner && showEffortExplainer && (
        <p className="-mt-1 pl-1 text-caption text-ink-2" data-testid="effort-explainer">
          {BEGINNER_EFFORT_EXPLAINER}
        </p>
      )}
      {!rirTouched && !rirFromSensor && (
        // The chip starts on the target effort so logging stays one tap; say
        // so, and why, on its own line — an untouched chip read as an answer
        // the lifter never gave, and the inline grey note was missed (UX
        // panel round 20, 3 of 6: "a preselected answer, unexplained").
        <p className="-mt-1 pl-1 text-caption text-ink-2" data-testid="rir-preset-note">
          {beginner
            ? `We picked today’s target (“${
                BEGINNER_EFFORT_CHOICES.find((c) => c.rir === beginnerEffortChoiceFor(targetRir))?.label ?? 'Just right'
              }”) so logging is one tap. If the set felt harder or easier, tap that answer first.`
            : `Preset to your target (${RIR_CHIP_TEXT[clampToChip(targetRir)]}) so logging is one tap. Tap another if the set felt different.`}
        </p>
      )}
      <div
        className="flex items-stretch gap-1.5 large-text:flex-wrap"
        role="group"
        aria-labelledby={`effort-q-${setNumber}`}
      >
        {/* Beginner mode: three plain answers, each logging an existing chip
            value (lib/beginnerMode BEGINNER_EFFORT_CHOICES). Untouched, the
            preset value logs exactly as on the five chips — the highlight
            only rounds it to the nearest answer. */}
        {beginner && BEGINNER_EFFORT_CHOICES.map((choice) => {
          const isSelected = beginnerEffortChoiceFor(selectedRir) === choice.rir;
          return (
            <button
              key={choice.rir}
              type="button"
              onClick={() => {
                setSelectedRir(choice.rir);
                setRirTouched(true);
                setRirFromSensor(false);
                setSensorRirOffer(null);
              }}
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`${choice.label}, ${choice.hint}`}
              data-testid={`beginner-effort-${choice.rir}`}
              className={`${SELECTOR_CHIP_BASE} px-1 text-center ${
                isSelected ? SELECTOR_CHIP_SELECTED : SELECTOR_CHIP_IDLE
              }`}
            >
              <span className="text-caption font-semibold leading-tight">{choice.label}</span>
              <span className={`text-caption leading-tight ${isSelected ? 'opacity-80' : 'text-ink-2'}`}>
                {choice.hint}
              </span>
            </button>
          );
        })}
        {!beginner && RIR_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setSelectedRir(chip);
              setRirTouched(true);
              setRirFromSensor(false);
              setSensorRirOffer(null);
            }}
            disabled={disabled}
            aria-label={`${RIR_CHIP_TEXT[chip]} reps in reserve (${RIR_LABELS[chip]})`}
            aria-pressed={selectedRir === chip}
            className={`${SELECTOR_CHIP_BASE} ${
              selectedRir === chip ? SELECTOR_CHIP_SELECTED : SELECTOR_CHIP_IDLE
            }`}
          >
            <span className="text-body font-semibold leading-tight">{RIR_CHIP_TEXT[chip]}</span>
            <span className={`text-caption leading-tight ${selectedRir === chip ? 'opacity-80' : 'text-ink-2'}`}>
              {RIR_LABELS[chip]}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowSetTypeSheet(true)}
          disabled={disabled}
          aria-label={selectedSetType === 'normal' ? 'Set type: normal (tap to change)' : `Set type: ${selectedSetType}`}
          className={`relative min-w-[52px] min-h-[52px] rounded-xl flex items-center justify-center gap-2 transition-colors ${LARGE_TEXT_ICON_BUTTON} ${
            selectedSetType !== 'normal'
              ? 'text-on-action bg-action'
              : 'text-action bg-card hover:bg-fill'
          }`}
          title={selectedSetType === 'normal' ? 'Normal set' : selectedSetType.replace('_', '-')}
        >
          <IconRepeat size={20} />
          <span className="hidden large-text:inline text-subhead font-medium">Set type</span>
          {selectedSetType !== 'normal' && (
            <span
              className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-on-action"
              aria-hidden="true"
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowFeedbackSheet(true)}
          disabled={disabled}
          aria-label="Add set feedback"
          className={`relative min-w-[52px] min-h-[52px] rounded-xl flex items-center justify-center gap-2 transition-colors ${LARGE_TEXT_ICON_BUTTON} ${
            discomfort
              ? 'text-status-bad bg-status-bad-tint'
              : 'text-action bg-card hover:bg-fill'
          }`}
        >
          <IconMessagePlus size={20} />
          <span className="hidden large-text:inline text-subhead font-medium">Note</span>
          {hasSheetFeedback && (
            <span
              className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                discomfort ? 'bg-status-bad' : 'bg-action'
              }`}
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      {/* Sensor RIR: a note on a prefilled chip, or an offer when the lifter
          had already picked one. */}
      {rirFromSensor && (
        <p className="pl-1 text-caption text-ink-2" data-testid="sensor-rir-note">
          {RIR_CHIP_TEXT[selectedRir]} {beginner ? 'left, estimated' : 'RIR estimated'} from bar speed · tap a chip to change
        </p>
      )}
      {sensorRirOffer !== null && (
        <div
          className="flex items-center justify-between gap-2 px-1 text-subhead text-ink"
          data-testid="sensor-rir-offer"
        >
          <span>
            Bar speed suggests {RIR_CHIP_TEXT[sensorRirOffer]} {beginner ? 'left' : 'RIR'}.
          </span>
          <span className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedRir(sensorRirOffer);
                setRirFromSensor(true);
                setSensorRirOffer(null);
              }}
              className="font-semibold text-action"
              data-testid="sensor-rir-offer-use"
            >
              Use {RIR_CHIP_TEXT[sensorRirOffer]}
            </button>
            <button
              type="button"
              onClick={() => setSensorRirOffer(null)}
              className="text-ink-2 hover:text-ink"
              aria-label="Keep my RIR"
            >
              Keep mine
            </button>
          </span>
        </div>
      )}

      {/* Row 3: one-tap log */}
      <button
        ref={logButtonRef}
        type="button"
        onClick={handleLog}
        disabled={!canLog}
        className="w-full bg-action text-on-action rounded-button min-h-[52px] text-headline transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-40"
      >
        Log set
      </button>

      {/* Pinned copy of the button while the one above is below the fold.
          Into the page's bottom-chrome slot when there is one (it stacks with
          the rest timer and hides with the keyboard), else pinned above the
          iOS safe area on its own. */}
      {showStickyLog &&
        typeof document !== 'undefined' &&
        (stickyTarget
          ? createPortal(stickyBar, stickyTarget)
          : createPortal(
              <div
                className="fixed inset-x-3 z-40 mx-auto max-w-2xl"
                style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
              >
                {stickyBar}
              </div>,
              document.body
            ))}

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
            <span className="block text-subhead font-medium text-ink">Injury / discomfort</span>
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
                className="w-full min-h-[44px] flex items-center gap-1.5 rounded-lg bg-fill hover:brightness-110 px-3 text-subhead text-ink-2 hover:text-ink transition-colors"
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
            className="w-full bg-action text-on-action rounded-button min-h-[44px] text-body font-semibold transition-colors"
          >
            Done
          </button>
          <p className="text-caption text-ink-2 text-center">
            All optional — feedback is saved with the set when you tap Log set.
          </p>
        </div>
      </BottomSheet>

      {/* Set type selector sheet */}
      <BottomSheet
        isOpen={showSetTypeSheet}
        onClose={() => setShowSetTypeSheet(false)}
        title="Set type"
      >
        <div className="space-y-3">
          <p className="text-subhead text-ink-2">
            {beginner
              ? 'Most sets are Normal. Only pick another if you did it on purpose.'
              : 'Mark advanced training techniques so they don\'t contaminate progression estimates.'}
          </p>
          {(['normal', 'rest_pause', 'myorep', 'dropset'] as const).map((type) => {
            const labels: Record<typeof type, { name: string; desc: string }> = {
              normal: {
                name: 'Normal',
                desc: 'Standard straight set',
              },
              rest_pause: {
                name: 'Rest-Pause',
                desc: 'Multiple mini-sets with short pauses',
              },
              myorep: {
                name: 'Myo-Rep',
                desc: 'Activation set + mini-sets near failure',
              },
              dropset: {
                name: 'Drop set',
                desc: 'Immediately reduce weight and continue',
              },
            };
            const label = labels[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setSelectedSetType(type);
                  setShowSetTypeSheet(false);
                }}
                disabled={disabled}
                className={`w-full min-h-[44px] flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedSetType === type
                    ? 'bg-action-tint border border-action/50'
                    : 'bg-fill hover:brightness-110 border border-sep'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-body font-medium text-ink">{label.name}</div>
                  <div className="text-caption text-ink-2 mt-0.5">{label.desc}</div>
                </div>
                {selectedSetType === type && (
                  <span className="text-action text-caption font-medium mt-0.5">✓</span>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* Predicted-RIR reasoning sheet (mirrors the SuggestionBanner info
          sheet's list styling — one input layer of the math per line). */}
      {effortCheck && (
        <BottomSheet
          isOpen={showPredictionInfo}
          onClose={() => setShowPredictionInfo(false)}
          title={`Why ${effortCheck.weightLabel} × ${effortCheck.reps} ≈ ${
            effortCheck.predictedRir < 0
              ? 'past max'
              : beginner
                ? effortLeftPhrase(effortCheck.predictedRir)
                : `${effortCheck.predictedRir} left in the tank (RIR)`
          }`}
        >
          <ul className="space-y-2.5" data-testid="predicted-rir-reasoning">
            {(beginner ? effortCheck.reasoning.map(plainWorkoutText) : effortCheck.reasoning).map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-subhead text-ink">
                <span
                  className="mt-1.5 w-1 h-1 rounded-full bg-action flex-shrink-0"
                  aria-hidden="true"
                />
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-caption text-ink-2">
            The prediction updates live as you change the weight or reps, and it uses the same
            math as the set suggestion above — it can be off on any given day, so trust how the
            set actually feels.
          </p>
        </BottomSheet>
      )}
    </div>
  );
}

export default SetLoggerRow;
