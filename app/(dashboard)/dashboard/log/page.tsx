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
 *   4. "Quick log" rows: Log food -> /dashboard/nutrition, Blank workout ->
 *      creates/reuses today's session (no exercise blocks) and opens the
 *      workout page (repeat taps reuse the same session), and Log weight ->
 *      opens the shared LogBodyDataSheet prefilled with the latest weigh-in
 *      (state-aware: once logged today it shows the value + checkmark and
 *      edits the same weight_log day-row).
 *   5. "Today so far" grid: calories/protein/carbs/fat from today's food log
 *      vs nutrition targets, each tile carrying a phase-aware time-of-day
 *      pacing verdict (services/intakePacing — same engine as the Home
 *      Nutrition tile), plus steps from wearable daily activity data
 *      (tile hidden when there's no activity row for today).
 *
 * The AI suggested workout flow lives in the shared SuggestedWorkoutSheet
 * (also launched from the Train tab): plan from muscle recovery + weekly
 * volume (services/suggestedWorkout, pure), previewed, and only written
 * when the user taps Start.
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
} from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { resolveAuthState } from '@/lib/supabase/authState';
import { getLocalDateString } from '@/lib/utils';
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
import { SuggestedWorkoutSheet } from '@/components/workout/SuggestedWorkoutSheet';
import { Modal } from '@/components/ui/Modal';
import { getSessionFromProgramData, type ExerciseOverride } from '@/services/mesocycleHelpers';
import {
  LogHeroCard,
  QuickLogRow,
  SectionLabel,
  TodaySoFarStrip,
  UnfinishedWorkoutBanner,
  WeightQuickLogRow,
  formatRelativeDay,
  type TodaySoFar,
} from './_components/LogPageSections';
import { normalizePacingPhase, type EatingWindow } from '@/services/intakePacing';
import { fetchEatingWindow } from '@/lib/nutrition/eatingWindow';
import { getDisplayWeight } from '@/lib/weightUtils';
import type { BodyLogSavedDetail } from '@/components/body/LogBodyDataSheet';
import type { FullProgramRecommendation, WorkoutDay } from '@/types/schema';

// Lazy-load the check-in flow so it only ships when the user opens it
// (same pattern as the home dashboard's quick-log modals).
const DailyCheckIn = dynamic(
  () => import('@/components/dashboard/DailyCheckIn').then((mod) => ({ default: mod.DailyCheckIn })),
  { ssr: false }
);

// Weight entry uses the same unified sheet as the Home Weight tile's "+ log",
// so both surfaces share one write path (weight_log via saveWeightLogEntry —
// per-day upsert, which also feeds the anchored body-comp trend).
const LogBodyDataSheet = dynamic(
  () => import('@/components/body/LogBodyDataSheet').then((mod) => ({ default: mod.LogBodyDataSheet })),
  { ssr: false }
);

type UserGoal = 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';

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

// getOrCreateTodaySession moved to ../workout/_lib/adhocSession so the
// quick-workout confirm screen shares the exact create/reuse semantics.

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

  // AI suggested workout (shared sheet — mounts and fetches on first open)
  const [showAiSheet, setShowAiSheet] = useState(false);

  // Weight quick-log: most recent weight_log row (drives the row's state and
  // the sheet's prefill), the display unit, and the pacing eating window.
  const [lastWeight, setLastWeight] = useState<{ date: string; weight: number; unit: 'lb' | 'kg' } | null>(null);
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');
  const [eatingWindow, setEatingWindow] = useState<EatingWindow | undefined>(undefined);
  const [showWeightSheet, setShowWeightSheet] = useState(false);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchAll() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = getLocalDateString();
      const [
        inProgressRes,
        mesoRes,
        checkInRes,
        goalRes,
        foodRes,
        targetsRes,
        activityRes,
        lastWeightRes,
        prefsRes,
        windowRes,
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
          .select('calories, protein, carbs, fat')
          .eq('user_id', user.id)
          .eq('logged_at', today),
        supabase
          .from('nutrition_targets')
          .select('calories, protein, carbs, fat')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('daily_activity_data')
          .select('steps_total')
          .eq('user_id', user.id)
          .eq('date', today)
          .maybeSingle(),
        supabase
          .from('weight_log')
          .select('logged_at, weight, unit')
          .eq('user_id', user.id)
          .order('logged_at', { ascending: false })
          .limit(1),
        supabase
          .from('user_preferences')
          .select('weight_unit')
          .eq('user_id', user.id)
          .maybeSingle(),
        fetchEatingWindow(supabase, user.id),
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

      // "Today so far" strip. food_log rows can be missing entirely (nothing
      // logged) and the activity row only exists when a wearable synced.
      const foodRows = (foodRes.data ?? []) as {
        calories: number | null;
        protein: number | null;
        carbs: number | null;
        fat: number | null;
      }[];
      const targets = targetsRes.data as {
        calories: number | null;
        protein: number | null;
        carbs: number | null;
        fat: number | null;
      } | null;
      const activity = activityRes.data as { steps_total: number | null } | null;
      const sumOf = (key: 'calories' | 'protein' | 'carbs' | 'fat') =>
        Math.round(foodRows.reduce((sum, r) => sum + (r[key] || 0), 0));
      setTodaySoFar({
        calories: sumOf('calories'),
        protein: sumOf('protein'),
        carbs: sumOf('carbs'),
        fat: sumOf('fat'),
        caloriesTarget: targets?.calories ?? null,
        proteinTarget: targets?.protein ?? null,
        carbsTarget: targets?.carbs ?? null,
        fatTarget: targets?.fat ?? null,
        steps: activity?.steps_total ?? null,
      });

      // Weight quick-log state: preferred display unit, newest weigh-in, and
      // the eating window that shapes the macro tiles' pacing verdicts.
      const preferredUnit =
        ((prefsRes.data as { weight_unit: string | null } | null)?.weight_unit as 'lb' | 'kg') ||
        'lb';
      setWeightUnit(preferredUnit);
      const lastWeightRow = (lastWeightRes.data?.[0] ?? null) as {
        logged_at: string;
        weight: number;
        unit: 'lb' | 'kg' | null;
      } | null;
      if (lastWeightRow) {
        setLastWeight({
          date: lastWeightRow.logged_at,
          weight: lastWeightRow.weight,
          unit: lastWeightRow.unit || preferredUnit,
        });
      }
      setEatingWindow(windowRes);

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
      const auth = await resolveAuthState(supabase);
      if (auth.status === 'unauthenticated') {
        router.push('/login');
        return;
      }
      if (auth.status === 'error') {
        // Verify failed transiently — don't sign the user out; let them retry.
        setError("Couldn't verify your session. Check your connection and try again.");
        setIsStartingBlank(false);
        return;
      }
      const { sessionId } = await getOrCreateTodaySession(supabase, auth.userId);
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

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  // Weight quick-log row state: today's entry (checkmark + edit-on-tap) vs
  // the most recent prior entry (prompt with last weight). Values render in
  // the preferred unit regardless of the unit they were logged in.
  const weightDisplayValue = lastWeight
    ? getDisplayWeight(lastWeight.weight, lastWeight.unit, weightUnit)
    : null;
  const weightLoggedToday = lastWeight?.date === getLocalDateString();
  const todayWeightLabel =
    weightLoggedToday && weightDisplayValue != null
      ? `${weightDisplayValue.toFixed(1)} ${weightUnit}`
      : null;
  const lastWeightLabel = (() => {
    if (weightLoggedToday || !lastWeight || weightDisplayValue == null) return null;
    const day = formatRelativeDay(new Date(`${lastWeight.date}T00:00:00`));
    return `${day.charAt(0).toUpperCase()}${day.slice(1)}: ${weightDisplayValue.toFixed(1)} ${weightUnit}`;
  })();

  // The sheet upserts weight_log's day-row (no duplicate same-day entries);
  // mirror the saved value locally so the row flips to its logged state.
  const handleWeightSaved = (detail: BodyLogSavedDetail) => {
    if (detail.kind !== 'weight' || detail.weight == null) return;
    setLastWeight((prev) =>
      prev && prev.date > detail.date
        ? prev
        : { date: detail.date, weight: detail.weight!, unit: detail.unit ?? weightUnit }
    );
  };

  const openAiSheet = () => setShowAiSheet(true);

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

        <WeightQuickLogRow
          todayLabel={todayWeightLabel}
          lastLabel={lastWeightLabel}
          onTap={() => setShowWeightSheet(true)}
        />
      </div>

      {/* Today so far */}
      {todaySoFar && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Today so far</SectionLabel>
          <TodaySoFarStrip
            data={todaySoFar}
            phase={normalizePacingPhase(userGoal)}
            eatingWindow={eatingWindow}
            onNutritionTap={() => router.push('/dashboard/nutrition')}
          />
        </div>
      )}

      {/* Weight quick-log sheet (shared with the Home Weight tile's "+ log");
          prefilled with the latest weight for single-digit edits */}
      {showWeightSheet && (
        <LogBodyDataSheet
          isOpen
          onClose={() => setShowWeightSheet(false)}
          preferredUnit={weightUnit}
          initialWeight={weightDisplayValue}
          onSaved={handleWeightSaved}
        />
      )}

      {/* AI suggested workout (shared with the Train tab): time question
          first, then the plan preview; nothing is created until Start */}
      {showAiSheet && (
        <SuggestedWorkoutSheet isOpen onClose={() => setShowAiSheet(false)} />
      )}

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
