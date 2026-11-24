'use client';

import { addFoodHref } from '@/lib/nutrition/addFoodLink';
import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Button, PageSkeleton } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import { getLocalDateString } from '@/lib/utils';
import type { MealType } from '@/types/nutrition';
import { type MuscleVolumeData } from '@/services/volumeTracker';
import { STANDARD_MUSCLE_DISPLAY_NAMES, legacyToStandardMuscles, isStandardMuscle, type StandardMuscleGroup, type WorkoutDay, type Rating } from '@/types/schema';
import { toStandardMuscleForVolume } from '@/lib/migrations/muscle-groups';
import { AtrophyRiskAlert } from '@/components/analytics/AtrophyRiskAlert';
import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  buildVolumeRows,
  coarseMevTiles,
  belowMevVolumeData,
  weeklyVolumeWindowStartISO,
  type MuscleVolumeStats,
} from './_lib/weeklyVolume';
import {
  computeLiftTrends,
  LIFT_TREND_SESSION_SELECT,
  LIFT_TREND_WINDOW_DAYS,
  type LiftTrendsSummary,
} from './_lib/liftTrends';
import type { BodyCompGlance } from '@/lib/actions/dashboard';
import { computeWeightRate } from './_lib/weightRate';
import { computeWeekSessions } from './_lib/weekSessions';
// Direct from the pure schedule module — importing the re-export on
// startMesocycleSession would drag its session-building deps into this bundle.
import {
  buildTrainingSchedule,
  getNextWorkoutForDate,
  resolveScheduledSlots,
  type ScheduleMode,
  type TodayWorkout,
  type TrainingSchedule,
} from '@/lib/training/trainingSchedule';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { useBodyOrFoodLogged } from '@/hooks/useBodyOrFoodLogged';
import { homeFocus } from '@/components/dashboard/home/homeFocus';
import { statedTrackingFocus, type StatedTrackingFocus } from '@/lib/onboarding/trackingFocus';
import { useSleepLog } from '@/hooks/useSleepLog';
import { calculateReadinessScore } from '@/services/fatigueEngine';
import { startMesocycleWorkoutSession } from '@/lib/training/startMesocycleSession';
import type { WorkoutStartStage } from '@/components/workout/WorkoutStartProgress';
import { runNavigateFirstStart } from '@/lib/training/pendingWorkoutStart';
import { fetchActiveMesocycle, type ActiveMesocycleRow } from '@/lib/training/fetchActiveMesocycle';
import {
  applyDeloadToUpcomingWeek,
  deriveDeloadType,
  dismissDeloadRecommendation,
  fetchDeloadRecommendation,
  type DeloadRecommendation,
  type DeloadType,
} from '@/lib/training/deloadRecommendation';
import {
  acceptStandaloneLightWeek,
  dismissStandaloneDeloadRecommendation,
  fetchStandaloneDeloadRecommendation,
} from '@/lib/training/standaloneDeload';
import { GlanceHeader, TodayHeroCard, MetricTileGrid, QuickLogRow, PhaseSelector, VolumeRampBanner, WaistPaceCheckCard, intakePaceLabel, HealthGlanceCard, useHealthGlance, TodayCard, TodaySheet, NudgeCard, pickHomeNudge } from '@/components/dashboard/home';
import { intakePaceVerdict } from '@/components/dashboard/home/intakePace';
import { FreestyleStartActions } from '@/components/dashboard/home/FreestyleStartActions';
import { HomeStartWorkout } from '@/components/dashboard/home/HomeStartWorkout';
import { PlanBlockShortcut } from '@/components/dashboard/home/PlanBlockShortcut';
import { TextSizePromptCard } from '@/components/dashboard/home/TextSizePromptCard';
import { useTrackingFocus } from '@/hooks/useTrackingFocus';
import { useLiveHeroWorkout } from '@/hooks/useLiveHeroWorkout';
import { useBeginnerMode } from '@/hooks/useBeginnerMode';
import { beginnerPickReason, plainWorkoutText } from '@/lib/beginnerMode';
import { WeeklySetsCard } from '@/components/dashboard/home/WeeklySetsCard';
import { heroOffersWorkoutStart, todayHeroVariant } from '@/components/dashboard/home/TodayHeroCard';
import { normalizePacingPhase, type EatingWindow } from '@/services/intakePacing';
import { fetchEatingWindow } from '@/lib/nutrition/eatingWindow';
import { useStepCalorieAdjustment } from '@/hooks/useStepCalorieAdjustment';
import { applyAdjustmentToMacros } from '@/lib/nutrition/step-calorie-adjustment';
import { updateTodayWorkoutWidget, updateNutritionWidget } from '@/lib/integrations/liveActivity';
import type { TodaysWorkout, GlanceVolumeSummary, GlanceWeightRate, MealHeroSuggestion } from '@/components/dashboard/home';
import type { TrainingStyle } from '@/lib/training/trainingStyle';
import { fetchTrainingStyleData } from '@/lib/actions/dashboard';
import { usePrefetchSettings } from '@/hooks/useSettingsQuery';
import type { TrainingPhase, UpdatePhaseResult } from '@/lib/actions/phase';

// Loading placeholder for lazily-loaded modal content
const CardSkeleton = () => (
  <div className="animate-pulse bg-fill rounded-lg p-4 space-y-3">
    <div className="h-4 bg-sep rounded w-3/4" />
    <div className="h-8 bg-sep rounded w-full" />
  </div>
);

// Lazy load modal content — only fetched when a quick-log modal opens

const LogBodyDataSheet = dynamic(
  () => import('@/components/body/LogBodyDataSheet').then(mod => ({ default: mod.LogBodyDataSheet })),
  { ssr: false }
);

const DailyCheckIn = dynamic(
  () => import('@/components/dashboard/DailyCheckIn').then(mod => ({ default: mod.DailyCheckIn })),
  { ssr: false, loading: () => <CardSkeleton /> }
);

const HydrationTracker = dynamic(
  () => import('@/components/dashboard/HydrationTracker').then(mod => ({ default: mod.HydrationTracker })),
  { ssr: false, loading: () => <CardSkeleton /> }
);

const CardioTracker = dynamic(
  () => import('@/components/dashboard/CardioTracker').then(mod => ({ default: mod.CardioTracker })),
  { ssr: false, loading: () => <CardSkeleton /> }
);

const SleepQuickLog = dynamic(
  () => import('@/components/dashboard/SleepQuickLog').then(mod => ({ default: mod.SleepQuickLog })),
  { ssr: false, loading: () => <CardSkeleton /> }
);

const LogBloodPressureModal = dynamic(
  () => import('@/components/dashboard/LogBloodPressureModal').then(mod => ({ default: mod.LogBloodPressureModal })),
  { ssr: false }
);

// Static import (item 6): AtrophyRiskAlert is the dashboard's LCP element.
// As a next/dynamic component it was code-split, and during hydration the
// dynamic boundary flashed its `loading` skeleton over the SSR'd card until
// its separate chunk finished downloading (~6s under Lighthouse's 4x/slow-4G
// throttle) — so LCP was recorded when the card re-appeared, not at first
// paint. Bundling it statically (small component, UI-only imports) removes
// the extra chunk and the swap; with weekly volume already in server
// initialData, the card now paints with the initial HTML.

// Both localStorage snapshots are keyed PER USER (`<prefix>:<userId>`): an
// unscoped key let the previous account's weight history / calories paint for
// whoever signed in next on the same browser. Sign-out also removes every key
// with these prefixes (lib/query/clientCachePurge).
const WEIGHT_HISTORY_CACHE_KEY = 'weight_history_cache';
const WEIGHT_HISTORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const DASHBOARD_CACHE_KEY = 'dashboard_data_cache';
const userCacheKey = (prefix: string, uid: string) => `${prefix}:${uid}`;
const DASHBOARD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes - short TTL for fresh data

// Type for cached dashboard data
interface DashboardCacheData {
  userId: string;
  userGoal: 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';
  activeMesocycle: ActiveMesocycle | null;
  nutritionTotals: NutritionTotals;
  nutritionTargets: NutritionTargets | null;
  todaysWeight: { weight: number; unit: string } | null;
  weightUnit: 'lb' | 'kg';
  muscleVolume: MuscleVolumeStats[];
  timestamp: number;
  dateKey: string; // To invalidate cache on new day
}

// the MEV table, ALL_MUSCLE_GROUPS, accumulateExerciseVolume, volumeAccumulatorToStats,
// VolumeAccumulator, MuscleVolumeStats now live in ./_lib/weeklyVolume (shared with
// the server initial-data path, item 6). Imported above.

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  cardio_prescription?: any;
}

// ExerciseVolume / MuscleVolumeStats imported from ./_lib/weeklyVolume.

interface ActiveMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  workoutsCompleted: number;
  totalWorkouts: number;
  splitType?: string;
  daysPerWeek?: number;
  preferredWorkoutDays?: WorkoutDay[] | null;
  /** Schedule shape: fixed weekdays, or every-N-days from startDate. */
  scheduleMode?: ScheduleMode | null;
  trainingIntervalDays?: number | null;
  /** 1 = one session per training date; 2 = two-a-day. */
  sessionsPerDay?: number | null;
  /** Completed sessions dated today — picks a two-a-day date's next session. */
  completedTodayCount?: number | null;
  /** Sessions completed vs expected inside the current mesocycle week. */
  weekSessionsDone?: number;
  weekSessionsTotal?: number;
}

// The schedule's own type: always produced by getNextWorkoutForDate, and
// handed straight to startMesocycleWorkoutSession as its todayWorkout.
type ScheduledWorkout = TodayWorkout;

/** Resolve the calendar for a dashboard mesocycle summary (camelCase fields). */
function scheduleFor(mesocycle: ActiveMesocycle): TrainingSchedule {
  return buildTrainingSchedule({
    days_per_week: mesocycle.daysPerWeek || 4,
    preferred_workout_days: mesocycle.preferredWorkoutDays,
    schedule_mode: mesocycle.scheduleMode,
    training_interval_days: mesocycle.trainingIntervalDays,
    sessions_per_day: mesocycle.sessionsPerDay,
    start_date: mesocycle.startDate,
  });
}

// TodaysWorkout now lives in components/dashboard/home/TodayHeroCard.tsx

/** Per-block info fetched for the hero coach line (no AI call — pure derivation). */
interface HeroBlockInfo {
  suggestionReason: string | null;
  primaryMuscle: string | null;
}

/** Today's daily check-in row fields used for the readiness pill. */
interface CheckInRow {
  sleep_hours: number | null;
  sleep_quality: number | null;
  energy_level: number | null;
  mood_rating: number | null;
  stress_level: number | null;
}

/**
 * Derive a 0-100 readiness score from the daily check-in using the existing
 * pure fatigue-engine scorer. Check-in fields map onto ReadinessInput:
 * the logged stress level is used directly when present (older rows predate
 * the stress question, so mood inverts to stress as a fallback — low mood ~
 * high stress) and energy stands in for the fueling/nutrition rating.
 */
function readinessFromCheckIn(row: CheckInRow): number {
  const clampRating = (v: number | null): Rating | null =>
    v == null ? null : (Math.min(5, Math.max(1, Math.round(v))) as Rating);
  return calculateReadinessScore({
    sleepHours: row.sleep_hours,
    sleepQuality: clampRating(row.sleep_quality),
    stressLevel:
      clampRating(row.stress_level) ??
      (row.mood_rating == null ? null : clampRating(6 - row.mood_rating)),
    nutritionRating: clampRating(row.energy_level),
  });
}

/** Infer the meal for quick food logging from the time of day. */
function inferMealType(now: Date): MealType {
  const hour = now.getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 20) return 'dinner';
  return 'snack';
}

// Props for server-side initial data
interface DashboardInitialData {
  userId: string;
  /**
   * The calendar day (YYYY-MM-DD) the server computed the daily data for.
   * When it isn't the device's local day (host in another zone before the
   * timezone cookie exists, or an offline-fallback copy of an older render)
   * the client ignores the fast path and refetches for its own day.
   */
  dateKey?: string;
  mesocycle: ActiveMesocycle | null;
  todaysWorkout: TodaysWorkout | null;
  /** lib/training/trainingStyle — freestyle hides the plan and shows
   *  freestyleTodaysWorkout (today's workout, whatever started it). */
  trainingStyle?: TrainingStyle;
  freestyleTodaysWorkout?: TodaysWorkout | null;
  nutritionTotals: NutritionTotals;
  nutritionTargets: NutritionTargets | null;
  todaysWeight: { weight: number; unit: string } | null;
  weightHistory: { date: string; weight: number; unit: string }[];
  weightUnit: 'lb' | 'kg';
  userGoal: 'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance';
  completedWorkoutsCount: number;
  /** Weekly per-muscle volume (item 6): seeds the atrophy card server-side. */
  muscleVolume?: MuscleVolumeStats[];
  /** Standard muscles the user's exercises can credit — gates fine-muscle warnings. */
  reachableMuscles?: StandardMuscleGroup[];
  /** Lift trend summary for the "Lifts" glance tile. */
  liftTrends?: LiftTrendsSummary | null;
  /** Body-comp glance tile (≥2 DEXA scans + height); null hides the tile. */
  bodyCompGlance?: BodyCompGlance | null;
  /** Sign-up's "No, food tracking" answer (lib/onboarding/trackingFocus). */
  statedFocus?: StatedTrackingFocus | null;
}

interface DashboardClientProps {
  initialData?: DashboardInitialData;
}

type QuickLogModal = 'weight' | 'water' | 'cardio' | 'checkin' | 'sleep' | 'bp' | 'today';

export function DashboardClient({ initialData }: DashboardClientProps) {
  // If we have server-fetched initialData, skip loading state entirely
  const hasInitialData = !!initialData;
  const router = useRouter();
  // Food-only (said "food tracking", never lifted here): no workout entries.
  const { foodOnly } = useTrackingFocus();
  const beginnerMode = useBeginnerMode();
  // Warm Settings behind the gear so its first open renders at once.
  usePrefetchSettings();
  const supabase = createUntypedClient();

  const [isLoading, setIsLoading] = useState(!hasInitialData);
  const [activeMesocycle, setActiveMesocycle] = useState<ActiveMesocycle | null>(initialData?.mesocycle ?? null);
  const [todaysWorkout, setTodaysWorkout] = useState<TodaysWorkout | null>(initialData?.todaysWorkout ?? null);
  const [scheduledWorkout, setScheduledWorkout] = useState<ScheduledWorkout | null>(() => {
    // Computed even when today's session already has blocks — the hero uses
    // the split-day name ("Chest & Back") as its title and the muscle list
    // for the recovery note, not just as the block-less fallback.
    if (!initialData?.mesocycle) return null;
    return getNextWorkoutForDate(
      initialData.mesocycle.splitType || 'Upper/Lower',
      new Date(),
      scheduleFor(initialData.mesocycle),
      initialData.mesocycle.completedTodayCount ?? 0
    );
  });
  // Freestyle (lib/training/trainingStyle): the plan is hidden everywhere on
  // Home — no plan card, week label, plan deload card or week-1 banner — and
  // the hero shows today's workout whatever started it. The mesocycle state
  // above stays as fetched; only these derived values feed the UI.
  const [trainingStyle, setTrainingStyle] = useState<TrainingStyle>(
    initialData?.trainingStyle ?? 'plan'
  );
  const [freestyleTodaysWorkout, setFreestyleTodaysWorkout] = useState<TodaysWorkout | null>(
    initialData?.freestyleTodaysWorkout ?? null
  );
  const isFreestyle = trainingStyle === 'freestyle';
  const planMesocycle = isFreestyle ? null : activeMesocycle;
  const heroWorkout = useLiveHeroWorkout(isFreestyle ? freestyleTodaysWorkout : todaysWorkout);
  const heroScheduled = isFreestyle ? null : scheduledWorkout;
  const [nutritionTotals, setNutritionTotals] = useState<NutritionTotals>(initialData?.nutritionTotals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(initialData?.nutritionTargets ?? null);
  // Seed from server initialData (item 6) so the atrophy card renders in the
  // SSR HTML — it's the dashboard's LCP element and previously waited on a
  // post-hydration weekly-volume fetch. The client fetch below still runs to
  // refresh, but no longer gates first paint.
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolumeStats[]>(initialData?.muscleVolume ?? []);
  // Standard muscles the user's exercises can credit — gates the three fine
  // muscles (erectors/glute_med/obliques) so the atrophy card never nags about
  // a muscle no logged exercise could satisfy. Undefined until the first fetch.
  const [reachableMuscles, setReachableMuscles] = useState<StandardMuscleGroup[] | undefined>(initialData?.reachableMuscles);
  const [liftTrends, setLiftTrends] = useState<LiftTrendsSummary | null>(initialData?.liftTrends ?? null);
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>(initialData?.weightUnit ?? 'lb');
  const [todaysWeight, setTodaysWeight] = useState<{ weight: number; unit: string } | null>(initialData?.todaysWeight ?? null);
  const [weightHistory, setWeightHistory] = useState<{ date: string; weight: number; unit: string }[]>(initialData?.weightHistory ?? []);
  const [userId, setUserId] = useState<string | null>(initialData?.userId ?? null);
  const [userGoal, setUserGoal] = useState<'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance'>(initialData?.userGoal ?? 'maintain');
  // What the user said at sign-up they're here for. Lives on the auth user,
  // which both the server page and the client fetch already have in hand.
  const [statedFocus, setStatedFocus] = useState<StatedTrackingFocus | null>(initialData?.statedFocus ?? null);
  // Eating window for intake pacing (07:00–21:00 until the user's row loads).
  const [eatingWindow, setEatingWindow] = useState<EatingWindow | undefined>(undefined);

  // Which quick-log modal is open (the old scroll-to detail cards were removed).
  const [activeModal, setActiveModal] = useState<QuickLogModal | null>(null);

  // Pending deload recommendation on the active mesocycle (Phase 1.4).
  // Fetched separately from the main dashboard load so the cached initial
  // data path doesn't need to change shape.
  const [deloadRecommendation, setDeloadRecommendation] = useState<DeloadRecommendation | null>(null);
  const [isResolvingDeload, setIsResolvingDeload] = useState(false);
  // Standalone (no-mesocycle) variant: pending recommendation stamped on the
  // user row, plus the deload type of a just-accepted light week so the card
  // can swap to one-shot guidance copy ("cut sets roughly in half…").
  const [standaloneDeload, setStandaloneDeload] = useState<DeloadRecommendation | null>(null);
  const [plannedLightWeekType, setPlannedLightWeekType] = useState<DeloadType | null>(null);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);
  const [startWorkoutStage, setStartWorkoutStage] = useState<WorkoutStartStage>('preparing');
  const [startWorkoutError, setStartWorkoutError] = useState<string | null>(null);
  // Full active mesocycle row with all fields for startMesocycleWorkoutSession
  const [fullActiveMeso, setFullActiveMeso] = useState<ActiveMesocycleRow | null>(null);
  const activeMesocycleId = planMesocycle?.id ?? null;

  // The server snapshot leaves out the full mesocycle row (program_data is
  // large), so a Start tap used to fetch it first: one more round trip before
  // the workout screen. Fetch it once Home is idle when today offers a
  // scheduled start, so the tap goes straight to building the session.
  const needsFullMesoForStart =
    !!userId && !!activeMesocycle && !!scheduledWorkout && fullActiveMeso?.id !== activeMesocycle.id;
  useEffect(() => {
    if (!needsFullMesoForStart || !userId) return;
    let cancelled = false;
    const load = () => {
      fetchActiveMesocycle(supabase, userId)
        .then((row) => {
          if (!cancelled && row) setFullActiveMeso(row);
        })
        .catch(() => {
          // Optimisation only: the start path fetches it itself if missing.
        });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(load, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFullMesoForStart, userId]);

  useEffect(() => {
    let cancelled = false;
    if (!activeMesocycleId) {
      setDeloadRecommendation(null);
      // No active mesocycle: surface the standalone recommendation instead.
      if (!userId) {
        setStandaloneDeload(null);
        return;
      }
      (async () => {
        try {
          const supabase = createUntypedClient();
          const recommendation = await fetchStandaloneDeloadRecommendation(supabase, userId);
          if (!cancelled) setStandaloneDeload(recommendation);
        } catch (err) {
          console.error('Failed to load standalone deload recommendation:', err);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    setStandaloneDeload(null);
    (async () => {
      try {
        const supabase = createUntypedClient();
        const recommendation = await fetchDeloadRecommendation(supabase, activeMesocycleId);
        if (!cancelled) setDeloadRecommendation(recommendation);
      } catch (err) {
        console.error('Failed to load deload recommendation:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMesocycleId, userId]);

  const handleAcceptDeload = async () => {
    if (!activeMesocycleId || isResolvingDeload) return;
    setIsResolvingDeload(true);
    try {
      const supabase = createUntypedClient();
      await applyDeloadToUpcomingWeek(supabase, activeMesocycleId);
      setDeloadRecommendation(null);
    } catch (err) {
      console.error('Failed to apply deload week:', err);
    } finally {
      setIsResolvingDeload(false);
    }
  };

  const handleDismissDeload = async () => {
    if (!activeMesocycleId || isResolvingDeload) return;
    setIsResolvingDeload(true);
    try {
      const supabase = createUntypedClient();
      await dismissDeloadRecommendation(supabase, activeMesocycleId);
      setDeloadRecommendation(null);
    } catch (err) {
      console.error('Failed to dismiss deload recommendation:', err);
    } finally {
      setIsResolvingDeload(false);
    }
  };

  // Standalone variant: accepting stamps users.standalone_deload_week (which
  // suppresses re-checks and resets the streak counter) — there is no program
  // week to transform, so the "application" is the guidance the card swaps to.
  const handleAcceptLightWeek = async () => {
    if (!userId || !standaloneDeload || isResolvingDeload) return;
    setIsResolvingDeload(true);
    try {
      const supabase = createUntypedClient();
      await acceptStandaloneLightWeek(supabase, userId);
      setPlannedLightWeekType(deriveDeloadType(standaloneDeload.reasons));
      setStandaloneDeload(null);
    } catch (err) {
      console.error('Failed to plan standalone light week:', err);
    } finally {
      setIsResolvingDeload(false);
    }
  };

  const handleDismissStandaloneDeload = async () => {
    if (!userId || isResolvingDeload) return;
    setIsResolvingDeload(true);
    try {
      const supabase = createUntypedClient();
      await dismissStandaloneDeloadRecommendation(supabase, userId);
      setStandaloneDeload(null);
    } catch (err) {
      console.error('Failed to dismiss standalone deload recommendation:', err);
    } finally {
      setIsResolvingDeload(false);
    }
  };

  // Start today's mesocycle workout (same logic as Train page).
  const handleStartWorkout = async () => {
    if (!activeMesocycle || !scheduledWorkout || isStartingWorkout) return;
    setIsStartingWorkout(true);
    setStartWorkoutStage('preparing');
    setStartWorkoutError(null);
    try {
      // Fetch the full mesocycle row if we don't have it yet. The initial
      // data path doesn't include program_data/overrides (large fields), so
      // we need to fetch them for the start path.
      let mesoForStart = fullActiveMeso;
      if (!mesoForStart || mesoForStart.id !== activeMesocycle.id) {
        if (!userId) throw new Error('User not authenticated');
        mesoForStart = await fetchActiveMesocycle(supabase, userId);
        if (!mesoForStart) throw new Error('Active mesocycle not found');
        setFullActiveMeso(mesoForStart);
      }

      const meso = mesoForStart;
      // Navigate-first: the workout screen opens as soon as the session row
      // exists (2 round trips) and shows its skeleton while the exercises are
      // built there, instead of Home waiting ~8 round trips for the whole
      // build and only then starting the route load.
      await runNavigateFirstStart({
        start: ({ sessionReady, stage, preview }) =>
          startMesocycleWorkoutSession({
            supabase,
            mesocycle: meso,
            todayWorkout: scheduledWorkout,
            completedSessions: activeMesocycle.workoutsCompleted,
            userId: userId ?? undefined,
            onStage: (s, id) => {
              if (s === 'building') sessionReady(id);
              stage(s);
            },
            onPreview: preview,
          }),
        navigate: (id) => {
          setStartWorkoutStage('opening');
          router.push(`/dashboard/workout/${id}`);
        },
      });
    } catch (err) {
      console.error('Failed to start workout:', err);
      const message = err instanceof Error ? err.message : 'Failed to start workout';
      setStartWorkoutError(message);
      setIsStartingWorkout(false);
    }
  };

  // Recovery data for the hero's "all target muscles recovered" note. While
  // loading, the hook reports every muscle as ready (empty training map), so
  // the note is suppressed until real data arrives.
  const { recoveringMuscles, isLoading: recoveryLoading } = useMuscleRecovery();
  // Ever logged food or a weigh-in (persisted, two one-row probes): one of
  // the signals that Home should lead with food. Never blocks rendering.
  const { data: hasLoggedBodyOrFood } = useBodyOrFoodLogged();

  // Sleep glance data for the grid's Sleep tile (last night + 7-day average +
  // trailing-week sparkline). Same shared cache the quick-log sheet writes to.
  const { entries: sleepEntries, lastNight, sevenDayAvgHours } = useSleepLog();
  // With a wearable connected, the Health card shows last night's sleep (and
  // opens the log from it), so the grid drops its Sleep tile: sleep once.
  const { data: healthGlance } = useHealthGlance();
  const healthConnected = !!healthGlance?.sourceName;

  // Time-based greeting + date — computed client-side after mount so the server render
  // (possibly a different timezone/hour, or across noon/midnight) doesn't cause a
  // hydration mismatch / stale header.
  const [clientNow, setClientNow] = useState<Date | null>(null);
  // Local date string; bumping it on rollover re-keys the dashboard data fetch (below) so
  // the "Today" workout + nutrition refresh with the header instead of showing yesterday.
  const [dateKey, setDateKey] = useState(() => getLocalDateString());
  // The date the server-provided initialData is for. initialData only covers the daily
  // data (workout/nutrition/weight) for the mount date, so its fast path is valid only
  // while dateKey still equals this; after midnight rollover we must do the full fetch.
  // This is the day the SERVER computed it for, not the client's mount day — a
  // render for the wrong day (see DashboardInitialData.dateKey) must not be
  // trusted as today's.
  const [initialDateKey] = useState(() => initialData?.dateKey ?? getLocalDateString());
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClientNow(now);
      setDateKey(getLocalDateString(now)); // no-op (React bails) unless the local day changed
    };
    update();
    // Keep the greeting/date fresh if the tab stays open across noon/midnight or is
    // resumed from sleep — otherwise it would show a stale header until a remount.
    const interval = setInterval(update, 60 * 1000);
    const onVisible = () => { if (!document.hidden) update(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const greeting = clientNow
    ? clientNow.getHours() < 12 ? 'Good morning' : clientNow.getHours() < 18 ? 'Good afternoon' : 'Good evening'
    : '';
  const todayLabel = clientNow
    ? clientNow.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  // "Wk 1 of 5 · Arnold" context line under the greeting, plus "2/4 sessions".
  const weekContext = planMesocycle
    ? `Wk ${planMesocycle.currentWeek} of ${planMesocycle.weeks}${planMesocycle.splitType ? ` · ${planMesocycle.splitType}` : ''}`
    : null;
  const sessionsLabel =
    planMesocycle?.weekSessionsDone != null && planMesocycle.weekSessionsTotal
      ? `${planMesocycle.weekSessionsDone}/${planMesocycle.weekSessionsTotal} sessions`
      : null;

  // Today's daily check-in — drives the readiness pill (present) or the compact
  // check-in prompt (missing). 'loading' hides both until the fetch resolves.
  const [checkInStatus, setCheckInStatus] = useState<'loading' | 'missing' | 'done'>('loading');
  const [checkInReadiness, setCheckInReadiness] = useState<number | null>(null);

  const refreshCheckIn = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createUntypedClient();
      const { data } = await supabase
        .from('daily_check_ins')
        .select('sleep_hours, sleep_quality, energy_level, mood_rating, stress_level')
        .eq('user_id', userId)
        .eq('date', dateKey)
        .maybeSingle();
      if (data) {
        setCheckInStatus('done');
        setCheckInReadiness(readinessFromCheckIn(data as CheckInRow));
      } else {
        setCheckInStatus('missing');
        setCheckInReadiness(null);
      }
    } catch (err) {
      console.error('Failed to load daily check-in:', err);
    }
  }, [userId, dateKey]);

  useEffect(() => {
    refreshCheckIn();
  }, [refreshCheckIn]);

  // Hero coach line source data: today's block suggestion reasons + muscle focus.
  // Small keyed fetch (like the deload recommendation) so neither the server
  // payload nor the cached fast path changes shape. The line itself is pure
  // derivation — never an AI API call.
  const todaysWorkoutId = heroWorkout?.id ?? null;
  const [heroBlocks, setHeroBlocks] = useState<HeroBlockInfo[]>([]);

  useEffect(() => {
    if (!todaysWorkoutId) {
      setHeroBlocks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data } = await supabase
          .from('exercise_blocks')
          .select('suggestion_reason, exercises (primary_muscle)')
          .eq('workout_session_id', todaysWorkoutId)
          .order('order', { ascending: true });
        if (cancelled || !data) return;
        setHeroBlocks(
          data.map((row: { suggestion_reason: string | null; exercises: { primary_muscle: string | null } | null }) => ({
            suggestionReason: row.suggestion_reason,
            primaryMuscle: row.exercises?.primary_muscle ?? null,
          }))
        );
      } catch (err) {
        console.error('Failed to load workout blocks for coach line:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todaysWorkoutId]);

  // One coach sentence for the hero: prefer the first block progression/adjustment
  // reason ("+1 set chest — recovering well"), else fall back to the muscle focus list.
  const coachLine = useMemo(() => {
    const first = heroBlocks.find((b) => !!b.suggestionReason?.trim());
    const reason = first?.suggestionReason?.trim();
    // Beginner mode: the stored reason is engine copy ("Side Delts: 2 of 10
    // weekly sets done", "@ 2 RIR"); same facts, everyday words.
    if (reason) {
      return beginnerMode
        ? beginnerPickReason(plainWorkoutText(reason), first?.primaryMuscle ?? '')
        : reason;
    }

    const muscleNames: string[] = [];
    for (const block of heroBlocks) {
      if (!block.primaryMuscle) continue;
      const key = block.primaryMuscle.toLowerCase().trim();
      const standard = isStandardMuscle(key) ? key : toStandardMuscleForVolume(key);
      const name = standard ? STANDARD_MUSCLE_DISPLAY_NAMES[standard].toLowerCase() : key;
      if (!muscleNames.includes(name)) muscleNames.push(name);
    }
    const source = muscleNames.length > 0 ? muscleNames : (heroScheduled?.muscles ?? []);
    if (source.length > 0) return `Focus today: ${source.slice(0, 4).join(', ')}`;
    return null;
  }, [heroBlocks, heroScheduled, beginnerMode]);

  // Recovery note for the hero meta line ("all target muscles recovered" /
  // "lats still recovering"), comparing today's target muscles against the
  // recovery hook. Suppressed while recovery data loads.
  const heroRecoveryNote = useMemo(() => {
    if (recoveryLoading) return null;
    const rawTargets =
      heroBlocks.length > 0
        ? heroBlocks.map((b) => b.primaryMuscle).filter((m): m is string => !!m)
        : heroScheduled?.muscles ?? [];
    if (rawTargets.length === 0) return null;
    const targets = new Set<StandardMuscleGroup>();
    for (const raw of rawTargets) {
      const key = raw.toLowerCase().trim();
      if (isStandardMuscle(key)) {
        targets.add(key);
        continue;
      }
      const expanded = legacyToStandardMuscles(key);
      if (expanded.length > 0) {
        expanded.forEach((m) => targets.add(m));
        continue;
      }
      const single = toStandardMuscleForVolume(key);
      if (single) targets.add(single);
    }
    if (targets.size === 0) return null;
    const sore = recoveringMuscles.filter((m) => targets.has(m.muscle));
    if (sore.length === 0) return 'all target muscles recovered';
    if (sore.length <= 2) return `${sore.map((m) => m.displayName.toLowerCase()).join(', ')} still recovering`;
    return `${sore.length} target muscles still recovering`;
  }, [recoveryLoading, heroBlocks, heroScheduled, recoveringMuscles]);

  // Meta line for a ready workout hero: "7 exercises · est. 65 min · all
  // target muscles recovered". Only for the planned state — in-progress
  // sessions fall back to the live set counts inside the card.
  const workoutHeroMeta = useMemo(() => {
    if (heroWorkout && heroWorkout.state !== 'planned') return null;
    const parts: string[] = [];
    if (
      heroScheduled?.sessionsScheduledToday === 2 &&
      heroScheduled.sessionOfDay
    ) {
      parts.push(`session ${heroScheduled.sessionOfDay} of 2 today`);
    }
    if (heroWorkout && heroWorkout.exercises > 0) {
      parts.push(`${heroWorkout.exercises} exercises`);
      parts.push(`est. ${Math.round((10 + heroWorkout.exercises * 8) / 5) * 5} min`);
    }
    if (heroRecoveryNote) parts.push(heroRecoveryNote);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [heroWorkout, heroScheduled, heroRecoveryNote]);

  // "ARNOLD WK 1" eyebrow context for the workout hero.
  const heroEyebrowContext = planMesocycle
    ? `${planMesocycle.splitType || planMesocycle.name} wk ${planMesocycle.currentWeek}`
    : null;

  // Same opt-in step-adjusted target the Eat page shows (no-op unless the
  // user picked "Step-adjusted" in Activity settings). Waits for clientNow so
  // the pace comparison uses the device's local time.
  const stepAdjustment = useStepCalorieAdjustment(clientNow ? dateKey : null, nutritionTargets?.calories);
  const effectiveTargets = useMemo<NutritionTargets | null>(
    () =>
      nutritionTargets && stepAdjustment?.adjustment
        ? applyAdjustmentToMacros(nutritionTargets, stepAdjustment.adjustment)
        : nutritionTargets,
    [nutritionTargets, stepAdjustment?.adjustment]
  );

  // iOS home-screen widgets (no-op elsewhere): today's session and what's
  // left of the calorie / protein targets. Written whenever Home's data
  // settles or changes (a quick-log, a refetch, the day rolling over).
  useEffect(() => {
    if (isLoading || !clientNow) return;
    const restDay = !!planMesocycle && !heroScheduled && !heroWorkout;
    const sessionName = restDay
      ? null
      : heroScheduled?.dayName ?? heroWorkout?.name ?? (planMesocycle?.name || 'Start a workout');
    const detail = !heroWorkout
      ? null
      : heroWorkout.state === 'completed'
        ? 'Done for today'
        : heroWorkout.state === 'in_progress'
          ? `In progress · ${heroWorkout.completedSets}/${heroWorkout.totalSets} sets`
          : `${heroWorkout.exercises} exercise${heroWorkout.exercises === 1 ? '' : 's'}`;
    void updateTodayWorkoutWidget({
      sessionName,
      detail,
      path: heroWorkout ? `/dashboard/workout/${heroWorkout.id}` : '/dashboard',
    });
  }, [isLoading, clientNow, planMesocycle, heroScheduled, heroWorkout]);

  useEffect(() => {
    if (isLoading || !effectiveTargets) return;
    void updateNutritionWidget({
      caloriesLeft: effectiveTargets.calories - nutritionTotals.calories,
      caloriesTarget: effectiveTargets.calories,
      proteinLeft: effectiveTargets.protein - nutritionTotals.protein,
      proteinTarget: effectiveTargets.protein,
      path: '/dashboard/nutrition',
    });
  }, [isLoading, effectiveTargets, nutritionTotals]);

  // Next-meal hero content — shown when there's no pending workout (done or
  // rest day) and meaningful calories remain for the day.
  const mealHero: MealHeroSuggestion | null = useMemo(() => {
    if (!clientNow || !effectiveTargets) return null;
    const kcalLeft = Math.round(effectiveTargets.calories - nutritionTotals.calories);
    if (kcalLeft < 100) return null;
    const proteinLeft = Math.round(effectiveTargets.protein - nutritionTotals.protein);
    const pace = intakePaceLabel(
      nutritionTotals.calories,
      effectiveTargets.calories,
      clientNow,
      normalizePacingPhase(userGoal),
      eatingWindow
    );
    return {
      title: `Log ${inferMealType(clientNow)}`,
      timeLabel: clientNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      meta: `${kcalLeft.toLocaleString()} kcal${proteinLeft > 0 ? ` and ${proteinLeft}g protein` : ''} still to go — you're ${
        pace === 'behind' ? 'behind pace' : pace === 'ahead' ? 'ahead of pace' : 'on pace'
      }`,
    };
  }, [clientNow, effectiveTargets, nutritionTotals, userGoal, eatingWindow]);

  // Weekly weight-change rate (regression over the last ~3 weeks) vs the
  // goal-implied target rate, in the preferred display unit. Shared with the
  // nutrition page's Weight tab (the tile's tap-through destination).
  const weightRate: GlanceWeightRate | null = useMemo(
    () => computeWeightRate(weightHistory, weightUnit, userGoal),
    [weightHistory, weightUnit, userGoal]
  );

  // Latest known weight for the Weight tile (today's log or newest entry).
  const latestWeight = useMemo(() => {
    if (todaysWeight) return todaysWeight;
    if (weightHistory.length === 0) return null;
    const newest = [...weightHistory].sort((a, b) => a.date.localeCompare(b.date))[weightHistory.length - 1];
    return { weight: newest.weight, unit: newest.unit };
  }, [todaysWeight, weightHistory]);

  // Weekly-volume summary for the glance "Weekly volume" tile (null = no
  // volume yet). Computed by the same shared helper the volume page's
  // "this week vs MEV" breakdown uses, so tile and destination agree.
  const reachableSet = useMemo(
    () => (reachableMuscles ? new Set(reachableMuscles) : undefined),
    [reachableMuscles]
  );
  // Coarse-row presentation model (shared with the volume page, readiness sheet
  // and warning) — so the glance tile's "N below MEV" and the atrophy card can
  // never diverge from the bars.
  const volumeRows = useMemo(
    () => buildVolumeRows(muscleVolume, reachableSet),
    [muscleVolume, reachableSet]
  );
  const glanceVolume: GlanceVolumeSummary | null =
    muscleVolume.length > 0 ? coarseMevTiles(volumeRows) : null;


  // Load cached weight history on mount for faster initial render.
  // Skipped when server initialData exists (it is strictly fresher — applying
  // the snapshot used to override the server's history for up to an hour),
  // and only ever read from the signed-in user's own key.
  useEffect(() => {
    if (hasInitialData) return;
    let cancelled = false;
    void getLocalUserId(createUntypedClient()).then((uid) => {
      if (!uid || cancelled) return;
      try {
        const cached = localStorage.getItem(userCacheKey(WEIGHT_HISTORY_CACHE_KEY, uid));
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          // Use cache if still valid (within TTL)
          if (Date.now() - timestamp < WEIGHT_HISTORY_CACHE_TTL && Array.isArray(data)) {
            setWeightHistory(data);
          }
        }
      } catch (e) {
        // Ignore cache errors - fresh data will be fetched
      }
    });
    return () => { cancelled = true; };
  }, [hasInitialData]);

  // Load cached dashboard data on mount for instant content display.
  // Skipped entirely when server initialData exists: it is strictly fresher
  // than any localStorage snapshot, and the cache is saved with
  // muscleVolume: [] — applying it would wipe the server-fetched volume
  // (and re-render the SSR'd atrophy card, the LCP element) post-hydration.
  useEffect(() => {
    if (hasInitialData) return;
    let cancelled = false;
    void getLocalUserId(createUntypedClient()).then((uid) => {
    if (!uid || cancelled) return;
    try {
      const cached = localStorage.getItem(userCacheKey(DASHBOARD_CACHE_KEY, uid));
      if (cached) {
        const data: DashboardCacheData = JSON.parse(cached);
        const todayStr = getLocalDateString();

        // Use cache if: within TTL AND same day (nutrition/workout data is day-specific)
        // AND it belongs to the signed-in user.
        const isValid =
          Date.now() - data.timestamp < DASHBOARD_CACHE_TTL &&
          data.dateKey === todayStr &&
          data.userId === uid;

        if (isValid) {
          // Apply cached data immediately - show content without waiting for fetch
          setUserId(data.userId);
          setUserGoal(data.userGoal);
          setActiveMesocycle(data.activeMesocycle);
          setNutritionTotals(data.nutritionTotals);
          setNutritionTargets(data.nutritionTargets);
          setTodaysWeight(data.todaysWeight);
          setWeightUnit(data.weightUnit);
          setMuscleVolume(data.muscleVolume);
          if (!todaysWorkout && data.activeMesocycle) {
            setScheduledWorkout(getNextWorkoutForDate(
              data.activeMesocycle.splitType || 'Upper/Lower',
              new Date(),
              scheduleFor(data.activeMesocycle),
              data.activeMesocycle.completedTodayCount ?? 0
            ));
          }
          // Show content immediately with cached data
          setIsLoading(false);
        }
      }
    } catch (e) {
      // Ignore cache errors - fresh data will be fetched
    }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInitialData]);

  // Helper function to update the dashboard cache after data mutations
  // This prevents stale data from being shown on page reload
  const updateDashboardCache = useCallback((updates: Partial<Pick<DashboardCacheData, 'nutritionTotals' | 'todaysWeight' | 'userGoal' | 'nutritionTargets'>>) => {
    if (!userId) return;
    const cacheKey = userCacheKey(DASHBOARD_CACHE_KEY, userId);
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data: DashboardCacheData = JSON.parse(cached);
        const todayStr = getLocalDateString();
        // Only update if cache is for today (don't corrupt cache for different day)
        if (data.dateKey === todayStr) {
          const updatedData: DashboardCacheData = {
            ...data,
            ...updates,
            timestamp: Date.now(), // Refresh timestamp so cache stays valid
          };
          localStorage.setItem(cacheKey, JSON.stringify(updatedData));
        }
      }
    } catch (e) {
      // Ignore cache update errors
    }
  }, [userId]);

  // Muscles below MEV for the atrophy-risk alert — the coarse below-MEV rows
  // (plus lagging fine children) from the SAME model the bars and glance tile
  // use, with the per-exercise breakdown, so nothing can diverge.
  const musclesBelowMev = useMemo(
    (): MuscleVolumeData[] => belowMevVolumeData(volumeRows),
    [volumeRows]
  );

  // Normalize goal to the Goal type expected by AtrophyRiskAlert
  const normalizedGoal = useMemo(() => {
    if (userGoal === 'maintain' || userGoal === 'maintenance') return 'maintenance';
    if (userGoal === 'recomp') return 'maintenance'; // Recomp treated as maintenance for atrophy risk
    return userGoal as 'bulk' | 'cut' | 'maintenance';
  }, [userGoal]);

  // Current phase for the header chip — same normalization (legacy 'maintain'/'recomp'
  // values collapse to 'maintenance', matching the users.goal DB enum).
  const currentPhase: TrainingPhase = normalizedGoal;

  // Phase chip save handler: the PhaseSelector already persisted the change via
  // the unified server action (users.goal + macro_settings.goal + targets);
  // here we just sync local state and the dashboard cache.
  const handlePhaseChanged = (phase: TrainingPhase, newTargets?: UpdatePhaseResult['newTargets']) => {
    setUserGoal(phase);
    // Merge over previous targets to preserve cardio_prescription
    const mergedTargets = newTargets ? { ...(nutritionTargets ?? {}), ...newTargets } : null;
    if (mergedTargets) setNutritionTargets(mergedTargets);
    updateDashboardCache({
      userGoal: phase,
      ...(mergedTargets ? { nutritionTargets: mergedTargets } : {}),
    });
  };

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setStatedFocus(statedTrackingFocus(user.user_metadata));

        // Eating window for pacing verdicts (defaults inside the helper when
        // unset/unmigrated). Loaded here — before the initial-data fast path
        // returns — so a custom window reaches the Home nutrition tile / meal
        // hero on the normal /dashboard load, not just the full-fetch path.
        fetchEatingWindow(supabase, user.id).then(setEatingWindow).catch(() => {});

        // If we have initial data from server, only fetch supplementary data
        // (deferred queries, muscle volume - things not fetched server-side).
        // Skip this fast path after a midnight rollover (dateKey !== initialDateKey) so the
        // full fetch below recomputes today's workout / nutrition / weight for the new day.
        if (hasInitialData && dateKey === initialDateKey) {
          // Everything Home needs was fetched server-side. (Food logging
          // opens Eat's Add food sheet, which loads its own recents.)
          return;
        }

        setUserId(user.id);

        const today = new Date();
        const todayStr = getLocalDateString(today);
        const ninetyDaysAgo = new Date(today);
        ninetyDaysAgo.setDate(today.getDate() - 90);
        // Shared local-day-anchored window (matches the server + volume page).
        const weeklyVolumeStartIso = weeklyVolumeWindowStartISO(today);

        // Training style + freestyle hero workout (same source as the server
        // page). Independent of the queries below, so it runs alongside them.
        void fetchTrainingStyleData()
          .then((style) => {
            setTrainingStyle(style.trainingStyle);
            setFreestyleTodaysWorkout(style.freestyleTodaysWorkout);
          })
          .catch((error) => console.warn('[dashboard] training style fetch failed:', error));

        // OPTIMIZATION: Split queries into critical (blocks render) and deferred (loads in background)
        // Critical queries - needed for initial content display
        const [
          userProfileResult,
          mesocyclesResult,
          nutritionResult,
          targetsResult,
          weightResult,
          weightHistoryResult,
          weeklyBlocksResult,
          liftSessionsResult,
        ] = await Promise.all([
          // User profile (goal + unit preference — users.preferences.units)
          supabase.from('users').select('goal, preferences').eq('id', user.id).single(),

          // Use shared helper to fetch active mesocycle (same logic as Train + server)
          fetchActiveMesocycle(supabase, user.id),

          // Today's nutrition
          supabase.from('food_log')
            .select('calories, protein, carbs, fat')
            .eq('user_id', user.id)
            .eq('logged_at', todayStr),

          // Nutrition targets - try with cardio_prescription first
          supabase.from('nutrition_targets')
            .select('calories, protein, carbs, fat, cardio_prescription')
            .eq('user_id', user.id)
            .maybeSingle(),

          // Today's weight
          supabase.from('weight_log')
            .select('weight, unit')
            .eq('user_id', user.id)
            .eq('logged_at', todayStr)
            .maybeSingle(),

          // Weight history (90 days for trend calculation)
          supabase.from('weight_log')
            .select('logged_at, weight, unit')
            .eq('user_id', user.id)
            .gte('logged_at', getLocalDateString(ninetyDaysAgo))
            .order('logged_at', { ascending: true }),

          // Weekly volume data (include secondary_muscles for compound exercise credit)
          supabase.from('exercise_blocks')
            .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup, feedback),
              workout_sessions!inner (user_id, completed_at, state)`)
            .eq('workout_sessions.user_id', user.id)
            .eq('workout_sessions.state', 'completed')
            .gte('workout_sessions.completed_at', weeklyVolumeStartIso),

          // Lift-trend history (12 weeks) for the "Lifts" glance tile
          supabase.from('workout_sessions')
            .select(LIFT_TREND_SESSION_SELECT)
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .gte('completed_at', new Date(today.getTime() - LIFT_TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString())
            .order('completed_at', { ascending: true }),
        ]);

        // Unit preference from the real source (users.preferences.units).
        // There is no user_preferences table; that read always errored, so
        // this path silently fell back to lb for everyone.
        const storedUnits = (userProfileResult.data?.preferences as { units?: string } | null)?.units;
        const preferredUnit: 'lb' | 'kg' | null =
          storedUnits === 'kg' || storedUnits === 'lb' ? storedUnits : null;

        // Process user profile
        if (userProfileResult.data?.goal) {
          setUserGoal(userProfileResult.data.goal);
        }

        // Process mesocycle
        const mesocycle = mesocyclesResult;

        if (mesocycle) {
          // Store the full mesocycle for starting workouts
          setFullActiveMeso(mesocycle);

          // Fetch sessions for this mesocycle
          const { data: sessionsData } = await supabase
            .from('workout_sessions')
            .select('id, planned_date, state, completed_at')
            .eq('mesocycle_id', mesocycle.id);

          const sessions = sessionsData || [];
          const completed = sessions.filter((s: any) => s.state === 'completed').length;
          // Use the database's current_week value (managed by weekly rollover logic).
          const currentWeek = mesocycle.current_week;
          const weekSessions = computeWeekSessions(
            sessions,
            mesocycle.start_date,
            currentWeek,
            mesocycle.days_per_week
          );

          const completedTodayCount = sessions.filter(
            (s: any) => s.state === 'completed' && s.planned_date === todayStr
          ).length;
          const scheduledTodayCount = resolveScheduledSlots(
            buildTrainingSchedule(mesocycle),
            new Date()
          ).length;

          setActiveMesocycle({
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: mesocycle.total_weeks,
            currentWeek,
            workoutsCompleted: completed,
            totalWorkouts: sessions.length,
            splitType: mesocycle.split_type,
            daysPerWeek: mesocycle.days_per_week,
            preferredWorkoutDays: mesocycle.preferred_workout_days || null,
            scheduleMode: mesocycle.schedule_mode || null,
            trainingIntervalDays: mesocycle.training_interval_days ?? null,
            sessionsPerDay: mesocycle.sessions_per_day ?? null,
            completedTodayCount,
            weekSessionsDone: weekSessions?.done,
            weekSessionsTotal: weekSessions?.total,
          });

          // Prefer the pending session (in-progress, then planned); a
          // completed row only fronts the hero once every session scheduled
          // today is done — on a two-a-day date the second session should
          // show as up next instead.
          const todaySession =
            sessions.find((s: any) => s.state === 'in_progress') ??
            sessions.find((s: any) => s.planned_date === todayStr && s.state === 'planned') ??
            (completedTodayCount >= scheduledTodayCount
              ? sessions.find((s: any) => s.planned_date === todayStr)
              : undefined);

          if (todaySession) {
            // Single join query - fetches blocks with their set_logs in one request
            const { data: blocksWithSets } = await supabase
              .from('exercise_blocks')
              .select(`
                id,
                target_sets,
                set_logs!left(id, is_warmup)
              `)
              .eq('workout_session_id', todaySession.id);

            const blocks = blocksWithSets || [];
            // Count non-warmup set_logs across all blocks
            const completedSets = blocks.reduce((sum: number, b: any) => {
              const workingSets = (b.set_logs || []).filter((s: any) => !s.is_warmup);
              return sum + workingSets.length;
            }, 0);

            setTodaysWorkout({
              id: todaySession.id,
              name: mesocycle.name,
              state: todaySession.state,
              exercises: blocks.length,
              completedSets,
              totalSets: blocks.reduce((sum: number, b: any) => sum + (b.target_sets || 3), 0),
            });
            // Keep the scheduled-day summary around even with blocks — the
            // hero uses the split-day name as its title and the muscle list
            // for the recovery note.
            setScheduledWorkout(
              getNextWorkoutForDate(
                mesocycle.split_type || 'Upper/Lower',
                new Date(),
                buildTrainingSchedule(mesocycle),
                completedTodayCount
              )
            );
          } else {
            // No session today — clear any stale workout from the previous day (rollover refetch)
            setTodaysWorkout(null);
            const scheduled = getNextWorkoutForDate(
              mesocycle.split_type || 'Upper/Lower',
              new Date(),
              buildTrainingSchedule(mesocycle),
              completedTodayCount
            );
            setScheduledWorkout(scheduled);
          }
        }

        // Process nutrition
        if (nutritionResult.data) {
          const totals = nutritionResult.data.reduce(
            (acc: NutritionTotals, entry: any) => ({
              calories: acc.calories + (entry.calories || 0),
              protein: acc.protein + (entry.protein || 0),
              carbs: acc.carbs + (entry.carbs || 0),
              fat: acc.fat + (entry.fat || 0),
            }),
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
          );
          setNutritionTotals(totals);
        } else {
          // No food logged today — reset stale totals from the previous day (rollover refetch)
          setNutritionTotals({ calories: 0, protein: 0, carbs: 0, fat: 0 });
        }

        // Process nutrition targets
        if (targetsResult.error) {
          // If error is about missing column, try fetching without cardio_prescription
          if (targetsResult.error.code === '42703' && targetsResult.error.message?.includes('cardio_prescription')) {
            const { data: fallbackData } = await supabase
              .from('nutrition_targets')
              .select('calories, protein, carbs, fat')
              .eq('user_id', user.id)
              .maybeSingle();

            setNutritionTargets(fallbackData || null);
          } else {
            setNutritionTargets(null);
          }
        } else {
          setNutritionTargets(targetsResult.data || null);
        }

        // Set user's preferred unit first (needed for weight processing)
        if (preferredUnit) {
          setWeightUnit(preferredUnit);
        }

        // Process weight - use user's preferred unit as default if unit is missing
        if (weightResult.data) {
          const userPreferredUnit = preferredUnit || 'lb';
          setTodaysWeight({
            weight: weightResult.data.weight,
            unit: weightResult.data.unit || userPreferredUnit
          });
        } else {
          // No weight logged today — clear yesterday's value (rollover refetch)
          setTodaysWeight(null);
        }

        // Process weight history - simple pass-through, no guessing
        if (weightHistoryResult.data && weightHistoryResult.data.length > 0) {
          const defaultUnit = preferredUnit || 'lb';

          const processedHistory = weightHistoryResult.data.map((w: any) => ({
            date: w.logged_at,
            weight: w.weight,
            unit: w.unit || defaultUnit,
          }));

          setWeightHistory(processedHistory);

          // Cache weight history in localStorage for faster subsequent loads
          try {
            localStorage.setItem(userCacheKey(WEIGHT_HISTORY_CACHE_KEY, user.id), JSON.stringify({
              data: processedHistory,
              timestamp: Date.now(),
            }));
          } catch (e) {
            // Ignore cache errors - quota exceeded, etc.
          }
        }

        // Process weekly volume through the SAME shared pipeline the server
        // initial-data path and the volume page use (compound-exercise secondary
        // credit + legacy coarse-primary distribution live inside it). Previously
        // this block inlined its own accumulation with a DIFFERENT target table
        // (volumeTargets 8–12) than the server's MEV targets, so a load that took
        // this path (no initialData, or a post-midnight rollover) rendered a
        // different denominator / below-MEV count than an SSR load — the exact
        // "recomputed differently on relaunch" class of bug. One function now.
        const weeklyBlocks = weeklyBlocksResult.data;
        if (weeklyBlocks && weeklyBlocks.length > 0) {
          setMuscleVolume(computeWeeklyMuscleVolume(weeklyBlocks as any));
          // Refresh the fine-muscle warning gate from the same blocks.
          setReachableMuscles(Array.from(computeReachableMuscles(weeklyBlocks as any)));
        }

        // Lift trends for the "Lifts" glance tile (same pure helper the
        // server initial-data path uses). The active program's start date
        // gates confidence for lifts whose window spans the program switch.
        setLiftTrends(
          computeLiftTrends(
            (liftSessionsResult.data as any) || [],
            userProfileResult.data?.goal ?? undefined,
            new Date(),
            { programStartDate: mesocycle?.start_date ?? null }
          )
        );

        // NOTE: Frequent foods and system foods are loaded via deferred queries above
        // They don't block initial render and are processed in the background

        // Cache dashboard data for instant load on next visit
        // Build the processed mesocycle data for caching (reuse sessions from above)
        let cachedMesocycle: ActiveMesocycle | null = null;
        if (mesocycle) {
          // Sessions were already fetched above when processing the mesocycle
          const { data: cachedSessions } = await supabase
            .from('workout_sessions')
            .select('id, state')
            .eq('mesocycle_id', mesocycle.id);
          const sessionList = cachedSessions || [];
          const completed = sessionList.filter((s: any) => s.state === 'completed').length;
          cachedMesocycle = {
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: mesocycle.total_weeks,
            // Use the database's current_week value (managed by weekly rollover logic).
            currentWeek: mesocycle.current_week,
            workoutsCompleted: completed,
            totalWorkouts: sessionList.length,
            splitType: mesocycle.split_type,
            daysPerWeek: mesocycle.days_per_week,
            preferredWorkoutDays: mesocycle.preferred_workout_days || null,
            scheduleMode: mesocycle.schedule_mode || null,
            trainingIntervalDays: mesocycle.training_interval_days ?? null,
            sessionsPerDay: mesocycle.sessions_per_day ?? null,
          };
        }
        try {
          const cacheData: DashboardCacheData = {
            userId: user.id,
            userGoal: userProfileResult.data?.goal || 'maintain',
            activeMesocycle: cachedMesocycle,
            nutritionTotals: nutritionResult.data?.reduce(
              (acc: NutritionTotals, entry: any) => ({
                calories: acc.calories + (entry.calories || 0),
                protein: acc.protein + (entry.protein || 0),
                carbs: acc.carbs + (entry.carbs || 0),
                fat: acc.fat + (entry.fat || 0),
              }),
              { calories: 0, protein: 0, carbs: 0, fat: 0 }
            ) || { calories: 0, protein: 0, carbs: 0, fat: 0 },
            nutritionTargets: targetsResult.data || null,
            todaysWeight: weightResult.data ? {
              weight: weightResult.data.weight,
              unit: weightResult.data.unit || preferredUnit || 'lb'
            } : null,
            weightUnit: preferredUnit || 'lb',
            muscleVolume: [], // Volume is computed, skip for cache simplicity
            timestamp: Date.now(),
            dateKey: todayStr,
          };
          localStorage.setItem(userCacheKey(DASHBOARD_CACHE_KEY, user.id), JSON.stringify(cacheData));
        } catch (e) {
          // Ignore cache write errors
        }

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, [hasInitialData, dateKey]);

  // The unified "Log body data" sheet writes weight_log itself (via
  // lib/body/bodyLog — the same update-or-insert semantics this component
  // used to inline); this handler only syncs the dashboard's local state and
  // caches after a successful weight save.
  const handleBodyDataSaved = (detail: {
    kind: 'weight' | 'measurements' | 'dexa';
    date: string;
    weight?: number;
  }) => {
    if (detail.kind !== 'weight' || detail.weight == null) return;
    const { date, weight } = detail;

    const entry = { date, weight, unit: weightUnit };
    if (date === getLocalDateString()) {
      const newWeight = { weight, unit: weightUnit };
      setTodaysWeight(newWeight);
      // Update dashboard cache with new weight to persist across reloads
      updateDashboardCache({ todaysWeight: newWeight });
    }

    // Update weight history state + cache so the trend refreshes immediately
    setWeightHistory((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((h) => h.date === date);
      if (existingIndex >= 0) {
        next[existingIndex] = entry;
      } else {
        next.push(entry);
        next.sort((a, b) => a.date.localeCompare(b.date));
      }
      try {
        if (userId) {
          localStorage.setItem(
            userCacheKey(WEIGHT_HISTORY_CACHE_KEY, userId),
            JSON.stringify({ data: next, timestamp: Date.now() })
          );
        }
      } catch (e) {
        // Ignore weight history cache update errors
      }
      return next;
    });
  };

  if (isLoading) {
    return <PageSkeleton text="Loading dashboard..." />;
  }

  const cardioPrescription = nutritionTargets?.cardio_prescription;
  const showCardio = !!cardioPrescription?.needed;

  // ── One nudge at a time (design system "one thing per card") ──────────
  // Priority: an actionable deload decision, then today's check-in, then low
  // weekly volume; the waist-pace check only gets the slot when nothing else
  // wants it (it decides for itself whether it has anything to say).
  const needsCheckIn = !!userId && checkInStatus === 'missing';

  // Food-only users (no workouts ever / in 12 weeks, but logging food or
  // weight — or brand new and said "food tracking" at sign-up) get food and weight first and one compact workout entry lower
  // down; lifters keep the workout hero. Every input is already in hand.
  // Food-only mode (useTrackingFocus) wins: Settings switched lifting off,
  // so the hero mustn't lead with a plan or schedule either.
  const foodFocus =
    foodOnly ||
    homeFocus({
      completedWorkoutsCount: initialData?.completedWorkoutsCount,
      recentCompletedWorkouts: liftTrends?.sessionsInWindow,
      hasPlan: !!planMesocycle,
      hasTodaysWorkout: !!heroWorkout || !!heroScheduled,
      hasRecentWeighIn: weightHistory.length > 0 || !!todaysWeight,
      hasFoodToday: nutritionTotals.calories > 0,
      hasLoggedBodyOrFood,
      statedFocus,
    }) === 'food';
  // Food-only: an unfinished workout still shows (never strand one); a
  // plan, schedule or freestyle prompt doesn't. The same inputs feed the
  // card, so its own variant choice agrees with this one.
  const heroInputs = {
    workout: foodOnly && heroWorkout?.state === 'completed' ? null : heroWorkout,
    scheduled: foodOnly ? null : heroScheduled,
    hasPlan: foodOnly ? false : !!planMesocycle,
    freestyle: foodOnly ? false : isFreestyle,
  };
  const heroVariant = todayHeroVariant({
    ...heroInputs,
    meal: mealHero,
    foodFocus,
  });

  // One-shot guidance shown after the user accepts a standalone light week —
  // without a program there is no week to transform, so the advice IS the
  // application. Keyed to the deload type derived from the trigger reasons.
  const lightWeekGuidance: Record<DeloadType, string> = {
    volume:
      'Keep your usual weights but do about half your normal sets, stopping 3–4 reps shy of failure.',
    intensity:
      'Drop your loads about 15% and keep sets moderate so joints and tendons can recover.',
    full:
      'Go light and easy: about half the sets at noticeably lighter loads, focusing on smooth technique.',
  };

  const reasonList = (reasons: string[]) =>
    reasons.length > 0 ? (
      <ul className="space-y-0.5">
        {reasons.map((reason) => (
          <li key={reason} className="text-subhead text-ink-2">
            {reason}
          </li>
        ))}
      </ul>
    ) : null;

  const mesoDeloadCard = deloadRecommendation && activeMesocycleId ? (
    <NudgeCard tone="warn" title="Fatigue is high" body="A deload week is recommended">
      {reasonList(deloadRecommendation.reasons)}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={handleAcceptDeload} disabled={isResolvingDeload}>
          Make next week a deload
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismissDeload} disabled={isResolvingDeload}>
          Dismiss
        </Button>
      </div>
    </NudgeCard>
  ) : null;

  // Standalone variant (no active mesocycle): same fatigue signals, framed as
  // "take a light week" since there is no program week to regenerate.
  const standaloneDeloadCard =
    !activeMesocycleId && standaloneDeload && userId ? (
      <NudgeCard tone="warn" title="Fatigue is high" body="Time for a light week">
        {reasonList(standaloneDeload.reasons)}
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={handleAcceptLightWeek} disabled={isResolvingDeload}>
            Plan a light week
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismissStandaloneDeload} disabled={isResolvingDeload}>
            Dismiss
          </Button>
        </div>
      </NudgeCard>
    ) : null;

  const lightWeekPlannedCard =
    !activeMesocycleId && !standaloneDeload && plannedLightWeekType ? (
      <NudgeCard
        tone="ok"
        title="Light week planned"
        body={`${lightWeekGuidance[plannedLightWeekType]} Your fatigue check-ins restart afterward.`}
      />
    ) : null;

  const deloadCard = mesoDeloadCard ?? standaloneDeloadCard ?? lightWeekPlannedCard;

  // Early-week "ramp" framing for below-MEV muscles (wk 1-2, expected while
  // the week fills in); later weeks escalate to the full atrophy alert.
  // With zero sets logged this week glanceVolume is null while every muscle
  // is below MEV — fall back to musclesBelowMev so a brand-new week gets the
  // calm ramp message instead of the full atrophy alert.
  const belowMevCount = glanceVolume?.lowCount ?? musclesBelowMev.length;
  const rampBanner =
    belowMevCount > 0 && planMesocycle && planMesocycle.currentWeek <= 2 ? (
      <VolumeRampBanner lowCount={belowMevCount} week={planMesocycle.currentWeek} />
    ) : null;

  // A brand-new account has every muscle "under minimum" — that's not news,
  // and the tile already shows the count. Hold the alert until there's a few
  // workouts of history (unknown count = existing user, keep the alert).
  const isNewTrainee = (initialData?.completedWorkoutsCount ?? Number.POSITIVE_INFINITY) < 3;
  const atrophyCard = !rampBanner && !isNewTrainee && musclesBelowMev.length > 0 ? (
    <AtrophyRiskAlert
      musclesBelowMev={musclesBelowMev}
      userGoal={normalizedGoal}
      headlineCount={belowMevCount}
    />
  ) : null;

  const nudge = pickHomeNudge({
    deload: !!deloadCard,
    checkin: needsCheckIn,
    // Under-minimum muscle volume isn't news to someone who doesn't lift here.
    volume: !foodFocus && !!(rampBanner || atrophyCard),
    waist: !!userId,
  });
  const openToday = () => setActiveModal('today');
  const volumeNudgeBody = rampBanner
    ? `Week ${planMesocycle?.currentWeek}: expected this early`
    : 'Add sets where you’re short';

  const nudgeCard =
    nudge === 'deload' ? (
      deloadCard
    ) : nudge === 'checkin' ? (
      <NudgeCard
        title="How are you feeling today?"
        body="A quick check-in tunes today’s suggestions"
        action={
          <Button size="sm" variant="secondary" onClick={() => setActiveModal('checkin')}>
            Check in
          </Button>
        }
      />
    ) : nudge === 'volume' ? (
      <NudgeCard
        tone="warn"
        title={`${belowMevCount} muscle${belowMevCount === 1 ? '' : 's'} under your weekly minimum`}
        body={volumeNudgeBody}
        action={
          <Button size="sm" variant="secondary" onClick={openToday}>
            See
          </Button>
        }
      />
    ) : nudge === 'waist' && userId ? (
      // Bulk pace check — self-hides unless the waist trend is fat-dominant
      // for the current gain rate (once/week, dismissible).
      <WaistPaceCheckCard
        userId={userId}
        weightHistory={weightHistory}
        weightRate={weightRate}
        weightUnit={weightUnit}
        phase={normalizedGoal}
      />
    ) : null;

  const kcalVerdict = effectiveTargets
    ? intakePaceVerdict(nutritionTotals.calories, effectiveTargets.calories, undefined, normalizedGoal, eatingWindow)
    : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Greeting and date are client-only (see clientNow above — avoids an
          SSR hydration mismatch), but the header itself renders from the
          first paint with blank placeholders: mounting it late pushed the
          whole page down and the Settings gear appeared under a moving
          finger, so the panel's first tap on it missed. */}
      <GlanceHeader
        greeting={clientNow ? greeting : '\u00a0'}
        todayLabel={clientNow ? todayLabel : '\u00a0'}
        weekContext={clientNow ? weekContext : null}
        sessionsLabel={clientNow ? sessionsLabel : null}
        readinessScore={clientNow && checkInStatus === 'done' ? checkInReadiness : null}
        onReadinessClick={userId ? () => setActiveModal('checkin') : undefined}
        phaseChip={
          clientNow ? (
            <PhaseSelector phase={currentPhase} onPhaseChanged={handlePhaseChanged} offerPlanRebuild={!isFreestyle} />
          ) : undefined
        }
      />

      {/* One-time "Text too small?" for accounts that never saw onboarding's
          text size step. Renders nothing once a size is picked or closed. */}
      <TextSizePromptCard />

      {/* Error starting workout */}
      {startWorkoutError && (
        <div className="rounded-card bg-status-bad-tint px-4 py-3 text-subhead text-status-bad">
          {startWorkoutError}
        </div>
      )}

      {/* 1. "Next up" hero — pending workout first, otherwise the next meal */}
      <TodayHeroCard
        workout={heroInputs.workout}
        scheduled={heroInputs.scheduled}
        hasPlan={heroInputs.hasPlan}
        freestyle={heroInputs.freestyle}
        mesocycleName={planMesocycle?.name ?? null}
        eyebrowContext={heroEyebrowContext}
        workoutMeta={workoutHeroMeta}
        meal={mealHero}
        onLogFood={() => router.push(addFoodHref())}
        coachLine={coachLine}
        onStartWorkout={handleStartWorkout}
        isStarting={isStartingWorkout}
        startStage={startWorkoutStage}
        freestyleActions={isFreestyle ? <FreestyleStartActions userId={userId} /> : undefined}
        foodFocus={foodFocus}
      />

      {/* A workout start is always one tap from Home: when the hero shows a
          meal, "done" or nothing, this resumes an unfinished workout or
          opens the start options. Food-focused users get it as a compact
          row below the logging chips instead. */}
      {!foodFocus && !foodOnly && !heroOffersWorkoutStart(heroVariant) && <HomeStartWorkout userId={userId} />}

      {/* No active block: the builder one tap from Home. The no-plan hero
          already offers "Build a program", and the food-focused row carries
          its own link, so neither repeats it. */}
      {!foodFocus && !foodOnly && !!userId && !activeMesocycle && heroVariant !== 'no-plan' && (
        <PlanBlockShortcut />
      )}

      {/* Quick log chips, right under the hero: logging is the most
          frequent thing done on Home, so it sits above the glance cards. */}
      <QuickLogRow
        onLogWeight={() => setActiveModal('weight')}
        onLogWater={userId ? () => setActiveModal('water') : undefined}
        onLogFood={() => router.push(addFoodHref())}
        onLogSleep={userId ? () => setActiveModal('sleep') : undefined}
        onLogCardio={showCardio && userId ? () => setActiveModal('cardio') : undefined}
        onLogBloodPressure={userId ? () => setActiveModal('bp') : undefined}
      />

      {/* 2. Today: Eat · Recovery · This week (depth one tap away) */}
      <TodayCard
        nutritionTotals={nutritionTotals}
        nutritionTargets={effectiveTargets}
        kcalPace={kcalVerdict && !kcalVerdict.suppressed ? kcalVerdict.status : null}
        lastNight={lastNight}
        stepsToday={healthGlance?.stepsToday ?? null}
        hrvDeltaPct={healthGlance?.hrv?.deltaPct ?? null}
        readiness={checkInStatus === 'done' ? checkInReadiness : null}
        // Food-only users (useTrackingFocus) get no lift or weekly-set glance.
        liftTrends={foodOnly ? null : liftTrends}
        volume={foodOnly ? null : glanceVolume}
        latestWeight={latestWeight}
        weightRate={weightRate}
        weightUnit={weightUnit}
        foodOnly={foodOnly}
        onOpenDetails={openToday}
      />

      {/* Weekly sets vs MEV–MRV, on Home again (it had moved into the Today
          sheet). Lifters only; beginner mode keeps it out, as it does on the
          workout screen. Same rows as the sheet and the Sets per week page. */}
      {!foodOnly && !beginnerMode && <WeeklySetsCard rows={volumeRows} />}

      {/* 3. At most one nudge */}
      {nudgeCard}

      {/* Food-only users (hooks/useTrackingFocus) get no workout entry at
          all; "I also lift weights" in Settings brings it back. */}
      {foodFocus && !foodOnly && <HomeStartWorkout userId={userId} compact />}

      {/* Today sheet: the tiles, Apple Health and weekly-set detail that used
          to stack on Home, one tap from the Today card. */}
      <TodaySheet
        isOpen={activeModal === 'today'}
        onClose={() => setActiveModal(null)}
        showTrainingNote={!foodOnly}
        recovery={
          userId ? (
            <HealthGlanceCard lastNight={lastNight} onLogSleep={() => setActiveModal('sleep')} />
          ) : null
        }
        week={
          <>
            <MetricTileGrid
              nutritionTotals={nutritionTotals}
              nutritionTargets={effectiveTargets}
              liftTrends={foodOnly ? null : liftTrends}
              volume={foodOnly ? null : glanceVolume}
              latestWeight={latestWeight}
              weightUnit={weightUnit}
              weightHistory={weightHistory}
              weightRate={weightRate}
              bodyComp={initialData?.bodyCompGlance ?? null}
              showFfmi={!foodOnly}
              sleep={{ entries: sleepEntries, lastNight, sevenDayAvgHours }}
              onLogSleep={userId && !healthConnected ? () => setActiveModal('sleep') : undefined}
              onLogWeight={() => setActiveModal('weight')}
              phase={normalizedGoal}
              eatingWindow={eatingWindow}
            />
            {!foodOnly && rampBanner}
            {!foodOnly && atrophyCard}
          </>
        }
      />

      {/* Quick-log modals (content lazy-loads on first open) */}
      {activeModal === 'weight' && (
        <LogBodyDataSheet
          isOpen
          onClose={() => setActiveModal(null)}
          preferredUnit={weightUnit}
          onSaved={handleBodyDataSaved}
        />
      )}

      {activeModal === 'water' && userId && (
        <Modal isOpen onClose={() => setActiveModal(null)} title="Log water">
          <HydrationTracker userId={userId} unit={weightUnit === 'kg' ? 'ml' : 'oz'} />
        </Modal>
      )}

      {activeModal === 'cardio' && userId && cardioPrescription && (
        <Modal isOpen onClose={() => setActiveModal(null)} title="Zone 2 cardio">
          <CardioTracker userId={userId} prescription={cardioPrescription} />
        </Modal>
      )}

      {activeModal === 'sleep' && userId && (
        <Modal isOpen onClose={() => setActiveModal(null)} title="Log sleep">
          <SleepQuickLog onSaved={() => setActiveModal(null)} />
        </Modal>
      )}

      {/* LogBloodPressureModal renders its own Modal shell (and closes
          itself after a save). */}
      {activeModal === 'bp' && userId && (
        <LogBloodPressureModal isOpen onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'checkin' && userId && (
        <Modal isOpen onClose={() => setActiveModal(null)} title="Daily check-in">
          <DailyCheckIn
            userId={userId}
            userGoal={userGoal}
            onComplete={() => {
              refreshCheckIn();
              setActiveModal(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
