'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@/components/ui';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsNativePlatform } from '@/hooks/useIsNativePlatform';
import { Feature } from '@/lib/subscription';
import { TIER_FEATURES } from '@/lib/stripe';
import { isApplePurchasesAvailable } from '@/lib/integrations/applePurchases';

interface UpgradePromptProps {
  feature: Feature;
  title?: string;
  description?: string;
  requiredTier?: 'pro' | 'elite';
  variant?: 'card' | 'inline' | 'modal';
}

const FEATURE_INFO: Record<Feature, { title: string; description: string; requiredTier: 'pro' | 'elite' }> = {
  mesocycleBuilder: {
    title: 'AI training block builder',
    description: 'Create scientifically-optimized training programs with our AI-powered training block builder.',
    requiredTier: 'pro',
  },
  coachingCalibration: {
    title: 'Coaching calibration',
    description: 'Get personalized strength assessments and identify muscle imbalances with our coaching system.',
    requiredTier: 'elite',
  },
  advancedAnalytics: {
    title: 'Advanced analytics',
    description: 'Track your progress with detailed charts, strength curves, and performance insights.',
    requiredTier: 'pro',
  },
  aiFeatures: {
    title: 'AI features',
    description: 'AI meal logging, nutrition label scans, body fat estimates from photos, and AI plan reviews.',
    requiredTier: 'pro',
  },
  'ai-coaching': {
    title: 'AI coach',
    description: 'Get personalized training advice from an AI coach that analyzes your actual workout data, body composition, and training phase.',
    requiredTier: 'elite',
  },
  unlimitedWorkouts: {
    title: 'Unlimited workouts',
    description: 'Log unlimited workouts without restrictions.',
    requiredTier: 'pro',
  },
};

export function UpgradePrompt({
  feature,
  title,
  description,
  requiredTier,
  variant = 'card',
}: UpgradePromptProps) {
  const { isTrialing, trialDaysRemaining, canAccess } = useSubscription();
  const isNative = useIsNativePlatform();
  // iOS builds with the App Store purchases plugin sell in the app (the
  // pricing page shows App Store plans), so they get the normal prompt.
  const [applePurchases, setApplePurchases] = useState(false);
  useEffect(() => setApplePurchases(isApplePurchasesAvailable()), [isNative]);

  // Don't show if user has access
  if (canAccess(feature)) return null;

  const info = FEATURE_INFO[feature];
  const displayTitle = title || info.title;
  const displayDescription = description || info.description;
  const displayTier = requiredTier || info.requiredTier;
  const tierName = displayTier === 'pro' ? 'Pro' : 'Elite';

  // Native (iOS/Android) build: App Store rules forbid selling or linking to
  // web purchases for digital features (Guideline 3.1.1 / 3.1.3). Show a
  // neutral "locked" state with no price, no buy button, and no link out.
  if (isNative && !applePurchases) {
    if (variant === 'inline') {
      return (
        <div className="flex items-center gap-4 p-4 bg-fill/50 border border-sep rounded-lg">
          <div className="w-10 h-10 rounded-full bg-sep flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-subhead font-medium text-ink">{displayTitle}</p>
            <p className="text-caption text-ink-2">Included with the {tierName} plan</p>
          </div>
        </div>
      );
    }

    return (
      <Card className="border-sep bg-fill/30">
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-sep flex items-center justify-center">
            <svg className="w-8 h-8 text-ink-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 className="text-headline font-bold text-ink mb-2">{displayTitle}</h3>
          <p className="text-subhead text-ink-2 mb-4">{displayDescription}</p>
          <p className="text-subhead text-ink-2">
            This feature is included with the <strong>{tierName}</strong> plan.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-4 p-4 bg-action/10 border border-action/20 rounded-lg">
        <div className="w-10 h-10 rounded-full bg-action/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-subhead font-medium text-ink">{displayTitle}</p>
          <p className="text-caption text-ink-2">Requires {displayTier === 'pro' ? 'Pro' : 'Elite'} plan</p>
        </div>
        <Link href="/dashboard/pricing">
          <Button size="sm" variant="primary">Upgrade</Button>
        </Link>
      </div>
    );
  }

  return (
    <Card className="border-action/20 bg-action/5 ">
      <CardContent className="p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-action/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-action" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        
        <h3 className="text-headline font-bold text-ink mb-2">{displayTitle}</h3>
        <p className="text-subhead text-ink-2 mb-4">{displayDescription}</p>
        
        {isTrialing && trialDaysRemaining > 0 ? (
          <div className="mb-4 p-3 bg-status-warn/10 border border-status-warn/20 rounded-lg">
            <p className="text-subhead text-status-warn">
              You have <strong>{trialDaysRemaining} days</strong> left in your trial to try this feature!
            </p>
          </div>
        ) : null}

        <Link href="/dashboard/pricing">
          <Button variant="primary" className="w-full">
            Upgrade to {displayTier === 'pro' ? 'Pro' : 'Elite'}
            <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Button>
        </Link>
        
        {/* In the iOS app the App Store sets the (localized) price; the
            pricing page shows it. */}
        {!isNative && (
          <p className="text-caption text-ink-3 mt-3">
            Starting at ${(displayTier === 'pro' ? TIER_FEATURES.pro : TIER_FEATURES.elite).monthlyPrice}/month
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// HOC to wrap components that require subscription
export function withSubscriptionGate<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  feature: Feature,
  requiredTier: 'pro' | 'elite' = 'pro'
) {
  return function GatedComponent(props: P) {
    const { canAccess, isLoading } = useSubscription();
    
    if (isLoading) {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-action" />
        </div>
      );
    }
    
    if (!canAccess(feature)) {
      return <UpgradePrompt feature={feature} requiredTier={requiredTier} />;
    }
    
    return <WrappedComponent {...props} />;
  };
}

