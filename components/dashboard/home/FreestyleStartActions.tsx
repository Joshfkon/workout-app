'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { IconRepeat, IconSparkles } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  createRepeatSession,
  deriveWorkoutTitle,
  RECENT_SESSION_SELECT,
  toRepeatableExercises,
  type RecentSessionRow,
  type RepeatableExercise,
} from '@/lib/training/repeatWorkout';

// The suggestion sheet pulls in the AI suggestion path; load it on first open.
const SuggestedWorkoutSheet = dynamic(
  () => import('@/components/workout/SuggestedWorkoutSheet').then((m) => m.SuggestedWorkoutSheet),
  { ssr: false }
);

/** The last completed workout, in the JSON-plain shape the cache persists. */
export interface LastRepeatableWorkout {
  id: string;
  /** Short name for the button: the split-day name, else the top muscles. */
  label: string;
  exercises: RepeatableExercise[];
}

/**
 * One short word or two for a half-width button: "Pull · Back, Biceps" →
 * "Pull"; a freestyle "Back, Biceps" (no split-day name) → its top muscle,
 * "Back".
 */
export function repeatLabel(title: string): string {
  const [head, muscles] = title.split(' · ');
  return muscles !== undefined ? head : head.split(', ')[0];
}

async function fetchLastRepeatableWorkout(userId: string): Promise<LastRepeatableWorkout | null> {
  const supabase = createUntypedClient();
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(RECENT_SESSION_SELECT)
    .eq('user_id', userId)
    .eq('state', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data?.[0] ?? null) as RecentSessionRow | null;
  if (!row) return null;
  const blocks = row.exercise_blocks ?? [];
  const exercises = toRepeatableExercises(blocks);
  if (exercises.length === 0) return null;
  return { id: row.id, label: repeatLabel(deriveWorkoutTitle(blocks)), exercises };
}

/** The most recent completed workout that can be repeated (null if none). */
export function useLastRepeatableWorkout(userId: string | null) {
  return useQuery({
    queryKey: ['history', 'last-repeatable', userId],
    queryFn: () => fetchLastRepeatableWorkout(userId as string),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}

const SECONDARY =
  'flex min-h-[44px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-button bg-action-tint px-3 text-action text-body font-semibold transition-[filter] hover:brightness-110 disabled:opacity-60';

/**
 * The freestyle hero's two secondary starts, under "Start workout":
 * "Repeat {last workout}" clones the most recent completed session (same
 * helper as the Train tab and History), and "Suggest one" opens the AI
 * suggestion sheet in place. With no completed workout yet, only "Suggest
 * one" shows. Train keeps the full list of past workouts to repeat.
 */
export function FreestyleStartActions({ userId }: { userId: string | null }) {
  const router = useRouter();
  const [showSuggest, setShowSuggest] = useState(false);
  const [isRepeating, setIsRepeating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: last } = useLastRepeatableWorkout(userId);

  const handleRepeat = async () => {
    if (!last || !userId || isRepeating) return;
    setIsRepeating(true);
    setError(null);
    try {
      const { sessionId } = await createRepeatSession(createUntypedClient(), userId, last.exercises);
      router.push(`/dashboard/workout/${sessionId}`);
    } catch (err) {
      console.error('Failed to repeat workout:', err);
      setError("Couldn't start that workout. Try again.");
      setIsRepeating(false);
    }
  };

  return (
    <>
      <div className="mt-2.5 flex gap-2.5">
        {last && (
          <button
            type="button"
            onClick={handleRepeat}
            disabled={isRepeating}
            className={SECONDARY}
            data-testid="hero-repeat-last"
          >
            <IconRepeat size={18} className="flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{isRepeating ? 'Starting…' : `Repeat ${last.label}`}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowSuggest(true)}
          className={SECONDARY}
          data-testid="hero-suggest-one"
        >
          <IconSparkles size={18} className="flex-shrink-0" aria-hidden="true" />
          <span className="truncate">Suggest one</span>
        </button>
      </div>
      {error && <p className="mt-1.5 text-caption text-status-bad">{error}</p>}
      {showSuggest && (
        <SuggestedWorkoutSheet isOpen={showSuggest} onClose={() => setShowSuggest(false)} />
      )}
    </>
  );
}
