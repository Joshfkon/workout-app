'use client';

import { useStartEmptyWorkout } from '@/hooks/useStartEmptyWorkout';

/** Primary "Start workout" for the no-plan hero: opens an empty workout directly. */
export function StartWorkoutButton({ className }: { className?: string }) {
  const { start, isStarting, error } = useStartEmptyWorkout();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void start()}
        disabled={isStarting}
        className="flex w-full min-h-[50px] items-center justify-center rounded-button bg-action text-on-action text-headline transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-70"
      >
        {isStarting ? 'Starting…' : 'Start workout'}
      </button>
      {error && <p className="mt-1.5 text-caption text-status-bad">{error}</p>}
    </div>
  );
}
