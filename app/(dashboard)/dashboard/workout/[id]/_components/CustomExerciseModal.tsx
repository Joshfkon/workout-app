'use client';

import { CreateCustomExercise } from '@/components/exercises/CreateCustomExercise';

interface CustomExerciseModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onSuccess: (exerciseId: string) => void;
}

export function CustomExerciseModal({
  isOpen,
  userId,
  onClose,
  onSuccess,
}: CustomExerciseModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[90vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-surface-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1 text-surface-400 hover:text-surface-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-surface-100">Create Custom Exercise</h2>
          </div>
        </div>

        {/* AI-Powered Exercise Creation Component */}
        <div className="flex-1 overflow-y-auto p-4">
          <CreateCustomExercise
            userId={userId}
            onSuccess={onSuccess}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
