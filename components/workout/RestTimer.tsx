'use client';

/**
 * RestTimer — slim rest-timer bar.
 *
 * Purely presentational and fully controlled: all timer logic (countdown,
 * persistence across reloads, sound/haptics, native notifications) lives in
 * `hooks/useRestTimer`; the workout page owns the hook and threads its state
 * here.
 *
 * P0-5 (UX audit): the workout page renders this in a FIXED bottom wrapper so
 * the countdown stays visible while scrolling — previously it sat inline
 * inside the exercise card and was below the fold the moment a set was
 * logged. Tapping the bar (outside the buttons) scrolls back to the current
 * exercise via `onBarTap`.
 */

import { formatDuration } from '@/lib/utils';
import { InfoTooltip } from '@/components/ui';

export interface RestTimerProps {
  /** Remaining seconds. */
  seconds: number;
  /** Seconds the countdown started from (drives the elapsed fraction). */
  initialSeconds: number;
  isRunning: boolean;
  isFinished: boolean;
  /** Add (or subtract) seconds; the "+15s" button calls onAddTime(15). */
  onAddTime: (amount: number) => void;
  /** Skip the remaining rest. */
  onSkip: () => void;
  /** e.g. "next · 145 lbs × 6–10" — shown under the countdown. */
  nextLabel?: string;
  /**
   * Why this rest isn't the plain stored prescription (e.g. "+60s — last set
   * at/near failure", from services/restPrescription). Rendered above the
   * next-set label — a modulated timer must say so, never look stock.
   */
  adjustmentNote?: string | null;
  /** Tap anywhere outside the buttons (e.g. scroll back to current exercise). */
  onBarTap?: () => void;
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
}: RestTimerProps) {
  const elapsedFraction =
    initialSeconds > 0 ? Math.min(1, Math.max(0, (initialSeconds - seconds) / initialSeconds)) : 0;

  // ≥44px touch targets (P0-4) — these get tapped mid-rest with sweaty hands.
  const buttonClass =
    'px-4 min-h-[44px] min-w-[56px] rounded-lg text-sm font-semibold bg-surface-800 text-surface-200 hover:bg-surface-700 hover:text-surface-100 transition-colors';

  return (
    <div
      onClick={onBarTap}
      className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 border-2 shadow-2xl shadow-black/50 backdrop-blur ${
        isFinished
          ? 'bg-surface-900/95 border-success-500'
          : 'bg-surface-900/95 border-primary-500/70'
      } ${onBarTap ? 'cursor-pointer' : ''}`}
      role={onBarTap ? 'button' : undefined}
      aria-label={onBarTap ? 'Rest timer — tap to jump to current exercise' : undefined}
    >
      <div className="flex-shrink-0 min-w-[86px]">
        <span
          className={`block text-3xl font-bold tabular-nums font-mono leading-none ${
            isFinished ? 'text-success-400' : 'text-primary-300'
          }`}
        >
          {isFinished ? 'Done' : formatDuration(seconds)}
        </span>
        <span className="flex items-center text-[11px] text-surface-400 mt-0.5">
          <span className="truncate">
            {isFinished ? 'rest done — next set' : nextLabel ?? 'resting'}
          </span>
          {/* Why-this-rest rationale — stop propagation so opening the
              tooltip doesn't also trigger the bar's scroll-to-exercise tap */}
          <span onClick={(e) => e.stopPropagation()}>
            <InfoTooltip term="REST_PERIODS" position="top" />
          </span>
        </span>
        {!isFinished && adjustmentNote && (
          <span
            className="block text-[11px] text-warning-400/90 mt-0.5 truncate"
            data-testid="rest-adjustment-note"
          >
            {adjustmentNote}
          </span>
        )}
      </div>
      {/* Progress bar - elapsed fraction */}
      <div
        className="flex-1 h-2 rounded-full bg-surface-800 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(elapsedFraction * 100)}
        aria-label="Rest progress"
      >
        <div
          className={`h-full rounded-full ${
            isRunning ? 'transition-all duration-1000 ease-linear' : ''
          } ${isFinished ? 'bg-success-500' : 'bg-primary-500'}`}
          style={{ width: `${elapsedFraction * 100}%` }}
        />
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onAddTime(15); }}
        className={buttonClass}
      >
        +15s
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onSkip(); }}
        className={buttonClass}
      >
        Skip
      </button>
    </div>
  );
}
