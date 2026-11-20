'use client';

import Link from 'next/link';
import { useSubscription } from '@/hooks/useSubscription';
import { useIsNativePlatform } from '@/hooks/useIsNativePlatform';

export function SubscriptionBadge() {
  const { effectiveTier, needsUpgrade, isTrialing, trialDaysRemaining } = useSubscription();
  const isNative = useIsNativePlatform();

  return (
    <div className="flex items-center gap-2">
      {/* Trial/Subscription Badge */}
      {isTrialing && trialDaysRemaining > 0 && (
        isNative ? (
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-status-warn/10 border border-status-warn/20 text-status-warn text-sm font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {trialDaysRemaining}d left
          </div>
        ) : (
          <Link
            href="/dashboard/pricing"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-status-warn/10 border border-status-warn/20 text-status-warn text-sm font-medium hover:bg-status-warn/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {trialDaysRemaining}d left
          </Link>
        )
      )}

      {/* Upgrade button for free users — hidden in the native app (web-only billing) */}
      {needsUpgrade && !isTrialing && !isNative && (
        <Link
          href="/dashboard/pricing"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-action hover:bg-action text-on-action text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          Upgrade
        </Link>
      )}

      {/* Tier badge for paid users - clickable to manage subscription on web */}
      {!needsUpgrade && !isTrialing && effectiveTier !== 'free' && (
        isNative ? (
          <div
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
              effectiveTier === 'elite'
                ? 'bg-action/10 border border-action/20 text-action'
                : 'bg-action/10 border border-action/20 text-action'
            }`}
          >
            {effectiveTier === 'elite' ? 'Elite' : 'Pro'}
          </div>
        ) : (
          <Link
            href="/dashboard/pricing"
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              effectiveTier === 'elite'
                ? 'bg-action/10 border border-action/20 text-action hover:bg-action/20'
                : 'bg-action/10 border border-action/20 text-action hover:bg-action/20'
            }`}
          >
            {effectiveTier === 'elite' ? 'Elite' : 'Pro'}
          </Link>
        )
      )}
    </div>
  );
}
