'use client';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, Button, Badge, Input } from '@/components/ui';
import { PricingCard } from '@/components/subscription';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsNativePlatform } from '@/hooks/useIsNativePlatform';
import { ApplePlans } from '@/components/subscription/ApplePlans';
import { isApplePurchasesAvailable } from '@/lib/integrations/applePurchases';
import { SubscriptionTier } from '@/lib/stripe';
import { planComparisonRows } from '@/lib/subscription/planComparison';
import { redeemPromoCode } from '@/lib/actions/promoCodes';

// Wrapper component that uses useSearchParams
function PricingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isNative = useIsNativePlatform();
  const [applePurchases, setApplePurchases] = useState(false);
  useEffect(() => setApplePurchases(isApplePurchasesAvailable()), [isNative]);
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
        <h1 className="text-large-title text-ink">Choose your plan</h1>
        <p className="text-ink-2 mt-2 max-w-xl mx-auto">
          Unlock your full potential with HyperTrack. Choose the plan that fits your training goals.
        </p>
      </div>

      {/* Trial Banner */}
      {isTrialing && trialDaysRemaining > 0 && (
        <Card className="border-status-warn/30 bg-status-warn/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-status-warn/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-status-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-ink">
                  You have <span className="text-status-warn">{trialDaysRemaining} days</span> left in your free trial
                </p>
                <p className="text-subhead text-ink-2">
                  Enjoy full Elite access while exploring all features
                </p>
              </div>
            </div>
            <Badge variant="warning">Trial active</Badge>
          </CardContent>
        </Card>
      )}

      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg ${
          message.type === 'success' 
            ? 'bg-status-ok/10 border border-status-ok/20 text-status-ok'
            : message.type === 'error'
            ? 'bg-status-bad/10 border border-status-bad/20 text-status-bad'
            : 'bg-action-tint text-action'
        }`}>
          {message.text}
        </div>
      )}

      {/* Promo Code Box */}
      <Card className="border-action/20 bg-action/5 ">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-action/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-ink">Have a Promo Code?</h3>
              <p className="text-subhead text-ink-2">Enter your code below to unlock premium features instantly</p>
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
            <div className={`mt-4 p-3 rounded-lg text-subhead ${
              promoResult.success 
                ? 'bg-status-ok/10 border border-status-ok/20 text-status-ok'
                : 'bg-status-bad/10 border border-status-bad/20 text-status-bad'
            }`}>
              {promoResult.message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* iOS with the purchases plugin: App Store subscriptions (Guideline
          3.1.1: a subscription unlocked in the app is sold in the app). An
          app build without the plugin keeps the old web-managed note, with
          no price, button or link out. Web: Stripe cards. */}
      {isNative && applePurchases ? (
        <ApplePlans />
      ) : isNative ? (
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <h2 className="text-headline font-semibold text-ink">Plans &amp; billing are managed on the web</h2>
            <p className="text-subhead text-ink-2 max-w-md mx-auto">
              Already subscribed? Your plan is active here automatically. You can compare what each
              plan includes below, or redeem a promo code above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 p-1 bg-fill rounded-lg">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-4 py-2 rounded-md text-subhead font-medium transition-colors ${
                  billingPeriod === 'monthly'
                    ? 'bg-sep text-ink'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-4 py-2 rounded-md text-subhead font-medium transition-colors ${
                  billingPeriod === 'yearly'
                    ? 'bg-sep text-ink'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Yearly
                <Badge variant="success" size="sm" className="ml-2">Save 17%</Badge>
              </button>
            </div>
          </div>

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
        </>
      )}

      {/* Feature Comparison */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-headline font-bold text-ink mb-6 text-center">Feature comparison</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-sep">
                  <th className="py-3 px-4 text-left text-ink-2 font-medium">Feature</th>
                  <th className="py-3 px-4 text-center text-ink-2 font-medium">Free</th>
                  <th className="py-3 px-4 text-center text-ink-2 font-medium">Pro</th>
                  <th className="py-3 px-4 text-center text-ink-2 font-medium">Elite</th>
                </tr>
              </thead>
              <tbody>
                {/* Straight from TIER_FEATURES (lib/subscription/planComparison). */}
                {planComparisonRows().map((row) => (
                  <FeatureRow key={row.feature} feature={row.feature} free={row.free} pro={row.pro} elite={row.elite} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* FAQ + money-back guarantee — web only (payment-related). */}
      {!isNative && (
        <>
          <Card>
            <CardContent className="p-6">
              <h2 className="text-headline font-bold text-ink mb-6 text-center">Frequently asked questions</h2>

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
              </div>
            </CardContent>
          </Card>

          <div className="text-center text-ink-2 text-subhead">
            <p>30-day money-back guarantee. No questions asked.</p>
          </div>
        </>
      )}
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
      return <span className="text-ink-2">{value}</span>;
    }
    if (value) {
      return (
        <svg className="w-5 h-5 text-status-ok mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-ink-3 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  };

  return (
    <tr className="border-b border-sep">
      <td className="py-3 px-4 text-ink-2">{feature}</td>
      <td className="py-3 px-4 text-center">{renderValue(free)}</td>
      <td className="py-3 px-4 text-center">{renderValue(pro)}</td>
      <td className="py-3 px-4 text-center">{renderValue(elite)}</td>
    </tr>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="p-4 bg-fill/50 rounded-lg">
      <h3 className="font-medium text-ink mb-2">{question}</h3>
      <p className="text-subhead text-ink-2">{answer}</p>
    </div>
  );
}

// Export with Suspense wrapper for useSearchParams
export default function PricingPage() {
  useDocumentTitle('Pricing');
  return (
    <Suspense fallback={
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-large-title text-ink">Choose your plan</h1>
          <p className="text-ink-2 mt-2">Loading pricing...</p>
        </div>
      </div>
    }>
      <PricingContent />
    </Suspense>
  );
}

