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
        className="w-full py-2 px-3 rounded-lg border border-action/40 text-xs text-action hover:border-action transition-colors"
        data-testid="motion-enable-button"
      >
        Enable motion capture
      </button>
    );
  }

  if (status === 'waiting') {
    return (
      <p className="px-1 text-[11px] text-ink-3" data-testid="motion-mount-hint">
        Mount the phone and hold still to capture this set.
      </p>
    );
  }

  if (status === 'recording') {
    return (
      <button
        type="button"
        onClick={onStop}
        className="w-full py-2.5 px-3 rounded-lg bg-status-bad/15 border border-status-bad/40 text-sm font-medium text-status-bad hover:border-status-bad transition-colors"
        data-testid="motion-stop-button"
        aria-live="polite"
      >
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-status-bad animate-pulse align-middle" />
        Stop · {liveReps}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      className="w-full py-2.5 px-3 rounded-lg bg-status-ok text-sm font-semibold text-white hover:bg-status-ok transition-colors"
      data-testid="motion-start-button"
    >
      Start capture
    </button>
  );
}
