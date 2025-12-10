'use client';

import { useState, useEffect, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { 
  TIER_FEATURES, 
  SubscriptionTier, 
  SubscriptionStatus 
} from '@/lib/stripe';
import { 
  isTrialActive, 
  getTrialEndDate, 
  getTrialDaysRemaining,
  hasFeatureAccess,
  getEffectiveTier,
  Feature
} from '@/lib/subscription';

interface SubscriptionState {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  isTrialing: boolean;
  trialDaysRemaining: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  isLoading: boolean;
}

const defaultState: SubscriptionState = {
  tier: 'free',
  status: 'trialing',
  isTrialing: true,
  trialDaysRemaining: 14,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
  isLoading: true,
};

// Global state for sharing across components
let globalSubscription: SubscriptionState = defaultState;
let globalListeners: Set<(state: SubscriptionState) => void> = new Set();

function notifyListeners(state: SubscriptionState) {
  globalSubscription = state;
  globalListeners.forEach(listener => listener(state));
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<SubscriptionState>(globalSubscription);

  // Subscribe to global updates
  useEffect(() => {
    const listener = (state: SubscriptionState) => setSubscription(state);
    globalListeners.add(listener);
    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  // Load subscription data
  useEffect(() => {
    async function loadSubscription() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          notifyListeners({ ...defaultState, isLoading: false });
          return;
        }

        // Get user's trial start date
        const { data: userData } = await supabase
          .from('users')
          .select('trial_started_at')
          .eq('id', user.id)
          .single();

        // Get subscription record
        const { data: subscriptionData } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .single();

        const trialStartedAt = userData?.trial_started_at;
        const isInTrial = isTrialActive(trialStartedAt);
        const trialEndsAt = getTrialEndDate(trialStartedAt);
        const trialDaysRemaining = getTrialDaysRemaining(trialStartedAt);

        if (!subscriptionData) {
          // No subscription - check if in trial
          notifyListeners({
            tier: 'free',
            status: isInTrial ? 'trialing' : 'canceled',
            isTrialing: isInTrial,
            trialDaysRemaining,
            trialEndsAt,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            stripeCustomerId: null,
            isLoading: false,
          });
          return;
        }

        notifyListeners({
          tier: subscriptionData.tier as SubscriptionTier || 'free',
          status: subscriptionData.status as SubscriptionStatus || 'trialing',
          isTrialing: isInTrial && subscriptionData.status !== 'active',
          trialDaysRemaining,
          trialEndsAt,
          currentPeriodEnd: subscriptionData.current_period_end 
            ? new Date(subscriptionData.current_period_end) 
            : null,
          cancelAtPeriodEnd: subscriptionData.cancel_at_period_end || false,
          stripeCustomerId: subscriptionData.stripe_customer_id || null,
          isLoading: false,
        });
      } catch (error) {
        console.error('Error loading subscription:', error);
        notifyListeners({ ...defaultState, isLoading: false });
      }
    }

    loadSubscription();
  }, []);

  // Check if user can access a feature
  const canAccess = useCallback((feature: Feature): boolean => {
    return hasFeatureAccess(
      subscription.tier,
      subscription.status,
      feature,
      subscription.isTrialing
    );
  }, [subscription.tier, subscription.status, subscription.isTrialing]);

  // Get effective tier (considering trial)
  const effectiveTier = getEffectiveTier(
    subscription.tier,
    subscription.status,
    subscription.isTrialing
  );

  // Get tier features
  const tierFeatures = TIER_FEATURES[effectiveTier];

  // Helper to check if user needs to upgrade
  const needsUpgrade = !subscription.isTrialing && 
    (subscription.tier === 'free' || subscription.status === 'canceled');

  // Create checkout session
  const createCheckout = useCallback(async (
    tier: 'pro' | 'elite',
    billingPeriod: 'monthly' | 'yearly'
  ): Promise<string | null> => {
    try {
      const supabase = createUntypedClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          priceId: tier,
          billingPeriod,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      return data.url;
    } catch (error) {
      console.error('Checkout error:', error);
      return null;
    }
  }, []);

  // Open customer portal
  const openPortal = useCallback(async (): Promise<string | null> => {
    try {
      const supabase = createUntypedClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to open portal');
      }

      return data.url;
    } catch (error) {
      console.error('Portal error:', error);
      return null;
    }
  }, []);

  // Refresh subscription data
  const refresh = useCallback(async () => {
    notifyListeners({ ...globalSubscription, isLoading: true });
    // Re-trigger the useEffect by forcing a re-render
    // In practice, the useEffect will re-run on mount
  }, []);

  return {
    ...subscription,
    effectiveTier,
    tierFeatures,
    needsUpgrade,
    canAccess,
    createCheckout,
    openPortal,
    refresh,
  };
}

// Export type for components
export type UseSubscriptionReturn = ReturnType<typeof useSubscription>;

