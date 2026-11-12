/**
 * Server-side feature gate.
 *
 * The UI gates paid features with `useSubscription().canAccess(feature)`,
 * which is `hasFeatureAccess(tier, status, feature, isTrialing)` from
 * lib/subscription. That check runs in the browser, so on its own it only
 * hides buttons: a server action behind it could still be called directly.
 * This applies the SAME function to the SAME inputs, read server-side, so the
 * server and the UI can never disagree about who has access (trial, lifetime
 * and promo subscriptions included — they are just rows with tier/status).
 *
 * Deliberately NOT a 'use server' module: it takes a userId, so it must never
 * be callable from the browser.
 */

import { getSubscriptionData, hasFeatureAccess, type Feature } from '@/lib/subscription';

/**
 * True when this user may use `feature`. Fails closed: if the subscription
 * cannot be read (e.g. the service role key is not configured) access is
 * denied.
 */
export async function userHasFeatureAccess(userId: string, feature: Feature): Promise<boolean> {
  const subscription = await getSubscriptionData(userId);
  if (!subscription) return false;
  return hasFeatureAccess(
    subscription.tier,
    subscription.status,
    feature,
    subscription.isTrialing
  );
}

/** Message shown when a server action is refused for lack of the tier. */
export const TIER_REQUIRED_MESSAGES: Partial<Record<Feature, string>> = {
  'ai-coaching': 'AI Coach is part of the Elite plan. Upgrade to use it.',
};

/**
 * Throws a plain Error (server actions need serializable errors) unless the
 * user may use `feature`.
 */
export async function requireFeatureAccess(userId: string, feature: Feature): Promise<void> {
  if (!(await userHasFeatureAccess(userId, feature))) {
    throw new Error(TIER_REQUIRED_MESSAGES[feature] ?? 'Your plan does not include this feature.');
  }
}
