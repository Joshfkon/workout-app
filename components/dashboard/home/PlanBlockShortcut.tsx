'use client';

/**
 * "Plan a training block" on Home, for lifters with no active block. The
 * builder was only reachable from Train (or the no-plan hero), and the UX
 * panel's advanced lifters looked for it on Home first (round 21, Dre: "The
 * mesocycle builder isn't obvious from the dashboard"). One quiet row, same
 * wording and pending state as Train's entry.
 */

import { IconCalendarStats, IconChevronRight, IconLoader2 } from '@tabler/icons-react';
import { PendingLink } from '@/components/dashboard/PendingLink';
import { ProTag } from '@/components/subscription/ProTag';

export function PlanBlockShortcut() {
  return (
    <PendingLink
      href="/dashboard/mesocycle/new"
      className="flex min-h-[56px] items-center gap-3 rounded-card bg-card px-4 py-3 shadow-card transition-[background-color,transform] hover:bg-fill/70 active:scale-[0.99] active:bg-fill"
      pendingClassName="bg-fill"
      data-testid="home-plan-block"
    >
      {(pending) => (
        <>
          <IconCalendarStats size={20} className="flex-shrink-0 text-action" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-body font-semibold text-ink">
              Plan a training block
              <ProTag feature="mesocycleBuilder" />
            </span>
            <span className="block text-subhead text-ink-2">
              A few weeks of workouts that add a little each week, then an easier week.
            </span>
          </span>
          {pending ? (
            <IconLoader2 size={18} className="flex-shrink-0 animate-spin text-action" aria-hidden="true" />
          ) : (
            <IconChevronRight size={18} className="flex-shrink-0 text-ink-3" aria-hidden="true" />
          )}
        </>
      )}
    </PendingLink>
  );
}
