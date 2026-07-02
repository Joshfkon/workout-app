'use client';

/**
 * /dashboard/log — the app's landing surface.
 *
 * Opening the app drops the user into a blank-workout logger:
 *   1. Quick-route cards: continue/start today's mesocycle workout, log food.
 *   2. "Start logging": exercise search + suggested list. No workout_sessions
 *      row exists until the user taps an exercise (lazy session creation,
 *      mirroring /dashboard/workout/quick's insert shape).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconBarbell,
  IconChevronRight,
  IconHistory,
  IconPlayerPlay,
  IconSalad,
  IconSearch,
} from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';
import { computeStapleExerciseIds } from '@/services/exerciseStaples';
import {
  startMesocycleWorkoutSession,
  getWorkoutForDay,
  type TodayWorkout,
} from '@/lib/training/startMesocycleSession';
import type { ExerciseOverride } from '@/services/mesocycleHelpers';
import type { Experience, MuscleGroup, WarmupSet, WorkoutDay } from '@/types/schema';

// Normalize exercise search terms for better matching (local copy of the
// AddExercisePicker approach): "situps" vs "sit up" vs "sit-up".
function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-\s]/g, '')
    .replace(/s$/, '');
}

const SUGGESTED_COUNT = 8;
const MAJOR_MUSCLES = ['chest', 'back', 'quads', 'shoulders', 'hamstrings', 'biceps', 'triceps', 'glutes'];

interface LogExercise {
  id: string;
  name: string;
  primary_muscle: string | null;
  mechanic: 'compound' | 'isolation' | null;
  default_rep_range: [number, number] | null;
  default_rir: number | null;
  hypertrophy_tier: string | null;
}

interface InProgressSummary {
  id: string;
  name: string;
  setsDone: number;
  setsTarget: number;
}

/** Active mesocycle row: the fields the shared start path + day derivation need. */
interface ActiveMesocycleRow {
  id: string;
  name: string;
  current_week: number;
  total_weeks: number;
  deload_week: number;
  split_type: string;
  days_per_week: number;
  preferred_workout_days: WorkoutDay[] | null;
  program_data: unknown;
  exercise_overrides?: ExerciseOverride[];
}

interface InProgressBlockRow {
  target_sets: number | null;
  set_logs: { id: string; is_warmup: boolean | null }[] | null;
}

type UntypedSupabase = ReturnType<typeof createUntypedClient>;

/**
 * Reuse today's planned/in-progress session or create a fresh one (mirrors
 * /dashboard/workout/quick's session insert shape).
 */
async function getOrCreateTodaySession(
  supabase: UntypedSupabase,
  userId: string
): Promise<{ sessionId: string; isNewSession: boolean }> {
  const today = getLocalDateString();

  const { data: existingSessions } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('planned_date', today)
    .in('state', ['planned', 'in_progress'])
    .limit(1);

  const existingId: string | undefined = existingSessions?.[0]?.id;
  if (existingId) {
    return { sessionId: existingId, isNewSession: false };
  }

  const { data: newSession, error: createError } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: userId,
      planned_date: today,
      state: 'in_progress',
      started_at: new Date().toISOString(),
      completion_percent: 0,
    })
    .select('id')
    .single();

  if (createError || !newSession) {
    throw createError ?? new Error('Failed to create session');
  }
  return { sessionId: newSession.id, isNewSession: true };
}

/** Suggested working weight via the same helper the mesocycle start path uses (kg in, kg out). */
async function getSuggestedWeightKg(
  supabase: UntypedSupabase,
  userId: string,
  exerciseName: string,
  repRange: [number, number],
  targetRir: number
): Promise<number> {
  const { data: userData } = await supabase
    .from('users')
    .select('weight_kg, height_cm, body_fat_percent, experience')
    .eq('id', userId)
    .single();

  if (!userData?.weight_kg || !userData?.height_cm) return 0;

  const weightRec = quickWeightEstimate(
    exerciseName,
    { min: repRange[0], max: repRange[1] },
    targetRir,
    userData.weight_kg,
    userData.height_cm,
    userData.body_fat_percent || 20,
    (userData.experience || 'intermediate') as Experience
  );
  if (weightRec.confidence === 'find_working_weight') return 0;
  return weightRec.recommendedWeight || 0;
}

export default function LogPage() {
  const router = useRouter();
  const supabase = createUntypedClient();

  const [isLoading, setIsLoading] = useState(true);
  const [inProgress, setInProgress] = useState<InProgressSummary | null>(null);
  const [activeMeso, setActiveMeso] = useState<ActiveMesocycleRow | null>(null);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [exercises, setExercises] = useState<LogExercise[]>([]);
  const [usageCounts, setUsageCounts] = useState<Map<string, number>>(new Map());
  const [lastDone, setLastDone] = useState<Map<string, Date>>(new Map());
  const [search, setSearch] = useState('');
  const [isStartingMeso, setIsStartingMeso] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAll() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = getLocalDateString();
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const [inProgressRes, mesoRes, exercisesRes, usageRes] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, mesocycles(name), exercise_blocks(target_sets, set_logs(id, is_warmup))')
          .eq('user_id', user.id)
          .eq('planned_date', today)
          .eq('state', 'in_progress')
          .limit(1),
        supabase
          .from('mesocycles')
          .select('id, name, current_week, total_weeks, deload_week, split_type, days_per_week, preferred_workout_days, program_data, exercise_overrides')
          .eq('user_id', user.id)
          .eq('state', 'active')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('exercises')
          .select('id, name, primary_muscle, mechanic, default_rep_range, default_rir, hypertrophy_tier')
          .order('name'),
        supabase
          .from('exercise_blocks')
          .select('exercise_id, workout_sessions!inner(user_id, started_at)')
          .eq('workout_sessions.user_id', user.id)
          .gte('workout_sessions.started_at', ninetyDaysAgo.toISOString()),
      ]);

      const ipRow = inProgressRes.data?.[0];
      if (ipRow) {
        const blocks = (ipRow.exercise_blocks ?? []) as InProgressBlockRow[];
        const setsTarget = blocks.reduce((sum, b) => sum + (b.target_sets || 0), 0);
        const setsDone = blocks.reduce(
          (sum, b) => sum + (b.set_logs ?? []).filter((l) => !l.is_warmup).length,
          0
        );
        const mesoRel = ipRow.mesocycles as { name: string } | { name: string }[] | null;
        const mesoName = Array.isArray(mesoRel) ? mesoRel[0]?.name : mesoRel?.name;
        setInProgress({ id: ipRow.id, name: mesoName || 'workout', setsDone, setsTarget });
      }

      const meso = (mesoRes.data?.[0] ?? null) as ActiveMesocycleRow | null;
      if (meso) {
        setActiveMeso(meso);
        const dayOfWeek = new Date().getDay() || 7;
        setTodayWorkout(
          getWorkoutForDay(meso.split_type, dayOfWeek, meso.days_per_week, meso.preferred_workout_days)
        );
      }

      if (exercisesRes.data) {
        setExercises(exercisesRes.data as LogExercise[]);
      }

      if (usageRes.data) {
        const counts = new Map<string, number>();
        const recent = new Map<string, Date>();
        (usageRes.data as { exercise_id: string; workout_sessions: { started_at: string } }[]).forEach(
          (block) => {
            const id = block.exercise_id;
            counts.set(id, (counts.get(id) || 0) + 1);
            const sessionDate = new Date(block.workout_sessions.started_at);
            const currentLast = recent.get(id);
            if (!currentLast || sessionDate > currentLast) {
              recent.set(id, sessionDate);
            }
          }
        );
        setUsageCounts(counts);
        setLastDone(recent);
      }
    } catch (err) {
      console.error('Failed to load log page data:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const stapleIds = useMemo(
    () =>
      computeStapleExerciseIds(
        exercises.map((ex) => ({ id: ex.id, muscle: ex.primary_muscle, tier: ex.hypertrophy_tier }))
      ),
    [exercises]
  );

  // Suggested list: recent/frequent exercises first, topped up with staples
  // spread round-robin across the major muscle groups.
  const suggested = useMemo(() => {
    const picked: LogExercise[] = [];
    const pickedIds = new Set<string>();

    const used = exercises
      .filter((ex) => (usageCounts.get(ex.id) ?? 0) > 0)
      .sort((a, b) => {
        const diff = (usageCounts.get(b.id) ?? 0) - (usageCounts.get(a.id) ?? 0);
        if (diff !== 0) return diff;
        return (lastDone.get(b.id)?.getTime() ?? 0) - (lastDone.get(a.id)?.getTime() ?? 0);
      });
    for (const ex of used) {
      if (picked.length >= SUGGESTED_COUNT) break;
      picked.push(ex);
      pickedIds.add(ex.id);
    }

    if (picked.length < SUGGESTED_COUNT) {
      const staplesByMuscle = new Map<string, LogExercise[]>();
      for (const ex of exercises) {
        if (!stapleIds.has(ex.id) || pickedIds.has(ex.id)) continue;
        const muscle = (ex.primary_muscle ?? '').toLowerCase();
        const list = staplesByMuscle.get(muscle);
        if (list) list.push(ex);
        else staplesByMuscle.set(muscle, [ex]);
      }
      let added = true;
      while (picked.length < SUGGESTED_COUNT && added) {
        added = false;
        for (const muscle of MAJOR_MUSCLES) {
          if (picked.length >= SUGGESTED_COUNT) break;
          const next = staplesByMuscle.get(muscle)?.shift();
          if (next) {
            picked.push(next);
            pickedIds.add(next.id);
            added = true;
          }
        }
      }
    }

    return picked;
  }, [exercises, usageCounts, lastDone, stapleIds]);

  const searchResults = useMemo(() => {
    const q = normalizeForSearch(search.trim());
    if (!q) return null;
    return exercises.filter((ex) => normalizeForSearch(ex.name).includes(q)).slice(0, 50);
  }, [search, exercises]);

  const rows = searchResults ?? suggested;

  const handleStartMesoWorkout = async () => {
    if (!activeMeso || isStartingMeso) return;
    setIsStartingMeso(true);
    setError(null);
    try {
      const { sessionId } = await startMesocycleWorkoutSession({
        supabase,
        mesocycle: activeMeso,
        todayWorkout,
      });
      router.push(`/dashboard/workout/${sessionId}`);
    } catch (err) {
      console.error('Failed to start mesocycle workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStartingMeso(false);
    }
  };

  // Lazy session creation: nothing is written until an exercise is tapped.
  // Session insert mirrors /dashboard/workout/quick (reuse today's session if
  // one exists); block insert mirrors the workout page's add-exercise shape,
  // with the suggested weight from quickWeightEstimate (kg in, kg out).
  const handlePickExercise = async (exercise: LogExercise) => {
    if (creatingId) return;
    setCreatingId(exercise.id);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      const { sessionId, isNewSession } = await getOrCreateTodaySession(supabase, user.id);

      let order = 1;
      if (!isNewSession) {
        const { data: maxOrderResult } = await supabase
          .from('exercise_blocks')
          .select('order')
          .eq('workout_session_id', sessionId)
          .order('order', { ascending: false })
          .limit(1)
          .maybeSingle();
        order = (maxOrderResult?.order || 0) + 1;
      }

      const isCompound = exercise.mechanic === 'compound';
      const repRange = (exercise.default_rep_range && exercise.default_rep_range.length >= 2
        ? [exercise.default_rep_range[0], exercise.default_rep_range[1]]
        : isCompound
          ? [6, 10]
          : [10, 15]) as [number, number];
      const targetRir = exercise.default_rir ?? 2;

      const suggestedWeight = await getSuggestedWeightKg(
        supabase,
        user.id,
        exercise.name,
        repRange,
        targetRir
      );

      let warmupSets: WarmupSet[] = [];
      if (isNewSession) {
        warmupSets = generateWarmupProtocol({
          workingWeight: suggestedWeight > 0 ? suggestedWeight : 60,
          exercise: {
            id: exercise.id,
            name: exercise.name,
            primaryMuscle: (exercise.primary_muscle || 'chest') as MuscleGroup,
            secondaryMuscles: [],
            mechanic: isCompound ? 'compound' : 'isolation',
            defaultRepRange: repRange,
            defaultRir: targetRir,
            minWeightIncrementKg: 2.5,
            formCues: [],
            commonMistakes: [],
            equipmentRequired: [],
            setupNote: '',
            movementPattern: isCompound ? 'compound' : 'isolation',
          },
          isFirstExercise: true,
        });
      }

      const { error: blockError } = await supabase.from('exercise_blocks').insert({
        workout_session_id: sessionId,
        exercise_id: exercise.id,
        order,
        target_sets: isCompound ? 4 : 3,
        target_rep_range: repRange,
        target_rir: targetRir,
        target_weight_kg: suggestedWeight,
        target_rest_seconds: isCompound ? 180 : 90,
        suggestion_reason: 'Quick log',
        warmup_protocol: { sets: warmupSets },
      });

      if (blockError) throw blockError;

      router.push(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start workout:', err);
      setError('Failed to start workout. Please try again.');
      setCreatingId(null);
    }
  };

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Slim header */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-[17px] font-medium text-surface-100">Log</h1>
        <p className="text-xs text-surface-500">{dateLabel}</p>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger-400 text-xs">
          {error}
        </div>
      )}

      {/* Quick-route cards */}
      <div className="space-y-2">
        {inProgress ? (
          <button
            onClick={() => router.push(`/dashboard/workout/${inProgress.id}`)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-warning-500/10 border border-warning-500/30 text-left hover:bg-warning-500/15 transition-colors"
          >
            <IconBarbell size={18} className="text-warning-400 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-warning-300 truncate">
                Continue {inProgress.name}
              </span>
              <span className="block text-[11px] text-surface-400">
                {inProgress.setsDone}/{inProgress.setsTarget} sets
              </span>
            </span>
            <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
          </button>
        ) : activeMeso && todayWorkout ? (
          <button
            onClick={handleStartMesoWorkout}
            disabled={isStartingMeso}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-primary-500/10 border border-primary-500/30 text-left hover:bg-primary-500/15 transition-colors disabled:opacity-60"
          >
            <IconPlayerPlay size={18} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-primary-300 truncate">
                Today: {todayWorkout.dayName}
              </span>
              <span className="block text-[11px] text-surface-400">
                {isStartingMeso ? 'Starting...' : 'start workout'}
              </span>
            </span>
            <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
          </button>
        ) : null}

        <button
          onClick={() => router.push('/dashboard/nutrition')}
          className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors"
        >
          <IconSalad size={18} className="text-success-400 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-[13px] font-medium text-surface-200">Log food</span>
          <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
        </button>
      </div>

      {/* Blank workout: search + suggested exercises */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-surface-500 mb-2">
          Start logging
        </p>
        <div className="relative mb-2">
          <IconSearch
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500"
            aria-hidden="true"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercises..."
            className="w-full pl-9 pr-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-[13px] text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500/50"
          />
        </div>
        <div className="rounded-xl border border-surface-800 bg-surface-900 overflow-hidden">
          {isLoading ? (
            <p className="p-4 text-center text-xs text-surface-500">Loading exercises...</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-center text-xs text-surface-500">No exercises found</p>
          ) : (
            rows.map((ex) => (
              <button
                key={ex.id}
                onClick={() => handlePickExercise(ex)}
                disabled={creatingId !== null}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left border-b border-surface-800/50 last:border-b-0 hover:bg-surface-800/50 transition-colors disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] text-surface-200 truncate">{ex.name}</span>
                  <span className="block text-[11px] text-surface-500">
                    <span className="capitalize">{ex.primary_muscle || 'other'}</span>
                    {ex.hypertrophy_tier ? ` · ${ex.hypertrophy_tier}-tier` : ''}
                  </span>
                </span>
                {creatingId === ex.id ? (
                  <span className="text-[11px] text-primary-400 flex-shrink-0">Starting...</span>
                ) : (
                  <IconChevronRight size={14} className="text-surface-600 flex-shrink-0" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Old Train page stays reachable */}
      <Link
        href="/dashboard/workout"
        className="flex items-center gap-2 px-1 py-2 text-xs text-surface-500 hover:text-surface-300 transition-colors"
      >
        <IconHistory size={14} aria-hidden="true" />
        <span>Workout history &amp; planned sessions</span>
        <IconChevronRight size={14} className="ml-auto" aria-hidden="true" />
      </Link>
    </div>
  );
}
