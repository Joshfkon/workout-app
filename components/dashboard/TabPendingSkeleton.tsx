'use client';

import { ProgressPageSkeleton } from '@/components/analytics/RegionSkeletons';

/** Page titles for the tab bar's destinations (what each page's own header says). */
const TAB_TITLES: Record<string, string> = {
  '/dashboard': 'Home',
  '/dashboard/train': 'Train',
  '/dashboard/nutrition': 'Eat',
  '/dashboard/analytics': 'Progress',
  '/dashboard/more': 'More',
  '/dashboard/nutrition/trends': 'Weight',
};

export function tabPendingTitle(href: string): string {
  return TAB_TITLES[href] ?? 'Loading';
}

/**
 * What the content area shows from the moment a tab is tapped until that
 * tab's page arrives. The App Router keeps the OLD page on screen until the
 * new route's loading boundary is ready, which on a cold route (dev, or a
 * first visit before prefetch) is a second or more: the UX panel saw Home
 * sitting under a lit Progress tab and called the page "blank or loading
 * with no clear indicator" (round 22, Maya). The destination's frame and a
 * labelled skeleton show at once instead. Progress gets its own skeleton
 * (the same one its route loading.tsx renders), so nothing jumps when the
 * page takes over.
 */
export function TabPendingSkeleton({ href }: { href: string }) {
  if (href === '/dashboard/analytics') {
    return (
      <div data-testid="tab-pending-skeleton">
        <ProgressPageSkeleton />
      </div>
    );
  }
  const title = tabPendingTitle(href);
  return (
    <div className="space-y-6" data-testid="tab-pending-skeleton">
      <h1 className="text-large-title text-ink">{title}</h1>
      <div className="space-y-4" role="status" aria-busy="true">
        <p className="flex items-center gap-2 px-1 text-subhead text-ink-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
            aria-hidden="true"
          />
          {`Loading ${title === 'Loading' ? 'the page' : title}…`}
        </p>
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-24 rounded-card bg-card shadow-card" />
          <div className="h-40 rounded-card bg-card shadow-card" />
        </div>
      </div>
    </div>
  );
}
