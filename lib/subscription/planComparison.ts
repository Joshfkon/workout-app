/**
 * The plan comparison table and per-plan lists, derived from TIER_FEATURES
 * (lib/stripe) so the pricing pages can't drift from it again (they had
 * hand-written lists that sold "DEXA scan tracking" as Pro-only, which no
 * plan list or gate ever said).
 *
 * Each plan includes everything the plans below it list ("Everything in
 * Free" / "Everything in Pro" lines are the roll-up, not features).
 */

import { TIER_FEATURES, type SubscriptionTier } from '@/lib/stripe';

export const PLAN_ORDER: readonly SubscriptionTier[] = ['free', 'pro', 'elite'];

export interface PlanComparisonRow {
  feature: string;
  free: boolean;
  pro: boolean;
  elite: boolean;
}

function isRollUp(feature: string): boolean {
  return /^Everything in /.test(feature);
}

/** A plan's own list, as TIER_FEATURES gives it (roll-up line included). */
export function planFeatureList(tier: SubscriptionTier): string[] {
  return [...TIER_FEATURES[tier].features];
}

export function planComparisonRows(): PlanComparisonRow[] {
  const rows: PlanComparisonRow[] = [];
  PLAN_ORDER.forEach((tier, index) => {
    for (const feature of TIER_FEATURES[tier].features) {
      if (isRollUp(feature)) continue;
      rows.push({
        feature,
        free: index <= 0,
        pro: index <= 1,
        elite: true,
      });
    }
  });
  return rows;
}
