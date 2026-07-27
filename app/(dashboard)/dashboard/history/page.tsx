'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useQuery, useQueryClient, useIsRestoring } from '@tanstack/react-query';
import { Card, Badge, Button, FullPageLoading, LoadingAnimation, ConfirmModal } from '@/components/ui';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';

// Completed workout history is immutable-in-practice: cache the first page
// long and persist it so returning to History renders instantly instead of
// re-blocking on the full-screen loader. Edits/deletes write through the cache.
// v2: evicts entries poisoned by the old queryFn, which cached an EMPTY page
// for 24h whenever the network getUser() round trip failed on a cold reload.
const HISTORY_FIRST_PAGE_KEY = ['history', 'sessions', 'page0', 'v2'] as const;
import { formatWeight, convertWeight, convertWeightForDisplay, inputWeightToKg, getLocalDateString, muscleDisplayName } from '@/lib/utils';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';
import { createRepeatSession } from '@/lib/training/repeatWorkout';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import HistoryCalendar from './_components/HistoryCalendar';
import nextDynamic from 'next/dynamic';

// P1-2 (perf): keep recharts (~100KB) out of history's first-load — the chart
// only renders inside the exercise-detail modal.
const E1RMProgressChart = nextDynamic(() => import('./_components/E1RMProgressChart'), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-sm text-surface-500">Loading chart…</div>,
});

interface SetDetail {
  id: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
}

interface ExerciseDetail {
  id: string;
  exerciseId: string;
  name: string;
  primaryMuscle: string;
  /** Duration exercise — each set's reps field carries seconds */
  isDuration?: boolean;
  sets: SetDetail[];
}

interface WorkoutHistory {
  id: string;
  planned_date: string;
  completed_at: string | null;
  state: string;
  session_rpe: number | null;
  session_notes: string | null;
  pump_rating: number | null;
  is_deload: boolean;
  exercises: ExerciseDetail[];
  totalSets: number;
  totalVolume: number;
}

/** Nested session rows -> WorkoutHistory cards (shared by list + calendar-day fetches). */
function transformSessions(data: any[]): WorkoutHistory[] {
  return data.map((workout: any) => {
    const exercises: ExerciseDetail[] = (workout.exercise_blocks || [])
      .sort((a: any, b: any) => a.order - b.order)
      .filter((block: any) => block.exercises)
      .map((block: any) => {
        const workingSets = (block.set_logs || [])
          .filter((set: any) => !set.is_warmup)
          .sort((a: any, b: any) => a.set_number - b.set_number);

        return {
          id: block.id,
          exerciseId: block.exercise_id,
          name: block.exercises.name,
          primaryMuscle: block.exercises.primary_muscle,
          isDuration: block.exercises.exercise_type === 'duration_based',
          sets: workingSets.map((set: any) => ({
            id: set.id,
            weight_kg: set.weight_kg,
            reps: set.reps,
            rpe: set.rpe,
          })),
        };
      });

    const totalSets = exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
    // Duration sets store seconds in reps — excluded from tonnage.
    const totalVolume = exercises.reduce(
      (sum, ex) =>
        sum +
        (ex.isDuration
          ? 0
          : ex.sets.reduce((setSum, set) => setSum + set.weight_kg * set.reps, 0)),
      0
    );

    return {
      id: workout.id,
      planned_date: workout.planned_date,
      completed_at: workout.completed_at,
      state: workout.state,
      session_rpe: workout.session_rpe,
      session_notes: workout.session_notes,
      pump_rating: workout.pump_rating,
      is_deload: workout.is_deload ?? false,
      exercises,
      totalSets,
      totalVolume,
    };
  });
}

interface ExerciseHistoryEntry {
  date: string;
  displayDate: string;
  bestWeight: number;
  bestReps: number;
  totalSets: number;
  totalVolume: number;
  /** Best single-set e1RM (kg); 0 = no valid estimate (e.g. all sets >15 effective reps). */
  estimatedE1RM: number;
  /** Every session on this date was a deload — shown in history, excluded from trend/PRs. */
  isDeload: boolean;
  sets: { weight: number; reps: number; rpe: number | null }[];
}

interface ExerciseHistoryData {
  exerciseId: string;
  exerciseName: string;
  primaryMuscle: string;
  /** Duration exercise: e1RM fields stay 0; bestReps values carry seconds */
  isDuration: boolean;
  history: ExerciseHistoryEntry[];
  currentE1RM: number;
  allTimeMaxE1RM: number;
  allTimeBestWeight: number;
  allTimeBestReps: number;
  totalSetsAllTime: number;
  progressPercent: number;
}

// Parse a YYYY-MM-DD key as a LOCAL date. new Date('YYYY-MM-DD') parses as
// UTC midnight, which renders as the previous day in timezones west of UTC.
function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const exerciseIdParam = searchParams.get('exercise');

  const queryClient = useQueryClient();

  // Cached first page — the source that makes a revisit instant. The queryFn
  // forward-references SESSION_SELECT/PAGE_SIZE (defined below); it only runs
  // async, after those consts are initialized.
  const firstPageQuery = useQuery({
    queryKey: HISTORY_FIRST_PAGE_KEY,
    queryFn: async () => {
      const supabase = createUntypedClient();
      // Local-session identity (no auth round trip): a transient getUser()
      // failure must not be cached as "no workouts". See lib/supabase/authState.
      const userId = await getLocalUserId(supabase);
      if (!userId) return [] as WorkoutHistory[];
      const { data, error } = await supabase
        .from('workout_sessions')
        .select(SESSION_SELECT)
        .eq('user_id', userId)
        .in('state', ['completed', 'in_progress'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .range(0, PAGE_SIZE - 1);
      // A failed fetch is an error to retry, NOT an empty history to cache.
      if (error) throw error;
      return data ? transformSessions(data) : [];
    },
    // Cached-first paint, but ALWAYS revalidate shortly: past sessions are
    // immutable, the newest edge is not — finishing a workout adds a row this
    // page must show. Completion also invalidates ['history'] explicitly
    // (lib/query/workoutInvalidation), but that hook can be missed (app
    // killed before the outbox flushed), so a long staleTime here would pin
    // the pre-workout snapshot for up to 24h — exactly the "today's workout
    // is in the calendar but not the list" bug.
    staleTime: 30 * 1000,
    gcTime: IMMUTABLE_GC_TIME,
  });
  const isRestoring = useIsRestoring();

  const [workouts, setWorkouts] = useState<WorkoutHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Calendar view + filters (P1-6)
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [monthDots, setMonthDots] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayWorkouts, setDayWorkouts] = useState<WorkoutHistory[] | null>(null);
  const [exerciseFilter, setExerciseFilter] = useState<string | null>(null);

  // Dot markers: one lightweight query per visible month (completed_at only).
  useEffect(() => {
    if (viewMode !== 'calendar') return;
    let cancelled = false;
    (async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const start = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
      const end = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
      const { data } = await supabase
        .from('workout_sessions')
        .select('completed_at')
        .eq('user_id', user.id)
        .eq('state', 'completed')
        .gte('completed_at', start.toISOString())
        .lt('completed_at', end.toISOString());
      if (!cancelled) {
        setMonthDots(
          new Set(((data ?? []) as { completed_at: string }[]).map(r => getLocalDateString(new Date(r.completed_at))))
        );
      }
    })();
    return () => { cancelled = true; };
  }, [viewMode, calMonth]);

  // Selecting a day fetches that day's sessions (they may be outside the
  // paginated list) using the same nested select + transform as the list.
  useEffect(() => {
    if (!selectedDay) { setDayWorkouts(null); return; }
    let cancelled = false;
    (async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const dayStart = new Date(`${selectedDay}T00:00:00`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const { data } = await supabase
        .from('workout_sessions')
        .select(SESSION_SELECT)
        .eq('user_id', user.id)
        .eq('state', 'completed')
        .gte('completed_at', dayStart.toISOString())
        .lt('completed_at', dayEnd.toISOString())
        .order('completed_at', { ascending: false });
      if (!cancelled) setDayWorkouts(transformSessions(data ?? []));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  // What the cards section shows: day selection replaces the paginated list;
  // the exercise chip filters either source client-side.
  // Fall back to the cached first page until the seed effect copies it into
  // `workouts`, so a revisit paints the list on the first frame (no flash).
  const listWorkouts = workouts.length ? workouts : (firstPageQuery.data ?? []);
  const baseWorkouts = selectedDay && viewMode === 'calendar' ? (dayWorkouts ?? []) : listWorkouts;
  const displayedWorkouts = exerciseFilter
    ? baseWorkouts.filter(w => w.exercises.some(ex => ex.name === exerciseFilter))
    : baseWorkouts;
  const exerciseChips = Array.from(
    new Set(workouts.flatMap(w => w.exercises.map(ex => ex.name)))
  ).sort().slice(0, 12);

  // Inline past-set editing (P1-3)
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [savingSetEdit, setSavingSetEdit] = useState(false);

  const startSetEdit = (set: SetDetail) => {
    setEditingSetId(set.id);
    setEditWeight(String(convertWeightForDisplay(set.weight_kg, unit)));
    setEditReps(String(set.reps));
  };

  const saveSetEdit = async (workoutId: string, exerciseBlockId: string, setId: string) => {
    const weightNum = parseFloat(editWeight);
    const repsNum = parseInt(editReps, 10);
    // 600 matches the DB CHECK on set_logs.reps (duration sets store seconds,
    // capped at 600) — the old 999 ceiling allowed values Postgres rejects.
    if (isNaN(weightNum) || weightNum < 0 || isNaN(repsNum) || repsNum < 1 || repsNum > 600) return;

    setSavingSetEdit(true);
    try {
      const weightKg = inputWeightToKg(weightNum, unit);
      const supabase = createUntypedClient();
      const { error } = await supabase
        .from('set_logs')
        .update({ weight_kg: weightKg, reps: repsNum })
        .eq('id', setId);
      if (error) {
        console.error('Failed to update set:', error);
        return;
      }

      // P1-3 detection A: stamp edited_at (best-effort). Separate from the
      // essential update above so editing never breaks — dormant until the
      // set_logs.edited_at migration is applied; an unknown-column error just
      // returns { error } which we ignore.
      await supabase
        .from('set_logs')
        .update({ edited_at: new Date().toISOString() })
        .eq('id', setId)
        .then(({ error: stampErr }: { error: unknown }) => {
          if (stampErr) console.debug('edited_at stamp skipped (migration not applied?)');
        });

      // Update local card state + recompute the workout's volume total.
      // (E1RM, PRs, weekly volume, and future suggestions all derive from
      // set_logs at read time — no stored aggregates to fix up.)
      mutateWorkouts(prev =>
        prev.map(w => {
          if (w.id !== workoutId) return w;
          const exercises = w.exercises.map(ex =>
            ex.id !== exerciseBlockId
              ? ex
              : { ...ex, sets: ex.sets.map(s => (s.id === setId ? { ...s, weight_kg: weightKg, reps: repsNum } : s)) }
          );
          const totalVolume = exercises.reduce(
            (sum, ex) =>
              sum +
              (ex.isDuration ? 0 : ex.sets.reduce((s2, s) => s2 + s.weight_kg * s.reps, 0)),
            0
          );
          return { ...w, exercises, totalVolume };
        })
      );
      setEditingSetId(null);
    } finally {
      setSavingSetEdit(false);
    }
  };
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Styled confirmation for destructive actions (P2-7 — replaces native
  // confirm()/alert(), which render inconsistently and block the thread)
  const [confirmDelete, setConfirmDelete] = useState<
    null | { kind: 'bulk' } | { kind: 'single'; workoutId: string; state: string }
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [togglingDeloadId, setTogglingDeloadId] = useState<string | null>(null);
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<ExerciseHistoryData | null>(null);
  const [loadingExercise, setLoadingExercise] = useState(false);
  const [autoFetchedExercise, setAutoFetchedExercise] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedWorkouts, setSelectedWorkouts] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const { preferences } = useUserPreferences();
  const unit = preferences.units;

  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    if (isSelectMode) {
      setSelectedWorkouts(new Set());
    }
  };

  const toggleWorkoutSelection = (workoutId: string) => {
    setSelectedWorkouts(prev => {
      const next = new Set(prev);
      if (next.has(workoutId)) {
        next.delete(workoutId);
      } else {
        next.add(workoutId);
      }
      return next;
    });
  };

  const selectAllWorkouts = () => {
    if (selectedWorkouts.size === workouts.length) {
      setSelectedWorkouts(new Set());
    } else {
      setSelectedWorkouts(new Set(workouts.map(w => w.id)));
    }
  };

  // Runs AFTER the ConfirmModal confirm — no native confirm() here.
  const handleBulkDelete = async () => {
    if (selectedWorkouts.size === 0) return;

    setIsBulkDeleting(true);
    try {
      const supabase = createUntypedClient();
      const workoutIds = Array.from(selectedWorkouts);

      // Get all exercise blocks for these workouts
      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select('id')
        .in('workout_session_id', workoutIds);

      if (blocks && blocks.length > 0) {
        const blockIds = blocks.map((b: { id: string }) => b.id);
        // Delete set_logs for all blocks
        await supabase.from('set_logs').delete().in('exercise_block_id', blockIds);
      }

      // Delete all exercise_blocks
      await supabase.from('exercise_blocks').delete().in('workout_session_id', workoutIds);

      // Delete all workout_sessions
      await supabase.from('workout_sessions').delete().in('id', workoutIds);

      // Update local state
      mutateWorkouts(prev => prev.filter(w => !selectedWorkouts.has(w.id)));
      setSelectedWorkouts(new Set());
      setIsSelectMode(false);
    } catch (err) {
      console.error('Failed to delete workouts:', err);
      setActionError('Failed to delete workouts. Please try again.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Runs AFTER the ConfirmModal confirm — no native confirm() here.
  const handleDeleteWorkout = async (workoutId: string) => {
    setDeletingId(workoutId);
    try {
      const supabase = createUntypedClient();
      
      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select('id')
        .eq('workout_session_id', workoutId);
      
      if (blocks && blocks.length > 0) {
        const blockIds = blocks.map((b: { id: string }) => b.id);
        await supabase.from('set_logs').delete().in('exercise_block_id', blockIds);
      }
      
      await supabase.from('exercise_blocks').delete().eq('workout_session_id', workoutId);
      await supabase.from('workout_sessions').delete().eq('id', workoutId);
      
      mutateWorkouts(prev => prev.filter(w => w.id !== workoutId));
    } catch (err) {
      console.error('Failed to delete workout:', err);
      setActionError('Failed to delete workout. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  // Retroactively flag / unflag a past workout as a deload. Persists the
  // session flag and mirrors it onto that day's performance snapshots so the
  // e1RM-trend reads (which read snapshots) exclude it too — this is what
  // removes a false "regression" a light week would otherwise show.
  const handleToggleDeload = async (workout: WorkoutHistory) => {
    const next = !workout.is_deload;
    setTogglingDeloadId(workout.id);
    // Optimistic — the badge/label flips immediately.
    mutateWorkouts(prev =>
      prev.map(w => (w.id === workout.id ? { ...w, is_deload: next } : w))
    );
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('workout_sessions')
        .update({ is_deload: next })
        .eq('id', workout.id);
      if (error) throw error;

      // Keep derived snapshots in step (keyed by user + local session day).
      const snapshotDate = workout.completed_at
        ? getLocalDateString(new Date(workout.completed_at))
        : workout.planned_date;
      if (user && snapshotDate) {
        await supabase
          .from('exercise_performance_snapshots')
          .update({ is_deload: next })
          .eq('user_id', user.id)
          .eq('session_date', snapshotDate);
      }
    } catch (err) {
      console.error('Failed to update deload flag:', err);
      setActionError('Failed to update deload flag. Please try again.');
      // Roll back the optimistic flip.
      mutateWorkouts(prev =>
        prev.map(w => (w.id === workout.id ? { ...w, is_deload: !next } : w))
      );
    } finally {
      setTogglingDeloadId(null);
    }
  };

  const handleRepeatWorkout = async (workout: WorkoutHistory) => {
    if (workout.exercises.length === 0) {
      setActionError('This workout has no exercises to repeat.');
      return;
    }

    setRepeatingId(workout.id);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setActionError('You must be logged in to repeat a workout.');
        return;
      }

      // Shared clone path (also used by the Train tab's repeat launcher):
      // copies the exercise list, re-estimates weights from previous E1RMs.
      const { sessionId } = await createRepeatSession(
        supabase,
        user.id,
        workout.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          sets: exercise.sets.map((set) => ({ weight_kg: set.weight_kg, reps: set.reps })),
        }))
      );

      // Navigate to the new workout
      router.push(`/dashboard/workout/${sessionId}`);
    } catch (err) {
      console.error('Failed to repeat workout:', err);
      alert('Failed to repeat workout. Please try again.');
    } finally {
      setRepeatingId(null);
    }
  };

  const fetchExerciseHistory = async (
    exerciseId: string,
    exerciseName: string,
    primaryMuscle: string,
    isDuration = false
  ) => {
    setLoadingExercise(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      // Fetch all exercise blocks for this exercise
      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          workout_session_id,
          workout_sessions!inner (
            id,
            completed_at,
            state,
            user_id,
            is_deload
          ),
          set_logs (
            id,
            weight_kg,
            reps,
            rpe,
            is_warmup,
            logged_at
          )
        `)
        .eq('exercise_id', exerciseId)
        .eq('workout_sessions.user_id', user.id)
        .eq('workout_sessions.state', 'completed')
        // Deload sessions ARE fetched: hiding them entirely made recent
        // (deload-flagged) workouts vanish from the modal. They're tagged per
        // entry below and excluded from PRs/trend, matching the exercise
        // detail sheet (services/exerciseDetailAnalytics.ts).
        .order('workout_sessions(completed_at)', { ascending: true });

      if (!blocks || blocks.length === 0) {
        setSelectedExercise({
          exerciseId,
          exerciseName,
          primaryMuscle,
          isDuration,
          history: [],
          currentE1RM: 0,
          allTimeMaxE1RM: 0,
          allTimeBestWeight: 0,
          allTimeBestReps: 0,
          totalSetsAllTime: 0,
          progressPercent: 0,
        });
        return;
      }

      // Process history by date
      const historyMap = new Map<string, ExerciseHistoryEntry>();
      let allTimeMaxE1RM = 0;
      let allTimeBestWeight = 0;
      let allTimeBestReps = 0;
      let totalSetsAllTime = 0;

      blocks.forEach((block: any) => {
        const session = block.workout_sessions;
        if (!session?.completed_at) return;

        // Deload sessions are held light on purpose — they stay visible in
        // the history list/chart but never set PRs or anchor the trend.
        const sessionIsDeload = session.is_deload === true;

        // Group by LOCAL calendar day — completed_at is a UTC timestamp, so
        // splitting on 'T' would bucket evening workouts into the next day.
        const dateKey = getLocalDateString(new Date(session.completed_at));
        const workingSets = (block.set_logs || []).filter((s: any) => !s.is_warmup);

        if (workingSets.length === 0) return;

        // Calculate stats for this session
        let sessionBestWeight = 0;
        let sessionBestReps = 0;
        let sessionBestE1RM = 0;
        let sessionVolume = 0;
        const sets: { weight: number; reps: number; rpe: number | null }[] = [];

        workingSets.forEach((set: any) => {
          sets.push({ weight: set.weight_kg, reps: set.reps, rpe: set.rpe });

          if (isDuration) {
            // Duration exercise: reps carry seconds. No e1RM, no tonnage —
            // the session best is the longest hold (heaviest load tiebreak).
            if (
              set.reps > sessionBestReps ||
              (set.reps === sessionBestReps && set.weight_kg > sessionBestWeight)
            ) {
              sessionBestReps = set.reps;
              sessionBestWeight = set.weight_kg;
            }
            if (!sessionIsDeload) {
              if (set.weight_kg > allTimeBestWeight) {
                allTimeBestWeight = set.weight_kg;
              }
              if (set.reps > allTimeBestReps && set.weight_kg >= allTimeBestWeight * 0.8) {
                allTimeBestReps = set.reps;
              }
            }
            return;
          }

          // Canonical RPE-aware estimator (same as the snapshot writer and
          // exercise detail sheet). 0 = no valid estimate — sets beyond the
          // formula's domain (>15 effective reps) never produce a number.
          const e1rm = e1rmValueFromRpe(set.weight_kg, set.reps, set.rpe);
          sessionVolume += set.weight_kg * set.reps;

          if (e1rm > sessionBestE1RM) {
            sessionBestE1RM = e1rm;
            sessionBestWeight = set.weight_kg;
            sessionBestReps = set.reps;
          }

          if (!sessionIsDeload) {
            if (e1rm > allTimeMaxE1RM) {
              allTimeMaxE1RM = e1rm;
            }
            if (set.weight_kg > allTimeBestWeight) {
              allTimeBestWeight = set.weight_kg;
            }
            if (set.reps > allTimeBestReps && set.weight_kg >= allTimeBestWeight * 0.8) {
              allTimeBestReps = set.reps;
            }
          }
        });

        totalSetsAllTime += workingSets.length;

        // Merge with existing entry for same date or create new
        if (historyMap.has(dateKey)) {
          const existing = historyMap.get(dateKey)!;
          if (isDuration ? sessionBestReps > existing.bestReps : sessionBestE1RM > existing.estimatedE1RM) {
            existing.estimatedE1RM = sessionBestE1RM;
            existing.bestWeight = sessionBestWeight;
            existing.bestReps = sessionBestReps;
          }
          existing.totalSets += workingSets.length;
          existing.totalVolume += sessionVolume;
          existing.sets.push(...sets);
          // A day only counts as a deload if every session on it was one.
          existing.isDeload = existing.isDeload && sessionIsDeload;
        } else {
          historyMap.set(dateKey, {
            date: dateKey,
            displayDate: parseDateKey(dateKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            bestWeight: sessionBestWeight,
            bestReps: sessionBestReps,
            totalSets: workingSets.length,
            totalVolume: sessionVolume,
            estimatedE1RM: sessionBestE1RM,
            isDeload: sessionIsDeload,
            sets,
          });
        }
      });

      const history = Array.from(historyMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      // Calculate progress. Duration exercises track longest hold, not e1RM.
      // Anchors skip deload days (held light on purpose) AND days with no
      // valid estimate (estimatedE1RM 0 must never read as a 0-lb lift).
      const e1rmDays = history.filter((h) => !h.isDeload && h.estimatedE1RM > 0);
      const holdDays = history.filter((h) => !h.isDeload && h.bestReps > 0);
      const currentE1RM = e1rmDays.length > 0 ? e1rmDays[e1rmDays.length - 1].estimatedE1RM : 0;
      const firstE1RM = e1rmDays.length > 0 ? e1rmDays[0].estimatedE1RM : 0;
      const currentHold = holdDays.length > 0 ? holdDays[holdDays.length - 1].bestReps : 0;
      const firstHold = holdDays.length > 0 ? holdDays[0].bestReps : 0;
      const progressPercent = isDuration
        ? firstHold > 0
          ? ((currentHold - firstHold) / firstHold) * 100
          : 0
        : firstE1RM > 0
          ? ((currentE1RM - firstE1RM) / firstE1RM) * 100
          : 0;

      setSelectedExercise({
        exerciseId,
        exerciseName,
        primaryMuscle,
        isDuration,
        history,
        currentE1RM,
        allTimeMaxE1RM,
        allTimeBestWeight,
        allTimeBestReps,
        totalSetsAllTime,
        progressPercent,
      });
    } catch (err) {
      console.error('Failed to fetch exercise history:', err);
    } finally {
      setLoadingExercise(false);
    }
  };

  // P1-2 (perf): history is paginated — PAGE_SIZE sessions per fetch instead
  // of every session the user has ever logged. Older pages load on demand.
  const PAGE_SIZE = 20;

  // Shared nested select for session cards (list pages + calendar day fetch)
  const SESSION_SELECT = `
          id,
          planned_date,
          completed_at,
          state,
          session_rpe,
          session_notes,
          pump_rating,
          is_deload,
          exercise_blocks (
            id,
            order,
            exercise_id,
            exercises (
              id,
              name,
              primary_muscle,
              exercise_type
            ),
            set_logs (
              id,
              set_number,
              weight_kg,
              reps,
              rpe,
              is_warmup
            )
          )
        `;

  const fetchHistoryPage = async (pageIndex: number) => {
      const supabase = createUntypedClient();
      // Local-session identity: the old network getUser() here rendered the
      // "No workout history yet" empty state on any transient auth blip.
      const userId = await getLocalUserId(supabase);

      if (!userId) {
        setIsLoading(false);
        return;
      }

      const { data } = await supabase
        .from('workout_sessions')
        .select(SESSION_SELECT)
        .eq('user_id', userId)
        .in('state', ['completed', 'in_progress'])
        .order('completed_at', { ascending: false, nullsFirst: false })
        .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1);

      if (data) {
        const transformed = transformSessions(data);
        setWorkouts(prev => (pageIndex === 0 ? transformed : [...prev, ...transformed]));
        setHasMore(transformed.length === PAGE_SIZE);
      } else {
        setHasMore(false);
      }

      setIsLoading(false);
      setIsLoadingMore(false);
  };

  // Sync the accumulated list from the first-page query. On a revisit the
  // cache is warm, so the initial seed runs on the first render and there is
  // no full-screen loader. Unlike the old seed-once guard, a background
  // refetch (staleTime elapsed, or ['history'] invalidated by a finished
  // workout) also lands here — otherwise a workout completed since the page
  // was cached stayed invisible in the list until a full remount, even
  // though the calendar (which fetches fresh) already showed it. Fresh data
  // replaces the first page; sessions loaded via pagination that fell
  // outside it are kept (they're older, so they sort after it).
  const seededDataRef = useRef<WorkoutHistory[] | null>(null);
  useEffect(() => {
    const data = firstPageQuery.data;
    // Reference equality also skips echoes of our own mutateWorkouts writes.
    if (!data || seededDataRef.current === data) return;
    const isFirstSeed = seededDataRef.current === null;
    seededDataRef.current = data;
    setWorkouts((prev) => {
      if (isFirstSeed || prev.length === 0) return data;
      const freshIds = new Set(data.map((w) => w.id));
      return [...data, ...prev.filter((w) => !freshIds.has(w.id))];
    });
    if (isFirstSeed) setHasMore(data.length === PAGE_SIZE);
    setIsLoading(false);
  }, [firstPageQuery.data]);

  // Update the visible list AND the persisted first-page cache together, so a
  // delete/edit survives a revisit without a refetch.
  const mutateWorkouts = useCallback(
    (updater: (prev: WorkoutHistory[]) => WorkoutHistory[]) => {
      setWorkouts(updater);
      queryClient.setQueryData<WorkoutHistory[]>(HISTORY_FIRST_PAGE_KEY, (prev) =>
        prev ? updater(prev) : prev
      );
    },
    [queryClient]
  );

  const handleLoadMore = () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    void fetchHistoryPage(nextPage);
  };

  // Auto-fetch exercise from query parameter (from analytics page)
  useEffect(() => {
    async function autoFetchExercise() {
      if (!exerciseIdParam || autoFetchedExercise || isLoading) return;
      
      setAutoFetchedExercise(true);
      
      try {
        const supabase = createUntypedClient();
        
        // Get exercise details
        const { data: exercise } = await supabase
          .from('exercises')
          .select('id, name, primary_muscle, exercise_type')
          .eq('id', exerciseIdParam)
          .single();

        if (exercise) {
          fetchExerciseHistory(
            exercise.id,
            exercise.name,
            exercise.primary_muscle,
            exercise.exercise_type === 'duration_based'
          );
        }
      } catch (err) {
        console.error('Failed to auto-fetch exercise:', err);
      }
    }
    
    autoFetchExercise();
  }, [exerciseIdParam, autoFetchedExercise, isLoading]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const toggleExpand = (workoutId: string) => {
    setExpandedWorkout(expandedWorkout === workoutId ? null : workoutId);
  };

  // Exercise History Modal
  const ExerciseHistoryModal = () => {
    if (!selectedExercise) return null;

    // Duration exercises plot longest hold (seconds) per session — their e1RM
    // is deliberately never computed.
    const isDuration = selectedExercise.isDuration;
    // Days with no plottable value (no valid e1RM estimate) are dropped — a
    // missing estimate must render as absent, never as a point at 0. Deload
    // days plot as muted dots outside the trend line.
    const chartData = selectedExercise.history
      .filter(h => (isDuration ? h.bestReps > 0 : h.estimatedE1RM > 0))
      .map(h => {
        const value = isDuration ? h.bestReps : Math.round(convertWeight(h.estimatedE1RM, 'kg', unit));
        return {
          date: h.displayDate,
          e1rm: h.isDeload ? null : value,
          deloadE1rm: h.isDeload ? value : null,
        };
      });
    const hasDeloadPoints = chartData.some(p => p.deloadE1rm !== null);
    // Latest non-deload hold for the duration stat card.
    const lastHoldEntry = [...selectedExercise.history].reverse()
      .find(h => !h.isDeload && h.bestReps > 0);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div className="bg-surface-900 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl border border-surface-700">
          {/* Modal header */}
          <div className="p-4 border-b border-surface-800 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-surface-100">{selectedExercise.exerciseName}</h2>
              <p className="text-sm text-surface-400">{muscleDisplayName(selectedExercise.primaryMuscle)}</p>
            </div>
            <button
              onClick={() => setSelectedExercise(null)}
              className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Modal content */}
          <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
            {loadingExercise ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
              </div>
            ) : selectedExercise.history.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-surface-400">No history found for this exercise</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Stats cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {isDuration ? (
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">Last Best Hold</p>
                      <p className="text-xl font-bold text-primary-400">
                        {lastHoldEntry?.bestReps ?? 0}s
                      </p>
                    </div>
                  ) : (
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">Current E1RM</p>
                      <p className="text-xl font-bold text-primary-400">
                        {formatWeight(selectedExercise.currentE1RM, unit)}
                      </p>
                    </div>
                  )}
                  {isDuration ? (
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">Longest Hold</p>
                      <p className="text-xl font-bold text-success-400">
                        {selectedExercise.allTimeBestReps}s
                      </p>
                    </div>
                  ) : (
                    <div className="bg-surface-800 rounded-lg p-3 text-center">
                      <p className="text-xs text-surface-500 uppercase">All-Time Best</p>
                      <p className="text-xl font-bold text-success-400">
                        {formatWeight(selectedExercise.allTimeMaxE1RM, unit)}
                      </p>
                    </div>
                  )}
                  <div className="bg-surface-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">{isDuration ? 'Top Weight' : 'Best Lift'}</p>
                    <p className="text-xl font-bold text-surface-200">
                      {formatWeight(selectedExercise.allTimeBestWeight, unit)}
                    </p>
                    <p className="text-xs text-surface-500">
                      {isDuration
                        ? `× ${selectedExercise.allTimeBestReps}s`
                        : `× ${selectedExercise.allTimeBestReps} reps`}
                    </p>
                  </div>
                  <div className="bg-surface-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">Progress</p>
                    <p className={`text-xl font-bold ${selectedExercise.progressPercent >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
                      {selectedExercise.progressPercent >= 0 ? '+' : ''}{selectedExercise.progressPercent.toFixed(1)}%
                    </p>
                    <p className="text-xs text-surface-500">{selectedExercise.totalSetsAllTime} total sets</p>
                  </div>
                </div>

                {/* Progress chart (recharts loads on demand — P1-2) */}
                {chartData.length > 1 && (
                  <div className="bg-surface-800 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-surface-300 mb-4">
                      {isDuration ? 'Hold Time Progress' : 'Estimated 1RM Progress'}
                    </h3>
                    <div className="h-48">
                      <E1RMProgressChart
                        chartData={chartData}
                        unit={isDuration ? 's' : unit}
                        prLine={
                          isDuration
                            ? selectedExercise.allTimeBestReps
                            : Math.round(convertWeight(selectedExercise.allTimeMaxE1RM, 'kg', unit))
                        }
                        seriesLabel={isDuration ? 'Longest Hold' : 'Est. 1RM'}
                      />
                    </div>
                    {hasDeloadPoints && (
                      <p className="text-[11px] text-surface-500 mt-1.5 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-surface-500 inline-block" />
                        Deload sessions shown as gray dots, excluded from the trend
                      </p>
                    )}
                  </div>
                )}

                {/* History list */}
                <div>
                  <h3 className="text-sm font-semibold text-surface-300 mb-3">Workout History</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {[...selectedExercise.history].reverse().map((entry, idx) => (
                      <div key={idx} className="bg-surface-800/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-surface-200">
                            {parseDateKey(entry.date).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {entry.isDeload && (
                              <Badge variant="outline" size="sm">Deload</Badge>
                            )}
                            {isDuration ? (
                              <Badge variant="info" size="sm">Best hold: {entry.bestReps}s</Badge>
                            ) : entry.estimatedE1RM > 0 ? (
                              <Badge variant="info" size="sm">E1RM: {formatWeight(entry.estimatedE1RM, unit)}</Badge>
                            ) : (
                              // High-rep day (>15 effective reps): no formula
                              // gives a valid 1RM estimate — never show 0.
                              <Badge variant="default" size="sm">No e1RM estimate</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {entry.sets.map((set, setIdx) => (
                            <span 
                              key={setIdx}
                              className="px-2 py-1 bg-surface-700 rounded text-xs text-surface-300"
                            >
                              {isDuration
                                ? `${set.reps}s @ ${formatWeight(set.weight, unit)}`
                                : `${formatWeight(set.weight, unit)} × ${set.reps}`}
                              {set.rpe && <span className="text-surface-500"> @{set.rpe}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // First-page fetch failed with nothing cached to fall back on: show a retry
  // state. Without this, the queryFn's throw (correct — a failed fetch must
  // not be cached as an empty history) would leave the loader below up forever,
  // since the seed effect only clears isLoading when data arrives.
  if (firstPageQuery.isError && !firstPageQuery.data && workouts.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
          <p className="text-surface-400 mt-1">Your past training sessions</p>
        </div>
        <Card className="text-center py-12" data-testid="history-load-error">
          <p className="text-surface-300 font-medium">Couldn&apos;t load your workout history</p>
          <p className="text-surface-500 text-sm mt-2">Check your connection and try again.</p>
          <Button className="mt-6" onClick={() => firstPageQuery.refetch()}>
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  // Full-screen loader only on first-ever load with an empty cache. A revisit
  // (warm in-memory cache) or reload (IndexedDB restore) has first-page data
  // available immediately, so it renders the list instead of blocking.
  if (isLoading && !firstPageQuery.data && !isRestoring) {
    return (
      <div className="space-y-6" data-testid="history-full-loading">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
          <p className="text-surface-400 mt-1">Your past training sessions</p>
        </div>
        <Card className="text-center py-12">
          <LoadingAnimation type="random" size="md" />
          <p className="text-surface-400 mt-4">Loading your workout history...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
          <p className="text-surface-400 mt-1">Your past training sessions</p>
        </div>
        {workouts.length > 0 && (
          <div className="flex items-center gap-2">
            {isSelectMode && (
              <>
                <button
                  onClick={selectAllWorkouts}
                  className="px-3 py-1.5 text-sm text-surface-300 hover:text-surface-100 hover:bg-surface-800 rounded-lg transition-colors"
                >
                  {selectedWorkouts.size === workouts.length ? 'Deselect All' : 'Select All'}
                </button>
                {selectedWorkouts.size > 0 && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmDelete({ kind: 'bulk' })}
                    disabled={isBulkDeleting}
                  >
                    {isBulkDeleting ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Deleting...
                      </span>
                    ) : (
                      `Delete ${selectedWorkouts.size} Selected`
                    )}
                  </Button>
                )}
              </>
            )}
            <Button
              variant={isSelectMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={toggleSelectMode}
            >
              {isSelectMode ? 'Cancel' : 'Select'}
            </Button>
          </div>
        )}
      </div>

      {/* List / Calendar toggle (P1-6) — flat list stays the default */}
      {workouts.length > 0 && (
        <div className="flex gap-1 bg-surface-800/50 p-1 rounded-xl w-fit">
          {(['list', 'calendar'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => {
                setViewMode(mode);
                if (mode === 'list') setSelectedDay(null);
              }}
              aria-pressed={viewMode === mode}
              className={`px-5 min-h-[44px] rounded-lg text-sm font-medium capitalize transition-all ${
                viewMode === mode
                  ? 'bg-surface-700 text-surface-100 shadow-sm'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}

      {viewMode === 'calendar' && (
        <HistoryCalendar
          month={calMonth}
          dotDates={monthDots}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onMonthChange={setCalMonth}
        />
      )}

      {/* Exercise filter chips (P1-6) */}
      {workouts.length > 0 && exerciseChips.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {exerciseChips.map((name) => (
            <button
              key={name}
              onClick={() => setExerciseFilter(exerciseFilter === name ? null : name)}
              aria-pressed={exerciseFilter === name}
              className={`flex-shrink-0 min-h-[44px] px-4 rounded-full text-sm font-medium transition-colors ${
                exerciseFilter === name
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {viewMode === 'calendar' && selectedDay && displayedWorkouts.length === 0 && (
        <p className="text-sm text-surface-500 text-center py-4">
          No {exerciseFilter ? `${exerciseFilter} ` : ''}workouts on{' '}
          {new Date(`${selectedDay}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
        </p>
      )}

      {workouts.length === 0 ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No workout history yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Complete your first workout to start building your training history.
          </p>
          <Link href="/dashboard/workout/new">
            <Button className="mt-6">Start Your First Workout</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayedWorkouts.map((workout) => {
            const isExpanded = expandedWorkout === workout.id;
            
            const isSelected = selectedWorkouts.has(workout.id);

            return (
              <Card key={workout.id} className={`overflow-hidden group relative ${isSelectMode && isSelected ? 'ring-2 ring-primary-500' : ''}`}>
                {/* Checkbox for select mode */}
                {isSelectMode && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleWorkoutSelection(workout.id);
                    }}
                    className="absolute top-4 left-4 z-10"
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-primary-500 border-primary-500'
                        : 'border-surface-500 hover:border-surface-400'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                )}

                {/* Action buttons - top right (hidden in select mode) */}
                {!isSelectMode && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 z-10">
                    {/* Deload toggle - only for completed workouts */}
                    {workout.state === 'completed' && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleToggleDeload(workout);
                        }}
                        disabled={togglingDeloadId === workout.id}
                        className={`p-1.5 rounded-lg transition-all ${
                          workout.is_deload
                            ? 'bg-primary-500/20 text-primary-300 hover:text-primary-200'
                            : 'text-surface-500 hover:bg-primary-500/20 hover:text-primary-400'
                        }`}
                        title={workout.is_deload ? 'Unmark as deload session' : 'Mark as deload session'}
                        aria-pressed={workout.is_deload}
                      >
                        {togglingDeloadId === workout.id ? (
                          <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        )}
                      </button>
                    )}
                    {/* Repeat button - only for completed workouts */}
                    {workout.state === 'completed' && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRepeatWorkout(workout);
                        }}
                        disabled={repeatingId === workout.id}
                        className="p-1.5 rounded-lg hover:bg-primary-500/20 text-primary-400 hover:text-primary-300 transition-all"
                        title="Do this workout again"
                      >
                        {repeatingId === workout.id ? (
                          <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                      </button>
                    )}
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmDelete({ kind: 'single', workoutId: workout.id, state: workout.state });
                      }}
                      disabled={deletingId === workout.id}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-danger-500/20 text-surface-500 hover:text-danger-400 transition-all"
                      title={workout.state === 'in_progress' ? 'Cancel workout' : 'Delete workout'}
                    >
                      {deletingId === workout.id ? (
                        <div className="w-4 h-4 border-2 border-danger-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}

                {/* Main clickable area */}
                {isSelectMode ? (
                  <button
                    onClick={() => toggleWorkoutSelection(workout.id)}
                    className="block w-full text-left"
                  >
                    <div className={`p-4 sm:p-6 hover:bg-surface-800/30 transition-colors cursor-pointer ${isSelectMode ? 'pl-12' : ''}`}>
                      {/* Header row */}
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex-1 pr-8">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-surface-100">
                              {workout.completed_at
                                ? formatDate(workout.completed_at)
                                : formatDate(workout.planned_date)}
                            </h3>
                            <Badge
                              variant={workout.state === 'completed' ? 'success' : 'warning'}
                              size="sm"
                            >
                              {workout.state === 'completed' ? 'Completed' : 'In Progress'}
                            </Badge>
                            {workout.is_deload && (
                              <Badge variant="info" size="sm">
                                Deload
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-surface-400">
                            {workout.completed_at && (
                              <span>Finished at {formatTime(workout.completed_at)}</span>
                            )}
                            <span>{workout.exercises.length} exercises</span>
                            <span>{workout.totalSets} sets</span>
                            <span>{formatWeight(workout.totalVolume, unit, 0)} total</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ) : (
                <Link href={`/dashboard/workout/${workout.id}`} className="block">
                  <div className="p-4 sm:p-6 hover:bg-surface-800/30 transition-colors cursor-pointer">
                    {/* Header row */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="flex-1 pr-8">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-surface-100">
                            {workout.completed_at 
                              ? formatDate(workout.completed_at)
                              : formatDate(workout.planned_date)}
                          </h3>
                          <Badge 
                            variant={workout.state === 'completed' ? 'success' : 'warning'}
                            size="sm"
                          >
                            {workout.state === 'completed' ? 'Completed' : 'In Progress'}
                          </Badge>
                          {workout.state === 'in_progress' && (
                            <Badge variant="info" size="sm">
                              Continue →
                            </Badge>
                          )}
                          {workout.is_deload && (
                            <Badge variant="info" size="sm">
                              Deload
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-surface-400">
                          {workout.completed_at && (
                            <span>Finished at {formatTime(workout.completed_at)}</span>
                          )}
                          <span>{workout.exercises.length} exercises</span>
                          <span>{workout.totalSets} sets</span>
                          <span>{formatWeight(workout.totalVolume, unit, 0)} total</span>
                          {workout.session_rpe && (
                            <span className="flex items-center gap-1">
                              RPE: <span className={workout.session_rpe >= 8 ? 'text-danger-400' : workout.session_rpe >= 6 ? 'text-warning-400' : 'text-surface-300'}>{workout.session_rpe}</span>
                            </span>
                          )}
                          {workout.pump_rating && (
                            <span>
                              {workout.pump_rating === 5 && '🔥'}
                              {workout.pump_rating === 4 && '😄'}
                              {workout.pump_rating === 3 && '😊'}
                              {workout.pump_rating === 2 && '🙂'}
                              {workout.pump_rating === 1 && '😐'}
                            </span>
                          )}
                        </div>
                        {workout.session_notes && (
                          <p className="mt-2 text-sm text-surface-500 line-clamp-2">
                            {workout.session_notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
                )}

                {/* Exercise summary - outside the link */}
                {workout.exercises.length > 0 && !isSelectMode && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-0 border-t border-surface-800">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleExpand(workout.id);
                      }}
                      className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors py-3"
                    >
                      <svg 
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      {isExpanded ? 'Hide details' : 'Show exercise details'}
                    </button>

                    {/* Quick exercise list */}
                    {!isExpanded && (
                      <div className="flex flex-wrap gap-2">
                        {workout.exercises.map((exercise) => (
                          <button
                            key={exercise.id}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              fetchExerciseHistory(exercise.exerciseId, exercise.name, exercise.primaryMuscle, exercise.isDuration);
                            }}
                            className="px-2 py-1 bg-surface-800 hover:bg-surface-700 rounded text-xs text-surface-300 transition-colors"
                          >
                            {exercise.name} ({exercise.sets.length})
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Detailed exercise breakdown */}
                    {isExpanded && (
                      <div className="space-y-4">
                        {workout.exercises.map((exercise) => (
                          <div key={exercise.id} className="bg-surface-800/50 rounded-lg p-3">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                fetchExerciseHistory(exercise.exerciseId, exercise.name, exercise.primaryMuscle, exercise.isDuration);
                              }}
                              className="flex items-center justify-between mb-2 w-full text-left group"
                            >
                              <h4 className="font-medium text-surface-200 group-hover:text-primary-400 transition-colors">
                                {exercise.name}
                                <svg className="w-4 h-4 inline ml-2 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                              </h4>
                              <Badge variant="default" size="sm">
                                {exercise.primaryMuscle}
                              </Badge>
                            </button>

                            {exercise.sets.length > 0 ? (
                              <div className="space-y-1">
                                {exercise.sets.map((set, idx) =>
                                  editingSetId === set.id ? (
                                    /* Inline set editor (P1-3): fix a fat-fingered
                                       weight after the session is done. E1RM, PRs,
                                       volume and future suggestions all derive from
                                       set_logs at read time, so saving self-heals. */
                                    <div key={set.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-surface-700/40">
                                      <span className="text-surface-500 w-8">#{idx + 1}</span>
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        value={editWeight}
                                        onChange={(e) => setEditWeight(e.target.value)}
                                        aria-label="Weight"
                                        className="w-20 min-h-[44px] px-2 bg-surface-900 border border-primary-500/50 rounded-lg text-center font-mono text-surface-100 focus:outline-none"
                                      />
                                      <span className="text-surface-500 text-xs">{unit}</span>
                                      <span className="text-surface-400">×</span>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        value={editReps}
                                        onChange={(e) => setEditReps(e.target.value)}
                                        aria-label="Reps"
                                        className="w-16 min-h-[44px] px-2 bg-surface-900 border border-primary-500/50 rounded-lg text-center font-mono text-surface-100 focus:outline-none"
                                      />
                                      <button
                                        onClick={() => saveSetEdit(workout.id, exercise.id, set.id)}
                                        disabled={savingSetEdit}
                                        aria-label="Save set"
                                        className="ml-auto min-w-[44px] min-h-[44px] rounded-lg text-primary-400 hover:bg-surface-700 font-semibold"
                                      >
                                        {savingSetEdit ? '…' : '✓'}
                                      </button>
                                      <button
                                        onClick={() => setEditingSetId(null)}
                                        aria-label="Cancel edit"
                                        className="min-w-[44px] min-h-[44px] rounded-lg text-surface-500 hover:bg-surface-700"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                  <div
                                    key={set.id}
                                    className="flex items-center gap-4 text-sm py-1 px-2 rounded hover:bg-surface-700/50 group/set"
                                  >
                                    <span className="text-surface-500 w-8">#{idx + 1}</span>
                                    {exercise.isDuration ? (
                                      <>
                                        <span className="text-surface-200 font-medium">
                                          {set.reps}s
                                        </span>
                                        <span className="text-surface-400">@</span>
                                        <span className="text-surface-200 font-medium">
                                          {formatWeight(set.weight_kg, unit)}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-surface-200 font-medium">
                                          {formatWeight(set.weight_kg, unit)}
                                        </span>
                                        <span className="text-surface-400">×</span>
                                        <span className="text-surface-200 font-medium">
                                          {set.reps} reps
                                        </span>
                                      </>
                                    )}
                                    {set.rpe && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                                        set.rpe >= 9 ? 'bg-danger-500/20 text-danger-400' :
                                        set.rpe >= 7 ? 'bg-warning-500/20 text-warning-400' :
                                        'bg-surface-700 text-surface-400'
                                      }`}>
                                        RPE {set.rpe}
                                      </span>
                                    )}
                                    {workout.state === 'completed' && !isSelectMode && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          startSetEdit(set);
                                        }}
                                        aria-label={`Edit set ${idx + 1}`}
                                        className="ml-auto min-w-[44px] min-h-[44px] rounded-lg text-surface-500 hover:text-primary-400 hover:bg-surface-700 transition-colors"
                                      >
                                        ✎
                                      </button>
                                    )}
                                  </div>
                                  )
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-surface-500">No sets recorded</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                )}

                {/* Restart Workout Button - always visible for completed workouts */}
                {workout.state === 'completed' && !isSelectMode && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRepeatWorkout(workout);
                      }}
                      disabled={repeatingId === workout.id}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-500/10 hover:bg-primary-500/20 border border-primary-500/30 rounded-lg text-primary-400 hover:text-primary-300 transition-all disabled:opacity-50"
                    >
                      {repeatingId === workout.id ? (
                        <>
                          <div className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                          <span className="text-sm font-medium">Starting workout...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span className="text-sm font-medium">Restart Workout</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}

          {/* Older sessions load on demand (P1-2 pagination) — hidden while a
              calendar day or exercise filter narrows the list */}
          {hasMore && viewMode === 'list' && !exerciseFilter && (
            <Button
              variant="ghost"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="w-full min-h-[48px]"
            >
              {isLoadingMore ? 'Loading…' : 'Load older workouts'}
            </Button>
          )}
        </div>
      )}

      {/* Exercise History Modal */}
      <ExerciseHistoryModal />

      {/* Destructive-action confirmation (P2-7 — replaces native confirm()) */}
      <ConfirmModal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.kind === 'bulk') {
            handleBulkDelete();
          } else {
            handleDeleteWorkout(confirmDelete.workoutId);
          }
          setConfirmDelete(null);
        }}
        title={
          confirmDelete?.kind === 'bulk'
            ? `Delete ${selectedWorkouts.size} workout${selectedWorkouts.size > 1 ? 's' : ''}?`
            : confirmDelete?.state === 'in_progress'
              ? 'Cancel this workout?'
              : 'Delete this workout?'
        }
        message="This permanently removes the logged sets and cannot be undone."
        confirmText={confirmDelete?.kind === 'single' && confirmDelete.state === 'in_progress' ? 'Cancel Workout' : 'Delete'}
        cancelText="Keep"
        variant="danger"
        isLoading={isBulkDeleting || deletingId !== null}
      />

      {/* Action errors (P2-7 — replaces native alert()) */}
      {actionError && (
        <div className="fixed bottom-20 left-4 right-4 z-50 max-w-md mx-auto" role="alert">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-danger-500/15 border border-danger-500/40 backdrop-blur text-sm text-danger-300">
            <span className="flex-1">{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="min-w-[44px] min-h-[24px] text-danger-200 font-medium"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<FullPageLoading text="Loading workout history..." type="barbell" />}>
      <HistoryPageContent />
    </Suspense>
  );
}
