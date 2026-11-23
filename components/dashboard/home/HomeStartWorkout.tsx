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
import { ProTag } from '@/components/subscription/ProTag';
import { RepeatWorkoutSheet, useRecentRepeatChoices } from '@/components/workout/RepeatWorkoutSheet';
import { StartTodaysWorkoutButton } from './StartTodaysWorkoutButton';

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

const COMPACT_BUTTON =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-button bg-action-tint px-3 text-action text-subhead font-semibold transition-[filter] hover:brightness-110 active:brightness-95';

export function HomeStartWorkout({
  userId,
  compact = false,
}: {
  userId: string | null;
  /**
   * One quiet row for users who track food, not workouts (homeFocus 'food'):
   * "Lifting too?" with a small Start workout button and a Build a program
   * link, so both stay reachable without leading Home.
   */
  compact?: boolean;
}) {
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
      <Link
        href={`/dashboard/workout/${inProgressId}`}
        className={compact ? COMPACT_BUTTON : BUTTON}
        data-testid="home-resume-workout"
      >
        <IconPlayerPlay size={compact ? 16 : 20} aria-hidden="true" />
        Resume workout
      </Link>
    );
  }

  const startButton = compact ? (
    <div
      className="flex items-center gap-3 rounded-card bg-card shadow-card px-4 py-3"
      data-testid="home-compact-workout-entry"
    >
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold text-ink">Lifting too?</div>
        <Link
          href="/dashboard/mesocycle/new"
          className="inline-flex items-center gap-1.5 text-subhead text-ink-2 hover:text-ink transition-colors"
        >
          Or build a program
          <ProTag feature="mesocycleBuilder" />
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setShowOptions(true)}
        className={COMPACT_BUTTON}
        data-testid="home-start-workout"
      >
        <IconBarbell size={16} aria-hidden="true" />
        Start workout
      </button>
    </div>
  ) : (
    // One tap starts today's recommended workout; every other way to start
    // (empty, repeat, preview the suggestion) stays one tap behind it.
    <div className="space-y-1.5">
      <StartTodaysWorkoutButton />
      <button
        type="button"
        onClick={() => setShowOptions(true)}
        className="flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-button text-action text-subhead font-semibold transition-colors active:bg-fill"
        data-testid="home-start-workout"
      >
        <IconBarbell size={16} aria-hidden="true" />
        Other ways to start a workout
      </button>
    </div>
  );

  return (
    <>
      {startButton}
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
