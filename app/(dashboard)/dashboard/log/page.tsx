'use client';

/**
 * /dashboard/log — the app's landing surface.
 *
 * Opening the app drops the user into a four-choice launcher:
 *   1. Continue card (only when a session is in_progress today).
 *   2. Log food -> /dashboard/nutrition.
 *   3. Mesocycle workout -> start today's scheduled session (or route to the
 *      mesocycle pages on rest days / when there is no active mesocycle).
 *   4. Blank workout -> creates/reuses today's session (no exercise blocks)
 *      and opens the workout page, where the user adds exercises via the
 *      search-first picker. Repeat taps reuse the same session.
 *   5. AI suggested workout -> builds a plan from muscle recovery + weekly
 *      volume (services/suggestedWorkout, pure), previews it in a bottom
 *      sheet, and only writes the session/blocks when the user taps Start.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconBarbell,
  IconCalendarStats,
  IconChevronRight,
  IconHistory,
  IconListDetails,
  IconLoader2,
  IconPlus,
  IconSalad,
  IconSparkles,
  IconTemplate,
  IconX,
} from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';
import {
  buildSuggestedWorkout,
  type SuggestedWorkoutPlan,
} from '@/services/suggestedWorkout';
import {
  startMesocycleWorkoutSession,
  getWorkoutForDay,
  type TodayWorkout,
} from '@/lib/training/startMesocycleSession';
import { getOrCreateTodaySession } from '../workout/_lib/adhocSession';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import { BottomSheet } from '@/components/workout/BottomSheet';
import type { ExerciseOverride } from '@/services/mesocycleHelpers';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import type { Experience, MuscleGroup, WarmupSet, WorkoutDay } from '@/types/schema';

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

// getOrCreateTodaySession moved to ../workout/_lib/adhocSession so the
// quick-workout confirm screen shares the exact create/reuse semantics.

/** The users-table fields quickWeightEstimate needs. */
interface EstimationProfile {
  weight_kg: number | null;
  height_cm: number | null;
  body_fat_percent: number | null;
  experience: string | null;
}

async function fetchEstimationProfile(
  supabase: UntypedSupabase,
  userId: string
): Promise<EstimationProfile | null> {
  const { data } = await supabase
    .from('users')
    .select('weight_kg, height_cm, body_fat_percent, experience')
    .eq('id', userId)
    .single();
  return (data as EstimationProfile | null) ?? null;
}

/** Suggested working weight via the same helper the mesocycle start path uses (kg in, kg out). */
function estimateWeightKg(
  profile: EstimationProfile | null,
  exerciseName: string,
  repRange: [number, number],
  targetRir: number
): number {
  if (!profile?.weight_kg || !profile?.height_cm) return 0;

  const weightRec = quickWeightEstimate(
    exerciseName,
    { min: repRange[0], max: repRange[1] },
    targetRir,
    profile.weight_kg,
    profile.height_cm,
    profile.body_fat_percent || 20,
    (profile.experience || 'intermediate') as Experience
  );
  if (weightRec.confidence === 'find_working_weight') return 0;
  return weightRec.recommendedWeight || 0;
}

/** Rep range / RIR / rest defaults shared by the blank + AI create paths. */
function blockDefaults(exercise: LogExercise): {
  isCompound: boolean;
  repRange: [number, number];
  targetRir: number;
} {
  const isCompound = exercise.mechanic === 'compound';
  const repRange = (exercise.default_rep_range && exercise.default_rep_range.length >= 2
    ? [exercise.default_rep_range[0], exercise.default_rep_range[1]]
    : isCompound
      ? [6, 10]
      : [10, 15]) as [number, number];
  return { isCompound, repRange, targetRir: exercise.default_rir ?? 2 };
}

/** Warmup protocol for the session's first exercise (same shape everywhere). */
function warmupForFirstExercise(
  exercise: LogExercise,
  isCompound: boolean,
  repRange: [number, number],
  targetRir: number,
  workingWeightKg: number
): WarmupSet[] {
  return generateWarmupProtocol({
    workingWeight: workingWeightKg > 0 ? workingWeightKg : 60,
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
  const [isStartingMeso, setIsStartingMeso] = useState(false);
  const [isStartingBlank, setIsStartingBlank] = useState(false);
  const [error, setError] = useState<string | null>(null);


  // AI suggested workout
  const { recoveryStatus, isLoading: recoveryLoading } = useMuscleRecovery();
  const { volumeData, isLoading: volumeLoading } = useWeeklyVolume();
  const [aiRequested, setAiRequested] = useState(false);
  const [aiPlan, setAiPlan] = useState<SuggestedWorkoutPlan | null>(null);
  const [showAiSheet, setShowAiSheet] = useState(false);
  const [isStartingAi, setIsStartingAi] = useState(false);

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

  // Suggested list: recent/frequent exercises first, topped up with staples
  // spread round-robin across the major muscle groups.
  // Next scheduled training day (for the rest-day mesocycle card subtitle).
  const nextWorkout = useMemo(() => {
    if (!activeMeso || todayWorkout) return null;
    const todayDow = new Date().getDay() || 7;
    for (let offset = 1; offset <= 7; offset++) {
      const dow = ((todayDow - 1 + offset) % 7) + 1;
      const workout = getWorkoutForDay(
        activeMeso.split_type,
        dow,
        activeMeso.days_per_week,
        activeMeso.preferred_workout_days
      );
      if (workout) return workout;
    }
    return null;
  }, [activeMeso, todayWorkout]);

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

  // Blank workout: create/reuse today's session (no exercise blocks) and open
  // the workout page — exercises get added there via the search-first picker.
  // Repeat taps reuse the same session, so backing out never litters empties.
  const handleStartBlank = async () => {
    if (isStartingBlank) return;
    setIsStartingBlank(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { sessionId } = await getOrCreateTodaySession(supabase, user.id);
      router.push(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start blank workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStartingBlank(false);
    }
  };

  // AI suggestion: compute on tap (once recovery/volume/exercise data is in),
  // then preview in a bottom sheet. NOTHING is written until Start.
  useEffect(() => {
    if (!aiRequested || recoveryLoading || volumeLoading || isLoading) return;

    const volumeByMuscle = new Map(volumeData.map((v) => [v.muscleGroup, v]));
    const plan = buildSuggestedWorkout({
      muscles: recoveryStatus.map((r) => ({
        muscle: r.muscle,
        recoveryStatus: r.isReady ? 'ready' : r.recoveryPercent < 50 ? 'sore' : 'recovering',
        weeklySets: volumeByMuscle.get(r.muscle)?.totalSets ?? 0,
        targetSets: volumeByMuscle.get(r.muscle)?.landmarks.mav ?? 10,
      })),
      exercises: exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        primaryMuscle: ex.primary_muscle,
        tier: ex.hypertrophy_tier,
        mechanic: ex.mechanic,
      })),
      recentExerciseIds: Array.from(lastDone.entries())
        .sort(
          (a, b) =>
            b[1].getTime() - a[1].getTime() ||
            (usageCounts.get(b[0]) ?? 0) - (usageCounts.get(a[0]) ?? 0)
        )
        .map(([id]) => id),
    });

    setAiRequested(false);
    if (plan.exercises.length === 0) {
      setError('Could not build a suggestion — try a blank workout instead.');
      return;
    }
    setAiPlan(plan);
    setShowAiSheet(true);
  }, [aiRequested, recoveryLoading, volumeLoading, isLoading, recoveryStatus, volumeData, exercises, lastDone, usageCounts]);

  const handleRemoveAiPick = (exerciseId: string) => {
    setAiPlan((plan) =>
      plan
        ? { ...plan, exercises: plan.exercises.filter((p) => p.exerciseId !== exerciseId) }
        : plan
    );
  };

  // Materialize the previewed AI plan: same session + block creation path as
  // the blank workout (lazy create, quickWeightEstimate, warmups on the
  // session's first exercise).
  const handleStartAiWorkout = async () => {
    if (!aiPlan || aiPlan.exercises.length === 0 || isStartingAi) return;
    setIsStartingAi(true);
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

      const profile = await fetchEstimationProfile(supabase, user.id);
      const exerciseById = new Map(exercises.map((ex) => [ex.id, ex]));
      const blocks = [];
      for (const pick of aiPlan.exercises) {
        const exercise = exerciseById.get(pick.exerciseId);
        if (!exercise) continue;

        const { isCompound, repRange, targetRir } = blockDefaults(exercise);
        const suggestedWeight = estimateWeightKg(profile, exercise.name, repRange, targetRir);

        let warmupSets: WarmupSet[] = [];
        if (isNewSession && blocks.length === 0) {
          warmupSets = warmupForFirstExercise(exercise, isCompound, repRange, targetRir, suggestedWeight);
        }

        blocks.push({
          workout_session_id: sessionId,
          exercise_id: exercise.id,
          order: order++,
          target_sets: isCompound ? 4 : 3,
          target_rep_range: repRange,
          target_rir: targetRir,
          target_weight_kg: suggestedWeight,
          target_rest_seconds: isCompound ? 180 : 90,
          suggestion_reason: pick.reason,
          warmup_protocol: { sets: warmupSets },
        });
      }

      if (blocks.length === 0) throw new Error('No exercises to start');

      const { error: blocksError } = await supabase.from('exercise_blocks').insert(blocks);
      if (blocksError) throw blocksError;

      router.push(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start suggested workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStartingAi(false);
    }
  };

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const launcherCardClass =
    'w-full flex items-center gap-3 p-4 rounded-xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors';

  const mesoStartable = Boolean(activeMeso && todayWorkout);
  const mesoSubtitle = !activeMeso
    ? 'Plan a mesocycle'
    : todayWorkout
      ? isStartingMeso
        ? 'Starting...'
        : `Today: ${todayWorkout.dayName}`
      : `Rest day · next: ${nextWorkout?.dayName ?? 'view plan'}`;

  const handleMesoCardTap = () => {
    if (!activeMeso) {
      router.push('/dashboard/mesocycle/new');
    } else if (todayWorkout) {
      handleStartMesoWorkout();
    } else {
      router.push('/dashboard/mesocycle');
    }
  };

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

      {/* Continue card (only when a session is in progress today) */}
      {inProgress && (
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
      )}

      {/* Four launcher cards */}
      <div className="space-y-2">
        {/* 1. Log food */}
        <button onClick={() => router.push('/dashboard/nutrition')} className={launcherCardClass}>
          <IconSalad size={20} className="text-success-400 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-surface-100">Log food</span>
            <span className="block text-[12px] text-surface-500">
              Meals, barcode, describe with AI
            </span>
          </span>
          <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
        </button>

        {/* 2. Mesocycle workout */}
        <button
          onClick={handleMesoCardTap}
          disabled={isStartingMeso}
          className={
            mesoStartable
              ? 'w-full flex items-center gap-3 p-4 rounded-xl bg-primary-500/10 border border-primary-500/30 text-left hover:bg-primary-500/15 transition-colors disabled:opacity-60'
              : launcherCardClass
          }
        >
          <IconBarbell
            size={20}
            className={`${mesoStartable ? 'text-primary-400' : 'text-surface-400'} flex-shrink-0`}
            aria-hidden="true"
          />
          <span className="flex-1 min-w-0">
            <span
              className={`block text-[15px] font-medium ${mesoStartable ? 'text-primary-300' : 'text-surface-100'}`}
            >
              Mesocycle workout
            </span>
            <span className="block text-[12px] text-surface-500 truncate">{mesoSubtitle}</span>
          </span>
          {isStartingMeso ? (
            <IconLoader2 size={16} className="text-primary-400 animate-spin flex-shrink-0" aria-hidden="true" />
          ) : (
            <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
          )}
        </button>

        {/* 3. Blank workout: straight into the workout page */}
        <button
          onClick={handleStartBlank}
          disabled={isStartingBlank}
          className={`${launcherCardClass} disabled:opacity-60`}
        >
          <IconPlus size={20} className="text-surface-400 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-surface-100">Blank workout</span>
            <span className="block text-[12px] text-surface-500">
              {isStartingBlank ? 'Starting...' : 'Add exercises as you go'}
            </span>
          </span>
          {isStartingBlank ? (
            <IconLoader2 size={16} className="text-primary-400 animate-spin flex-shrink-0" aria-hidden="true" />
          ) : (
            <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
          )}
        </button>

        {/* 4. AI suggested workout */}
        <button
          onClick={() => setAiRequested(true)}
          disabled={aiRequested}
          className={`${launcherCardClass} disabled:opacity-60`}
        >
          <IconSparkles size={20} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium text-surface-100">
              AI suggested workout
            </span>
            <span className="block text-[12px] text-surface-500">
              {aiRequested ? 'Building suggestion...' : 'Built from your recovery and weekly volume'}
            </span>
          </span>
          {aiRequested ? (
            <IconLoader2 size={16} className="text-primary-400 animate-spin flex-shrink-0" aria-hidden="true" />
          ) : (
            <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Training tools: the rest of the Train tab lives behind these */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { name: 'Mesocycle plan', href: '/dashboard/mesocycle', icon: IconCalendarStats },
          { name: 'History', href: '/dashboard/history', icon: IconHistory },
          { name: 'Templates', href: '/dashboard/templates', icon: IconTemplate },
          { name: 'Exercises', href: '/dashboard/exercises', icon: IconListDetails },
        ].map((tool) => {
          const ToolIcon = tool.icon;
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex items-center gap-2 p-3 rounded-xl bg-surface-900 border border-surface-800 hover:bg-surface-800/70 transition-colors"
            >
              <ToolIcon size={16} className="text-surface-400 flex-shrink-0" aria-hidden="true" />
              <span className="text-[13px] font-medium text-surface-200 truncate">{tool.name}</span>
            </Link>
          );
        })}
      </div>

      {/* Planned sessions, today's programmed workout & recovery now live on
          the mesocycle page (the old /dashboard/workout hub was retired). */}
      <Link
        href="/dashboard/mesocycle"
        className="flex items-center gap-2 px-1 py-2 text-xs text-surface-500 hover:text-surface-300 transition-colors"
      >
        <IconBarbell size={14} aria-hidden="true" />
        <span>Planned sessions &amp; recovery</span>
        <IconChevronRight size={14} className="ml-auto" aria-hidden="true" />
      </Link>

      {/* AI suggested workout preview: nothing is created until Start */}
      <BottomSheet
        isOpen={showAiSheet && aiPlan !== null}
        onClose={() => setShowAiSheet(false)}
        title="Suggested workout"
      >
        {aiPlan && (
          <div className="space-y-3">
            <p className="text-[13px] text-surface-300">{aiPlan.focus}</p>

            <div className="rounded-xl border border-surface-800 bg-surface-950/40 overflow-hidden">
              {aiPlan.exercises.map((pick) => {
                const exercise = exercises.find((ex) => ex.id === pick.exerciseId);
                if (!exercise) return null;
                const setsPlanned = exercise.mechanic === 'compound' ? 4 : 3;
                return (
                  <div
                    key={pick.exerciseId}
                    className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-800/50 last:border-b-0"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] text-surface-200 truncate">
                        {exercise.name}
                      </span>
                      <span className="block text-[11px] text-surface-500">
                        {STANDARD_MUSCLE_DISPLAY_NAMES[pick.muscle] ?? pick.muscle} · {setsPlanned}{' '}
                        sets
                      </span>
                      <span className="block text-[11px] text-surface-500">{pick.reason}</span>
                    </span>
                    <button
                      onClick={() => handleRemoveAiPick(pick.exerciseId)}
                      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors flex-shrink-0"
                      aria-label={`Remove ${exercise.name}`}
                    >
                      <IconX size={16} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {aiPlan.exercises.length === 0 && (
                <p className="p-4 text-center text-xs text-surface-500">
                  All exercises removed — cancel and try again.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <button
                onClick={handleStartAiWorkout}
                disabled={isStartingAi || aiPlan.exercises.length === 0}
                className="w-full py-2.5 rounded-lg bg-primary-500 text-white text-[13px] font-medium hover:bg-primary-600 transition-colors disabled:opacity-60"
              >
                {isStartingAi
                  ? 'Starting...'
                  : `Start workout (${aiPlan.exercises.length} ${aiPlan.exercises.length === 1 ? 'exercise' : 'exercises'})`}
              </button>
              <button
                onClick={() => setShowAiSheet(false)}
                disabled={isStartingAi}
                className="w-full py-2 rounded-lg text-[13px] text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
