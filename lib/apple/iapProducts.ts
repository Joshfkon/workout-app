/**
 * App Store subscription products. Create these in App Store Connect (one
 * subscription group, "HyperTrack"), with the same IDs and prices as
 * TIER_FEATURES in lib/stripe.ts. docs/APPLE_IAP_SETUP.md walks through it.
 *
 * Shared by the iOS purchase screen and the server that verifies Apple's
 * signed transactions. No server-only imports here.
 */
import type { SubscriptionTier } from '@/lib/stripe';

export const APPLE_BUNDLE_ID = 'app.hypertrack.workout';

export type AppleBillingPeriod = 'monthly' | 'yearly';

export interface AppleProduct {
  id: string;
  tier: Exclude<SubscriptionTier, 'free'>;
  period: AppleBillingPeriod;
}

export const APPLE_PRODUCTS: readonly AppleProduct[] = [
  { id: 'app.hypertrack.workout.pro.monthly', tier: 'pro', period: 'monthly' },
  { id: 'app.hypertrack.workout.pro.yearly', tier: 'pro', period: 'yearly' },
  { id: 'app.hypertrack.workout.elite.monthly', tier: 'elite', period: 'monthly' },
  { id: 'app.hypertrack.workout.elite.yearly', tier: 'elite', period: 'yearly' },
];

export const APPLE_PRODUCT_IDS: readonly string[] = APPLE_PRODUCTS.map((p) => p.id);

/** The tier an App Store product unlocks, or null for an unknown product. */
export function tierForAppleProduct(productId: string | null | undefined): AppleProduct['tier'] | null {
  return APPLE_PRODUCTS.find((p) => p.id === productId)?.tier ?? null;
}

export function appleProduct(tier: AppleProduct['tier'], period: AppleBillingPeriod): AppleProduct {
  return APPLE_PRODUCTS.find((p) => p.tier === tier && p.period === period)!;
}
