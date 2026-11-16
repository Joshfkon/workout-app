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
        className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 transition-colors disabled:opacity-70"
      >
        {isStarting ? 'Starting…' : 'Start workout'}
      </button>
      {error && <p className="mt-1.5 text-[11px] text-danger-400">{error}</p>}
    </div>
  );
}
