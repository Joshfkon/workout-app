/**
 * Per-user daily caps on AI server actions.
 *
 * Every AI action spends money on a provider key, and server actions can be
 * called directly (in a loop) by any signed-in user. The counter lives in
 * `ai_usage_counters`, which the browser roles cannot read or write; the only
 * way in is the `consume_ai_quota` RPC, which keys off auth.uid()
 * (migration 20261112000004).
 *
 * Caps depend on how the user has access (see lib/ai/access.ts, which also
 * decides WHETHER they have access):
 * - 'paid': a paying subscriber. Caps sit around heavy real use.
 * - 'trial': the free trial anyone gets by signing up. Accounts are free to
 *   create, so caps are lower, and the counter fails closed.
 * - 'free': a free user after the trial. A small daily allowance of the
 *   cheap features, to show what Pro does; 0 means paid-only. Fails closed.
 *
 * Deliberately NOT a 'use server' module.
 */

export type AiFeature =
  | 'coach_chat'
  | 'workout_coach_notes'
  | 'meal_parse'
  | 'label_scan'
  | 'photo_bf_estimate'
  | 'plan_review'
  | 'motion_coach';

export type AiQuotaTier = 'paid' | 'trial' | 'free';

/**
 * Requests per user per UTC day, by how the user has access.
 * Keep the feature list in sync with consume_ai_quota's.
 */
export const AI_DAILY_LIMITS: Record<AiFeature, Record<AiQuotaTier, number>> = {
  coach_chat: { paid: 50, trial: 15, free: 0 },
  workout_coach_notes: { paid: 10, trial: 4, free: 0 },
  // Cheap (Haiku) and user-triggered: free users get a taste of Pro.
  meal_parse: { paid: 30, trial: 10, free: 2 },
  label_scan: { paid: 30, trial: 10, free: 2 },
  // Runs on the most expensive model.
  photo_bf_estimate: { paid: 5, trial: 2, free: 0 },
  // Background calls: a free allowance would be used up without the user
  // choosing to, so these stay paid-only.
  plan_review: { paid: 20, trial: 5, free: 0 },
  // Short phrasing calls, several per set while the motion coach is on.
  motion_coach: { paid: 200, trial: 60, free: 0 },
};

export const AI_RATE_LIMIT_MESSAGE =
  "You've reached today's limit for this AI feature. It resets tomorrow.";

/** The slice of a Supabase client this needs (the signed-in user's client). */
interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Counts one request against the signed-in user's daily quota for `feature`.
 * Returns false when the database says the user is at the limit.
 *
 * When the counter itself is unavailable (transient DB error):
 * - paid users fail OPEN, so an infrastructure problem doesn't take away
 *   what they pay for;
 * - trial and free users fail CLOSED, so an outage can't become unmetered
 *   free use.
 * Either way the failure is logged.
 */
export async function consumeAiQuota(
  supabase: unknown,
  feature: AiFeature,
  tier: AiQuotaTier = 'paid'
): Promise<boolean> {
  const failOpen = tier === 'paid';
  try {
    const { data, error } = await (supabase as RpcClient).rpc('consume_ai_quota', {
      p_feature: feature,
      p_daily_limit: AI_DAILY_LIMITS[feature][tier],
    });
    if (error) {
      console.error(`[AI rate limit] consume_ai_quota failed; ${failOpen ? 'allowing' : 'refusing'} request:`, error);
      return failOpen;
    }
    return data !== false;
  } catch (err) {
    console.error(`[AI rate limit] consume_ai_quota threw; ${failOpen ? 'allowing' : 'refusing'} request:`, err);
    return failOpen;
  }
}
