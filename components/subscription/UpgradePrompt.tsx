'use client';

import Link from 'next/link';
import { Button, Card, CardContent } from '@/components/ui';
import { useSubscription } from '@/hooks/useSubscription';
import { Feature } from '@/lib/subscription';

interface UpgradePromptProps {
  feature: Feature;
  title?: string;
  description?: string;
  requiredTier?: 'pro' | 'elite';
  variant?: 'card' | 'inline' | 'modal';
}

const FEATURE_INFO: Record<Feature, { title: string; description: string; requiredTier: 'pro' | 'elite' }> = {
  mesocycleBuilder: {
    title: 'AI Mesocycle Builder',
    description: 'Create scientifically-optimized training programs with our AI-powered mesocycle builder.',
    requiredTier: 'pro',
  },
  coachingCalibration: {
    title: 'Coaching Calibration',
    description: 'Get personalized strength assessments and identify muscle imbalances with our coaching system.',
    requiredTier: 'elite',
  },
  advancedAnalytics: {
    title: 'Advanced Analytics',
    description: 'Track your progress with detailed charts, strength curves, and performance insights.',
    requiredTier: 'pro',
  },
  aiFeatures: {
    title: 'AI Features',
    description: 'Unlock smart weight suggestions, exercise recommendations, and personalized programming.',
    requiredTier: 'pro',
  },
  'ai-coaching': {
    title: 'AI Coach',
    description: 'Get personalized training advice from an AI coach that analyzes your actual workout data, body composition, and training phase.',
    requiredTier: 'elite',
  },
  unlimitedWorkouts: {
    title: 'Unlimited Workouts',
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
  
  // Don't show if user has access
  if (canAccess(feature)) return null;
  
  const info = FEATURE_INFO[feature];
  const displayTitle = title || info.title;
  const displayDescription = description || info.description;
  const displayTier = requiredTier || info.requiredTier;

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-4 p-4 bg-primary-500/10 border border-primary-500/20 rounded-lg">
        <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-surface-200">{displayTitle}</p>
          <p className="text-xs text-surface-400">Requires {displayTier === 'pro' ? 'Pro' : 'Elite'} plan</p>
        </div>
        <Link href="/dashboard/pricing">
          <Button size="sm" variant="primary">Upgrade</Button>
        </Link>
      </div>
    );
  }

  return (
    <Card className="border-primary-500/20 bg-gradient-to-br from-primary-500/5 to-accent-500/5">
      <CardContent className="p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        
        <h3 className="text-lg font-bold text-surface-100 mb-2">{displayTitle}</h3>
        <p className="text-sm text-surface-400 mb-4">{displayDescription}</p>
        
        {isTrialing && trialDaysRemaining > 0 ? (
          <div className="mb-4 p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
            <p className="text-sm text-warning-400">
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
        
        <p className="text-xs text-surface-500 mt-3">
          Starting at ${displayTier === 'pro' ? '9.99' : '19.99'}/month
        </p>
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
        </div>
      );
    }
    
    if (!canAccess(feature)) {
      return <UpgradePrompt feature={feature} requiredTier={requiredTier} />;
    }
    
    return <WrappedComponent {...props} />;
  };
}

