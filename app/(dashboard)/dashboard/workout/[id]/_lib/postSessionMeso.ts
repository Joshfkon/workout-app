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
import {
  computeJointPainSignal,
  JOINT_PAIN_WINDOW_DAYS,
  JOINT_PAIN_TRIGGER_THRESHOLD,
} from '@/services/deloadEngine';
import { upsertWeeklyFatigueLog } from './sessionWrites';
import type { DiscomfortSeverity, Rating } from '@/types/schema';

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

    // Session-count-based weeks (this session is already 'completed', so it's
    // in the count). A week advances only when the user has actually done
    // days_per_week sessions — skipped days extend the plan instead of the
    // calendar silently dropping sessions. Both weeks are clamped to never go
    // below the stored week so mesocycles that advanced under the old
    // date-based scheme don't jump backwards.
    const completedCount = await countCompletedSessions(supabase, mesocycleId);
    const daysPerWeek = meso?.days_per_week ?? 1;
    const totalWeeks = meso?.total_weeks ?? 1;
    const storedWeek = meso?.current_week ?? 1;

    // The week the just-finished session BELONGS to comes from the count
    // before it (completedCount - 1): on a boundary session (count is an
    // exact multiple of days_per_week) the full count already rolls over,
    // which would file the last workout of week N under N+1 — and
    // checkDeloadTriggers would then compare two same-week fatigue logs as
    // if they were consecutive weeks.
    const logWeek = Math.max(
      computeCurrentWeekFromSessions(completedCount - 1, daysPerWeek, totalWeeks).week,
      storedWeek
    );
    // The week UPCOMING sessions belong to uses the full count, matching how
    // startMesocycleSession picks the next session's week.
    const weekNumber = Math.max(
      computeCurrentWeekFromSessions(completedCount, daysPerWeek, totalWeeks).week,
      storedWeek
    );

    // Deload signal 5: severity-weighted joint-pain events in the trailing
    // window drive this week's joint_pain flag (ProgramEngine trigger 5).
    // Best-effort — a missing table or query error must not block the finish.
    let jointPain = false;
    try {
      const now = new Date();
      const cutoff = new Date(
        now.getTime() - JOINT_PAIN_WINDOW_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: painEvents } = await supabase
        .from('joint_pain_events')
        .select('severity, created_at')
        .eq('user_id', userId)
        .gte('created_at', cutoff);
      const painScore = computeJointPainSignal(
        ((painEvents ?? []) as { severity: DiscomfortSeverity; created_at: string }[]).map(
          (e) => ({ severity: e.severity, occurredAt: new Date(e.created_at) })
        ),
        now
      );
      jointPain = painScore >= JOINT_PAIN_TRIGGER_THRESHOLD;
    } catch (painErr) {
      console.error('Joint pain signal lookup failed:', painErr);
    }

    const fatigueResult = await upsertWeeklyFatigueLog(supabase, {
      userId,
      mesocycleId,
      weekNumber: logWeek,
      readinessScore: checkIn?.readinessScore ?? 0,
      sleepQuality: checkIn?.sleepQuality ?? null,
      stressLevel: checkIn?.stressLevel ?? null,
      sessionAvgRpe: sessionRpe,
      jointPain,
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
