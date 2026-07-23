'use client';

/**
 * FeedbackChips — inline one-tap chip rows for subjective feedback capture.
 *
 * Design rules (RP-style, low friction):
 *  - In-workout prompts render inline where the user already is — no
 *    mid-workout modals. (Pump/workload moved to the end-of-workout
 *    MuscleGroupFeedbackModal, asked once per muscle group at finish.)
 *  - Every prompt is skippable by simply not tapping — logging and navigation
 *    are never blocked, and ignoring a row costs zero extra taps.
 *  - One tap records and the row collapses to a small confirmation line.
 */

import { useState } from 'react';
import { JOINT_PAIN_JOINTS, type JointPainJoint, type PumpRating0to3, type SorenessRating, type WorkloadRating } from '@/types/schema';
import { getJointDisplayName } from '@/services/discomfortTracker';

const chipBase =
  'px-2.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors whitespace-nowrap';
const chipIdle =
  'bg-surface-800 border-surface-700 text-surface-300 active:bg-surface-700';
const chipSelected = 'bg-primary-500/20 border-primary-500/60 text-primary-300';

// ---------------------------------------------------------------------------
// 1. Soreness (recovery ground truth) — start-of-session, once per muscle
// ---------------------------------------------------------------------------

export const SORENESS_CHIPS: { value: SorenessRating; emoji: string; label: string }[] = [
  { value: 0, emoji: '😀', label: "wasn't sore" },
  { value: 2, emoji: '🙂', label: 'sore, recovered' },
  { value: 3, emoji: '😖', label: 'still sore' },
];

export interface SorenessChipRowProps {
  /** Display name of the muscle being asked about (e.g. "Hamstrings"). */
  muscleLabel: string;
  /** The answer already recorded this session, if any (renders the ✓ line). */
  answered?: SorenessRating | null;
  onAnswer: (rating: SorenessRating) => void;
}

/**
 * `Hamstrings since last session:` 😀 · 🙂 · 😖
 * One tap records + collapses to a checkmark line. Ignoring it and logging a
 * set dismisses it for the session (parent records null and stops rendering).
 */
export function SorenessChipRow({ muscleLabel, answered, onAnswer }: SorenessChipRowProps) {
  if (answered !== undefined && answered !== null) {
    const chip = SORENESS_CHIPS.find((c) => c.value === answered);
    return (
      <div
        className="flex items-center gap-1.5 px-1 py-1 text-[12px] text-surface-400"
        data-testid="soreness-answered"
      >
        <span className="text-success-400">✓</span>
        <span>
          {muscleLabel}: {chip ? `${chip.emoji} ${chip.label}` : 'recorded'}
        </span>
      </div>
    );
  }

  return (
    <div className="px-1 py-1.5" data-testid="soreness-chip-row">
      <div className="text-[12px] text-surface-400 mb-1.5">
        {muscleLabel} since last session:
      </div>
      <div className="flex gap-1.5 overflow-x-auto">
        {SORENESS_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => onAnswer(chip.value)}
            className={`${chipBase} ${chipIdle}`}
            data-testid={`soreness-chip-${chip.value}`}
          >
            {chip.emoji} {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Pump / workload (stimulus quality) — asked once per muscle group in the
//    finish popup (MuscleGroupFeedbackModal), which renders these chip sets.
// ---------------------------------------------------------------------------

export const PUMP_CHIPS: { value: PumpRating0to3; bar: string; label: string }[] = [
  { value: 1, bar: '▁', label: 'low' },
  { value: 2, bar: '▂', label: 'good' },
  { value: 3, bar: '▄', label: 'great' },
];

export const WORKLOAD_CHIPS: { value: WorkloadRating; label: string }[] = [
  { value: 0, label: 'easy' },
  { value: 1, label: 'right' },
  { value: 3, label: 'too much' },
];

// ---------------------------------------------------------------------------
// 3. Joint pain (event, user-initiated) — inline two-tap picker
// ---------------------------------------------------------------------------

export const JOINT_SEVERITY_CHIPS: {
  value: 'twinge' | 'pain' | 'stop';
  label: string;
}[] = [
  { value: 'twinge', label: 'twinge' },
  { value: 'pain', label: 'painful' },
  { value: 'stop', label: 'had to stop' },
];

export interface JointPainPickerProps {
  onPick: (joint: JointPainJoint, severity: 'twinge' | 'pain' | 'stop') => void;
  onCancel?: () => void;
}

/**
 * Inline two-step picker: tap a joint, then a severity — two taps total.
 * Renders as two successive chip rows inside the set row's flow (no modal).
 */
export function JointPainPicker({ onPick, onCancel }: JointPainPickerProps) {
  const [joint, setJoint] = useState<JointPainJoint | null>(null);

  return (
    <div
      className="rounded-lg bg-surface-800/70 border border-surface-700 px-2 py-1.5 space-y-1.5"
      data-testid="joint-pain-picker"
    >
      {joint === null ? (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[12px] text-surface-400 flex-shrink-0">Joint:</span>
          {JOINT_PAIN_JOINTS.map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => setJoint(j)}
              className={`${chipBase} ${chipIdle}`}
              data-testid={`joint-chip-${j}`}
            >
              {getJointDisplayName(j)}
            </button>
          ))}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-surface-500 text-[12px] px-1.5 flex-shrink-0"
              aria-label="Cancel joint pain"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[12px] text-surface-400 flex-shrink-0">
            {getJointDisplayName(joint)}:
          </span>
          {JOINT_SEVERITY_CHIPS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onPick(joint, s.value)}
              className={`${chipBase} ${chipIdle}`}
              data-testid={`joint-severity-chip-${s.value}`}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setJoint(null)}
            className="text-surface-500 text-[12px] px-1.5 flex-shrink-0"
            aria-label="Back to joint list"
          >
            ←
          </button>
        </div>
      )}
    </div>
  );
}
