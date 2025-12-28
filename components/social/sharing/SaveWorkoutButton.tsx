'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface SaveWorkoutButtonProps {
  workoutId: string;
  isSaved: boolean;
  onSave?: (workoutId: string) => Promise<{ success: boolean; error?: string }>;
  onUnsave?: (workoutId: string) => Promise<{ success: boolean; error?: string }>;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export function SaveWorkoutButton({
  workoutId,
  isSaved,
  onSave,
  onUnsave,
  size = 'sm',
  showLabel = true,
}: SaveWorkoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [localSaved, setLocalSaved] = useState(isSaved);

  const handleClick = async () => {
    if (isLoading) return;

    setIsLoading(true);

    // Optimistic update
    setLocalSaved(!localSaved);

    try {
      if (localSaved && onUnsave) {
        const result = await onUnsave(workoutId);
        if (!result.success) {
          // Revert on failure
          setLocalSaved(true);
        }
      } else if (!localSaved && onSave) {
        const result = await onSave(workoutId);
        if (!result.success) {
          // Revert on failure
          setLocalSaved(false);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={cn(
        'flex items-center gap-1.5 font-medium rounded-lg transition-all',
        sizeClasses[size],
        localSaved
          ? 'bg-primary-500 text-white hover:bg-primary-600'
          : 'bg-surface-700 text-surface-200 hover:bg-surface-600',
        isLoading && 'opacity-50 cursor-not-allowed'
      )}
    >
      {isLoading ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <svg
          className={cn('w-4 h-4', localSaved && 'fill-current')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
          />
        </svg>
      )}
      {showLabel && (localSaved ? 'Saved' : 'Save')}
    </button>
  );
}
