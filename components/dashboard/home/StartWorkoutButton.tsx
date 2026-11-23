'use client';

import { useStartEmptyWorkout } from '@/hooks/useStartEmptyWorkout';

/**
 * "Start workout": opens an empty workout directly. `secondary` is the tinted
 * style for when a recommended start leads the card (the no-plan hero).
 */
export function StartWorkoutButton({
  className,
  label = 'Start workout',
  secondary = false,
}: {
  className?: string;
  label?: string;
  secondary?: boolean;
}) {
  const { start, isStarting, error } = useStartEmptyWorkout();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void start()}
        disabled={isStarting}
        className={`flex w-full min-h-[50px] items-center justify-center rounded-button text-headline transition-[filter] hover:brightness-110 active:brightness-95 disabled:opacity-70 ${
          secondary ? 'bg-action-tint text-action' : 'bg-action text-on-action'
        }`}
      >
        {isStarting ? 'Starting…' : label}
      </button>
      {error && <p className="mt-1.5 text-caption text-status-bad">{error}</p>}
    </div>
  );
}
