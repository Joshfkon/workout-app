/**
 * Record a VERIFIED Apple subscription on the user's subscriptions row.
 * SERVER ONLY (service-role client; the table is write-locked to it).
 *
 * The row is the same one the Stripe webhook writes, so every tier check
 * reads Apple purchases with no other change. Precedence:
 *  - a lifetime promo row is never touched;
 *  - an active Stripe subscription is never downgraded by Apple data (an
 *    expired Apple sub on a web subscriber leaves the web tier alone); an
 *    active Apple sub on top only raises the tier;
 *  - one Apple subscription belongs to one account: a transaction already
 *    recorded on another user is refused;
 *  - newest wins: a payload Apple signed before the last one applied is
 *    stale (an old purchase JWS resent after a refund still verifies and may
 *    still carry a future expiry; a notification can arrive late) and is
 *    ignored.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  appleSubscriptionState,
  type AppleRenewalPayload,
  type AppleSubscriptionState,
  type AppleTransactionPayload,
} from '@/lib/apple/subscriptionState';

export type ApplyResult =
  | { ok: true; state: AppleSubscriptionState; changedTier: boolean }
  | { ok: false; reason: 'other_account' | 'lifetime_promo' | 'unknown_user' | 'stale' | 'db_error'; message: string };

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, elite: 2 };

interface ExistingRow {
  user_id: string;
  tier: string | null;
  status: string | null;
  billing_source: string | null;
  stripe_subscription_id: string | null;
  is_lifetime: boolean | null;
  promo_code_id: string | null;
  apple_original_transaction_id: string | null;
  apple_signed_at: string | null;
}

export async function applyAppleSubscription(
  admin: SupabaseClient,
  userId: string,
  transaction: AppleTransactionPayload,
  renewal: AppleRenewalPayload | null,
  now: Date
): Promise<ApplyResult> {
  const state = appleSubscriptionState(transaction, renewal, now);

  const { data: owner, error: ownerError } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('apple_original_transaction_id', transaction.originalTransactionId)
    .maybeSingle();
  if (ownerError) return { ok: false, reason: 'db_error', message: ownerError.message };
  if (owner && owner.user_id !== userId) {
    return { ok: false, reason: 'other_account', message: 'This App Store subscription belongs to another HyperTrack account.' };
  }

  const { data: existing, error: existingError } = await admin
    .from('subscriptions')
    .select('user_id, tier, status, billing_source, stripe_subscription_id, is_lifetime, promo_code_id, apple_original_transaction_id, apple_signed_at')
    .eq('user_id', userId)
    .maybeSingle<ExistingRow>();
  if (existingError) return { ok: false, reason: 'db_error', message: existingError.message };

  if (existing?.is_lifetime && existing.promo_code_id) {
    return { ok: false, reason: 'lifetime_promo', message: 'Lifetime access already active.' };
  }

  const signedAt = typeof transaction.signedDate === 'number' ? new Date(transaction.signedDate) : null;
  if (existing?.apple_signed_at && signedAt && signedAt < new Date(existing.apple_signed_at)) {
    return { ok: false, reason: 'stale', message: 'A newer App Store update is already recorded.' };
  }

  const appleFields = {
    apple_original_transaction_id: transaction.originalTransactionId,
    apple_product_id: transaction.productId,
    apple_environment: transaction.environment ?? null,
    ...(signedAt ? { apple_signed_at: signedAt.toISOString() } : {}),
  };

  // The Stripe webhook sets billing_source 'stripe' on every write, so a web
  // plan bought after an Apple one is recognised here; NULL is a row from
  // before Apple IAP.
  const stripeActive =
    !!existing?.stripe_subscription_id &&
    (existing.billing_source === 'stripe' || existing.billing_source === null) &&
    (existing.status === 'active' || existing.status === 'trialing');

  let row: Record<string, unknown>;
  if (stripeActive) {
    // Web subscriber: Apple can only raise the tier, never end access.
    const raise = state.status === 'active' && TIER_RANK[state.tier] > TIER_RANK[existing!.tier ?? 'free'];
    row = { user_id: userId, ...appleFields, ...(raise ? { tier: state.tier } : {}) };
  } else {
    row = {
      user_id: userId,
      ...appleFields,
      billing_source: 'apple',
      tier: state.tier,
      status: state.status,
      current_period_start: state.currentPeriodStart,
      current_period_end: state.currentPeriodEnd,
      cancel_at_period_end: state.cancelAtPeriodEnd,
      trial_ends_at: null,
    };
  }

  const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' });
  if (error) {
    // 23503: no such user (a notification whose appAccountToken is not ours).
    if (error.code === '23503') return { ok: false, reason: 'unknown_user', message: error.message };
    return { ok: false, reason: 'db_error', message: error.message };
  }
  const nextTier = (row.tier as string | undefined) ?? existing?.tier ?? 'free';
  return { ok: true, state, changedTier: nextTier !== (existing?.tier ?? 'free') };
}
