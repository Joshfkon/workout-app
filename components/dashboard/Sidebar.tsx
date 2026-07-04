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
  IconBolt,
  IconMenu2,
  IconLogout,
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';

interface SidebarNavItem {
  name: string;
  href: string;
  icon: TablerIcon;
  /** Additional paths that should highlight this item (mirrors the bottom nav). */
  matchPaths?: string[];
}

// Primary destinations — mirror the bottom nav
const primaryNavigation: SidebarNavItem[] = [
  { name: 'Home', href: '/dashboard', icon: IconHome },
  {
    name: 'Train',
    href: '/dashboard/train',
    icon: IconBarbell,
    matchPaths: ['/dashboard/train', '/dashboard/exercises', '/dashboard/log', '/dashboard/workout', '/dashboard/mesocycle', '/dashboard/history'],
  },
  { name: 'Eat', href: '/dashboard/nutrition', icon: IconSalad },
  { name: 'Progress', href: '/dashboard/analytics', icon: IconChartLine },
];

// Secondary links — the "More" section
const moreNavigation: SidebarNavItem[] = [
  { name: 'Social Feed', href: '/dashboard/feed', icon: IconUsers },
  { name: 'AI Coach', href: '/dashboard/ai-coach', icon: IconSparkles },
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

  const renderNavItem = (item: SidebarNavItem) => {
    // For Home (/dashboard), only match exactly to avoid highlighting when on subpages
    const isActive = item.href === '/dashboard'
      ? pathname === '/dashboard'
      : (item.matchPaths || [item.href]).some(
          (path) => pathname === path || pathname.startsWith(path + '/')
        );
    const Icon = item.icon;

    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary-500/10 text-primary-400'
            : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
        )}
      >
        <Icon size={20} stroke={2} aria-hidden="true" />
        {item.name}
        {item.name === 'Train' && volumeGoalsMet && (
          <span
            className="ml-auto w-2 h-2 rounded-full bg-green-400"
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

      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-4 left-4 z-30 p-2 lg:hidden text-surface-400 hover:text-surface-200 bg-surface-900/80 backdrop-blur-lg rounded-lg"
      >
        <IconMenu2 size={24} stroke={2} aria-hidden="true" />
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-surface-900 border-r border-surface-800 transform transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center h-16 border-b border-surface-800 px-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            onClick={() => setSidebarOpen(false)}
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <IconBolt size={20} stroke={2} className="text-white" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold text-surface-100">HyperTrack</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {primaryNavigation.map(renderNavItem)}

          {/* More section */}
          <p className="px-3 pt-4 pb-1 text-[11px] font-medium uppercase tracking-wider text-surface-500">
            More
          </p>
          {moreNavigation.map(renderNavItem)}
        </nav>

        {/* Bottom section */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-surface-800">
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
          >
            <IconLogout size={20} stroke={2} aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
