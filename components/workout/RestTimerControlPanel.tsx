'use client';

interface RestTimerControlPanelProps {
  isRunning: boolean;
  isFinished: boolean;
  onToggle: () => void;
  onAddTime: (seconds: number) => void;
  onReset: () => void;
  onSkip: () => void;
}

export function RestTimerControlPanel({
  isRunning,
  isFinished,
  onToggle,
  onAddTime,
  onReset,
  onSkip,
}: RestTimerControlPanelProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-900 border-t border-surface-700 p-4 safe-area-inset-bottom">
      <div className="flex items-center justify-between max-w-lg mx-auto">
        {/* Large Pause/Play button */}
        <button
          onClick={onToggle}
          className="w-24 h-24 rounded-full bg-surface-700 hover:bg-surface-600 active:bg-surface-500 flex items-center justify-center transition-colors"
        >
          <span className="text-surface-100 font-medium text-lg">
            {isRunning ? 'Pause' : isFinished ? 'Restart' : 'Start'}
          </span>
        </button>

        {/* Right side controls */}
        <div className="flex flex-col gap-2">
          {/* Keyboard toggle - placeholder for future feature */}
          <button
            className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 transition-colors"
          >
            <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          {/* Time adjustment buttons */}
          <div className="flex gap-1">
            <button
              onClick={() => onAddTime(-15)}
              className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 font-medium transition-colors"
            >
              −
            </button>
            <button
              onClick={() => onAddTime(15)}
              className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 font-medium transition-colors"
            >
              +
            </button>
          </div>

          {/* Reset button */}
          <button
            onClick={onReset}
            className="px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 active:bg-surface-500 text-surface-300 font-medium transition-colors"
          >
            Reset
          </button>

          {/* Skip button */}
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-medium transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
