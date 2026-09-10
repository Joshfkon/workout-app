'use server';

import { createUntypedServerClient } from '@/lib/supabase/server';
import { cancelWorkoutSession } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/cancelWorkout';

/**
 * Server action to discard an in-progress workout session.
 *
 * Wraps the existing cancelWorkoutSession logic so client components
 * (like ResumeWorkoutBanner) can properly end a session in the database,
 * not just in local state.
 *
 * Returns { ok: true } on success, or { ok: false, errors } on failure.
 */
export async function discardWorkoutSession(
  sessionId: string,
  mesocycleId: string | null,
  blockIds: string[]
): Promise<{ ok: boolean; errors?: string[] }> {
  try {
    const supabase = createUntypedServerClient();
    const result = await cancelWorkoutSession(supabase, {
      sessionId,
      mesocycleId,
      blockIds,
    });
    return result;
  } catch (err) {
    console.error('Failed to discard workout session:', err);
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : 'Unknown error'],
    };
  }
}
