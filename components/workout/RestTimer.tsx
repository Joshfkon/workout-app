'use client';

/**
 * RestTimer — the single slim rest-timer bar (Phase 2.3, per mockup).
 *
 * Purely presentational and fully controlled: all timer logic (countdown,
 * persistence across reloads, sound/haptics, native notifications) lives in
 * `hooks/useRestTimer`; the workout page owns the hook and threads its state
 * here. This replaces the old dual presentation (inline bar inside the
 * exercise card + fixed expanded control panel).
 */

import { IconClock } from '@tabler/icons-react';
import { formatDuration } from '@/lib/utils';

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
}

export function RestTimer({
  seconds,
  initialSeconds,
  isRunning,
  isFinished,
  onAddTime,
  onSkip,
}: RestTimerProps) {
  const elapsedFraction =
    initialSeconds > 0 ? Math.min(1, Math.max(0, (initialSeconds - seconds) / initialSeconds)) : 0;

  const buttonClass =
    'px-2.5 py-1 rounded-md text-xs font-medium bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors';

  return (
    <div className="flex items-center gap-3 bg-surface-900 border border-surface-800 rounded-xl px-3.5 py-2.5">
      <IconClock
        size={18}
        stroke={2}
        className={isFinished ? 'text-success-400' : 'text-primary-400'}
        aria-hidden="true"
      />
      {/* 4px progress bar - elapsed fraction */}
      <div
        className="flex-1 h-1 rounded-full bg-surface-800 overflow-hidden"
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
      <span
        className={`text-[15px] font-medium tabular-nums ${
          isFinished ? 'text-success-400' : 'text-surface-100'
        }`}
      >
        {isFinished ? 'Done' : formatDuration(seconds)}
      </span>
      <button onClick={() => onAddTime(15)} className={buttonClass}>
        +15s
      </button>
      <button onClick={onSkip} className={buttonClass}>
        Skip
      </button>
    </div>
  );
}
