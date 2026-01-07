'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, Button, Badge, Input } from '@/components/ui';
import { PricingCard } from '@/components/subscription';
import { useSubscription } from '@/hooks/useSubscription';
import { TIER_FEATURES, SubscriptionTier } from '@/lib/stripe';
import { redeemPromoCode } from '@/lib/actions/promoCodes';

// Wrapper component that uses useSearchParams
function PricingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [loadingTier, setLoadingTier] = useState<SubscriptionTier | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const {
    tier: currentTier,
    status,
    isTrialing,
    trialDaysRemaining,
    effectiveTier,
    createCheckout,
    isLoading,
    refresh: refreshSubscription
  } = useSubscription();

  // Check for checkout result
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      setMessage({ type: 'success', text: 'Welcome to the team! Your subscription is now active.' });
    } else if (checkout === 'canceled') {
      setMessage({ type: 'info', text: 'Checkout was canceled. No charges were made.' });
    }
  }, [searchParams]);

  const handleSelectPlan = async (tier: SubscriptionTier, period: 'monthly' | 'yearly') => {
    if (tier === 'free') return;
    
    setLoadingTier(tier);
    setMessage(null);
    
    try {
      const url = await createCheckout(tier as 'pro' | 'elite', period);
      if (url) {
        window.location.href = url;
      } else {
        setMessage({ type: 'error', text: 'Failed to create checkout session. Please try again.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An error occurred. Please try again.' });
    } finally {
      setLoadingTier(null);
    }
  };

  const handleRedeemPromo = async () => {
    if (!promoCode.trim()) return;
    
    setPromoLoading(true);
    setPromoResult(null);
    
    try {
      const result = await redeemPromoCode(promoCode);
      setPromoResult(result);
      
      if (result.success) {
        setPromoCode('');
        // Clear subscription cache and refresh to show updated subscription
        setTimeout(async () => {
          await refreshSubscription();
          window.location.reload();
        }, 2000);
      }
    } catch {
      setPromoResult({ success: false, message: 'An error occurred. Please try again.' });
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-surface-100">Choose Your Plan</h1>
        <p className="text-surface-400 mt-2 max-w-xl mx-auto">
          Unlock your full potential with HyperTracker. Choose the plan that fits your training goals.
        </p>
      </div>

      {/* Trial Banner */}
      {isTrialing && trialDaysRemaining > 0 && (
        <Card className="border-warning-500/30 bg-warning-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-surface-200">
                  You have <span className="text-warning-400">{trialDaysRemaining} days</span> left in your free trial
                </p>
                <p className="text-sm text-surface-400">
                  Enjoy full Elite access while exploring all features
                </p>
              </div>
            </div>
            <Badge variant="warning">Trial Active</Badge>
          </CardContent>
        </Card>
      )}

      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg ${
          message.type === 'success' 
            ? 'bg-success-500/10 border border-success-500/20 text-success-400'
            : message.type === 'error'
            ? 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
            : 'bg-info-500/10 border border-info-500/20 text-info-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Promo Code Box */}
      <Card className="border-primary-500/20 bg-gradient-to-r from-primary-500/5 to-accent-500/5">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-surface-100">Have a Promo Code?</h3>
              <p className="text-sm text-surface-400">Enter your code below to unlock premium features instantly</p>
            </div>
          </div>
          
          <div className="flex gap-3">
            <Input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Enter promo code"
              className="flex-1 uppercase"
              disabled={promoLoading}
            />
            <Button 
              onClick={handleRedeemPromo} 
              disabled={!promoCode.trim() || promoLoading}
              isLoading={promoLoading}
            >
              Redeem
            </Button>
          </div>

          {promoResult && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${
              promoResult.success 
                ? 'bg-success-500/10 border border-success-500/20 text-success-400'
                : 'bg-danger-500/10 border border-danger-500/20 text-danger-400'
            }`}>
              {promoResult.message}
            </div>
          )}
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
          billingPeriod={billingPeriod}
          isCurrentPlan={!isTrialing && currentTier === 'free'}
          onSelect={handleSelectPlan}
          isLoading={loadingTier === 'free'}
        />
        <PricingCard
          tier="pro"
          billingPeriod={billingPeriod}
          isCurrentPlan={!isTrialing && currentTier === 'pro' && status === 'active'}
          isPopular={true}
          onSelect={handleSelectPlan}
          isLoading={loadingTier === 'pro'}
        />
        <PricingCard
          tier="elite"
          billingPeriod={billingPeriod}
          isCurrentPlan={!isTrialing && currentTier === 'elite' && status === 'active'}
          onSelect={handleSelectPlan}
          isLoading={loadingTier === 'elite'}
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
              answer="After your 14-day trial, you'll be on the Free plan with basic features. You can upgrade anytime to unlock Pro or Elite features."
            />
            <FaqItem 
              question="Can I change plans later?"
              answer="Absolutely! You can upgrade, downgrade, or change your billing period at any time from your account settings."
            />
            <FaqItem 
              question="Is my payment information secure?"
              answer="Yes! We use Stripe for payment processing. Your payment information is encrypted and never stored on our servers."
            />
          </div>
        </CardContent>
      </Card>

      {/* Money-back guarantee */}
      <div className="text-center text-surface-400 text-sm">
        <p>30-day money-back guarantee. No questions asked.</p>
      </div>
    </div>
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

// Export with Suspense wrapper for useSearchParams
export default function PricingPage() {
  return (
    <Suspense fallback={
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-surface-100">Choose Your Plan</h1>
          <p className="text-surface-400 mt-2">Loading pricing...</p>
        </div>
      </div>
    }>
      <PricingContent />
    </Suspense>
  );
}

