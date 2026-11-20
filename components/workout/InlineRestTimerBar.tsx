'use client';

import { memo } from 'react';
import { formatDuration } from '@/lib/utils';

interface InlineRestTimerBarProps {
  seconds: number;
  initialSeconds: number;
  isRunning: boolean;
  isFinished: boolean;
  isSkipped?: boolean;
  restedSeconds?: number;
  onShowControls?: () => void;
  colSpan?: number;
  /** 'table' renders as tr/td (default), 'div' renders as a standalone div */
  variant?: 'table' | 'div';
}

export const InlineRestTimerBar = memo(function InlineRestTimerBar({
  seconds,
  initialSeconds,
  isRunning,
  isFinished,
  isSkipped = false,
  restedSeconds = 0,
  onShowControls,
  colSpan = 6,
  variant = 'table',
}: InlineRestTimerBarProps) {
  const progressPercent = ((initialSeconds - seconds) / initialSeconds) * 100;
  
  // Determine display text
  let displayText: string;
  let textColor: string;
  let borderColor: string;
  let bgColor: string;
  
  if (isSkipped && restedSeconds > 0) {
    displayText = `Rested for ${formatDuration(restedSeconds)}`;
    textColor = 'text-ink-2';
    borderColor = 'border-transparent';
    bgColor = 'bg-fill';
  } else if (isFinished) {
    displayText = 'Rest complete';
    textColor = 'text-status-ok';
    borderColor = 'border-transparent';
    bgColor = 'bg-status-ok-tint';
  } else {
    displayText = formatDuration(seconds);
    textColor = 'text-action';
    borderColor = 'border-transparent';
    bgColor = 'bg-action-tint';
  }

  const timerContent = (
    <div
      onClick={onShowControls}
      className={`relative h-10 rounded-input overflow-hidden border cursor-pointer transition-opacity hover:opacity-80 ${borderColor} ${bgColor}`}
    >
      {/* Progress fill */}
      <div
        className={`absolute inset-y-0 left-0 transition-all duration-1000 ease-linear ${
          isFinished ? 'bg-status-ok/20' : isSkipped ? 'bg-transparent' : 'bg-action/15'
        }`}
        style={{ width: `${progressPercent}%` }}
      />

      {/* Timer display */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-subhead font-semibold tabular-nums ${textColor}`}>
          {displayText}
        </span>
      </div>
    </div>
  );

  if (variant === 'div') {
    return (
      <div className="px-3 py-2">
        {timerContent}
      </div>
    );
  }

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-2">
        {timerContent}
      </td>
    </tr>
  );
});
