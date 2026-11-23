'use client';

/**
 * RestTimer — the floating rest card (design system "Workout · logging").
 *
 * Purely presentational and fully controlled: all timer logic (countdown,
 * persistence across reloads, sound/haptics, native notifications) lives in
 * `hooks/useRestTimer`; the workout page owns the hook and threads its state
 * here.
 *
 * P0-5 (UX audit): the workout page renders this in a FIXED bottom wrapper so
 * the countdown stays visible while scrolling. Tapping the card (outside the
 * buttons) scrolls back to the current exercise via `onBarTap`.
 *
 * Layout: "Rest · next 185 × 7" over a big countdown on the left; −15 / +15 /
 * Skip on the right; elapsed progress as a thin bar along the bottom edge.
 */

import { formatDuration } from '@/lib/utils';
import { InfoTooltip } from '@/components/ui';
import { TOOLTIP_CONTENT } from '@/types/education';
import { useBeginnerMode } from '@/hooks/useBeginnerMode';

/**
 * The rest tooltip in beginner words: the standard copy explains the
 * extension against the "RIR target".
 */
const BEGINNER_REST_TOOLTIP = {
  ...TOOLTIP_CONTENT.REST_PERIODS,
  longExplanation:
    'Longer rest (2+ minutes) lets you do more good reps on your next set. The timer starts from this exercise’s planned rest and adds time after a set that was very hard. It never cuts your rest short after an easy set.',
};

/**
 * One-line explanation for the first rest of a session: "Rest about 3 min
 * between sets. −15s / +15s to change." Rounded to the half minute
 * (under a minute, to 5 s); the countdown itself shows the exact time.
 */
export function restIntroText(totalSeconds: number): string {
  const amount =
    totalSeconds < 60
      ? `${Math.max(5, Math.round(totalSeconds / 5) * 5)} sec`
      : `${(Math.round(totalSeconds / 30) / 2).toString()} min`;
  return `Rest about ${amount} between sets. −15s / +15s to change.`;
}

export interface RestTimerProps {
  /** Remaining seconds. */
  seconds: number;
  /** Seconds the countdown started from (drives the elapsed fraction). */
  initialSeconds: number;
  isRunning: boolean;
  isFinished: boolean;
  /** Add (or subtract) seconds: "+15s" calls onAddTime(15), "−15s" onAddTime(-15). */
  onAddTime: (amount: number) => void;
  /** Skip the remaining rest. */
  onSkip: () => void;
  /** e.g. "next · 145 lbs × 6–10" — shown above the countdown. */
  nextLabel?: string;
  /**
   * Why this rest isn't the plain stored prescription (e.g. "+60s — last set
   * at/near failure", from services/restPrescription). A modulated timer must
   * say so, never look stock.
   */
  adjustmentNote?: string | null;
  /** Tap anywhere outside the buttons (e.g. scroll back to current exercise). */
  onBarTap?: () => void;
  /**
   * Show the one-line "what is this timer" explanation (the page sets it for
   * the first rest of a session only). Text from restIntroText.
   */
  showIntro?: boolean;
}

export function RestTimer({
  seconds,
  initialSeconds,
  isRunning,
  isFinished,
  onAddTime,
  onSkip,
  nextLabel,
  adjustmentNote,
  onBarTap,
  showIntro = false,
}: RestTimerProps) {
  const beginner = useBeginnerMode();
  const elapsedFraction =
    initialSeconds > 0 ? Math.min(1, Math.max(0, (initialSeconds - seconds) / initialSeconds)) : 0;

  // ≥44px touch targets (P0-4) — these get tapped mid-rest with sweaty hands.
  const stepClass =
    'min-h-[44px] min-w-[48px] px-2 rounded-xl bg-fill text-ink text-subhead font-semibold tabular-nums transition-[filter] hover:brightness-110';

  return (
    <div
      onClick={onBarTap}
      className={`relative flex items-center gap-2 overflow-hidden rounded-[20px] bg-card py-3 pl-4 pr-3 shadow-float ${
        onBarTap ? 'cursor-pointer' : ''
      }`}
      role={onBarTap ? 'button' : undefined}
      aria-label={onBarTap ? 'Rest timer — tap to jump to current exercise' : undefined}
    >
      <div className="min-w-0 flex-1">
        <span className="flex items-center text-caption text-ink-2">
          <span className="truncate">
            {isFinished ? 'Rest done — next set' : nextLabel ? `Rest · ${nextLabel}` : 'Rest'}
          </span>
          {/* Why-this-rest rationale — stop propagation so opening the
              tooltip doesn't also trigger the card's scroll-to-exercise tap */}
          <span onClick={(e) => e.stopPropagation()}>
            {beginner ? (
              <InfoTooltip content={BEGINNER_REST_TOOLTIP} position="top" />
            ) : (
              <InfoTooltip term="REST_PERIODS" position="top" />
            )}
          </span>
        </span>
        <span
          className={`block text-large-title font-bold leading-8 tabular-nums ${
            isFinished ? 'text-status-ok' : 'text-ink'
          }`}
        >
          {isFinished ? 'Done' : formatDuration(seconds)}
        </span>
        {!isFinished && adjustmentNote && (
          <span className="block truncate text-caption text-status-warn" data-testid="rest-adjustment-note">
            {adjustmentNote}
          </span>
        )}
        {!isFinished && showIntro && initialSeconds > 0 && (
          <span className="block text-caption leading-snug text-ink-2" data-testid="rest-intro-note">
            {restIntroText(initialSeconds)}
          </span>
        )}
      </div>

      {!isFinished && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAddTime(-15); }}
          disabled={seconds <= 0}
          aria-label="15 seconds less rest"
          className={`${stepClass} disabled:opacity-40`}
        >
          −15s
        </button>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onAddTime(15); }}
        aria-label="15 seconds more rest"
        className={stepClass}
      >
        +15s
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSkip(); }}
        className="min-h-[44px] rounded-xl bg-action-tint px-3.5 text-body font-semibold text-action transition-[filter] hover:brightness-110"
      >
        Skip
      </button>

      {/* Elapsed progress along the bottom edge */}
      <div
        className="absolute inset-x-0 bottom-0 h-[3px] bg-fill"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(elapsedFraction * 100)}
        aria-label="Rest progress"
      >
        <div
          className={`h-full ${isRunning ? 'transition-all duration-1000 ease-linear' : ''} ${
            isFinished ? 'bg-status-ok' : 'bg-action'
          }`}
          style={{ width: `${elapsedFraction * 100}%` }}
        />
      </div>
    </div>
  );
}
