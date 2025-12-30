'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useWorkoutStore } from '@/stores/workoutStore';
import { Button } from '@/components/ui';
import { formatDistanceToNow } from '@/lib/utils';

export function ResumeWorkoutBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const activeSession = useWorkoutStore((state) => state.activeSession);
  const exerciseBlocks = useWorkoutStore((state) => state.exerciseBlocks);
  const exercises = useWorkoutStore((state) => state.exercises);
  const setLogs = useWorkoutStore((state) => state.setLogs);
  const endSession = useWorkoutStore((state) => state.endSession);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render on server (hydration mismatch prevention)
  if (!mounted) return null;

  // Don't show if no active session
  if (!activeSession) return null;

  // Don't show if we're already on the workout page for this session
  if (pathname?.includes(`/dashboard/workout/${activeSession.id}`)) return null;

  // Calculate completed sets count
  let completedSetsCount = 0;
  setLogs.forEach((sets) => {
    completedSetsCount += sets.length;
  });

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

  // Get first exercise name for context (lookup from exercises Map)
  const firstBlock = exerciseBlocks[0];
  const firstExercise = firstBlock ? exercises.get(firstBlock.exerciseId)?.name : undefined;
  const exerciseCount = exerciseBlocks.length;

  return (
    <>
      {/* Resume Workout Banner */}
      <div className="fixed bottom-20 left-0 right-0 z-50 px-4 lg:left-64 lg:bottom-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-gradient-to-r from-primary-600 to-primary-500 rounded-xl shadow-lg shadow-primary-500/20 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span className="text-white font-semibold text-sm">
                    Workout in Progress
                  </span>
                </div>
                <p className="text-white/80 text-xs mt-1 truncate">
                  {firstExercise && exerciseCount > 1
                    ? `${firstExercise} + ${exerciseCount - 1} more`
                    : firstExercise || 'Workout session'}
                  {completedSetsCount > 0 && ` • ${completedSetsCount} set${completedSetsCount !== 1 ? 's' : ''} logged`}
                  {timeAgo && ` • Started ${timeAgo}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDiscard}
                  className="text-white/70 hover:text-white text-xs px-2 py-1 rounded transition-colors"
                >
                  Discard
                </button>
                <Button
                  onClick={handleResume}
                  variant="secondary"
                  size="sm"
                  className="!bg-white !text-primary-700 hover:!bg-white/90 !border-transparent font-semibold whitespace-nowrap shadow-sm"
                >
                  Resume Workout
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Discard Confirmation Modal */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-900 rounded-xl p-6 max-w-sm w-full shadow-xl border border-surface-700">
            <h3 className="text-lg font-semibold text-white mb-2">
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
