'use client';

import Link from 'next/link';
import { IconChartBar, IconChevronRight } from '@tabler/icons-react';

interface VolumeRampBannerProps {
  /** Muscles currently below MEV this week. */
  lowCount: number;
  /** Current mesocycle week (1-based). */
  week: number;
}

/**
 * Early-week volume ramp insight: muscles below MEV in wk 1-2 are expected
 * (volume ramps as the week fills in), so frame it as "on track if resolved"
 * rather than an alarm. Later weeks use the full AtrophyRiskAlert instead.
 */
export function VolumeRampBanner({ lowCount, week }: VolumeRampBannerProps) {
  const muscles = `${lowCount} muscle${lowCount === 1 ? '' : 's'}`;
  return (
    <Link
      href="/dashboard/volume"
      className="flex items-center gap-3 rounded-card bg-card shadow-card p-4 active:bg-fill transition-colors"
    >
      <span className="w-9 h-9 rounded-lg bg-status-warn/15 text-status-warn flex items-center justify-center flex-shrink-0">
        <IconChartBar size={18} aria-hidden="true" />
      </span>
      <p className="flex-1 text-subhead text-ink leading-snug">
        {week <= 1 ? (
          <>
            <span className="font-semibold text-ink">Wk 1 ramp:</span> {muscles} under the weekly minimum —
            expected this early, on track if resolved by wk 2
          </>
        ) : (
          <>
            <span className="font-semibold text-ink">Wk {week}:</span> {muscles} still under the weekly minimum —
            add sets where you&apos;re short to stay on track
          </>
        )}
      </p>
      <IconChevronRight size={18} className="text-ink-2 flex-shrink-0" aria-hidden="true" />
    </Link>
  );
}
