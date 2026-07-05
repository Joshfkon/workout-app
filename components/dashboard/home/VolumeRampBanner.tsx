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
      className="flex items-center gap-3 rounded-xl bg-surface-900 border border-surface-800 p-4 hover:bg-surface-800/50 transition-colors"
    >
      <span className="w-9 h-9 rounded-lg bg-warning-500/15 text-warning-400 flex items-center justify-center flex-shrink-0">
        <IconChartBar size={18} aria-hidden="true" />
      </span>
      <p className="flex-1 text-[13px] text-surface-300 leading-snug">
        {week <= 1 ? (
          <>
            <span className="font-semibold text-surface-100">Wk 1 ramp:</span> {muscles} below MEV —
            expected this early, on track if resolved by wk 2
          </>
        ) : (
          <>
            <span className="font-semibold text-surface-100">Wk {week}:</span> {muscles} still below MEV —
            add sets where you&apos;re short to stay on track
          </>
        )}
      </p>
      <IconChevronRight size={18} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
    </Link>
  );
}
