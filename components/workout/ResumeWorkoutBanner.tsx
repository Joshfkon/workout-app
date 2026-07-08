'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorkoutStore } from '@/stores/workoutStore';
import { Button } from '@/components/ui';
import { deriveWorkoutLabel, formatDistanceToNow, formatDuration } from '@/lib/utils';

/** Matches hooks/useRestTimer's persisted shape. */
const TIMER_STORAGE_KEY = 'workout_rest_timer';

/** Remaining rest seconds from the timer's localStorage state, or null. */
function readRestRemaining(): number | null {
  try {
    const stored = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!stored) return null;
    const { endTime, isRunning } = JSON.parse(stored) as { endTime: number; isRunning: boolean };
    if (!isRunning || typeof endTime !== 'number') return null;
    const remaining = Math.round((endTime - Date.now()) / 1000);
    return remaining > 0 ? remaining : null;
  } catch {
    return null;
  }
}

export function ResumeWorkoutBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [restRemaining, setRestRemaining] = useState<number | null>(null);

  const activeSession = useWorkoutStore((state) => state.activeSession);
  const exerciseBlocks = useWorkoutStore((state) => state.exerciseBlocks);
  const exercises = useWorkoutStore((state) => state.exercises);
  const setLogs = useWorkoutStore((state) => state.setLogs);
  const endSession = useWorkoutStore((state) => state.endSession);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Tick the rest countdown (P0-3 mockup: "rest 1:12" keeps counting in the pill)
  useEffect(() => {
    if (!mounted || !activeSession) return;
    setRestRemaining(readRestRemaining());
    const interval = setInterval(() => setRestRemaining(readRestRemaining()), 1000);
    return () => clearInterval(interval);
  }, [mounted, activeSession]);

  // Don't render on server (hydration mismatch prevention)
  if (!mounted) return null;

  // Don't show if no active session
  if (!activeSession) return null;

  // Don't show if we're already on the workout page for this session
  if (pathname?.includes(`/dashboard/workout/${activeSession.id}`)) return null;

  // Calculate completed sets count (only for blocks still in the workout,
  // so sets from removed/swapped exercises don't inflate the count)
  const blockIds = new Set(exerciseBlocks.map((b) => b.id));
  let completedSetsCount = 0;
  Object.entries(setLogs).forEach(([blockId, sets]) => {
    if (blockIds.has(blockId)) completedSetsCount += sets.length;
  });
  const targetSetsTotal = exerciseBlocks.reduce((sum, b) => sum + (b.targetSets || 0), 0);

  // Calculate time since workout started
  const startedAt = activeSession.startedAt
    ? new Date(activeSession.startedAt)
    : null;
  const timeAgo = startedAt
    ? formatDistanceToNow(startedAt)
    : null;

  const handleResume = () => {
    router.push(`/dashboard/workout/${activeSession.id}`);
  };

  const handleDiscard = () => {
    setShowDiscardConfirm(true);
  };

  const confirmDiscard = () => {
    endSession();
    setShowDiscardConfirm(false);
  };

  const cancelDiscard = () => {
    setShowDiscardConfirm(false);
  };

  // Same derived label the workout page header shows ("Upper Body", "Push")
  const workoutLabel =
    exerciseBlocks.length > 0
      ? deriveWorkoutLabel(
          exerciseBlocks
            .map((b) => exercises[b.exerciseId]?.primaryMuscle)
            .filter((m): m is string => Boolean(m))
        )
      : 'Workout in progress';

  return (
    <>
      {/* In-flow spacer so page content can scroll clear of the fixed banner */}
      <div className="h-24" aria-hidden="true" />

      {/* Resume pill (P0-3, per audit mockup 03): compact, above the bottom
          nav, with live set progress and rest countdown. */}
      <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-0 right-0 z-50 px-4 lg:left-64 lg:bottom-4">
        <div className="max-w-md mx-auto">
          <div
            className="bg-surface-900/95 backdrop-blur border-[1.5px] border-primary-500 rounded-full shadow-2xl shadow-black/50 pl-4 pr-2 py-2 cursor-pointer"
            onClick={handleResume}
            role="button"
            aria-label="Resume workout"
          >
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 flex-shrink-0 rounded-full bg-success-400 animate-pulse" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-surface-100 truncate">
                  {workoutLabel}
                </p>
                <p className="text-[11px] text-surface-400 truncate tabular-nums">
                  {restRemaining !== null && `rest ${formatDuration(restRemaining)} · `}
                  {targetSetsTotal > 0
                    ? `${completedSetsCount}/${targetSetsTotal} sets`
                    : `${completedSetsCount} set${completedSetsCount !== 1 ? 's' : ''}`}
                  {timeAgo && ` · started ${timeAgo}`}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDiscard(); }}
                className="flex-shrink-0 min-h-[44px] px-3 rounded-full text-xs text-surface-400 hover:text-surface-200 transition-colors"
              >
                Discard
              </button>
              <Button
                onClick={(e) => { e.stopPropagation(); handleResume(); }}
                size="sm"
                className="flex-shrink-0 min-h-[44px] !rounded-full px-5 font-semibold whitespace-nowrap"
              >
                Resume
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Discard Confirmation Modal */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-900 rounded-xl p-6 max-w-sm w-full shadow-xl border border-surface-700">
            <h3 className="text-lg font-semibold text-surface-100 mb-2">
              Discard Workout?
            </h3>
            <p className="text-surface-400 text-sm mb-4">
              {completedSetsCount > 0
                ? `You have ${completedSetsCount} set${completedSetsCount !== 1 ? 's' : ''} logged. Discarding will lose your local progress. Sets already saved to the database will remain.`
                : 'This will clear your current workout session.'}
            </p>
            <div className="flex gap-3">
              <Button
                onClick={cancelDiscard}
                variant="secondary"
                className="flex-1"
              >
                Keep Workout
              </Button>
              <Button
                onClick={confirmDiscard}
                variant="danger"
                className="flex-1"
              >
                Discard
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
