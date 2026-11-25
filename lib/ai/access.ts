/**
 * Who may use which AI feature, enforced on the server.
 *
 * Every AI server action calls this before it spends anything on a provider.
 * The plan check is the same hasFeatureAccess() the UI uses (via
 * useSubscription().canAccess), applied to the subscription read server-side,
 * so the UI and the server agree on who has access.
 *
 * Order of checks:
 * 1. Kill switch: AI_FEATURES_DISABLED=true (a server env var) turns every AI
 *    feature off at once, e.g. if provider spend spikes.
 * 2. Plan: Pro features need `aiFeatures`, Elite features need `ai-coaching`.
 *    The free trial includes both (it is Elite-level). A user whose plan
 *    lacks a feature can still use its free daily allowance, if it has one.
 * 3. Daily quota by plan (lib/ai/rateLimit.ts).
 *
 * Deliberately NOT a 'use server' module: it takes a userId, so it must never
 * be callable from the browser.
 */

import { getSubscriptionData, hasFeatureAccess, type Feature } from '@/lib/subscription';
import {
  AI_DAILY_LIMITS,
  AI_RATE_LIMIT_MESSAGE,
  consumeAiQuota,
  type AiFeature,
  type AiQuotaTier,
} from '@/lib/ai/rateLimit';

/** The plan feature each AI feature needs. */
export const AI_FEATURE_REQUIRES: Record<AiFeature, Feature> = {
  coach_chat: 'ai-coaching',
  workout_coach_notes: 'ai-coaching',
  meal_parse: 'aiFeatures',
  label_scan: 'aiFeatures',
  photo_bf_estimate: 'aiFeatures',
  plan_review: 'aiFeatures',
  motion_coach: 'aiFeatures',
};

const FEATURE_NAMES: Record<AiFeature, string> = {
  coach_chat: 'AI Coach',
  workout_coach_notes: 'AI workout notes',
  meal_parse: 'AI meal logging',
  label_scan: 'AI label scanning',
  photo_bf_estimate: 'AI body fat estimates',
  plan_review: 'AI plan review',
  motion_coach: 'AI motion coaching',
};

/** Message for a user whose plan doesn't include `feature`. */
export function aiPlanRequiredMessage(feature: AiFeature): string {
  const plan = AI_FEATURE_REQUIRES[feature] === 'ai-coaching' ? 'Elite' : 'Pro';
  return `${FEATURE_NAMES[feature]} is part of the ${plan} plan. Upgrade to use it.`;
}

/** Message for a free user who has used today's free allowance. */
export function aiFreeLimitMessage(feature: AiFeature): string {
  const n = AI_DAILY_LIMITS[feature].free;
  return `You've used today's ${n} free ${n === 1 ? 'try' : 'tries'} of ${FEATURE_NAMES[feature]}. Upgrade to Pro for more, or try again tomorrow.`;
}

export const AI_DISABLED_MESSAGE =
  'AI features are temporarily unavailable. Everything else works as usual.';

export function aiFeaturesDisabled(): boolean {
  return process.env.AI_FEATURES_DISABLED === 'true';
}

/**
 * 'free_limit': a free user used up the free allowance. The UI shows an
 * upgrade prompt for it (the plain 'limit' just says "try tomorrow").
 */
export type AiRefusalReason = 'disabled' | 'plan' | 'limit' | 'free_limit';

export type AiAccess =
  | { allowed: true; quotaTier: AiQuotaTier }
  | { allowed: false; reason: 'disabled' | 'plan'; message: string };

/**
 * Whether this user may use `feature` at all (kill switch + plan), and which
 * quota caps apply. Spends no quota. Fails closed: if the subscription can't
 * be read, access is refused.
 */
export async function checkAiAccess(userId: string, feature: AiFeature): Promise<AiAccess> {
  if (aiFeaturesDisabled()) {
    return { allowed: false, reason: 'disabled', message: AI_DISABLED_MESSAGE };
  }
  const subscription = await getSubscriptionData(userId);
  if (!subscription) {
    return { allowed: false, reason: 'plan', message: aiPlanRequiredMessage(feature) };
  }
  const inPlan = hasFeatureAccess(
    subscription.tier,
    subscription.status,
    AI_FEATURE_REQUIRES[feature],
    subscription.isTrialing
  );
  if (inPlan) {
    return { allowed: true, quotaTier: subscription.isTrialing ? 'trial' : 'paid' };
  }
  if (AI_DAILY_LIMITS[feature].free > 0) {
    return { allowed: true, quotaTier: 'free' };
  }
  return { allowed: false, reason: 'plan', message: aiPlanRequiredMessage(feature) };
}

export type AiAuthorization =
  | { ok: true }
  | { ok: false; reason: AiRefusalReason; message: string };

/**
 * checkAiAccess, then counts one request against the user's daily quota.
 * Call right before the provider request, after cheap input validation.
 */
export async function authorizeAiRequest(
  supabase: unknown,
  userId: string,
  feature: AiFeature
): Promise<AiAuthorization> {
  const access = await checkAiAccess(userId, feature);
  if (!access.allowed) {
    return { ok: false, reason: access.reason, message: access.message };
  }
  if (!(await consumeAiQuota(supabase, feature, access.quotaTier))) {
    return access.quotaTier === 'free'
      ? { ok: false, reason: 'free_limit', message: aiFreeLimitMessage(feature) }
      : { ok: false, reason: 'limit', message: AI_RATE_LIMIT_MESSAGE };
  }
  return { ok: true };
}
