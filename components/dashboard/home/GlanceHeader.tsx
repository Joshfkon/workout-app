'use client';

import type { ReactNode } from 'react';
import { IconGauge, IconLoader2, IconSettings } from '@tabler/icons-react';
import { PendingLink } from '@/components/dashboard/PendingLink';

interface GlanceHeaderProps {
  /** Time-based greeting ("Good morning" etc.), computed client-side by the caller. */
  greeting: string;
  /** Localized date label ("Sun, Jul 5"), computed client-side by the caller. */
  todayLabel: string;
  /** Mesocycle context ("Wk 1 of 5 · Arnold"); omitted when no active plan. */
  weekContext?: string | null;
  /** This week's session progress ("2/4 sessions"); omitted when unknown. */
  sessionsLabel?: string | null;
  /** Readiness score (0-100) from today's check-in; pill hidden when null. */
  readinessScore?: number | null;
  /** Tapping the readiness pill (e.g. reopen the daily check-in). */
  onReadinessClick?: () => void;
  /** Phase chip (bulk/cut/maintain selector), rendered above the readiness pill. */
  phaseChip?: ReactNode;
}

function readinessPillClasses(score: number): string {
  if (score >= 70) return 'bg-status-ok-tint text-status-ok';
  if (score >= 40) return 'bg-status-warn-tint text-status-warn';
  return 'bg-status-bad-tint text-status-bad';
}

/**
 * Greeting + date header for the home glance view, with mesocycle week and
 * session context, the phase chip, and a readiness pill (from today's daily
 * check-in). The caller gates rendering on its client-only clock (to avoid
 * SSR hydration mismatch) and passes the derived strings down.
 */
export function GlanceHeader({
  greeting,
  todayLabel,
  weekContext,
  sessionsLabel,
  readinessScore,
  onReadinessClick,
  phaseChip,
}: GlanceHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-subhead text-ink-2">
            {todayLabel}
            {weekContext ? ` · ${weekContext}` : ''}
            {sessionsLabel ? (
              <>
                {' · '}
                <span className="font-medium text-ink">{sessionsLabel}</span>
              </>
            ) : null}
          </p>
          {phaseChip}
        </div>
        <h1 className="text-large-title text-ink mt-0.5">{greeting}</h1>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {typeof readinessScore === 'number' && (
          <button
            type="button"
            onClick={onReadinessClick}
            aria-label={`Readiness ${readinessScore}. Tap to review your check-in.`}
            className={`flex-shrink-0 h-9 rounded-full px-3 text-body font-bold tabular-nums whitespace-nowrap inline-flex items-center gap-1.5 ${readinessPillClasses(readinessScore)}`}
          >
            <IconGauge size={18} aria-hidden="true" />
            {readinessScore}
          </button>
        )}
        {/* 44px hit area (was 36: a tap just off the icon missed), a
            pressed state, and a spinner from the tap until Settings arrives
            — the panel read the silent wait as a missed first tap. */}
        <PendingLink
          href="/dashboard/settings"
          aria-label="Settings"
          className="-m-1 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-[background-color,transform] hover:bg-fill active:scale-95 active:bg-fill"
          pendingClassName="bg-fill text-ink"
          data-testid="home-settings"
        >
          {(pending) =>
            pending ? (
              <IconLoader2 size={22} className="animate-spin" aria-hidden="true" />
            ) : (
              <IconSettings size={22} aria-hidden="true" />
            )
          }
        </PendingLink>
      </div>
    </div>
  );
}
