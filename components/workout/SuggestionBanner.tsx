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
  /**
   * Set when the entered reps fall well short of the target effort: the rep
   * count at this load that would leave `targetRir` in reserve (capped at the
   * top of the range).
   */
  repsForTarget?: number;
  targetRir?: number;
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
  /**
   * Plain-language reasoning lines for the predicted-RIR info sheet
   * (SetLoggerRow's always-visible readout): the capacity anchor and its
   * source, any within-session fatigue de-rate, the rep-max curve answer at
   * the entered load, and the subtraction that yields the predicted RIR.
   */
  reasoning: string[];
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
  /**
   * One short plain-language line saying where the number comes from
   * ("From your last session: 70 kg × 10 → one step up", "Estimated from
   * your profile — start light and adjust"). Always visible under the
   * suggestion; the ⓘ sheet keeps the full reasoning.
   */
  source?: string | null;
  /** Plain-language explanation lines for the info sheet. */
  explanation: string[];
  /** Live effort check for the entered stepper values. Null = not computable. */
  effortCheck?: EffortCheck | null;
  /** Advances when a set is logged — resets the per-set warning state. */
  setKey?: number | string;
  /**
   * Verdict on the most recent completed set (coach / logged effort). When
   * present the strip reads "{verdict} → {weight} × {reps}" and the
   * one-line reason moves to the top of the ⓘ sheet.
   */
  verdict?: string | null;
}

const RIR_EXPANSION = 'reps in reserve: how many more you could have done';
const RIR_DEFINITION_LINE =
  'RIR = reps in reserve: how many more reps you could have done. 0 = maxed, 1 = hard, 2 = good, 3 = easy, 4+ = cruise.';

/**
 * "RIR" with its meaning attached for assistive tech (and a hover title),
 * without adding a second tap target to the strip — the ⓘ sheet carries the
 * visible definition.
 */
function RirTerm() {
  return (
    <>
      <abbr title={RIR_EXPANSION} className="no-underline">
        RIR
      </abbr>
      <span className="sr-only"> ({RIR_EXPANSION})</span>
    </>
  );
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
  source = null,
  explanation,
  effortCheck = null,
  setKey,
  verdict = null,
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
        showWarning ? 'bg-status-warn-tint' : 'bg-action/10'
      }`}
    >
      {showWarning ? (
        <IconAlertTriangle
          size={16}
          className="text-status-warn flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
      ) : (
        <IconSparkles size={16} className="text-action flex-shrink-0 mt-0.5" aria-hidden="true" />
      )}
      {/* Suggestion copy and effort warning stacked in ONE grid cell: the
          banner's height is the max of both from the first render, so the
          debounced warning flip — driven by stepper presses — is a pure
          color/visibility change. A height change here moves the stepper
          buttons below mid-tap and repeated presses miss them. Only the
          visible layer is exposed to assistive tech. */}
      <div className="flex-1 min-w-0 grid">
        <p
          className={`col-start-1 row-start-1 text-caption leading-snug text-action ${
            showWarning ? 'invisible' : ''
          }`}
          aria-hidden={showWarning}
          aria-live="polite"
        >
          {verdict ? (
            <span data-testid="suggestion-verdict">
              {verdict} → <span className="font-medium">{weightLabel} × {repsLabel}</span>
            </span>
          ) : (
            <span className="font-medium">
              {weightLabel} × {repsLabel}
              {showRir ? (
                <>
                  {` @ ${rir} `}
                  <RirTerm />
                </>
              ) : null}
            </span>
          )}
          {roleTag ? (
            <span className="ml-1.5 rounded bg-action/20 px-1.5 py-0.5 text-caption text-action">
              {roleTag}
            </span>
          ) : null}
          {reason && !verdict ? <span> — {reason}</span> : null}
          {source ? (
            <span
              data-testid="suggestion-source"
              className="block mt-0.5 text-caption leading-snug text-ink-2"
            >
              {source}
            </span>
          ) : null}
        </p>
        {effortCheck != null && (
          <p
            data-testid={showWarning ? 'effort-warning' : undefined}
            aria-hidden={!showWarning}
            aria-live="polite"
            className={`col-start-1 row-start-1 text-caption leading-snug font-medium text-status-warn ${
              showWarning ? '' : 'invisible'
            }`}
          >
            {warningMessage}
          </p>
        )}
      </div>
      <button
        onClick={() => setShowInfo(true)}
        className={`flex-shrink-0 p-0.5 transition-colors ${
          showWarning
            ? 'text-status-warn/70 hover:text-status-warn'
            : 'text-action/70 hover:text-action'
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
          {[
            ...(verdict && reason
              ? [`${weightLabel} × ${repsLabel}${showRir ? ` @ ${rir} RIR` : ''} — ${reason}.`, ...explanation]
              : explanation),
            ...(showRir ? [RIR_DEFINITION_LINE] : []),
          ].map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-subhead text-ink">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-action flex-shrink-0" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}

export default SuggestionBanner;
