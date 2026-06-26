'use client';

import { Button } from '@/components/ui';

interface CancelWorkoutModalProps {
  isOpen: boolean;
  isCancelling: boolean;
  totalCompletedSets: number;
  onClose: () => void;
  onConfirm: () => void;
}

export function CancelWorkoutModal({
  isOpen,
  isCancelling,
  totalCompletedSets,
  onClose,
  onConfirm,
}: CancelWorkoutModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => !isCancelling && onClose()}
      />
      <div className="relative w-full max-w-sm mx-4 bg-surface-900 rounded-2xl border border-surface-800 overflow-hidden">
        <div className="p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-danger-500/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-surface-100 mb-2">Cancel Workout?</h3>
          <p className="text-sm text-surface-400 mb-6">
            {totalCompletedSets > 0
              ? `You've logged ${totalCompletedSets} set${totalCompletedSets !== 1 ? 's' : ''}. Cancelling will delete all progress and reset this workout.`
              : 'This will reset the workout so you can start fresh later.'}
          </p>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isCancelling}
              className="flex-1"
            >
              Keep Going
            </Button>
            <Button
              variant="outline"
              onClick={onConfirm}
              disabled={isCancelling}
              className="flex-1 border-danger-500/50 text-danger-400 hover:bg-danger-500/10"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel Workout'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
