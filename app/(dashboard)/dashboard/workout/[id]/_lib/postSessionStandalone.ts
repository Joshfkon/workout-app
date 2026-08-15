/**
 * postSessionStandalone.ts
 *
 * Post-completion updates for a session with NO mesocycle — the standalone
 * mirror of postSessionMeso.ts. Sessions outside a program previously got no
 * weekly fatigue accounting at all, so nobody was watching a free-form
 * trainee's multi-week fatigue trend.
 *
 * On completion this logs the week's fatigue signals to weekly_fatigue_logs
 * with mesocycle_id NULL, keyed by the standalone EPOCH week (see
 * lib/training/standaloneDeload.ts), then runs the standalone deload check,
 * which stamps users.standalone_deload_recommended_at for the dashboard's
 * "take a light week" card.
 *
 * Fire-and-forget from the caller's perspective: must never block or fail the
 * finish flow, so all errors are caught and logged here. Like the mesocycle
 * runner, the outcome is REPORTED ({ ok }) because the durable work item that
 * drives this (lib/offline/postFinishQueue) may only be cleared once the work
 * actually happened.
 */

import {
  recordStandaloneDeloadIfTriggered,
  standaloneWeekNumber,
} from '@/lib/training/standaloneDeload';
import { lookupJointPainFlag } from './postSessionMeso';
import { upsertWeeklyFatigueLog } from './sessionWrites';
import type { Rating } from '@/types/schema';
import { now as clockNow } from '@/lib/clock';

type UntypedSupabase = ReturnType<typeof import('@/lib/supabase/client').createUntypedClient>;

export interface PostSessionStandaloneInput {
  userId: string;
  sessionRpe: number | null;
  checkIn?: {
    readinessScore?: number;
    sleepQuality?: Rating | null;
    stressLevel?: Rating | null;
  } | null;
}

/**
 * Log this epoch week's fatigue signals (mesocycle_id NULL) and run the
 * standalone deload-trigger check. Assumes the session is already
 * state='completed'.
 */
export async function runPostSessionStandaloneUpdates(
  supabase: UntypedSupabase,
  input: PostSessionStandaloneInput
): Promise<{ ok: boolean }> {
  const { userId, sessionRpe, checkIn } = input;
  let ok = true;
  try {
    const weekNumber = standaloneWeekNumber(clockNow());

    // Best-effort with a defined fallback (no pain) — deliberately excluded
    // from the ok-report, same as the mesocycle runner.
    const jointPain = await lookupJointPainFlag(supabase, userId);

    const fatigueResult = await upsertWeeklyFatigueLog(supabase, {
      userId,
      mesocycleId: null,
      weekNumber,
      readinessScore: checkIn?.readinessScore ?? 0,
      sleepQuality: checkIn?.sleepQuality ?? null,
      stressLevel: checkIn?.stressLevel ?? null,
      sessionAvgRpe: sessionRpe,
      jointPain,
    });
    if (!fatigueResult.ok) {
      console.error('Failed to save standalone weekly fatigue log:', fatigueResult.error);
      ok = false;
    }

    await recordStandaloneDeloadIfTriggered(supabase, userId);
  } catch (err) {
    console.error('Standalone post-session deload check failed:', err);
    ok = false;
  }
  return { ok };
}
