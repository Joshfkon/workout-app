import { createClient } from '@supabase/supabase-js';
import { TIER_FEATURES, SubscriptionTier, SubscriptionStatus } from './stripe';

// Trial duration in days
const TRIAL_DURATION_DAYS = 14;

export interface SubscriptionData {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type Feature =
  | 'mesocycleBuilder'
  | 'coachingCalibration'
  | 'advancedAnalytics'
  | 'aiFeatures'
  | 'ai-coaching'
  | 'unlimitedWorkouts';

/**
 * Check if a user's trial is still active
 */
export function isTrialActive(trialStartedAt: Date | string | null): boolean {
  if (!trialStartedAt) return false;
  
  const trialStart = new Date(trialStartedAt);
  const trialEnd = new Date(trialStart);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);
  
  return new Date() < trialEnd;
}

/**
 * Get the trial end date
 */
export function getTrialEndDate(trialStartedAt: Date | string | null): Date | null {
  if (!trialStartedAt) return null;
  
  const trialStart = new Date(trialStartedAt);
  const trialEnd = new Date(trialStart);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);
  
  return trialEnd;
}

/**
 * Get days remaining in trial
 */
export function getTrialDaysRemaining(trialStartedAt: Date | string | null): number {
  if (!trialStartedAt) return 0;
  
  const trialEnd = getTrialEndDate(trialStartedAt);
  if (!trialEnd) return 0;
  
  const now = new Date();
  const diffTime = trialEnd.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}

/**
 * Check if a user has access to a specific feature
 */
export function hasFeatureAccess(
  tier: SubscriptionTier,
  status: SubscriptionStatus,
  feature: Feature,
  isInTrial: boolean
): boolean {
  // Helper to check if a limit allows access
  const isLimitEnabled = (limit: boolean | number): boolean => {
    if (typeof limit === 'boolean') return limit;
    if (typeof limit === 'number') return limit === Infinity || limit > 0;
    return false;
  };

  // During trial, user has access to all features (Elite level)
  if (isInTrial) {
    const eliteLimit = TIER_FEATURES.elite.limits[feature as keyof typeof TIER_FEATURES.elite.limits];
    return isLimitEnabled(eliteLimit);
  }
  
  // Check if subscription is in a valid state
  const validStatuses: SubscriptionStatus[] = ['active', 'trialing'];
  if (!validStatuses.includes(status)) {
    // Canceled or past_due users get free tier access to boolean features only (not limited numbers)
    const freeLimit = TIER_FEATURES.free.limits[feature as keyof typeof TIER_FEATURES.free.limits];
    // For gated features (boolean), return the value; for numeric limits, deny access
    return typeof freeLimit === 'boolean' ? freeLimit : false;
  }
  
  // Check tier limits
  const tierLimits = TIER_FEATURES[tier].limits;
  const limit = tierLimits[feature as keyof typeof tierLimits];
  
  return isLimitEnabled(limit);
}

/**
 * Get effective tier considering trial status
 */
export function getEffectiveTier(
  tier: SubscriptionTier,
  status: SubscriptionStatus,
  isInTrial: boolean
): SubscriptionTier {
  // During trial, effective tier is elite (full access)
  if (isInTrial) {
    return 'elite';
  }
  
  // If subscription is not active, fall back to free
  const validStatuses: SubscriptionStatus[] = ['active', 'trialing'];
  if (!validStatuses.includes(status)) {
    return 'free';
  }
  
  return tier;
}

/**
 * Server-side function to get user's subscription data
 * Uses service role to bypass RLS
 */
export async function getSubscriptionData(userId: string): Promise<SubscriptionData | null> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not configured');
    return null;
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );
  
  // Get subscription
  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  // Get user's trial start date
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('trial_started_at')
    .eq('id', userId)
    .single();
  
  const trialStartedAt = user?.trial_started_at;
  const isInTrial = isTrialActive(trialStartedAt);
  
  if (subError || !subscription) {
    // No subscription record - check if in trial
    return {
      tier: 'free',
      status: isInTrial ? 'trialing' : 'canceled',
      isTrialing: isInTrial,
      trialEndsAt: getTrialEndDate(trialStartedAt),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }
  
  return {
    tier: subscription.tier as SubscriptionTier,
    status: subscription.status as SubscriptionStatus,
    isTrialing: isInTrial && subscription.status !== 'active',
    trialEndsAt: getTrialEndDate(trialStartedAt),
    currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
  };
}

/**
 * Create or update subscription record
 */
export async function upsertSubscription(
  userId: string,
  data: {
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    stripe_price_id?: string;
    tier?: SubscriptionTier;
    status?: SubscriptionStatus;
    trial_ends_at?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  }
) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey
  );

  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      ...data,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });
  
  if (error) {
    console.error('Error upserting subscription:', error);
    throw error;
  }
}

