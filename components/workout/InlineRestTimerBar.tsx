'use client';

import { formatDuration } from '@/lib/utils';

interface InlineRestTimerBarProps {
  seconds: number;
  initialSeconds: number;
  isRunning: boolean;
  isFinished: boolean;
  isSkipped?: boolean;
  restedSeconds?: number;
  onShowControls?: () => void;
}

export function InlineRestTimerBar({
  seconds,
  initialSeconds,
  isRunning,
  isFinished,
  isSkipped = false,
  restedSeconds = 0,
  onShowControls,
}: InlineRestTimerBarProps) {
  const progressPercent = ((initialSeconds - seconds) / initialSeconds) * 100;
  
  // Determine display text
  let displayText: string;
  let textColor: string;
  let borderColor: string;
  let bgColor: string;
  
  if (isSkipped && restedSeconds > 0) {
    displayText = `Rested for ${formatDuration(restedSeconds)}`;
    textColor = 'text-primary-400';
    borderColor = 'border-primary-400';
    bgColor = 'bg-primary-500/10';
  } else if (isFinished) {
    displayText = 'REST COMPLETE!';
    textColor = 'text-success-400';
    borderColor = 'border-success-500';
    bgColor = 'bg-success-500/20';
  } else {
    displayText = formatDuration(seconds);
    textColor = 'text-primary-400';
    borderColor = 'border-primary-400';
    bgColor = 'bg-primary-500/10';
  }

  return (
    <tr>
      <td colSpan={6} className="px-3 py-2">
        <div
          onClick={onShowControls}
          className={`relative h-10 rounded-lg overflow-hidden border-2 cursor-pointer transition-opacity hover:opacity-80 ${borderColor} ${bgColor}`}
        >
          {/* Progress fill */}
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-1000 ease-linear ${
              isFinished ? 'bg-success-500/40' : isSkipped ? 'bg-primary-500/30' : 'bg-primary-500/30'
            }`}
            style={{ width: `${progressPercent}%` }}
          />

          {/* Timer display */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`font-mono text-lg font-semibold ${textColor}`}>
              {displayText}
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}
