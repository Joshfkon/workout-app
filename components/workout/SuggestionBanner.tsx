'use client';

import { useEffect, useState } from 'react';
import { IconSparkles, IconInfoCircle, IconAlertTriangle } from '@tabler/icons-react';
import { BottomSheet } from './BottomSheet';

/**
 * Live effort check for the CURRENTLY ENTERED weight × reps (the logger's
 * stepper values). `predictedRir` is computed by the caller on the same e1RM
 * value and Epley rep-max curve the suggestion engine used for this
 * prescription (services/setRecommender.ts — prescribe()/estimateRepsForWeight),
 * so the warning can never disagree with the suggestion math.
 */
export interface EffortCheck {
  /** Predicted reps-in-reserve at the entered weight × reps. */
  predictedRir: number;
  /** Entered load, display-formatted (e.g. "140 lbs", "BW +25 lbs"). */
  weightLabel: string;
  /** Entered reps. */
  reps: number;
  /**
   * True when the e1RM behind the prediction is transferred/estimated rather
   * than derived from this exercise's own logged sets — softens the copy.
   */
  softened: boolean;
  /** Names the estimate's source for the softened copy. */
  sourceLabel?: string;
}

interface SuggestionBannerProps {
  /** Suggested load, already formatted for display (e.g. "62.5 lbs", "BW +10 lbs"). */
  weightLabel: string;
  /** Suggested reps (or seconds), already formatted (e.g. "8–12", "30s"). */
  repsLabel: string;
  /** Target RIR shown to the user. */
  rir: number;
  /**
   * Whether to display the RIR target. Ramp/feeder sets carry no effort target,
   * so the banner must not assert an "@ N RIR" claim on them (Phase 5 honesty).
   * Defaults to true for backward compatibility.
   */
  showRir?: boolean;
  /** Set role tag to surface (e.g. "ramp"). Null/omitted shows no tag. */
  roleTag?: string | null;
  /** One-sentence reason for the suggestion. */
  reason: string;
  /** Plain-language explanation lines for the info sheet. */
  explanation: string[];
  /** Live effort check for the entered stepper values. Null = not computable. */
  effortCheck?: EffortCheck | null;
  /** Advances when a set is logged — resets the per-set warning state. */
  setKey?: number | string;
}

/**
 * Tinted accent strip inside the exercise card showing the next-set
 * suggestion with its reasoning. The info icon opens a bottom sheet that
 * explains the math in plain language (trust-building surface).
 *
 * Effort warning state: while the entered weight × reps back-computes to
 * ≤ 0 predicted RIR, the strip turns amber and the copy becomes effort
 * feedback. Debounced ~250ms with hysteresis (enter at ≤ 0, exit at ≥ 1) so
 * boundary stepping doesn't flicker; local state keeps the transition's
 * re-render scoped to this banner. Amber only — never blocking.
 */
export function SuggestionBanner({
  weightLabel,
  repsLabel,
  rir,
  showRir = true,
  roleTag = null,
  reason,
  explanation,
  effortCheck = null,
  setKey,
}: SuggestionBannerProps) {
  const [showInfo, setShowInfo] = useState(false);
  const [warningActive, setWarningActive] = useState(false);

  const predictedRir = effortCheck?.predictedRir ?? null;

  // Per-set warning: clears the moment the set is logged (setKey advances).
  useEffect(() => {
    setWarningActive(false);
  }, [setKey]);

  // Debounced (~250ms) recompute with hysteresis: enter the warning at
  // predicted RIR ≤ 0, leave it only at ≥ 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setWarningActive((prev) => {
        if (predictedRir == null) return false;
        if (!prev && predictedRir <= 0) return true;
        if (prev && predictedRir >= 1) return false;
        return prev;
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [predictedRir]);

  const showWarning = warningActive && effortCheck != null;

  const warningMessage = effortCheck
    ? effortCheck.softened
      ? `${effortCheck.weightLabel} × ${effortCheck.reps} may be near max — ${
          effortCheck.sourceLabel ?? 'estimated for you'
        }`
      : effortCheck.predictedRir < 0
        ? `${effortCheck.weightLabel} × ${effortCheck.reps} — past your predicted max at this weight`
        : `${effortCheck.weightLabel} × ${effortCheck.reps} ≈ 0 RIR — predicted max for you`
    : '';

  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-3 py-2 transition-colors ${
        showWarning ? 'bg-amber-500/10' : 'bg-primary-500/10'
      }`}
    >
      {showWarning ? (
        <IconAlertTriangle
          size={16}
          className="text-amber-400 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
      ) : (
        <IconSparkles size={16} className="text-primary-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
      )}
      {showWarning ? (
        <p
          data-testid="effort-warning"
          aria-live="polite"
          className="flex-1 text-[12px] leading-snug font-medium text-amber-400"
        >
          {warningMessage}
        </p>
      ) : (
        <p className="flex-1 text-[12px] leading-snug text-primary-400" aria-live="polite">
          <span className="font-medium">
            {weightLabel} × {repsLabel}
            {showRir ? ` @ ${rir} RIR` : ''}
          </span>
          {roleTag ? (
            <span className="ml-1.5 rounded bg-primary-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary-300">
              {roleTag}
            </span>
          ) : null}
          {reason ? <span> — {reason}</span> : null}
        </p>
      )}
      <button
        onClick={() => setShowInfo(true)}
        className={`flex-shrink-0 p-0.5 transition-colors ${
          showWarning
            ? 'text-amber-400/70 hover:text-amber-300'
            : 'text-primary-400/70 hover:text-primary-300'
        }`}
        aria-label="How this suggestion works"
      >
        <IconInfoCircle size={16} />
      </button>

      <BottomSheet
        isOpen={showInfo}
        onClose={() => setShowInfo(false)}
        title="How this suggestion works"
      >
        <ul className="space-y-2.5">
          {explanation.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-surface-300">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-primary-400 flex-shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

export default SuggestionBanner;
