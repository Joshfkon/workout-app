'use client';

import type { ReactNode } from 'react';
import { IconGauge, IconChevronRight } from '@tabler/icons-react';

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
  if (score >= 70) return 'bg-success-500/10 text-success-400';
  if (score >= 40) return 'bg-warning-500/10 text-warning-400';
  return 'bg-danger-500/10 text-danger-400';
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
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{greeting}</h1>
        <p className="text-[13px] text-surface-500 mt-1">
          {todayLabel}
          {weekContext ? ` · ${weekContext}` : ''}
          {sessionsLabel ? (
            <>
              {' · '}
              <span className="font-medium text-surface-300">{sessionsLabel}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {phaseChip}
        {typeof readinessScore === 'number' && (
          <button
            type="button"
            onClick={onReadinessClick}
            aria-label={`Readiness ${readinessScore}. Tap to review your check-in.`}
            className={`rounded-full pl-2 pr-1.5 py-1 text-[12px] font-semibold whitespace-nowrap inline-flex items-center gap-1 ${readinessPillClasses(readinessScore)}`}
          >
            <IconGauge size={14} aria-hidden="true" />
            {readinessScore}
            <IconChevronRight size={13} aria-hidden="true" className="opacity-70" />
          </button>
        )}
      </div>
    </div>
  );
}
