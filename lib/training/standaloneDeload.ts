// ============================================================
// STANDALONE DELOAD RECOMMENDATION (no mesocycle)
//
// The mesocycle deload flow (lib/training/deloadRecommendation.ts) stamps its
// recommendation on the mesocycle row and reads weekly_fatigue_logs by
// mesocycle_id. Users training WITHOUT a mesocycle previously got no weekly
// fatigue tracking at all — only the day-level readiness layer.
//
// This module is the mesocycle-free mirror:
//   - weekly_fatigue_logs rows accumulate with mesocycle_id NULL, keyed by an
//     EPOCH WEEK number (weeks since Mon 2020-01-06, local time) instead of a
//     week-in-mesocycle (see runPostSessionStandaloneUpdates in
//     app/(dashboard)/dashboard/workout/[id]/_lib/postSessionStandalone.ts).
//   - recordStandaloneDeloadIfTriggered runs the CANONICAL pure trigger
//     engine (services/deloadEngine.checkDeloadTriggers) over those rows and
//     stamps users.standalone_deload_recommended_at + _reasons.
//   - The dashboard renders a "take a light week" card from the stamp; the
//     user can accept (users.standalone_deload_week = the upcoming epoch
//     week, which suppresses re-checks and resets the streak counter) or
//     dismiss (clears the stamp only).
//
// Week numbers passed to the pure engine are RENUMBERED 1..n over the current
// consecutive-training streak, so its "overdue for deload" backup trigger
// measures weeks of unbroken training rather than a meaningless absolute
// epoch index. A calendar week with no logged session breaks the streak — a
// week off IS a de facto deload for a free-form trainee.
//
// DB access lives here in lib/training (deloadRecommendation.ts precedent),
// NOT in /services. All functions take the (browser) Supabase client from the
// calling client component.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkDeloadTriggers,
  calculateDeloadFrequency,
  computeSleepDebtSignal,
  SLEEP_DEBT_WINDOW_DAYS,
} from '@/services/deloadEngine';
import type {
  ExtendedUserProfile,
  PeriodizationPlan,
  Rating,
  WeeklyPerformanceData,
} from '@/types/schema';
import type { DeloadRecommendation } from './deloadRecommendation';
import { now as clockNow } from '@/lib/clock';
import { getLocalDateString } from '@/lib/utils';

// ============================================================
// Epoch week numbering
// ============================================================

/**
 * Standalone fatigue logs need a week key that exists without a mesocycle.
 * Weeks run Monday-Sunday in LOCAL time and are numbered from this epoch
 * Monday, giving a small monotonic integer that is stable across devices and
 * cheap to compute (no "first workout" query).
 */
export const STANDALONE_WEEK_EPOCH = '2020-01-06'; // a Monday

/** How many standalone log rows the trigger check reads (streak lookback). */
export const STANDALONE_LOG_LOOKBACK = 12;

/**
 * Epoch-week index of `now`: whole weeks between the local Monday of `now`'s
 * week and Mon 2020-01-06. Both endpoints are calendar dates lifted to UTC
 * midnights, so DST shifts can't produce a fractional week.
 */
export function standaloneWeekNumber(now: Date = clockNow()): number {
  const daysSinceMonday = (now.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceMonday
  );
  const days =
    (Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) -
      Date.UTC(2020, 0, 6)) /
    (24 * 60 * 60 * 1000);
  return Math.floor(days / 7);
}

// ============================================================
// Pure helpers (exported for tests)
// ============================================================

/** The weekly_fatigue_logs columns the standalone check reads. */
export interface StandaloneFatigueLogRow {
  week_number: number;
  perceived_fatigue: number | null;
  sleep_quality: number | null;
  motivation_level: number | null;
  missed_reps: number | null;
  joint_pain: boolean | null;
  strength_decline: boolean | null;
}

/**
 * The consecutive-week run ending at the NEWEST row (rows must be sorted by
 * week_number DESC). Stops at the first gap — an untrained calendar week is a
 * de facto rest week and resets the streak — and at `lightWeekBoundary`
 * (inclusive): weeks up to an accepted light week never count toward a new
 * streak. Returned newest-first, duplicates of a week skipped defensively.
 */
export function consecutiveRecentWeeks(
  rows: StandaloneFatigueLogRow[],
  lightWeekBoundary?: number | null
): StandaloneFatigueLogRow[] {
  const streak: StandaloneFatigueLogRow[] = [];
  let prev: number | null = null;
  for (const row of rows) {
    if (lightWeekBoundary != null && row.week_number <= lightWeekBoundary) break;
    if (prev !== null) {
      if (prev === row.week_number) continue; // defensive: dup week
      if (prev - row.week_number !== 1) break; // gap = streak over
    }
    streak.push(row);
    prev = row.week_number;
  }
  return streak;
}

function clampRating(value: number | null | undefined, fallback: Rating): Rating {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(5, Math.round(value))) as Rating;
}

/**
 * Map a streak (newest-first) onto the pure engine's WeeklyPerformanceData,
 * oldest-first and RENUMBERED 1..n so `lastWeek.weekNumber` reads as "weeks
 * of consecutive training" for the overdue-for-deload backup trigger.
 */
export function buildStandalonePerformance(
  streak: StandaloneFatigueLogRow[]
): WeeklyPerformanceData[] {
  return [...streak].reverse().map((row, i) => ({
    weekNumber: i + 1,
    missedReps: row.missed_reps ?? 0,
    perceivedFatigue: clampRating(row.perceived_fatigue, 3),
    sleepQuality: clampRating(row.sleep_quality, 3),
    motivationLevel: clampRating(row.motivation_level, 3),
    jointPain: !!row.joint_pain,
    strengthDecline: !!row.strength_decline,
    isDeload: false,
  }));
}

/**
 * The pure engine's backup-trigger copy says "since mesocycle start", which
 * is wrong for a user who has no mesocycle — reframe it as the streak it
 * actually measured. Other reasons pass through untouched.
 */
export function rewriteStandaloneReason(reason: string): string {
  return reason.replace(
    'weeks since mesocycle start - overdue for deload',
    'weeks of training without a break - overdue for a light week'
  );
}

/** The users columns the standalone check reads. */
interface StandaloneUserRow {
  standalone_deload_recommended_at: string | null;
  standalone_deload_week: number | null;
  experience: string | null;
  goal: string | null;
  birth_date: string | null;
  sleep_quality: number | null;
  stress_level: number | null;
  training_age_years: number | null;
}

function ageFromBirthDate(birthDate: string | null, now: Date): number {
  if (!birthDate) return 30;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return 30;
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(13, Math.min(100, age));
}

/**
 * Minimal ExtendedUserProfile for the two pure functions this module calls:
 * checkDeloadTriggers reads `experience`; calculateDeloadFrequency reads
 * age / trainingAge / sleepQuality / stressLevel. The rest are neutral.
 */
export function buildStandaloneProfile(
  row: Partial<StandaloneUserRow> | null | undefined,
  now: Date
): ExtendedUserProfile {
  const experience = row?.experience;
  return {
    age: ageFromBirthDate(row?.birth_date ?? null, now),
    experience:
      experience === 'novice' || experience === 'intermediate' || experience === 'advanced'
        ? experience
        : 'novice',
    goal: (row?.goal as ExtendedUserProfile['goal']) || 'bulk',
    sleepQuality: clampRating(row?.sleep_quality, 3),
    stressLevel: clampRating(row?.stress_level, 3),
    availableEquipment: [],
    injuryHistory: [],
    trainingAge: row?.training_age_years ?? 0,
    heightCm: null,
    latestDexa: null,
  };
}

// ============================================================
// DB functions (callers pass the browser Supabase client)
// ============================================================

/**
 * Run the standalone deload check for a user and, if it fires and no
 * recommendation is already pending, stamp
 * users.standalone_deload_recommended_at + standalone_deload_reasons.
 * Returns true when a NEW recommendation was recorded.
 *
 * Designed to be fire-and-forget after a session completes (mirror of
 * recordDeloadRecommendationIfTriggered) — callers must try/catch.
 */
export async function recordStandaloneDeloadIfTriggered(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'standalone_deload_recommended_at, standalone_deload_week, experience, goal, birth_date, sleep_quality, stress_level, training_age_years'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const user = data as StandaloneUserRow | null;
  if (!user) return false;
  if (user.standalone_deload_recommended_at) return false; // already pending

  const now = clockNow();
  const currentWeek = standaloneWeekNumber(now);

  // An accepted light week suppresses re-checks until it has passed.
  const lightWeek = user.standalone_deload_week;
  if (lightWeek != null && currentWeek <= lightWeek) return false;

  const { data: logData, error: logsError } = await supabase
    .from('weekly_fatigue_logs')
    .select(
      'week_number, perceived_fatigue, sleep_quality, motivation_level, missed_reps, joint_pain, strength_decline'
    )
    .eq('user_id', userId)
    .is('mesocycle_id', null)
    .order('week_number', { ascending: false })
    .limit(STANDALONE_LOG_LOOKBACK);

  if (logsError) throw new Error(logsError.message);
  const rows = (logData ?? []) as StandaloneFatigueLogRow[];
  if (rows.length < 2) return false;

  // Stale guard: only evaluate an ACTIVE streak. If the newest log is older
  // than last week the user already took time off — nothing to recommend.
  if (rows[0].week_number < currentWeek - 1) return false;

  const streak = consecutiveRecentWeeks(rows, lightWeek);
  if (streak.length < 2) return false;

  const performance = buildStandalonePerformance(streak);
  const lastWeek = performance[performance.length - 1];

  // Signal 7 (chronic short sleep) — contributing evidence, best-effort.
  try {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - (SLEEP_DEBT_WINDOW_DAYS - 1));
    const { data: sleepRows } = await supabase
      .from('sleep_log')
      .select('local_day, hours')
      .eq('user_id', userId)
      .gte('local_day', getLocalDateString(cutoff));
    const sleep = computeSleepDebtSignal(
      ((sleepRows ?? []) as { local_day: string; hours: number }[]).map((row) => ({
        localDay: row.local_day,
        hours: Number(row.hours),
      })),
      now
    );
    lastWeek.sleepDebtScore = sleep.score;
    lastWeek.sleepDebtEvidence = sleep.evidence;
  } catch {
    // Sleep evidence is best-effort — never block the check on it.
  }

  // Supporting wearable signal (sustained HRV/RHR deviation) — best-effort.
  try {
    const { computeWearableRecoveryState } = await import('@/services/wearableRecovery');
    const { data: wellnessRows } = await supabase
      .from('daily_wellness_metrics')
      .select('date, hrv_sdnn_ms, resting_hr_bpm')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(35);
    if (wellnessRows && wellnessRows.length > 0) {
      const history = (wellnessRows as {
        date: string;
        hrv_sdnn_ms: number | null;
        resting_hr_bpm: number | null;
      }[]).map((row) => ({
        date: row.date,
        hrvSdnnMs: row.hrv_sdnn_ms,
        restingHrBpm: row.resting_hr_bpm,
      }));
      const state = computeWearableRecoveryState(history, getLocalDateString(now));
      lastWeek.wearableDeviationDays = state.consecutiveDeviationDays;
    }
  } catch {
    // Wellness metrics unavailable — the other signals stand on their own.
  }

  const profile = buildStandaloneProfile(user, now);
  const deloadFrequency = calculateDeloadFrequency(profile);
  const periodization: PeriodizationPlan = {
    model: 'linear',
    mesocycleWeeks: deloadFrequency + 1,
    weeklyProgression: [],
    deloadFrequency,
    deloadStrategy: 'reactive',
  };

  const triggers = checkDeloadTriggers(performance, profile, periodization);
  if (!triggers.shouldDeload || triggers.reasons.length === 0) return false;

  const { error: updateError } = await supabase
    .from('users')
    .update({
      standalone_deload_recommended_at: now.toISOString(),
      standalone_deload_reasons: triggers.reasons.map(rewriteStandaloneReason),
    })
    .eq('id', userId)
    .is('standalone_deload_recommended_at', null); // race-safe: first writer wins

  if (updateError) throw new Error(updateError.message);
  return true;
}

/** Read the pending standalone recommendation for a user (null when none). */
export async function fetchStandaloneDeloadRecommendation(
  supabase: SupabaseClient,
  userId: string
): Promise<DeloadRecommendation | null> {
  const { data, error } = await supabase
    .from('users')
    .select('standalone_deload_recommended_at, standalone_deload_reasons')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const row = data as {
    standalone_deload_recommended_at: string | null;
    standalone_deload_reasons: unknown;
  } | null;
  if (!row?.standalone_deload_recommended_at) return null;

  // Same jsonb parsing as the mesocycle flow.
  const { parseDeloadReasons } = await import('./deloadRecommendation');
  return {
    recommendedAt: row.standalone_deload_recommended_at,
    reasons: parseDeloadReasons(row.standalone_deload_reasons),
  };
}

/**
 * Accept the recommendation: plan a light week. Stamps
 * users.standalone_deload_week with the UPCOMING epoch week (mirroring the
 * mesocycle flow's "make next week a deload"), which suppresses re-checks
 * through that week and resets the streak counter, then clears the
 * recommendation. Returns the stamped week for the caller's confirmation UI.
 */
export async function acceptStandaloneLightWeek(
  supabase: SupabaseClient,
  userId: string
): Promise<{ lightWeek: number }> {
  const lightWeek = standaloneWeekNumber(clockNow()) + 1;
  const { error } = await supabase
    .from('users')
    .update({
      standalone_deload_week: lightWeek,
      standalone_deload_recommended_at: null,
      standalone_deload_reasons: null,
    })
    .eq('id', userId);

  if (error) throw new Error(error.message);
  return { lightWeek };
}

/** Dismiss the recommendation: clears the stamp + reasons, nothing else. */
export async function dismissStandaloneDeloadRecommendation(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      standalone_deload_recommended_at: null,
      standalone_deload_reasons: null,
    })
    .eq('id', userId);

  if (error) throw new Error(error.message);
}
