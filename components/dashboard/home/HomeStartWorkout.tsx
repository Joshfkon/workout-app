'use client';

/**
 * Home's always-available "Start workout" action, shown when the hero card
 * doesn't already offer a start (meal suggestion, done for the day, rest
 * day). An unfinished workout wins: the button resumes it instead of
 * starting another. Otherwise it opens a sheet with the same start options
 * as the Train tab (StartWorkoutOptions).
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { IconBarbell, IconPlayerPlay } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { StartWorkoutOptions } from '@/components/workout/StartWorkoutOptions';
import { useLastRepeatableWorkout } from './FreestyleStartActions';
import { RepeatWorkoutSheet, useRecentRepeatChoices } from '@/components/workout/RepeatWorkoutSheet';

const SuggestedWorkoutSheet = dynamic(
  () => import('@/components/workout/SuggestedWorkoutSheet').then((m) => m.SuggestedWorkoutSheet),
  { ssr: false }
);

/** The user's unfinished workout (any day), newest first, or null. */
async function fetchInProgressWorkoutId(userId: string): Promise<string | null> {
  const { data, error } = await createUntypedClient()
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('state', 'in_progress')
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.id as string | undefined) ?? null;
}

const BUTTON =
  'flex w-full min-h-[50px] items-center justify-center gap-2 rounded-button bg-action-tint text-action text-headline transition-[filter] hover:brightness-110 active:brightness-95';

export function HomeStartWorkout({ userId }: { userId: string | null }) {
  const [showOptions, setShowOptions] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [showRepeat, setShowRepeat] = useState(false);
  // Fetched once the sheet opens, so Home doesn't pay for it on every visit.
  const { data: repeatChoices, isLoading: repeatLoading } = useRecentRepeatChoices(userId, showRepeat || showOptions);

  // Live state: never trust a cached "nothing in progress" on revisit.
  const { data: inProgressId } = useQuery({
    queryKey: ['workout', 'in-progress-id', userId],
    queryFn: () => fetchInProgressWorkoutId(userId as string),
    enabled: !!userId,
    staleTime: 0,
  });
  const { data: last } = useLastRepeatableWorkout(userId);

  if (inProgressId) {
    return (
      <Link href={`/dashboard/workout/${inProgressId}`} className={BUTTON} data-testid="home-resume-workout">
        <IconPlayerPlay size={20} aria-hidden="true" />
        Resume workout
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowOptions(true)}
        className={BUTTON}
        data-testid="home-start-workout"
      >
        <IconBarbell size={20} aria-hidden="true" />
        Start workout
      </button>
      <BottomSheet isOpen={showOptions} onClose={() => setShowOptions(false)} title="Start a workout">
        <StartWorkoutOptions
          onSuggest={() => {
            setShowOptions(false);
            setShowSuggest(true);
          }}
          onRepeat={() => {
            setShowOptions(false);
            setShowRepeat(true);
          }}
          canRepeat={!!last}
        />
      </BottomSheet>
      {showSuggest && <SuggestedWorkoutSheet isOpen={showSuggest} onClose={() => setShowSuggest(false)} />}
      <RepeatWorkoutSheet
        isOpen={showRepeat}
        onClose={() => setShowRepeat(false)}
        workouts={repeatChoices ?? []}
        loading={repeatLoading}
      />
    </>
  );
}
