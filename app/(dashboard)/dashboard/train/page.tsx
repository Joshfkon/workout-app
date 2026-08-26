'use client';

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
  IconPlus,
  IconRepeat,
  IconSparkles,
  IconTemplate,
  IconTrendingUp,
} from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { resolveAuthState } from '@/lib/supabase/authState';
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
import { buildTrainingSchedule, type ScheduleMode } from '@/lib/training/trainingSchedule';
import {
  createRepeatSession,
  type RepeatableExercise,
} from '@/lib/training/repeatWorkout';
import { getOrCreateTodaySession } from '../workout/_lib/adhocSession';
import { cancelWorkoutSession } from '../workout/[id]/_lib/cancelWorkout';
import { useWorkoutStore } from '@/stores/workoutStore';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import { useMuscleProgression } from '@/hooks/useMuscleProgression';
import {
  QuickLogRow,
  SectionLabel,
  UnfinishedWorkoutBanner,
  formatRelativeDay,
} from '../log/_components/LogPageSections';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { SessionExerciseList } from '@/components/mesocycle';
import { CardioTracker } from '@/components/dashboard/CardioTracker';
import { SuggestedWorkoutSheet } from '@/components/workout/SuggestedWorkoutSheet';
import { Modal } from '@/components/ui/Modal';
import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  resolveMuscleToStandard,
  toLegacyMuscleGroup,
  type StandardMuscleGroup,
} from '@/types/schema';
import type { FullProgramRecommendation, WorkoutDay } from '@/types/schema';

// The readiness card (good-targets strip + body map + per-muscle rows) shares
// the in-workout sheet's assembly. Lazy so that whole stack stays out of the
// train page's initial bundle; the fallback mirrors its card shell.
const TrainReadinessCard = dynamic(
  () => import('@/components/workout/TrainReadinessCard').then((m) => m.TrainReadinessCard),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl p-4 bg-surface-900 border border-surface-800">
        <h3 className="text-[15px] font-semibold text-surface-100 mb-3">Recovery</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-1.5 bg-surface-800 rounded-full" />
          <div className="h-1.5 bg-surface-800 rounded-full w-2/3" />
          <div className="h-1.5 bg-surface-800 rounded-full w-1/2" />
        </div>
      </div>
    ),
  }
);

interface InProgressSummary {
  id: string;
  /** null for ad-hoc (blank/quick/AI) sessions. */
  mesocycleId: string | null;
  startedAt: string | null;
  setsDone: number;
  /** exercise_block ids, needed by the discard path. */
  blockIds: string[];
}

/** Active mesocycle row: display fields + what the start/preview paths need. */
interface ActiveMesocycleRow {
  id: string;
  name: string;
  current_week: number;
  total_weeks: number;
  deload_week: number;
  split_type: string;
  days_per_week: number;
  preferred_workout_days: WorkoutDay[] | null;
  /** Schedule shape: fixed weekdays, or every-N-days from start_date. */
  schedule_mode?: ScheduleMode | null;
  training_interval_days?: number | null;
  sessions_per_day?: number | null;
  start_date?: string | null;
  program_data: unknown;
  exercise_overrides?: ExerciseOverride[];
}

interface RecentWorkout {
  id: string;
  completedAt: Date;
  title: string;
  setCount: number;
  /** null when started_at is missing (can't compute a duration). */
  durationMin: number | null;
  /** Exercise list for the "Repeat previous workout" clone path. */
  exercises: RepeatableExercise[];
}

interface InProgressBlockRow {
  id: string;
  set_logs: { id: string; is_warmup: boolean | null }[] | null;
}

interface RecentSessionRow {
  id: string;
  completed_at: string;
  started_at: string | null;
  /** Active duration snapshot (pauses excluded); null for legacy sessions. */
  duration_seconds: number | null;
  exercise_blocks:
    | {
        exercise_id: string;
        order: number | null;
        suggestion_reason: string | null;
        exercises:
          | { name: string | null; primary_muscle: string | null }
          | { name: string | null; primary_muscle: string | null }[]
          | null;
        set_logs:
          | { is_warmup: boolean | null; weight_kg: number | null; reps: number | null }[]
          | null;
      }[]
    | null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Active workout minutes: the duration_seconds snapshot (pauses excluded)
 * when present, else the completed_at − started_at wall-clock span for legacy
 * sessions without one. Null when neither yields a positive duration.
 */
function activeDurationMin(row: {
  started_at: string | null;
  completed_at: string;
  duration_seconds: number | null;
}): number | null {
  if (row.duration_seconds != null && row.duration_seconds > 0) {
    return row.duration_seconds / 60;
  }
  if (!row.started_at) return null;
  const min =
    (new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()) / 60000;
  return min > 0 ? min : null;
}

/** "4h 35m" / "45m" from a minute total. */
function formatHoursMinutes(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * "Pull · Back, Biceps" — the split-day name parsed from the blocks'
 * suggestion_reason ("Pull - Week 2 ...", written by the start path) plus the
 * top two muscle groups by working sets. Falls back gracefully when either
 * half is missing (ad-hoc sessions have neither a day name nor a plan).
 */
function deriveWorkoutTitle(blocks: NonNullable<RecentSessionRow['exercise_blocks']>): string {
  let dayName: string | null = null;
  for (const block of blocks) {
    const match = /^(.+?) - Week \d+/.exec(block.suggestion_reason ?? '');
    if (match) {
      dayName = match[1];
      break;
    }
  }

  const setsByGroup = new Map<string, number>();
  blocks.forEach((block) => {
    const workingSets = (block.set_logs ?? []).filter((l) => !l.is_warmup).length;
    if (workingSets === 0) return;
    const exercise = Array.isArray(block.exercises) ? block.exercises[0] : block.exercises;
    const legacy = exercise?.primary_muscle ? toLegacyMuscleGroup(exercise.primary_muscle) : null;
    if (!legacy) return;
    setsByGroup.set(legacy, (setsByGroup.get(legacy) ?? 0) + workingSets);
  });
  const topMuscles = Array.from(setsByGroup.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([group]) => capitalize(group))
    .join(', ');

  if (dayName && topMuscles) return `${dayName} · ${topMuscles}`;
  return dayName ?? (topMuscles || 'Workout');
}

const GRADIENT_CTA_CLASS =
  'py-3 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-60';
const OUTLINE_CTA_CLASS =
  'py-3 rounded-xl border border-surface-700 text-surface-100 text-[15px] font-semibold hover:bg-surface-800/70 transition-colors disabled:opacity-60';

const TOOL_PILLS = [
  { name: 'History', href: '/dashboard/history', icon: IconHistory },
  { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
  { name: 'Exercises', href: '/dashboard/exercises', icon: IconListDetails },
];

export default function TrainPage() {
  const router = useRouter();
  const supabase = createUntypedClient();
  // Week totals come from the shared coarse row model (`tiles`) — the same
  // numbers the home glance tile and the volume page show. Summing the 26
  // per-head rows instead double-counts within-group credit.
  const { tiles: volumeTiles, isLoading: volumeLoading } = useWeeklyVolume();
  // Only the rest-day note reads this now — the Recovery card itself renders
  // the shared readiness body (TrainReadinessCard) off the same history cache.
  const { recoveryStatus, isLoading: recoveryLoading } = useMuscleRecovery();
  const { groups: progressionGroups, isLoading: progressionLoading } = useMuscleProgression();

  const [isLoading, setIsLoading] = useState(true);
  const [inProgress, setInProgress] = useState<InProgressSummary | null>(null);
  const [activeMeso, setActiveMeso] = useState<ActiveMesocycleRow | null>(null);
  const [recentWorkouts, setRecentWorkouts] = useState<RecentWorkout[]>([]);
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0);
  // Time trained over the same rolling 7 days; avgMin is null until at least
  // one session in the window has a usable started_at → completed_at span.
  const [weekTime, setWeekTime] = useState<{ totalMin: number; avgMin: number | null }>({
    totalMin: 0,
    avgMin: null,
  });
  const [mesoCompletedCount, setMesoCompletedCount] = useState<number | null>(null);
  // Completed sessions dated today — picks a two-a-day date's next session.
  const [completedTodayCount, setCompletedTodayCount] = useState(0);
  const [lastCycleDone, setLastCycleDone] = useState<Date | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingEmpty, setIsStartingEmpty] = useState(false);
  const [showAiSheet, setShowAiSheet] = useState(false);
  const [showRepeatSheet, setShowRepeatSheet] = useState(false);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For the self-contained cardio quick-log card.
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setUserId(user.id);

        const today = getLocalDateString();
        // Same rolling 7-day window as useWeeklyVolume, so the sets and
        // sessions in the week-stats card count the same workouts.
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const weekStart = getLocalDateString(sevenDaysAgo);

        const [inProgressRes, mesoRes, recentRes, weekSessionsRes] = await Promise.all([
          supabase
            .from('workout_sessions')
            .select('id, mesocycle_id, started_at, exercise_blocks(id, set_logs(id, is_warmup))')
            .eq('user_id', user.id)
            .eq('planned_date', today)
            .eq('state', 'in_progress')
            .limit(1),
          supabase
            .from('mesocycles')
            .select(
              'id, name, current_week, total_weeks, deload_week, split_type, days_per_week, preferred_workout_days, schedule_mode, training_interval_days, sessions_per_day, start_date, program_data, exercise_overrides, generated_with_enhanced_mode'
            )
            .eq('user_id', user.id)
            .eq('state', 'active')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('workout_sessions')
            .select(
              'id, completed_at, started_at, duration_seconds, exercise_blocks(exercise_id, order, suggestion_reason, exercises(name, primary_muscle), set_logs(is_warmup, weight_kg, reps))'
            )
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .order('completed_at', { ascending: false })
            .limit(5),
          supabase
            .from('workout_sessions')
            .select('started_at, completed_at, duration_seconds')
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .gte('completed_at', weekStart),
        ]);

        const ipRow = inProgressRes.data?.[0];
        if (ipRow) {
          const blocks = (ipRow.exercise_blocks ?? []) as InProgressBlockRow[];
          const setsDone = blocks.reduce(
            (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
            0
          );
          setInProgress({
            id: ipRow.id,
            mesocycleId: ipRow.mesocycle_id ?? null,
            startedAt: ipRow.started_at ?? null,
            setsDone,
            blockIds: blocks.map((b) => b.id),
          });
        }

        const meso = (mesoRes.data?.[0] ?? null) as ActiveMesocycleRow | null;
        setActiveMeso(meso);

        setRecentWorkouts(
          ((recentRes.data ?? []) as RecentSessionRow[]).map((row) => {
            const blocks = row.exercise_blocks ?? [];
            const setCount = blocks.reduce(
              (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
              0
            );
            const completedAt = new Date(row.completed_at);
            const rawDurationMin = activeDurationMin(row);
            const durationMin = rawDurationMin != null ? Math.round(rawDurationMin) : null;
            // The clone list for "Repeat previous workout": exercise ids +
            // working sets (weights feed E1RM re-estimation, not the targets).
            const exercises: RepeatableExercise[] = [...blocks]
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              .map((b) => {
                const exercise = Array.isArray(b.exercises) ? b.exercises[0] : b.exercises;
                return {
                  exerciseId: b.exercise_id,
                  name: exercise?.name ?? '',
                  sets: (b.set_logs ?? [])
                    .filter((l) => !l.is_warmup)
                    .map((l) => ({ weight_kg: l.weight_kg ?? 0, reps: l.reps ?? 0 })),
                };
              })
              .filter((e) => e.exerciseId && e.name);
            return {
              id: row.id,
              completedAt,
              title: deriveWorkoutTitle(blocks),
              setCount,
              durationMin: durationMin != null && durationMin > 0 ? durationMin : null,
              exercises,
            };
          })
        );

        const weekRows = (weekSessionsRes.data ?? []) as {
          started_at: string | null;
          completed_at: string;
          duration_seconds: number | null;
        }[];
        setSessionsThisWeek(weekRows.length);
        // Sessions without a usable duration still count as sessions but are
        // dropped from the time math rather than skewing the totals.
        const durationsMin = weekRows
          .map(activeDurationMin)
          .filter((min): min is number => min !== null);
        const totalMin = durationsMin.reduce((sum, min) => sum + min, 0);
        setWeekTime({
          totalMin,
          avgMin: durationsMin.length > 0 ? totalMin / durationsMin.length : null,
        });

        // Completed-session count drives the next session index (the
        // self-extending scheme the start path uses) and "last done" — one
        // full cycle (days_per_week sessions) ago in completion order.
        if (meso) {
          const { data: completedRows } = await supabase
            .from('workout_sessions')
            .select('started_at, planned_date')
            .eq('mesocycle_id', meso.id)
            .eq('state', 'completed')
            .order('started_at', { ascending: true });
          const completed = (completedRows ?? []) as {
            started_at: string | null;
            planned_date: string | null;
          }[];
          setMesoCompletedCount(completed.length);
          const todayStr = getLocalDateString();
          setCompletedTodayCount(
            completed.filter((row) => row.planned_date === todayStr).length
          );
          const lastCycleIdx = completed.length - meso.days_per_week;
          const lastStartedAt = lastCycleIdx >= 0 ? completed[lastCycleIdx]?.started_at : null;
          setLastCycleDone(lastStartedAt ? new Date(lastStartedAt) : null);
        }
      } catch (err) {
        console.error('Failed to load train dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        `wk ${activeMeso.current_week} of ${activeMeso.total_weeks}`,
        activeMeso.current_week === activeMeso.deload_week ? 'deload' : null,
        todayWorkout ? 'today' : 'rest day',
      ]
        .filter(Boolean)
        .join(' · ')
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
    setError(null);
    try {
      const { sessionId } = await startMesocycleWorkoutSession({
        supabase,
        mesocycle: activeMeso,
        todayWorkout: todayWorkout ?? nextWorkoutInfo?.workout ?? null,
        completedSessions: mesoCompletedCount ?? undefined,
      });
      router.push(`/dashboard/workout/${sessionId}`);
    } catch (err) {
      console.error('Failed to start workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStarting(false);
    }
  };

  // Empty workout: create/reuse today's ad-hoc session (no exercise blocks)
  // and open the workout page — exercises get added there via the picker.
  // Same path as the Log page's blank workout, so repeat taps reuse the
  // session and never litter empties.
  const handleStartEmpty = async () => {
    if (isStartingEmpty) return;
    setIsStartingEmpty(true);
    setError(null);
    try {
      const auth = await resolveAuthState(supabase);
      if (auth.status === 'unauthenticated') {
        router.push('/login');
        return;
      }
      if (auth.status === 'error') {
        // Verify failed transiently — keep the session, let them retry.
        setError("Couldn't verify your session. Check your connection and try again.");
        setIsStartingEmpty(false);
        return;
      }
      const { sessionId } = await getOrCreateTodaySession(supabase, auth.userId);
      router.push(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start empty workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStartingEmpty(false);
    }
  };

  // Repeat a previous workout: clone its exercise list (not its logged
  // weights) into a fresh session via the shared helper the History page's
  // repeat button uses.
  const handleRepeatWorkout = async (workout: RecentWorkout) => {
    if (repeatingId) return;
    if (workout.exercises.length === 0) {
      setError('This workout has no exercises to repeat.');
      setShowRepeatSheet(false);
      return;
    }
    setRepeatingId(workout.id);
    setError(null);
    try {
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
      setShowRepeatSheet(false);
    }
  };

  // Discard the unfinished workout from the banner's X. Same cleanup as the
  // workout page's cancel flow: ad-hoc sessions are deleted outright,
  // mesocycle sessions reset to a restartable planned state.
  const handleDiscardWorkout = async () => {
    if (!inProgress || isDiscarding) return;
    setIsDiscarding(true);
    setError(null);
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
        endSession();
      }
      setInProgress(null);
    } else {
      console.error('Failed to discard workout:', errors);
      setError('Failed to discard workout. Please try again.');
    }
    setIsDiscarding(false);
    setShowDiscardConfirm(false);
  };

  const startedAtLabel = inProgress?.startedAt
    ? new Date(inProgress.startedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  // Progression summary: "2 muscle groups tracked · 18 building history (wk 1)".
  const progressionSubtitle = useMemo(() => {
    if (progressionLoading) return 'Analyzing progression...';
    const tracked = progressionGroups.filter((g) => g.pace !== 'insufficient_data').length;
    const building = progressionGroups.length - tracked;
    if (progressionGroups.length === 0) return 'Complete workouts to build progression history';
    const weekSuffix = activeMeso ? ` (wk ${activeMeso.current_week})` : '';
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
    ? { text: 'Loading...', className: 'text-surface-500' }
    : volumeTiles.totalSets === 0
      ? { text: 'No sets logged yet this week', className: 'text-surface-500' }
      : volumeTiles.lowCount > 0
        ? {
            text: `${volumeTiles.lowCount} muscle ${
              volumeTiles.lowCount === 1 ? 'group' : 'groups'
            } below minimum`,
            className: 'text-warning-400',
          }
        : { text: 'All muscle groups at target', className: 'text-success-400' };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Title row: Train + tool pills */}
      <div className="flex items-center gap-2.5">
        <h1 className="text-[28px] leading-none font-bold text-surface-100 flex-shrink-0">
          Train
        </h1>
        <div className="flex items-center gap-1.5 overflow-x-auto ml-auto">
          {TOOL_PILLS.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface-900 border border-surface-800 text-[13px] font-medium text-surface-200 whitespace-nowrap hover:bg-surface-800/70 transition-colors"
              >
                <ToolIcon size={15} className="text-surface-400" aria-hidden="true" />
                {tool.name}
              </Link>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger-400 text-xs">
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

      {/* Mesocycle hero (training day / rest day / no plan) */}
      <div className="rounded-2xl p-4 bg-surface-900 border border-surface-800">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-surface-500 truncate">
            {heroEyebrow}
          </p>
          {activeMeso && (
            <Link
              href="/dashboard/mesocycle"
              className="flex items-center gap-0.5 text-[13px] font-medium text-primary-400 hover:text-primary-300 transition-colors flex-shrink-0"
            >
              Plan
              <IconChevronRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>

        {activeMeso && todayWorkout ? (
          <>
            <h2 className="text-[26px] leading-tight font-bold text-surface-100 mt-1.5">
              {todayWorkout.dayName}
            </h2>
            <p className="text-[13px] text-surface-400 mt-1">{trainingDayMeta}</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleStartWorkout}
                disabled={isStarting}
                className={`flex-[2] ${GRADIENT_CTA_CLASS}`}
              >
                {isStarting
                  ? 'Starting...'
                  : inProgress
                    ? 'Continue workout'
                    : 'Start workout'}
              </button>
              {/* Read-only look at today's session — starting a workout must
                  never be the only way to find out what's in it. */}
              <button onClick={() => setShowPreview(true)} className={`flex-1 ${OUTLINE_CTA_CLASS}`}>
                Preview
              </button>
            </div>
          </>
        ) : activeMeso ? (
          <>
            <h2 className="text-[26px] leading-tight font-bold text-surface-100 mt-1.5">
              {nextWorkoutInfo ? `Next: ${nextWorkoutInfo.workout.dayName}` : 'Rest day'}
            </h2>
            <p className="text-[13px] text-surface-400 mt-1">
              {nextWorkoutInfo
                ? [nextWorkoutInfo.dayLabel, restDayRecoveryNote].filter(Boolean).join(' · ')
                : 'No upcoming workouts scheduled'}
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleStartWorkout}
                disabled={isStarting || !nextWorkoutInfo}
                className={`flex-1 ${OUTLINE_CTA_CLASS}`}
              >
                {isStarting ? 'Starting...' : 'Train anyway'}
              </button>
              <button
                onClick={() => setShowPreview(true)}
                disabled={!nextWorkoutInfo}
                className={`flex-1 ${GRADIENT_CTA_CLASS}`}
              >
                Preview {nextWorkoutInfo?.dayLabel === 'Tomorrow' ? 'tomorrow' : 'next'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-[26px] leading-tight font-bold text-surface-100 mt-1.5">
              {isLoading ? 'Loading...' : 'No training plan'}
            </h2>
            <p className="text-[13px] text-surface-400 mt-1">
              {isLoading
                ? ' '
                : 'Plan a mesocycle for smart progression and volume tracking'}
            </p>
            {!isLoading && (
              <div className="flex gap-2 mt-4">
                <Link
                  href="/dashboard/mesocycle/new"
                  className={`flex-1 text-center ${GRADIENT_CTA_CLASS}`}
                >
                  Plan a mesocycle
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* Start options — always available, with or without a plan, so no
          app state can ever block starting a workout */}
      <div className="space-y-2">
        <SectionLabel>Start a workout</SectionLabel>

        <QuickLogRow
          icon={
            <span className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center flex-shrink-0">
              {isStartingEmpty ? (
                <IconLoader2 size={22} className="text-primary-400 animate-spin" aria-hidden="true" />
              ) : (
                <IconPlus size={22} className="text-primary-400" aria-hidden="true" />
              )}
            </span>
          }
          title="Start empty workout"
          subtitle={isStartingEmpty ? 'Starting...' : 'Add exercises as you go'}
          onTap={handleStartEmpty}
          disabled={isStartingEmpty}
        />

        <QuickLogRow
          icon={
            <span className="w-10 h-10 rounded-xl bg-accent-500/15 flex items-center justify-center flex-shrink-0">
              <IconSparkles size={22} className="text-accent-400" aria-hidden="true" />
            </span>
          }
          title="AI-suggested workout"
          subtitle="Built from recovery and weekly volume"
          onTap={() => setShowAiSheet(true)}
        />

        <QuickLogRow
          icon={
            <span className="w-10 h-10 rounded-xl bg-surface-800 flex items-center justify-center flex-shrink-0">
              <IconRepeat size={22} className="text-surface-200" aria-hidden="true" />
            </span>
          }
          title="Repeat previous workout"
          subtitle={
            recentWorkouts.length > 0
              ? 'Same exercises, fresh targets'
              : 'Available once you complete a workout'
          }
          onTap={() => setShowRepeatSheet(true)}
          disabled={recentWorkouts.length === 0}
        />
      </div>

      {/* Week stats: sets · sessions · volume status */}
      <Link
        href="/dashboard/volume"
        className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] text-surface-400">
            <span className="font-semibold text-surface-100">
              {volumeLoading ? '—' : volumeTiles.totalSets} sets
            </span>{' '}
            this week ·{' '}
            <span className="font-semibold text-surface-100">
              {isLoading
                ? '—'
                : activeMeso
                  ? `${sessionsThisWeek}/${activeMeso.days_per_week}`
                  : sessionsThisWeek}{' '}
              sessions
            </span>
          </span>
          {weekTime.avgMin !== null && (
            <span className="block text-[13px] text-surface-400 mt-0.5">
              <span className="font-medium text-surface-200">
                {formatHoursMinutes(weekTime.totalMin)}
              </span>{' '}
              trained ·{' '}
              <span className="font-medium text-surface-200">
                {Math.round(weekTime.avgMin)} min
              </span>{' '}
              avg workout
            </span>
          )}
          <span className={`block text-[13px] mt-0.5 ${volumeStatusLine.className}`}>
            {volumeStatusLine.text}
          </span>
        </span>
        <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Recovery: the same readiness body as the in-workout sheet / empty
          workout — good-targets strip, body map with the Recovery/Volume
          paint toggle, per-muscle volume bars + recovery badges. */}
      <TrainReadinessCard />

      {/* Cardio quick-log (moved here from the Progress page's Wellness
          tab). Self-contained: fetches and writes today's cardio_log. */}
      {userId && (
        <div className="rounded-2xl p-4 bg-surface-900 border border-surface-800">
          <h3 className="text-[15px] font-semibold text-surface-100 mb-3">Cardio</h3>
          <CardioTracker userId={userId} />
        </div>
      )}

      {/* Progression summary — deep-links to the Strength tab's
          per-muscle progression card, not just the top of Progress. */}
      <Link
        href="/dashboard/analytics?tab=strength&section=muscle-progression"
        className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors"
      >
        <span className="w-12 h-12 rounded-xl bg-surface-800 flex items-center justify-center flex-shrink-0">
          <IconTrendingUp size={22} className="text-surface-200" aria-hidden="true" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-surface-100">Progression</span>
          <span className="block text-[13px] text-surface-400 mt-0.5">
            {progressionSubtitle}
          </span>
        </span>
        <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </Link>

      {/* Recent workouts */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between px-1">
          <SectionLabel>Recent workouts</SectionLabel>
          <Link
            href="/dashboard/history"
            className="text-[13px] font-medium text-primary-400 hover:text-primary-300 transition-colors"
          >
            View all
          </Link>
        </div>
        {isLoading ? (
          <div className="p-4 rounded-2xl bg-surface-900 border border-surface-800 text-[13px] text-surface-500">
            Loading...
          </div>
        ) : recentWorkouts.length === 0 ? (
          <div className="p-4 rounded-2xl bg-surface-900 border border-surface-800 text-[13px] text-surface-500">
            No completed workouts yet — start one above.
          </div>
        ) : (
          <div className="space-y-2">
            {recentWorkouts.slice(0, 3).map((workout) => (
              <Link
                key={workout.id}
                href="/dashboard/history"
                className="flex items-center gap-3 p-4 rounded-2xl bg-surface-900 border border-surface-800 hover:bg-surface-800/70 transition-colors"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold text-surface-100 truncate">
                    {workout.title}
                  </span>
                  <span className="block text-[13px] text-surface-500 mt-0.5">
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
                  className="text-surface-500 flex-shrink-0"
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
            <p className="text-[13px] text-surface-400">
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
            <div className="rounded-xl border border-surface-800 bg-surface-950/40 p-3">
              <p className="text-[13px] text-surface-400">
                Exercises are planned when you start. Target muscles:{' '}
                <span className="text-surface-200">
                  {previewWorkout?.muscles.map(capitalize).join(', ') ?? '—'}
                </span>
              </p>
            </div>
          )}

          <p className="text-[11px] text-surface-500">
            Weights are suggested from your history once you start.
          </p>

          <div className="space-y-2">
            <button
              onClick={() => {
                setShowPreview(false);
                handleStartWorkout();
              }}
              disabled={isStarting}
              className={`w-full ${GRADIENT_CTA_CLASS}`}
            >
              {isStarting ? 'Starting...' : todayWorkout ? 'Start workout' : 'Train anyway today'}
            </button>
            <Link
              href="/dashboard/mesocycle/plan"
              onClick={() => setShowPreview(false)}
              className="block w-full py-2 rounded-lg text-center text-[13px] font-medium text-primary-400 hover:text-primary-300 transition-colors"
            >
              See the whole plan
            </Link>
            <button
              onClick={() => setShowPreview(false)}
              className="w-full py-2 rounded-lg text-[13px] text-surface-400 hover:text-surface-200 transition-colors"
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
      <BottomSheet
        isOpen={showRepeatSheet}
        onClose={() => {
          if (!repeatingId) setShowRepeatSheet(false);
        }}
        title="Repeat a workout"
      >
        <div className="space-y-3">
          <p className="text-[13px] text-surface-400">
            Same exercises as a previous session — targets and weights are
            re-estimated from your recent performance.
          </p>
          <div className="rounded-xl border border-surface-800 bg-surface-950/40 overflow-hidden">
            {recentWorkouts.map((workout) => (
              <button
                key={workout.id}
                onClick={() => handleRepeatWorkout(workout)}
                disabled={repeatingId !== null}
                className="w-full flex items-center gap-2 px-3 py-2.5 border-b border-surface-800/50 last:border-b-0 text-left hover:bg-surface-800/50 transition-colors disabled:opacity-60"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-surface-200 truncate">
                    {workout.title}
                  </span>
                  <span className="block text-[11px] text-surface-500 mt-0.5">
                    {workout.completedAt.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {' · '}
                    {workout.exercises.length}{' '}
                    {workout.exercises.length === 1 ? 'exercise' : 'exercises'}
                    {' · '}
                    {workout.setCount} {workout.setCount === 1 ? 'set' : 'sets'}
                  </span>
                </span>
                {repeatingId === workout.id ? (
                  <IconLoader2
                    size={16}
                    className="text-primary-400 animate-spin flex-shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <IconChevronRight
                    size={16}
                    className="text-surface-500 flex-shrink-0"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
            {recentWorkouts.length === 0 && (
              <p className="p-4 text-center text-xs text-surface-500">
                No completed workouts yet.
              </p>
            )}
          </div>
          <button
            onClick={() => setShowRepeatSheet(false)}
            disabled={repeatingId !== null}
            className="w-full py-2 rounded-lg text-[13px] text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>

      {/* Discard confirmation for the unfinished-workout banner's X */}
      {showDiscardConfirm && inProgress && (
        <Modal isOpen onClose={() => setShowDiscardConfirm(false)} title="Discard workout?">
          <div className="space-y-4">
            <p className="text-[13px] text-surface-400">
              {inProgress.setsDone > 0
                ? `This will delete the ${inProgress.setsDone} ${
                    inProgress.setsDone === 1 ? 'set' : 'sets'
                  } you logged. `
                : ''}
              {inProgress.mesocycleId
                ? 'The planned workout stays on your schedule so you can restart it fresh.'
                : 'This removes the workout session entirely.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDiscardConfirm(false)}
                disabled={isDiscarding}
                className="flex-1 py-2.5 rounded-lg bg-surface-800 text-surface-200 text-[13px] font-medium hover:bg-surface-700 transition-colors disabled:opacity-60"
              >
                Keep workout
              </button>
              <button
                onClick={handleDiscardWorkout}
                disabled={isDiscarding}
                className="flex-1 py-2.5 rounded-lg bg-danger-500 text-white text-[13px] font-medium hover:bg-danger-600 transition-colors disabled:opacity-60"
              >
                {isDiscarding ? 'Discarding...' : 'Discard'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
