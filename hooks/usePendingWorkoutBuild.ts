'use client';

import { useSyncExternalStore } from 'react';
import {
  getEarlyLoggedSet,
  getPendingWorkoutBuildStage,
  getPendingWorkoutPreview,
  subscribePendingWorkoutBuilds,
  type EarlyLoggedSet,
  type PendingBuildStage,
  type PendingWorkoutPreview,
} from '@/lib/training/pendingWorkoutStart';

/**
 * The stage of a navigate-first start still building this session in the
 * background (lib/training/pendingWorkoutStart), or null when nothing is
 * pending — for the workout screen's skeleton copy.
 */
export function usePendingWorkoutBuildStage(sessionId: string | null | undefined): PendingBuildStage | null {
  return useSyncExternalStore(
    subscribePendingWorkoutBuilds,
    () => (sessionId ? getPendingWorkoutBuildStage(sessionId) : null),
    () => null
  );
}

/**
 * The start's preview of this session's exercises (shown instead of the
 * skeleton while the workout screen loads), and the set logged on it, if any.
 * Both are null on the server and on a full reload: the preview only exists
 * across the client-side navigation from the start.
 */
export function usePendingWorkoutPreview(sessionId: string | null | undefined): {
  preview: PendingWorkoutPreview | null;
  earlySet: EarlyLoggedSet | null;
} {
  const preview = useSyncExternalStore(
    subscribePendingWorkoutBuilds,
    () => (sessionId ? getPendingWorkoutPreview(sessionId) : null),
    () => null
  );
  const earlySet = useSyncExternalStore(
    subscribePendingWorkoutBuilds,
    () => (sessionId ? getEarlyLoggedSet(sessionId) : null),
    () => null
  );
  return { preview, earlySet };
}
