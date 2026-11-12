'use server';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

interface DeleteAccountResult {
  success: boolean;
  message: string;
}

type ServiceClient = SupabaseClient;

/** Stripe statuses that are already finished; nothing to cancel. */
const ENDED_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired']);

/**
 * Cancel every live Stripe subscription for this user's customer. Listing by
 * customer (not just the stored subscription id) also catches a second
 * subscription created by a duplicate checkout. Throws if Stripe cannot be
 * reached or refuses, so the caller can abort the deletion.
 */
async function cancelStripeSubscriptions(serviceSupabase: ServiceClient, userId: string): Promise<void> {
  const { data: sub, error } = await serviceSupabase
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const customerId: string | null = sub?.stripe_customer_id ?? null;
  const subscriptionId: string | null = sub?.stripe_subscription_id ?? null;
  // Never went through checkout: nothing at Stripe to cancel.
  if (!customerId && !subscriptionId) return;

  // Has Stripe ids but Stripe is not configured: getStripe() throws, and the
  // deletion is aborted rather than silently leaving a subscription billing.
  const toCancel = new Set<string>();
  if (customerId) {
    try {
      const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      for (const s of list.data) {
        if (!ENDED_STRIPE_STATUSES.has(s.status)) toCancel.add(s.id);
      }
    } catch (err) {
      // The customer no longer exists at Stripe, so nothing can be billing.
      if ((err as { code?: string })?.code !== 'resource_missing') throw err;
    }
  } else if (subscriptionId) {
    toCancel.add(subscriptionId);
  }

  for (const id of Array.from(toCancel)) {
    try {
      await stripe.subscriptions.cancel(id);
    } catch (err) {
      // Already gone at Stripe — that is the state we want.
      if ((err as { code?: string })?.code === 'resource_missing') continue;
      throw err;
    }
  }
}

/** Best effort: revoke any stored Fitbit tokens at Fitbit. Never throws. */
async function revokeFitbitTokens(serviceSupabase: ServiceClient, userId: string): Promise<void> {
  try {
    const clientId = process.env.FITBIT_CLIENT_ID;
    const clientSecret = process.env.FITBIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) return;

    const { data: connections } = await serviceSupabase
      .from('wearable_connections')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .eq('source', 'fitbit');

    for (const connection of connections ?? []) {
      // Revoking the refresh token invalidates the whole grant; fall back to
      // the access token when that is all we hold.
      const token: string | null = connection.refresh_token ?? connection.access_token ?? null;
      if (!token) continue;
      const response = await fetch('https://api.fitbit.com/oauth2/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok && response.status !== 400 && response.status !== 401) {
        console.error(`Account deletion: Fitbit revoke returned ${response.status} (continuing)`);
      }
    }
  } catch (err) {
    console.error('Account deletion: Fitbit revoke failed (continuing):', err);
  }
}

/**
 * Remove every object under `<userId>/` in a bucket (uploads are always
 * stored under the owner's id as the leading folder). Throws on a storage
 * error; a bucket that does not exist counts as "nothing to remove".
 */
async function purgeStoragePrefix(serviceSupabase: ServiceClient, bucket: string, userId: string): Promise<void> {
  const PAGE = 100;
  // Each pass removes what it lists, so always read from the start. The pass
  // cap only guards against a remove that reports success but deletes nothing.
  for (let pass = 0; pass < 200; pass++) {
    const { data, error } = await serviceSupabase.storage.from(bucket).list(userId, { limit: PAGE });
    if (error) {
      if (/not found/i.test(error.message ?? '')) return;
      throw error;
    }
    // Folders come back without an id; uploads here are flat files.
    const paths = (data ?? []).filter((o) => o.id).map((o) => `${userId}/${o.name}`);
    if (paths.length === 0) return;
    const { error: removeError } = await serviceSupabase.storage.from(bucket).remove(paths);
    if (removeError) throw removeError;
    if ((data ?? []).length < PAGE) return;
  }
  throw new Error(`Could not empty ${bucket}/${userId}`);
}

/**
 * Permanently delete the currently authenticated user's account.
 *
 * Required by App Store Review Guideline 5.1.1(v): any app that supports
 * account creation must let the user initiate account deletion from within
 * the app.
 *
 * Order matters — everything that needs the user's rows runs BEFORE the auth
 * user is deleted, because that delete cascades them away:
 *
 *  1. Cancel any live Stripe subscription. If this fails the deletion is
 *     aborted: deleting the account while it keeps billing is the worse
 *     outcome, and the user can simply retry.
 *  2. Revoke Fitbit OAuth tokens (best effort — a stale token at Fitbit is
 *     not a reason to keep someone's account).
 *  3. Remove the user's progress photos from storage. Storage objects are not
 *     rows the cascade reaches, so without this body photos would be orphaned
 *     forever. Failure aborts (retryable). Avatars are removed best-effort.
 *  4. Delete the row in `auth.users`, which cascades to every user-owned
 *     table (`user_id ... ON DELETE CASCADE`): profile, workouts, nutrition,
 *     subscription record, measurements, etc. (Custom exercises authored by
 *     the user use `ON DELETE SET NULL`, so they remain in the library
 *     un-owned.)
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  // Identify the caller from their session cookie (anon client).
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: 'You must be logged in to delete your account.' };
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    return { success: false, message: 'Server configuration error. Please contact support.' };
  }

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );

  // 1. Stop billing.
  try {
    await cancelStripeSubscriptions(serviceSupabase, user.id);
  } catch (err) {
    console.error('Account deletion: failed to cancel Stripe subscription:', err);
    return {
      success: false,
      message:
        'We could not cancel your subscription, so your account was not deleted. Please try again or contact support.',
    };
  }

  // 2. Revoke third-party tokens (best effort).
  await revokeFitbitTokens(serviceSupabase, user.id);

  // 3. Remove stored photos.
  try {
    await purgeStoragePrefix(serviceSupabase, 'progress-photos', user.id);
  } catch (err) {
    console.error('Account deletion: failed to remove progress photos:', err);
    return {
      success: false,
      message:
        'We could not remove your progress photos, so your account was not deleted. Please try again or contact support.',
    };
  }
  try {
    await purgeStoragePrefix(serviceSupabase, 'avatars', user.id);
  } catch (err) {
    console.error('Account deletion: failed to remove avatar files (continuing):', err);
  }

  // 4. Deleting the auth user cascades to all user-owned rows.
  const { error } = await serviceSupabase.auth.admin.deleteUser(user.id);

  if (error) {
    console.error('Account deletion failed:', error);
    return { success: false, message: 'Failed to delete your account. Please try again or contact support.' };
  }

  return { success: true, message: 'Your account has been permanently deleted.' };
}
