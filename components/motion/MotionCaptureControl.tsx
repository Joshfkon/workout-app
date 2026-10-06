'use client';

/**
 * Start/Stop control for the active set row. Start is offered only while
 * the sensor is streaming and the phone is still (mounted); otherwise a
 * one-line hint says why it isn't there.
 */

import type { SetCaptureStatus } from './useMotionSetCapture';

interface MotionCaptureControlProps {
  status: SetCaptureStatus;
  liveReps: number;
  onEnable: () => void;
  onStart: () => void;
  onStop: () => void;
}

export function MotionCaptureControl({
  status,
  liveReps,
  onEnable,
  onStart,
  onStop,
}: MotionCaptureControlProps) {
  if (status === 'off') return null;

  if (status === 'needs-permission') {
    return (
      <button
        type="button"
        onClick={onEnable}
        className="w-full py-2 px-3 rounded-lg border border-primary-500/40 text-xs text-primary-400 hover:border-primary-400 transition-colors"
        data-testid="motion-enable-button"
      >
        Enable motion capture
      </button>
    );
  }

  if (status === 'waiting') {
    return (
      <p className="px-1 text-[11px] text-surface-500" data-testid="motion-mount-hint">
        Mount the phone and hold still to capture this set.
      </p>
    );
  }

  if (status === 'recording') {
    return (
      <button
        type="button"
        onClick={onStop}
        className="w-full py-2.5 px-3 rounded-lg bg-danger-500/15 border border-danger-500/40 text-sm font-medium text-danger-300 hover:border-danger-400 transition-colors"
        data-testid="motion-stop-button"
        aria-live="polite"
      >
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger-400 animate-pulse align-middle" />
        Stop · {liveReps}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className="w-full py-2.5 px-3 rounded-lg border border-primary-500/50 text-sm font-medium text-primary-300 hover:border-primary-400 transition-colors"
      data-testid="motion-start-button"
    >
      Start capture
    </button>
  );
}
