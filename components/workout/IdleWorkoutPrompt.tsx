'use client';

import { Button } from '@/components/ui';
import { IconAlertCircle } from '@tabler/icons-react';

export interface IdleWorkoutPromptProps {
  /** Called when the user taps "Keep going" (dismisses the prompt). */
  onDismiss: () => void;
  /** Called when the user taps "Finish workout" (opens the finish flow). */
  onFinish: () => void;
}

/**
 * Non-blocking prompt shown when the user has been idle for
 * ABANDONED_SESSION_THRESHOLD_MINUTES. Appears as a banner at the top of the
 * workout content, below the header.
 *
 * UX: Not a modal/blocker — the user can still log sets and interact with the
 * workout. Logging a new set dismisses this automatically (via the hook).
 */
export function IdleWorkoutPrompt({ onDismiss, onFinish }: IdleWorkoutPromptProps) {
  return (
    <div
      className="bg-warning-500/10 border border-warning-500/30 rounded-xl p-4 mb-4 shadow-lg"
      data-testid="idle-workout-prompt"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <IconAlertCircle className="w-5 h-5 text-warning-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-warning-200 mb-1">
            Still training?
          </h3>
          <p className="text-sm text-warning-300/90 mb-3">
            It's been ~20 minutes since your last set. Are you still working out?
          </p>
          <div className="flex gap-2">
            <Button
              onClick={onDismiss}
              size="sm"
              variant="secondary"
              className="flex-1 sm:flex-none"
              data-testid="idle-prompt-keep-going"
            >
              Keep going
            </Button>
            <Button
              onClick={onFinish}
              size="sm"
              variant="primary"
              className="flex-1 sm:flex-none"
              data-testid="idle-prompt-finish"
            >
              Finish workout
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
