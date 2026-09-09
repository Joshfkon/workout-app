'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, Badge } from '@/components/ui';
import { TIER_FEATURES } from '@/lib/stripe';

export default function PublicPricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('yearly');

  // Derive prices from the same source as authenticated checkout
  const proMonthly = TIER_FEATURES.pro.monthlyPrice;
  const proYearly = TIER_FEATURES.pro.yearlyPrice;
  const eliteMonthly = TIER_FEATURES.elite.monthlyPrice;
  const eliteYearly = TIER_FEATURES.elite.yearlyPrice;

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-200 mb-10 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Home
        </Link>

        <div className="space-y-8">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-4xl font-black text-surface-100 mb-2">Pricing</h1>
            <p className="text-surface-400 mt-2 max-w-xl mx-auto">
              Choose the plan that fits your training goals. All plans include access to the web and mobile apps.
            </p>
          </div>

          {/* Mobile App Note */}
          <Card className="border-info-500/30 bg-info-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-info-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-info-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-surface-200 mb-1">
                    Subscription Management
                  </p>
                  <p className="text-sm text-surface-400">
                    Subscriptions are purchased and managed on the web. The iOS and Android apps are free to download 
                    and automatically sync your subscription when you log in.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Billing Period Toggle */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 p-1 bg-surface-800 rounded-lg">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  billingPeriod === 'monthly'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  billingPeriod === 'yearly'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Yearly
                <Badge variant="success" size="sm" className="ml-2">Save 17%</Badge>
              </button>
            </div>
          </div>

          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-6">
            <PricingCard
              tier="free"
              name="Free"
              price="$0"
              period="forever"
              description="Get started with basic workout tracking"
              features={[
                'Manual workout logging',
                'Exercise history',
                'Basic progress tracking',
                'Unlimited workouts per week',
              ]}
              cta="Get Started"
              ctaHref="/register"
            />
            <PricingCard
              tier="pro"
              name="Pro"
              price={billingPeriod === 'monthly' ? `$${proMonthly}` : `$${proYearly}`}
              period={billingPeriod === 'monthly' ? 'per month' : 'per year'}
              description="Unlock advanced features for serious lifters"
              features={[
                'Everything in Free',
                'AI mesocycle builder',
                'Smart weight suggestions',
                'Advanced analytics',
                'DEXA scan tracking',
                'Priority support',
              ]}
              cta="Start Free Trial"
              ctaHref="/register"
              isPopular={true}
            />
            <PricingCard
              tier="elite"
              name="Elite"
              price={billingPeriod === 'monthly' ? `$${eliteMonthly}` : `$${eliteYearly}`}
              period={billingPeriod === 'monthly' ? 'per month' : 'per year'}
              description="Maximum optimization for competitive athletes"
              features={[
                'Everything in Pro',
                'AI coaching calibration',
                'Strength percentiles',
                'Regional body composition',
                'Plateau detection',
                'Priority support',
              ]}
              cta="Start Free Trial"
              ctaHref="/register"
            />
          </div>

          {/* Feature Comparison */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-surface-100 mb-6 text-center">Feature Comparison</h2>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-700">
                      <th className="py-3 px-4 text-left text-surface-400 font-medium">Feature</th>
                      <th className="py-3 px-4 text-center text-surface-400 font-medium">Free</th>
                      <th className="py-3 px-4 text-center text-surface-400 font-medium">Pro</th>
                      <th className="py-3 px-4 text-center text-surface-400 font-medium">Elite</th>
                    </tr>
                  </thead>
                  <tbody>
                    <FeatureRow feature="Manual workout logging" free={true} pro={true} elite={true} />
                    <FeatureRow feature="Exercise history" free={true} pro={true} elite={true} />
                    <FeatureRow feature="Basic progress tracking" free={true} pro={true} elite={true} />
                    <FeatureRow feature="Workouts per week" free="Unlimited" pro="Unlimited" elite="Unlimited" />
                    <FeatureRow feature="AI mesocycle builder" free={false} pro={true} elite={true} />
                    <FeatureRow feature="Smart weight suggestions" free={false} pro={true} elite={true} />
                    <FeatureRow feature="Advanced analytics" free={false} pro={true} elite={true} />
                    <FeatureRow feature="DEXA scan tracking" free={false} pro={true} elite={true} />
                    <FeatureRow feature="Coaching calibration" free={false} pro={false} elite={true} />
                    <FeatureRow feature="Strength percentiles" free={false} pro={false} elite={true} />
                    <FeatureRow feature="Regional body comp analysis" free={false} pro={false} elite={true} />
                    <FeatureRow feature="Priority support" free={false} pro={true} elite={true} />
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* FAQ */}
          <Card>
            <CardContent className="p-6">
              <h2 className="text-xl font-bold text-surface-100 mb-6 text-center">Frequently Asked Questions</h2>

              <div className="space-y-4 max-w-2xl mx-auto">
                <FaqItem
                  question="Can I cancel anytime?"
                  answer="Yes! You can cancel your subscription at any time. You'll continue to have access until the end of your billing period."
                />
                <FaqItem
                  question="What happens after my trial ends?"
                  answer="After your 14-day free trial (no credit card required), your account continues on the Free plan with basic features. You can upgrade to Pro or Elite anytime to unlock advanced features."
                />
                <FaqItem
                  question="Can I change plans later?"
                  answer="Absolutely! You can upgrade, downgrade, or change your billing period at any time from your account settings."
                />
                <FaqItem
                  question="Is my payment information secure?"
                  answer="Yes! We use Stripe for payment processing. Your payment information is encrypted and never stored on our servers."
                />
                <FaqItem
                  question="How do I subscribe on mobile?"
                  answer="Mobile subscriptions are managed on the web. Visit this page on your desktop or mobile browser to subscribe, then log in to the mobile app to access your features."
                />
              </div>
            </CardContent>
          </Card>

          <div className="text-center text-surface-400 text-sm space-y-2">
            <p>30-day money-back guarantee. No questions asked.</p>
            <p>
              Already have an account?{' '}
              <Link href="/login" className="text-primary-400 hover:underline">
                Log in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingCard({
  tier,
  name,
  price,
  period,
  description,
  features,
  cta,
  ctaHref,
  isPopular = false,
}: {
  tier: 'free' | 'pro' | 'elite';
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaHref: string;
  isPopular?: boolean;
}) {
  return (
    <Card className={`relative ${isPopular ? 'border-primary-500/50 shadow-lg shadow-primary-500/10' : ''}`}>
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge variant="info" size="sm">Most Popular</Badge>
        </div>
      )}
      <CardContent className="p-6 space-y-6">
        <div>
          <h3 className="text-xl font-bold text-surface-100">{name}</h3>
          <p className="text-sm text-surface-400 mt-1">{description}</p>
        </div>

        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-surface-100">{price}</span>
          </div>
          <p className="text-sm text-surface-400 mt-1">{period}</p>
        </div>

        <Link
          href={ctaHref}
          className={`block w-full text-center px-4 py-2.5 rounded-lg font-medium transition-colors ${
            isPopular
              ? 'bg-primary-500 hover:bg-primary-600 text-white'
              : 'bg-surface-700 hover:bg-surface-600 text-surface-100'
          }`}
        >
          {cta}
        </Link>

        {/* Trial disclosure for paid tiers */}
        {tier !== 'free' && (
          <p className="text-xs text-surface-500 text-center leading-relaxed">
            14-day free trial, then {price}/{period === 'per year' ? 'year' : 'month'}. Cancel anytime.
          </p>
        )}

        <div className="pt-4 border-t border-surface-800">
          <ul className="space-y-3">
            {features.map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <svg className="w-5 h-5 text-success-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-surface-300">{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function FeatureRow({ 
  feature, 
  free, 
  pro, 
  elite 
}: { 
  feature: string; 
  free: boolean | string; 
  pro: boolean | string; 
  elite: boolean | string;
}) {
  const renderValue = (value: boolean | string) => {
    if (typeof value === 'string') {
      return <span className="text-surface-300">{value}</span>;
    }
    if (value) {
      return (
        <svg className="w-5 h-5 text-success-400 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-surface-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  };

  return (
    <tr className="border-b border-surface-800">
      <td className="py-3 px-4 text-surface-300">{feature}</td>
      <td className="py-3 px-4 text-center">{renderValue(free)}</td>
      <td className="py-3 px-4 text-center">{renderValue(pro)}</td>
      <td className="py-3 px-4 text-center">{renderValue(elite)}</td>
    </tr>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="p-4 bg-surface-800/50 rounded-lg">
      <h3 className="font-medium text-surface-200 mb-2">{question}</h3>
      <p className="text-sm text-surface-400">{answer}</p>
    </div>
  );
}
