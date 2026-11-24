/** Server-only helpers shared by the Apple IAP routes. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { APPLE_BUNDLE_ID } from '@/lib/apple/iapProducts';
import { AppleJwsError, verifyAppleJws } from '@/lib/apple/verifyJws';
import type { AppleRenewalPayload, AppleTransactionPayload } from '@/lib/apple/subscriptionState';

export function appleAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}

/** Xcode-local StoreKit test payloads are accepted only outside production. */
export const ALLOW_XCODE_TRANSACTIONS = process.env.NODE_ENV !== 'production';

/** Verify a signed transaction and check it is for this app. */
export function verifyTransaction(jws: string): AppleTransactionPayload {
  const t = verifyAppleJws<AppleTransactionPayload>(jws, { allowXcodeEnvironment: ALLOW_XCODE_TRANSACTIONS });
  if (t.bundleId !== APPLE_BUNDLE_ID) throw new AppleJwsError(`Transaction is for ${t.bundleId}, not this app`);
  if (!t.originalTransactionId || !t.productId) throw new AppleJwsError('Transaction lacks its IDs');
  return t;
}

export function verifyRenewal(jws: string | undefined | null): AppleRenewalPayload | null {
  if (!jws) return null;
  return verifyAppleJws<AppleRenewalPayload>(jws, { allowXcodeEnvironment: ALLOW_XCODE_TRANSACTIONS });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s);
}
