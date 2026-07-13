'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Button, LoadingAnimation } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { createUntypedClient } from '@/lib/supabase/client';
import { requireAuthUserId } from '@/lib/supabase/sessionGate';
import { getLocalDateString } from '@/lib/utils';
import type { FrequentFood, SystemFood, MealType } from '@/types/nutrition';
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
import { computeLiftTrends, LIFT_TREND_WINDOW_DAYS, type LiftTrendsSummary } from './_lib/liftTrends';
import type { BodyCompGlance } from '@/lib/actions/dashboard';
import { computeWeightRate } from './_lib/weightRate';
import { computeWeekSessions } from './_lib/weekSessions';
import { useMuscleRecovery } from '@/hooks/useMuscleRecovery';
import { calculateReadinessScore } from '@/services/fatigueEngine';
import {
  applyDeloadToUpcomingWeek,
  dismissDeloadRecommendation,
  fetchDeloadRecommendation,
  type DeloadRecommendation,
} from '@/lib/training/deloadRecommendation';
import { GlanceHeader, TodayHeroCard, MetricTileGrid, QuickLogRow, PhaseSelector, VolumeRampBanner, intakePaceLabel } from '@/components/dashboard/home';
import { normalizePacingPhase, type EatingWindow } from '@/services/intakePacing';
import { fetchEatingWindow } from '@/lib/nutrition/eatingWindow';
import type { TodaysWorkout, GlanceVolumeSummary, GlanceWeightRate, MealHeroSuggestion } from '@/components/dashboard/home';
import type { TrainingPhase, UpdatePhaseResult } from '@/lib/actions/phase';

// Loading placeholder for lazily-loaded modal content
const CardSkeleton = () => (
  <div className="animate-pulse bg-surface-800 rounded-lg p-4 space-y-3">
    <div className="h-4 bg-surface-700 rounded w-3/4" />
    <div className="h-8 bg-surface-700 rounded w-full" />
  </div>
);

// Lazy load modal content — only fetched when a quick-log modal opens
const QuickFoodLogger = dynamic(
  () => import('@/components/nutrition/QuickFoodLogger').then(mod => ({ default: mod.QuickFoodLogger })),
  { ssr: false, loading: () => <CardSkeleton /> }
);

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

// Static import (item 6): AtrophyRiskAlert is the dashboard's LCP element.
// As a next/dynamic component it was code-split, and during hydration the
// dynamic boundary flashed its `loading` skeleton over the SSR'd card until
// its separate chunk finished downloading (~6s under Lighthouse's 4x/slow-4G
// throttle) — so LCP was recorded when the card re-appeared, not at first
// paint. Bundling it statically (small component, UI-only imports) removes
// the extra chunk and the swap; with weekly volume already in server
// initialData, the card now paints with the initial HTML.

const WEIGHT_HISTORY_CACHE_KEY = 'weight_history_cache';
const WEIGHT_HISTORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const DASHBOARD_CACHE_KEY = 'dashboard_data_cache';
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

// MEV_TARGETS, ALL_MUSCLE_GROUPS, accumulateExerciseVolume, volumeAccumulatorToStats,
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
  /** Sessions completed vs expected inside the current mesocycle week. */
  weekSessionsDone?: number;
  weekSessionsTotal?: number;
}

interface ScheduledWorkout {
  dayName: string;
  muscles: string[];
  dayNumber: number;
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
}

/**
 * Derive a 0-100 readiness score from the daily check-in using the existing
 * pure fatigue-engine scorer. Check-in fields map onto ReadinessInput:
 * mood inverts to stress (low mood ~ high stress) and energy stands in for
 * the fueling/nutrition rating.
 */
function readinessFromCheckIn(row: CheckInRow): number {
  const clampRating = (v: number | null): Rating | null =>
    v == null ? null : (Math.min(5, Math.max(1, Math.round(v))) as Rating);
  return calculateReadinessScore({
    sleepHours: row.sleep_hours,
    sleepQuality: clampRating(row.sleep_quality),
    stressLevel: row.mood_rating == null ? null : clampRating(6 - row.mood_rating),
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
  mesocycle: ActiveMesocycle | null;
  todaysWorkout: TodaysWorkout | null;
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
}

interface DashboardClientProps {
  initialData?: DashboardInitialData;
}

const WEEKDAY_NAMES: WorkoutDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function dayNameToNumber(dayName: WorkoutDay): number {
  return WEEKDAY_NAMES.indexOf(dayName) + 1;
}

function getTrainingDays(daysPerWeek: number, preferredWorkoutDays?: WorkoutDay[] | null): number[] {
  if (preferredWorkoutDays && preferredWorkoutDays.length > 0) {
    return preferredWorkoutDays.map(dayNameToNumber).sort((a, b) => a - b);
  }

  const trainingDayMaps: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 5, 6],
    6: [1, 2, 3, 4, 5, 6],
  };

  return trainingDayMaps[daysPerWeek] || trainingDayMaps[4];
}

// Helper to calculate workout schedule based on split type
function getWorkoutForDay(
  splitType: string,
  dayOfWeek: number,
  daysPerWeek: number,
  preferredWorkoutDays?: WorkoutDay[] | null
): ScheduledWorkout | null {
  const splits: Record<string, { dayName: string; muscles: string[] }[]> = {
    'Full Body': [
      { dayName: 'Full Body A', muscles: ['chest', 'back', 'quads', 'shoulders', 'triceps'] },
      { dayName: 'Full Body B', muscles: ['back', 'hamstrings', 'glutes', 'biceps', 'calves'] },
      { dayName: 'Full Body C', muscles: ['chest', 'quads', 'shoulders', 'biceps', 'abs'] },
    ],
    'Upper/Lower': [
      { dayName: 'Upper A', muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Upper B', muscles: ['back', 'chest', 'shoulders', 'triceps', 'biceps'] },
      { dayName: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Arnold': [
      { dayName: 'Chest & Back', muscles: ['chest', 'back'] },
      { dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
  };

  const schedule = splits[splitType] || splits['Upper/Lower'];
  const trainingDays = getTrainingDays(daysPerWeek, preferredWorkoutDays);
  const dayIndex = trainingDays.indexOf(dayOfWeek);

  if (dayIndex === -1) return null;

  const workoutIndex = dayIndex % schedule.length;
  return { ...schedule[workoutIndex], dayNumber: dayIndex + 1 };
}

type QuickLogModal = 'weight' | 'water' | 'food' | 'cardio' | 'checkin';

export function DashboardClient({ initialData }: DashboardClientProps) {
  // If we have server-fetched initialData, skip loading state entirely
  const hasInitialData = !!initialData;

  const [isLoading, setIsLoading] = useState(!hasInitialData);
  const [activeMesocycle, setActiveMesocycle] = useState<ActiveMesocycle | null>(initialData?.mesocycle ?? null);
  const [todaysWorkout, setTodaysWorkout] = useState<TodaysWorkout | null>(initialData?.todaysWorkout ?? null);
  const [scheduledWorkout, setScheduledWorkout] = useState<ScheduledWorkout | null>(() => {
    // Computed even when today's session already has blocks — the hero uses
    // the split-day name ("Chest & Back") as its title and the muscle list
    // for the recovery note, not just as the block-less fallback.
    if (!initialData?.mesocycle) return null;
    const today = new Date();
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
    return getWorkoutForDay(
      initialData.mesocycle.splitType || 'Upper/Lower',
      dayOfWeek,
      initialData.mesocycle.daysPerWeek || 4,
      initialData.mesocycle.preferredWorkoutDays
    );
  });
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
  // Eating window for intake pacing (07:00–21:00 until the user's row loads).
  const [eatingWindow, setEatingWindow] = useState<EatingWindow | undefined>(undefined);

  // Which quick-log modal is open (the old scroll-to detail cards were removed).
  const [activeModal, setActiveModal] = useState<QuickLogModal | null>(null);

  // Pending deload recommendation on the active mesocycle (Phase 1.4).
  // Fetched separately from the main dashboard load so the cached initial
  // data path doesn't need to change shape.
  const [deloadRecommendation, setDeloadRecommendation] = useState<DeloadRecommendation | null>(null);
  const [isResolvingDeload, setIsResolvingDeload] = useState(false);
  const activeMesocycleId = activeMesocycle?.id ?? null;

  useEffect(() => {
    if (!activeMesocycleId) {
      setDeloadRecommendation(null);
      return;
    }
    let cancelled = false;
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
  }, [activeMesocycleId]);

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

  // Recovery data for the hero's "all target muscles recovered" note. While
  // loading, the hook reports every muscle as ready (empty training map), so
  // the note is suppressed until real data arrives.
  const { recoveringMuscles, isLoading: recoveryLoading } = useMuscleRecovery();

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
  const [initialDateKey] = useState(() => getLocalDateString());
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
  const weekContext = activeMesocycle
    ? `Wk ${activeMesocycle.currentWeek} of ${activeMesocycle.weeks}${activeMesocycle.splitType ? ` · ${activeMesocycle.splitType}` : ''}`
    : null;
  const sessionsLabel =
    activeMesocycle?.weekSessionsDone != null && activeMesocycle.weekSessionsTotal
      ? `${activeMesocycle.weekSessionsDone}/${activeMesocycle.weekSessionsTotal} sessions`
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
        .select('sleep_hours, sleep_quality, energy_level, mood_rating')
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
  const todaysWorkoutId = todaysWorkout?.id ?? null;
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
    const reason = heroBlocks
      .map((b) => b.suggestionReason?.trim())
      .find((r): r is string => !!r && r.length > 0);
    if (reason) return reason;

    const muscleNames: string[] = [];
    for (const block of heroBlocks) {
      if (!block.primaryMuscle) continue;
      const key = block.primaryMuscle.toLowerCase().trim();
      const standard = isStandardMuscle(key) ? key : toStandardMuscleForVolume(key);
      const name = standard ? STANDARD_MUSCLE_DISPLAY_NAMES[standard].toLowerCase() : key;
      if (!muscleNames.includes(name)) muscleNames.push(name);
    }
    const source = muscleNames.length > 0 ? muscleNames : (scheduledWorkout?.muscles ?? []);
    if (source.length > 0) return `Focus today: ${source.slice(0, 4).join(', ')}`;
    return null;
  }, [heroBlocks, scheduledWorkout]);

  // Recovery note for the hero meta line ("all target muscles recovered" /
  // "lats still recovering"), comparing today's target muscles against the
  // recovery hook. Suppressed while recovery data loads.
  const heroRecoveryNote = useMemo(() => {
    if (recoveryLoading) return null;
    const rawTargets =
      heroBlocks.length > 0
        ? heroBlocks.map((b) => b.primaryMuscle).filter((m): m is string => !!m)
        : scheduledWorkout?.muscles ?? [];
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
  }, [recoveryLoading, heroBlocks, scheduledWorkout, recoveringMuscles]);

  // Meta line for a ready workout hero: "7 exercises · est. 65 min · all
  // target muscles recovered". Only for the planned state — in-progress
  // sessions fall back to the live set counts inside the card.
  const workoutHeroMeta = useMemo(() => {
    if (todaysWorkout && todaysWorkout.state !== 'planned') return null;
    const parts: string[] = [];
    if (todaysWorkout && todaysWorkout.exercises > 0) {
      parts.push(`${todaysWorkout.exercises} exercises`);
      parts.push(`est. ${Math.round((10 + todaysWorkout.exercises * 8) / 5) * 5} min`);
    }
    if (heroRecoveryNote) parts.push(heroRecoveryNote);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [todaysWorkout, heroRecoveryNote]);

  // "ARNOLD WK 1" eyebrow context for the workout hero.
  const heroEyebrowContext = activeMesocycle
    ? `${activeMesocycle.splitType || activeMesocycle.name} wk ${activeMesocycle.currentWeek}`
    : null;

  // Next-meal hero content — shown when there's no pending workout (done or
  // rest day) and meaningful calories remain for the day.
  const mealHero: MealHeroSuggestion | null = useMemo(() => {
    if (!clientNow || !nutritionTargets) return null;
    const kcalLeft = Math.round(nutritionTargets.calories - nutritionTotals.calories);
    if (kcalLeft < 100) return null;
    const proteinLeft = Math.round(nutritionTargets.protein - nutritionTotals.protein);
    const pace = intakePaceLabel(
      nutritionTotals.calories,
      nutritionTargets.calories,
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
  }, [clientNow, nutritionTargets, nutritionTotals, userGoal, eatingWindow]);

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

  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [systemFoods, setSystemFoods] = useState<SystemFood[]>([]);

  // Load cached weight history on mount for faster initial render
  useEffect(() => {
    try {
      const cached = localStorage.getItem(WEIGHT_HISTORY_CACHE_KEY);
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
  }, []);

  // Load cached dashboard data on mount for instant content display.
  // Skipped entirely when server initialData exists: it is strictly fresher
  // than any localStorage snapshot, and the cache is saved with
  // muscleVolume: [] — applying it would wipe the server-fetched volume
  // (and re-render the SSR'd atrophy card, the LCP element) post-hydration.
  useEffect(() => {
    if (hasInitialData) return;
    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (cached) {
        const data: DashboardCacheData = JSON.parse(cached);
        const todayStr = getLocalDateString();

        // Use cache if: within TTL AND same day (nutrition/workout data is day-specific)
        const isValid = Date.now() - data.timestamp < DASHBOARD_CACHE_TTL && data.dateKey === todayStr;

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
            const today = new Date();
            const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
            setScheduledWorkout(getWorkoutForDay(
              data.activeMesocycle.splitType || 'Upper/Lower',
              dayOfWeek,
              data.activeMesocycle.daysPerWeek || 4,
              data.activeMesocycle.preferredWorkoutDays
            ));
          }
          // Show content immediately with cached data
          setIsLoading(false);
        }
      }
    } catch (e) {
      // Ignore cache errors - fresh data will be fetched
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInitialData]);

  // Helper function to update the dashboard cache after data mutations
  // This prevents stale data from being shown on page reload
  const updateDashboardCache = useCallback((updates: Partial<Pick<DashboardCacheData, 'nutritionTotals' | 'todaysWeight' | 'userGoal' | 'nutritionTargets'>>) => {
    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
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
          localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(updatedData));
        }
      }
    } catch (e) {
      // Ignore cache update errors
    }
  }, []);

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
        // Throws when there is no session (instead of a silent bail that
        // leaves the dashboard rendering placeholders as if the user had no
        // data) — the catch below keeps existing state, and the layout's
        // AuthSessionRecovery surfaces re-auth for a genuinely dead session.
        const user = { id: await requireAuthUserId(supabase) };

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
          // Fetch only the deferred data that wasn't fetched server-side
          // (frequent foods, system foods). Weekly volume is NOT refetched:
          // initialData.muscleVolume was fetched server-side in this same
          // render (item 6), and calling setMuscleVolume with a fresh array
          // replaced the SSR'd atrophy card — the dashboard's LCP element —
          // after hydration, moving the recorded LCP from first paint
          // (~1.2s) to post-hydration (~4.7s).
          Promise.all([
            supabase.from('food_log')
              .select('meal_type, food_name, serving_size, calories, protein, carbs, fat, servings')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(50),
            supabase.from('system_foods')
              .select('id, name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
              .eq('is_active', true)
              .order('name')
              .limit(100),
          ]).then(([frequentDataResult, systemFoodsResult]) => {
            // Process frequent foods
            if (frequentDataResult.data && frequentDataResult.data.length > 0) {
              const frequencyMap = new Map<string, FrequentFood>();
              for (const entry of frequentDataResult.data) {
                if (!entry.food_name) continue;
                const key = `${entry.meal_type}:${entry.food_name}`;
                const existing = frequencyMap.get(key);
                const servingsNum = entry.servings || 1;
                if (existing) {
                  const totalLogs = existing.times_logged + 1;
                  existing.avg_calories = (existing.avg_calories * existing.times_logged + (entry.calories || 0) / servingsNum) / totalLogs;
                  existing.avg_protein = (existing.avg_protein * existing.times_logged + (entry.protein || 0) / servingsNum) / totalLogs;
                  existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (entry.carbs || 0) / servingsNum) / totalLogs;
                  existing.avg_fat = (existing.avg_fat * existing.times_logged + (entry.fat || 0) / servingsNum) / totalLogs;
                  existing.times_logged = totalLogs;
                } else {
                  frequencyMap.set(key, {
                    user_id: user.id,
                    meal_type: entry.meal_type as MealType,
                    food_name: entry.food_name,
                    serving_size: entry.serving_size,
                    avg_calories: (entry.calories || 0) / servingsNum,
                    avg_protein: (entry.protein || 0) / servingsNum,
                    avg_carbs: (entry.carbs || 0) / servingsNum,
                    avg_fat: (entry.fat || 0) / servingsNum,
                    times_logged: 1,
                    last_logged: new Date().toISOString(),
                  });
                }
              }
              setFrequentFoods(Array.from(frequencyMap.values()));
            }
            if (systemFoodsResult.data) {
              setSystemFoods(systemFoodsResult.data as SystemFood[]);
            }
          }).catch(() => {});
          return;
        }

        setUserId(user.id);

        const today = new Date();
        const todayStr = getLocalDateString(today);
        const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
        const ninetyDaysAgo = new Date(today);
        ninetyDaysAgo.setDate(today.getDate() - 90);
        // Shared local-day-anchored window (matches the server + volume page).
        const weeklyVolumeStartIso = weeklyVolumeWindowStartISO(today);

        // OPTIMIZATION: Split queries into critical (blocks render) and deferred (loads in background)
        // Critical queries - needed for initial content display
        const [
          userProfileResult,
          mesocyclesResult,
          nutritionResult,
          targetsResult,
          prefsResult,
          weightResult,
          weightHistoryResult,
          weeklyBlocksResult,
          liftSessionsResult,
        ] = await Promise.all([
          // User profile (goal)
          supabase.from('users').select('goal').eq('id', user.id).single(),

          // Mesocycles with sessions
          supabase.from('mesocycles')
            .select(`id, name, start_date, total_weeks, split_type, days_per_week, preferred_workout_days, state, is_active,
              workout_sessions (id, planned_date, state, completed_at)`)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),

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

          // User preferences
          supabase.from('user_preferences')
            .select('weight_unit')
            .eq('user_id', user.id)
            .single(),

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
            .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup),
              workout_sessions!inner (user_id, completed_at, state)`)
            .eq('workout_sessions.user_id', user.id)
            .eq('workout_sessions.state', 'completed')
            .gte('workout_sessions.completed_at', weeklyVolumeStartIso),

          // Lift-trend history (12 weeks) for the "Lifts" glance tile
          supabase.from('workout_sessions')
            .select(`id, completed_at,
              exercise_blocks (exercises (id, name), set_logs (weight_kg, reps, is_warmup))`)
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .gte('completed_at', new Date(today.getTime() - LIFT_TREND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString())
            .order('completed_at', { ascending: true }),
        ]);

        // When EVERY critical query errored (dead token, offline, outage)
        // this is a failed fetch, not a user with no data — bail before any
        // of the per-section processing below wipes rendered values to
        // zero/null "rollover" defaults. (Same guard as useLogPageData.)
        const criticalResults = [
          userProfileResult,
          mesocyclesResult,
          nutritionResult,
          targetsResult,
          prefsResult,
          weightResult,
          weightHistoryResult,
          weeklyBlocksResult,
          liftSessionsResult,
        ];
        if (criticalResults.every((r) => r.error)) {
          throw new Error(
            `[Dashboard] boot fetch failed entirely: ${mesocyclesResult.error?.message ?? 'unknown error'}`
          );
        }

        // Deferred queries - load in background, only needed for food logging
        // These don't block initial render
        Promise.all([
          // Frequent foods - only needed when opening food logger
          supabase.from('food_log')
            .select('meal_type, food_name, serving_size, calories, protein, carbs, fat, servings')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50),

          // System foods - only needed when opening food logger
          supabase.from('system_foods')
            .select('id, name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
            .eq('is_active', true)
            .order('name')
            .limit(100),
        ]).then(([frequentDataResult, systemFoodsResult]) => {
          // Process deferred data in background
          if (frequentDataResult.data && frequentDataResult.data.length > 0) {
            const frequencyMap = new Map<string, FrequentFood>();
            for (const entry of frequentDataResult.data) {
              if (!entry.food_name) continue;
              const key = `${entry.meal_type}:${entry.food_name}`;
              const existing = frequencyMap.get(key);
              const servingsNum = entry.servings || 1;

              if (existing) {
                const totalLogs = existing.times_logged + 1;
                existing.avg_calories = (existing.avg_calories * existing.times_logged + (entry.calories || 0) / servingsNum) / totalLogs;
                existing.avg_protein = (existing.avg_protein * existing.times_logged + (entry.protein || 0) / servingsNum) / totalLogs;
                existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (entry.carbs || 0) / servingsNum) / totalLogs;
                existing.avg_fat = (existing.avg_fat * existing.times_logged + (entry.fat || 0) / servingsNum) / totalLogs;
                existing.times_logged = totalLogs;
              } else {
                frequencyMap.set(key, {
                  user_id: user.id,
                  meal_type: entry.meal_type as MealType,
                  food_name: entry.food_name,
                  serving_size: entry.serving_size,
                  avg_calories: (entry.calories || 0) / servingsNum,
                  avg_protein: (entry.protein || 0) / servingsNum,
                  avg_carbs: (entry.carbs || 0) / servingsNum,
                  avg_fat: (entry.fat || 0) / servingsNum,
                  times_logged: 1,
                  last_logged: new Date().toISOString(),
                });
              }
            }
            setFrequentFoods(Array.from(frequencyMap.values()));
          }
          if (systemFoodsResult.data) {
            setSystemFoods(systemFoodsResult.data as SystemFood[]);
          }
        }).catch(() => {
          // Ignore errors in deferred queries - not critical
        });

        // Process user profile
        if (userProfileResult.data?.goal) {
          setUserGoal(userProfileResult.data.goal);
        }

        // Process mesocycles
        const mesocycles = mesocyclesResult.data;
        let mesocycle = mesocycles?.find((m: any) => m.is_active === true || m.state === 'active') || null;
        if (!mesocycle && mesocycles && mesocycles.length > 0) {
          mesocycle = mesocycles.find((m: any) => m.state !== 'completed') || null;
        }

        if (mesocycle) {
          const startDate = new Date(mesocycle.start_date);
          const weeksSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const sessions = mesocycle.workout_sessions || [];
          const completed = sessions.filter((s: any) => s.state === 'completed').length;
          const currentWeek = Math.min(weeksSinceStart, mesocycle.total_weeks);
          const weekSessions = computeWeekSessions(
            sessions,
            mesocycle.start_date,
            currentWeek,
            mesocycle.days_per_week || 0
          );

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
            weekSessionsDone: weekSessions?.done,
            weekSessionsTotal: weekSessions?.total,
          });

          const todaySession = sessions.find((s: any) =>
            s.planned_date === todayStr || s.state === 'in_progress'
          );

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
              getWorkoutForDay(
                mesocycle.split_type || 'Upper/Lower',
                dayOfWeek,
                mesocycle.days_per_week || 4,
                mesocycle.preferred_workout_days
              )
            );
          } else {
            // No session today — clear any stale workout from the previous day (rollover refetch)
            setTodaysWorkout(null);
            const scheduled = getWorkoutForDay(
              mesocycle.split_type || 'Upper/Lower',
              dayOfWeek,
              mesocycle.days_per_week || 4,
              mesocycle.preferred_workout_days
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
        } else if (!nutritionResult.error) {
          // No food logged today (confirmed by a SUCCESSFUL query) — reset
          // stale totals from the previous day (rollover refetch). A failed
          // query keeps what's on screen.
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
        if (prefsResult.data?.weight_unit) {
          setWeightUnit(prefsResult.data.weight_unit as 'lb' | 'kg');
        }

        // Process weight - use user's preferred unit as default if unit is missing
        if (weightResult.data) {
          const userPreferredUnit = (prefsResult.data?.weight_unit as 'lb' | 'kg') || 'lb';
          setTodaysWeight({
            weight: weightResult.data.weight,
            unit: weightResult.data.unit || userPreferredUnit
          });
        } else if (!weightResult.error) {
          // No weight logged today (successful query) — clear yesterday's
          // value (rollover refetch). A failed query keeps what's on screen.
          setTodaysWeight(null);
        }

        // Process weight history - simple pass-through, no guessing
        if (weightHistoryResult.data && weightHistoryResult.data.length > 0) {
          const defaultUnit = (prefsResult.data?.weight_unit as 'lb' | 'kg') || 'lb';

          const processedHistory = weightHistoryResult.data.map((w: any) => ({
            date: w.logged_at,
            weight: w.weight,
            unit: w.unit || defaultUnit,
          }));

          setWeightHistory(processedHistory);

          // Cache weight history in localStorage for faster subsequent loads
          try {
            localStorage.setItem(WEIGHT_HISTORY_CACHE_KEY, JSON.stringify({
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
        // Only recompute from a SUCCESSFUL query — feeding an errored
        // result's empty rows into computeLiftTrends is what made the tile
        // read like a fresh account ("logout" symptom) on a lapsed session.
        if (!liftSessionsResult.error) {
          setLiftTrends(
            computeLiftTrends(
              (liftSessionsResult.data as any) || [],
              userProfileResult.data?.goal ?? undefined,
              new Date(),
              { programStartDate: mesocycle?.start_date ?? null }
            )
          );
        }

        // NOTE: Frequent foods and system foods are loaded via deferred queries above
        // They don't block initial render and are processed in the background

        // Cache dashboard data for instant load on next visit
        // Build the processed mesocycle data for caching
        let cachedMesocycle: ActiveMesocycle | null = null;
        if (mesocycle) {
          const startDate = new Date(mesocycle.start_date);
          const weeksSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const sessions = mesocycle.workout_sessions || [];
          const completed = sessions.filter((s: any) => s.state === 'completed').length;
          cachedMesocycle = {
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: mesocycle.total_weeks,
            currentWeek: Math.min(weeksSinceStart, mesocycle.total_weeks),
            workoutsCompleted: completed,
            totalWorkouts: sessions.length,
            splitType: mesocycle.split_type,
            daysPerWeek: mesocycle.days_per_week,
            preferredWorkoutDays: mesocycle.preferred_workout_days || null,
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
              unit: weightResult.data.unit || prefsResult.data?.weight_unit || 'lb'
            } : null,
            weightUnit: (prefsResult.data?.weight_unit as 'lb' | 'kg') || 'lb',
            muscleVolume: [], // Volume is computed, skip for cache simplicity
            timestamp: Date.now(),
            dateKey: todayStr,
          };
          localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(cacheData));
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

  const handleAddFood = async (food: {
    food_name: string;
    serving_size: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_type: MealType;
    source: 'usda' | 'manual' | 'barcode';
  }) => {
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('handleAddFood: No user found');
        return;
      }

      const { error } = await supabase.from('food_log').insert({
        user_id: user.id,
        food_name: food.food_name,
        serving_size: food.serving_size,
        servings: food.servings,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        meal_type: food.meal_type,
        source: food.source || 'manual',
        logged_at: getLocalDateString(),
      });

      if (error) {
        console.error('handleAddFood: Supabase error:', error);
        return;
      }

      // Update local state and cache together to prevent stale data on reload
      setNutritionTotals((prev) => {
        const newTotals = {
          calories: prev.calories + food.calories,
          protein: prev.protein + food.protein,
          carbs: prev.carbs + food.carbs,
          fat: prev.fat + food.fat,
        };
        // Update cache with new totals to persist across reloads
        updateDashboardCache({ nutritionTotals: newTotals });
        return newTotals;
      });
      setActiveModal(null);
    } catch (err) {
      console.error('handleAddFood: Exception:', err);
    }
  };

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
        localStorage.setItem(WEIGHT_HISTORY_CACHE_KEY, JSON.stringify({ data: next, timestamp: Date.now() }));
      } catch (e) {
        // Ignore weight history cache update errors
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <LoadingAnimation type="random" size="lg" />
        <p className="mt-4 text-surface-400">Loading dashboard...</p>
      </div>
    );
  }

  const cardioPrescription = nutritionTargets?.cardio_prescription;
  const showCardio = !!cardioPrescription?.needed;

  // Contextual insight cards — each renders only when triggered.
  const checkInPromptCard = userId && checkInStatus === 'missing' ? (
    <div className="rounded-xl bg-surface-900 border border-surface-800 p-4 flex items-center justify-between gap-3">
      <p className="text-[13px] text-surface-300">How are you feeling today?</p>
      <Button size="sm" onClick={() => setActiveModal('checkin')}>Check in</Button>
    </div>
  ) : null;

  const deloadCard = deloadRecommendation && activeMesocycleId ? (
    <div className="rounded-xl bg-warning-500/10 border border-warning-500/20 p-4">
      <div className="flex items-start gap-3">
        <IconAlertTriangle className="w-5 h-5 text-warning-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-surface-100">
            Fatigue is high — deload recommended
          </p>
          {deloadRecommendation.reasons.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {deloadRecommendation.reasons.map((reason) => (
                <li key={reason} className="text-xs text-surface-400">
                  {reason}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={handleAcceptDeload} disabled={isResolvingDeload}>
              Make next week a deload
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismissDeload} disabled={isResolvingDeload}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  // Early-week "ramp" framing for below-MEV muscles (wk 1-2, expected while
  // the week fills in); later weeks escalate to the full atrophy alert.
  // With zero sets logged this week glanceVolume is null while every muscle
  // is below MEV — fall back to musclesBelowMev so a brand-new week gets the
  // calm ramp message instead of the full atrophy alert.
  const belowMevCount = glanceVolume?.lowCount ?? musclesBelowMev.length;
  const rampBanner =
    belowMevCount > 0 && activeMesocycle && activeMesocycle.currentWeek <= 2 ? (
      <VolumeRampBanner lowCount={belowMevCount} week={activeMesocycle.currentWeek} />
    ) : null;

  const atrophyCard = !rampBanner && musclesBelowMev.length > 0 ? (
    <AtrophyRiskAlert musclesBelowMev={musclesBelowMev} userGoal={normalizedGoal} />
  ) : null;

  const hasInsightCards = !!(checkInPromptCard || deloadCard || atrophyCard);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Greeting (client-only — see clientNow above — to avoid SSR hydration mismatch) */}
      {clientNow && (
        <GlanceHeader
          greeting={greeting}
          todayLabel={todayLabel}
          weekContext={weekContext}
          sessionsLabel={sessionsLabel}
          readinessScore={checkInStatus === 'done' ? checkInReadiness : null}
          onReadinessClick={userId ? () => setActiveModal('checkin') : undefined}
          phaseChip={<PhaseSelector phase={currentPhase} onPhaseChanged={handlePhaseChanged} />}
        />
      )}

      {/* "Next up" hero — pending workout first, otherwise the next meal */}
      <TodayHeroCard
        workout={todaysWorkout}
        scheduled={scheduledWorkout}
        hasPlan={!!activeMesocycle}
        mesocycleName={activeMesocycle?.name ?? null}
        eyebrowContext={heroEyebrowContext}
        workoutMeta={workoutHeroMeta}
        meal={mealHero}
        onLogFood={() => setActiveModal('food')}
        coachLine={coachLine}
      />

      {/* Glance metric grid: Nutrition · Lifts · Weekly volume · Weight */}
      <MetricTileGrid
        nutritionTotals={nutritionTotals}
        nutritionTargets={nutritionTargets}
        liftTrends={liftTrends}
        volume={glanceVolume}
        latestWeight={latestWeight}
        weightUnit={weightUnit}
        weightHistory={weightHistory}
        weightRate={weightRate}
        bodyComp={initialData?.bodyCompGlance ?? null}
        onLogWeight={() => setActiveModal('weight')}
        phase={normalizedGoal}
        eatingWindow={eatingWindow}
      />

      {/* Early-week volume ramp insight (links to the volume page) */}
      {rampBanner}

      {/* Contextual insight cards — render only when triggered */}
      {hasInsightCards && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {checkInPromptCard}
          {deloadCard}
          {atrophyCard}
        </div>
      )}

      {/* Quick log row — each button opens a modal */}
      <QuickLogRow
        onLogWeight={() => setActiveModal('weight')}
        onLogWater={userId ? () => setActiveModal('water') : undefined}
        onLogFood={() => setActiveModal('food')}
        onLogCardio={showCardio && userId ? () => setActiveModal('cardio') : undefined}
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

      {activeModal === 'food' && (
        <Modal isOpen onClose={() => setActiveModal(null)} title="Log food" size="lg">
          <QuickFoodLogger
            onAdd={handleAddFood}
            onClose={() => setActiveModal(null)}
            frequentFoods={frequentFoods}
            systemFoods={systemFoods}
            defaultMealType={inferMealType(new Date())}
          />
        </Modal>
      )}

      {activeModal === 'cardio' && userId && cardioPrescription && (
        <Modal isOpen onClose={() => setActiveModal(null)} title="Zone 2 cardio">
          <CardioTracker userId={userId} prescription={cardioPrescription} />
        </Modal>
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
