'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@/components/ui';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsNativePlatform } from '@/hooks/useIsNativePlatform';
import { TIER_FEATURES } from '@/lib/stripe';

export function SubscriptionCard() {
  const { 
    tier, 
    status, 
    effectiveTier, 
    isTrialing, 
    trialDaysRemaining, 
    trialEndsAt,
    currentPeriodEnd, 
    cancelAtPeriodEnd,
    openPortal,
    isLoading
  } = useSubscription();
  const isNative = useIsNativePlatform();

  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  
  const handleManageSubscription = async () => {
    setIsOpeningPortal(true);
    try {
      const url = await openPortal();
      if (url) {
        window.location.href = url;
      }
    } finally {
      setIsOpeningPortal(false);
    }
  };
  
  const tierInfo = TIER_FEATURES[effectiveTier];
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-surface-700 rounded w-1/3" />
            <div className="h-4 bg-surface-700 rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Subscription</CardTitle>
          <Badge 
            variant={
              status === 'active' ? 'success' : 
              isTrialing ? 'warning' : 
              status === 'past_due' ? 'danger' : 
              'default'
            }
          >
            {isTrialing ? 'Trial' : status === 'active' ? 'Active' : status === 'past_due' ? 'Past Due' : 'Free'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Plan */}
        <div className="p-4 bg-surface-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-surface-400">Current Plan</span>
            <span className={`text-lg font-bold ${
              effectiveTier === 'elite' ? 'text-accent-400' :
              effectiveTier === 'pro' ? 'text-primary-400' :
              'text-surface-300'
            }`}>
              {tierInfo.name}
            </span>
          </div>
          <p className="text-xs text-surface-500">{tierInfo.description}</p>
        </div>
        
        {/* Trial Info */}
        {isTrialing && trialEndsAt && (
          <div className="p-4 bg-warning-500/10 border border-warning-500/20 rounded-lg">
            <div className="flex items-center gap-2 text-warning-400 mb-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">Trial ends in {trialDaysRemaining} days</span>
            </div>
            <p className="text-xs text-surface-400">
              {trialEndsAt.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
        )}
        
        {/* Billing Period */}
        {status === 'active' && currentPeriodEnd && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-surface-400">
              {cancelAtPeriodEnd ? 'Access until' : 'Next billing date'}
            </span>
            <span className="text-surface-200">
              {currentPeriodEnd.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              })}
            </span>
          </div>
        )}
        
        {cancelAtPeriodEnd && (
          <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg">
            <p className="text-sm text-danger-400">
              Your subscription will be canceled at the end of this billing period.
            </p>
          </div>
        )}
        
        {/* Actions — billing is web-only, so hide all purchase/management
            actions inside the native app (App Store Guideline 3.1.1). */}
        {isNative ? (
          <p className="text-xs text-surface-500">
            Your subscription is managed on the web.
          </p>
        ) : (
          <div className="flex gap-3">
            {tier === 'free' && !isTrialing ? (
              <Link href="/dashboard/pricing" className="flex-1">
                <Button className="w-full" variant="primary">
                  Upgrade Now
                </Button>
              </Link>
            ) : status === 'active' || isTrialing ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleManageSubscription}
                  isLoading={isOpeningPortal}
                  className="flex-1"
                >
                  Manage Subscription
                </Button>
                <Link href="/dashboard/pricing">
                  <Button variant="secondary">
                    Change Plan
                  </Button>
                </Link>
              </>
            ) : (
              <Link href="/dashboard/pricing" className="flex-1">
                <Button className="w-full" variant="primary">
                  Reactivate
                </Button>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
