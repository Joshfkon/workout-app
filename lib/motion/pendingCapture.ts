/**
 * In-memory holder for a finished-but-unsaved motion capture.
 *
 * The review screen never auto-commits, which means an accidental
 * navigation (e.g. hopping to the workout tab to log the set) would
 * otherwise destroy a capture the user just performed. The holder keeps
 * exactly one pending capture per app lifetime in module memory — enough to
 * survive SPA navigation and component remounts. Deliberately NOT
 * persisted: an unsaved capture should not outlive the app session, and
 * raw sample buffers must never hit storage without the explicit
 * raw-retention opt-in.
 */

import type { CaptureSide, ImuSample } from '@/types/motion';
import type { MotionPipelineResult } from '@/services/shared/motion';

export interface PendingCapture {
  calibrationId: string;
  /** Denormalized so consumers can match without loading the calibration. */
  exerciseId: string;
  side: CaptureSide;
  startedAtIso: string;
  samples: ImuSample[];
  result: MotionPipelineResult;
}

let pending: PendingCapture | null = null;

export function setPendingCapture(capture: PendingCapture): void {
  pending = capture;
}

export function getPendingCapture(): PendingCapture | null {
  return pending;
}

export function clearPendingCapture(): void {
  pending = null;
}
