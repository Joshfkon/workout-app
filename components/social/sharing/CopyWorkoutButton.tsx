'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import type { SharedWorkoutContent } from '@/types/social';

export interface CopyWorkoutButtonProps {
  workoutId: string;
  workoutData: SharedWorkoutContent;
  workoutTitle: string;
  onSuccess?: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CopyWorkoutButton({
  workoutId,
  workoutData,
  workoutTitle,
  onSuccess,
  variant = 'primary',
  size = 'md',
  className,
}: CopyWorkoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Must be logged in to copy workouts');
      }

      // Record the copy
      await (supabase
        .from('workout_copies' as never) as ReturnType<typeof supabase.from>)
        .insert({
          user_id: user.id,
          shared_workout_id: workoutId,
        } as never);

      // TODO: Actually create the workout template in user's library
      // This would integrate with the existing workout/mesocycle creation system
      // For now, we just track the copy

      setIsCopied(true);
      onSuccess?.();

      // Reset after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy workout:', err);
    } finally {
      setIsLoading(false);
    }
  }, [workoutId, onSuccess]);

  return (
    <Button
      onClick={handleCopy}
      disabled={isLoading || isCopied}
      variant={variant}
      size={size}
      className={className}
    >
      {isCopied ? (
        <>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : isLoading ? (
        <>
          <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Copying...
        </>
      ) : (
        <>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy to Library
        </>
      )}
    </Button>
  );
}
