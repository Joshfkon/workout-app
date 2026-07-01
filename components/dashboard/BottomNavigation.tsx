'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconHome,
  IconBarbell,
  IconSalad,
  IconChartLine,
  IconDots,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useWorkoutStore } from '@/stores/workoutStore';

interface NavItem {
  name: string;
  href: string;
  icon: TablerIcon;
  /** Match exactly (used for Home so subpages don't highlight it) */
  exact?: boolean;
  matchPaths?: string[];
}

const navItems: NavItem[] = [
  {
    name: 'Home',
    href: '/dashboard',
    icon: IconHome,
    exact: true,
  },
  {
    name: 'Train',
    href: '/dashboard/workout',
    icon: IconBarbell,
    matchPaths: ['/dashboard/workout', '/dashboard/mesocycle', '/dashboard/history'],
  },
  {
    name: 'Eat',
    href: '/dashboard/nutrition',
    icon: IconSalad,
  },
  {
    name: 'Progress',
    href: '/dashboard/analytics',
    icon: IconChartLine,
    matchPaths: ['/dashboard/analytics', '/dashboard/volume', '/dashboard/body-composition'],
  },
  {
    name: 'More',
    href: '/dashboard/more',
    icon: IconDots,
    matchPaths: [
      '/dashboard/more',
      '/dashboard/feed',
      '/dashboard/discover',
      '/dashboard/profile',
      '/dashboard/ai-coach',
      '/dashboard/templates',
      '/dashboard/learn',
      '/dashboard/glossary',
      '/dashboard/science',
      '/dashboard/settings',
    ],
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
      <div className="flex items-center h-16 safe-area-bottom">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === item.href
            : (item.matchPaths || [item.href]).some(
                (path) => pathname === path || pathname.startsWith(path + '/')
              );

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors',
                isActive ? 'text-primary-400' : 'text-surface-500 hover:text-surface-300'
              )}
            >
              <Icon size={20} stroke={2} aria-hidden="true" />
              <span className="text-[10px] font-medium leading-none">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
