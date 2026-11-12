/**
 * Per-user daily caps on AI server actions.
 *
 * Every AI action spends money on a provider key, and server actions can be
 * called directly (in a loop) by any signed-in user. The counter lives in
 * `ai_usage_counters`, which the browser roles cannot read or write; the only
 * way in is the `consume_ai_quota` RPC, which keys off auth.uid()
 * (migration 20261112000004).
 *
 * The limits are deliberately far above what a person does in a day — they
 * exist to stop scripts, not users.
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

/** Requests per user per UTC day. Keep in sync with consume_ai_quota's feature list. */
export const AI_DAILY_LIMITS: Record<AiFeature, number> = {
  coach_chat: 100,
  workout_coach_notes: 60,
  meal_parse: 100,
  label_scan: 100,
  photo_bf_estimate: 30,
  plan_review: 60,
  motion_coach: 300,
};

export const AI_RATE_LIMIT_MESSAGE =
  "You've reached today's limit for this AI feature. It resets tomorrow.";

/** The slice of a Supabase client this needs (the signed-in user's client). */
interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Counts one request against the signed-in user's daily quota for `feature`.
 * Returns false only when the database says the user is at the limit.
 *
 * Fails OPEN when the counter itself is unavailable (migration not applied
 * yet, transient DB error): an infrastructure problem must not take every AI
 * feature down. The failure is logged so it is visible.
 */
export async function consumeAiQuota(supabase: unknown, feature: AiFeature): Promise<boolean> {
  try {
    const { data, error } = await (supabase as RpcClient).rpc('consume_ai_quota', {
      p_feature: feature,
      p_daily_limit: AI_DAILY_LIMITS[feature],
    });
    if (error) {
      console.error('[AI rate limit] consume_ai_quota failed; allowing request:', error);
      return true;
    }
    return data !== false;
  } catch (err) {
    console.error('[AI rate limit] consume_ai_quota threw; allowing request:', err);
    return true;
  }
}
