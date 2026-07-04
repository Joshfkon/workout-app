/**
 * postSessionMeso.ts
 *
 * Post-completion updates for a mesocycle session, shared by two paths in the
 * workout page:
 *   1. finishing a programmed session (session already has mesocycle_id);
 *   2. claiming a just-finished ad-hoc session for the mesocycle (the user
 *      accepted the "count it toward your plan?" prompt, which set
 *      mesocycle_id after completion — so these updates never ran).
 *
 * Fire-and-forget from the caller's perspective: must never block or fail the
 * finish flow, so all errors are caught and logged here.
 */

import { computeCurrentWeekFromSessions } from '@/lib/training/mesocycleProgress';
import { countCompletedSessions } from '@/lib/training/startMesocycleSession';
import { upsertWeeklyFatigueLog } from './sessionWrites';
import type { Rating } from '@/types/schema';

type UntypedSupabase = ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>;

export interface PostSessionMesoInput {
  mesocycleId: string;
  userId: string;
  sessionRpe: number | null;
  checkIn?: {
    readinessScore?: number;
    sleepQuality?: Rating | null;
    stressLevel?: Rating | null;
  } | null;
}

/**
 * Log this week's fatigue signals, advance the mesocycle's current_week from
 * the completed-session count, and run the deload-trigger check. Assumes the
 * session is already state='completed' (and linked to the mesocycle) so it is
 * included in the count.
 */
export async function runPostSessionMesoUpdates(
  supabase: UntypedSupabase,
  input: PostSessionMesoInput
): Promise<void> {
  const { mesocycleId, userId, sessionRpe, checkIn } = input;
  try {
    const { data: meso } = await supabase
      .from('mesocycles')
      .select('total_weeks, days_per_week, current_week')
      .eq('id', mesocycleId)
      .maybeSingle();

    // Session-count-based week (this session is already 'completed', so it's
    // in the count). The week advances only when the user has actually done
    // days_per_week sessions — skipped days extend the plan instead of the
    // calendar silently dropping sessions. Clamped to never go below the
    // stored week so mesocycles that advanced under the old date-based scheme
    // don't jump backwards. Distinct week numbers are what lets
    // checkDeloadTriggers compare consecutive weeks.
    const completedCount = await countCompletedSessions(supabase, mesocycleId);
    const sessionWeek = computeCurrentWeekFromSessions(
      completedCount,
      meso?.days_per_week ?? 1,
      meso?.total_weeks ?? 1
    ).week;
    const weekNumber = Math.max(sessionWeek, meso?.current_week ?? 1);

    const fatigueResult = await upsertWeeklyFatigueLog(supabase, {
      userId,
      mesocycleId,
      weekNumber,
      readinessScore: checkIn?.readinessScore ?? 0,
      sleepQuality: checkIn?.sleepQuality ?? null,
      stressLevel: checkIn?.stressLevel ?? null,
      sessionAvgRpe: sessionRpe,
    });
    if (!fatigueResult.ok) {
      console.error('Failed to save weekly fatigue log:', fatigueResult.error);
    }

    // current_week was historically written only at creation (always 1),
    // which silently disabled everything that reads it: the weekly rollover's
    // deload-week hold, program-week modifiers at workout start, and
    // deload-accept's current_week+1 targeting. Keep it in step with the
    // session-derived week here, where we already computed it. The .lt()
    // filter makes the write advance-only.
    if (meso) {
      const { error: weekError } = await supabase
        .from('mesocycles')
        .update({ current_week: weekNumber })
        .eq('id', mesocycleId)
        .lt('current_week', weekNumber);
      if (weekError) {
        console.error('Failed to advance mesocycle current_week:', weekError);
      }
    }

    // Dynamic import keeps the deload engine out of the page's initial bundle.
    const { recordDeloadRecommendationIfTriggered } = await import(
      '@/lib/training/deloadRecommendation'
    );
    await recordDeloadRecommendationIfTriggered(supabase, userId, mesocycleId);
  } catch (err) {
    console.error('Post-session deload check failed:', err);
  }
}
