'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconHome,
  IconBarbell,
  IconSalad,
  IconChartLine,
  IconDots,
  IconScale,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useKeyboardOpen } from '@/hooks/useKeyboardOpen';
import { useTrackingFocus } from '@/hooks/useTrackingFocus';
import { isTabActive, primaryTabsFor } from './foodOnlyNav';

interface NavItem {
  name: string;
  href: string;
  icon: TablerIcon;
  /** Match exactly (used for Home so subpages don't highlight it) */
  exact?: boolean;
  matchPaths?: string[];
  /** Paths inside this section that another tab owns. */
  excludePaths?: string[];
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
    // /dashboard/log redirects to /dashboard/train, so both paths highlight Train.
    matchPaths: ['/dashboard/log', '/dashboard/train', '/dashboard/exercises', '/dashboard/workout', '/dashboard/mesocycle', '/dashboard/history'],
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
    matchPaths: ['/dashboard/analytics', '/dashboard/volume', '/dashboard/body-composition', '/dashboard/progress-photos'],
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

/** Is `pathname` inside `item`'s section? */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return isTabActive(item, pathname);
}

/** Light haptic tick on tap (native only); loaded lazily to keep the nav light. */
function tapHaptic(): void {
  import('@/lib/integrations/notifications')
    .then(({ lightHaptic }) => lightHaptic())
    .catch(() => {});
}

interface BottomNavigationProps {
  /** True when every muscle group has reached MEV this week — lights up Train. */
  volumeGoalsMet?: boolean;
  /**
   * The tab waiting for its page (null once it arrives), so the shell can
   * show that page's skeleton instead of the old page (TabPendingSkeleton).
   */
  onPendingChange?: (href: string | null) => void;
}

export function BottomNavigation({ volumeGoalsMet = false, onPendingChange }: BottomNavigationProps) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const keyboardOpen = useKeyboardOpen();
  // Food-only users get Weight where Train was (components/dashboard/foodOnlyNav).
  const { foodOnly } = useTrackingFocus();
  const items = primaryTabsFor(navItems, foodOnly, { icon: IconScale });
  // The tab the user just tapped, until its page arrives. Some tabs (Home)
  // render on the server first, so without this the old tab stays lit for a
  // second and the tap looks ignored.
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    onPendingChange?.(pendingHref);
  }, [pendingHref, onPendingChange]);

  // Never leave a tab stuck "pending" if a navigation fails or is cancelled.
  useEffect(() => {
    if (!pendingHref) return;
    const timer = window.setTimeout(() => setPendingHref(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

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
    <>
    {pendingHref && (
      <div
        className="fixed left-0 right-0 z-50 h-0.5 overflow-hidden lg:hidden"
        style={{ top: 'env(safe-area-inset-top)' }}
        role="progressbar"
        aria-label="Loading page"
        data-testid="tab-nav-progress"
      >
        <div className="h-0.5 w-1/3 bg-action animate-nav-progress" />
      </div>
    )}
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-sep pb-safe-bottom lg:hidden">
      <div className="flex items-center h-16">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = pendingHref
            ? pendingHref === item.href
            : isNavItemActive(item, pathname);

          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              onPointerDown={() => {
                // Start loading the route before the click lands (as
                // PendingLink does). An optimisation only.
                try {
                  router.prefetch(item.href);
                } catch {
                  /* ignore */
                }
              }}
              onClick={() => {
                tapHaptic();
                if (pathname !== item.href) setPendingHref(item.href);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors',
                isActive ? 'text-action' : 'text-ink-3 hover:text-ink-2'
              )}
            >
              <span className="relative">
                <Icon size={20} stroke={2} aria-hidden="true" />
                {item.name === 'Train' && volumeGoalsMet && (
                  <span
                    className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-status-ok ring-2 ring-card"
                    role="img"
                    aria-label="All muscle groups at target weekly sets"
                  />
                )}
              </span>
              <span className="text-caption font-medium leading-none">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
