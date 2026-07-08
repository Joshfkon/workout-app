'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { Sidebar } from './Sidebar';
import { BottomNavigation } from './BottomNavigation';
import { SubscriptionBadge } from './SubscriptionBadge';
import { SignOutButton } from './SignOutButton';
import { ResumeWorkoutBanner } from '@/components/workout';
import { flushSetOutbox } from '@/lib/offline/setOutbox';
import { useWeeklyVolume } from '@/hooks/useWeeklyVolume';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
}

export function DashboardLayoutClient({ children }: DashboardLayoutClientProps) {
  const router = useRouter();

  // Weekly volume coverage for the Train tab indicator: lit when every
  // muscle group has hit at least MEV this week. Fetched once here so the
  // sidebar and bottom nav share a single query.
  const { summary, isLoading: volumeLoading } = useWeeklyVolume();
  const volumeGoalsMet =
    !volumeLoading && summary.totalSets > 0 && summary.musclesBelowMev.length === 0;

  // Offline outbox (P0-2): flush queued set writes whenever connectivity
  // returns, from ANY dashboard tab — not just the workout page.
  useEffect(() => {
    const flush = () => { void flushSetOutbox(createUntypedClient()); };
    window.addEventListener('online', flush);
    if (navigator.onLine) flush();
    return () => window.removeEventListener('online', flush);
  }, []);

  const handleSignOut = async () => {
    const supabase = createUntypedClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-surface-950 overflow-x-hidden">
      <Sidebar onSignOut={handleSignOut} volumeGoalsMet={volumeGoalsMet} />

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-surface-950/80 backdrop-blur-lg border-b border-surface-800 lg:px-6">
          {/* Spacer for mobile menu button */}
          <div className="w-10 lg:hidden" />

          {/* Logo - links to dashboard. Hidden on lg+ where the sidebar
              already carries the brand (P2-9: duplicated logo on desktop). */}
          <Link
            href="/dashboard"
            className="flex lg:hidden items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-base font-bold text-surface-100 hidden sm:block">HyperTrack</span>
          </Link>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Header actions */}
          <div className="flex items-center gap-3">
            <SubscriptionBadge />
            <Link
              href="/dashboard/science"
              className="text-xs text-surface-500 hover:text-surface-300 transition-colors"
            >
              About
            </Link>
            <SignOutButton showOnMobile />
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-6 overflow-x-hidden">{children}</main>
      </div>

      {/* Bottom navigation for mobile */}
      <BottomNavigation volumeGoalsMet={volumeGoalsMet} />

      {/* Resume workout banner - shows when there's an active workout */}
      <ResumeWorkoutBanner />
    </div>
  );
}
