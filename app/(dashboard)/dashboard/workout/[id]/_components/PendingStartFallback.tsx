'use client';

/**
 * Route loading boundary for a just-started workout: the first exercise
 * (from the start's preview) instead of grey cards while the workout
 * screen's code loads. Anything else — a reload, a deep link, a revisit —
 * gets the boundary's usual skeleton. Server render and the first client
 * render agree: the preview store's server snapshot is empty, and on a full
 * load the store is empty too.
 */

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { usePendingWorkoutBuildStage, usePendingWorkoutPreview } from '@/hooks/usePendingWorkoutBuild';
import { useUserStore } from '@/stores/userStore';
import { PreviewFirstSetSummary, WorkoutStartPreviewShell } from './WorkoutStartPreviewShell';

export function PendingStartFallback({ fallback }: { fallback: ReactNode }) {
  const params = useParams();
  const raw = params?.id;
  const sessionId = typeof raw === 'string' ? raw : null;
  const { preview } = usePendingWorkoutPreview(sessionId);
  const stage = usePendingWorkoutBuildStage(sessionId);
  const unit = useUserStore((s) => s.user?.preferences.units ?? null);
  if (!preview || preview.exercises.length === 0) return <>{fallback}</>;
  // No padding of its own: the workout screen renders the same shell in
  // the same spot, so the hand-off from this boundary doesn't move it.
  return (
    <WorkoutStartPreviewShell preview={preview} stage={stage}>
      <PreviewFirstSetSummary preview={preview} unit={unit} />
    </WorkoutStartPreviewShell>
  );
}
