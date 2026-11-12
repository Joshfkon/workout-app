'use server';

import { cookies } from 'next/headers';
import { createUntypedServerClient } from '@/lib/supabase/server';
import { getLocalDateString } from '@/lib/utils';
import { now as clockNow } from '@/lib/clock';
import {
  USER_TIME_ZONE_COOKIE,
  resolveUserDay,
  type UserDay,
} from '@/components/providers/userTimeZone';
import { buildPersonalizedBodyCompTrend } from '@/lib/body-composition/trendBuilder';
import { localDay, rollingWindowStart } from '@/lib/date/localDay';
import { analyzeBodyCompTrend, computeFFMI } from '@/services/bodyCompEngine';
import { getBodyCompLayout } from '@/services/compositionSpace';
import { type WorkoutDay } from '@/types/schema';
import {
  buildTrainingSchedule,
  resolveScheduledSlots,
  type ScheduleMode,
} from '@/lib/training/trainingSchedule';
import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  weeklyVolumeWindowStartISO,
  type MuscleVolumeStats,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { StandardMuscleGroup } from '@/types/schema';
import {
  computeLiftTrends,
  LIFT_TREND_WINDOW_DAYS,
  LIFT_TREND_SESSION_SELECT,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { computeWeekSessions } from '@/app/(dashboard)/dashboard/_lib/weekSessions';
import type { PlateauGoal } from '@/services/plateauDetector';

export interface DashboardMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  workoutsCompleted: number;
  totalWorkouts: number;
  splitType: string;
  daysPerWeek: number;
  preferredWorkoutDays?: WorkoutDay[] | null;
  /** Schedule shape: fixed weekdays, or every-N-days from startDate. */
  scheduleMode?: ScheduleMode | null;
  trainingIntervalDays?: number | null;
  /** 1 = one session per training date; 2 = two-a-day. */
  sessionsPerDay?: number | null;
  /**
   * Completed sessions dated today — how far through today's scheduled
   * sessions the user is. Drives which of a two-a-day date's sessions the
   * hero advertises next.
   */
  completedTodayCount?: number;
  /** Sessions completed vs expected inside the current mesocycle week. */
  weekSessionsDone?: number;
  weekSessionsTotal?: number;
}

export interface TodaysWorkoutData {
  id: string;
  name: string;
  state: 'planned' | 'in_progress' | 'completed';
  exercises: number;
  completedSets: number;
  totalSets: number;
}

export interface NutritionData {
  totals: { calories: number; protein: number; carbs: number; fat: number };
  targets: { calories: number; protein: number; carbs: number; fat: number; cardio_prescription?: any } | null;
}

export interface WeightData {
  todaysWeight: { weight: number; unit: string } | null;
  weightHistory: { date: string; weight: number; unit: string }[];
  preferredUnit: 'lb' | 'kg';
}

/**
 * Compact body-composition glance for the Home card. Null until the user has
 * ≥2 DEXA scans and a profile height (getBodyCompLayout's home-card gate) —
 * a single scan can't show a trend, and FFMI needs height.
 */
export interface BodyCompGlance {
  scanCount: number;
  /** Latest ANCHORED BF% / raw FFMI — the last point of the same anchored
   * series the Body Composition Trend chart and FFMI gauge read, not the raw
   * latest scan (which goes stale as weigh-ins accumulate after it). */
  bodyFatPercent: number;
  ffmi: number;
  /** Monthly change rates across the scan history (trend arrows). */
  bodyFatRatePerMonth: number;
  ffmiRatePerMonth: number;
}

/**
 * "Today" for the signed-in user. Server code runs in the HOST's timezone
 * (usually UTC), so the runtime day is tomorrow for a US user every evening;
 * the dashboard shell stores the device zone in a cookie and every
 * day-scoped fetch below resolves the day from it. Without the cookie (very
 * first visit) this is the runtime day, and the client — which compares
 * `fetchDashboardDateKey()` against its own local day — refetches.
 */
async function getUserDay(): Promise<UserDay> {
  let zone: string | undefined;
  try {
    zone = cookies().get(USER_TIME_ZONE_COOKIE)?.value;
  } catch {
    // Outside a request scope (tests / scripts): runtime day.
  }
  return resolveUserDay(zone, clockNow());
}

/**
 * The calendar day the day-scoped dashboard fetches (workout, nutrition,
 * weigh-in) were computed for. Shipped in initialData so the client can tell
 * a render for the wrong day from a current one.
 */
export async function fetchDashboardDateKey(): Promise<string> {
  return (await getUserDay()).day;
}

/**
 * Fail loudly instead of treating a failed query as "no rows". A swallowed
 * error rendered as 0 calories / no weigh-in / no program and looked like
 * real data; throwing lets the page fall back to the client fetch.
 */
function rows<T>(result: { data: T | null; error: unknown }, what: string): T | null {
  if (result.error) {
    const message = (result.error as { message?: string }).message ?? String(result.error);
    throw new Error(`[dashboard] ${what} failed: ${message}`);
  }
  return result.data;
}

/**
 * Fetch active mesocycle and today's workout for the dashboard
 */
export async function fetchMesocycleData(userId: string): Promise<{
  mesocycle: DashboardMesocycle | null;
  todaysWorkout: TodaysWorkoutData | null;
}> {
  const supabase = await createUntypedServerClient();
  const { day: todayStr, date: today } = await getUserDay();

  // Use the shared fetch to get the same mesocycle Train would select
  const { fetchActiveMesocycle } = await import('@/lib/training/fetchActiveMesocycle');
  const mesocycle = await fetchActiveMesocycle(supabase, userId);

  if (!mesocycle) {
    return { mesocycle: null, todaysWorkout: null };
  }

  // Fetch sessions for this mesocycle
  const sessions = rows<any[]>(
    await supabase
      .from('workout_sessions')
      .select('id, planned_date, state, completed_at')
      .eq('mesocycle_id', mesocycle.id),
    'mesocycle sessions'
  );

  const sessionList = sessions || [];
  const completed = sessionList.filter((s: any) => s.state === 'completed').length;
  const completedTodayCount = sessionList.filter(
    (s: any) => s.state === 'completed' && s.planned_date === todayStr
  ).length;
  // How many sessions the calendar puts on today (0 rest day, 2 two-a-day).
  const scheduledTodayCount = resolveScheduledSlots(
    buildTrainingSchedule(mesocycle),
    today
  ).length;

  // Use the database's current_week value (managed by weekly rollover logic).
  const currentWeek = mesocycle.current_week;
  const weekSessions = computeWeekSessions(
    sessionList,
    mesocycle.start_date,
    currentWeek,
    mesocycle.days_per_week
  );

  const dashboardMesocycle: DashboardMesocycle = {
    id: mesocycle.id,
    name: mesocycle.name,
    startDate: mesocycle.start_date,
    weeks: mesocycle.total_weeks,
    currentWeek,
    workoutsCompleted: completed,
    totalWorkouts: sessionList.length,
    splitType: mesocycle.split_type,
    daysPerWeek: mesocycle.days_per_week,
    preferredWorkoutDays: mesocycle.preferred_workout_days || null,
    scheduleMode: mesocycle.schedule_mode || null,
    trainingIntervalDays: mesocycle.training_interval_days ?? null,
    sessionsPerDay: mesocycle.sessions_per_day ?? null,
    completedTodayCount,
    weekSessionsDone: weekSessions?.done,
    weekSessionsTotal: weekSessions?.total,
  };

  // Today's hero session. A two-a-day date can hold two rows, so prefer the
  // one that is actually pending (in-progress, then planned); a completed row
  // only fronts the hero once every session scheduled today is done —
  // otherwise the day's next session should show as up next instead.
  const todaySession =
    sessionList.find((s: any) => s.state === 'in_progress') ??
    sessionList.find((s: any) => s.planned_date === todayStr && s.state === 'planned') ??
    (completedTodayCount >= scheduledTodayCount
      ? sessionList.find((s: any) => s.planned_date === todayStr)
      : undefined);

  let todaysWorkout: TodaysWorkoutData | null = null;
  if (todaySession) {
    const blocksWithSets = rows<any[]>(
      await supabase
        .from('exercise_blocks')
        .select(`id, target_sets, set_logs!left(id, is_warmup)`)
        .eq('workout_session_id', todaySession.id),
      "today's workout blocks"
    );

    const blocks = blocksWithSets || [];
    const completedSets = blocks.reduce((sum: number, b: any) => {
      const workingSets = (b.set_logs || []).filter((s: any) => !s.is_warmup);
      return sum + workingSets.length;
    }, 0);

    todaysWorkout = {
      id: todaySession.id,
      name: mesocycle.name,
      state: todaySession.state,
      exercises: blocks.length,
      completedSets,
      totalSets: blocks.reduce((sum: number, b: any) => sum + (b.target_sets || 3), 0),
    };
  }

  return { mesocycle: dashboardMesocycle, todaysWorkout };
}

/**
 * Fetch nutrition data for today
 */
export async function fetchNutritionData(userId: string): Promise<NutritionData> {
  const supabase = await createUntypedServerClient();
  const { day: todayStr } = await getUserDay();

  const [nutritionResult, targetsResult] = await Promise.all([
    supabase
      .from('food_log')
      .select('calories, protein, carbs, fat')
      .eq('user_id', userId)
      .eq('logged_at', todayStr),
    supabase
      .from('nutrition_targets')
      .select('calories, protein, carbs, fat, cardio_prescription')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const totals = rows<any[]>(nutritionResult, "today's food log")?.reduce(
    (acc: any, entry: any) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fat: acc.fat + (entry.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  ) || { calories: 0, protein: 0, carbs: 0, fat: 0 };

  return {
    totals,
    targets: targetsResult.data || null,
  };
}

/**
 * Fetch weight data including today's weight and history
 */
export async function fetchWeightData(userId: string): Promise<WeightData> {
  const supabase = await createUntypedServerClient();
  const { day: todayStr, date: today } = await getUserDay();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);

  const [weightResult, weightHistoryResult, prefsResult] = await Promise.all([
    supabase
      .from('weight_log')
      .select('weight, unit')
      .eq('user_id', userId)
      .eq('logged_at', todayStr)
      .maybeSingle(),
    supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', userId)
      .gte('logged_at', getLocalDateString(ninetyDaysAgo))
      .order('logged_at', { ascending: true }),
    // The unit preference lives in users.preferences.units (there is no
    // user_preferences table — that read always failed and fell back to lb).
    supabase.from('users').select('preferences').eq('id', userId).maybeSingle(),
  ]);

  const storedUnit = (prefsResult.data?.preferences as { units?: string } | null)?.units;
  const preferredUnit: 'lb' | 'kg' = storedUnit === 'kg' ? 'kg' : 'lb';
  const todaysRow = rows<any>(weightResult, "today's weigh-in");
  const history = rows<any[]>(weightHistoryResult, 'weight history');

  return {
    todaysWeight: todaysRow
      ? { weight: todaysRow.weight, unit: todaysRow.unit || preferredUnit }
      : null,
    weightHistory: (history || []).map((w: any) => ({
      date: w.logged_at,
      weight: w.weight,
      unit: w.unit || preferredUnit,
    })),
    preferredUnit,
  };
}

/**
 * Body-comp glance for the Home card: latest anchored BF% + FFMI with
 * monthly trend rates. Null below 2 scans or without a profile height.
 */
export async function fetchBodyCompGlance(userId: string): Promise<BodyCompGlance | null> {
  const supabase = await createUntypedServerClient();
  const yearAgoDay = localDay(rollingWindowStart(365));

  const [scansRes, weightsRes, profileRes, waistRes, volumeProfileRes] = await Promise.all([
    supabase
      .from('dexa_scans')
      .select('scan_date, body_fat_percent, lean_mass_kg, fat_mass_kg, weight_kg, bone_mass_kg')
      .eq('user_id', userId)
      .order('scan_date', { ascending: true }),
    supabase
      .from('weight_log')
      .select('logged_at, weight, unit')
      .eq('user_id', userId)
      .gte('logged_at', yearAgoDay)
      .order('logged_at', { ascending: true }),
    supabase.from('users').select('height_cm, goal, sex, age').eq('id', userId).single(),
    // Waist + volume profile mirror the Body tab hook's fetches: the card
    // and the module it deep-links to must run the SAME trend inputs.
    supabase
      .from('body_measurements')
      .select('logged_at, waist')
      .eq('user_id', userId)
      .gte('logged_at', yearAgoDay)
      .not('waist', 'is', null)
      .order('logged_at', { ascending: true }),
    supabase
      .from('user_volume_profiles')
      .select('training_age, is_enhanced')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const scans = rows<any[]>(scansRes, 'DEXA scans') ?? [];
  const heightCm = profileRes.data?.height_cm ? Number(profileRes.data.height_cm) : null;
  if (!getBodyCompLayout(scans.length).showHomeCard || !heightCm) return null;

  // Same shared pipeline the Body tab hook runs (trendBuilder: unit
  // conversion, waist shaping, personalized projection p-ratio), so the
  // card and the module it deep-links to can never disagree.
  const { trend } = buildPersonalizedBodyCompTrend({
    weights: (weightsRes.data ?? []) as any,
    scans: scans as any,
    waist: (waistRes.data ?? []) as any,
    profile: {
      user: (profileRes.data ?? null) as any,
      volumeProfile: (volumeProfileRes.data ?? null) as any,
    },
  });
  if (trend.length === 0) return null;
  const latest = trend[trend.length - 1];

  const rates = analyzeBodyCompTrend(
    scans.map(
      (scan: any) =>
        ({
          scanDate: scan.scan_date,
          bodyFatPercent: Number(scan.body_fat_percent),
          leanMassKg: Number(scan.lean_mass_kg),
          fatMassKg: Number(scan.fat_mass_kg),
        }) as any
    ),
    heightCm
  );

  return {
    scanCount: scans.length,
    bodyFatPercent: latest.bodyFatPercent,
    ffmi: computeFFMI(latest.leanMassKg, latest.boneMassKg, heightCm).ffmi,
    bodyFatRatePerMonth: rates?.bodyFatChangeRate ?? 0,
    ffmiRatePerMonth: rates?.ffmiChangeRate ?? 0,
  };
}

/**
 * Fetch user goal
 */
export async function fetchUserGoal(userId: string): Promise<string> {
  const supabase = await createUntypedServerClient();
  const data = rows<any>(
    await supabase.from('users').select('goal').eq('id', userId).maybeSingle(),
    'user goal'
  );
  return data?.goal || 'maintain';
}

/**
 * Fetch completed workouts count
 */
export async function fetchCompletedWorkoutsCount(userId: string): Promise<number> {
  const supabase = await createUntypedServerClient();
  const { count, error } = await supabase
    .from('workout_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('state', 'completed');
  rows({ data: null, error }, 'completed workout count');
  return count || 0;
}

/**
 * Lift trends for the home "Lifts" glance tile: top-set E1RM trend per
 * frequently-trained exercise over the last 12 weeks (rising / flat / down
 * plus the longest stall). Heavy lifting is in the shared pure helper so the
 * client full-fetch path can reuse it.
 */
export async function fetchLiftTrends(userId: string): Promise<LiftTrendsSummary> {
  const supabase = await createUntypedServerClient();
  const nowInstant = clockNow();
  const since = new Date(nowInstant);
  since.setDate(since.getDate() - LIFT_TREND_WINDOW_DAYS);

  const [sessionsResult, { data: profile }, { data: activeMesos }] = await Promise.all([
    supabase
      .from('workout_sessions')
      .select(LIFT_TREND_SESSION_SELECT)
      .eq('user_id', userId)
      .eq('state', 'completed')
      .gte('completed_at', since.toISOString())
      .order('completed_at', { ascending: true }),
    supabase.from('users').select('goal').eq('id', userId).single(),
    // Active program start — trend verdicts across this boundary are
    // low-confidence until a few sessions rebuild the history.
    supabase
      .from('mesocycles')
      .select('start_date')
      .eq('user_id', userId)
      .or('is_active.eq.true,state.eq.active')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const sessions = rows<any[]>(sessionsResult, 'lift trend sessions');

  return computeLiftTrends(
    (sessions as any) || [],
    (profile?.goal as PlateauGoal | null) ?? undefined,
    nowInstant,
    { programStartDate: activeMesos?.[0]?.start_date ?? null }
  );
}

/**
 * Weekly per-muscle volume for the atrophy-risk card (item 6: server-render
 * first paint). Same query + pure pipeline the client fast-path used, moved
 * server-side so the card — the dashboard's LCP element — ships in the HTML
 * instead of waiting on a post-hydration fetch.
 */
export interface WeeklyMuscleVolumeResult {
  stats: MuscleVolumeStats[];
  /**
   * Standard muscles the user's own logged exercises can credit — drives the
   * fine-muscle (erectors / glute_med / obliques) warning gate so the home
   * card never nags about a muscle no logged exercise could satisfy.
   */
  reachable: StandardMuscleGroup[];
}

export async function fetchWeeklyMuscleVolume(userId: string): Promise<WeeklyMuscleVolumeResult> {
  const supabase = await createUntypedServerClient();
  // Shared local-day-anchored window (see weeklyVolumeWindowStartISO) so this
  // server first-paint value matches the client fast-path and the volume page.
  // Anchored on the USER's calendar day (see getUserDay), not the host's.
  const weekStartIso = weeklyVolumeWindowStartISO((await getUserDay()).date);

  const data = rows<any[]>(
    await supabase
      .from('exercise_blocks')
      .select(`id, exercises (id, name, primary_muscle, secondary_muscles), set_logs (id, is_warmup, feedback),
        workout_sessions!inner (user_id, completed_at, state)`)
      .eq('workout_sessions.user_id', userId)
      .eq('workout_sessions.state', 'completed')
      .gte('workout_sessions.completed_at', weekStartIso),
    'weekly volume'
  );

  const blocks = (data as any) || [];
  return {
    stats: computeWeeklyMuscleVolume(blocks),
    reachable: Array.from(computeReachableMuscles(blocks)),
  };
}
