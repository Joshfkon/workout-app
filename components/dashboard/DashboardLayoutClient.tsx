'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { Sidebar } from './Sidebar';
import { BottomNavigation } from './BottomNavigation';
import { SubscriptionBadge } from './SubscriptionBadge';
import { SignOutButton } from './SignOutButton';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
}

export function DashboardLayoutClient({ children }: DashboardLayoutClientProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createUntypedClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-surface-950 overflow-x-hidden">
      <Sidebar onSignOut={handleSignOut} />

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-surface-950/80 backdrop-blur-lg border-b border-surface-800 lg:px-6">
          {/* Spacer for mobile menu button */}
          <div className="w-10 lg:hidden" />

          {/* Logo - links to dashboard */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-base font-bold text-white hidden sm:block">HyperTrack</span>
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
        <main className="p-4 pb-20 lg:p-6 lg:pb-6 overflow-x-hidden">{children}</main>
      </div>

      {/* Bottom navigation for mobile */}
      <BottomNavigation />
    </div>
  );
}
