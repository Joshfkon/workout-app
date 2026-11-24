'use client';

/**
 * Route loading boundary for a just-started workout: the first exercise
 * (from the start's preview) instead of grey cards while the workout
 * screen's code loads. Anything else — a reload, a deep link, a revisit —
 * gets the boundary's usual skeleton. Server render and the first client
 * render agree: the preview store's server snapshot is empty, and on a full
 * load the store is empty too.
 *
 * UX panel round 22 (Maya, Frank): "the page said it was still getting
 * ready after I tapped start, so I had to wait". The workout screen's own
 * preview (round 22) has a Log set button, but this boundary — what shows
 * while the screen's code is still arriving, the slow part on a cold route —
 * only had the numbers as text and "Getting the rest of your workout
 * ready…". It now renders the same preview, logger included; a set logged
 * here goes into the same early-set store the screen replays from.
 */

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { usePendingWorkoutBuildStage, usePendingWorkoutPreview } from '@/hooks/usePendingWorkoutBuild';
import { recordEarlyLoggedSet } from '@/lib/training/pendingWorkoutStart';
import { useUserStore } from '@/stores/userStore';
import { WorkoutStartPreview } from './WorkoutStartPreview';

export function PendingStartFallback({ fallback }: { fallback: ReactNode }) {
  const params = useParams();
  const raw = params?.id;
  const sessionId = typeof raw === 'string' ? raw : null;
  const { preview, earlySet } = usePendingWorkoutPreview(sessionId);
  const stage = usePendingWorkoutBuildStage(sessionId);
  const unit = useUserStore((s) => s.user?.preferences.units ?? null);
  if (!sessionId || !preview || preview.exercises.length === 0) return <>{fallback}</>;
  // No padding of its own: the workout screen renders the same preview in
  // the same spot, so the hand-off from this boundary doesn't move it.
  return (
    <WorkoutStartPreview
      preview={preview}
      stage={stage}
      unit={unit}
      earlySet={earlySet}
      onLogFirstSet={(set) => recordEarlyLoggedSet(sessionId, set)}
    />
  );
}
