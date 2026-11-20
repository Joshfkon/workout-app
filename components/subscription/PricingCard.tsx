'use client';

import { Button, Card, CardContent, Badge } from '@/components/ui';
import { TIER_FEATURES, SubscriptionTier } from '@/lib/stripe';

interface PricingCardProps {
  tier: SubscriptionTier;
  billingPeriod: 'monthly' | 'yearly';
  isCurrentPlan?: boolean;
  isPopular?: boolean;
  onSelect: (tier: SubscriptionTier, billingPeriod: 'monthly' | 'yearly') => void;
  isLoading?: boolean;
}

export function PricingCard({
  tier,
  billingPeriod,
  isCurrentPlan = false,
  isPopular = false,
  onSelect,
  isLoading = false,
}: PricingCardProps) {
  const tierData = TIER_FEATURES[tier];
  
  const getPrice = () => {
    if (tier === 'free') return { amount: 0, period: '' };
    
    const data = tierData as typeof TIER_FEATURES.pro;
    if (billingPeriod === 'yearly') {
      const yearlyPrice = data.yearlyPrice;
      const monthlyEquivalent = (yearlyPrice / 12).toFixed(2);
      return { 
        amount: monthlyEquivalent, 
        period: '/mo',
        yearly: yearlyPrice,
        savings: Math.round(((data.monthlyPrice * 12) - yearlyPrice) / (data.monthlyPrice * 12) * 100)
      };
    }
    return { amount: data.monthlyPrice, period: '/mo' };
  };

  const price = getPrice();

  return (
    <Card 
      className={`relative overflow-hidden transition-all ${
        isPopular 
          ? 'border-2 border-action shadow-lg shadow-action/20' 
          : isCurrentPlan 
          ? 'border-2 border-status-ok'
          : 'border border-sep hover:border-sep'
      }`}
    >
      {isPopular && (
        <div className="absolute top-0 right-0 bg-action text-on-action text-xs font-bold px-3 py-1 rounded-bl-lg">
          MOST POPULAR
        </div>
      )}
      
      {isCurrentPlan && (
        <div className="absolute top-0 right-0 bg-status-ok text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
          CURRENT PLAN
        </div>
      )}

      <CardContent className="p-6">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-ink">{tierData.name}</h3>
          <p className="text-sm text-ink-2 mt-1">{tierData.description}</p>
        </div>

        <div className="mb-6">
          {tier === 'free' ? (
            <div className="text-3xl font-bold text-ink">Free</div>
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-ink">${price.amount}</span>
                <span className="text-ink-2">{price.period}</span>
              </div>
              {billingPeriod === 'yearly' && 'savings' in price && (
                <div className="mt-1">
                  <Badge variant="success" size="sm">
                    Save {price.savings}% with yearly
                  </Badge>
                  <p className="text-xs text-ink-3 mt-1">
                    ${price.yearly}/year billed annually
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <ul className="space-y-3 mb-6">
          {tierData.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <svg 
                className="w-5 h-5 text-status-ok flex-shrink-0 mt-0.5" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-ink-2">{feature}</span>
            </li>
          ))}
        </ul>

        <Button
          className="w-full"
          variant={isCurrentPlan ? 'outline' : isPopular ? 'primary' : 'secondary'}
          onClick={() => onSelect(tier, billingPeriod)}
          disabled={isCurrentPlan || isLoading || tier === 'free'}
          isLoading={isLoading}
        >
          {isCurrentPlan 
            ? 'Current Plan' 
            : tier === 'free' 
            ? 'Free Forever'
            : `Upgrade to ${tierData.name}`
          }
        </Button>
        
        {/* Billing disclosure for paid tiers */}
        {tier !== 'free' && !isCurrentPlan && (
          <p className="text-xs text-ink-3 text-center mt-3 leading-relaxed">
            ${billingPeriod === 'yearly' ? price.amount : (tierData as typeof TIER_FEATURES.pro).monthlyPrice}{price.period}. Cancel anytime.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

