'use client';

import { ProTag } from '@/components/subscription/ProTag';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * /dashboard/train — the Train tab's dashboard.
 *
 * Layout (top to bottom):
 *   1. Title row: "Train" + History / Templates / Exercises pill links.
 *   2. Unfinished-workout banner when a session is in_progress today
 *      (Resume opens it, X discards via the workout page's cancel path).
 *   3. Mesocycle hero: "ARNOLD · WK 1 OF 5 · TODAY|REST DAY" eyebrow with a
 *      Plan link, the day name, and recovery-aware meta. Training days get
 *      Start + "Preview"; rest days get "Train anyway" + "Preview
 *      tomorrow". Both open the same read-only sheet of the session's
 *      exercises from program_data (starting a workout is never the only way
 *      to see what's in it), which links on to /dashboard/mesocycle/plan for
 *      the whole block. No active mesocycle prompts to plan one.
 *   4. Start options — ALWAYS visible, with or without a plan, so the user
 *      can start training from here no matter what state the app is in:
 *      empty workout (add exercises as you go), AI-suggested workout
 *      (shared SuggestedWorkoutSheet), repeat a previous workout (clones a
 *      recent session's exercise list, not its logged weights).
 *   5. Week stats: sets this week · completed/planned sessions · hours
 *      trained + average workout time over the same rolling 7 days · volume
 *      status line (links to /dashboard/volume).
 *   6. Recovery: the shared muscle-readiness body (same as the in-workout
 *      sheet / empty workout) — good-targets strip, body map with the
 *      Recovery/Volume paint toggle, per-muscle volume bars + recovery
 *      badges with a "+N more" expander.
 *   7. Cardio: today's cardio quick-log (moved here from the Progress
 *      page's Wellness tab — cardio is training).
 *   8. Progression: compact summary (tracked vs building-history muscle
 *      groups) linking to /dashboard/analytics.
 *   9. Recent workouts: day name · top muscles, date · sets · duration.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  IconChevronRight,
  IconHistory,
  IconListDetails,
  IconLoader2,
  IconTemplate,
  IconTrendingUp,
} from '@tabler/icons-react';
import { Button as StyledButton } from '@/components/ui/Button';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import {
  startMesocycleWorkoutSession,
  getWorkoutForDate,
  getNextWorkoutForDate,
  type TodayWorkout,
} from '@/lib/training/startMesocycleSession';
import {
  getSessionFromProgramData,
  applyExerciseOverrides,
  type ExerciseOverride,
} from '@/services/mesocycleHelpers';
import { sessionIndexFromCompleted } from '@/lib/training/mesocycleProgress';
import { buildTrainingSchedule } from '@/lib/training/trainingSchedule';
import { cancelWorkoutSession } from '../workout/[id]/_lib/cancelWorkout';
import { useWorkoutStore } from '@/stores/workoutStore';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import { useLiftTrends } from '@/hooks/useLiftTrends';
import { useTrainPageData, TRAIN_PAGE_QUERY_KEY, trainWeekStartDay } from '@/hooks/useTrainPageData';
import { muscleProgressionInputFromRollup } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { getMuscleGroupProgression } from '@/services/progressionInsights';
import { now as clockNow } from '@/lib/clock';
import { parseLocalDay } from '@/lib/date/localDay';
import { useQueryClient } from '@tanstack/react-query';
import {
  mesoProgress,
  toRecentWorkouts,
  weekStats,
  type TrainPageData,
} from './trainPageData';
import {
  SectionLabel,
  UnfinishedWorkoutBanner,
  formatRelativeDay,
} from '../log/_components/LogPageSections';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { SessionExerciseList } from '@/components/mesocycle';
import { CardioTracker } from '@/components/dashboard/CardioTracker';
import { PendingLink } from '@/components/dashboard/PendingLink';
import { NonGymActivityLogger } from '@/components/dashboard/NonGymActivityLogger';
import { SuggestedWorkoutSheet } from '@/components/workout/SuggestedWorkoutSheet';
import { StartWorkoutOptions } from '@/components/workout/StartWorkoutOptions';
import { RepeatWorkoutSheet } from '@/components/workout/RepeatWorkoutSheet';
import { Modal } from '@/components/ui/Modal';
import { clearPersistedRestTimer } from '@/hooks/useRestTimer';
import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  resolveMuscleToStandard,
  toLegacyMuscleGroup,
  type StandardMuscleGroup,
} from '@/types/schema';
import type { Experience, FullProgramRecommendation, WorkoutDay } from '@/types/schema';
import { WorkoutStartProgress, prefetchWorkoutRoute, workoutStartLabel, type WorkoutStartStage } from '@/components/workout/WorkoutStartProgress';

// The readiness card (good-targets strip + body map + per-muscle rows) shares
// the in-workout sheet's assembly. Lazy so that whole stack stays out of the
// train page's initial bundle; the fallback mirrors its card shell.
const TrainReadinessCard = dynamic(
  () => import('@/components/workout/TrainReadinessCard').then((m) => m.TrainReadinessCard),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-card p-4 bg-card shadow-card">
        <h3 className="text-headline text-ink mb-3">Recovery</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-1.5 bg-fill rounded-full" />
          <div className="h-1.5 bg-fill rounded-full w-2/3" />
          <div className="h-1.5 bg-fill rounded-full w-1/2" />
        </div>
      </div>
    ),
  }
);

/** Per-device cache of the last fetched training style (see TrainPage). */
const TRAIN_STYLE_KEY = 'hypertrack:train-style';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "4h 35m" / "45m" from a minute total. */
function formatHoursMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// Removed custom gradient/outline classes in favor of Button component variants

const TOOL_PILLS = [
  { name: 'History', href: '/dashboard/history', icon: IconHistory },
  { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
  { name: 'Exercises', href: '/dashboard/exercises', icon: IconListDetails },
];

export default function TrainPage() {
  useDocumentTitle('Train');
  const router = useRouter();
  const supabase = createUntypedClient();
  // Week totals come from the shared coarse row model (`tiles`) — the same
  // numbers the home glance tile and the volume page show. Summing the 26
  // per-head rows instead double-counts within-group credit.
  const { tiles: volumeTiles, isLoading: volumeLoading } = useWeeklyVolume();
  // Only the rest-day note reads this now — the Recovery card itself renders
  // the shared readiness body (TrainReadinessCard) off the same history cache.
  const { recoveryStatus, isLoading: recoveryLoading } = useMuscleRecovery();
  // Progression pace per muscle group, rolled up from the SAME persisted
  // lift-trend query Progress › Strength uses (hooks/useLiftTrends) — it used
  // to be a second getUser() + 12-week session fetch on every Train visit.
  const liftTrendsQuery = useLiftTrends();
  const progressionLoading = liftTrendsQuery.isPending;

  // One persisted, cached-first query (hooks/useTrainPageData): a revisit
  // paints at once and revalidates in the background.
  const queryClient = useQueryClient();
  const trainQuery = useTrainPageData();
  const data = trainQuery.data ?? null;
  const today = getLocalDateString();
  // Nothing to show yet (first-ever visit): sections render skeletons.
  const isLoading = trainQuery.isPending;
  // Day-scoped: an unfinished workout from a payload fetched on another day
  // is not today's.
  const inProgress = data && data.date === today ? data.inProgress : null;
  const activeMeso = data?.activeMeso ?? null;
  const userId = data?.userId ?? null;
  const recentWorkouts = useMemo(() => toRecentWorkouts(data?.recentRows ?? []), [data?.recentRows]);
  const { sessionsThisWeek, weekTime } = useMemo(
    () => weekStats(data?.weekRows ?? [], parseLocalDay(trainWeekStartDay()).toISOString()),
    [data?.weekRows]
  );
  const { mesoCompletedCount, completedTodayCount, lastCycleDone } = useMemo(
    () => mesoProgress(data?.mesoCompleted ?? null, activeMeso?.days_per_week ?? null, today),
    [data?.mesoCompleted, activeMeso?.days_per_week, today]
  );

  // Freestyle training style hides the plan card (lib/training/trainingStyle).
  // Before any payload, the last-seen style (per-device convenience) keeps a
  // freestyle user's start options from jumping up under the finger.
  const [cachedFreestyle, setCachedFreestyle] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TRAIN_STYLE_KEY) === 'freestyle') setCachedFreestyle(true);
    } catch {
      // Blocked storage: no cached style, same as a first visit.
    }
  }, []);
  const isFreestyle = data ? data.isFreestyle : cachedFreestyle;
  useEffect(() => {
    if (!data) return;
    try {
      window.localStorage.setItem(TRAIN_STYLE_KEY, data.isFreestyle ? 'freestyle' : 'plan');
    } catch {
      // Convenience only.
    }
  }, [data]);

  const [isStarting, setIsStarting] = useState(false);
  const [startStage, setStartStage] = useState<WorkoutStartStage>('preparing');
  const [showAiSheet, setShowAiSheet] = useState(false);
  const [showRepeatSheet, setShowRepeatSheet] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Today's scheduled workout, or the next one with how far out it is.
  const { todayWorkout, nextWorkoutInfo } = useMemo((): {
    todayWorkout: TodayWorkout | null;
    nextWorkoutInfo: { workout: TodayWorkout; offsetDays: number; dayLabel: string } | null;
  } => {
    if (!activeMeso) return { todayWorkout: null, nextWorkoutInfo: null };
    const schedule = buildTrainingSchedule(activeMeso);
    const dateAt = (offset: number) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      return date;
    };

    // Today's NEXT undone session — on a two-a-day date this advances to the
    // PM session once the AM one is completed.
    const todays = getNextWorkoutForDate(
      activeMeso.split_type,
      dateAt(0),
      schedule,
      completedTodayCount
    );
    if (todays) return { todayWorkout: todays, nextWorkoutInfo: null };

    // Interval schedules can skip more than a week's worth of weekdays, so
    // scan far enough ahead to cover the longest supported cadence.
    for (let offset = 1; offset <= 14; offset++) {
      const date = dateAt(offset);
      const workout = getWorkoutForDate(activeMeso.split_type, date, schedule);
      if (workout) {
        return {
          todayWorkout: null,
          nextWorkoutInfo: {
            workout,
            offsetDays: offset,
            dayLabel:
              offset === 1
                ? 'Tomorrow'
                : offset <= 7
                  ? date.toLocaleDateString('en-US', { weekday: 'long' })
                  : date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
          },
        };
      }
    }
    return { todayWorkout: null, nextWorkoutInfo: null };
  }, [activeMeso, completedTodayCount]);

  // The next session from program_data (exercises, sets, est. minutes) — what
  // "Start workout" will build and what the preview sheet shows.
  const nextProgramSession = useMemo(() => {
    if (!activeMeso || mesoCompletedCount === null) return null;
    const sessionIndex = sessionIndexFromCompleted(mesoCompletedCount, activeMeso.days_per_week);
    const programSession = getSessionFromProgramData(
      activeMeso.program_data as FullProgramRecommendation | null,
      sessionIndex,
      activeMeso.current_week,
      activeMeso.total_weeks
    );
    if (!programSession) return null;
    return {
      ...programSession,
      exercises: applyExerciseOverrides(
        programSession.exercises,
        (activeMeso.exercise_overrides ?? []) as ExerciseOverride[]
      ),
    };
  }, [activeMeso, mesoCompletedCount]);

  // What the preview sheet describes: today's split day on a training day,
  // otherwise the next scheduled one (both map to the same program slot).
  const previewWorkout = todayWorkout ?? nextWorkoutInfo?.workout ?? null;

  // Rest-day recovery note: of the next workout's target muscles, which will
  // be recovered by the time that session comes around?
  const restDayRecoveryNote = useMemo(() => {
    if (!nextWorkoutInfo || recoveryLoading || recoveryStatus.length === 0) return null;
    const targets: StandardMuscleGroup[] = Array.from(
      new Set(nextWorkoutInfo.workout.muscles.flatMap((m) => resolveMuscleToStandard(m)))
    );
    if (targets.length === 0) return null;
    const statusByMuscle = new Map(recoveryStatus.map((s) => [s.muscle, s]));
    const hoursUntil = nextWorkoutInfo.offsetDays * 24;
    const readyByThen = targets.filter(
      (m) => (statusByMuscle.get(m)?.hoursRemaining ?? 0) <= hoursUntil
    );
    if (readyByThen.length === targets.length) return 'all muscles ready by then';
    if (readyByThen.length > 0) {
      const names = readyByThen
        .slice(0, 2)
        .map((m) => STANDARD_MUSCLE_DISPLAY_NAMES[m].toLowerCase());
      return `${names.join(' & ')} ready by then`;
    }
    return `${targets.length} target muscles still recovering`;
  }, [nextWorkoutInfo, recoveryLoading, recoveryStatus]);

  // Hero eyebrow: "ARNOLD · WK 1 OF 5 · REST DAY" (+ DELOAD when applicable).
  const heroEyebrow = activeMeso
    ? [
        activeMeso.name,
        `week ${activeMeso.current_week} of ${activeMeso.total_weeks}`,
        activeMeso.current_week === activeMeso.deload_week ? 'deload' : null,
        todayWorkout ? 'today' : 'rest day',
      ]
        .filter(Boolean)
        .join(' · ')
    : isLoading
      ? 'Your plan'
      : 'No active plan';

  // Training-day meta: "7 exercises · est. 65 min · last done Thu".
  const trainingDayMeta = useMemo(() => {
    if (!todayWorkout) return null;
    const exerciseCount =
      nextProgramSession?.exercises.length || todayWorkout.muscles.length * 2;
    const estMinutes =
      (nextProgramSession?.estimatedMinutes ?? 0) > 0
        ? Math.round(nextProgramSession!.estimatedMinutes)
        : exerciseCount * 9;
    return [
      todayWorkout.sessionsScheduledToday === 2 && todayWorkout.sessionOfDay
        ? `session ${todayWorkout.sessionOfDay} of 2 today`
        : null,
      exerciseCount > 0 ? `${exerciseCount} exercises` : null,
      estMinutes > 0 ? `est. ${estMinutes} min` : null,
      lastCycleDone ? `last done ${formatRelativeDay(lastCycleDone)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Exercises are planned when you start';
  }, [todayWorkout, nextProgramSession, lastCycleDone]);

  // Start the next mesocycle session (today's slot on training days, the
  // next slot when "training anyway" on a rest day).
  const handleStartWorkout = async () => {
    if (!activeMeso || isStarting) return;
    setIsStarting(true);
    setStartStage('preparing');
    setError(null);
    try {
      const { sessionId } = await startMesocycleWorkoutSession({
        supabase,
        mesocycle: activeMeso,
        todayWorkout: todayWorkout ?? nextWorkoutInfo?.workout ?? null,
        completedSessions: mesoCompletedCount ?? undefined,
        onStage: (stage, id) => {
          setStartStage(stage);
          if (stage === 'building') prefetchWorkoutRoute(router, id);
        },
      });
      setStartStage('opening');
      router.push(`/dashboard/workout/${sessionId}`);
    } catch (err) {
      console.error('Failed to start workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStarting(false);
    }
  };

  // Discard the unfinished workout from the banner's X. Same cleanup as the
  // workout page's cancel flow: ad-hoc sessions are deleted outright,
  // mesocycle sessions reset to a restartable planned state.
  const handleDiscardWorkout = async () => {
    if (!inProgress || isDiscarding) return;
    setIsDiscarding(true);
    setError(null);
    // try/finally so nothing can leave the modal wedged on "Discarding..."
    // with both buttons disabled — isDiscarding always resets.
    try {
      const { ok, errors } = await cancelWorkoutSession(supabase, {
        sessionId: inProgress.id,
        mesocycleId: inProgress.mesocycleId,
        blockIds: inProgress.blockIds,
      });
      if (ok) {
        // Clear the persisted store too if this session is the one driving the
        // global resume pill (matches the log page's discard flow).
        const { activeSession, endSession } = useWorkoutStore.getState();
        if (activeSession?.id === inProgress.id) {
          clearPersistedRestTimer();
          endSession();
        }
        // Keep the cache in step with the server (CLAUDE.md: mutations
        // write through), so a revisit never resurrects the banner.
        queryClient.setQueryData<TrainPageData | null>(TRAIN_PAGE_QUERY_KEY, (prev) =>
          prev ? { ...prev, inProgress: null } : prev
        );
      } else {
        console.error('Failed to discard workout:', errors);
        setError('Failed to discard workout. Please try again.');
      }
    } catch (err) {
      console.error('Failed to discard workout:', err);
      setError('Failed to discard workout. Please try again.');
    } finally {
      setIsDiscarding(false);
      setShowDiscardConfirm(false);
    }
  };

  const startedAtLabel = inProgress?.startedAt
    ? new Date(inProgress.startedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const liftRollup = liftTrendsQuery.data?.rollup ?? null;
  const progressionGroups = useMemo(() => {
    if (!liftRollup) return [];
    const input = muscleProgressionInputFromRollup(liftRollup);
    return getMuscleGroupProgression({
      snapshotsByExercise: input.snapshotsByExercise,
      muscleByExercise: input.muscleByExercise,
      discontinuitiesByExercise: input.discontinuitiesByExercise,
      experience: (data?.experience as Experience | null) ?? 'intermediate',
      referenceDate: clockNow(),
      goal: liftRollup.goal,
      programStartDate: liftRollup.programStartDate,
    });
  }, [liftRollup, data?.experience]);

  // Progression summary: "2 muscle groups tracked · 18 building history (wk 1)".
  const progressionSubtitle = useMemo(() => {
    if (progressionLoading) return 'Analyzing progression...';
    const tracked = progressionGroups.filter((g) => g.pace !== 'insufficient_data').length;
    const building = progressionGroups.length - tracked;
    if (progressionGroups.length === 0) return 'Complete workouts to build progression history';
    const weekSuffix = activeMeso ? ` (week ${activeMeso.current_week})` : '';
    return (
      [
        `${tracked} muscle ${tracked === 1 ? 'group' : 'groups'} tracked`,
        building > 0 ? `${building} building history` : null,
      ]
        .filter(Boolean)
        .join(' · ') + weekSuffix
    );
  }, [progressionLoading, progressionGroups, activeMeso]);

  const volumeStatusLine = volumeLoading
    ? { text: 'Loading...', className: 'text-ink-3' }
    : volumeTiles.totalSets === 0
      ? { text: 'No sets logged yet this week', className: 'text-ink-3' }
      : volumeTiles.lowCount > 0
        ? {
            text: `${volumeTiles.lowCount} muscle ${
              volumeTiles.lowCount === 1 ? 'group' : 'groups'
            } below minimum`,
            className: 'text-status-warn',
          }
        : { text: 'All muscle groups at target', className: 'text-status-ok' };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Title, then the tool pills on their own row so none is cut off */}
      <div className="space-y-3">
        <h1 className="text-large-title text-ink">Train</h1>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {TOOL_PILLS.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-card text-subhead font-medium text-ink whitespace-nowrap hover:bg-fill/70 transition-colors shadow-card"
              >
                <ToolIcon size={15} className="text-ink-2" aria-hidden="true" />
                {tool.name}
              </Link>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-status-bad/10 border border-status-bad/20 text-status-bad text-caption">
          {error}
        </div>
      )}

      {/* Unfinished workout banner (only when a session is in progress today) */}
      {inProgress && (
        <UnfinishedWorkoutBanner
          startedAtLabel={startedAtLabel}
          setsDone={inProgress.setsDone}
          onResume={() => router.push(`/dashboard/workout/${inProgress.id}`)}
          onDiscard={() => setShowDiscardConfirm(true)}
        />
      )}

      {/* Mesocycle hero (training day / rest day / no plan) — hidden in
          freestyle, where the start options below are the whole page. */}
      {!isFreestyle && (
      <div className="rounded-card p-4 bg-card shadow-card">
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption font-semibold text-ink-3 truncate">
            {heroEyebrow}
          </p>
          {activeMeso && (
            <Link
              href="/dashboard/mesocycle"
              className="flex items-center gap-0.5 text-subhead font-medium text-action transition-colors flex-shrink-0"
            >
              Plan
              <IconChevronRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>

        {activeMeso && todayWorkout ? (
          <>
            <h2 className="text-title text-ink mt-1.5">
              {todayWorkout.dayName}
            </h2>
            <p className="text-subhead text-ink-2 mt-1">{trainingDayMeta}</p>
            <div className="flex gap-2 mt-4">
              <StyledButton
                onClick={handleStartWorkout}
                disabled={isStarting}
                variant="primary"
                className="flex-[2] text-body"
              >
                {isStarting
                  ? workoutStartLabel(startStage)
                  : inProgress
                    ? 'Continue workout'
                    : 'Start workout'}
              </StyledButton>
              {/* Read-only look at today's session — starting a workout must
                  never be the only way to find out what's in it. */}
              <StyledButton 
                onClick={() => setShowPreview(true)} 
                variant="outline"
                className="flex-1 text-body"
              >
                Preview
              </StyledButton>
            </div>
            {isStarting && <WorkoutStartProgress stage={startStage} compact className="mt-2" />}
          </>
        ) : activeMeso ? (
          <>
            <h2 className="text-title text-ink mt-1.5">
              {nextWorkoutInfo ? `Next: ${nextWorkoutInfo.workout.dayName}` : 'Rest day'}
            </h2>
            <p className="text-subhead text-ink-2 mt-1">
              {nextWorkoutInfo
                ? [nextWorkoutInfo.dayLabel, restDayRecoveryNote].filter(Boolean).join(' · ')
                : 'No upcoming workouts scheduled'}
            </p>
            <div className="flex gap-2 mt-4">
              <StyledButton
                onClick={handleStartWorkout}
                disabled={isStarting || !nextWorkoutInfo}
                variant="secondary"
                className="flex-1 text-body"
              >
                {isStarting ? workoutStartLabel(startStage) : 'Train anyway'}
              </StyledButton>
              <StyledButton
                onClick={() => setShowPreview(true)}
                disabled={!nextWorkoutInfo}
                variant="outline"
                className="flex-1 text-body"
              >
                Preview {nextWorkoutInfo?.dayLabel === 'Tomorrow' ? 'tomorrow' : 'next'}
              </StyledButton>
            </div>
            {isStarting && <WorkoutStartProgress stage={startStage} compact className="mt-2" />}
          </>
        ) : isLoading ? (
          // First-ever visit, nothing cached: the card's own shape, not a
          // "Loading..." title that then turns into something else.
          <div
            className="animate-pulse"
            role="status"
            aria-busy="true"
            aria-label="Loading your plan"
            data-testid="train-plan-loading"
          >
            <div className="mt-2 h-6 w-2/3 rounded bg-fill" />
            <div className="mt-2 h-4 w-1/2 rounded bg-fill" />
            <div className="mt-4 h-11 w-full rounded-button bg-fill" />
          </div>
        ) : (
          <>
            <h2 className="text-title text-ink mt-1.5">No training plan</h2>
            <p className="text-subhead text-ink-2 mt-1">
              Plan a mesocycle for smart progression and volume tracking
            </p>
            {(
              <div className="flex gap-2 mt-4">
                <Link
                  href="/dashboard/mesocycle/new"
                  className="flex-1"
                >
                  <StyledButton
                    variant="primary"
                    className="w-full text-body"
                  >
                    <span className="inline-flex items-center gap-2">
                      Plan a mesocycle
                      <ProTag feature="mesocycleBuilder" tone="onAccent" />
                    </span>
                  </StyledButton>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
      )}

      {/* Start options — always available, with or without a plan, so no
          app state can ever block starting a workout */}
      <div className="space-y-2">
        <SectionLabel>Start a workout</SectionLabel>
        <StartWorkoutOptions
          onSuggest={() => setShowAiSheet(true)}
          onRepeat={() => setShowRepeatSheet(true)}
          canRepeat={recentWorkouts.length > 0}
        />
      </div>

      {/* Freestyle hides the plan card above, which was the only way into the
          mesocycle builder from Train. Both advanced personas on the UX panel
          looked here (and in Templates) for a program builder, found none and
          gave up. A quiet row keeps it one tap away without leading the page. */}
      {isFreestyle && (
        // PendingLink: pressed state + a spinner from the tap until the
        // planner arrives (the panel's first tap here read as missed).
        <PendingLink
          href="/dashboard/mesocycle/new"
          className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card transition-[background-color,transform] hover:bg-fill/70 active:scale-[0.99] active:bg-fill"
          pendingClassName="bg-fill"
          data-testid="train-plan-block"
        >
          {(pending) => (
          <>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-body font-semibold text-ink">
              Plan a training block
              <ProTag feature="mesocycleBuilder" />
            </span>
            <span className="block text-subhead text-ink-2">
              A multi-week mesocycle: sets ramp toward your MRV, then a deload.
            </span>
          </span>
          {pending ? (
            <IconLoader2 size={18} className="flex-shrink-0 animate-spin text-action" aria-hidden="true" />
          ) : (
            <IconChevronRight size={18} className="flex-shrink-0 text-ink-3" aria-hidden="true" />
          )}
          </>
          )}
        </PendingLink>
      )}

      {/* Week stats: sets · sessions · volume status */}
      <Link
        href="/dashboard/volume"
        className="w-full flex items-center gap-3 p-4 rounded-card bg-card text-left hover:bg-fill/70 transition-colors shadow-card"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-body text-ink-2">
            <span className="font-semibold text-ink">
              {volumeLoading ? '—' : volumeTiles.totalSets} sets
            </span>{' '}
            this week ·{' '}
            <span className="font-semibold text-ink">
              {isLoading
                ? '—'
                : activeMeso
                  ? `${sessionsThisWeek}/${activeMeso.days_per_week}`
                  : sessionsThisWeek}{' '}
              sessions
            </span>
          </span>
          {weekTime.avgMin !== null && (
            <span className="block text-subhead text-ink-2 mt-0.5">
              <span className="font-medium text-ink">
                {formatHoursMinutes(weekTime.totalMin)}
              </span>{' '}
              trained ·{' '}
              <span className="font-medium text-ink">
                {Math.round(weekTime.avgMin)} min
              </span>{' '}
              avg workout
            </span>
          )}
          <span className={`block text-subhead mt-0.5 ${volumeStatusLine.className}`}>
            {volumeStatusLine.text}
          </span>
        </span>
        <IconChevronRight size={16} className="text-ink-3 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Recovery: the same readiness body as the in-workout sheet / empty
          workout — good-targets strip, body map with the Recovery/Volume
          paint toggle, per-muscle volume bars + recovery badges. */}
      <TrainReadinessCard />

      {/* Cardio quick-log (moved here from the Progress page's Wellness
          tab). Self-contained: fetches and writes today's cardio_log. */}
      {userId && (
        <div className="rounded-card p-4 bg-card shadow-card">
          <h3 className="text-headline text-ink mb-3">Cardio</h3>
          <CardioTracker userId={userId} />
        </div>
      )}

      {/* Non-gym activity log — rides, runs, sports. Feeds the recovery model
          (synthetic recovery-debt sessions), never weekly volume, so the
          readiness card above reacts to a hard Sunday ride. */}
      {userId && (
        <div className="rounded-card p-4 bg-card shadow-card">
          <h3 className="text-headline text-ink mb-3">Other activity</h3>
          <NonGymActivityLogger userId={userId} />
        </div>
      )}

      {/* Progression summary — deep-links to the Strength tab's
          per-muscle progression card, not just the top of Progress. */}
      <Link
        href="/dashboard/analytics?tab=strength&section=muscle-progression"
        className="w-full flex items-center gap-3.5 p-4 rounded-card bg-card text-left hover:bg-fill/70 transition-colors shadow-card"
      >
        <span className="w-12 h-12 rounded-xl bg-fill flex items-center justify-center flex-shrink-0">
          <IconTrendingUp size={22} className="text-ink" aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-body font-semibold text-ink">Progression</span>
          <span className="block text-subhead text-ink-2 mt-0.5">
            {progressionSubtitle}
          </span>
        </span>
        <IconChevronRight size={16} className="text-ink-3 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Recent workouts */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <SectionLabel>Recent workouts</SectionLabel>
          <Link
            href="/dashboard/history"
            className="text-subhead font-medium text-action transition-colors"
          >
            View all
          </Link>
        </div>
        {isLoading ? (
          <div
            className="animate-pulse overflow-hidden rounded-card bg-card shadow-card"
            role="status"
            aria-busy="true"
            aria-label="Loading recent workouts"
            data-testid="train-recent-loading"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 px-4 py-3">
                <div className="h-4 w-2/5 rounded bg-fill" />
                <div className="h-3 w-3/5 rounded bg-fill" />
              </div>
            ))}
          </div>
        ) : recentWorkouts.length === 0 ? (
          <div className="p-4 rounded-card bg-card text-subhead text-ink-3 shadow-card">
            No completed workouts yet — start one above.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card bg-card shadow-card">
            {recentWorkouts.slice(0, 3).map((workout, i) => (
              <Link
                key={workout.id}
                href="/dashboard/history"
                className={`flex items-center gap-3 px-4 py-3 active:bg-fill transition-colors ${i > 0 ? 'border-t border-sep ml-4 pl-0' : ''}`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-body font-semibold text-ink truncate">
                    {workout.title}
                  </span>
                  <span className="block text-subhead text-ink-3 mt-0.5">
                    {workout.completedAt.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' · '}
                    {workout.setCount} {workout.setCount === 1 ? 'set' : 'sets'}
                    {workout.durationMin != null ? ` · ${workout.durationMin} min` : ''}
                  </span>
                </span>
                <IconChevronRight
                  size={16}
                  className="text-ink-3 flex-shrink-0"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Preview sheet: the session Start would build, from program_data —
          today's on a training day, the next one on a rest day. */}
      <BottomSheet
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        title={
          previewWorkout
            ? `${todayWorkout ? 'Today' : 'Next'}: ${previewWorkout.dayName}`
            : 'Next workout'
        }
      >
        <div className="space-y-3">
          {previewWorkout && (
            <p className="text-subhead text-ink-2">
              {[
                todayWorkout ? 'Today' : nextWorkoutInfo?.dayLabel,
                nextProgramSession
                  ? `${nextProgramSession.exercises.length} exercises`
                  : null,
                nextProgramSession
                  ? `${nextProgramSession.exercises.reduce((n, ex) => n + ex.sets, 0)} sets`
                  : null,
                (nextProgramSession?.estimatedMinutes ?? 0) > 0
                  ? `est. ${Math.round(nextProgramSession!.estimatedMinutes)} min`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {nextProgramSession && nextProgramSession.exercises.length > 0 ? (
            <SessionExerciseList exercises={nextProgramSession.exercises} />
          ) : (
            <div className="rounded-card bg-fill/60 p-3">
              <p className="text-subhead text-ink-2">
                Exercises are planned when you start. Target muscles:{' '}
                <span className="text-ink">
                  {previewWorkout?.muscles.map(capitalize).join(', ') ?? '—'}
                </span>
              </p>
            </div>
          )}

          <p className="text-caption text-ink-3">
            Weights are suggested from your history once you start.
          </p>

          <div className="space-y-2">
            <StyledButton
              onClick={() => {
                setShowPreview(false);
                handleStartWorkout();
              }}
              disabled={isStarting}
              variant="primary"
              className="w-full text-body"
            >
              {isStarting ? workoutStartLabel(startStage) : todayWorkout ? 'Start workout' : 'Train anyway today'}
            </StyledButton>
            <Link
              href="/dashboard/mesocycle/plan"
              onClick={() => setShowPreview(false)}
              className="block w-full py-2 rounded-lg text-center text-subhead font-medium text-action transition-colors"
            >
              See the whole plan
            </Link>
            <button
              onClick={() => setShowPreview(false)}
              className="w-full py-2 rounded-lg text-subhead text-ink-2 hover:text-ink transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* AI suggested workout (shared with /dashboard/log) — mounts and
          fetches on first open; nothing is created until Start */}
      {showAiSheet && (
        <SuggestedWorkoutSheet isOpen onClose={() => setShowAiSheet(false)} />
      )}

      {/* Repeat previous workout: pick a recent session to clone its
          exercise list (weights are re-estimated, not copied) */}
      <RepeatWorkoutSheet
        isOpen={showRepeatSheet}
        onClose={() => setShowRepeatSheet(false)}
        workouts={recentWorkouts}
        loading={isLoading}
      />

      {/* Discard confirmation for the unfinished-workout banner's X */}
      {showDiscardConfirm && inProgress && (
        <Modal isOpen onClose={() => setShowDiscardConfirm(false)} title="Discard workout?">
          <div className="space-y-4">
            <p className="text-subhead text-ink-2">
              {inProgress.setsDone > 0
                ? `This will delete the ${inProgress.setsDone} ${
                    inProgress.setsDone === 1 ? 'set' : 'sets'
                  } you logged and can't be undone. `
                : ''}
              {inProgress.mesocycleId
                ? 'The planned workout stays on your schedule so you can restart it fresh.'
                : 'This removes the workout session entirely.'}
            </p>
            <div className="flex gap-2">
              <StyledButton
                variant="outline"
                onClick={() => setShowDiscardConfirm(false)}
                disabled={isDiscarding}
                className="flex-1"
              >
                Keep training
              </StyledButton>
              <StyledButton
                variant="destructive"
                onClick={handleDiscardWorkout}
                disabled={isDiscarding}
                className="flex-1"
              >
                {isDiscarding ? 'Discarding...' : 'Discard workout'}
              </StyledButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
