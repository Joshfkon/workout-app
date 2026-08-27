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
import { useIsRestoring } from '@tanstack/react-query';
import {
  IconChevronRight,
  IconClipboardHeart,
  IconLoader2,
  IconPlus,
  IconSalad,
} from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { resolveAuthState } from '@/lib/supabase/authState';
import { bootMark, bootTraceDump } from '@/lib/perf/bootTrace';
import { getLocalDateString } from '@/lib/utils';
import {
  startMesocycleWorkoutSession,
  getWorkoutForDate,
  getNextWorkoutForDate,
} from '@/lib/training/startMesocycleSession';
import { buildTrainingSchedule } from '@/lib/training/trainingSchedule';
import { getOrCreateTodaySession } from '../workout/_lib/adhocSession';
import { cancelWorkoutSession } from '../workout/[id]/_lib/cancelWorkout';
import { useWorkoutStore } from '@/stores/workoutStore';
import { SuggestedWorkoutSheet } from '@/components/workout/SuggestedWorkoutSheet';
import { Modal } from '@/components/ui/Modal';
import {
  useLogHomeQuery,
  useLogHeroInfoQuery,
  useLogHomeMutator,
} from '@/hooks/useLogPageData';
import { usePrefetchNutrition } from '@/hooks/useNutritionData';
import {
  LogHeroCard,
  QuickLogRow,
  SectionLabel,
  TodaySoFarStrip,
  UnfinishedWorkoutBanner,
  WeightQuickLogRow,
  formatRelativeDay,
} from './_components/LogPageSections';
import { normalizePacingPhase } from '@/services/intakePacing';
import { getDisplayWeight } from '@/lib/weightUtils';
import type { BodyLogSavedDetail } from '@/components/body/LogBodyDataSheet';

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

// getOrCreateTodaySession moved to ../workout/_lib/adhocSession so the
// quick-workout confirm screen shares the exact create/reuse semantics.

export default function LogPage() {
  const router = useRouter();
  const supabase = createUntypedClient();

  // Boot data, cached-first (see hooks/useLogPageData.ts): a returning user's
  // cold start paints the persisted last-seen payload immediately while a
  // background refetch replaces it. `isRestoring` covers the brief IndexedDB
  // rehydration window so the "No training plan" hero can't flash first.
  const homeQuery = useLogHomeQuery();
  const isRestoring = useIsRestoring();
  const mutateHome = useLogHomeMutator();
  const home = homeQuery.data ?? null;
  const isLoading = homeQuery.isPending || isRestoring;

  // Day guard: day-scoped fields (in-progress banner, check-in, today's
  // totals) from a previous day's cached payload must not render as today's.
  // Non-day-scoped fields (mesocycle, weight, units) always paint.
  const today = getLocalDateString();
  const isTodaysData = home?.date === today;

  const inProgress = isTodaysData ? home!.inProgress : null;
  const activeMeso = home?.activeMeso ?? null;
  const todaySoFar = isTodaysData ? home!.todaySoFar : null;
  const checkInUserId = home?.userId ?? null;
  const userGoal = (home?.userGoal ?? undefined) as UserGoal | undefined;
  const lastWeight = home?.lastWeight ?? null;
  const weightUnit = home?.weightUnit ?? 'lb';
  const eatingWindow = home?.eatingWindow;

  // Daily check-in: a slim link is shown only while today's check-in is
  // known-missing; stale-day cache stays hidden until the refresh lands.
  const checkInStatus: 'loading' | 'missing' | 'done' = !isTodaysData
    ? 'loading'
    : home!.checkInDone
      ? 'done'
      : 'missing';

  // Hero meta (exercise count / est. duration / last done): a dependent query
  // whose extra round trips fill the meta line in without gating first paint.
  // Declared before todayWorkout because its completed-today count picks
  // which of a two-a-day date's sessions the hero shows next.
  const heroQuery = useLogHeroInfoQuery(activeMeso);

  // Today's scheduled split day, derived from the calendar (time-dependent,
  // so computed at render rather than cached). On a two-a-day date this is
  // the NEXT undone session (the PM slot once the AM session is completed);
  // until the hero query lands it defaults to the day's first session.
  const todayWorkout = useMemo(() => {
    if (!activeMeso) return null;
    return getNextWorkoutForDate(
      activeMeso.split_type,
      new Date(),
      buildTrainingSchedule(activeMeso),
      heroQuery.data?.completedTodayCount ?? 0
    );
  }, [activeMeso, heroQuery.data?.completedTodayCount]);
  const programDayName = heroQuery.data?.programDayName ?? null;
  const heroInfo = useMemo(
    () =>
      heroQuery.data
        ? {
            exerciseCount: heroQuery.data.exerciseCount,
            estMinutes: heroQuery.data.estMinutes,
            lastDone: heroQuery.data.lastDoneAt ? new Date(heroQuery.data.lastDoneAt) : null,
          }
        : null,
    [heroQuery.data]
  );

  const [isStartingMeso, setIsStartingMeso] = useState(false);
  const [isStartingBlank, setIsStartingBlank] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);

  // AI suggested workout (shared sheet — mounts and fetches on first open)
  const [showAiSheet, setShowAiSheet] = useState(false);

  const [showWeightSheet, setShowWeightSheet] = useState(false);

  // Warm the Eat tab's queries once this page has its own data — the most
  // common next tap. Kills the nutrition full-loading flash on new-day /
  // fresh-cache sessions (see usePrefetchNutrition).
  usePrefetchNutrition(!isLoading);

  // Boot timeline: first paint of the Log page with real data. Double-rAF so
  // the mark lands after the browser actually painted the post-fetch render.
  useEffect(() => {
    if (isLoading) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        bootMark('home-paint');
        bootTraceDump();
      })
    );
  }, [isLoading]);

  // Next scheduled training day (for the rest-day hero subtitle).
  const nextWorkoutInfo = useMemo(() => {
    if (!activeMeso || todayWorkout) return null;
    const schedule = buildTrainingSchedule(activeMeso);
    // 14 days, not 7: an every-N-days cadence can leave a gap longer than a
    // week between sessions that share a weekday.
    for (let offset = 1; offset <= 14; offset++) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      const workout = getWorkoutForDate(activeMeso.split_type, date, schedule);
      if (workout) {
        return {
          workout,
          dayLabel:
            offset === 1
              ? 'tomorrow'
              : date.toLocaleDateString(
                  'en-US',
                  offset <= 7 ? { weekday: 'short' } : { weekday: 'short', month: 'short', day: 'numeric' }
                ),
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
      mutateHome((d) => ({ ...d, inProgress: null }));
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
  // mirror the saved value into the cached payload so the row flips to its
  // logged state (and a revisit never shows the pre-save value).
  const handleWeightSaved = (detail: BodyLogSavedDetail) => {
    if (detail.kind !== 'weight' || detail.weight == null) return;
    mutateHome((d) =>
      d.lastWeight && d.lastWeight.date > detail.date
        ? d
        : {
            ...d,
            lastWeight: { date: detail.date, weight: detail.weight!, unit: detail.unit ?? weightUnit },
          }
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
              mutateHome((d) => ({ ...d, checkInDone: true }));
              setShowCheckIn(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
