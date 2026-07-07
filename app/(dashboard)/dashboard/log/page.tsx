'use client';

/**
 * /dashboard/log — the app's landing surface.
 *
 * Layout (top to bottom):
 *   1. Unfinished-workout banner when a session is in_progress today:
 *      started time + sets logged, Resume opens it, X discards it via the
 *      same cleanup path as the workout page's cancel flow.
 *   2. Daily check-in link (only until today's check-in is done).
 *   3. Hero card for today's mesocycle workout: day name, exercise count /
 *      estimated duration / when this day was last done, a Start workout
 *      CTA and a sparkle button that opens the AI suggested workout sheet.
 *      On rest days the hero shows the next scheduled day; with no active
 *      mesocycle it prompts to plan one.
 *   4. "Quick log" rows: Log food -> /dashboard/nutrition, and Blank
 *      workout -> creates/reuses today's session (no exercise blocks) and
 *      opens the workout page. Repeat taps reuse the same session.
 *   5. "Today so far" strip: calories + protein from today's food log vs
 *      nutrition targets, and steps from wearable daily activity data
 *      (tile hidden when there's no activity row for today).
 *
 * The AI suggested workout sheet builds a plan from muscle recovery +
 * weekly volume (services/suggestedWorkout, pure), previews it, and only
 * writes the session/blocks when the user taps Start.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  IconChevronRight,
  IconClipboardHeart,
  IconLoader2,
  IconPlus,
  IconSalad,
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
  programSessionHasUsableExercises,
  type TodayWorkout,
} from '@/lib/training/startMesocycleSession';
import { sessionIndexFromCompleted } from '@/lib/training/mesocycleProgress';
import { getOrCreateTodaySession } from '../workout/_lib/adhocSession';
import { cancelWorkoutSession } from '../workout/[id]/_lib/cancelWorkout';
import { useWorkoutStore } from '@/stores/workoutStore';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { Modal } from '@/components/ui/Modal';
import { getSessionFromProgramData, type ExerciseOverride } from '@/services/mesocycleHelpers';
import {
  LogHeroCard,
  QuickLogRow,
  SectionLabel,
  TodaySoFarStrip,
  UnfinishedWorkoutBanner,
  formatRelativeDay,
  type TodaySoFar,
} from './_components/LogPageSections';
import { STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import type {
  Experience,
  FullProgramRecommendation,
  MuscleGroup,
  WarmupSet,
  WorkoutDay,
} from '@/types/schema';

// Lazy-load the check-in flow so it only ships when the user opens it
// (same pattern as the home dashboard's quick-log modals).
const DailyCheckIn = dynamic(
  () => import('@/components/dashboard/DailyCheckIn').then((mod) => ({ default: mod.DailyCheckIn })),
  { ssr: false }
);

type UserGoal = 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';

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
  /** null for ad-hoc (blank/quick/AI) sessions. */
  mesocycleId: string | null;
  startedAt: string | null;
  setsDone: number;
  /** exercise_block ids, needed by the discard path. */
  blockIds: string[];
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
  id: string;
  set_logs: { id: string; is_warmup: boolean | null }[] | null;
}

/** Hero-card meta for today's scheduled workout, derived from program_data. */
interface HeroPlanInfo {
  exerciseCount: number;
  estMinutes: number;
  /** When this split day was last completed (previous cycle), if ever. */
  lastDone: Date | null;
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

/** Duration choices for the AI suggested workout ("How much time do you have?"). */
const AI_DURATION_CHOICES = [20, 30, 45, 60, 75, 90];

/** Exercise budget for the session length (compound ≈ 12 min, isolation ≈ 8 min incl. rest). */
function maxExercisesForDuration(minutes: number): number {
  if (minutes <= 20) return 2;
  if (minutes <= 30) return 3;
  if (minutes <= 45) return 4;
  if (minutes <= 60) return 5;
  if (minutes <= 75) return 6;
  return 7;
}

/** Per-exercise set target scaled to session length (full sets at 60+ min, never below 2). */
function plannedSetsFor(mechanic: 'compound' | 'isolation' | null, minutes: number): number {
  const base = mechanic === 'compound' ? 4 : 3;
  return Math.max(2, Math.round(base * Math.min(1, minutes / 60)));
}

export default function LogPage() {
  const router = useRouter();
  const supabase = createUntypedClient();

  const [isLoading, setIsLoading] = useState(true);
  const [inProgress, setInProgress] = useState<InProgressSummary | null>(null);
  const [activeMeso, setActiveMeso] = useState<ActiveMesocycleRow | null>(null);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [heroInfo, setHeroInfo] = useState<HeroPlanInfo | null>(null);
  const [todaySoFar, setTodaySoFar] = useState<TodaySoFar | null>(null);
  const [programDayName, setProgramDayName] = useState<string | null>(null);
  const [exercises, setExercises] = useState<LogExercise[]>([]);
  const [usageCounts, setUsageCounts] = useState<Map<string, number>>(new Map());
  const [lastDone, setLastDone] = useState<Map<string, Date>>(new Map());
  const [isStartingMeso, setIsStartingMeso] = useState(false);
  const [isStartingBlank, setIsStartingBlank] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Daily check-in: a slim link is shown only while today's check-in is
  // missing ('missing'); 'loading' hides it until the fetch resolves.
  const [checkInStatus, setCheckInStatus] = useState<'loading' | 'missing' | 'done'>('loading');
  const [checkInUserId, setCheckInUserId] = useState<string | null>(null);
  const [userGoal, setUserGoal] = useState<UserGoal | undefined>(undefined);
  const [showCheckIn, setShowCheckIn] = useState(false);

  // AI suggested workout
  const { recoveryStatus, isLoading: recoveryLoading } = useMuscleRecovery();
  const { volumeData, isLoading: volumeLoading } = useWeeklyVolume();
  const [aiRequested, setAiRequested] = useState(false);
  const [aiPlan, setAiPlan] = useState<SuggestedWorkoutPlan | null>(null);
  const [aiDuration, setAiDuration] = useState(45);
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

      const [
        inProgressRes,
        mesoRes,
        exercisesRes,
        usageRes,
        checkInRes,
        goalRes,
        foodRes,
        targetsRes,
        activityRes,
      ] = await Promise.all([
        supabase
          .from('workout_sessions')
          .select('id, mesocycle_id, started_at, exercise_blocks(id, set_logs(id, is_warmup))')
          .eq('user_id', user.id)
          .eq('planned_date', today)
          .eq('state', 'in_progress')
          .limit(1),
        supabase
          .from('mesocycles')
          .select('id, name, current_week, total_weeks, deload_week, split_type, days_per_week, preferred_workout_days, program_data, exercise_overrides, generated_with_enhanced_mode')
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
        supabase
          .from('daily_check_ins')
          .select('id')
          .eq('user_id', user.id)
          .eq('date', today)
          .maybeSingle(),
        supabase
          .from('users')
          .select('goal')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('food_log')
          .select('calories, protein')
          .eq('user_id', user.id)
          .eq('logged_at', today),
        supabase
          .from('nutrition_targets')
          .select('calories, protein')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('daily_activity_data')
          .select('steps_total')
          .eq('user_id', user.id)
          .eq('date', today)
          .maybeSingle(),
      ]);

      setCheckInUserId(user.id);
      setCheckInStatus(checkInRes.data ? 'done' : 'missing');
      const goal = (goalRes.data as { goal: string | null } | null)?.goal;
      if (goal) setUserGoal(goal as UserGoal);

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
      let tw: TodayWorkout | null = null;
      if (meso) {
        setActiveMeso(meso);
        const dayOfWeek = new Date().getDay() || 7;
        tw = getWorkoutForDay(meso.split_type, dayOfWeek, meso.days_per_week, meso.preferred_workout_days);
        setTodayWorkout(tw);
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

      // "Today so far" strip. food_log rows can be missing entirely (nothing
      // logged) and the activity row only exists when a wearable synced.
      const foodRows = (foodRes.data ?? []) as { calories: number | null; protein: number | null }[];
      const targets = targetsRes.data as { calories: number | null; protein: number | null } | null;
      const activity = activityRes.data as { steps_total: number | null } | null;
      setTodaySoFar({
        calories: Math.round(foodRows.reduce((sum, r) => sum + (r.calories || 0), 0)),
        protein: Math.round(foodRows.reduce((sum, r) => sum + (r.protein || 0), 0)),
        caloriesTarget: targets?.calories ?? null,
        proteinTarget: targets?.protein ?? null,
        steps: activity?.steps_total ?? null,
      });

      // Hero meta (exercise count / est. duration / last done) from the
      // mesocycle's program_data at today's session index. The session index
      // is TOTAL completed sessions % days/week (the self-extending scheme
      // the start path uses), so the same ordinal arithmetic also finds when
      // this slot was last trained: one full cycle (days_per_week sessions)
      // ago in completion order.
      if (meso) {
        const { data: completedRows } = await supabase
          .from('workout_sessions')
          .select('started_at')
          .eq('mesocycle_id', meso.id)
          .eq('state', 'completed')
          .order('started_at', { ascending: true });
        const completed = (completedRows ?? []) as { started_at: string | null }[];

        const sessionIndex = sessionIndexFromCompleted(completed.length, meso.days_per_week);
        const slotSession = getSessionFromProgramData(
          meso.program_data as FullProgramRecommendation | null,
          sessionIndex,
          meso.current_week,
          meso.total_weeks
        );
        // The hero must advertise the workout Start actually launches: this
        // program slot, which diverges from the calendar weekday after
        // skipped days. Treat the slot as absent (→ calendar fallback) when
        // program_data yields nothing OR none of its exercises resolve in
        // the library — exactly when the start path's block-building loop
        // skips every entry and builds from todayWorkout's muscles instead.
        const slotUsable = await programSessionHasUsableExercises(
          supabase,
          slotSession,
          meso.exercise_overrides
        );
        const programSession = slotUsable ? slotSession : null;
        setProgramDayName(programSession?.dayName ?? null);

        // Fallback mirrors the start path's legacy behavior: 2 exercises per
        // scheduled muscle when program_data has no usable session.
        const exerciseCount =
          programSession?.exercises.length || (tw ? tw.muscles.length * 2 : 0);
        const estMinutes =
          (programSession?.estimatedMinutes ?? 0) > 0
            ? Math.round(programSession!.estimatedMinutes)
            : exerciseCount * 9;

        const lastCycleIdx = completed.length - meso.days_per_week;
        const lastStartedAt = lastCycleIdx >= 0 ? completed[lastCycleIdx]?.started_at : null;
        setHeroInfo({
          exerciseCount,
          estMinutes,
          lastDone: lastStartedAt ? new Date(lastStartedAt) : null,
        });
      }
    } catch (err) {
      console.error('Failed to load log page data:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // Next scheduled training day (for the rest-day hero subtitle).
  const nextWorkoutInfo = useMemo(() => {
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
      if (workout) {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        return {
          workout,
          dayLabel:
            offset === 1 ? 'tomorrow' : date.toLocaleDateString('en-US', { weekday: 'short' }),
        };
      }
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
      // The workout store persists activeSession (it drives the global
      // ResumeWorkoutBanner pill), so if the user opened this session before
      // discarding it here, clear the store too — otherwise the pill keeps
      // routing to a deleted/reset session. Matches the workout page's
      // cancel flow, which calls endSession() after the same DB cleanup.
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

  // AI suggestion: the sheet asks "How much time do you have?" first; picking
  // a duration sets aiRequested and the plan is computed here (once
  // recovery/volume/exercise data is in), sized to fit the time. NOTHING is
  // written until Start.
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
      maxExercises: maxExercisesForDuration(aiDuration),
    });

    setAiRequested(false);
    if (plan.exercises.length === 0) {
      setError('Could not build a suggestion — try a blank workout instead.');
      setShowAiSheet(false);
      return;
    }
    setAiPlan(plan);
  }, [aiRequested, recoveryLoading, volumeLoading, isLoading, recoveryStatus, volumeData, exercises, lastDone, usageCounts, aiDuration]);

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
          target_sets: plannedSetsFor(exercise.mechanic, aiDuration),
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

  const openAiSheet = () => {
    setAiPlan(null);
    setShowAiSheet(true);
  };

  const startedAtLabel = inProgress?.startedAt
    ? new Date(inProgress.startedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  // Hero eyebrow: "TODAY · MESOCYCLE WK 3" (+ deload flag when applicable).
  const heroEyebrow = activeMeso
    ? `Today · Mesocycle wk ${activeMeso.current_week}${
        activeMeso.current_week === activeMeso.deload_week ? ' · deload' : ''
      }`
    : 'Today';

  // Meta line under the hero title: "7 exercises · est. 65 min · last done Thu".
  const heroMeta = todayWorkout
    ? [
        heroInfo && heroInfo.exerciseCount > 0 ? `${heroInfo.exerciseCount} exercises` : null,
        heroInfo && heroInfo.estMinutes > 0 ? `est. ${heroInfo.estMinutes} min` : null,
        heroInfo?.lastDone ? `last done ${formatRelativeDay(heroInfo.lastDone)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Exercises are planned when you start'
    : null;

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4 pb-4">
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

      {/* Unfinished workout banner (only when a session is in progress today) */}
      {inProgress && (
        <UnfinishedWorkoutBanner
          startedAtLabel={startedAtLabel}
          setsDone={inProgress.setsDone}
          onResume={() => router.push(`/dashboard/workout/${inProgress.id}`)}
          onDiscard={() => setShowDiscardConfirm(true)}
        />
      )}

      {/* Slim daily check-in link (only until today's check-in is done) */}
      {checkInStatus === 'missing' && checkInUserId && (
        <button
          onClick={() => setShowCheckIn(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-900 border border-surface-800 text-left hover:bg-surface-800/70 transition-colors"
        >
          <IconClipboardHeart size={18} className="text-primary-400 flex-shrink-0" aria-hidden="true" />
          <span className="flex-1 text-[13px] text-surface-300">
            Daily check-in
            <span className="text-surface-500"> · How are you feeling today?</span>
          </span>
          <IconChevronRight size={16} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
        </button>
      )}

      {/* Hero: today's mesocycle workout (training day / rest day / no plan) */}
      {activeMeso && todayWorkout ? (
        <LogHeroCard
          variant="primary"
          eyebrow={heroEyebrow}
          title={programDayName ?? todayWorkout.dayName}
          meta={heroMeta ?? ''}
          ctaLabel={isStartingMeso ? 'Starting...' : inProgress ? 'Continue workout' : 'Start workout'}
          ctaDisabled={isStartingMeso}
          onCtaTap={handleStartMesoWorkout}
          onSparkleTap={openAiSheet}
          footnote="adjusts today's volume from recovery data"
        />
      ) : activeMeso ? (
        <LogHeroCard
          variant="muted"
          eyebrow={heroEyebrow}
          title="Rest day"
          meta={
            nextWorkoutInfo
              ? `next: ${nextWorkoutInfo.workout.dayName} · ${nextWorkoutInfo.dayLabel}`
              : 'No upcoming workouts scheduled'
          }
          ctaLabel="View plan"
          onCtaTap={() => router.push('/dashboard/mesocycle')}
          onSparkleTap={openAiSheet}
          footnote="training anyway? builds a workout from recovered muscles"
        />
      ) : (
        !isLoading && (
          <LogHeroCard
            variant="primary"
            eyebrow={heroEyebrow}
            title="No training plan"
            meta="Plan a mesocycle for smart progression and volume tracking"
            ctaLabel="Plan a mesocycle"
            onCtaTap={() => router.push('/dashboard/mesocycle/new')}
            onSparkleTap={openAiSheet}
            footnote="or let AI build today's workout from recovery data"
          />
        )
      )}

      {/* Quick log */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Quick log</SectionLabel>

        <QuickLogRow
          icon={
            <span className="w-10 h-10 rounded-xl bg-success-500/15 flex items-center justify-center flex-shrink-0">
              <IconSalad size={22} className="text-success-400" aria-hidden="true" />
            </span>
          }
          title="Log food"
          subtitle="Meals, barcode, describe with AI"
          onTap={() => router.push('/dashboard/nutrition')}
        />

        <QuickLogRow
          icon={
            <span className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center flex-shrink-0">
              {isStartingBlank ? (
                <IconLoader2 size={22} className="text-primary-400 animate-spin" aria-hidden="true" />
              ) : (
                <IconPlus size={22} className="text-primary-400" aria-hidden="true" />
              )}
            </span>
          }
          title="Blank workout"
          subtitle={isStartingBlank ? 'Starting...' : 'Add exercises as you go'}
          onTap={handleStartBlank}
          disabled={isStartingBlank}
        />
      </div>

      {/* Today so far */}
      {todaySoFar && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Today so far</SectionLabel>
          <TodaySoFarStrip
            data={todaySoFar}
            onNutritionTap={() => router.push('/dashboard/nutrition')}
          />
        </div>
      )}

      {/* AI suggested workout: time question first, then the plan preview;
          nothing is created until Start */}
      <BottomSheet
        isOpen={showAiSheet}
        onClose={() => setShowAiSheet(false)}
        title={aiPlan ? 'Suggested workout' : 'How much time do you have?'}
      >
        {!aiPlan && (
          <div className="space-y-3">
            <p className="text-[13px] text-surface-400">
              We&apos;ll size the workout to fit your time.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {AI_DURATION_CHOICES.map((mins) => (
                <button
                  key={mins}
                  onClick={() => {
                    setAiDuration(mins);
                    setAiRequested(true);
                  }}
                  disabled={aiRequested}
                  className={`p-3 rounded-xl text-center border-2 transition-colors disabled:opacity-60 ${
                    aiRequested && aiDuration === mins
                      ? 'bg-primary-500/20 border-primary-500 text-primary-400'
                      : 'bg-surface-800 border-transparent text-surface-200 hover:bg-surface-700'
                  }`}
                >
                  <span className="block text-[15px] font-semibold">{mins}</span>
                  <span className="block text-[11px] text-surface-500">min</span>
                </button>
              ))}
            </div>
            {aiRequested && (
              <p className="flex items-center gap-2 text-[13px] text-surface-400">
                <IconLoader2 size={14} className="animate-spin" aria-hidden="true" />
                Building suggestion...
              </p>
            )}
          </div>
        )}
        {aiPlan && (
          <div className="space-y-3">
            <p className="text-[13px] text-surface-300">{aiPlan.focus}</p>
            <p className="text-[11px] text-surface-500">Sized for ~{aiDuration} minutes.</p>

            <div className="rounded-xl border border-surface-800 bg-surface-950/40 overflow-hidden">
              {aiPlan.exercises.map((pick) => {
                const exercise = exercises.find((ex) => ex.id === pick.exerciseId);
                if (!exercise) return null;
                const setsPlanned = plannedSetsFor(exercise.mechanic, aiDuration);
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

      {/* Daily check-in modal (same flow as the home dashboard) */}
      {showCheckIn && checkInUserId && (
        <Modal isOpen onClose={() => setShowCheckIn(false)} title="Daily check-in">
          <DailyCheckIn
            userId={checkInUserId}
            userGoal={userGoal}
            onComplete={() => {
              setCheckInStatus('done');
              setShowCheckIn(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
