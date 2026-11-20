'use client';

import type { ReactNode } from 'react';
import { IconGauge } from '@tabler/icons-react';

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
    </div>
  );
}
