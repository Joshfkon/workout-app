/**
 * What an Apple subscription means for the account, from Apple's own signed
 * fields. Pure: the caller verifies the JWS (verifyJws.ts) and passes `now`.
 *
 * Field names follow Apple's JWSTransactionDecodedPayload and
 * JWSRenewalInfoDecodedPayload (dates are epoch milliseconds).
 */
import { tierForAppleProduct, type AppleProduct } from '@/lib/apple/iapProducts';

export interface AppleTransactionPayload {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  bundleId: string;
  expiresDate?: number;
  purchaseDate?: number;
  revocationDate?: number;
  /** The account UUID the app passed at purchase (StoreKit appAccountToken). */
  appAccountToken?: string;
  environment?: string;
  type?: string;
  signedDate?: number;
}

export interface AppleRenewalPayload {
  originalTransactionId?: string;
  /** 1 = renews, 0 = the user turned renewal off. */
  autoRenewStatus?: number;
  autoRenewProductId?: string;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
}

export interface AppleSubscriptionState {
  tier: AppleProduct['tier'] | 'free';
  status: 'active' | 'canceled';
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

const iso = (ms: number | undefined) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

export function appleSubscriptionState(
  transaction: AppleTransactionPayload,
  renewal: AppleRenewalPayload | null,
  now: Date
): AppleSubscriptionState {
  const tier = tierForAppleProduct(transaction.productId);
  // Access runs to the period end, or the billing grace period if Apple
  // granted one while it retries a failed renewal.
  const end = Math.max(transaction.expiresDate ?? 0, renewal?.gracePeriodExpiresDate ?? 0);
  const active = !!tier && !transaction.revocationDate && end > now.getTime();
  return {
    tier: active ? tier! : 'free',
    status: active ? 'active' : 'canceled',
    currentPeriodStart: iso(transaction.purchaseDate),
    currentPeriodEnd: iso(end || undefined),
    cancelAtPeriodEnd: active && renewal?.autoRenewStatus === 0,
  };
}

/** Of several verified transactions (Transaction.currentEntitlements), the one that grants the most. */
export function bestAppleTransaction(
  transactions: AppleTransactionPayload[],
  now: Date
): AppleTransactionPayload | null {
  const rank = { elite: 2, pro: 1, free: 0 } as const;
  let best: AppleTransactionPayload | null = null;
  let bestScore = -1;
  for (const t of transactions) {
    const s = appleSubscriptionState(t, null, now);
    const score = rank[s.tier] * 1e15 + (t.expiresDate ?? 0) / 1e3;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}
