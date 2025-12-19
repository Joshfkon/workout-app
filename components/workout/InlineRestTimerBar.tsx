'use client';

import { formatDuration } from '@/lib/utils';

interface InlineRestTimerBarProps {
  seconds: number;
  initialSeconds: number;
  isRunning: boolean;
  isFinished: boolean;
}

export function InlineRestTimerBar({
  seconds,
  initialSeconds,
  isRunning,
  isFinished,
}: InlineRestTimerBarProps) {
  console.log('[TIMER UI] InlineRestTimerBar render', { seconds, initialSeconds, isRunning, isFinished });
  const progressPercent = ((initialSeconds - seconds) / initialSeconds) * 100;

  return (
    <tr>
      <td colSpan={6} className="px-3 py-2">
        <div
          className={`relative h-10 rounded-lg overflow-hidden border-2 ${
            isFinished
              ? 'border-success-500 bg-success-500/20'
              : 'border-primary-400 bg-primary-500/10'
          }`}
        >
          {/* Progress fill */}
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-1000 ease-linear ${
              isFinished ? 'bg-success-500/40' : 'bg-primary-500/30'
            }`}
            style={{ width: `${progressPercent}%` }}
          />

          {/* Timer display */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`font-mono text-lg font-semibold ${
              isFinished ? 'text-success-400' : 'text-primary-400'
            }`}>
              {isFinished ? 'REST COMPLETE!' : formatDuration(seconds)}
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}
