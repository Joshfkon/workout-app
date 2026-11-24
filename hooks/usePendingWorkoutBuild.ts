'use client';

import { useSyncExternalStore } from 'react';
import {
  getPendingWorkoutBuildStage,
  subscribePendingWorkoutBuilds,
  type PendingBuildStage,
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
