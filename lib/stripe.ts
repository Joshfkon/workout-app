import Stripe from 'stripe';

// Server-side Stripe instance (lazy initialization to avoid build errors)
let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

// For backwards compatibility
export const stripe = {
  get customers() { return getStripe().customers; },
  get subscriptions() { return getStripe().subscriptions; },
  get checkout() { return getStripe().checkout; },
  get billingPortal() { return getStripe().billingPortal; },
  get webhooks() { return getStripe().webhooks; },
};

// Price IDs from environment
export const STRIPE_PRICES = {
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
    yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID!,
  },
  elite: {
    monthly: process.env.STRIPE_ELITE_MONTHLY_PRICE_ID!,
    yearly: process.env.STRIPE_ELITE_YEARLY_PRICE_ID!,
  },
} as const;

// Map price IDs to tiers
export function getTierFromPriceId(priceId: string): 'pro' | 'elite' | 'free' {
  if (priceId === STRIPE_PRICES.pro.monthly || priceId === STRIPE_PRICES.pro.yearly) {
    return 'pro';
  }
  if (priceId === STRIPE_PRICES.elite.monthly || priceId === STRIPE_PRICES.elite.yearly) {
    return 'elite';
  }
  return 'free';
}

// Tier features configuration
export const TIER_FEATURES = {
  free: {
    name: 'Free',
    description: '14-day trial, then basic tracking',
    features: [
      'Unlimited workout logging',
      'Exercise history',
      'Basic progress tracking',
    ],
    limits: {
      workoutsPerWeek: Infinity,
      aiFeatures: false,
      mesocycleBuilder: false,
      coachingCalibration: false,
      advancedAnalytics: false,
    },
  },
  pro: {
    name: 'Pro',
    description: 'For serious lifters',
    monthlyPrice: 9.99,
    yearlyPrice: 99,
    features: [
      'Everything in Free',
      'AI mesocycle builder',
      'Smart weight suggestions',
      'Advanced analytics',
      'Unlimited workouts',
      'Priority support',
    ],
    limits: {
      workoutsPerWeek: Infinity,
      aiFeatures: true,
      mesocycleBuilder: true,
      coachingCalibration: false,
      advancedAnalytics: true,
    },
  },
  elite: {
    name: 'Elite',
    description: 'The complete package',
    monthlyPrice: 19.99,
    yearlyPrice: 199,
    features: [
      'Everything in Pro',
      'Coaching calibration system',
      'Strength percentile rankings',
      'Advanced body composition analysis',
      'Regional muscle analysis',
      'Personalized coaching insights',
    ],
    limits: {
      workoutsPerWeek: Infinity,
      aiFeatures: true,
      mesocycleBuilder: true,
      coachingCalibration: true,
      advancedAnalytics: true,
    },
  },
} as const;

export type SubscriptionTier = keyof typeof TIER_FEATURES;
export type SubscriptionStatus = 'trialing' | 'active' | 'canceled' | 'past_due' | 'unpaid' | 'incomplete';

