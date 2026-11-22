'use client';

/**
 * "Repeat a workout" picker: choose a recent completed session and start a
 * fresh one with the same exercise list (weights and targets re-estimated,
 * not copied). Shared by Train and Home so Home's "Start workout" sheet can
 * repeat in place instead of detouring through Train.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { IconChevronRight, IconLoader2 } from '@tabler/icons-react';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { createUntypedClient } from '@/lib/supabase/client';
import { resolveAuthState } from '@/lib/supabase/authState';
import {
  createRepeatSession,
  deriveWorkoutTitle,
  RECENT_SESSION_SELECT,
  toRepeatableExercises,
  type RecentSessionRow,
  type RepeatableExercise,
} from '@/lib/training/repeatWorkout';

export interface RepeatChoice {
  id: string;
  completedAt: Date;
  title: string;
  setCount: number;
  exercises: RepeatableExercise[];
}

/** One recent completed session as a repeat choice (pure). */
export function toRepeatChoice(row: RecentSessionRow): RepeatChoice {
  const blocks = row.exercise_blocks ?? [];
  return {
    id: row.id,
    completedAt: new Date(row.completed_at),
    title: deriveWorkoutTitle(blocks),
    setCount: blocks.reduce((sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length, 0),
    exercises: toRepeatableExercises(blocks),
  };
}

/** The five most recent completed sessions, for the picker. */
export function useRecentRepeatChoices(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['history', 'repeat-choices', userId],
    enabled: !!userId && enabled,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<RepeatChoice[]> => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('workout_sessions')
        .select(RECENT_SESSION_SELECT)
        .eq('user_id', userId as string)
        .eq('state', 'completed')
        .order('completed_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return ((data ?? []) as RecentSessionRow[]).map(toRepeatChoice);
    },
  });
}

interface RepeatWorkoutSheetProps {
  isOpen: boolean;
  onClose: () => void;
  workouts: RepeatChoice[];
  loading?: boolean;
}

export function RepeatWorkoutSheet({ isOpen, onClose, workouts, loading = false }: RepeatWorkoutSheetProps) {
  const router = useRouter();
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repeat = async (workout: RepeatChoice) => {
    if (repeatingId) return;
    if (workout.exercises.length === 0) {
      setError('This workout has no exercises to repeat.');
      return;
    }
    setRepeatingId(workout.id);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const auth = await resolveAuthState(supabase);
      if (auth.status === 'unauthenticated') {
        router.push('/login');
        return;
      }
      if (auth.status === 'error') {
        setError("Couldn't verify your session. Check your connection and try again.");
        setRepeatingId(null);
        return;
      }
      const { sessionId } = await createRepeatSession(supabase, auth.userId, workout.exercises);
      router.push(`/dashboard/workout/${sessionId}`);
    } catch (err) {
      console.error('Failed to repeat workout:', err);
      setError('Failed to repeat workout. Please try again.');
      setRepeatingId(null);
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (!repeatingId) onClose();
      }}
      title="Repeat a workout"
    >
      <div className="space-y-3" data-testid="repeat-workout-sheet">
        <p className="text-subhead text-ink-2">
          Same exercises as a previous session — targets and weights are re-estimated from your recent performance.
        </p>
        {error && (
          <p role="alert" className="text-subhead text-status-warn">
            {error}
          </p>
        )}
        <div className="rounded-card bg-fill/60 overflow-hidden">
          {workouts.map((workout) => (
            <button
              key={workout.id}
              onClick={() => repeat(workout)}
              disabled={repeatingId !== null}
              className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-sep/50 last:border-b-0 text-left hover:bg-fill/50 transition-colors disabled:opacity-60"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-subhead text-ink truncate">{workout.title}</span>
                <span className="block text-caption text-ink-3 mt-0.5">
                  {workout.completedAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {' · '}
                  {workout.exercises.length} {workout.exercises.length === 1 ? 'exercise' : 'exercises'}
                  {' · '}
                  {workout.setCount} {workout.setCount === 1 ? 'set' : 'sets'}
                </span>
              </span>
              {repeatingId === workout.id ? (
                <IconLoader2 size={16} className="text-action animate-spin flex-shrink-0" aria-hidden="true" />
              ) : (
                <IconChevronRight size={16} className="text-ink-3 flex-shrink-0" aria-hidden="true" />
              )}
            </button>
          ))}
          {workouts.length === 0 && (
            <p className="p-4 text-center text-caption text-ink-3">{loading ? 'Loading…' : 'No completed workouts yet.'}</p>
          )}
        </div>
        <button
          onClick={onClose}
          disabled={repeatingId !== null}
          className="w-full py-2 rounded-lg text-subhead text-ink-2 hover:text-ink transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}
