'use client';

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

export interface SaveWorkoutButtonProps {
  workoutId: string;
  isSaved: boolean;
  onToggle?: (workoutId: string, saved: boolean) => void;
  size?: 'sm' | 'md';
  className?: string;
}

export function SaveWorkoutButton({
  workoutId,
  isSaved: initialSaved,
  onToggle,
  size = 'md',
  className,
}: SaveWorkoutButtonProps) {
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) return;

      if (isSaved) {
        // Unsave
        const { error } = await (supabase
          .from('saved_workouts' as never) as ReturnType<typeof supabase.from>)
          .delete()
          .eq('user_id', user.id)
          .eq('shared_workout_id', workoutId);

        if (!error) {
          setIsSaved(false);
          onToggle?.(workoutId, false);
        }
      } else {
        // Save
        const { error } = await (supabase
          .from('saved_workouts' as never) as ReturnType<typeof supabase.from>)
          .insert({
            user_id: user.id,
            shared_workout_id: workoutId,
          } as never);

        if (!error) {
          setIsSaved(true);
          onToggle?.(workoutId, true);
        }
      }
    } catch (err) {
      console.error('Failed to toggle save:', err);
    } finally {
      setIsLoading(false);
    }
  }, [workoutId, isSaved, onToggle]);

  const sizeClasses = size === 'sm' ? 'p-1.5' : 'p-2';
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      className={cn(
        'rounded-lg transition-colors',
        isSaved
          ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
          : 'bg-surface-700 text-surface-400 hover:text-surface-200 hover:bg-surface-600',
        isLoading && 'opacity-50 cursor-not-allowed',
        sizeClasses,
        className
      )}
      title={isSaved ? 'Unsave workout' : 'Save workout'}
    >
      <svg
        className={iconSize}
        fill={isSaved ? 'currentColor' : 'none'}
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
    </button>
  );
}
