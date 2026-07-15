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
import { useKeyboardOpen } from '@/hooks/useKeyboardOpen';

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
    href: '/dashboard/train',
    icon: IconBarbell,
    // NB: /dashboard/log (the startup launcher) deliberately does NOT
    // highlight Train — it is a standalone surface, not the Train page.
    matchPaths: ['/dashboard/train', '/dashboard/exercises', '/dashboard/workout', '/dashboard/mesocycle', '/dashboard/history'],
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
      '/dashboard/blood-pressure',
      '/dashboard/feed',
      '/dashboard/discover',
      '/dashboard/profile',
      '/dashboard/ai-coach',
      '/dashboard/templates',
      '/dashboard/learn',
      '/dashboard/glossary',
      '/dashboard/science',
      '/dashboard/settings',
      '/dashboard/leaderboards',
      '/dashboard/pricing',
    ],
  },
];

interface BottomNavigationProps {
  /** True when every muscle group has reached MEV this week — lights up Train. */
  volumeGoalsMet?: boolean;
}

export function BottomNavigation({ volumeGoalsMet = false }: BottomNavigationProps) {
  const pathname = usePathname();
  const keyboardOpen = useKeyboardOpen();

  // Hide bottom nav only while on the active workout page itself.
  // An in-progress session alone must not hide the nav — the user can
  // navigate away (e.g. back to Home) and still needs the tab bar.
  const isInActiveWorkoutPage = pathname?.match(/^\/dashboard\/workout\/[^/]+$/);

  // While the on-screen keyboard is up, iOS unpins fixed-bottom elements
  // from the screen edge and lets them float mid-page over content — so the
  // tab bar hides until the keyboard is dismissed. The unmount/remount also
  // forces WebKit to re-anchor it at the true bottom afterwards.
  if (isInActiveWorkoutPage || keyboardOpen) {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface-900 border-t border-surface-800 pb-safe-bottom lg:hidden">
      <div className="flex items-center h-16">
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
              <span className="relative">
                <Icon size={20} stroke={2} aria-hidden="true" />
                {item.name === 'Train' && volumeGoalsMet && (
                  <span
                    className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-green-400 ring-2 ring-surface-900"
                    role="img"
                    aria-label="All muscle groups at target weekly sets"
                  />
                )}
              </span>
              <span className="text-[10px] font-medium leading-none">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
