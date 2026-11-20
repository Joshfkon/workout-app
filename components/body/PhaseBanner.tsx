'use client';

/**
 * Phase banner — compact strip under the verdict card:
 * "BULK · week 18 · started Mar 14 · target +0.5 lb/wk"  [Manage]
 * With no active phase it becomes the "set one" CTA.
 */

import Link from 'next/link';
import type { TrainingPhase } from '@/types/schema';
import { PHASE_STYLE } from '@/components/body/phaseStyle';
import { localDay, localDaysBetweenDays, parseLocalDay } from '@/lib/date/localDay';

interface PhaseBannerProps {
  phase: TrainingPhase | null;
  /** Route of the phase editor. */
  href: string;
}

function fmtShortDay(day: string): string {
  return parseLocalDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function PhaseBanner({ phase, href }: PhaseBannerProps) {
  if (!phase) {
    return (
      <Link
        href={href}
        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-fill/60 border border-sep/60 text-sm hover:bg-fill transition-colors"
        data-testid="phase-banner-empty"
      >
        <span className="text-ink">No active phase — set one</span>
        <span className="text-action text-xs font-medium shrink-0">Set phase</span>
      </Link>
    );
  }

  const style = PHASE_STYLE[phase.phaseType];
  const week = Math.floor(localDaysBetweenDays(phase.startDay, localDay()) / 7) + 1;
  const parts = [
    `week ${week}`,
    `started ${fmtShortDay(phase.startDay)}`,
    ...(phase.targetRateLbsPerWeek != null
      ? [
          `target ${phase.targetRateLbsPerWeek > 0 ? '+' : ''}${phase.targetRateLbsPerWeek} lb/wk`,
        ]
      : []),
  ];

  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-fill/60 border border-sep/60"
      data-testid="phase-banner"
    >
      <div className="flex items-center gap-2 min-w-0 text-xs text-ink-2">
        <span
          className={`px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide text-[10px] ${style.badgeBg} ${style.text} shrink-0`}
        >
          {style.label}
        </span>
        <span className="truncate">{parts.join(' · ')}</span>
      </div>
      <Link href={href} className="text-action text-xs font-medium shrink-0 hover:text-action">
        Manage
      </Link>
    </div>
  );
}
