/**
 * In-memory holder for a finished-but-unsaved motion capture.
 *
 * The review screen never auto-commits, which means an accidental
 * navigation (e.g. hopping to the workout tab to log the set) would
 * otherwise destroy a capture the user just performed. The holder keeps
 * exactly one pending capture per app lifetime in module memory — enough to
 * survive SPA navigation and component remounts; analyses are recomputed
 * from the raw samples on restore. Deliberately NOT persisted: an unsaved
 * capture should not outlive the app session, and raw sample buffers must
 * never hit storage without the explicit raw-retention opt-in.
 */

import type { CaptureSide, ImuSample } from '@/types/motion';

export interface PendingCapture {
  /** Calibration used at record time; null for a quick (uncalibrated) capture. */
  calibrationId: string | null;
  /** Exercise the capture was launched for; null for a quick capture. */
  exerciseId: string | null;
  side: CaptureSide;
  startedAtIso: string;
  samples: ImuSample[];
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
