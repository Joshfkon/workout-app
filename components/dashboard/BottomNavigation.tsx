'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useWorkoutStore } from '@/stores/workoutStore';

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  matchPaths?: string[];
  exactMatch?: boolean;
}

const navigation: NavItem[] = [
  {
    name: 'Home',
    href: '/dashboard',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    matchPaths: ['/dashboard'],
    exactMatch: true,
  },
  {
    name: 'Workout',
    href: '/dashboard/workout',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    name: 'Nutrition',
    href: '/dashboard/nutrition',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    name: 'Analytics',
    href: '/dashboard/analytics',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    name: 'More',
    href: '/dashboard/settings',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
      </svg>
    ),
    // More links to settings but also highlights for Social, AI Coach, Discover, etc.
    matchPaths: ['/dashboard/settings', '/dashboard/feed', '/dashboard/ai-coach', '/dashboard/discover', '/dashboard/profile', '/dashboard/science'],
  },
];

export function BottomNavigation() {
  const pathname = usePathname();
  const activeSession = useWorkoutStore((state) => state.activeSession);

  // Hide bottom nav during active workout
  // Check both store state AND pathname to handle hydration race conditions
  const isInActiveWorkoutPage = pathname?.match(/^\/dashboard\/workout\/[^/]+$/);

  if (activeSession || isInActiveWorkoutPage) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface-900 border-t border-surface-800 lg:hidden">
      <div className="flex items-center justify-around h-16 px-2 safe-area-bottom">
        {navigation.map((item) => {
          const matchPaths = item.matchPaths || [item.href];
          const isActive = item.exactMatch
            ? matchPaths.some((path) => pathname === path)
            : matchPaths.some(
                (path) => pathname === path || pathname.startsWith(path + '/')
              );

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full py-1 transition-colors',
                isActive
                  ? 'text-primary-400'
                  : 'text-surface-400 hover:text-surface-200'
              )}
            >
              {item.icon}
              <span className="text-xs mt-1 font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
