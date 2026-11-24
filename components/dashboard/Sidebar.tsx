'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import {
  IconHome,
  IconBarbell,
  IconSalad,
  IconChartLine,
  IconUsers,
  IconSparkles,
  IconSettings,
  IconFlask,
  IconHeartbeat,
  IconBolt,
  IconMenu2,
  IconLogout,
  IconScale,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { isActiveWorkoutRoute } from './isActiveWorkoutRoute';
import { useTrackingFocus } from '@/hooks/useTrackingFocus';
import { isTabActive, primaryTabsFor } from './foodOnlyNav';
import { ProTag } from '@/components/subscription/ProTag';
import type { Feature } from '@/lib/subscription';
import { SOCIAL_FEATURES_ENABLED } from '@/lib/socialFeatures';

interface SidebarNavItem {
  name: string;
  href: string;
  icon: TablerIcon;
  /** Additional paths that should highlight this item (mirrors the bottom nav). */
  matchPaths?: string[];
  /** Paths inside this section that another tab owns. */
  excludePaths?: string[];
  /** Paid feature the destination opens (labelled with ProTag). */
  feature?: Feature;
}

// Primary destinations — mirror the bottom nav
const primaryNavigation: SidebarNavItem[] = [
  { name: 'Home', href: '/dashboard', icon: IconHome },
  {
    name: 'Train',
    href: '/dashboard/train',
    icon: IconBarbell,
    // /dashboard/log redirects to /dashboard/train, so both paths highlight Train.
    matchPaths: ['/dashboard/log', '/dashboard/train', '/dashboard/exercises', '/dashboard/workout', '/dashboard/mesocycle', '/dashboard/history'],
  },
  { name: 'Eat', href: '/dashboard/nutrition', icon: IconSalad },
  { name: 'Progress', href: '/dashboard/analytics', icon: IconChartLine },
];

// Secondary links — the "More" section
const moreNavigation: SidebarNavItem[] = [
  { name: 'Blood pressure', href: '/dashboard/blood-pressure', icon: IconHeartbeat },
  ...(SOCIAL_FEATURES_ENABLED
    ? [{ name: 'Social feed', href: '/dashboard/feed', icon: IconUsers }]
    : []),
  { name: 'AI coach', href: '/dashboard/ai-coach', icon: IconSparkles, feature: 'ai-coaching' },
  { name: 'Settings', href: '/dashboard/settings', icon: IconSettings },
  { name: 'Science', href: '/dashboard/science', icon: IconFlask },
];

interface SidebarProps {
  onSignOut: () => void;
  /** True when every muscle group has reached MEV this week — lights up Train. */
  volumeGoalsMet?: boolean;
}

export function Sidebar({ onSignOut, volumeGoalsMet = false }: SidebarProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Food-only users get Weight where Train was (components/dashboard/foodOnlyNav).
  const { foodOnly } = useTrackingFocus();
  const primaryItems = primaryTabsFor(primaryNavigation, foodOnly, { icon: IconScale });

  const renderNavItem = (item: SidebarNavItem) => {
    // For Home (/dashboard), only match exactly to avoid highlighting when on subpages
    const isActive = isTabActive({ ...item, exact: item.href === '/dashboard' }, pathname ?? '');
    const Icon = item.icon;

    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-subhead font-medium transition-colors',
          isActive
            ? 'bg-action/10 text-action'
            : 'text-ink-2 hover:bg-fill hover:text-ink'
        )}
      >
        <Icon size={20} stroke={2} aria-hidden="true" />
        {item.name}
        {item.feature && <ProTag feature={item.feature} />}
        {item.name === 'Train' && volumeGoalsMet && (
          <span
            className="ml-auto w-2 h-2 rounded-full bg-status-ok"
            role="img"
            aria-label="All muscle groups at target weekly sets"
          />
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile menu button - hidden on workout pages (WorkoutHeader has its own back button).
          z-[35]: above the sticky app header (z-30), which is later in the
          DOM and used to cover it — a nameless button nobody could press. */}
      {!isActiveWorkoutRoute(pathname) && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          aria-expanded={sidebarOpen}
          className="fixed top-4 left-4 z-[35] p-2 lg:hidden text-ink-2 hover:text-ink bg-card/80 backdrop-blur-lg rounded-lg"
        >
          <IconMenu2 size={24} stroke={2} aria-hidden="true" />
        </button>
      )}

      {/* Sidebar. Closed on a phone it is slid off screen AND invisible:
          translated alone, its links stayed in the accessibility tree and in
          the tab order — the UX panel's first tap on "Train" / "Progress" on
          Home landed on these off-screen copies and did nothing (round 21:
          "My first tap toward Train failed"). Visibility switches after the
          slide (transition on visibility), so closing still animates. */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-card border-r border-sep transform transition-[transform,visibility] duration-200 lg:translate-x-0 lg:visible',
          sidebarOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'
        )}
        data-testid="app-sidebar"
      >
        {/* Logo */}
        <div className="flex items-center h-16 border-b border-sep px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            onClick={() => setSidebarOpen(false)}
          >
            <div className="w-9 h-9 rounded-lg bg-action flex items-center justify-center">
              <IconBolt size={20} stroke={2} className="text-white" aria-hidden="true" />
            </div>
            <span className="text-headline font-bold text-ink">HyperTrack</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {primaryItems.map(renderNavItem)}

          {/* More section */}
          <p className="px-3 pt-4 pb-1 text-caption font-medium text-ink-3">
            More
          </p>
          {moreNavigation.map(renderNavItem)}
        </nav>

        {/* Bottom section */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-sep">
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-subhead font-medium text-ink-2 hover:bg-fill hover:text-ink transition-colors"
          >
            <IconLogout size={20} stroke={2} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
