'use client';

import Link from 'next/link';
import { useSubscription } from '@/hooks/useSubscription';

export function SubscriptionBadge() {
  const { effectiveTier, needsUpgrade, isTrialing, trialDaysRemaining } = useSubscription();

  return (
    <div className="flex items-center gap-2">
      {/* Trial/Subscription Badge */}
      {isTrialing && trialDaysRemaining > 0 && (
        <Link
          href="/dashboard/pricing"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning-500/10 border border-warning-500/20 text-warning-400 text-sm font-medium hover:bg-warning-500/20 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {trialDaysRemaining}d left
        </Link>
      )}

      {/* Upgrade button for free users */}
      {needsUpgrade && !isTrialing && (
        <Link
          href="/dashboard/pricing"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          Upgrade
        </Link>
      )}

      {/* Tier badge for paid users - clickable to manage subscription */}
      {!needsUpgrade && !isTrialing && effectiveTier !== 'free' && (
        <Link
          href="/dashboard/pricing"
          className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            effectiveTier === 'elite'
              ? 'bg-accent-500/10 border border-accent-500/20 text-accent-400 hover:bg-accent-500/20'
              : 'bg-primary-500/10 border border-primary-500/20 text-primary-400 hover:bg-primary-500/20'
          }`}
        >
          {effectiveTier === 'elite' ? 'Elite' : 'Pro'}
        </Link>
      )}
    </div>
  );
}
